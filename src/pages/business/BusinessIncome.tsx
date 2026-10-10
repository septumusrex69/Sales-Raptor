import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { controlClass } from '../../components/ui/Modal'
import { rand } from '../../lib/money'
import { monthBounds, monthLabel, thisMonth } from '../../lib/businessMonth'
import { fetchIncome } from '../../lib/businessApi'
import { INCOME_PARTS, incomeTotals, type IncomeRow } from '../../lib/businessIncome'

/**
 * WHAT THE FIRM EARNED.
 *
 * BEHIND ITS OWN TICK, business.income, which no role has -- not even the Administrator. The firm:
 * "we're not going to be disclosing commission and income from the Annexure B fees. We'll do that on
 * another place, which is not even for an administrator." RequireIncome keeps the page away and
 * business_income answers nobody without the tick; the page is not the boundary.
 *
 * CALENDAR MONTHS, like Expenses beside it, because the firm's own books, VAT and the accountant all
 * run on them -- not the payover cycle, which is when the CLIENTS are paid.
 *
 * THE PARTS ADD TO THE TOTAL, and the screen says so with a row rather than asking anybody to trust
 * it: a receipt's earnings are split exactly by the allocation they were built from, and anything
 * that is not one of the named parts is shown as itself. See businessIncome.ts.
 */
export function BusinessIncome() {
  const now = thisMonth(new Date())
  const [year, setYear] = useState(now.year)
  const [month, setMonth] = useState(now.month)
  const [rows, setRows] = useState<IncomeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const bounds = useMemo(() => monthBounds(year, month), [year, month])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setRows(await fetchIncome(bounds.from, bounds.to)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not read the income.') }
    finally { setLoading(false) }
  }, [bounds.from, bounds.to])
  useEffect(() => { void load() }, [load])

  const totals = useMemo(() => incomeTotals(rows), [rows])
  function step(by: number) {
    const d = new Date(Date.UTC(year, month - 1 + by, 1))
    setYear(d.getUTCFullYear()); setMonth(d.getUTCMonth() + 1)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">Income</h1>
        <span className="text-xs text-slate-400">What the firm earned, by calendar month</span>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => step(-1)} className={controlClass}>Earlier</button>
        <div className="text-sm font-medium text-slate-700 min-w-[10rem] text-center">{monthLabel(year, month)}</div>
        <button type="button" onClick={() => step(1)} className={controlClass}>Later</button>
      </div>

      {error && <Card className="p-4 text-sm text-negative-700 bg-negative-50 border-negative-100">{error}</Card>}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-8">
          <Loader2 size={16} className="animate-spin" /> Reading the month…
        </div>
      ) : (
        /* STACKED, not side by side: the per-client table needs its six columns, and beside the
           summary at a laptop's width it scrolled its Total column out of sight. */
        <div className="space-y-5">
          <Card className="max-w-md">
            <h2 className="text-[11px] uppercase tracking-wide text-slate-400 mb-3">{monthLabel(year, month)}</h2>
            <div className="space-y-2 text-sm">
              {INCOME_PARTS.map((p) => (
                <div key={p.key} className="flex justify-between gap-3">
                  <span className="text-slate-600">
                    {p.label}
                    {p.note && <span className="block text-[11px] text-slate-400">{p.note}</span>}
                  </span>
                  <span className="tabular-nums text-slate-800 shrink-0">{rand(totals[p.key])}</span>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 font-semibold text-slate-900">
                <span>Earned</span>
                <span className="tabular-nums" data-testid="income-total">{rand(totals.total)}</span>
              </div>
            </div>
          </Card>

          <div className="min-w-0">
            {rows.length === 0 ? (
              <Card className="p-6 text-sm text-slate-500 text-center">
                Nothing earned in {monthLabel(year, month)} yet. Commission and fees arrive here as
                receipts are approved and split.
              </Card>
            ) : (
              <Card className="overflow-hidden p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px] whitespace-nowrap">
                    <thead>
                      <tr className="bg-slate-50 text-slate-400 text-slate-400">
                        <th className="text-left font-medium px-4 py-2.5 w-full">Client</th>
                        <th className="text-right font-medium px-4 py-2.5">Commission</th>
                        <th className="text-right font-medium px-4 py-2.5 whitespace-nowrap">Fees &amp; costs</th>
                        <th className="text-right font-medium px-4 py-2.5">Interest</th>
                        <th className="text-right font-medium px-4 py-2.5">Charges</th>
                        <th className="text-right font-medium px-4 py-2.5">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.companyId ?? 'none'} className="border-t border-slate-100">
                          <td className="px-4 py-1.5 text-slate-800">{r.companyName ?? 'Not from a client'}</td>
                          <td className="px-4 py-1.5 text-right tabular-nums whitespace-nowrap">{rand(r.commission + r.commissionVat)}</td>
                          <td className="px-4 py-1.5 text-right tabular-nums whitespace-nowrap">{rand(r.costs)}</td>
                          <td className="px-4 py-1.5 text-right tabular-nums whitespace-nowrap">{rand(r.interest)}</td>
                          <td className="px-4 py-1.5 text-right tabular-nums whitespace-nowrap">{rand(r.chargesRaised)}</td>
                          <td className="px-4 py-1.5 text-right tabular-nums whitespace-nowrap font-medium">{rand(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="px-4 py-2.5 text-[11px] text-slate-400 border-t border-slate-100">
                  Commission includes its VAT here. Bank interest, unclaimed credit and other entries are in the total.
                </p>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
