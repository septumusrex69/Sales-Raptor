import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { DisposeExcessModal } from '../../components/finance/DisposeExcessModal'
import { ParkedCredits } from '../../components/finance/ParkedCredits'
import { rand } from '../../lib/money'
import { fetchExceptions, type ExceptionJob } from '../../lib/payover'
import { fetchPaymentsOutPaid, fetchPaymentsToMake, markRefundPaid } from '../../lib/bankAllocationApi'
import { fetchPayoutsStatementOnly } from '../../lib/trust'
import { shortDate } from '../../lib/trustCycles'
import { clockNowMs, clockToday } from '../../lib/clock.ts'
import type { PaidOut, PaymentToMake } from '../../lib/paymentsOut'
import { MarkPaidBox, type Paying } from './TrustPaymentsOut'

/**
 * OVERPAYMENTS, IN ONE PLACE (the firm, 11 Oct: "perhaps we should have a separate section for like
 * overpayments").
 *
 * A debtor's overpayment is THEIR money in trust -- not the client's and not the firm's -- and its
 * life ran across three screens: decided on Exceptions, paid out from Payments to make, and kept
 * (parked) in a block at the bottom of Exceptions, with the Trust overview naming the total. Asked
 * "how do we say a refund was made, and where does it go if we keep it?", the honest answer was "it
 * depends which screen you are on". This is the one screen, in the order the money moves:
 *
 *   TO DECIDE  -- overpaid, nobody has said what happens; it holds the client's payover run.
 *   TO REFUND  -- decided as a refund; pay it at the bank on the reference shown, then Mark paid
 *                 (or let the statement confirm it).
 *   PARKED     -- kept, NOT suspense: still the debtor's, waiting for a date to be looked at again.
 *   REFUNDED   -- gone out, and whether the statement has confirmed it.
 *
 * NOTHING NEW HAPPENS HERE. Every press is the one the other screens already make -- the same
 * DisposeExcessModal, the same mark_refund_paid, the same parked-credit list -- so a refund marked
 * here is a refund marked on Payments to make, and the rules live in the database once.
 */
type Tab = 'decide' | 'refund' | 'parked' | 'refunded'
const TABS: { id: Tab; label: string }[] = [
  { id: 'decide', label: 'To decide' },
  { id: 'refund', label: 'To refund' },
  { id: 'parked', label: 'Parked' },
  { id: 'refunded', label: 'Refunded' },
]

