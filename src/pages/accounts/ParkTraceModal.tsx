import { useState } from 'react'
import { AlertTriangle, CalendarClock, Snowflake } from 'lucide-react'
import { FormField, Modal } from '../../components/ui/Modal'
import { freezeAccount, askClient } from '../../lib/accountFreeze.ts'
import { diarise } from '../../lib/diary.ts'
import {
  DORMANT_MONTHS, dormantFreezeReason, uncontactableAsk, wakeDate,
} from '../../lib/dormancy.ts'
import { shortDate } from '../../lib/dateLabels.ts'
import { todayIso } from '../../lib/reminderTime.ts'

const inputClass = 'w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] '
  + 'text-slate-800 focus:border-[#c9a052] focus:outline-none'

/**
 * THE TWO ENDINGS A SPENT TRACE HAS, and the box where somebody chooses one.
 *
 * NEITHER HAPPENS ON ITS OWN. Both are offered from the trace that is spent -- which is where
 * somebody is standing when they find out -- and both are confirmed here, because one of them
 * takes the account off the floor and the other asks a client to give up money.
 *
 *   PARK IT is a FIRM FREEZE plus a dated trace in the diary. The freeze stops every sequence in
 *   the database and the diary is what brings it back; neither is a new column and neither needs a
 *   nightly job. See dormancy.ts for why it is recorded that way.
 *
 *   ASK THE CLIENT quotes the account of the work -- how many searches, how many rounds, what they
 *   came to -- because a client asked to write off a balance is entitled to it. "We cannot find
 *   this debtor, please write it off" with nothing behind it is the firm asking to be let off a
 *   file.
 *
 * THE TWO ARE NOT EXCLUSIVE, which is why this box offers both: the firm's own position is that
 * parking costs the client nothing, so the ask names the park date as the alternative.
 */
export function ParkTraceModal({
  accountId, accountLabel, mode, rounds, searches, actor, onClose, onDone,
}: {
  accountId: string
  accountLabel: string
  /** Which of the two the collector pressed. Both are reachable from inside the box. */
  mode: 'park' | 'write_off'
  /** Rounds worked right through on this account that reached nobody. Quoted to the client. */
  rounds: number
  /** Bureau searches the account has been charged for. Also quoted. */
  searches: number
  actor: { id: string | null; name: string | null }
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const [until, setUntil] = useState(wakeDate(todayIso()))
  const [ask, setAsk] = useState(uncontactableAsk({ rounds, searches, parkedUntil: null }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function park() {
    if (!until) { setError('Say when it comes back.'); return }
    setBusy(true)
    setError(null)
    try {
      await freezeAccount({
        accountId,
        /* THE FIRM'S OWN FREEZE, not the client's. A client freeze is the client telling us to
           stop; this is the firm setting a file aside because it cannot find anybody to ring. */
        by: 'firm',
        reason: dormantFreezeReason(shortDate(until), rounds),
        actor,
      })
      /*
       * AND THE WAKE-UP, WHICH IS WHAT MAKES IT A PARK RATHER THAN A DISAPPEARANCE.
       *
       * A TRACE AND NOT A REVIEW. What is waiting on that date is a fresh bureau search, which is
       * the trace rung of the diary ladder -- a review is the last rung, the kind with no event
       * behind it, and this has a date somebody chose and a job to do when it arrives.
       */
      await diarise({
        accountId,
        ownerId: actor.id,
        dueOn: until,
        kind: 'trace',
        reason: `Trace again — the account was set aside on ${shortDate(todayIso())} after `
          + `${rounds === 1 ? 'a trace was' : `${rounds} traces were`} worked right through `
          + 'without reaching the debtor. A bureau report six months on is a different report.',
        alsoNoteOnAccount: true,
        actor,
      })
      await onDone()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function request() {
    if (!ask.trim()) { setError('Say what the client is being asked.'); return }
    setBusy(true)
    setError(null)
    try {
      await askClient({ accountId, ask: ask.trim(), actor })
      await onDone()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={mode === 'park' ? 'Set the account aside' : 'Ask the client to write it off'}
      onClose={onClose} width={520}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">{accountLabel}</p>

        {/* WHAT HAS ACTUALLY BEEN SPENT, over both halves of the box: it is the reason either
            of these is on the screen, and it is what the client will be quoted. */}
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] leading-snug text-slate-600">
          {searches === 1 ? 'One bureau search has' : `${searches} bureau searches have`} been run
          on this account and {rounds === 1 ? 'one trace has' : `${rounds} traces have`} been worked
          right through — every number, email and linked person — without reaching the debtor.
        </p>

        {mode === 'park' ? (
          <>
            <FormField label="Come back to it on" required>
              <input type="date" className={inputClass} value={until}
                onChange={(e) => setUntil(e.target.value)} />
            </FormField>
            {/*
              WHY SIX MONTHS, said rather than defaulted silently. A re-trace a month later buys
              the same report at the same price; what makes a new one worth the client's money is
              the debtor appearing somewhere -- a payroll, a credit application, a new address.
            */}
            <p className="text-[11px] text-slate-500">
              {DORMANT_MONTHS} months is the default because a bureau record has to have changed
              for a new search to be worth the client&rsquo;s money. The account is frozen in the
              meantime, so no sequence sends anything, and it comes back on that date as a trace.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600">
                Cancel
              </button>
              <button type="button" onClick={() => void park()} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy-950 px-3 py-1.5
                  text-xs font-medium text-white disabled:opacity-40">
                <Snowflake size={12} /> Set it aside until {until ? shortDate(until) : '—'}
              </button>
            </div>
          </>
        ) : (
          <>
            <FormField label="What the client is being asked" required>
              <textarea className={inputClass} rows={7} value={ask}
                onChange={(e) => setAsk(e.target.value)} />
            </FormField>
            {/* THE CLIENT DECIDES. Raptor does not write off an account on their behalf, and the
                box says so rather than leaving somebody to wonder whether pressing this closes
                the file. */}
            <p className="text-[11px] text-slate-500">
              This raises the request on the account and nothing else. The balance is written off
              only when the client gives the instruction &mdash; it is their money.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600">
                Cancel
              </button>
              <button type="button" onClick={() => void request()} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy-950 px-3 py-1.5
                  text-xs font-medium text-white disabled:opacity-40">
                <CalendarClock size={12} /> Put it to the client
              </button>
            </div>
          </>
        )}

        {error && (
          <p className="flex items-start gap-1.5 text-xs text-negative-700">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
