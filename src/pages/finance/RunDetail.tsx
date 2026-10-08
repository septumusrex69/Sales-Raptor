import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Loader2, X } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { Modal, inputClass } from '../../components/ui/Modal'
import { rand, ratePercent } from '../../lib/money'
import { supabase } from '../../lib/supabase'
import {
  RUN_STATUS_LABEL, approveRun, fetchPaymentAudit, fetchRunPayments, markRunPaid,
  type RunPayment, type RunStatus,
} from '../../lib/payover'
import { adviceBody, adviceSubject, buildRemittanceAdvice } from '../../lib/remittanceAdvice'
import { remittancePdf } from '../../lib/remittancePdf'
import { paymentReference } from '../../lib/paymentsOut'
import { fetchPayoutsStatementOnly } from '../../lib/trust'
import { sendRemittanceAdvice } from '../../lib/remittanceEmail'

/**
 * ONE PAYOVER RUN, AND THE PAYMENTS UNDER IT.
 *
 * Prompt 7's shape: a short reconciliation first -- the five lines a client would check -- then
 * the payments, then one payment's full split in a side panel with its audit history. The
 * reconciliation is deliberately the same five lines that appear on the remittance advice, so
 * that what the firm approves and what the client receives cannot read differently.
 *
 * THE FIGURES ARE THE RUN'S OWN, NOT A SUM OF WHAT IS ON SCREEN. `payover_runs` carries the
 * totals it was built with, and an approved run's are frozen; adding up the visible rows would
 * quietly disagree with the invoice the moment a filter is applied, which is the failure that
 * gets found at month end rather than here.
 */

interface RunRow {
  id: string
  invoice_number: string
  status: RunStatus
  period_start: string
  period_end: string
  trust_capital: number
  trust_commission: number
  due_to_client: number
  ptc_received: number
  ptc_fees_taken: number
  ptc_capital: number
  ptc_commission: number
  due_to_bf: number
  commission_vat: number
  carried_in: number
  charges_set_off: number
  excess_released: number
  net_payover: number
  approved_at: string | null
  sent_at: string | null
  paid_at: string | null
  eft_reference: string | null
  company_id: string
}

const STATUS_TONE: Record<RunStatus, string> = {
  needs_review: 'bg-amber-100 text-amber-800',
  ready: 'bg-sky-100 text-sky-800',
  approved: 'bg-slate-200 text-slate-700',
  sent: 'bg-gold-100 text-gold-800',
  paid: 'bg-emerald-100 text-emerald-700',
  void: 'bg-slate-100 text-slate-400',
}

