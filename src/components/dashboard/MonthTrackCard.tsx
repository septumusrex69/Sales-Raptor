import { useState } from 'react'
import clsx from 'clsx'
import { Bar, CartesianGrid, ComposedChart, LabelList, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardHeader } from '../ui/Card'
import type { MonthTrack } from '../../lib/clientBook'

/**
 * THE TRACK RECORD, MONTH BY MONTH (the firm, 18 Oct: "two colors in the same staff ... for a year or 6
 * months ... interchangeable ... possibly show the closing rate for the previous months").
 *
 * Three readings of the same months, chosen by `kind`:
 *   - 'pipeline': one bar a month, its height the leads, filled from the bottom by the mandates signed
 *     (the share filled is the closing rate, printed above it); lines for leads and mandates on a switch;
 *   - 'new':      handovers from NEW clients (Sales' work), accounts or rand;
 *   - 'existing': handovers from EXISTING clients (Communications' work), accounts or rand.
 * The months are handed in; the 6 / 12 switch tells the page how many to work out.
 */
/** The closing rate printed over each month. */
const RATE_LABEL = { fontSize: 10, fontWeight: 600, fill: 'var(--color-slate-600)' } as const

export function MonthTrackCard({ kind, rows, months, onMonths, title, subtitle, testId }: {
  kind: 'pipeline' | 'new' | 'existing'
  rows: MonthTrack[]
  months: 6 | 12
  onMonths: (m: 6 | 12) => void
  title: string
  subtitle: string
  testId: string
}) {
  const [measure, setMeasure] = useState<'accounts' | 'capital'>('accounts')
  /*
   * BARS, LINES OR BOTH (the firm, 18 Oct: "you can be able to remove the line graph, or you can only
   * see the line graph ... connecting those dots on the mandates signed or on the amount of leads").
   */
  const [show, setShow] = useState<'bars' | 'both' | 'lines'>('bars')
  const bars = show !== 'lines'
  const lines = show !== 'bars'
  const money = kind !== 'pipeline' && measure === 'capital'
  const fmt = (v: number) => money ? shortRand(v) : v.toLocaleString('en-ZA')
  const data = rows.map((r) => ({
    ...r,
    value: kind === 'new' ? (money ? r.newCapital : r.newAccounts) : kind === 'existing' ? (money ? r.existingCapital : r.existingAccounts) : 0,
    /*
     * ONE BAR A MONTH, FILLED FROM THE BOTTOM BY WHAT WAS SIGNED (the firm, 18 Oct, colouring it in on
     * the screenshot: "30 mandates ... and a certain percentage is colored in which was signed. So from
     * the bottom up"). The bar's height is the leads; the navy part is the mandates, the gold the leads
     * that did not sign that month -- so the two stack to the leads and the share filled IS the closing
     * rate. A month with more mandates than leads (signed from earlier months' leads) is all navy.
     */
    unsigned: Math.max(0, r.leads - r.mandates),
    rateLabel: r.closingRate === null ? '' : `${r.closingRate}%`,
  }))
  return (
    <Card>
      <div data-testid={testId}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardHeader title={title} subtitle={subtitle} />
          <div className="flex items-center gap-2">
            {kind !== 'pipeline' && <Switch options={[['accounts', 'Accounts'], ['capital', 'Rand']]} value={measure} onChange={setMeasure} name={`${testId}-measure`} />}
            <Switch options={[['bars', 'Bars'], ['both', 'Both'], ['lines', 'Line']]} value={show} onChange={setShow} name={`${testId}-show`} />
            <Switch options={[[6, '6 months'], [12, '12 months']]} value={months} onChange={onMonths} name={`${testId}-months`} />
          </div>
        </div>
        {/* SMALLER (the firm: "the charts are too big ... taking up a lot of space"). */}
        <div className="h-44 [&_*:focus]:outline-none">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} accessibilityLayer={false} margin={{ top: 14, right: 4, bottom: 0, left: money ? -4 : -18 }}>
              <CartesianGrid vertical={false} stroke="var(--color-slate-100)" />
              <XAxis dataKey="short" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11, fill: 'var(--color-slate-400)' }} />
              {/* HEADROOM over the tallest bar, so the closing rate printed on top of it is never cut or
                  crowded (the firm circled an 18% sitting on the chart's ceiling, 18 Oct). */}
              <YAxis yAxisId="n" allowDecimals={false} tickLine={false} axisLine={false} width={money ? 52 : 40}
                domain={[0, (max: number) => (max > 0 ? Math.ceil(max * 1.25) : 4)]}
                tickFormatter={fmt} tick={{ fontSize: 10, fill: 'var(--color-slate-400)' }} />
              <Tooltip cursor={{ fill: 'var(--color-slate-50)' }}
                content={({ active, payload }) => {
                  const r = payload?.[0]?.payload as (MonthTrack & { value: number }) | undefined
                  if (!active || !r) return null
                  return (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                      <div className="font-semibold text-slate-800">{r.label}</div>
                      {kind === 'pipeline' ? <>
                        <div className="text-slate-600">{r.leads} leads · {r.mandates} mandates signed</div>
                        <div className="text-slate-500">Closing rate {r.closingRate === null ? '—' : `${r.closingRate}%`}</div>
                      </> : <div className="text-slate-600">{money ? rand0(r.value) : `${r.value} accounts`} handed over</div>}
                    </div>
                  )
                }} />
              {kind === 'pipeline' && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
              {kind === 'pipeline' ? <>
                {bars && <Bar yAxisId="n" dataKey="mandates" stackId="m" name="Mandates signed" fill="var(--color-navy-700)" legendType="circle" isAnimationActive={false} />}
                {bars && (
                  <Bar yAxisId="n" dataKey="unsigned" stackId="m" name="Leads not signed" fill="var(--color-gold-300)" legendType="circle" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {/* The closing rate over each bar: the share of it filled navy. Only while no line is
                        drawn -- the leads line runs exactly along the bar tops, and a label there sat on
                        it (the firm circled it, 18 Oct). With a line it rides on the line instead. */}
                    {!lines && <LabelList dataKey="rateLabel" position="top" offset={6} style={RATE_LABEL} />}
                  </Bar>
                )}
                {lines && (
                  <Line yAxisId="n" dataKey="leads" name="Leads" stroke="var(--color-gold-600)" strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false}>
                    {/* Clear of the dot and the line through it, never on them. */}
                    <LabelList dataKey="rateLabel" position="top" offset={11} style={RATE_LABEL} />
                  </Line>
                )}
                {lines && <Line yAxisId="n" dataKey="mandates" name="Mandates" stroke="var(--color-navy-900)" strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />}
              </> : <>
                {bars && <Bar yAxisId="n" dataKey="value" name={kind === 'new' ? 'From new clients' : 'From existing clients'}
                  fill={kind === 'new' ? 'var(--color-navy-700)' : 'var(--color-gold-400)'} radius={[3, 3, 0, 0]} isAnimationActive={false} />}
                {lines && <Line yAxisId="n" dataKey="value" name="Trend" stroke={kind === 'new' ? 'var(--color-navy-900)' : 'var(--color-gold-600)'}
                  strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />}
              </>}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  )
}

function Switch<T extends string | number>({ options, value, onChange, name }: {
  options: readonly (readonly [T, string])[]
  value: T
  onChange: (v: T) => void
  name: string
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-[11px]" role="radiogroup" aria-label={name}>
      {options.map(([v, label]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} data-testid={`${name}-${v}`}
          onClick={() => onChange(v)}
          className={clsx('rounded-md px-2 py-0.5', value === v ? 'bg-navy-900 text-white' : 'text-slate-500 hover:text-slate-700')}>
          {label}
        </button>
      ))}
    </div>
  )
}

const rand0 = (v: number): string => `R ${Math.round(v).toLocaleString('en-ZA')}`
const shortRand = (v: number): string => v >= 1_000_000 ? `R${(v / 1_000_000).toFixed(1)}m` : v >= 1000 ? `R${Math.round(v / 1000)}k` : `R${Math.round(v)}`
