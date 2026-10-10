import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { Modal, FormField, inputClass, controlClass } from '../../components/ui/Modal'
import { rand } from '../../lib/money'
import {
  EXPENSE_CATEGORIES, expenseTotal, monthBounds, monthLabel, splitExpense, thisMonth,
  type BusinessExpense, type ExpenseCategory,
} from '../../lib/businessMonth'
import { cancelExpense, fetchExpenses, recordExpense } from '../../lib/businessApi'
import { fetchFirmSettings } from '../../lib/firmSettings'

/**
 * WHAT THE FIRM SPENT.
 *
 * The half that was missing. Raptor could say what the firm EARNED and not what it MADE, and the
 * business overview said so in words rather than drawing an empty table — because an empty table of
 * expenses reads as a firm that spent nothing, which is a figure, and a wrong one.
 *
 * CALENDAR MONTHS, NOT THE PAYOVER CYCLE. The payover runs the 11th to the 10th because that is
 * when the firm pays its clients; the firm's own books run on calendar months because that is what
 * VAT, the accountant and the year end all run on. Reading this on a collection cycle would put
 * eleven days of one month's rent into the previous month's result.
 *
 * CANCELLED, NEVER DELETED. "What did we spend in March" has to keep answering the same way next
 * year. A cancelled row stays, greyed, carrying the reason it stopped counting — and the table has
 * no delete policy at all, so Postgres would refuse a delete anyway.
 */
