import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../ui/Card'
import { rand } from '../../lib/money'
import { fetchClientAccount, fetchLedgerRuns, type ClientEntry, type ClientEntryKind } from '../../lib/business'
import { ledgerByPayover, type LedgerRun } from '../../lib/clientLedger'

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
 * ONE LINE A PAYOVER (the firm, 10 Oct). The lines come from `client_ledger`; `ledgerByPayover`
 * folds the payments into the payover that carried them, and the headline balance is still the
 * database's own.
 *
 * A POSITIVE BALANCE IS OWED TO THE CLIENT. Which is the direction they read it in -- it is their
 * money the firm is holding -- and the opposite of how the firm's own books would show it. The
 * heading says so rather than leaving somebody to work out the sign.
 */

/*
 * The badge on a line in a payover's detail, so the payments behind a run still say what each was.
 */
const KIND: Record<ClientEntryKind, { label: string; tone: string }> = {
  held: { label: 'Held for them', tone: 'bg-positive-100 text-positive-700' },
  owed: { label: 'Paid to them directly', tone: 'bg-negative-100 text-negative-700' },
  set_off: { label: 'Off the payover', tone: 'bg-gold-100 text-gold-800' },
  payover_paid: { label: 'Paid out', tone: 'bg-slate-100 text-slate-600' },
  released: { label: 'Released to them', tone: 'bg-positive-100 text-positive-700' },
  reversal: { label: 'Reversed', tone: 'bg-negative-100 text-negative-700' },
  re_split: { label: 'Re-split', tone: 'bg-slate-100 text-slate-600' },
  charge_pending: { label: 'Due off next payover', tone: 'bg-gold-100 text-gold-800' },
  invoice_raised: { label: 'Invoiced', tone: 'bg-brand-100 text-brand-700' },
  invoice_paid: { label: 'Invoice paid', tone: 'bg-slate-100 text-slate-600' },
  paid_direct: { label: 'Paid to us', tone: 'bg-emerald-50 text-emerald-700' },
}

/*
 * DEBIT AND CREDIT, IN THE FIRM'S BOOKS: a debit is the client owing us; a credit is us owing them.
 * The balance says which with Dr / Cr rather than a minus sign, which the firm has already misread
 * once on a remittance advice.
 */
const money = (v: number) => rand(Math.abs(v))
const drCr = (v: number) => (v < 0 ? 'Dr' : v > 0 ? 'Cr' : '')

export function ClientAccountPanel({ companyId }: { companyId: string }) {
  const [entries, setEntries] = useState<ClientEntry[]>([])
  const [runs, setRuns] = useState<LedgerRun[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    Promise.all([fetchClientAccount(companyId), fetchLedgerRuns(companyId)])
      .then(([e, r]) => { if (live) { setEntries(e); setRuns(r) } })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [companyId])

  const rows = useMemo(() => ledgerByPayover(entries, runs), [entries, runs])

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
        Nothing has passed between the firm and this client yet. A payment collected for them, a
        payment made to them directly, or a charge raised on a withdrawal would open the ledger.
      </Card>
    )
  }

  /*
   * THE CLOSING BALANCE IS THE DATABASE'S: the last line of its own ordered window. The regrouped
   * rows close on the same figure (a regrouping never changes a sum), and check-client-ledger
   * holds that; reading the database's here means a disagreement would show, not hide.
   */
  const closing = entries[entries.length - 1].balance

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          The client&rsquo;s ledger
        </div>
        <div className="flex items-baseline gap-2" data-testid="ledger-closing">
          <span className="text-[12.5px] text-slate-500">
            {closing > 0 ? 'We owe the client' : closing < 0 ? 'The client owes us' : 'Settled'}
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
              <tr className="bg-slate-50 text-slate-400">
                <th className="text-left font-medium px-4 py-2">Date</th>
                <th className="text-left font-medium px-4 py-2">What happened</th>
                <th className="text-right font-medium px-4 py-2" title="The client owes us more">Debit</th>
                <th className="text-right font-medium px-4 py-2" title="We owe the client more">Credit</th>
                <th className="text-right font-medium px-4 py-2" title="Dr: the client owes us. Cr: we owe the client.">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const many = r.lines.length > 1 || r.key.startsWith('run:') || r.key.startsWith('open:')
                const shown = open === r.key
                return (
                  <Fragment key={r.key}>
                    <tr data-testid="ledger-row"
                      className={clsx('border-t border-slate-100', many && 'cursor-pointer hover:bg-slate-50')}
                      onClick={many ? () => setOpen(shown ? null : r.key) : undefined}>
                      <td className="px-4 py-1.5 text-slate-500 tabular-nums">{r.on}</td>
                      <td className="px-4 py-1.5">
                        <div className="flex items-center gap-2">
                          {many && <ChevronRight size={13} className={clsx('text-slate-400 transition-transform', shown && 'rotate-90')} />}
                          {r.runId
                            ? <Link to={`/trust/runs/${r.runId}`} onClick={(e) => e.stopPropagation()}
                                className="text-slate-800 hover:text-gold-700 max-w-[30rem] truncate" title={r.label}>{r.label}</Link>
                            : <span className="text-slate-800 max-w-[30rem] truncate" title={r.label}>{r.label}</span>}
                          {r.state && <span className="text-slate-400">· {r.state}</span>}
                          {many && <span className="text-slate-400">· {r.lines.length} {r.lines.length === 1 ? 'line' : 'lines'}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-1.5 text-right tabular-nums text-negative-700">{r.amount < 0 ? money(r.amount) : ''}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums text-positive-700">{r.amount > 0 ? money(r.amount) : ''}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums font-medium">
                        {money(r.balance)} <span className="text-[11px] text-slate-400">{drCr(r.balance)}</span>
                      </td>
                    </tr>
                    {shown && r.lines.map((e, i) => {
                      const meta = KIND[e.kind]
                      return (
                        <tr key={`${r.key}-${i}`} className="bg-slate-50/60 text-slate-600" data-testid="ledger-detail">
                          <td className="px-4 py-1 pl-8 tabular-nums text-slate-400">{e.on}</td>
                          <td className="px-4 py-1">
                            <div className="flex items-center gap-2">
                              <span className="max-w-[26rem] truncate" title={e.description}>{e.description}</span>
                              <span className={clsx('rounded-full px-2 py-px text-[11px] font-medium', meta?.tone ?? 'bg-slate-100 text-slate-600')}>
                                {meta?.label ?? e.kind}
                              </span>
                              {e.caseNumber && <span className="text-slate-400">{e.caseNumber}</span>}
                            </div>
                          </td>
                          <td className="px-4 py-1 text-right tabular-nums">{e.amount < 0 ? money(e.amount) : ''}</td>
                          <td className="px-4 py-1 text-right tabular-nums">{e.amount > 0 ? money(e.amount) : ''}</td>
                          <td />
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-[12.5px] text-slate-500 leading-relaxed">
        One line a payover, and a line for each payover paid, charge and invoice. Open a payover for
        the payments behind it. A debit is the client owing us; a credit is us owing them. What they
        owe comes off their next payover, out of <em>this client&rsquo;s own</em> trust money and
        never anybody else&rsquo;s.
      </p>
    </div>
  )
}
