import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlarmClock, Check, Clock, Loader2 } from 'lucide-react'
import { useAuth } from '../../store/AuthContext'
import {
  completeReminder, fetchDue, reminderWho, snoozeReminder, type Reminder,
} from '../../lib/reminders.ts'
import { SNOOZE_MINUTES, lateness } from '../../lib/reminderTime.ts'

/** How often to look. The polling interval is this feature's real resolution, not the clock. */
const EVERY_MS = 30_000

/**
 * The thing that actually interrupts you.
 *
 * Mounted once, around every signed-in page, because a reminder that only appears on the account
 * it belongs to is no reminder at all — the whole point is that you are somewhere else by then.
 *
 * IT DOES NOT GO AWAY BY ITSELF, and that is the feature. A debtor was told a time and somebody
 * has to either do it or say they are not doing it yet. So there are three ways out and all of
 * them are a decision: done, pushed back ten minutes, or open the account (which pushes it back
 * five, so it does not nag while you dial but still returns if you get pulled away). Closing the
 * box is the same as pushing it back — it cannot be dismissed into nothing.
 *
 * Polling rather than a realtime subscription. Thirty seconds is well inside the tolerance of
 * something a person set in whole minutes, it survives a dropped socket without any reconnection
 * logic, and it costs one indexed query per agent per half minute.
 */
export function ReminderWatcher() {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const [due, setDue] = useState<Reminder[]>([])
  const [busy, setBusy] = useState(false)

  const look = useCallback(async () => {
    if (!currentUser?.id) { setDue([]); return }
    try {
      setDue(await fetchDue(currentUser.id))
    } catch {
      // A watcher that cannot reach the database keeps whatever it last knew and tries again.
    }
  }, [currentUser?.id])

  useEffect(() => {
    void look()
    const timer = window.setInterval(() => { void look() }, EVERY_MS)
    return () => window.clearInterval(timer)
  }, [look])

  // Oldest first: the one that has been waiting longest is the one owed an answer.
  const top = due[0]
  if (!top) return null

  const act = async (run: () => Promise<void>) => {
    setBusy(true)
    try {
      await run()
      setDue((rest) => rest.filter((r) => r.id !== top.id))
    } catch {
      // Left on screen deliberately. A reminder that silently failed to close is better than
      // one that disappears without being recorded as done.
    } finally {
      setBusy(false)
    }
  }

  const who = reminderWho(top)
  const late = lateness(new Date(top.dueAt))

  return (
    /*
     * Its own overlay rather than the shared Modal, for one reason: Modal closes on the backdrop
     * and on Escape, and this must not vanish because somebody tapped past it.
     */
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-5 py-3 bg-navy-950 text-white">
          <AlarmClock size={16} className="text-gold-400" />
          <p className="text-sm font-semibold">Reminder</p>
          <span className="ml-auto text-[11px] text-slate-300">
            {late === 'now' ? 'due now' : `due ${late}`}
          </span>
        </div>

        <div className="px-5 py-4">
          <p className="text-base text-navy-950">{top.body}</p>
          <p className="text-sm text-slate-500 mt-1">{who}</p>
          {top.snoozes > 0 && (
            <p className="text-[11px] text-[var(--c-gold-dark)] mt-2">
              Pushed back {top.snoozes} time{top.snoozes === 1 ? '' : 's'} already.
            </p>
          )}
          {due.length > 1 && (
            <p className="text-[11px] text-slate-400 mt-2">
              {due.length - 1} more waiting behind this one.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button
            disabled={busy}
            onClick={() => void act(async () => {
              // Five minutes rather than ten: you are about to do it, not putting it off.
              await snoozeReminder(top.id, top.snoozes, 5)
              navigate(`/accounts/${top.accountId}`)
            })}
            className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-50">
            Open the account
          </button>
          <button
            disabled={busy}
            onClick={() => void act(() => snoozeReminder(top.id, top.snoozes))}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-50">
            <Clock size={14} /> {SNOOZE_MINUTES} more minutes
          </button>
          <button
            disabled={busy}
            onClick={() => void act(() => completeReminder(top.id))}
            className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
