import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, Loader2, MessageSquareWarning, X,
} from 'lucide-react'
import { Modal, FormField, inputClass } from '../ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { useAppStore } from '../../store/AppStore'
import { NextDiaryFields, initialPlan, type NextPlan } from './NextDiaryFields'
import { fetchDay, countWorkedToday, workEntry, type DiaryRow } from '../../lib/diary.ts'
import { saveMainComment } from '../../lib/accountWorkspace.ts'
import { DIARY_KINDS } from '../../lib/diaryPriority.ts'
import { addWorkingDays } from '../../lib/workingDays.ts'
import { refreshNavCounts } from '../../lib/navCounts'
import { DictateButton } from '../ui/Dictate'
import { ClientLinePreview } from './ClientLinePreview'
import { OutcomePicker, EMPTY_OUTCOME, outcomeReady, type OutcomeChoice } from './OutcomePicker'
import { CALL_OUTCOMES, type CallOutcome } from '../../lib/callOutcome.ts'
import { recordOutcome } from '../../lib/recordOutcome.ts'

/**
 * The accounts finished in this run of the diary.
 *
 * Kept in sessionStorage because "go back to the one I just did" is a navigation, and the bar
 * unmounts on every navigation — React state would be gone by the time it was needed. Per tab,
 * so an agent with the diary open in two tabs does not get one trail crossing the other.
 *
 * Capped, because it is a way back to the last few, not an audit trail. The audit trail is the
 * diary entries themselves, which are never edited.
 */
const TRAIL_KEY = 'raptor.diary.trail'
const TRAIL_MAX = 25

interface Worked { accountId: string; entryId: string; name: string }

function readTrail(): Worked[] {
  try {
    const raw = sessionStorage.getItem(TRAIL_KEY)
    return raw ? (JSON.parse(raw) as Worked[]) : []
  } catch {
    return []
  }
}

function pushTrail(item: Worked): void {
  try {
    const next = [item, ...readTrail().filter((w) => w.accountId !== item.accountId)].slice(0, TRAIL_MAX)
    sessionStorage.setItem(TRAIL_KEY, JSON.stringify(next))
  } catch {
    // A private window with storage blocked loses the back button and nothing else.
  }
}

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
  const [done, setDone] = useState(0)
  const [finishing, setFinishing] = useState(false)

  /*
   * The accounts already finished in this run, newest first.
   *
   * Kept in sessionStorage rather than state because going back is a NAVIGATION — the bar
   * unmounts and remounts on every account — and kept per tab because two agents on one machine
   * is not a thing, but one agent with the diary open twice is.
   */
  const trail = readTrail()

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
      return
    }
    /*
     * The tally is fetched SEPARATELY and on purpose.
     *
     * It was in the same Promise.all as the day, which meant a failed count took the whole bar
     * down with it — no Done, no Next, no way to work the diary, because a decorative number
     * could not be read. The offline layout harness found it immediately, which is what it is
     * for. The queue is the bar; the count is a nicety on it.
     */
    try {
      setDone(await countWorkedToday(currentUser.id, today))
    } catch {
      setDone(0)
    }
  }, [entryId, currentUser?.id, today])

  useEffect(() => { void load() }, [load])

  if (!entryId || !queue) return null

  const index = queue.findIndex((e) => e.id === entryId)
  const entry = index >= 0 ? queue[index] : null
  /*
   * An entry that is not in the open queue but is in the trail is one just finished, reached by
   * pressing Previous. Without this the bar would simply vanish, which makes going back a dead
   * end: you can see what you wrote and have no way back into the run.
   */
  const revisiting = entry ? null : trail.find((w) => w.entryId === entryId) ?? null
  if (!entry && !revisiting) return null

  const next = entry ? queue[index + 1] ?? null : null
  /*
   * One step further back than wherever you are.
   *
   * On the working bar the current entry is open and so is not in the trail at all, which makes
   * this the last one finished. On a revisited entry it is the one before that — walking back
   * rather than snapping to the most recent, which is what `find(w => w.entryId !== entryId)`
   * would have done from the third account back.
   */
  const here = trail.findIndex((w) => w.entryId === entryId)
  const previous = trail[here + 1] ?? null
  const resume = queue[0] ?? null
  const commentFresh = !!account.mainCommentAt && account.mainCommentAt.slice(0, 10) === today

  const leave = () => {
    const p = new URLSearchParams(params)
    p.delete('diary')
    setParams(p, { replace: true })
  }

  const goNext = () => {
    // Remembered before we leave, so Previous on the next account comes back to this one.
    if (entry) {
      pushTrail({
        accountId: entry.accountId,
        entryId: entry.id,
        name: [entry.account.debtorFirstName, entry.account.debtorSurname]
          .filter(Boolean).join(' ').trim() || entry.account.accountNumber || 'Account',
      })
    }
    if (next) navigate(`/accounts/${next.accountId}?diary=${next.id}`)
    else navigate('/diary')
  }

  const goTo = (w: Worked) => navigate(`/accounts/${w.accountId}?diary=${w.entryId}`)

  /*
   * Revisiting one already finished. Deliberately a different bar: there is nothing to finish
   * here, and offering "Done & next" on a closed entry would either do nothing or book a second
   * one. All it offers is the way back to where the run had got to.
   */
  if (revisiting) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50">
        <div className="@container px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2 @lg:gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                Already worked today
              </p>
              <p className="text-xs text-slate-500 truncate">
                You finished this one a moment ago. Anything typed here is a fresh note, not a
                change to what was booked.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {previous && (
                <button onClick={() => goTo(previous)}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-2 rounded-lg text-slate-600 hover:bg-slate-200"
                  title={`Back to ${previous.name}`}>
                  <ArrowLeft size={13} /> Previous
                </button>
              )}
              <button
                onClick={() => (resume ? navigate(`/accounts/${resume.accountId}?diary=${resume.id}`) : navigate('/diary'))}
                className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900">
                {resume ? 'Back to the diary' : 'Diary is clear'}
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }
  if (!entry) return null

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
              {/*
                DONE AND LEFT, not a position.
                
                It read "1 of 42", which is true and tells you nothing: a finished entry leaves
                the queue, so the next one is always the first of what remains and the "1 of"
                never moves. Three hours in looked identical to just starting.
              */}
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gold-500">
                Working the diary · {done > 0 && `${done} done · `}
                {queue.length} to go
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
              {/* Back to the one just finished — to check what was written, or fix a slip. */}
              {previous && (
                <button onClick={() => goTo(previous)}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-2 rounded-lg text-slate-300 hover:bg-white/10"
                  title={`Back to ${previous.name}`}>
                  <ArrowLeft size={13} /> Previous
                </button>
              )}
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

