import { Link } from 'react-router-dom'
import { Card, CardHeader } from '../ui/Card'
import { RingDonut, type RingDonutSlice } from '../ui/RingDonut'
import { OUTCOME_OPEN, OUTCOME_VALUE, OUTCOME_WON } from '../../lib/colors'
import { buildDrilldownUrl, SALES_MONTH_PARAM } from '../../lib/drilldown'
import { formatCurrency } from '../../data/mockData'

/**
 * THE MONTH'S MANDATES, IN THE SHAPE OF DEAL OUTCOMES (the firm, 18 Oct: "I like that deal outcomes
 * thing. If we can make something like that ... instead of ... leads, mandate signed, closing rate,
 * handed over by new clients"). The ring is the closing rate -- mandates signed against leads created
 * this month -- the middle says it in words with the split under it, and the right-hand column is the
 * three counts the four tiles used to carry, each a way into its list.
 */
export function MandateOutcomeCard({ leads, mandates, closingRate, newAccounts, newCapital, loadingHandovers, periodLabel, periodParam }: {
  leads: number
  mandates: number
  closingRate: number | null
  newAccounts: number
  newCapital: number
  loadingHandovers: boolean
  periodLabel: string
  periodParam: string
}) {
  const unsigned = Math.max(0, leads - mandates)
  const donut: RingDonutSlice[] = [
    { name: 'Signed', value: mandates, color: OUTCOME_WON },
    { name: 'Not signed', value: unsigned, color: OUTCOME_OPEN },
  ].filter((d) => d.value > 0)
  const rows = [
    { label: 'Leads created', value: leads.toLocaleString('en-ZA'), color: 'var(--c-steel)', bg: 'var(--tint-steel)', to: buildDrilldownUrl('/leads', { [SALES_MONTH_PARAM]: periodParam }) },
    { label: 'Mandates signed', value: mandates.toLocaleString('en-ZA'), color: 'var(--c-green)', bg: 'var(--tint-green)', to: buildDrilldownUrl('/deals', { stage: 'Won', service: 'Debt Collection', view: 'table', [SALES_MONTH_PARAM]: periodParam }) },
    { label: 'Handed over by new clients', value: loadingHandovers ? '…' : `${newAccounts.toLocaleString('en-ZA')} · ${formatCurrency(newCapital)}`, color: 'var(--c-gold-deep)', bg: 'var(--tint-gold-deep)', to: '/accounts' },
  ]
  return (
    <Card className="h-full">
      <div data-testid="mandate-outcomes">
        <div className="mb-4 flex items-start justify-between gap-3">
          <CardHeader title="Mandates" subtitle="Debt-collection mandates signed against the leads created, and the work new clients sent" />
          <span className="shrink-0 whitespace-nowrap rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-600">{periodLabel}</span>
        </div>
        {/* RING AND THREE FIGURES, nothing between them: the card sits beside Deal outcomes (the firm,
            18 Oct: "fit these guys in next to each other"), and the words that stood in the middle
            said again what the ring and the figures already say. */}
        <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-[176px_1fr]">
          <RingDonut data={donut} centerValue={closingRate === null ? '—' : `${closingRate}%`} centerColor={OUTCOME_VALUE} centerLabel="CLOSING RATE" caption={`Of ${leads} ${leads === 1 ? 'lead' : 'leads'}`} />
          <div className="flex flex-col gap-2.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{periodLabel}</span>
            {rows.map((r) => (
              <Link key={r.label} to={r.to} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3.5 py-2.5 hover:bg-slate-50/60">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-extrabold leading-tight text-slate-800">{r.value}</span>
                  <span className="block text-[11.5px] text-slate-400">{r.label}</span>
                </span>
              </Link>
            ))}
            <p className="text-[11.5px] text-slate-400">Closing rate: mandates signed ÷ leads created, in the same month.</p>
          </div>
        </div>
      </div>
    </Card>
  )
}
