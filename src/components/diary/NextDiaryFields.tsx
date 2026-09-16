import { FormField, inputClass } from '../ui/Modal'
import { DiaryDatePicker, longDate } from './DiaryDatePicker'
import { type CirculationExit } from '../../lib/diary.ts'
import { DIARY_KINDS, DIARY_KIND_ORDER, type DiaryKind } from '../../lib/diaryPriority.ts'

/**
 * "What happens to this account next" — asked the same way wherever an entry is closed.
 *
 * Shared between the day list's Done button and the work loop's Done & next, because they are
 * the same act and two copies of this question would drift into two different rules.
 *
 * THE ACCOUNT ALWAYS COMES BACK. That is the firm's rule and it is the default here: a date is
 * already chosen when the box opens, and the only way past it is to say the account has left the
 * book for one of five stated reasons. Working an entry finishes an APPOINTMENT; the debt is
 * still owed, and an account nobody is booked to ring again is one that goes quiet. Three
 * hundred and fifty-five of them arrived from the old system in precisely that state.
 *
 * THERE IS NO NOTE HERE, and there used to be. Asking "what came of it" at the top of the box
 * and "a note" at the bottom is asking the same question twice, and the firm said so: a person
 * who has just written two sentences about a phone call has nothing left to put in a second box,
 * so it gets a full stop in it or gets left blank. One note, above, and it carries.
 */
export interface NextPlan {
  comesBack: boolean
  dueOn: string
  kind: DiaryKind
  exit: CirculationExit
}

export function NextDiaryFields({ plan, onChange, ownerId, capacity, today, prescriptionDate }: {
  plan: NextPlan
  onChange: (next: NextPlan) => void
  ownerId: string | null
  capacity: number | null
  today: string
  prescriptionDate: string | null
}) {
  const set = (patch: Partial<NextPlan>) => onChange({ ...plan, ...patch })

  return (
    <div className="space-y-3">
      {plan.comesBack ? (
        <>
          {/*
            WHAT, THEN WHEN, and it was the other way round. The firm reads the box downwards as
            one sentence — where the account stands, what came of it, what to do next, and only
            then which day — and the kind is mostly already decided for you by the position, so
            it sits with the things that set it rather than after the calendar.
          */}
          <FormField label="What kind of work next">
            <select value={plan.kind} onChange={(e) => set({ kind: e.target.value as DiaryKind })} className={inputClass}>
              {DIARY_KIND_ORDER.map((k) => <option key={k} value={k}>{DIARY_KINDS[k].label}</option>)}
            </select>
            <span className="block text-[11px] text-slate-400 mt-1.5">{DIARY_KINDS[plan.kind].why}</span>
          </FormField>

          <div>
            <span className="block text-xs font-medium text-slate-500 mb-1.5">When it comes back</span>
            <DiaryDatePicker
              ownerId={ownerId}
              capacity={capacity}
              value={plan.dueOn}
              onChange={(dueOn) => set({ dueOn })}
              today={today}
            />
          </div>

          {prescriptionDate && plan.dueOn > prescriptionDate && (
            <p className="text-xs text-[var(--c-rust-deep)]">
              This account prescribes on {longDate(prescriptionDate)} — before that day. By then it
              cannot be enforced.
            </p>
          )}
        </>
      ) : (
        /*
         * Unreachable from here, and that is the point.
         *
         * AN AGENT CANNOT TAKE AN ACCOUNT OUT OF THE DIARY. The firm was plain about it: an
         * account is closed by management or withdrawn by the client, and every exit behind this
         * picker — paid in full, written off, handed to the attorneys, withdrawn, prescribed —
         * is somebody else's decision or a fact about the balance. None of them is the
         * collector's call, so the tick that reached them is gone.
         *
         * The branch stays because workEntry still takes an exit and the management action that
         * will use it is the other half of this work. What it no longer has is a way in from an
         * agent's screen.
         */
        null
      )}
    </div>
  )
}

/** A sensible starting plan: back in a week's working days, same kind of work as last time. */
export function initialPlan(kind: DiaryKind, dueOn: string): NextPlan {
  return { comesBack: true, dueOn, kind, exit: 'paid' }
}
