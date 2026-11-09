import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card } from '../ui/Card'
import { rand } from '../../lib/money'
import { fetchCollectionsShare, fetchIncomeMonths } from '../../lib/businessApi'
import { monthBounds, monthLabel } from '../../lib/businessMonth'
import { oursFromIncome, percent, shareOf, totalShare, type ShareFigures } from '../../lib/collectionsShare'

/**
 * OUR SHARE OF COLLECTIONS (S21 · Raptor H19) -- of what debtors paid, how much was the firm's and how much the clients',
 * and the ratio. Stephan, 9 Nov: "if we collect 2 million, or 3 million, how much of that is [our] share? How much of that
 * is the client share? ... the profitability margin ratio." On Income, behind business.income, like everything here.
 * The month chosen below the trend decides which month is read; the twelve before it are listed for the ratio's run.
 * The arithmetic is collectionsShare.ts; the figures are the Income page's own (business_income_months,
 * collections_share), so this cannot disagree with the graph above it.
 */
export function OurShareOfCollections({ year, month }: { year: number; month: number }) {
  const bounds = useMemo(() => monthBounds(year, month), [year, month])
  const yearBack = useMemo(() => monthBounds(...back(year, month, 11)).from, [year, month])
  const [months, setMonths] = useState<{ month: string; share: ShareFigures }[] | null>(null)
  const [clients, setClients] = useState<{ companyId: string; client: string; share: ShareFigures }[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setError(null); setMonths(null); setClients(null)
    Promise.all([fetchIncomeMonths(yearBack, bounds.to), fetchCollectionsShare(bounds.from, bounds.to)])
      .then(([m, c]) => {
        if (!live) return
        setMonths(m.map((x) => { const o = oursFromIncome(x); return { month: x.month, share: shareOf(x.collected, o.ours, o.vat) } }).reverse())
        setClients(c.map((x) => ({ companyId: x.companyId, client: x.client, share: shareOf(x.collected, x.ours, x.vat) })))
      })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'Could not read the share.') })
    return () => { live = false }
  }, [yearBack, bounds.from, bounds.to])

  /* THE CHOSEN MONTH BY ITS DATE, never "the latest row": a month with no row is nothing collected, not the month before. */
  const thisMonth = months ? (months.find((m) => m.month.slice(0, 7) === bounds.from.slice(0, 7))?.share ?? shareOf(0, 0)) : null
  const year12 = months ? totalShare(months.map((m) => m.share)) : null

  return (
    <section className="space-y-4" data-testid="our-share">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-lg font-semibold tracking-tight text-slate-800">Our share of collections</h2>
        <span className="text-xs text-slate-400">Of what debtors paid, what was Bredell Ferreira&rsquo;s and what was the clients&rsquo;</span>
      </div>
      {error && <Card className="p-4 text-sm text-negative-700 bg-negative-50 border-negative-100">{error}</Card>}
      {!months && !error && (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-4"><Loader2 size={16} className="animate-spin" /> Reading the share…</div>
      )}
      {thisMonth && year12 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ShareCard title={monthLabel(year, month)} s={thisMonth} testId="share-month" />
          <ShareCard title="The twelve months to it" s={year12} testId="share-year" />
        </div>
      )}
      {months && (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full list-table whitespace-nowrap" data-testid="share-months">
              <thead>
                <tr className="bg-slate-50 text-slate-400">
                  <th className="text-left font-medium px-4 py-2.5 w-full">Month</th>
                  <th className="text-right font-medium px-4 py-2.5">Collected</th>
                  <th className="text-right font-medium px-4 py-2.5">Our share</th>
                  <th className="text-right font-medium px-4 py-2.5">Clients&rsquo; share</th>
                  <th className="text-right font-medium px-4 py-2.5">Ratio</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.month} className="border-t border-slate-100">
                    <td className="px-4 py-1.5 text-slate-800">{monthLabel(Number(m.month.slice(0, 4)), Number(m.month.slice(5, 7)))}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{rand(m.share.collected)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{rand(m.share.ours)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{rand(m.share.clients)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums font-medium">{percent(m.share.ratio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {clients && clients.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="px-4 pt-3 text-[12.5px] font-semibold text-slate-600">Client by client, {monthLabel(year, month)}</div>
          <div className="overflow-x-auto">
            <table className="w-full list-table whitespace-nowrap" data-testid="share-clients">
              <thead>
                <tr className="text-slate-400">
                  <th className="text-left font-medium px-4 py-2 w-full">Client</th>
                  <th className="text-right font-medium px-4 py-2">Collected</th>
                  <th className="text-right font-medium px-4 py-2">Our share</th>
                  <th className="text-right font-medium px-4 py-2">Clients&rsquo; share</th>
                  <th className="text-right font-medium px-4 py-2">Ratio</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.companyId} className="border-t border-slate-100">
                    <td className="px-4 py-1.5 text-slate-800">{c.client}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{rand(c.share.collected)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{rand(c.share.ours)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{rand(c.share.clients)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums font-medium">{percent(c.share.ratio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="text-[11px] text-slate-400">
        Our share is commission, Annexure B fees and costs, and interest earned on what debtors paid; the VAT on commission is
        SARS&rsquo;s; the clients&rsquo; share is the rest. The share line in the graph above also counts charges to clients and bank
        interest, which are income but not part of a debtor&rsquo;s payment, so it can read a little higher.
      </p>
    </section>
  )
}

function ShareCard({ title, s, testId }: { title: string; s: ShareFigures; testId: string }) {
  const oursWidth = s.ratio === null ? 0 : Math.max(0, Math.min(100, Math.round(s.ratio * 1000) / 10))
  return (
    <div data-testid={testId}><Card className="px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] font-semibold text-slate-600">{title}</span>
        <span className="text-2xl font-semibold tabular-nums text-slate-800">{percent(s.ratio)}</span>
      </div>
      <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--c-navy)]/15" aria-hidden="true">
        <div className="h-full bg-[var(--c-gold)]" style={{ width: `${oursWidth}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-[12.5px] sm:grid-cols-4">
        <div><dt className="text-slate-500">Collected</dt><dd className="font-semibold tabular-nums text-slate-800">{rand(s.collected)}</dd></div>
        <div><dt className="text-slate-500">Our share</dt><dd className="font-semibold tabular-nums text-[var(--c-gold-deep)]">{rand(s.ours)}</dd></div>
        <div><dt className="text-slate-500">VAT for SARS</dt><dd className="font-semibold tabular-nums text-slate-600">{rand(s.vat)}</dd></div>
        <div><dt className="text-slate-500">Clients&rsquo; share</dt><dd className="font-semibold tabular-nums text-slate-800">{rand(s.clients)}</dd></div>
      </dl>
    </Card></div>
  )
}

/** The year and month `by` months before, for monthBounds. */
function back(year: number, month: number, by: number): [number, number] {
  const d = new Date(Date.UTC(year, month - 1 - by, 1))
  return [d.getUTCFullYear(), d.getUTCMonth() + 1]
}
