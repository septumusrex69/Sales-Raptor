import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Search } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import { findPayments, type FoundPayment } from '../../lib/trust'
import { parseRandAmount } from '../../lib/findPaymentAmount'

/**
 * FIND A PAYMENT (request #18, Finance, 29 Oct): "a month later we receive a POP, the debtor used the wrong
 * reference. Where / how do we check where the payment went as it won't be in suspense."
 *
 * Type what the proof of payment says -- the amount, the day, a name or a reference, any of them -- and every
 * payment Raptor holds that matches comes back with WHERE IT IS NOW: on which debtor's account, waiting for
 * approval, in suspense, reversed, moved to another account (named), or never placed at all. The searching is
 * find_payments, in the database, because the book is too large to bring to the browser to filter.
 *
 * READ-ONLY, like the bank statement beside it. Moving a payment is done on the account it is on; this page
 * only says where that is.
 */
export function FindPayment() {
  const [amount, setAmount] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [words, setWords] = useState('')
  const [rows, setRows] = useState<FoundPayment[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function search(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const amt = amount.trim() ? parseRandAmount(amount) : null
    /* An amount that cannot be read is SAID, not searched for as nothing: "no payment found" would read as
       "the money never reached Raptor", which is the one answer this page must not give by mistake. */
    if (amount.trim() && amt === null) { setError(`“${amount}” is not an amount Raptor can read. Try 1500 or 1 500,00.`); return }
    if (amt === null && !from && !to && !words.trim()) { setError('Type an amount, a day or some words from the proof of payment.'); return }
    setBusy(true)
    try { setRows(await findPayments({ amount: amt, from: from || null, to: to || null, words: words.trim() || null })) }
    catch (x) { setError(x instanceof Error ? x.message : String(x)) }
    finally { setBusy(false) }
  }

  const field = 'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-700 outline-none placeholder:text-slate-400'
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">Find a payment</h1>
        <p className="mt-1 text-sm text-slate-500">Type what the proof of payment says. Every payment Raptor holds that matches comes back with where it is now.</p>
      </div>

      <form onSubmit={search} className="flex flex-wrap items-end gap-2" data-testid="find-payment-form">
        <label className="flex flex-col gap-1 text-[12px] text-slate-500">Amount
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1 500,00" inputMode="decimal"
            aria-label="Amount" className={clsx(field, 'w-32 tabular-nums')} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-slate-500">Paid from
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Paid from" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-slate-500">to
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Paid to" className={field} />
        </label>
        <label className="flex flex-1 min-w-[14rem] flex-col gap-1 text-[12px] text-slate-500">Name, reference or any words
          <span className={clsx(field, 'flex items-center gap-2')}>
            <Search size={14} className="text-slate-400" />
            <input value={words} onChange={(e) => setWords(e.target.value)} placeholder="Who paid, their reference, a case number…"
              aria-label="Words" className="w-full bg-transparent outline-none placeholder:text-slate-400" />
          </span>
        </label>
        <button type="submit" disabled={busy} className="rounded-lg bg-navy-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : 'Find'}
        </button>
      </form>
      {error && <p className="text-sm text-negative-700" data-testid="find-payment-error">{error}</p>}

      {rows && (
        <Card padded={false} className="overflow-x-auto">
          <table className="w-full list-table whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="px-4 py-2 font-medium">Paid</th>
                <th className="px-2 py-2 text-right font-medium">Amount</th>
                <th className="px-2 py-2 font-medium">Who paid · reference</th>
                <th className="px-2 py-2 font-medium">Where it is now</th>
                <th className="px-4 py-2 font-medium">Debtor · client</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`} className="border-b border-slate-50" data-testid="found-payment" data-state={r.state}>
                  <td className="px-4 py-1.5 tabular-nums text-slate-500">{day(r.onDay)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">{rand(r.amount)}</td>
                  <td className="px-2 py-1.5 max-w-[20rem] truncate text-slate-700" title={[r.depositor, r.reference, r.bankWords].filter(Boolean).join(' · ')}>
                    {[r.depositor, r.reference].filter(Boolean).join(' · ') || r.bankWords || '—'}
                  </td>
                  <td className={clsx('px-2 py-1.5', r.state === 'On the account' ? 'text-slate-700' : 'text-amber-700')}>
                    {r.state}
                    {r.movedToAccountId && r.movedToCase && <> · <Link to={`/accounts/${r.movedToAccountId}`} className="text-gold-700 hover:text-gold-800">{r.movedToCase}</Link></>}
                    {r.kind === 'bank line' && <> · <Link to="/trust/exceptions" className="underline">sort it</Link></>}
                  </td>
                  <td className="px-4 py-1.5 text-slate-600">
                    {r.accountId
                      ? <><Link to={`/accounts/${r.accountId}`} className="text-gold-700 hover:text-gold-800">{r.caseNumber ?? r.accountNumber}</Link>{r.debtor ? ` · ${r.debtor}` : ''}{r.client ? ` · ${r.client}` : ''}</>
                      : '—'}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">No payment in Raptor matches. Try fewer words, or only the amount.</td></tr>}
            </tbody>
          </table>
          {rows.length === 200 && <p className="px-4 py-2 text-[12px] text-slate-500">The first 200 shown, newest first. Add a day or some words to narrow it.</p>}
        </Card>
      )}
    </div>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function day(iso: string): string { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}` }
