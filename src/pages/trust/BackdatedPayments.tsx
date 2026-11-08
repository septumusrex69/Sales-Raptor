import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Modal, inputClass } from '../../components/ui/Modal'
import { rand } from '../../lib/money'
import { formatDate } from '../../data/mockData'
import { useAuth } from '../../store/AuthContext'
import { can } from '../../lib/capabilities'
import {
  approveRestatement, cancelRestatement, fetchBackdatedPayments, fetchRestatements, latestByPayment, proposeRestatement,
  type BackdatedPayment, type Restatement, type RestatementFigures,
} from '../../lib/backdatedPayments'

/**
 * BACKDATED PAYMENTS (Raptor H19 / S20, phase 1b-3; the Claude Doc "Payments found late").
 *
 * Every payment a LATER-dated payment on the same account was split before -- a receipt that sat in suspense, a PTC
 * captured late -- so the interest and the splits after it were worked out without it. Each can be worked out again
 * in date order (Propose), shown before and after, and POSTED only when an Administrator with Approve a payment
 * approves it. Nothing paid over is edited: the correction is a new line on the next open payover run, dated the
 * day it is approved, and the debtor's statement shows the payment on the day it was made.
 *
 * WHO SEES WHAT. The list is finance's (the route is behind RequireFinance). Propose and Cancel need payment.approve;
 * Approve needs an Administrator with payment.approve -- the database says the same (propose_restatement,
 * approve_restatement), so a button is never offered and then refused.
 */
