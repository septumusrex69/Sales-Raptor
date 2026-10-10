import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Check, Copy, Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Modal, FormField, inputClass, controlClass } from '../../components/ui/Modal'
import { rand } from '../../lib/money'
import { fetchPaymentsOutPaid, fetchPaymentsToMake, markRefundPaid } from '../../lib/bankAllocationApi'
import { markRunPaid } from '../../lib/payover'
import { fetchPayoutsStatementOnly, fetchTrustPosition } from '../../lib/trust'
import { drawFromTrust } from '../../lib/businessApi'
import { canDrawFromTrust } from '../../lib/permissions'
import { useAuth } from '../../store/AuthContext'
import { totalToPay, transferReference, type PaidOut, type PaymentToMake } from '../../lib/paymentsOut'
import { shortDate } from '../../lib/trustCycles'

/**
 * PAYMENTS TO MAKE OUT OF TRUST, AND WHAT HAS GONE.
 *
 * THE FIRM, 8 Oct: "every payment should be [in] payments to make ... a queue for payments to make,
 * or what should go out, and what has gone out" -- client payovers, refunds, and the firm's own
 * transfer to its business account -- each with the reference it is paid on ("a client unique
 * reference ... BF for Bredell Ferreira"; a refund "with the debtor's reference number").
 *
 * COMPLETED FROM TWO PLACES, CONFIRMED BY ONE. A payment is marked paid here or on its payover run
 * (the firm: "you can do that function from the client ... payover"), and moves to Paid as
 * "waiting for the statement". The trust statement is what confirms it: when its debit is
 * allocated under Exceptions -- Raptor suggests the match from the reference -- it reads "on the
 * statement". Marking by hand never stops that match; it only records what was done at the bank.
 */
type Tab = 'pay' | 'paid'
type Paying = { kind: 'payover' | 'refund'; id: string; payee: string; amount: number; reference: string }

