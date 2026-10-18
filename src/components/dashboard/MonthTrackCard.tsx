import { useState } from 'react'
import clsx from 'clsx'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardHeader } from '../ui/Card'
import type { MonthTrack } from '../../lib/clientBook'

/**
 * THE TRACK RECORD, MONTH BY MONTH (the firm, 18 Oct: "two colors in the same staff ... for a year or 6
 * months ... interchangeable ... possibly show the closing rate for the previous months").
 *
 * Three readings of the same months, chosen by `kind`:
 *   - 'pipeline': leads and mandates as two bars a month, the closing rate a line on its own axis;
 *   - 'new':      handovers from NEW clients (Sales' work), accounts or rand;
 *   - 'existing': handovers from EXISTING clients (Communications' work), accounts or rand.
 * The months are handed in; the 6 / 12 switch tells the page how many to work out.
 */
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
  const money = kind !== 'pipeline' && measure === 'capital'
  const fmt = (v: number) => money ? shortRand(v) : v.toLocaleString('en-ZA')
  const data = rows.map((r) => ({
    ...r,
    value: kind === 'new' ? (money ? r.newCapital : r.newAccounts) : kind === 'existing' ? (money ? r.existingCapital : r.existingAccounts) : 0,
  }))
  return (
    <Card>
      <div data-testid={testId}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardHeader title={title} subtitle={subtitle} />
          <div className="flex items-center gap-2">
            {kind !== 'pipeline' && <Switch options={[['accounts', 'Accounts'], ['capital', 'Rand']]} value={measure} onChange={setMeasure} name={`${testId}-measure`} />}
            <Switch options={[[6, '6 months'], [12, '12 months']]} value={months} onChange={onMonths} name={`${testId}-months`} />
          </div>
        </div>
        <div className="h-64 [&_*:focus]:outline-none">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} accessibilityLayer={false} margin={{ top: 8, right: kind === 'pipeline' ? 8 : 4, bottom: 0, left: money ? -4 : -18 }}>
              <CartesianGrid vertical={false} stroke="var(--color-slate-100)" />
              <XAxis dataKey="short" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11, fill: 'var(--color-slate-400)' }} />
              <YAxis yAxisId="n" allowDecimals={false} tickLine={false} axisLine={false} width={money ? 52 : 40}
                tickFormatter={fmt} tick={{ fontSize: 10, fill: 'var(--color-slate-400)' }} />
              {kind === 'pipeline' && (
                <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tickLine={false} axisLine={false} width={36}
                  tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fill: 'var(--color-slate-400)' }} />
              )}
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
                <Bar yAxisId="n" dataKey="leads" name="Leads" fill="var(--color-gold-400)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar yAxisId="n" dataKey="mandates" name="Mandates signed" fill="var(--color-navy-700)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Line yAxisId="pct" dataKey="closingRate" name="Closing rate" stroke="var(--color-emerald-600)" strokeWidth={2}
                  dot={{ r: 3 }} connectNulls isAnimationActive={false} />
              </> : (
                <Bar yAxisId="n" dataKey="value" name={kind === 'new' ? 'From new clients' : 'From existing clients'}
                  fill={kind === 'new' ? 'var(--color-navy-700)' : 'var(--color-gold-400)'} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              )}
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
