import { Link } from 'react-router-dom'
import { Card, CardHeader } from '../ui/Card'
import { RingDonut, type RingDonutSlice } from '../ui/RingDonut'
import { OUTCOME_WON, OUTCOME_OPEN, OUTCOME_REJECTED, OUTCOME_VALUE } from '../../lib/colors'
import { buildDrilldownUrl, SALES_MONTH_PARAM } from '../../lib/drilldown'
import type { Deal } from '../../types'

interface WinRateCardProps {
  /** Deals *opened* in the selected sales month — one cohort, followed to wherever it stands now. */
  cohort: Deal[]
  newLeads: number
  qualified: number
  converted: number
  periodLabel: string
  periodParam: string
}

/**
 * One cohort, followed through.
 *
 * This card used to show two rates over two different populations without saying so: the Won
 * and Rejected counts were filtered to the selected sales month while the Open count was every
 * open deal that has ever existed. The numerator and the denominator were measured over
 * different spans of time, so the percentage described nothing, and it drifted further from
 * the truth every month the pipeline grew.
 *
 * Now both rates read from one population — the deals opened in the selected month — and the
 * card says which population that is. The two rates answer genuinely different questions and
 * are named for the questions rather than both being called some kind of "win rate":
 *
 *   Pipeline Outcome Rate  — of everything we opened, how much have we actually won yet?
 *   Closed-Deal Win Rate   — of what has finished, how much did we win?
 *
 * The first is dragged down by work still in progress, which is correct: an open deal is not a
 * win. The second ignores open work entirely, which is also correct for judging closing. The
 * gap between them is how much is still in play.
 */
export function WinRateCard({ cohort, newLeads, qualified, converted, periodLabel, periodParam }: WinRateCardProps) {
  const won = cohort.filter((d) => d.stage === 'Won').length
  const lost = cohort.filter((d) => d.stage === 'Rejected').length
  const open = cohort.length - won - lost
  const total = cohort.length

  const outcomeRate = total > 0 ? Math.round((won / total) * 100) : 0
  const closedWinRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null

  const donutData: RingDonutSlice[] = [
    { name: 'Won', value: won, color: OUTCOME_WON },
    { name: 'Still open', value: open, color: OUTCOME_OPEN },
    { name: 'Rejected', value: lost, color: OUTCOME_REJECTED },
  ].filter((d) => d.value > 0)

  const bar = [
    { label: 'Won', value: won, color: OUTCOME_WON },
    { label: 'Still open', value: open, color: OUTCOME_OPEN },
    { label: 'Rejected', value: lost, color: OUTCOME_REJECTED },
  ]

  const pipeline = [
    { label: 'New Leads', value: newLeads, color: 'var(--c-steel)', bg: 'var(--tint-steel)', to: buildDrilldownUrl('/leads', { [SALES_MONTH_PARAM]: periodParam }) },
    { label: 'Hot leads', value: qualified, color: 'var(--c-green)', bg: 'var(--tint-green)', to: buildDrilldownUrl('/leads', { status: 'Hot Lead', [SALES_MONTH_PARAM]: periodParam }) },
    { label: 'Converted to Deal', value: converted, color: 'var(--c-gold-deep)', bg: 'var(--tint-gold-deep)', to: buildDrilldownUrl('/leads', { status: 'Converted', [SALES_MONTH_PARAM]: periodParam }) },
  ]

  return (
    <Card>
      <div className="flex items-start justify-between mb-4 gap-3">
        <CardHeader title="Deal Outcomes" subtitle={`The ${total} ${total === 1 ? 'deal' : 'deals'} opened in this sales month, and where they stand today`} />
        <span className="text-xs font-medium text-brand-600 bg-brand-50 px-2.5 py-1 rounded-full whitespace-nowrap shrink-0">{periodLabel}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[176px_1fr_1fr] gap-6 items-start">
        <RingDonut data={donutData} centerValue={`${outcomeRate}%`} centerColor={OUTCOME_VALUE} centerLabel="WON SO FAR" caption={`Of ${total} opened`} />

        <div className="flex flex-col gap-4">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Pipeline Outcome Rate</p>
            <p className="text-2xl font-extrabold text-slate-800 leading-tight">{outcomeRate}%</p>
            <p className="text-[11.5px] text-slate-400">Won ÷ everything opened, including work still in progress</p>
          </div>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Closed-Deal Win Rate</p>
            <p className="text-2xl font-extrabold text-slate-800 leading-tight">{closedWinRate === null ? '—' : `${closedWinRate}%`}</p>
            <p className="text-[11.5px] text-slate-400">
              {closedWinRate === null ? 'Nothing from this month has closed yet' : 'Won ÷ what has finished, ignoring open work'}
            </p>
          </div>

          {/* The split the two rates are both computed from, shown once so neither has to be
              taken on trust. */}
          {total > 0 && (
            <div>
              <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100">
                {bar
                  .filter((b) => b.value > 0)
                  .map((b) => (
                    <span key={b.label} style={{ width: `${(b.value / total) * 100}%`, backgroundColor: b.color }} title={`${b.label}: ${b.value}`} />
                  ))}
              </div>
              <div className="flex flex-wrap gap-x-3.5 gap-y-1 mt-2">
                {bar.map((b) => (
                  <span key={b.label} className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-500">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: b.color }} />
                    {b.label} <span className="font-semibold text-slate-700 tabular-nums">{b.value}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Lead pipeline, same period</span>
          {pipeline.map((p) => (
            <Link key={p.label} to={p.to} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-slate-100 hover:bg-slate-50/60">
              <span className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-extrabold shrink-0" style={{ backgroundColor: p.bg, color: p.color }}>
                {p.value}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-lg font-extrabold text-slate-800 leading-tight">{p.value}</span>
                <span className="block text-[11.5px] text-slate-400">{p.label}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100 text-xs text-slate-400 gap-3">
        <span>Both rates count only deals opened between {periodLabel} &mdash; one population, followed to today.</span>
        <Link to={buildDrilldownUrl('/deals', { view: 'table', [SALES_MONTH_PARAM]: periodParam })} className="font-semibold text-brand-600 hover:underline shrink-0">
          View all deals &rarr;
        </Link>
      </div>
    </Card>
  )
}