export function RunDetail() {
  const { id = '' } = useParams()
  const [run, setRun] = useState<RunRow | null>(null)
  const [client, setClient] = useState<{ name: string; code: string | null; rate: number | null; vatNumber: string | null; email: string | null } | null>(null)
  const [blockers, setBlockers] = useState<{ kind: string; detail: string; amount: number | null }[]>([])
  const [rows, setRows] = useState<RunPayment[]>([])
  const [open, setOpen] = useState<RunPayment | null>(null)
  const [audit, setAudit] = useState<{ at: string; what: string; who: string }[]>([])
  const [filter, setFilter] = useState('')
  const [onlyExceptions, setOnlyExceptions] = useState(false)
  const [loading, setLoading] = useState(true)
  /* Payments out confirmed from the statement only (Trust settings): then there is no Mark paid. */
  const [statementOnly, setStatementOnly] = useState(false)
  useEffect(() => { fetchPayoutsStatementOnly().then(setStatementOnly).catch(() => {}) }, [])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [payModal, setPayModal] = useState(false)
  const [emailModal, setEmailModal] = useState(false)
  const [firm, setFirm] = useState<{ name: string; address: string | null; phone: string | null; email: string | null; vatNumber: string | null } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: e } = await supabase
        .from('payover_runs')
        .select('*, companies(name, code, commission_rate, vat_number, email)')
        .eq('id', id)
        .maybeSingle()
      if (e) throw new Error(e.message)
      if (!data) throw new Error('That payover run is no longer here.')
      const d = data as unknown as RunRow & { companies: { name: string; code: string | null; commission_rate: number | null; vat_number: string | null; email: string | null } }
      setRun(d)
      setClient({
        name: d.companies?.name ?? '', code: d.companies?.code ?? null,
        rate: d.companies?.commission_rate ?? null,
        vatNumber: d.companies?.vat_number ?? null, email: d.companies?.email ?? null,
      })
      const { data: b } = await supabase.rpc('payover_run_blockers', { p_run: id })
      setBlockers(((b ?? []) as Record<string, unknown>[]).map((x) => ({
        kind: String(x.kind), detail: String(x.detail),
        amount: x.amount === null || x.amount === undefined ? null : Number(x.amount),
      })))
      const { data: fs } = await supabase.from('firm_settings')
        .select('firm_name, physical_address, phone, email, vat_number').limit(1).maybeSingle()
      const f = fs as { firm_name: string; physical_address: string | null; phone: string | null; email: string | null; vat_number: string | null } | null
      setFirm(f ? {
        name: f.firm_name, address: f.physical_address, phone: f.phone,
        email: f.email, vatNumber: f.vat_number,
      } : null)
      setRows(await fetchRunPayments(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that run.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!open?.paymentId) { setAudit([]); return }
    let alive = true
    void fetchPaymentAudit(open.paymentId).then((a) => { if (alive) setAudit(a) }).catch(() => setAudit([]))
    return () => { alive = false }
  }, [open?.paymentId])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return rows.filter((r) => {
      if (onlyExceptions && !(r.needsRate || r.excessCredit > 0)) return false
      if (!q) return true
      return r.debtor.toLowerCase().includes(q)
        || (r.caseNumber ?? '').toLowerCase().includes(q)
        || (r.clientReference ?? '').toLowerCase().includes(q)
    })
  }, [rows, filter, onlyExceptions])

  /*
   * THE SAME MODEL THE PDF AND THE EMAIL ARE BUILT FROM, assembled here from the run and its
   * lines. Built once rather than twice: a preview that disagreed with the attachment would be
   * found by a client, not by us.
   */
  const advice = useMemo(() => {
    if (!run || !client || !firm) return null
    return buildRemittanceAdvice({
      firm,
      client: { name: client.name, code: client.code, vatNumber: client.vatNumber },
      run: {
        invoiceNumber: run.invoice_number,
        periodStart: run.period_start, periodEnd: run.period_end,
        issuedOn: (run.approved_at ?? new Date().toISOString()).slice(0, 10),
        trustCapital: run.trust_capital, trustCommission: run.trust_commission,
        dueToClient: run.due_to_client, ptcReceived: run.ptc_received,
        ptcFeesTaken: run.ptc_fees_taken, ptcCapital: run.ptc_capital,
        ptcCommission: run.ptc_commission, dueToBf: run.due_to_bf,
        commissionVat: run.commission_vat, carriedIn: run.carried_in,
        chargesSetOff: Number(run.charges_set_off ?? 0), excessReleased: Number(run.excess_released ?? 0),
        netPayover: run.net_payover, commissionRate: client.rate,
        paidAt: run.paid_at, eftReference: run.eft_reference,
      },
      lines: rows,
    })
  }, [run, client, firm, rows])

  async function openPdf() {
    if (!advice) return
    setBusy(true); setError(null)
    try {
      const { bytes, problem } = await remittancePdf(advice)
      if (problem) { setError(problem); return }
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not draw the statement.')
    } finally { setBusy(false) }
  }

  async function act(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn(); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'That did not work.') }
    finally { setBusy(false) }
  }

  if (loading) return <div className="py-16 text-center text-slate-400"><Loader2 className="mx-auto w-5 h-5 animate-spin" /></div>
  if (!run) return <div className="py-16 text-center text-sm text-slate-400">{error ?? 'Not found.'}</div>

  return (
    <div className="space-y-4">
      <Link to="/trust/payover" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="w-4 h-4" /> Payover queue
      </Link>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-negative-50 px-4 py-3 text-sm text-negative-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{client?.name}</h2>
            <p className="text-sm text-slate-400">
              {run.invoice_number} · {fmtDay(run.period_start)} – {fmtDay(run.period_end)}
              {client?.code ? ` · client ${client.code}` : ''}
            </p>
            {/* THE REFERENCE TO PAY IT ON (the firm, 8 Oct): the one the statement match looks for. */}
            {paymentReference(run.invoice_number) && run.status !== 'paid' && (
              <p className="text-[12.5px] text-slate-500 mt-0.5" data-testid="run-pay-reference">
                Pay with reference <span className="font-mono text-slate-700">{paymentReference(run.invoice_number)}</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={clsx('rounded-full px-2.5 py-1 text-[11.5px] font-semibold', STATUS_TONE[run.status])}>
              {RUN_STATUS_LABEL[run.status]}
            </span>
            {run.status === 'ready' && (
              <button type="button" disabled={busy} onClick={() => void act(() => approveRun(run.id))}
                className="rounded-lg bg-navy-900 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-navy-800 disabled:opacity-50">
                Approve
              </button>
            )}
            <button type="button" disabled={busy || !advice} onClick={() => void openPdf()}
              className="rounded-lg border border-slate-200 px-3.5 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50">
              Preview statement
            </button>
            {run.status === 'approved' && (
              <button type="button" disabled={busy || !advice} onClick={() => setEmailModal(true)}
                className="rounded-lg bg-navy-900 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-navy-800 disabled:opacity-50">
                Email advice
              </button>
            )}
            {(run.status === 'approved' || run.status === 'sent') && statementOnly && (
              <span className="text-[12px] text-slate-500" data-testid="paid-from-statement">
                Paid when its line on the bank statement is allocated
              </span>
            )}
            {(run.status === 'approved' || run.status === 'sent') && !statementOnly && (
              <button type="button" disabled={busy} onClick={() => setPayModal(true)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                Mark paid
              </button>
            )}
          </div>
        </div>

        {blockers.length > 0 && (
          <div className="mt-4 space-y-1.5 rounded-lg bg-amber-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-amber-700">
              Cannot be approved yet
            </div>
            {blockers.map((b) => (
              <div key={b.kind} className="flex items-start justify-between gap-3 text-[13px] text-amber-900">
                <span>{b.detail}</span>
                {b.amount !== null && <span className="shrink-0 tabular-nums">{rand(b.amount)}</span>}
              </div>
            ))}
            <Link to="/trust/exceptions" className="inline-block pt-1 text-[12.5px] font-medium text-amber-800 underline">
              Work through the exceptions
            </Link>
          </div>
        )}

        {/* THE RECONCILIATION, in the five lines the client's advice carries. */}
        <table className="mt-5 w-full max-w-lg text-sm">
          <tbody>
            <Line label="Capital collected by BF" value={run.trust_capital} />
            <Line label={`Commission${client?.rate != null ? ` (${ratePercent(client.rate)})` : ''}`} value={-run.trust_commission} sub />
            <Line label="Set-off: debtors paid the client directly" value={-run.due_to_bf} sub />
            <Line label="VAT on commission" value={-run.commission_vat} sub />
            {run.carried_in !== 0 && <Line label="Brought forward from last run" value={run.carried_in} sub />}
            {/* Both already in "Amount to pay" and on no line above it (the firm, 8 Oct). */}
            {Number(run.charges_set_off) !== 0 && <Line label="Charges set off against this payover" value={-run.charges_set_off} sub />}
            {Number(run.excess_released) !== 0 && <Line label="Overpayments released to the client, no commission" value={run.excess_released} sub />}
            <tr className="border-t-2 border-slate-800">
              <td className="py-2 font-semibold text-slate-800">Amount to pay</td>
              <td className="py-2 text-right font-semibold tabular-nums text-slate-800">{rand(run.net_payover)}</td>
            </tr>
          </tbody>
        </table>

        {run.ptc_received > 0 && (
          <p className="mt-2 max-w-lg text-xs text-slate-400">
            Debtors paid the client {rand(run.ptc_received)} directly this cycle. BF recovered
            {' '}{rand(run.ptc_fees_taken)} of its Annexure B fees and interest from it, and
            {' '}{rand(run.ptc_commission)} commission on the {rand(run.ptc_capital)} capital portion.
          </p>
        )}
        {run.eft_reference && (
          <p className="mt-2 text-xs text-slate-400">Paid by EFT {run.eft_reference}{run.paid_at ? ` on ${fmtDay(run.paid_at.slice(0, 10))}` : ''}.</p>
        )}
      </Card>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a debtor, our reference or the client's"
            className={clsx(inputClass, 'max-w-xs')}
          />
          <label className="flex items-center gap-2 text-[13px] text-slate-600">
            <input type="checkbox" checked={onlyExceptions} onChange={(e) => setOnlyExceptions(e.target.checked)} />
            Only the ones with something wrong
          </label>
          <span className="ml-auto text-xs text-slate-400">{shown.length} of {rows.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11.5px] font-medium uppercase tracking-[0.06em] text-slate-400">
                <th className="px-4 py-2.5">Debtor</th>
                <th className="px-4 py-2.5">Paid</th>
                <th className="px-4 py-2.5 text-right">Capital received</th>
                <th className="px-4 py-2.5 text-right">Commission</th>
                <th className="px-4 py-2.5 text-right">VAT</th>
                <th className="px-4 py-2.5 text-right">Capital outstanding</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.lineId} onClick={() => setOpen(r)}
                  className={clsx('cursor-pointer border-b border-slate-50 text-sm hover:bg-slate-50',
                    r.lineKind === 'reversal' && 'text-negative-700')}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{r.lineKind === 'carried' ? 'Brought forward' : r.debtor}</div>
                    <div className="text-xs text-slate-400">
                      {r.caseNumber ?? ''}{r.clientReference ? ` · your ref ${r.clientReference}` : ''}
                      {r.lineKind === 'ptc' && ' · paid you directly'}
                      {r.lineKind === 'reversal' && ' · reversed after the last run'}
                      {r.lateCapture && ' · captured after the previous cut-off'}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{r.receivedAt ? fmtDay(r.receivedAt.slice(0, 10)) : '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {r.lineKind === 'carried' ? rand(r.carriedAmount) : rand(r.toCapital)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.lineKind === 'carried' ? '—' : rand(r.commission)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.lineKind === 'carried' ? '—' : rand(r.commissionVat)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                    {r.lineKind === 'carried' ? '—' : rand(r.capitalAfter)}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">Nothing matches that.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {open && <PaymentPanel row={open} audit={audit} onClose={() => setOpen(null)} />}
      {emailModal && advice && run && (
        <EmailAdviceModal
          advice={advice}
          runId={run.id}
          defaultTo={client?.email ?? ''}
          onClose={() => setEmailModal(false)}
          onSent={async () => { setEmailModal(false); await load() }}
        />
      )}
      {payModal && run && (
        <MarkPaidModal
          suggested={paymentReference(run.invoice_number) ?? ''}
          onClose={() => setPayModal(false)}
          onSave={async (ref, date) => {
            await act(() => markRunPaid(run.id, ref, new Date(`${date}T12:00:00`).toISOString()))
            setPayModal(false)
          }}
        />
      )}
    </div>
  )
}

function Line({ label, value, sub }: { label: string; value: number; sub?: boolean }) {
  return (
    <tr className="border-b border-slate-100">
      <td className={clsx('py-1.5', sub ? 'pl-4 text-slate-500' : 'text-slate-700')}>{label}</td>
      <td className={clsx('py-1.5 text-right tabular-nums', sub ? 'text-slate-500' : 'text-slate-700')}>
        {value < 0 ? `− ${rand(Math.abs(value))}` : rand(value)}
      </td>
    </tr>
  )
}

/**
 * ONE PAYMENT, ALL THE WAY DOWN — and this is the only place the gross amount appears.
 *
 * The client's advice shows the capital portion and nothing else, because that is the only part
 * that is theirs. Here the firm sees what the debtor actually paid, what the receipt fee took,
 * what went to interest and costs, and what was left for capital. The firm's own rule, from the
 * board: "Only BF sees the gross payment amount on trust-account payments."
 */
function PaymentPanel({ row, audit, onClose }: {
  row: RunPayment; audit: { at: string; what: string; who: string }[]; onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/20" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-800">{row.lineKind === 'carried' ? 'Brought forward' : row.debtor}</h3>
            <p className="text-xs text-slate-400">
              {row.caseNumber ?? ''}{row.receivedAt ? ` · ${fmtDay(row.receivedAt.slice(0, 10))}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        {row.lineKind === 'carried' ? (
          <p className="mt-4 text-sm text-slate-600">
            Last run came out at {rand(row.carriedAmount)} — the client owed BF more than BF collected for
            them — so it opens this one rather than being invoiced on its own.
          </p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <tbody>
              <Line label={row.paidToClient ? 'Paid to the client directly' : 'Paid into the trust account'} value={row.paymentAmount} />
              <Line label="Receipt fee charged (Annexure B item 9)" value={row.receiptFee} sub />
              <Line label="Half A → interest" value={row.toInterest} sub />
              <Line label="Half A → costs, incl the receipt fee" value={row.toCosts} sub />
              <Line label="Half B → capital (what the client sees)" value={row.toCapital} />
              <Line label="Commission" value={-row.commission} sub />
              <Line label="VAT on commission" value={-row.commissionVat} sub />
              {row.excessCredit > 0 && <Line label="Overpaid — held as a credit" value={row.excessCredit} sub />}
              <tr className="border-t-2 border-slate-800">
                <td className="py-2 font-semibold text-slate-800">
                  {row.paidToClient ? 'Due to BF' : 'To the client'}
                </td>
                <td className="py-2 text-right font-semibold tabular-nums text-slate-800">
                  {rand(row.paidToClient ? row.dueToBf : row.toClient)}
                </td>
              </tr>
            </tbody>
          </table>
        )}

        {row.needsRate && (
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-[13px] text-amber-900">
            No commission rate on this account or its client, so nothing was taken. The client would
            be paid all of the capital until somebody sets one.
          </p>
        )}

        <div className="mt-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">Audit history</div>
          <ol className="mt-2 space-y-1.5 text-[13px] text-slate-600">
            {audit.map((a, i) => (
              <li key={`${a.at}-${i}`} className="flex gap-2">
                <span className="shrink-0 tabular-nums text-xs text-slate-400">{fmtStamp(a.at)}</span>
                <span>{a.what}{a.who && a.who !== '—' ? ` · ${a.who}` : ''}</span>
              </li>
            ))}
            {audit.length === 0 && <li className="text-slate-400">Nothing recorded for this line.</li>}
          </ol>
        </div>
        {row.accountId && (
          <Link to={`/accounts/${row.accountId}`} className="mt-5 inline-block text-[13px] font-medium text-navy-700 underline">
            Open the account
          </Link>
        )}
      </div>
    </div>
  )
}

/** 'Mark paid' asks for the EFT reference and the date — the firm's own instruction. The
 *  reference is what reconciles this invoice to the bank statement, so it is required. */
function MarkPaidModal({ suggested, onClose, onSave }: {
  /** The reference it should have gone out on; still editable, because the bank's wins. */
  suggested: string
  onClose: () => void
  onSave: (ref: string, date: string) => Promise<void>
}) {
  const [ref, setRef] = useState(suggested)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Mark this payover paid" onClose={onClose} width={420}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">EFT reference</label>
          <input value={ref} onChange={(e) => setRef(e.target.value)} className={inputClass} placeholder="As it appears on the bank statement" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Payment date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button
            type="button"
            disabled={busy || !ref.trim()}
            onClick={() => { setBusy(true); void onSave(ref, date).finally(() => setBusy(false)) }}
            className="rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
          >
            Mark paid
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * EMAILING THE ADVICE, with the message shown before it goes.
 *
 * The recipient defaults to the client's own address and is editable, because the person who
 * receives statements is often not the person on the client record. The body is the one the
 * client will actually get -- blank lines and all -- rather than a summary of it.
 */
function EmailAdviceModal({ advice, runId, defaultTo, onClose, onSent }: {
  advice: ReturnType<typeof buildRemittanceAdvice>
  runId: string
  defaultTo: string
  onClose: () => void
  onSent: () => Promise<void>
}) {
  const [to, setTo] = useState(defaultTo)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title="Email the remittance advice" onClose={onClose} width={520}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">To</label>
          <input value={to} onChange={(e) => setTo(e.target.value)} className={inputClass}
            placeholder="statements@client.co.za" />
          {!defaultTo && (
            <p className="mt-1 text-xs text-amber-700">
              This client has no email address on file, so there is nothing to fall back on.
            </p>
          )}
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-600">Subject</div>
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-700">{adviceSubject(advice)}</div>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-600">Message</div>
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-[13px] font-sans text-slate-700">
            {adviceBody(advice)}
          </pre>
        </div>
        <p className="text-xs text-slate-400">
          {advice.run.invoiceNumber}.pdf and the same detail as a spreadsheet are attached —
          {' '}{advice.collections.length} collection{advice.collections.length === 1 ? '' : 's'}
          {advice.direct.length > 0 ? ` and ${advice.direct.length} paid to you directly` : ''}.
          The run is marked sent only once the message has actually gone.
        </p>
        {advice.problems.length > 0 && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            {advice.problems.map((p) => <div key={p}>{p}</div>)}
          </div>
        )}
        {error && <p className="rounded-lg bg-negative-50 px-3 py-2 text-[13px] text-negative-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button type="button" disabled={busy || !to.trim()}
            onClick={() => {
              setBusy(true); setError(null)
              void sendRemittanceAdvice(advice, to.trim(), runId)
                .then(onSent)
                .catch((e: unknown) => setError(e instanceof Error ? e.message : 'It would not send.'))
                .finally(() => setBusy(false))
            }}
            className="rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
            {busy ? 'Sending…' : 'Send it'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
