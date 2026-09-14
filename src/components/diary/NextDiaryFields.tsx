import { FormField, inputClass } from '../ui/Modal'
import { DiaryDatePicker, longDate } from './DiaryDatePicker'
import { CIRCULATION_EXITS, type CirculationExit } from '../../lib/diary.ts'
import { DIARY_KINDS, DIARY_KIND_ORDER, type DiaryKind } from '../../lib/diaryPriority.ts'
import { DictateButton } from '../ui/Dictate'
import { appendSpeech } from '../../lib/dictation.ts'

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
 */
export interface NextPlan {
  comesBack: boolean
  dueOn: string
  kind: DiaryKind
  exit: CirculationExit
  note: string
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

          <FormField label="What kind of work">
            <select value={plan.kind} onChange={(e) => set({ kind: e.target.value as DiaryKind })} className={inputClass}>
              {DIARY_KIND_ORDER.map((k) => <option key={k} value={k}>{DIARY_KINDS[k].label}</option>)}
            </select>
            <span className="block text-[11px] text-slate-400 mt-1.5">{DIARY_KINDS[plan.kind].why}</span>
          </FormField>
        </>
      ) : (
        <FormField label="Why it is leaving the book" required>
          <select value={plan.exit} onChange={(e) => set({ exit: e.target.value as CirculationExit })} className={inputClass}>
            {CIRCULATION_EXITS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </FormField>
      )}

      {/*
        Optional, at the firm's instruction — it used to be a required "Why", and sometimes there
        is genuinely nothing to add beyond the date. Where somebody does write one it lands on the
        account's timeline as well as on the diary entry, so it is findable by whoever reads the
        account six months from now rather than only by whoever reads the diary.
      */}
      <FormField label="Note">
        <input value={plan.note} onChange={(e) => set({ note: e.target.value })}
          placeholder={plan.comesBack ? 'Insurance pays out on the 28th — check it landed.' : 'Settlement received 12 September.'}
          className={inputClass} />
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          {/* Talk it instead of typing it. Free, built into the browser — see Dictate.tsx. */}
          <DictateButton size="small" onText={(said) => set({ note: appendSpeech(plan.note, said) })} />
          <span className="text-[11px] text-slate-400">
            Goes on the account&rsquo;s timeline as well as the diary.
          </span>
        </div>
      </FormField>

      {/*
        The escape hatch, phrased as what it is rather than as an unchecked box. "Bring this
        account back" with a tick in it invites somebody to untick it to save ten seconds; this
        says out loud that untick means the account has stopped being collectable.
      */}
      <label className="flex items-start gap-2 text-sm text-slate-600 pt-1">
        <input type="checkbox" checked={!plan.comesBack}
          onChange={(e) => set({ comesBack: !e.target.checked })}
          className="rounded border-slate-300 mt-0.5" />
        <span>
          This account is finished and leaves the diary for good
          <span className="block text-[11px] text-slate-400">
            Only for an account with nothing left to collect. Everything else comes back.
          </span>
        </span>
      </label>
    </div>
  )
}

/** A sensible starting plan: back in a week's working days, same kind of work as last time. */
export function initialPlan(kind: DiaryKind, dueOn: string): NextPlan {
  return { comesBack: true, dueOn, kind, exit: 'paid', note: '' }
}
