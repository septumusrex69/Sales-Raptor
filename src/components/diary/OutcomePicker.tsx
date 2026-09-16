import { FormField, inputClass } from '../ui/Modal'
import {
  CALL_OUTCOMES, CALL_OUTCOME_ORDER, needsPromise, needsWords, type CallOutcome,
} from '../../lib/callOutcome.ts'

export interface OutcomeChoice {
  outcome: CallOutcome | null
  /** Set when the debtor made a NEW commitment, so the existing one is not simply reused. */
  repromise?: boolean
  /** Only when they agreed to pay. */
  amount: string
  dueOn: string
  /** The words, where the answer needs them. */
  words: string
}

export const EMPTY_OUTCOME: OutcomeChoice = { outcome: null, amount: '', dueOn: '', words: '' }

/** Is there enough here to save? Null outcome is allowed — recording nothing stays possible. */
export function outcomeReady(c: OutcomeChoice, hasLivePromise = false): boolean {
  if (!c.outcome) return true
  /* A promise already on the account is the amount and the date — see OutcomePicker. */
  if (needsPromise(c.outcome) && hasLivePromise && !c.repromise) return true
  if (needsPromise(c.outcome)) return c.amount.trim() !== '' && c.dueOn !== ''
  if (needsWords(c.outcome)) return c.words.trim().length >= 3
  return true
}

/**
 * What came of working this account.
 *
 * ONE QUESTION, ANSWERED IN A TAP, at the only moment anybody knows the answer — while the
 * debtor is still on the line. Each choice reads as the RUNG it puts the account on, with the
 * event that gets it there underneath: the firm's own vocabulary, not a second one to learn.
 * Eight of the thirteen positions come from this control, and every one of them writes the record
 * that stands behind it — see callOutcome.ts.
 *
 * OPTIONAL, DELIBERATELY. An agent who did something the list does not cover must be able to
 * finish the account anyway; a required field with no honest option is how "Review" ended up
 * meaning nothing, and how the imported book ended up with 58 promises to pay and 43 promises.
 * Skipping it is itself recorded — the account reads "worked, no outcome recorded", which is a
 * data-quality signal for a team leader and never reaches a client.
 */
export function OutcomePicker({ value, onChange, livePromise }: {
  value: OutcomeChoice
  onChange: (next: OutcomeChoice) => void
  /** A promise already on this account, where the entry is here to check one. */
  livePromise?: { amount: number; dueOn: string } | null
}) {
  const set = (patch: Partial<OutcomeChoice>) => onChange({ ...value, ...patch })
  const chosen = value.outcome
  /*
   * ALREADY PROMISED, SO DO NOT ASK AGAIN. The firm's objection and it was right: "there's
   * already a PTP in place, why do you need to redo this?" A box that demands an amount and a
   * date somebody has already given teaches people to retype it, and a retyped promise is a
   * SECOND promise — two rows, two due dates, and a client told about an arrangement that is now
   * ambiguous.
   *
   * So Arranged shows what stands and asks nothing. Re-promising is still reachable, behind a
   * deliberate press, because a debtor who moves the date has genuinely made a new commitment.
   */
  const keepingPromise = !!livePromise && chosen === 'promised' && !value.repromise

  return (
    <div className="space-y-2">
      <span className="block text-xs font-medium text-slate-500">Where the account stands</span>
      {/*
        Two columns of plain rows rather than a dropdown. The agent is looking for one specific
        thing they already know, and a list they can see all of is faster to hit than one they
        have to open — which matters when somebody is still on the telephone.
      */}
      <div className="grid sm:grid-cols-2 gap-1.5">
        {CALL_OUTCOME_ORDER.map((k) => {
          const meta = CALL_OUTCOMES[k]
          const on = chosen === k
          return (
            <button key={k} type="button"
              // Pressing the chosen one again clears it: recording nothing must stay reachable.
              onClick={() => set({ outcome: on ? null : k })}
              className={`text-left rounded-lg border px-2.5 py-1.5 transition-colors ${
                on ? 'border-gold-500 bg-gold-400 text-navy-950' : 'border-slate-200 hover:bg-slate-50'}`}>
              <span className="block text-xs font-medium">{meta.label}</span>
              {meta.hint && (
                <span className={`block text-[10px] ${on ? 'text-navy-950/70' : 'text-slate-400'}`}>
                  {meta.hint}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {keepingPromise && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
          <span>
            Already promised:{' '}
            <span className="font-medium text-slate-800">
              R{livePromise.amount.toLocaleString('en-ZA')} by {livePromise.dueOn}
            </span>
            . Nothing to re-enter.
          </span>
          <button type="button" onClick={() => set({ repromise: true })}
            className="ml-auto text-brand-600 hover:underline">
            They promised again
          </button>
        </div>
      )}

      {needsPromise(chosen) && !keepingPromise && (
        /*
          THE AMOUNT AND THE DATE, REQUIRED. A promise without them is the thing the whole design
          exists to prevent: nothing to diarise, nothing that can fall due, nothing that can
          break, and a client told an arrangement exists when nothing does.
        */
        <div className="flex flex-wrap items-end gap-2">
          <FormField label="How much">
            <span className="block w-[8rem]">
              <input inputMode="decimal" placeholder="2000" value={value.amount}
                onChange={(e) => set({ amount: e.target.value })}
                className={`${inputClass} py-1.5`} />
            </span>
          </FormField>
          <FormField label="By when">
            <span className="block w-[11rem]">
              <input type="date" value={value.dueOn}
                onChange={(e) => set({ dueOn: e.target.value })}
                className={`${inputClass} py-1.5`} />
            </span>
          </FormField>
        </div>
      )}

      {needsWords(chosen) && (
        <FormField label={chosen === 'disputed' ? 'What do they dispute' : 'Say what they told you'}>
          <input value={value.words} onChange={(e) => set({ words: e.target.value })}
            placeholder={chosen === 'cannot_pay'
              ? 'Retrenched in July, living on a SASSA grant.'
              : chosen === 'disputed'
                ? 'Says the last two invoices were for work never delivered.'
                : 'Under debt review with Nexus Debt Counsellors.'}
            className={inputClass} />
          <span className="block text-[11px] text-slate-400 mt-1">
            Goes to the client. It is the difference between &ldquo;cannot pay&rdquo; and a reason
            they can act on.
          </span>
        </FormField>
      )}
    </div>
  )
}