export function BusinessExpenses() {
  const now = thisMonth(new Date())
  const [year, setYear] = useState(now.year)
  const [month, setMonth] = useState(now.month)
  const [rows, setRows] = useState<BusinessExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const bounds = useMemo(() => monthBounds(year, month), [year, month])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setRows(await fetchExpenses(bounds.from, bounds.to)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not read the expenses.') }
    finally { setLoading(false) }
  }, [bounds.from, bounds.to])

  useEffect(() => { void load() }, [load])

  const live = rows.filter((r) => !r.cancelledAt)
  const total = live.reduce((s, r) => s + r.amount, 0)
  const vat = live.reduce((s, r) => s + r.vat, 0)

  /* Grouped by the firm's own categories, biggest first: "where did it go" is the question. */
  const byCategory = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of live) m.set(r.category, (m.get(r.category) ?? 0) + r.amount)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [live])

  function step(by: number) {
    const d = new Date(Date.UTC(year, month - 1 + by, 1))
    setYear(d.getUTCFullYear()); setMonth(d.getUTCMonth() + 1)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-xl font-semibold tracking-tight text-slate-800">Expenses</h1>
          <span className="text-xs text-slate-400">What the firm spent, by calendar month</span>
        </div>
        <button type="button" onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 rounded-lg bg-navy-950 px-3.5 py-2 text-[13px]
            font-semibold text-white">
          <Plus size={15} /> Record an expense
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => step(-1)} className={controlClass}>Earlier</button>
        <div className="text-sm font-medium text-slate-700 min-w-[10rem] text-center">
          {monthLabel(year, month)}
        </div>
        <button type="button" onClick={() => step(1)} className={controlClass}>Later</button>
      </div>

      {error && (
        <Card className="p-4 text-sm text-negative-700 bg-negative-50 border-negative-100">{error}</Card>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-8">
          <Loader2 size={16} className="animate-spin" /> Reading the month…
        </div>
      ) : (
        <div className="flex flex-wrap gap-5 items-start">
          <div className="flex-[999_1_30rem] min-w-0">
            {rows.length === 0 ? (
              <Card className="p-6 text-sm text-slate-500 text-center">
                Nothing recorded for {monthLabel(year, month)}. Salaries, rent, the bureau&rsquo;s
                invoices, the SMS gateway and bank charges all belong here.
              </Card>
            ) : (
              <Card className="overflow-hidden p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-[10.5px] uppercase tracking-wide text-slate-400">
                        <th className="text-left font-medium px-4 py-2.5">Date</th>
                        <th className="text-left font-medium px-4 py-2.5 w-full">What</th>
                        <th className="text-left font-medium px-4 py-2.5 whitespace-nowrap">Category</th>
                        <th className="text-right font-medium px-4 py-2.5">Amount</th>
                        <th className="text-right font-medium px-4 py-2.5">VAT</th>
                        <th className="px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className={clsx('border-t border-slate-100',
                          r.cancelledAt && 'text-slate-300')}>
                          <td className="px-4 py-3 whitespace-nowrap tabular-nums">{r.incurredOn}</td>
                          <td className="px-4 py-3">
                            <div className={clsx(r.cancelledAt ? 'line-through' : 'text-slate-800')}>
                              {r.description}
                            </div>
                            {(r.supplier || r.cancelledReason) && (
                              <div className="text-[12px] text-slate-400 mt-0.5">
                                {r.cancelledAt ? `Cancelled — ${r.cancelledReason}` : r.supplier}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{r.category}</td>
                          <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">{rand(r.amount)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-400 whitespace-nowrap">{rand(r.vat)}</td>
                          <td className="px-4 py-3 text-right">
                            {!r.cancelledAt && (
                              <button type="button"
                                onClick={async () => {
                                  const why = window.prompt('Why is it being cancelled?')
                                  if (!why?.trim()) return
                                  try { await cancelExpense(r.id, why); await load() }
                                  catch (e) { setError(e instanceof Error ? e.message : String(e)) }
                                }}
                                className="text-[12.5px] text-slate-400 hover:text-negative-700">
                                Cancel
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-slate-200 bg-slate-50">
                        <td className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-wide
                          text-slate-600" colSpan={3}>
                          {monthLabel(year, month)}
                        </td>
                        <td className="px-4 py-3 text-right text-base font-semibold tabular-nums">
                          {rand(total)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-500">{rand(vat)}</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
            {/* VAT IS SPLIT OUT BECAUSE THE FIRM RECLAIMS IT. The cash that actually left the
                account is the inclusive figure, and saying only one of them invites the wrong one
                to be used. */}
            <p className="mt-3 text-[12.5px] text-slate-500 leading-relaxed">
              Amounts exclude VAT, which is shown beside them because the firm reclaims it.
              {live.length > 0 && ` ${rand(total + vat)} left the account in total.`}
            </p>
          </div>

          {byCategory.length > 0 && (
            <div className="flex-[1_1_16rem] min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Where it went
              </div>
              <Card className="p-0 overflow-hidden">
                {byCategory.map(([cat, amount]) => (
                  <div key={cat}
                    className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0">
                    <div className="flex-1 text-[13.5px] text-slate-700">{cat}</div>
                    <div className="text-[14px] tabular-nums font-medium">{rand(amount)}</div>
                  </div>
                ))}
              </Card>
            </div>
          )}
        </div>
      )}

      {adding && (
        <RecordExpenseModal
          onClose={() => setAdding(false)}
          onDone={async () => { setAdding(false); await load() }}
        />
      )}
    </div>
  )
}

function RecordExpenseModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [incurredOn, setIncurredOn] = useState(today)
  const [category, setCategory] = useState<ExpenseCategory>('Other')
  const [supplier, setSupplier] = useState('')
  const [description, setDescription] = useState('')
  /* THE AMOUNT ON THE SLIP, VAT INCLUDED unless the supplier is not registered (see splitExpense). */
  const [total, setTotal] = useState('')
  const [includesVat, setIncludesVat] = useState(true)
  const [vatRate, setVatRate] = useState(0.15)
  useEffect(() => {
    void fetchFirmSettings().then((f) => { if (f.vatRate > 0) setVatRate(f.vatRate) })
  }, [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalNum = Number(total.replace(/[\s,]/g, ''))
  const split = splitExpense(Number.isFinite(totalNum) ? totalNum : 0, vatRate, includesVat)
  const valid = description.trim() !== '' && Number.isFinite(totalNum) && totalNum > 0

  async function submit() {
    if (busy || !valid) return
    setBusy(true); setError(null)
    try {
      await recordExpense({
        incurredOn, category, supplier: supplier.trim() || undefined,
        description: description.trim(), amount: split.amount, vat: split.vat,
      })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Record an expense"
      subtitle="The firm's own money. Nothing here touches the trust account."
      width={520}
      onClose={onClose}
      footer={(
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12.5px] text-negative-700">{error}</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={controlClass}>Cancel</button>
            <button type="button" onClick={submit} disabled={busy || !valid}
              className="rounded-lg bg-navy-950 px-4 py-2 text-sm font-semibold text-white
                disabled:opacity-40">
              {busy ? <Loader2 size={15} className="animate-spin" /> : 'Record it'}
            </button>
          </div>
        </div>
      )}
    >
      <div className="space-y-3">
        <FormField label="What it was for" required>
          <input className={inputClass} value={description} autoFocus
            onChange={(e) => setDescription(e.target.value)} placeholder="October rent" />
        </FormField>
        <div className="flex gap-3">
          <div className="flex-1">
            <FormField label="Category">
              <select className={inputClass} value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </FormField>
          </div>
          <div className="flex-1">
            <FormField label="Date">
              <input type="date" className={inputClass} value={incurredOn}
                onChange={(e) => setIncurredOn(e.target.value)} />
            </FormField>
          </div>
        </div>
        <FormField label="Supplier">
          <input className={inputClass} value={supplier} onChange={(e) => setSupplier(e.target.value)}
            placeholder="Optional" />
        </FormField>
        <p className="-mt-2 text-[12px] text-slate-400">
          Worth filling in for anything you claim the VAT back on: SARS wants the supplier&rsquo;s tax invoice.
        </p>
        <FormField label="Amount paid" required>
          <input className={inputClass} inputMode="decimal" value={total} data-testid="expense-total"
            onChange={(e) => setTotal(e.target.value)} placeholder="What left the account, as on the slip" />
        </FormField>
        <label className="flex items-center gap-2 text-[13px] text-slate-700">
          <input type="checkbox" checked={includesVat} onChange={(e) => setIncludesVat(e.target.checked)}
            data-testid="expense-includes-vat" />
          Includes {Math.round(vatRate * 1000) / 10}% VAT
          <span className="text-slate-400">· untick for a supplier not registered for VAT</span>
        </label>
        {valid && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-600" data-testid="expense-split">
            {includesVat
              ? <>{rand(split.amount)} + {rand(split.vat)} VAT = {rand(expenseTotal(split))} left the business account.</>
              : <>{rand(expenseTotal(split))} left the business account, no VAT.</>}
          </div>
        )}
      </div>
    </Modal>
  )
}
