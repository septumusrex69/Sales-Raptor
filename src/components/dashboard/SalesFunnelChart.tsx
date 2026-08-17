import { Link } from 'react-router-dom'
import { Card, CardHeader } from '../ui/Card'
import { FUNNEL_STAGES, FUNNEL_COLORS } from '../../lib/colors'
import { buildDrilldownUrl } from '../../lib/drilldown'
import type { Deal } from '../../types'

/**
 * Deal.stage is mutated in place with no per-transition history, so this
 * is always a current-state snapshot regardless of the dashboard's
 * selected Sales Month — true historical funnel reconstruction needs a
 * stage-history array (deferred, see the Phase 1 plan).
 *
 * Because it's a snapshot, "count at this stage" doesn't shrink stage over
 * stage on its own (deals pile up further down the pipeline as they
 * progress). To read as an actual funnel, each stage is shown as "at this
 * stage or further" — a cumulative count from the current stage order —
 * which is monotonically non-increasing, so conversion between stages
 * stays a sane 0–100%.
 */
export function SalesFunnelChart({ deals }: { deals: Deal[] }) {
  const perStageCount = FUNNEL_STAGES.map((stage) => deals.filter((d) => d.stage === stage).length)
  const cumulative = perStageCount.map((_, i) => perStageCount.slice(i).reduce((s, c) => s + c, 0))
  const total = cumulative[0] || 1

  return (
    <Card>
      <CardHeader title="Sales Funnel" subtitle="Deals at this stage or further — as of today" />
      <div className="space-y-2">
        {FUNNEL_STAGES.map((stage, i) => {
          const count = cumulative[i]
          const prevCount = i === 0 ? count : cumulative[i - 1]
          const stageConversion = i === 0 ? undefined : prevCount > 0 ? Math.round((count / prevCount) * 100) : 0
          const shareOfTotal = Math.round((count / total) * 100)
          const widthPct = Math.max((count / total) * 100, 4)
          return (
            <Link key={stage} to={buildDrilldownUrl('/deals', { stage, atLeast: '1', view: 'table' })} className="flex items-center gap-3 group">
              <span className="w-28 text-xs font-medium text-slate-500 shrink-0 group-hover:text-slate-700">{stage}</span>
              <div className="flex-1 bg-slate-50 rounded-md h-8 relative overflow-hidden">
                <div
                  className="h-full rounded-md flex items-center justify-end px-2.5 transition-all"
                  style={{ width: `${widthPct}%`, backgroundColor: FUNNEL_COLORS[i] }}
                >
                  <span className="text-white text-xs font-semibold">{count}</span>
                </div>
              </div>
              <span className="w-10 text-xs text-slate-400 text-right shrink-0">{shareOfTotal}%</span>
              <span className="w-16 text-[11px] text-slate-400 text-right shrink-0">{stageConversion === undefined ? '—' : `${stageConversion}% conv.`}</span>
            </Link>
          )
        })}
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 text-xs">
        <span className="text-slate-500">Overall Conversion: New Lead → Won</span>
        <span className="font-semibold text-slate-700">{total > 0 ? Math.round((cumulative[cumulative.length - 1] / total) * 100) : 0}%</span>
      </div>
    </Card>
  )
}
