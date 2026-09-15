import { FormField, inputClass } from '../ui/Modal'
import {
  CALL_OUTCOMES, CALL_OUTCOME_ORDER, needsPromise, needsWords, type CallOutcome,
} from '../../lib/callOutcome.ts'

export interface OutcomeChoice {
  outcome: CallOutcome | null
  /** Only when they agreed to pay. */
  amount: string
  dueOn: string
  /** The words, where the answer needs them. */
  words: string
}

export const EMPTY_OUTCOME: OutcomeChoice = { outcome: null, amount: '', dueOn: '', words: '' }

/** Is there enough here to save? Null outcome is allowed — recording nothing stays possible. */
export function outcomeReady(c: OutcomeChoice): boolean {
  if (!c.outcome) return true
  if (needsPromise(c.outcome)) return c.amount.trim() !== '' && c.dueOn !== ''
  if (needsWords(c.outcome)) return c.words.trim().length >= 3
  return true
}

/**
 * What came of working this account.
 *
 * ONE QUESTION, ANSWERED IN A TAP, at the only moment anybody knows the answer — while the
 * debtor is still on the line. The agent never picks a status: they say what happened, and
 * everything else follows. Eight of the thirteen client statuses come from this control.
 *
 * OPTIONAL, DELIBERATELY. An agent who did something the list does not cover must be able to
 * finish the account anyway; a required field with no honest option is how "Review" ended up
 * meaning nothing, and how the imported book ended up with 58 promises to pay and 43 promises.
 * Skipping it is itself recorded — the account reads "worked, no outcome recorded", which is a
 * data-quality signal for a team leader and never reaches a client.
 */
export function OutcomePicker({ value, onChange }: {
  value: OutcomeChoice
  onChange: (next: OutcomeChoice) => void
}) {
  const set = (patch: Partial<OutcomeChoice>) => onChange({ ...value, ...patch })
  const chosen = value.outcome

  return (
    <div className="space-y-2">
      <span className="block text-xs font-medium text-slate-500">What came of it</span>
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

      {needsPromise(chosen) && (
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