function FinishModal({ entry, account, today, remaining, onClose, onDone }: {
  entry: DiaryRow
  account: { id: string; prescriptionDate: string | null }
  today: string
  remaining: number
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const { currentUser } = useAuth()
  const { users } = useAppStore()
  const [outcome, setOutcome] = useState('')
  const [came, setCame] = useState<OutcomeChoice>(EMPTY_OUTCOME)
  /*
   * OFF. Always, whatever state the main comment is in.
   *
   * It used to arrive ticked whenever the comment had not been touched today, on the reasoning
   * that the sentence typed here is usually the new state of play. The firm asked for it off,
   * and they are right: a box that is already ticked gets pressed past rather than decided, and
   * the main comment is the one line the next person reads before they ring. Overwriting it
   * should be somebody choosing to, not the default that happens while they are looking at the
   * date picker.
   *
   * The amber prompt above still says the comment is stale. Saying so and doing it for them are
   * different things.
   */
  const [asMainComment, setAsMainComment] = useState(false)
  const [plan, setPlan] = useState<NextPlan>(() => initialPlan(entry.kind, addWorkingDays(today, 5)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const owner = users.find((u) => u.id === entry.ownerId)
  /*
   * Only an OPEN promise stands. One already kept or already broken is history, and offering to
   * reuse it would book a check on a commitment that is finished.
   */
  const livePromise = entry.promise && entry.promise.status === 'open'
    ? { amount: entry.promise.amount, dueOn: entry.promise.dueOn }
    : null

  async function save() {
    setBusy(true); setError(null)
    try {
      /*
        THE RECORDS FIRST, THE DIARY SECOND. If the promise cannot be written there is nothing
        to check on the date, so booking the check anyway would leave a diary entry pointing at
        a commitment that does not exist. Failing here stops the whole save and says why.
      */
      if (came.outcome) {
        const r = await recordOutcome({
          accountId: entry.accountId,
          outcome: came.outcome,
          /*
           * NULL WHERE THE EXISTING PROMISE IS BEING KEPT. Writing one anyway would make a second
           * row for the same commitment — two due dates on one account, and a client report that
           * cannot say which arrangement is the arrangement.
           */
          promise: came.outcome === 'promised' && (!livePromise || came.repromise)
            ? { amount: Number(came.amount.replace(/[^\d.]/g, '')), dueOn: came.dueOn }
            : null,
          words: came.words,
          actor: { id: currentUser?.id ?? null, name: currentUser?.name ?? null },
        })
        if (r.failed.length) throw new Error(`Could not record ${r.failed.join(' or ')}.`)
      }

      await workEntry({
        entry,
        outcome,
        next: plan.comesBack
          ? { comesBack: true, dueOn: plan.dueOn, kind: plan.kind }
          : { comesBack: false, exit: plan.exit },
        actor: { id: currentUser?.id ?? null, name: currentUser?.name ?? null },
      })
      /*
       * After the booking, not before, and allowed to fail on its own.
       *
       * The booking is the thing that must not be lost: an account that is worked but not
       * re-diarised falls out of everybody's day silently. A main comment that did not update
       * is visible on the very next screen, with an amber line telling you so.
       */
      if (asMainComment && outcome.trim()) {
        try {
          await saveMainComment(account.id, outcome, currentUser?.id ?? null, currentUser?.name ?? null)
        } catch {
          // Deliberately swallowed — see above.
        }
      }
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
          THE "MAIN COMMENT HAS NOT CHANGED TODAY" NAG IS GONE, at the firm's instruction, and it
          was arguing with itself. It fired before anybody had typed anything — the box opens with
          an empty note, so of course nothing had changed yet — and it told a person to close the
          box to do something the box itself now does: the note underneath has "make this the main
          comment" right on it. A warning that fires when nothing is wrong is one people stop
          reading, and this one fired every single time.
        */}
        {/*
          WHERE THE ACCOUNT STANDS, FIRST. The firm reads this box downwards as one sentence —
          where it stands, what came of it, what to do next, and only then which day — and the
          position is what decides most of the rest, so it can no longer sit underneath the thing
          it decides.
        */}
        <OutcomePicker value={came} livePromise={livePromise} onChange={(next) => {
          setCame(next)
          // The diary's own suggestion follows the answer: a promise wants checking on its date.
          if (next.outcome && next.outcome !== came.outcome) {
            setPlan((p) => ({ ...p, kind: CALL_OUTCOMES[next.outcome as CallOutcome].suggests }))
          }
        }} />

        <FormField label="What came of it">
          <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={2} autoFocus
            placeholder="Spoke to him. Says the insurance pays out on the 28th and he will settle then."
            className={`${inputClass} resize-none`} />
          {/*
            The one that matters most. An agent working sixty accounts has just put the phone
            down and is about to type the same shape of sentence for the sixtieth time.
          */}
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {/* Talk it instead of typing it — the words land in the box above. See Dictate.tsx. */}
            <DictateButton size="small" value={outcome} onChange={setOutcome} />
            <span className="text-[11px] text-slate-400">
              Optional. Goes on the account&rsquo;s timeline too.
            </span>
          </div>

          <label className="flex items-start gap-2 mt-2.5 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={asMainComment}
              disabled={!outcome.trim()}
              onChange={(e) => setAsMainComment(e.target.checked)} />
            <span>
              Make this the main comment
              <span className="block text-[11px] text-slate-400">
                Replaces what the next person reads before they ring. The old one is kept on the
                timeline, so nothing is lost.
              </span>
            </span>
          </label>
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

        {/*
          LAST, UNDER THE DATE IT DESCRIBES. It reads "we will follow up the dispute on the 25th",
          so it belongs after the day has been chosen rather than above it — the firm asked for it
          here, and a sentence that names a date the reader has not picked yet is a sentence they
          have to read twice.
        */}
        <ClientLinePreview account={entry.account} next={plan.comesBack ? { kind: plan.kind, dueOn: plan.dueOn } : null} />

        {error && <p className="text-sm text-negative-700">{error}</p>}

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-400">
            {remaining > 0 ? `${remaining} more after this` : 'Last one'}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-2">
              Cancel
            </button>
            <button type="button" onClick={() => void save()} disabled={busy || !outcomeReady(came, !!livePromise)}
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
