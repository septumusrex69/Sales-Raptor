import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, CalendarClock, CheckCircle2, Loader2, MessageSquareWarning, X } from 'lucide-react'
import { Modal, FormField, inputClass } from '../ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { useAppStore } from '../../store/AppStore'
import { NextDiaryFields, initialPlan, type NextPlan } from './NextDiaryFields'
import { fetchDay, workEntry, type DiaryRow } from '../../lib/diary.ts'
import { DIARY_KINDS } from '../../lib/diaryPriority.ts'
import { addWorkingDays } from '../../lib/workingDays.ts'
import { refreshNavCounts } from '../../lib/navCounts'

/**
 * Working a diary, one account after another, without going back to a list between each.
 *
 * This is the loop the firm described: finish an account, update the main comment, say when it
 * comes back, land on the next one. It appears only when an account is opened FROM the diary
 * (?diary=<entry id>), so an account looked up by name is just an account.
 *
 * TWO THINGS ARE ENFORCED HERE RATHER THAN HOPED FOR.
 *
 * The main comment must have been touched today. It is the two lines the next person reads
 * before they ring, and an account worked five times with a comment from March is an account
 * nobody can pick up cold. This does not block — an agent who genuinely has nothing to change
 * says so and moves on — but it does ask, which is the difference between a habit and an
 * intention.
 *
 * And the next date is taken before the entry closes. An account that is worked but not settled
 * has to come back, and asking afterwards means it often is not asked at all: that is how 355
 * accounts in the imported book ended up with nobody on them and no date.
 */
export function DiaryWorkBar({ account, onWorked }: {
  account: {
    id: string
    mainComment: string | null
    mainCommentAt: string | null
    prescriptionDate: string | null
    debtorFirstName: string | null
    debtorSurname: string | null
    accountNumber: string | null
  }
  /** Re-read the account after the entry closes, so the page is not showing stale figures. */
  onWorked?: () => void | Promise<void>
}) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()

  const entryId = params.get('diary')
  const today = new Date().toISOString().slice(0, 10)

  const [queue, setQueue] = useState<DiaryRow[] | null>(null)
  const [finishing, setFinishing] = useState(false)

  /*
   * The whole day, re-read each time the bar mounts.
   *
   * Not held in a store and not passed through the URL: an agent working a diary over an hour
   * has colleagues moving things into and out of it, and a queue captured at nine o'clock would
   * send them to an account somebody else has already closed.
   */
  const load = useCallback(async () => {
    if (!entryId || !currentUser?.id) { setQueue(null); return }
    try {
      const day = await fetchDay({ ownerId: currentUser.id, date: today })
      setQueue([...day.due, ...day.overdue])
    } catch {
      // A bar that cannot count is not worth an error over the account underneath it.
      setQueue(null)
    }
  }, [entryId, currentUser?.id, today])

  useEffect(() => { void load() }, [load])

  if (!entryId || !queue) return null

  const index = queue.findIndex((e) => e.id === entryId)
  const entry = index >= 0 ? queue[index] : null
  if (!entry) return null

  const next = queue[index + 1] ?? null
  const commentFresh = !!account.mainCommentAt && account.mainCommentAt.slice(0, 10) === today

  const leave = () => {
    const p = new URLSearchParams(params)
    p.delete('diary')
    setParams(p, { replace: true })
  }

  const goNext = () => {
    if (next) navigate(`/accounts/${next.accountId}?diary=${next.id}`)
    else navigate('/diary')
  }

  return (
    <>
      {/*
        In the flow of the page, between the main comment and the action row.

        It was fixed to the bottom of the window, which was wrong twice over: it cost eighty
        pixels of every screen for the whole time somebody was working a diary, and the spacer
        that kept the page clear of it left a visible hole under the action row. Here it costs
        nothing when it is absent, and it reads in the order the work happens — where the account
        stands, what the diary wanted, then the phone.
      */}
      <div className="rounded-xl border border-navy-800 bg-navy-950 text-white">
        <div className="@container px-4 py-2.5">
          <div className="flex flex-col @lg:flex-row @lg:items-center gap-2 @lg:gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gold-500">
                Working the diary · {index + 1} of {queue.length}
              </p>
              <p className="text-xs text-slate-300 truncate">
                {DIARY_KINDS[entry.kind].label}
                {entry.reason && <span className="text-slate-400"> — {entry.reason}</span>}
              </p>
            </div>

            {/*
              Said on the bar, not only in the modal, so it can be fixed before pressing
              anything. An amber line for an hour is a better prompt than a question at the end.
            */}
            {!commentFresh && (
              <p className="flex items-center gap-1.5 text-[11px] text-gold-400 shrink-0">
                <MessageSquareWarning size={13} />
                Main comment not updated today
              </p>
            )}

            <div className="flex items-center gap-2 shrink-0">
              <button onClick={leave}
                className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-2 rounded-lg text-slate-300 hover:bg-white/10"
                title="Stop working the diary and stay on this account">
                <X size={13} /> Stop
              </button>
              <button onClick={() => setFinishing(true)}
                className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500">
                <CheckCircle2 size={14} />
                {next ? 'Done & next' : 'Done & finish'}
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {finishing && (
        <FinishModal
          entry={entry}
          account={account}
          commentFresh={commentFresh}
          today={today}
          remaining={queue.length - index - 1}
          onClose={() => setFinishing(false)}
          onDone={async () => {
            setFinishing(false)
            refreshNavCounts()
            await onWorked?.()
            goNext()
          }}
        />
      )}
    </>
  )
}

