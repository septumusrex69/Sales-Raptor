import { useMemo, useState } from 'react'
import { CalendarClock, Loader2 } from 'lucide-react'
import { Modal, FormField, inputClass } from '../ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { useAppStore } from '../../store/AppStore'
import { DiaryDatePicker, longDate, shortDate } from './DiaryDatePicker'
import { bulkMove, moveEntry, debtorName, type DiaryRow } from '../../lib/diary.ts'
import { DEFAULT_DIARY_CAPACITY, planSpread } from '../../lib/diaryPriority.ts'
import { addWorkingDays } from '../../lib/workingDays.ts'
import { DictateButton } from '../ui/Dictate'

/**
 * Move work that was missed onto days somebody can actually do it.
 *
 * The same box handles one entry and two hundred, because they are the same act and the
 * difference is only whether it needs spreading.
 *
 * TWO THINGS ARE DELIBERATE AND BOTH ARE ABOUT HONESTY.
 *
 * A move does not edit the entry. It closes the original — which keeps the date it was always
 * due — and writes a new one. So "this was booked for 4 September, nobody worked it, Meloney
 * moved it on the 14th because Ruben was booked off" survives as a fact. The system this
 * replaces moved the date in place, which is exactly why nobody there can say how much work was
 * missed last year.
 *
 * And a pile is spread across a run of working days rather than dumped on one. Dumping is what
 * caused the problem: an agent arrived from the old system with 44 accounts diarised onto a
 * single date and not one of them worked.
 */
export function MoveDiaryModal({ entries, ownerId, capacity, onClose, onDone }: {
  entries: DiaryRow[]
  /** Whose diary they are in now. */
  ownerId: string | null
  capacity: number | null
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const { currentUser } = useAuth()
  const { users } = useAppStore()

  const today = new Date().toISOString().slice(0, 10)
  const bulk = entries.length > 1

  const [startOn, setStartOn] = useState(() => addWorkingDays(today, 1))
  const [toOwner, setToOwner] = useState<string | null>(ownerId)
  const [perDay, setPerDay] = useState(capacity && capacity > 0 ? capacity : DEFAULT_DIARY_CAPACITY)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ moved: number; failed: number } | null>(null)

  const plan = useMemo(
    () => planSpread(entries.length, startOn, perDay),
    [entries.length, startOn, perDay],
  )

  async function save() {
    setBusy(true); setError(null)
    const actor = { id: currentUser?.id ?? null, name: currentUser?.name ?? null }
    try {
      if (bulk) {
        const r = await bulkMove({
          entries, days: plan.days, perDay: plan.perDay,
          ownerId: toOwner, reason, actor,
        })
        setResult({ moved: r.moved, failed: r.failed.length })
        await onDone()
      } else {
        await moveEntry({ entry: entries[0], dueOn: startOn, reason, alsoNoteOnAccount: true, actor })
        await onDone()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <Modal title="Moved" onClose={onClose} width={460}>
        <p className="text-sm text-slate-700">
          {result.moved} account{result.moved === 1 ? '' : 's'} moved onto {plan.days.length}{' '}
          working day{plan.days.length === 1 ? '' : 's'}, from {shortDate(plan.days[0])}.
        </p>
        {result.failed > 0 && (
          <p className="text-sm text-[var(--c-rust)] mt-2">
            {result.failed} could not be moved and are still where they were.
          </p>
        )}
        <div className="flex justify-end mt-5">
          <button onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900">
            Done
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={bulk ? `Re-diarise ${entries.length} accounts` : 'Move this to another day'} onClose={onClose} width={560}>
      <div className="space-y-4">
        {!bulk && (
          <p className="text-sm text-slate-600">
            {debtorName(entries[0])} — was due {longDate(entries[0].dueOn)}.
          </p>
        )}

        <div>
          <span className="block text-xs font-medium text-slate-500 mb-1.5">
            {bulk ? 'Starting from' : 'New day'}
          </span>
          <DiaryDatePicker
            ownerId={toOwner}
            capacity={toOwner === ownerId ? capacity : users.find((u) => u.id === toOwner)?.diaryCapacity ?? null}
            value={startOn}
            onChange={setStartOn}
            today={today}
          />
        </div>

        {bulk && (
          <>
            <FormField label="How many a day">
              <input type="number" min={1} max={200} value={perDay}
                onChange={(e) => setPerDay(Math.max(1, Number(e.target.value) || 1))}
                className={inputClass} />
            </FormField>

            {/*
              The plan, in a sentence, before anything happens. Two hundred records is too many
              to undo by hand, so the box has to be disagreeable-with before it is pressed.
            */}
            <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2.5">
              {entries.length} accounts across{' '}
              <span className="font-medium">{plan.days.length} working day{plan.days.length === 1 ? '' : 's'}</span>
              {' '}— {shortDate(plan.days[0])} to {shortDate(plan.days[plan.days.length - 1])}, {plan.perDay} a day
              {plan.onLastDay !== plan.perDay && plan.days.length > 1 && <> and {plan.onLastDay} on the last</>}.
              {' '}Weekends and public holidays are skipped.
            </p>
          </>
        )}

        {/*
          ONLY ON A BULK MOVE.

          A single move keeps the entry where it is, at the firm's instruction: one person does
          not put work into another person's diary, and work that belongs to somebody else moves
          by escalation, which is a different act with its own record.

          The clerk's tool is the deliberate exception, because covering an absent agent's day is
          the entire reason it exists — that is a management action on a whole diary, not one
          collector quietly handing an awkward account to a colleague.
        */}
        {bulk && users.length > 1 && (
          <FormField label="Into whose diary">
            <select value={toOwner ?? ''} onChange={(e) => setToOwner(e.target.value || null)} className={inputClass}>
              <option value="">Leave them where they are</option>
              {users.filter((u) => u.status === 'Active').map((u) => (
                <option key={u.id} value={u.id}>{u.id === currentUser?.id ? `${u.name} (me)` : u.name}</option>
              ))}
            </select>
          </FormField>
        )}

        {/*
          Optional, at the firm's instruction. Sometimes moving a day IS the whole thought. Where
          somebody writes one on a SINGLE move it lands on that account's timeline too; a bulk
          move does not, because "Ruben booked off" is a fact about a person's week and writing it
          onto two hundred debtors' histories is noise, not a record.
        */}
        <FormField label="Note">
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={bulk ? 'Ruben booked off — covering his diary.' : 'Debtor asked for another week.'}
            className={inputClass} />
          {/* Talk it instead of typing it. Free, built into the browser — see Dictate.tsx. */}
          <div className="mt-1.5">
            <DictateButton size="small" value={reason} onChange={setReason} />
          </div>
          {!bulk && (
            <span className="block text-[11px] text-slate-400 mt-1.5">
              Goes on the account&rsquo;s timeline as well as the diary.
            </span>
          )}
        </FormField>

        {/*
          The thing people will be least expecting, so it is stated rather than left to be
          discovered when a report does not say what they assumed.
        */}
        <p className="text-xs text-slate-400">
          The original entr{bulk ? 'ies keep their' : 'y keeps its'} date and record that{' '}
          {bulk ? 'they were' : 'it was'} moved, by whom, and why. Nothing is rewritten.
        </p>

        {error && <p className="text-sm text-negative-700">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-2">
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={busy}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />}
            {bulk ? `Move all ${entries.length}` : 'Move it'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
