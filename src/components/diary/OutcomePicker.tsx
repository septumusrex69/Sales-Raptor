import { FormField, inputClass } from '../ui/Modal'
import {
  CALL_OUTCOMES, CALL_OUTCOME_ORDER, needsPromise, needsWords, type CallOutcome,
  type OutcomeChoice,
} from '../../lib/callOutcome.ts'
import { QUERY_CATEGORIES, explanationMissing } from '../../lib/disputeCategories.ts'

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
export function OutcomePicker({ value, onChange, livePromise, offer, wordsAskedAs }: {
  value: OutcomeChoice
  onChange: (next: OutcomeChoice) => void
  /** A promise already on this account, where the entry is here to check one. */
  livePromise?: { amount: number; dueOn: string } | null
  /**
   * WHICH OF THE EIGHT TO OFFER. All of them by default, which is the diary's case: an account
   * being finished at a desk can have landed anywhere.
   *
   * THE CALL BOX OFFERS FIVE, and the reason is a fee. That box's own question is "did you speak
   * to them?", and the firm's instruction for this control there was that choosing an outcome
   * answers it: "either way, it records, and it's then accepted as spoken to the debtor, so it
   * charges the consultation". An outcome whose own meaning is that nobody was reached — no
   * answer, a trace, a practitioner answering for the debtor — cannot sit on a press that raises
   * R60 for a conversation. Those are `reached: false` in CALL_OUTCOMES and the call box leaves
   * them out; the diary, which charges nothing, keeps all eight.
   */
  offer?: CallOutcome[]
  /**
   * THE WORDS ARE ALREADY BEING ASKED FOR, AND THIS IS THE NAME OF THE BOX ASKING.
   *
   * THE FIRM, of a call that ended in a dispute: "so now you make a note of the telephone call,
   * and then you make another note of, for example, the dispute. Right? So you're double making
   * notes. So notes should be made only at one place."
   *
   * They are right, and `words` is the field that was being asked for twice. Where the caller
   * already has the sentence — the call box has it in "What was said?" — it passes the label here,
   * this control draws no second box, and the caller keeps `value.words` fed from its own field.
   * Nothing about validation changes: `outcomeReady` still reads `words`, so a dispute still
   * cannot be saved with nothing behind it. What changes is that the collector types it once.
   */
  wordsAskedAs?: string | null
}) {
  const set = (patch: Partial<OutcomeChoice>) => onChange({ ...value, ...patch })
  const chosen = value.outcome
  const offered = offer ?? CALL_OUTCOME_ORDER
  /* Eight reads as two rows of four; five as one row of five. A four-wide grid holding five puts
     a lone button on a second row, which reads as a category of its own. */
  const cols = offered.length === 5 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'
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
      {/*
        SLIMMER, because eight two-line cards was most of the box before anybody had typed a word —
        and the firm said so: "it's getting bulky". The hint is what took the room, and it is only
        needed while you are deciding: the chosen one keeps its line, the other seven give it back.
        A person who wants all eight explanations hovers, and one who has already chosen does not
        need seven descriptions of the choices they did not make.
      */}
      <div className={`grid grid-cols-2 ${cols} gap-1.5`}>
        {offered.map((k) => {
          const meta = CALL_OUTCOMES[k]
          const on = chosen === k
          return (
            <button key={k} type="button" title={meta.hint}
              // Pressing the chosen one again clears it: recording nothing must stay reachable.
              onClick={() => set({ outcome: on ? null : k })}
              className={`text-left rounded-lg border px-2 py-1.5 transition-colors ${
                on ? 'border-gold-500 bg-gold-400 text-navy-950' : 'border-slate-200 hover:bg-slate-50'}`}>
              <span className="block text-xs font-medium leading-tight">{meta.label}</span>
            </button>
          )
        })}
      </div>

      {/* The chosen one explains itself, once, where the seven others no longer have to. */}
      {chosen && CALL_OUTCOMES[chosen].hint && (
        <p className="text-[11px] text-slate-400">{CALL_OUTCOMES[chosen].hint}</p>
      )}

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

      {chosen === 'disputed' && (
        /*
          WHAT KIND OF DISPUTE, ASKED ON THE CALL. The firm made the classification compulsory --
          "you should be able to say about what is a dispute about" -- and the debtor is on the line,
          which is the only moment anybody knows. It sits ABOVE the words on purpose: on "Other" the
          words ARE the classification, so the question has to come first.
        */
        <FormField label="What kind of dispute">
          <select value={value.category} onChange={(e) => set({ category: e.target.value })}
            className={inputClass}>
            {/* Disabled, not "None": a selectable blank is the optional field back again. */}
            <option value="" disabled>Pick one…</option>
            {QUERY_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.value}</option>)}
          </select>
          <span className="block text-[11px] text-slate-400 mt-1">
            {QUERY_CATEGORIES.find((c) => c.value === value.category)?.examples
              ?? 'It is what every dispute report groups by.'}
          </span>
        </FormField>
      )}

      {/*
        AND WHERE THE CALLER IS ALREADY HOLDING THE SENTENCE, THE SECOND BOX IS NOT DRAWN.
        See wordsAskedAs. It still SAYS what those words are now carrying, because they are about
        to go to the client and somebody who wrote them as a note for themselves should know that.
      */}
      {chosen && needsWords(chosen) && wordsAskedAs && (
        <p className="text-[11px] text-slate-500">
          {value.words.trim().length < 3
            ? <span className="text-[var(--c-gold-deep)]">
              Write &ldquo;{wordsAskedAs}&rdquo; above &mdash; on this one it is what the client is
              told.
            </span>
            : chosen === 'disputed' && explanationMissing(value.category, value.words)
              ? <span className="text-[var(--c-gold-deep)]">
                &ldquo;Other&rdquo; needs more than that &mdash; say what they actually dispute in
                &ldquo;{wordsAskedAs}&rdquo; above.
              </span>
              : <>&ldquo;{wordsAskedAs}&rdquo; above is what goes to the client on this &mdash;
                written once, here and on the call.</>}
        </p>
      )}

      {needsWords(chosen) && !wordsAskedAs && (
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