export function BackdatedPayments() {
  const { currentUser } = useAuth()
  const mayPropose = can(currentUser, 'finance.view') && can(currentUser, 'payment.approve')
  const mayApprove = mayPropose && currentUser?.role === 'Administrator'
  const [rows, setRows] = useState<BackdatedPayment[] | null>(null)
  const [restatements, setRestatements] = useState<Restatement[]>([])
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<Restatement | null>(null)

  const load = useCallback(async () => {
    try {
      const [b, r] = await Promise.all([fetchBackdatedPayments(), fetchRestatements()])
      setRows(b); setRestatements(r); setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const latest = useMemo(() => latestByPayment(restatements), [restatements])

  async function act(id: string, run: () => Promise<unknown>) {
    setBusy(id); setActionError(null)
    try { await run(); await load() } catch (e) { setActionError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  if (error) return <Card className="p-5 text-sm text-negative-700 bg-negative-50">The backdated payments could not be read: {error}</Card>
  if (!rows) return <div className="flex items-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> Reading backdated payments…</div>

  const waiting = rows.filter((r) => latest.get(r.paymentId)?.status !== 'posted').length
  return (
    <div className="space-y-5" data-testid="backdated-payments">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-xl font-semibold tracking-tight text-slate-800">Backdated payments</h1>
          <p className="mt-1 text-sm text-slate-500">
            Payments dated before a payment that was already split. Worked out again in date order, each one is corrected on the
            next payover run as a new line dated the day it is approved. Nothing already paid over is changed, and the
            debtor&rsquo;s statement shows the payment on the day it was made.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Still to correct</div>
          <div className="text-2xl font-semibold tabular-nums text-slate-800" data-testid="backdated-waiting">{waiting}</div>
        </div>
      </div>

      {actionError && <Card className="p-3 text-sm text-negative-700 bg-negative-50" data-testid="backdated-error">{actionError}</Card>}

      <Card padded={false} className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-positive-700">No payment was split out of date order.</p>
        ) : (
          <table className="w-full list-table whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="px-3 py-2" />
                <th className="px-2 py-2 font-medium">Paid</th>
                <th className="px-2 py-2 font-medium">Captured</th>
                <th className="px-2 py-2 font-medium">Approved</th>
                <th className="px-2 py-2 font-medium">Account</th>
                <th className="px-2 py-2 font-medium">Client</th>
                <th className="px-2 py-2 text-right font-medium">Amount</th>
                <th className="px-2 py-2 font-medium">Split before it</th>
                <th className="px-2 py-2 font-medium">Correction</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rs = latest.get(r.paymentId)
                const isOpen = open === r.paymentId
                return (
                  <Fragment key={r.paymentId}>
                    <tr className="border-b border-slate-50" data-testid="backdated-row">
                      <td className="px-3 py-1.5">
                        {rs && (
                          <button type="button" onClick={() => setOpen(isOpen ? null : r.paymentId)} className="text-slate-400 hover:text-navy-950"
                            aria-label={isOpen ? 'Close the figures' : 'Open the figures'} data-testid="backdated-open">
                            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-slate-700">{formatDate(r.receivedOn)}{r.paidToClient && <span className="ml-1 text-[11px] text-slate-400">PTC</span>}</td>
                      <td className="px-2 py-1.5 text-slate-500">{r.capturedOn ? formatDate(r.capturedOn) : '—'}</td>
                      <td className="px-2 py-1.5 text-slate-500">{r.approvedOn ? formatDate(r.approvedOn) : 'Waiting'}</td>
                      <td className="px-2 py-1.5">
                        <Link to={`/accounts/${r.accountId}`} className="font-medium text-slate-800 hover:underline">{r.caseNumber ?? 'Account'}</Link>
                        {r.debtor && <span className="ml-2 text-slate-400">{r.debtor}</span>}
                      </td>
                      <td className="px-2 py-1.5 text-slate-600">{r.client ?? ''}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium text-slate-800">{rand(r.amount)}</td>
                      <td className="px-2 py-1.5 text-slate-500">
                        {r.laterAllocated} {r.laterAllocated === 1 ? 'payment' : 'payments'}
                        {r.laterInvoiced > 0 && <span className="text-amber-700"> · {r.laterInvoiced} paid over</span>}
                      </td>
                      <td className="px-2 py-1.5" data-testid="backdated-status">{statusWords(rs)}</td>
                      <td className="px-3 py-1.5 text-right">
                        <span className="inline-flex gap-2 text-[12px] font-medium">
                          {mayPropose && (!rs || rs.status === 'cancelled') && (
                            <button type="button" disabled={busy !== null} data-testid="backdated-propose"
                              onClick={() => void act(r.paymentId, async () => { await proposeRestatement(r.paymentId, null); setOpen(r.paymentId) })}
                              className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                              {busy === r.paymentId ? 'Working it out…' : 'Work out the correction'}
                            </button>
                          )}
                          {mayApprove && rs?.status === 'proposed' && !rs.blockedReason && (
                            <button type="button" disabled={busy !== null} data-testid="backdated-approve"
                              onClick={() => void act(rs.id, () => approveRestatement(rs.id))}
                              className="rounded-md bg-navy-900 px-2.5 py-1 text-white hover:bg-navy-800 disabled:opacity-50">
                              {busy === rs.id ? 'Posting…' : 'Approve and post'}
                            </button>
                          )}
                          {mayPropose && rs?.status === 'proposed' && (
                            <button type="button" disabled={busy !== null} onClick={() => setCancelling(rs)} data-testid="backdated-cancel"
                              className="rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                              Cancel
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                    {isOpen && rs && (
                      <tr className="border-b border-slate-100 bg-slate-50/60">
                        <td colSpan={10} className="px-5 py-4 whitespace-normal"><Figures r={rs} /></td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      {cancelling && (
        <CancelBox onClose={() => setCancelling(null)}
          onSave={async (reason) => { await act(cancelling.id, () => cancelRestatement(cancelling.id, reason)); setCancelling(null) }} />
      )}
    </div>
  )
}

function statusWords(r: Restatement | undefined) {
  if (!r) return <span className="text-slate-400">Not worked out</span>
  if (r.status === 'posted') {
    return <span className="text-positive-700">Posted {r.postedAt ? formatDate(r.postedAt.slice(0, 10)) : ''}{r.postedByName ? ` by ${r.postedByName}` : ''}</span>
  }
  if (r.status === 'cancelled') return <span className="text-slate-400">Cancelled{r.cancelReason ? `: ${r.cancelReason}` : ''}</span>
  if (r.blockedReason) return <span className="text-amber-700" title={r.blockedReason}>Decide by hand</span>
  return (
    <span className="text-slate-700">
      Waiting for approval · client {r.clientCorrection >= 0 ? '+' : ''}{rand(r.clientCorrection)}
    </span>
  )
}

/** BEFORE, AFTER AND THE DIFFERENCE, payment by payment, then for the account -- the doc's correction table. */
function Figures({ r }: { r: Restatement }) {
  const f: RestatementFigures = r.figures
  const sign = (x: number) => (x > 0 ? `+${rand(x)}` : rand(x))
  return (
    <div className="space-y-3 text-[12.5px]" data-testid="backdated-figures">
      {r.blockedReason && <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900" data-testid="backdated-blocked">{r.blockedReason}</p>}
      <table className="w-full whitespace-nowrap">
        <thead>
          <tr className="text-left text-slate-400">
            <th className="py-1 pr-3 font-medium">Payment</th>
            <th className="py-1 pr-3 font-medium" />
            <th className="py-1 pr-3 text-right font-medium">Interest</th>
            <th className="py-1 pr-3 text-right font-medium">Fees</th>
            <th className="py-1 pr-3 text-right font-medium">Capital</th>
            <th className="py-1 pr-3 text-right font-medium">Commission incl. VAT</th>
            <th className="py-1 pr-3 text-right font-medium">To the client</th>
          </tr>
        </thead>
        <tbody>
          {f.lines.map((l) => {
            const was = l.old
            return (
              <Fragment key={l.payment_id}>
                {l.was_split && (
                  <tr className="text-slate-500">
                    <td className="py-0.5 pr-3">{formatDate(l.day)} · {rand(l.amount)}{l.run ? ` · ${l.run}` : ''}</td>
                    <td className="py-0.5 pr-3">Paid over</td>
                    <td className="py-0.5 pr-3 text-right tabular-nums">{rand(Number(was.to_interest ?? 0))}</td>
                    <td className="py-0.5 pr-3 text-right tabular-nums">{rand(Number(was.to_costs ?? 0))}</td>
                    <td className="py-0.5 pr-3 text-right tabular-nums">{rand(Number(was.to_capital ?? 0))}</td>
                    <td className="py-0.5 pr-3 text-right tabular-nums">{rand(Number(was.commission ?? 0) + Number(was.commission_vat ?? 0))}</td>
                    <td className="py-0.5 pr-3 text-right tabular-nums">{rand(Number(was.to_client ?? 0))}</td>
                  </tr>
                )}
                <tr className="text-slate-700">
                  <td className="py-0.5 pr-3">{l.was_split ? '' : `${formatDate(l.day)} · ${rand(l.amount)} · found late`}</td>
                  <td className="py-0.5 pr-3">{l.was_split ? 'Should have been' : 'Its split'}</td>
                  <td className="py-0.5 pr-3 text-right tabular-nums">{rand(l.new.to_interest)}</td>
                  <td className="py-0.5 pr-3 text-right tabular-nums">{rand(l.new.to_costs)}</td>
                  <td className="py-0.5 pr-3 text-right tabular-nums">{rand(l.new.to_capital)}</td>
                  <td className="py-0.5 pr-3 text-right tabular-nums">{rand(l.new.commission + l.new.commission_vat)}</td>
                  <td className="py-0.5 pr-3 text-right tabular-nums">{rand(l.new.to_client)}</td>
                </tr>
                {l.was_split && l.changed && (
                  <tr className="font-medium text-slate-900" data-testid="backdated-correction-line">
                    <td className="py-0.5 pr-3" />
                    <td className="py-0.5 pr-3">Correction</td>
                    <td className="py-0.5 pr-3 text-right tabular-nums">{sign(l.delta.to_interest)}</td>
                    <td className="py-0.5 pr-3 text-right tabular-nums">{sign(l.delta.to_costs)}</td>
                    <td className="py-0.5 pr-3 text-right tabular-nums">{sign(l.delta.to_capital)}</td>
                    <td className="py-0.5 pr-3 text-right tabular-nums">{sign(l.delta.commission + l.delta.commission_vat)}</td>
                    <td className="py-0.5 pr-3 text-right tabular-nums">{sign(l.delta.to_client)}</td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      <p className="text-slate-600" data-testid="backdated-summary">
        The client {f.client_correction >= 0 ? 'receives' : 'gives back'} <strong>{rand(Math.abs(f.client_correction))}</strong> on the next payover run
        and the firm {f.firm_correction <= 0 ? 'keeps' : 'gains'} <strong>{rand(Math.abs(f.firm_correction))}</strong> {f.firm_correction <= 0 ? 'less' : 'more'}.
        Interest charged to the debtor goes from {rand(f.interest_before)} to {rand(f.interest_after)} ({sign(f.interest_correction)});
        capital outstanding from {rand(f.capital_before)} to {rand(f.capital_after)}.
      </p>
      <WhatPosts r={r} />
      <p className="text-[11.5px] text-slate-400">
        Proposed {formatDate(r.proposedAt.slice(0, 10))}{r.proposedByName ? ` by ${r.proposedByName}` : ''}
        {r.postedAt ? ` · posted ${formatDate(r.postedAt.slice(0, 10))}${r.postedByName ? ` by ${r.postedByName}` : ''}` : ''}
      </p>
    </div>
  )
}

/**
 * EXACTLY WHAT APPROVING POSTS (S20 review). Each changed payment gets a R0.00 correction receipt carrying the
 * difference -- these are the engine's own figures, the ones the run will pay -- and the trust ledger moves the
 * client's share between the client and the firm. Nothing already posted is edited. Approval is refused when the
 * engine's figure for the client and capital less commission disagree (restatement_figures blocks it).
 */
function WhatPosts({ r }: { r: Restatement }) {
  const f = r.figures
  const sign = (x: number) => (x > 0 ? `+${rand(x)}` : rand(x))
  const posts = f.lines.filter((l) => l.was_split && l.changed)
  const engine = f.client_engine
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2" data-testid="backdated-what-posts">
      <p className="font-medium text-slate-800">{r.status === 'posted' ? 'What was posted' : 'What approving posts'}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-600">
        {posts.map((l) => (
          <li key={l.payment_id}>
            A correction receipt of R0.00 against the payment of {formatDate(l.day)}: interest {sign(l.delta.to_interest)},
            fees {sign(l.delta.to_costs)}, capital {sign(l.delta.to_capital)},
            commission incl. VAT {sign(l.delta.commission + l.delta.commission_vat)},
            {l.ptc ? ` owed to the firm by the client (it holds the money) ${sign(Number(l.delta.due_to_bf ?? 0))}` : ` to the client ${sign(l.delta.to_client)}`}
            {' '}— its own line on the next payover run.
          </li>
        ))}
        <li>
          The trust ledger: the client {sign(f.client_correction)}, the firm {sign(f.firm_correction)}
          {engine !== undefined && (
            <span data-testid="backdated-engine"> (the engine's figure for the client: {sign(engine)}
              {Math.round(engine * 100) !== Math.round(f.client_correction * 100) ? ' — it differs, so this cannot be approved' : ', the same'})</span>
          )}.
        </li>
        {f.interest_correction !== 0 && (
          <li>The debtor: one interest line of {sign(f.interest_correction)}, shown on the statement as "Interest corrected".</li>
        )}
        <li>The payment found late is approved with its own split, in date order.</li>
      </ul>
      <p className="mt-1.5 text-[11.5px] text-slate-500" data-testid="backdated-reverse-note">
        Once posted, the payment found late (and its correction receipts) can be reversed only by finance, by hand.
        A later receipt on the same account still reverses in the ordinary way.
      </p>
    </div>
  )
}

function CancelBox({ onClose, onSave }: { onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('')
  return (
    <Modal title="Cancel this correction" onClose={onClose}
      footer={(
        <button type="button" disabled={reason.trim().length < 5} onClick={() => void onSave(reason.trim())}
          className="rounded-lg bg-navy-900 px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-50">
          Cancel the correction
        </button>
      )}>
      <label className="block text-[12.5px] text-slate-600">
        Why
        <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why" />
      </label>
    </Modal>
  )
}
