import { useState } from 'react'
import { AlarmClock, Loader2 } from 'lucide-react'
import { Modal, FormField, inputClass } from '../ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { DictateButton } from '../ui/Dictate'
import { setReminder } from '../../lib/reminders.ts'
import { REMINDER_PRESETS, atClockTime, clockTime, dueAt } from '../../lib/reminderTime.ts'

/**
 * "Call me back in an hour."
 *
 * Set while the debtor is still on the phone, so the whole thing is one tap on a preset and a
 * press of Remind me. The note is optional and pre-filled, because a collector holding a handset
 * will not type a sentence and an empty reminder is still worth having.
 *
 * Each preset shows the clock time it lands on. "In an hour" and "at 15:40" are different
 * questions, and the person on the call is usually being told one while thinking in the other.
 */
export function RemindModal({ accountId, who, onClose, onSet }: {
  accountId: string
  who: string
  onClose: () => void
  onSet?: () => void
}) {
  const { currentUser } = useAuth()
  const [minutes, setMinutes] = useState<number>(60)
  const [custom, setCustom] = useState('')
  const [body, setBody] = useState(`Call ${who} back`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const at = custom ? atClockTime(custom) : dueAt(minutes)
  const customBad = custom !== '' && at === null

  async function save() {
    if (!currentUser?.id || !at) return
    setBusy(true); setError(null)
    try {
      await setReminder({
        accountId,
        ownerId: currentUser.id,
        minutes,
        at,
        body,
        createdBy: currentUser.id,
      })
      onSet?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Remind me" onClose={onClose} width={460}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {REMINDER_PRESETS.map((p) => (
            <button key={p.minutes} type="button"
              onClick={() => { setMinutes(p.minutes); setCustom('') }}
              className={`text-sm px-3 py-2 rounded-lg border transition-colors ${
                !custom && minutes === p.minutes
                  ? 'border-gold-500 bg-gold-400 text-navy-950 font-medium'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {p.label}
              <span className="block text-[11px] opacity-70 tabular-nums">
                {clockTime(dueAt(p.minutes))}
              </span>
            </button>
          ))}
        </div>

        <FormField label="Or at a time today">
          <input className={`${inputClass} max-w-[9rem]`} placeholder="15:40" value={custom}
            onChange={(e) => setCustom(e.target.value)} />
          {customBad && (
            <p className="text-[11px] text-[var(--c-rust-deep)] mt-1">
              {/* A time already gone would pop the instant it saved, which reads as a fault. */}
              Not a time later today. Use 24-hour, like 15:40.
            </p>
          )}
        </FormField>

        <FormField label="What for">
          <input className={inputClass} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="mt-1.5">
            <DictateButton size="small" value={body} onChange={setBody} />
          </div>
        </FormField>

        {error && <p className="text-sm text-negative-700">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-slate-400">
            {at ? `Pops up at ${clockTime(at)}, on whatever page you are on.` : 'Pick a time.'}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-2">
              Cancel
            </button>
            <button type="button" onClick={() => void save()} disabled={busy || !at}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900 disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <AlarmClock size={14} />}
              Remind me
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