/* ---------- closing one and booking the next ---------- */

function FinishModal({ entry, account, commentFresh, today, remaining, onClose, onDone }: {
  entry: DiaryRow
  account: { id: string; prescriptionDate: string | null }
  commentFresh: boolean
  today: string
  remaining: number
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const { currentUser } = useAuth()
  const { users } = useAppStore()
  const [outcome, setOutcome] = useState('')
  const [plan, setPlan] = useState<NextPlan>(() => initialPlan(entry.kind, addWorkingDays(today, 5)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const owner = users.find((u) => u.id === entry.ownerId)

  async function save() {
    if (!outcome.trim()) { setError('Say what came of it. This is what the diary is read back from.'); return }
    setBusy(true); setError(null)
    try {
      await workEntry({
        entry,
        outcome,
        next: plan.comesBack
          ? { comesBack: true, dueOn: plan.dueOn, kind: plan.kind, note: plan.note }
          : { comesBack: false, exit: plan.exit, note: plan.note },
        actor: { id: currentUser?.id ?? null, name: currentUser?.name ?? null },
      })
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Finish this account" onClose={onClose} width={560}>
      <div className="space-y-4">
        {/*
          The nudge, at the moment it can still be acted on. Not a block: an agent who reached
          voicemail has nothing new to say about the account, and forcing a comment would only
          teach them to type a full stop.
        */}
        {!commentFresh && (
          <p className="flex items-start gap-2 text-sm text-[var(--c-gold-dark)] bg-[var(--tint-gold)] rounded-lg px-3 py-2.5">
            <MessageSquareWarning size={15} className="shrink-0 mt-0.5" />
            <span>
              The main comment has not changed today. It is what the next person reads before
              they ring — worth a line if anything has moved. Close this box to edit it.
            </span>
          </p>
        )}

        <FormField label="What came of it" required>
          <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={2} autoFocus
            placeholder="Spoke to him. Says the insurance pays out on the 28th and he will settle then."
            className={`${inputClass} resize-none`} />
        </FormField>

        {/* Same question, same rules, same component as the day list's Done — see NextDiaryFields. */}
        <NextDiaryFields
          plan={plan}
          onChange={setPlan}
          ownerId={entry.ownerId}
          capacity={owner?.diaryCapacity ?? null}
          today={today}
          prescriptionDate={account.prescriptionDate}
        />

        {error && <p className="text-sm text-negative-700">{error}</p>}

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-400">
            {remaining > 0 ? `${remaining} more after this` : 'Last one'}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-2">
              Cancel
            </button>
            <button type="button" onClick={() => void save()} disabled={busy || !outcome.trim()}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900 disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />}
              {remaining > 0 ? 'Done, next account' : 'Done, back to diary'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
