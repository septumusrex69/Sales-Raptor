import { Card, CardHeader } from '../ui/Card'
import { OUTCOME_WON } from '../../lib/colors'

interface Split {
  label: string
  hint: string
  rate: number | null
  closed: number
}

/**
 * Win rate, split by what winning actually means.
 *
 * A service deal is won when a quotation is accepted; a handover is won when a mandate is
 * signed. They convert at different rates for different reasons, so a single blended figure
 * describes neither — and the blend moves whenever the mix of work changes, which reads as a
 * performance change when nothing about performance changed.
 */
export function WinRateByKind({
  serviceWinRate,
  serviceClosed,
  handoverWinRate,
  handoverClosed,
  periodLabel,
}: {
  serviceWinRate: number | null
  serviceClosed: number
  handoverWinRate: number | null
  handoverClosed: number
  periodLabel: string
}) {
  const splits: Split[] = [
    { label: 'Services', hint: 'Quotation accepted', rate: serviceWinRate, closed: serviceClosed },
    { label: 'Handovers', hint: 'Mandate signed', rate: handoverWinRate, closed: handoverClosed },
  ]

  return (
    <Card>
      <CardHeader title="Win Rate by Type" subtitle={periodLabel} />
      <div className="space-y-4">
        {splits.map((s) => (
          <div key={s.label}>
            <div className="flex items-baseline justify-between gap-3 mb-1.5">
              <span className="text-[13px] font-medium text-slate-600">
                {s.label}
                <span className="ml-2 text-[11.5px] font-normal text-slate-400">{s.hint}</span>
              </span>
              <span className="text-[15px] font-bold text-slate-800 tabular-nums shrink-0">
                {s.rate === null ? '—' : `${s.rate}%`}
              </span>
            </div>
            <div className="h-2 rounded-full bg-[var(--tint-steel-alt)] overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${s.rate ?? 0}%`, backgroundColor: OUTCOME_WON }} />
            </div>
            <p className="text-[11.5px] text-slate-400 mt-1">
              {s.closed === 0 ? 'Nothing closed in this period' : `${s.closed} closed`}
            </p>
          </div>
        ))}
      </div>
    </Card>
  )
}