export function TrustOverpayments() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = (TABS.find((t) => t.id === params.get('tab'))?.id) ?? 'decide'
  const [undecided, setUndecided] = useState<ExceptionJob[]>([])
  const [toRefund, setToRefund] = useState<PaymentToMake[]>([])
  const [refunded, setRefunded] = useState<PaidOut[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<ExceptionJob | null>(null)
  const [paying, setPaying] = useState<Paying | null>(null)
  const [statementOnly, setStatementOnly] = useState(false)
  const today = clockToday()
  /* A year of refunds: the list is short, and a debtor asking about last winter's is the ordinary case. */
  const since = new Date(clockNowMs() - 365 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' })

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [jobs, out, paid] = await Promise.all([fetchExceptions(), fetchPaymentsToMake(), fetchPaymentsOutPaid(since)])
      setUndecided(jobs.filter((j) => j.kind === 'excess_credit'))
      setToRefund(out.filter((p) => p.kind === 'refund'))
      setRefunded(paid.filter((p) => p.kind === 'refund'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the overpayments.')
    } finally {
      setLoading(false)
    }
  }, [since])
  useEffect(() => { void load() }, [load])
  useEffect(() => { fetchPayoutsStatementOnly().then(setStatementOnly).catch(() => {}) }, [])

  const count: Record<Tab, number | null> = {
    decide: undecided.length, refund: toRefund.length, parked: null, refunded: refunded.length,
  }

  return (
    <div className="space-y-4" data-testid="overpayments">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">Overpayments</h1>
        <span className="text-xs text-slate-400">A debtor&rsquo;s money in trust, from the day it is overpaid to the day it is returned or kept</span>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-100 pb-2">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} data-testid={`overpay-tab-${t.id}`}
            onClick={() => setParams(t.id === 'decide' ? {} : { tab: t.id }, { replace: true })}
            className={clsx('rounded-lg px-3 py-1.5 text-[13.5px] font-medium transition-colors',
              tab === t.id ? 'bg-gold-50 text-gold-800' : 'text-slate-500 hover:bg-slate-100')}>
            {t.label}
            {(count[t.id] ?? 0) > 0 && <span className="ml-1.5 text-slate-400 tabular-nums">{count[t.id]}</span>}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-negative-50 px-4 py-3 text-sm text-negative-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {loading && tab !== 'parked' ? (
        <div className="py-12 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
      ) : tab === 'decide' ? (
        <Card padded={false}>
          <p className="border-b border-slate-100 px-4 py-2.5 text-[12.5px] text-slate-500">
            Paid more than they owed. Until it is decided it holds the client&rsquo;s payover run:
            refund it, move it to another of the debtor&rsquo;s accounts, release it to the client with
            the debtor&rsquo;s agreement, or park it.
          </p>
          {undecided.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No overpayment is waiting for a decision.</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {undecided.map((j, i) => (
                <div key={`${j.allocationId}-${i}`} className="flex items-center gap-3 px-4 py-1.5 text-[12.5px] whitespace-nowrap" data-testid="overpay-undecided">
                  <div className="min-w-0 flex-1 truncate" title={`${j.client} · ${j.debtor} · ${j.problem}`}>
                    <span className="text-slate-500">{j.caseNumber ?? ''}</span>
                    <Link to={`/accounts/${j.accountId}`} className="ml-2 font-medium text-slate-800 hover:text-gold-800">{j.debtor}</Link>
                    <span className="ml-2 text-slate-500">{j.client}</span>
                    <span className="ml-2 text-slate-400">· {j.problem}</span>
                  </div>
                  <div className="tabular-nums text-slate-700">{rand(j.amount ?? 0)}</div>
                  {j.allocationId && (
                    <button type="button" onClick={() => setDeciding(j)}
                      className="rounded-md bg-navy-900 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-navy-800">
                      Decide it
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : tab === 'refund' ? (
        <Card padded={false}>
          <p className="border-b border-slate-100 px-4 py-2.5 text-[12.5px] text-slate-500">
            Decided as a refund. Pay each one at the bank <strong className="font-medium text-slate-700">with the reference shown</strong>
            {statementOnly ? '; it is confirmed when its line on the trust statement is allocated.' : ', then mark it paid here. The statement line confirms it later.'}
          </p>
          {toRefund.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No refund is waiting to be paid.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full list-table whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400">
                    <th className="px-3 py-2 text-left font-medium">Pay to</th>
                    <th className="px-2 py-2 text-left font-medium">Account</th>
                    <th className="px-2 py-2 text-left font-medium">Why</th>
                    <th className="px-2 py-2 text-left font-medium">Reference</th>
                    <th className="px-2 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {toRefund.map((p) => (
                    <tr key={p.id} className="border-b border-slate-50 last:border-0" data-testid="overpay-to-refund">
                      <td className="px-3 py-1.5 font-medium text-slate-800">{p.payee}</td>
                      <td className="px-2 py-1.5">
                        {p.accountId ? <Link to={`/accounts/${p.accountId}`} className="text-gold-700 hover:text-gold-800">{p.caseNumber ?? 'Account'}</Link> : '—'}
                      </td>
                      <td className="px-2 py-1.5 max-w-[16rem] truncate text-slate-500" title={p.detail ?? ''}>{p.detail ?? '—'}</td>
                      <td className="px-2 py-1.5 font-mono text-[12.5px] text-slate-700">{p.reference ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-800">{rand(p.amount)}</td>
                      <td className="px-3 py-1.5 text-right">
                        {statementOnly ? (
                          <span className="text-[11.5px] text-slate-400">Paid from the statement</span>
                        ) : (
                          <button type="button" data-testid="overpay-mark-paid"
                            onClick={() => setPaying({ kind: 'refund', id: p.id, payee: p.payee, amount: p.amount, reference: p.reference ?? '' })}
                            className="rounded-md border border-slate-200 px-2 py-0.5 text-[12px] font-medium text-slate-700 hover:bg-slate-100">
                            Mark paid
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : tab === 'parked' ? (
        <div className="space-y-3">
          {/* KEPT IS NOT SUSPENSE. Suspense is a receipt nobody can place; a parked credit is placed
              exactly -- on the debtor -- and simply not returned yet. */}
          <p className="text-[12.5px] text-slate-500 max-w-3xl">
            Kept for now, usually because returning it would cost more than it is worth. It is still
            the debtor&rsquo;s money in trust, not suspense and not the firm&rsquo;s; each one has a date to be
            looked at again, after which it may be taken or given back. Nothing parked is listed
            below when there is nothing parked.
          </p>
          <ParkedCredits />
        </div>
      ) : (
        <Card padded={false}>
          {refunded.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No refund has been paid in the last year.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full list-table whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400">
                    <th className="px-3 py-2 text-left font-medium">Paid</th>
                    <th className="px-2 py-2 text-left font-medium">To</th>
                    <th className="px-2 py-2 text-left font-medium">Account</th>
                    <th className="px-2 py-2 text-left font-medium">Reference</th>
                    <th className="px-2 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-left font-medium">On the statement</th>
                  </tr>
                </thead>
                <tbody>
                  {refunded.map((p) => (
                    <tr key={p.id} className="border-b border-slate-50 last:border-0" data-testid="overpay-refunded">
                      <td className="px-3 py-1.5 text-slate-600">{p.paidAt ? shortDate(p.paidAt.slice(0, 10)) : '—'}</td>
                      <td className="px-2 py-1.5 font-medium text-slate-800">{p.payee}</td>
                      <td className="px-2 py-1.5">
                        {p.accountId ? <Link to={`/accounts/${p.accountId}`} className="text-gold-700 hover:text-gold-800">{p.caseNumber ?? 'Account'}</Link> : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-slate-500">{p.paidReference ?? p.reference ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">{rand(p.amount)}</td>
                      <td className="px-3 py-1.5 text-slate-500">
                        {p.confirmed ? `Yes${p.statementDate ? `, ${shortDate(p.statementDate)}` : ''}` : 'Not yet'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {deciding?.allocationId && (
        <DisposeExcessModal
          allocationId={deciding.allocationId}
          accountId={deciding.accountId}
          debtor={deciding.debtor}
          caseNumber={deciding.caseNumber}
          amount={deciding.amount ?? 0}
          onClose={() => setDeciding(null)}
          onDone={async () => { setDeciding(null); await load() }}
        />
      )}
      {paying && (
        <MarkPaidBox paying={paying} today={today} onClose={() => setPaying(null)}
          onSave={async (ref, date) => {
            await markRefundPaid(paying.id, ref, new Date(`${date}T12:00:00`).toISOString())
            setPaying(null)
            await load()
          }} />
      )}
    </div>
  )
}
