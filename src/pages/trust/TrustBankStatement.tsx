import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Search } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import { fetchTrustBankStatement, type StatementEntry } from '../../lib/trust'

/**
 * THE TRUST ACCOUNT'S STATEMENT, KEPT IN RAPTOR (S7, the firm, 13 Oct: "keeping an historical
 * statement of the trust on Raptor ... every single transaction somewhere ... so we don't need to go
 * into the bank to go and see it").
 *
 * Every line ever imported, newest first, with what Raptor knows it was -- a debtor's payment and
 * whose, a payover and to which run, a bank charge, a receipt returned unpaid -- searchable by the
 * bank's words, a reference or a case number, by month and by money in or out. Read-only: a line is
 * placed or allocated on To sort, never here.
 */
export function TrustBankStatement() {
  const [rows, setRows] = useState<StatementEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [month, setMonth] = useState('')
  const [dir, setDir] = useState<'all' | 'credit' | 'debit'>('all')

  useEffect(() => {
    let live = true
    fetchTrustBankStatement(null, null)
      .then((r) => { if (live) setRows(r) })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [])

  const months = useMemo(() => [...new Set((rows ?? []).map((r) => r.txnDate.slice(0, 7)))].sort().reverse(), [rows])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (rows ?? []).filter((r) => (!month || r.txnDate.startsWith(month))
      && (dir === 'all' || r.direction === dir)
      && (!needle || [r.description, r.reference, r.caseNumber, r.runInvoice, r.what].some((x) => (x ?? '').toLowerCase().includes(needle))))
  }, [rows, q, month, dir])

  if (error) return <Card className="p-5 text-sm text-negative-700 bg-negative-50">The statement could not be read: {error}</Card>
  if (!rows) return <div className="flex items-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> Reading the statement…</div>

  const sum = (f: (r: StatementEntry) => boolean) => Math.round(shown.filter(f).reduce((t, r) => t + r.amount, 0) * 100) / 100
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">Bank statement</h1>
        <p className="mt-1 text-sm text-slate-500">Every line of the trust account&rsquo;s statement imported into Raptor, and what each one was.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
          <Search size={14} className="text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Words, reference or case number…" aria-label="Search the statement"
            className="w-64 bg-transparent text-[13px] outline-none placeholder:text-slate-400" />
        </label>
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month"
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-600">
          <option value="">Every month</option>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <select value={dir} onChange={(e) => setDir(e.target.value as typeof dir)} aria-label="In or out"
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-600">
          <option value="all">In and out</option>
          <option value="credit">Money in</option>
          <option value="debit">Money out</option>
        </select>
        <span className="ml-auto text-[12.5px] text-slate-500" data-testid="statement-sums">
          {shown.length} lines · in {rand(sum((r) => r.amount > 0))} · out {rand(-sum((r) => r.amount < 0))}
        </span>
      </div>

      <Card padded={false} className="overflow-x-auto">
        <table className="w-full list-table whitespace-nowrap">
          <thead>
            <tr className="border-b border-slate-100 text-left text-slate-400">
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-2 py-2 font-medium">What the bank said</th>
              <th className="px-2 py-2 font-medium">What it was</th>
              <th className="px-2 py-2 text-right font-medium">In</th>
              <th className="px-2 py-2 text-right font-medium">Out</th>
              <th className="px-4 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-b border-slate-50" data-testid="statement-line">
                <td className="px-4 py-1.5 tabular-nums text-slate-500">{day(r.txnDate)}</td>
                <td className="px-2 py-1.5 max-w-[22rem] truncate text-slate-700" title={r.description ?? ''}>{r.description ?? '—'}</td>
                <td className={clsx('px-2 py-1.5', r.status === 'unallocated' ? 'text-amber-700' : 'text-slate-600')}>
                  {r.what}
                  {r.caseNumber && r.accountId && <> · <Link to={`/accounts/${r.accountId}`} className="text-gold-700 hover:text-gold-800">{r.caseNumber}</Link></>}
                  {r.runInvoice && r.runId && <> · <Link to={`/trust/runs/${r.runId}`} className="text-gold-700 hover:text-gold-800">{r.runInvoice}</Link></>}
                  {r.status === 'unallocated' && <> · <Link to="/trust/exceptions" className="underline">sort it</Link></>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-positive-700">{r.amount > 0 ? rand(r.amount) : ''}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">{r.amount < 0 ? rand(-r.amount) : ''}</td>
                <td className="px-4 py-1.5 text-right tabular-nums text-slate-500">{r.balance === null ? '' : rand(r.balance)}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">No line matches.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
function day(iso: string): string { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}` }
function monthLabel(ym: string): string { const [y, m] = ym.split('-').map(Number); return `${LONG[m - 1]} ${y}` }