export function TrustPaymentsOut() {
  const { currentUser } = useAuth()
  const [tab, setTab] = useState<Tab>('pay')
  const [rows, setRows] = useState<PaymentToMake[] | null>(null)
  const [paid, setPaid] = useState<PaidOut[] | null>(null)
  const [firmHeld, setFirmHeld] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [paying, setPaying] = useState<Paying | null>(null)
  const [drawing, setDrawing] = useState(false)
  /* Payments out confirmed from the statement only (Trust settings): then there is no Mark paid. */
  const [statementOnly, setStatementOnly] = useState(false)

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' })
  const since = new Date(Date.now() - 90 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' })

  const load = useCallback(async () => {
    try {
      const [due, gone, pos, only] = await Promise.all([
        fetchPaymentsToMake(), fetchPaymentsOutPaid(since),
        /* The firm's share is shown to say what MAY be drawn; the list stands without it. */
        fetchTrustPosition().catch(() => null),
        fetchPayoutsStatementOnly().catch(() => false),
      ])
      setRows(due); setPaid(gone); setFirmHeld(pos ? pos.owedToFirm : null); setStatementOnly(only)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [since])

  useEffect(() => { void load() }, [load])

  async function copy(ref: string) {
    try {
      await navigator.clipboard.writeText(ref)
      setCopied(ref)
      setTimeout(() => setCopied((c) => (c === ref ? null : c)), 1500)
    } catch { /* the reference is on screen to type; copying is a convenience */ }
  }

  if (error) {
    return (
      <Card className="p-5 text-sm text-negative-700 bg-negative-50 border-negative-100">
        The payments to make could not be read: {error}
      </Card>
    )
  }
  if (rows === null || paid === null) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-sm py-10">
        <Loader2 size={16} className="animate-spin" /> Reading what is still to be paid…
      </div>
    )
  }

  const runs = rows.filter((r) => r.kind === 'payover')
  const refunds = rows.filter((r) => r.kind === 'refund')
  const waiting = paid.filter((p) => !p.confirmed)
  const mayDraw = canDrawFromTrust(currentUser)

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">Payments to make</h1>
        <span className="text-xs text-slate-400">Out of the trust account, each with the reference to pay it on</span>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-100 pb-2">
        {([['pay', 'To pay', rows.length], ['paid', 'Paid', waiting.length]] as const).map(([id, label, n]) => (
          <button key={id} type="button" onClick={() => setTab(id)} aria-pressed={tab === id}
            className={clsx('rounded-lg px-3 py-1.5 text-[13.5px] font-medium transition-colors',
              tab === id ? 'bg-gold-50 text-gold-800' : 'text-slate-500 hover:bg-slate-100')}>
            {label}
            {n > 0 && <span className="ml-1.5 text-slate-400 tabular-nums">{n}</span>}
          </button>
        ))}
      </div>

      {tab === 'pay' ? (
        <>
          <Card className="px-6 py-5">
            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2" data-testid="to-pay-total">
              <div>
                <div className="text-[12px] text-slate-500">Still to pay</div>
                <div className="text-2xl font-semibold tabular-nums text-slate-800">{rand(totalToPay(rows))}</div>
              </div>
              <div className="text-[13px] text-slate-500">
                {runs.length} {runs.length === 1 ? 'payover' : 'payovers'} · {refunds.length} {refunds.length === 1 ? 'refund' : 'refunds'}
              </div>
            </div>
            <p className="mt-3 max-w-3xl text-[12.5px] leading-relaxed text-slate-500">
              Pay each one at the bank <strong className="font-medium text-slate-700">with the reference shown</strong>
              {statementOnly ? '. ' : ', then mark it paid here or on its run. '}
              When it appears on the trust statement, allocate the line under Exceptions — Raptor suggests the
              match from the reference — and it reads as confirmed under Paid.
            </p>
          </Card>

          {/* THE FIRM'S OWN SHARE: not owed out like the rest, but drawn when the firm chooses. */}
          {firmHeld !== null && firmHeld > 0.004 && (
            <Card className="px-6 py-4" >
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2" data-testid="firm-to-draw">
                <div className="flex-1 min-w-[16rem]">
                  <div className="font-medium text-slate-800">Bredell Ferreira (business account)</div>
                  <div className="text-[12.5px] text-slate-500">
                    Earned and still held in trust — the most that may be transferred. Reference {transferReference(today)}.
                  </div>
                </div>
                <div className="text-lg font-semibold tabular-nums text-slate-800">{rand(firmHeld)}</div>
                {mayDraw ? (
                  <button type="button" onClick={() => setDrawing(true)}
                    className="rounded-lg bg-navy-900 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-navy-800">
                    Record a transfer
                  </button>
                ) : (
                  <span className="text-[12px] text-slate-400">Recording a transfer needs the trust and business ticks</span>
                )}
              </div>
            </Card>
          )}

          {rows.length === 0 ? (
            <Card className="p-6 text-sm text-slate-500 text-center">
              Nothing is waiting to be paid. Approved payover runs and decided refunds appear here until they are paid.
            </Card>
          ) : (
            <Card padded={false} className="overflow-x-auto">
              <table className="w-full text-[12.5px] whitespace-nowrap">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-100">
                    <th className="font-medium text-left px-3 py-2">Pay to</th>
                    <th className="font-medium text-left px-2 py-2">Bank details</th>
                    <th className="font-medium text-left px-3 py-2">What</th>
                    <th className="font-medium text-left px-3 py-2">Reference</th>
                    <th className="font-medium text-left px-3 py-2">When</th>
                    <th className="font-medium text-right px-3 py-2">Amount</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={`${p.kind}-${p.id}`} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50" data-testid="payment-to-make">
                      <td className="px-3 py-2 font-medium text-slate-800 max-w-[14rem] truncate" title={p.payee}>{p.payee}</td>
                      {/* One line: the banking details' own line breaks become dots. */}
                      <td className="px-2 py-2 text-slate-500 max-w-[18rem] truncate"
                        title={p.detail ?? undefined}>
                        {p.detail
                          ? (p.kind === 'payover' ? p.detail : `Why: ${p.detail}`).split(/\s*\n\s*/).join(' \u00b7 ')
                          : p.kind === 'payover' ? <span className="text-amber-700">No banking details on the client</span> : ''}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {p.kind === 'payover' ? (
                          <Link to={`/trust/runs/${p.id}`} className="text-gold-700 hover:text-gold-800">Payover {p.caseNumber ?? ''}</Link>
                        ) : (
                          <Link to={`/accounts/${p.accountId}`} className="text-gold-700 hover:text-gold-800">Refund · {p.caseNumber ?? 'the debtor'}</Link>
                        )}
                        <span className="text-slate-400">
                          {' \u00b7 '}{p.kind === 'payover' ? (p.status === 'sent' ? 'Advice sent' : 'Approved') : 'Overpayment refunded'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {p.reference ? (
                          <button type="button" onClick={() => copy(p.reference!)} title="Copy the reference"
                            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-200 px-1.5 py-0.5 font-mono text-[12.5px] text-slate-800 hover:bg-slate-50">
                            {p.reference}
                            {copied === p.reference ? <Check size={13} className="text-positive-700" /> : <Copy size={13} className="text-slate-400" />}
                          </button>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{p.dueOn ? `Due ${shortDate(p.dueOn)}` : 'As soon as paid'}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800 whitespace-nowrap">{rand(p.amount)}</td>
                      <td className="px-3 py-2 text-right">
                        {statementOnly ? (
                          <span className="text-[11.5px] text-slate-400 whitespace-nowrap">Paid from the statement</span>
                        ) : (
                        <button type="button"
                          onClick={() => setPaying({ kind: p.kind, id: p.id, payee: p.payee, amount: p.amount, reference: p.reference ?? '' })}
                          className="rounded-md border border-slate-200 px-2.5 py-1 text-[12px] font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap">
                          Mark paid
                        </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      ) : (
        <PaidList paid={paid} />
      )}

      {paying && (
        <MarkPaidBox
          paying={paying} today={today}
          onClose={() => setPaying(null)}
          onSave={async (ref, date) => {
            const at = new Date(`${date}T12:00:00`).toISOString()
            if (paying.kind === 'payover') await markRunPaid(paying.id, ref, at)
            else await markRefundPaid(paying.id, ref, at)
            setPaying(null)
            await load()
          }}
        />
      )}
      {drawing && firmHeld !== null && (
        <TransferBox
          available={firmHeld} reference={transferReference(today)}
          onClose={() => setDrawing(false)}
          onSave={async (amount, ref) => { await drawFromTrust(amount, ref); setDrawing(false); await load() }}
        />
      )}
    </div>
  )
}

function PaidList({ paid }: { paid: PaidOut[] }) {
  if (paid.length === 0) {
    return <Card className="p-6 text-sm text-slate-500 text-center">Nothing has been paid out of trust in the last 90 days.</Card>
  }
  const label = (p: PaidOut) => (p.kind === 'payover' ? `Payover ${p.caseNumber ?? ''}` : p.kind === 'refund' ? `Refund · ${p.caseNumber ?? ''}` : 'Transfer to the business account')
  return (
    <Card padded={false} className="overflow-x-auto">
      <table className="w-full text-[12.5px] whitespace-nowrap">
        <thead>
          <tr className="text-slate-400 border-b border-slate-100">
            <th className="font-medium text-left px-3 py-2">Paid to</th>
            <th className="font-medium text-left px-3 py-2">What</th>
            <th className="font-medium text-left px-3 py-2">Reference</th>
            <th className="font-medium text-left px-3 py-2">Paid</th>
            <th className="font-medium text-left px-3 py-2">Bank statement</th>
            <th className="font-medium text-right px-3 py-2">Amount</th>
          </tr>
        </thead>
        <tbody>
          {paid.map((p) => (
            <tr key={`${p.kind}-${p.id}`} className="border-b border-slate-100 last:border-b-0" data-testid="paid-out">
              <td className="px-3 py-2 font-medium text-slate-800">{p.payee}</td>
              <td className="px-3 py-2 text-slate-600">
                {p.kind === 'payover' ? <Link to={`/trust/runs/${p.id}`} className="text-gold-700 hover:text-gold-800">{label(p)}</Link>
                  : p.kind === 'refund' && p.accountId ? <Link to={`/accounts/${p.accountId}`} className="text-gold-700 hover:text-gold-800">{label(p)}</Link>
                    : label(p)}
              </td>
              <td className="px-3 py-2 font-mono text-[12.5px] text-slate-700 whitespace-nowrap">{p.paidReference ?? p.reference ?? '—'}</td>
              <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{p.paidAt ? shortDate(p.paidAt.slice(0, 10)) : '—'}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {p.confirmed ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11.5px] font-semibold text-emerald-700">
                    On the statement {p.statementDate ? shortDate(p.statementDate) : ''}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11.5px] font-semibold text-amber-800">Waiting for the statement</span>
                )}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800 whitespace-nowrap">{rand(p.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

/** Marking a payment paid by hand: the reference it went out on (prefilled) and the day. */
function MarkPaidBox({ paying, today, onClose, onSave }: {
  paying: Paying; today: string; onClose: () => void; onSave: (ref: string, date: string) => Promise<void>
}) {
  const [ref, setRef] = useState(paying.reference)
  const [date, setDate] = useState(today)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <Modal title={`Mark paid: ${rand(paying.amount)} to ${paying.payee}`} onClose={onClose} width={440}
      footer={(
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12.5px] text-negative-700">{err}</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={controlClass}>Cancel</button>
            <button type="button" disabled={busy || ref.trim() === ''}
              onClick={async () => { setBusy(true); setErr(null); try { await onSave(ref.trim(), date) } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false) } }}
              className="rounded-lg bg-navy-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              {busy ? <Loader2 size={15} className="animate-spin" /> : 'Mark paid'}
            </button>
          </div>
        </div>
      )}>
      <div className="space-y-3">
        <FormField label="Reference it was paid with" required>
          <input className={inputClass} value={ref} onChange={(e) => setRef(e.target.value)} />
        </FormField>
        <FormField label="Paid on" required>
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <p className="text-[12px] text-slate-500">It moves to Paid, waiting for the statement; the statement line confirms it when it is allocated.</p>
      </div>
    </Modal>
  )
}

/** Recording the firm's transfer to its business account -- never more than it has earned. */
function TransferBox({ available, reference, onClose, onSave }: {
  available: number; reference: string; onClose: () => void; onSave: (amount: number, ref: string) => Promise<void>
}) {
  const [amount, setAmount] = useState(available.toFixed(2))
  const [ref, setRef] = useState(reference)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const n = Number(amount)
  const tooMuch = Number.isFinite(n) && n > available + 0.004
  return (
    <Modal title="Transfer to the business account" onClose={onClose} width={440}
      footer={(
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12.5px] text-negative-700">{err}</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={controlClass}>Cancel</button>
            <button type="button" disabled={busy || !(n > 0) || tooMuch || ref.trim() === ''}
              onClick={async () => { setBusy(true); setErr(null); try { await onSave(Math.round(n * 100) / 100, ref.trim()) } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false) } }}
              className="rounded-lg bg-navy-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              {busy ? <Loader2 size={15} className="animate-spin" /> : 'Record transfer'}
            </button>
          </div>
        </div>
      )}>
      <div className="space-y-3">
        <FormField label="Amount" required>
          <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </FormField>
        {tooMuch && <p className="text-[12.5px] text-negative-700">The firm holds {rand(available)}. More than that is somebody else’s money.</p>}
        <FormField label="Reference" required>
          <input className={inputClass} value={ref} onChange={(e) => setRef(e.target.value)} />
        </FormField>
        <p className="text-[12px] text-slate-500">Recorded as drawn now; it reads as confirmed when its debit on the trust statement is allocated as a transfer to the business account.</p>
      </div>
    </Modal>
  )
}
