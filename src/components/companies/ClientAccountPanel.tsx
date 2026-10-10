import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../ui/Card'
import { rand } from '../../lib/money'
import { fetchClientAccount, type ClientEntry, type ClientEntryKind } from '../../lib/business'

/**
 * WHAT PASSES BETWEEN THE FIRM AND THIS CLIENT, AS ONE RUNNING BALANCE.
 *
 * THE FIRM WROTE THE SPECIFICATION BY LISTING IT: *"Payover due to client. Payover paid to client.
 * Withdrawal invoice for client. Payover due to client. Withdrawal fee subtracted from payover.
 * Client paid payover. Invoice for executive listing. Invoice paid by client."*
 *
 * IT LIVES ON THE CLIENT AND NOT IN EITHER WORKSPACE, which is the resolution to the thing the
 * firm was turning over: *"now we're taking money for the business out of the trust for somebody
 * else that owes us... if they owe the trust, they owe us so we can do that."* Right — and the
 * reason it is right is that the firm is not reaching into the trust account in general, it is
 * reducing what it hands THIS client by what THIS client owes it. Trust is one side, Business is
 * the other, and the only place both are true at once is the client.
 *
 * THE BALANCE COMES FROM THE DATABASE. `client_account` computes it in one ordered window; adding
 * the rows up again here would be a second arithmetic, and the day the two disagreed the client
 * would be holding a statement that does not match the payover it was built from.
 *
 * A POSITIVE BALANCE IS OWED TO THE CLIENT. Which is the direction they read it in -- it is their
 * money the firm is holding -- and the opposite of how the firm's own books would show it. The
 * heading says so rather than leaving somebody to work out the sign.
 */

/*
 * THE GROSS PAYOVER AND THE CHARGE ARE TWO LINES, NOT ONE NET FIGURE. The firm's own sequence
 * names them separately -- "payover due to client" and then "withdrawal fee subtracted from
 * payover" -- because that is how they say it to a client. Netting them would leave somebody
 * working backwards from a number nobody quoted.
 */
const KIND: Record<ClientEntryKind, { label: string; tone: string }> = {
  payover_due: { label: 'Payover due', tone: 'bg-positive-100 text-positive-700' },
  payover_paid: { label: 'Paid out', tone: 'bg-slate-100 text-slate-600' },
  charge_set_off: { label: 'Off the payover', tone: 'bg-gold-100 text-gold-800' },
  invoice_raised: { label: 'Invoiced', tone: 'bg-brand-100 text-brand-700' },
  invoice_paid: { label: 'Invoice paid', tone: 'bg-slate-100 text-slate-600' },
}

export function ClientAccountPanel({ companyId }: { companyId: string }) {
  const [entries, setEntries] = useState<ClientEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    fetchClientAccount(companyId)
      .then((e) => { if (live) setEntries(e) })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [companyId])

  if (loading) {
    return (
      <Card className="p-5 flex items-center gap-2 text-sm text-slate-400">
        <Loader2 size={15} className="animate-spin" /> Reading the client&rsquo;s account…
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="p-5 text-sm text-negative-700 bg-negative-50 border-negative-100">
        The client&rsquo;s account could not be read: {error}
      </Card>
    )
  }

  if (entries.length === 0) {
    return (
      <Card className="p-6 text-sm text-slate-500 text-center">
        Nothing has passed between the firm and this client yet. A payover run or a charge raised
        on a withdrawal would open the account.
      </Card>
    )
  }

  /*
   * THE CLOSING BALANCE IS THE LAST ROW'S, NOT A SUM. Same reason as above: one arithmetic. The
   * rows arrive in the order the balance was computed in, so the last one IS where the account
   * stands.
   */
  const closing = entries[entries.length - 1].balance

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          The client&rsquo;s account
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[12.5px] text-slate-500">
            {closing > 0 ? 'Owed to the client' : closing < 0 ? 'Owed to the firm' : 'Settled'}
          </span>
          <span className={clsx('text-lg font-semibold tabular-nums',
            closing > 0 ? 'text-positive-700' : closing < 0 ? 'text-negative-700' : 'text-slate-600')}>
            {rand(Math.abs(closing))}
          </span>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50 text-slate-400 text-slate-400">
                <th className="text-left font-medium px-4 py-2.5">Date</th>
                <th className="text-left font-medium px-4 py-2.5">What happened</th>
                <th className="text-left font-medium px-4 py-2.5">Reference</th>
                <th className="text-right font-medium px-4 py-2.5">Amount</th>
                <th className="text-right font-medium px-4 py-2.5">Balance</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                const meta = KIND[e.kind]
                return (
                  <tr key={`${e.kind}-${e.runId ?? e.chargeId ?? i}`}
                    className="border-t border-slate-100">
                    <td className="px-4 py-1.5 text-slate-500 whitespace-nowrap tabular-nums">{e.on}</td>
                    <td className="px-4 py-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-slate-800">{e.description}</span>
                        <span className={clsx(
                          'rounded-full px-2 py-px text-[11px] font-medium',
                          meta?.tone ?? 'bg-slate-100 text-slate-600',
                        )}>
                          {meta?.label ?? e.kind}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-1.5 text-slate-500 whitespace-nowrap">
                      {/* The run is a real page; an invoice number on a charge is not, yet. */}
                      {e.runId
                        ? <Link to={`/trust/runs/${e.runId}`} className="text-brand-500 hover:underline">
                            {e.reference || 'the run'}
                          </Link>
                        : (e.reference || '—')}
                    </td>
                    <td className={clsx('px-4 py-1.5 text-right tabular-nums whitespace-nowrap',
                      e.amount < 0 ? 'text-negative-700' : 'text-positive-700')}>
                      {e.amount < 0 ? '−' : '+'}{rand(Math.abs(e.amount))}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums font-medium whitespace-nowrap">
                      {rand(e.balance)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-[12.5px] text-slate-500 leading-relaxed">
        The payover is shown in full and anything taken off it as its own line, because that is how
        the firm says it to a client — not one net figure to work backwards from. A charge set off
        comes out of <em>this client&rsquo;s own</em> trust money and never anybody else&rsquo;s.
      </p>
    </div>
  )
}
