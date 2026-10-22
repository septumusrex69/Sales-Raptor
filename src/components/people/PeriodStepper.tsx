import { controlClass } from '../ui/Modal'
import { periodLabel, periodRange, shiftPeriod } from '../../lib/clerkCommission.ts'

/**
 * THE PAY PERIOD, ONE AT A TIME: the firm's collections month, the 11th to the 10th, named after the
 * month it ends in -- the same month the floor's "collected" is counted in. The range is printed
 * under the name so nobody reads "October" as the calendar month.
 */
export function PeriodStepper({ value, onChange, latest }: {
  value: string
  onChange: (key: string) => void
  /** The current period: nothing later is offered, because a period not begun has nothing in it. */
  latest: string
}) {
  return (
    <div className="flex items-center gap-2" data-testid="pay-period">
      <button type="button" onClick={() => onChange(shiftPeriod(value, -1))} className={controlClass}>Earlier</button>
      <div className="text-center min-w-[11rem]">
        <div className="text-sm font-medium text-slate-700" data-testid="pay-period-label">{periodLabel(value)}</div>
        <div className="text-[11px] text-slate-400">{periodRange(value)}</div>
      </div>
      <button type="button" onClick={() => onChange(shiftPeriod(value, 1))} disabled={value >= latest}
        className={`${controlClass} disabled:opacity-40`}>Later</button>
    </div>
  )
}
