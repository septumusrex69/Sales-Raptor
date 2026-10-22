import { CalendarClock } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { longDate } from './DiaryDatePicker'
import type { LeavingAsk } from '../../lib/leavingAccount.ts'

/**
 * THE QUESTION AT THE DOOR, when somebody leaves their own worked account (leavingAsk).
 *
 *   must     no way past but a date after today. "Stay" is the only other button: a modal that
 *            can be closed into the next screen is the bar that already existed, and the firm
 *            asked for more than that.
 *   confirm  keep the date it has (the default, one tap) or move it.
 */
export function LeaveDiaryGate({ ask, dueOn, today, onKeep, onMove, onStay }: {
  ask: Exclude<LeavingAsk, 'none'>
  /** The account's own diary date, or null where it has none. */
  dueOn: string | null
  today: string
  onKeep: () => void
  onMove: () => void
  onStay: () => void
}) {
  const said = ask === 'confirm' && dueOn
    ? `It comes back on ${longDate(dueOn)}. Keep it there, or move it?`
    : !dueOn
      ? 'It has no day to come back on. Give it one before you go.'
      : dueOn < today
        ? `Its diary date, ${longDate(dueOn)}, has gone. Give it a day after today before you go.`
        : 'It is on today’s diary, and you have just worked it. Give it a day after today before you go.'
  return (
    <Modal title="Before you leave this account" onClose={onStay} width={460}>
      <div className="space-y-4" data-testid="leave-gate" data-ask={ask}>
        <p className="text-sm text-slate-700">You worked this account. {said}</p>
        <div className="flex flex-wrap items-center gap-2">
          {ask === 'confirm' && dueOn && (
            <button type="button" onClick={onKeep} data-testid="leave-keep"
              className="text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900">
              Keep {longDate(dueOn)}
            </button>
          )}
          <button type="button" onClick={onMove} data-testid="leave-move"
            className={`inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg ${
              ask === 'must' ? 'bg-navy-950 text-white hover:bg-navy-900' : 'border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
            <CalendarClock size={14} /> {ask === 'must' ? 'Choose a date' : 'Move it'}
          </button>
          <button type="button" onClick={onStay} data-testid="leave-stay"
            className="text-sm text-slate-500 hover:text-slate-700 px-2">
            Stay on the account
          </button>
        </div>
      </div>
    </Modal>
  )
}
