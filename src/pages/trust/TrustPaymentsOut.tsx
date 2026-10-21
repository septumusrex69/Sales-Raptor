import { useCallback, useEffect, useState } from 'react'
import { saveFile } from '../../lib/fileSave'
import { Link, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { Check, Copy, Download, Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Modal, FormField, inputClass, controlClass } from '../../components/ui/Modal'
import { rand } from '../../lib/money'
import { fetchPaymentsOutList, fetchPaymentsOutPaid, markRefundPaid, setPaymentBanking } from '../../lib/bankAllocationApi'
import { bankFileCsv, canPay, defaultTicked, fileTotal, fnbOwnAccount, keyOf, needsBanking, pendingWords, whatIsMissing, type OutgoingPayment } from '../../lib/bankFile'
import { markRunPaid } from '../../lib/payover'
import { fetchFirmTrustSplit, fetchPayoutsStatementOnly, fetchTrustOwnAccount, type FirmTrustSplit } from '../../lib/trust'
import { drawFromTrust } from '../../lib/businessApi'
import { canDrawFromTrust } from '../../lib/permissions'
import { useAuth } from '../../store/AuthContext'
import { transferReference, type PaidOut } from '../../lib/paymentsOut'
import { shortDate } from '../../lib/trustCycles'
import { clockNowMs, clockToday } from '../../lib/clock.ts'

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
export type Paying = { kind: 'payover' | 'refund'; id: string; payee: string; amount: number; reference: string }

export function TrustPaymentsOut() {
  const { currentUser } = useAuth()
  const [tab, setTab] = useState<Tab>('pay')
  const [rows, setRows] = useState<OutgoingPayment[] | null>(null)
  /* WHAT GOES IN THE BANK FILE (the firm, 13 Oct: "choose which you will be able to include and exclude"). */
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [banking, setBanking] = useState<OutgoingPayment | null>(null)
  const [params, setParams] = useSearchParams()
  const [paid, setPaid] = useState<PaidOut[] | null>(null)
  const [firm, setFirm] = useState<FirmTrustSplit | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [paying, setPaying] = useState<Paying | null>(null)
  /* ?draw=1 opens Record a transfer straight away -- the prompt on Payover runs links here (prompt 12 B). */
  const [drawing, setDrawing] = useState(false)
  /* Payments out confirmed from the statement only (Trust settings): then there is no Mark paid. */
  const [statementOnly, setStatementOnly] = useState(false)
  /* The trust account the bank file pays FROM (Firm settings); undefined while it is being read. */
  const [own, setOwn] = useState<{ number: string | null; bank: string | null } | null | undefined>(undefined)

  const today = clockToday()
  const since = new Date(clockNowMs() - 90 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' })

  const load = useCallback(async () => {
    try {
      const [due, gone, pos, only, trust] = await Promise.all([
        fetchPaymentsOutList(), fetchPaymentsOutPaid(since),
        /* The firm's share is shown to say what MAY be drawn -- only what its clients have been paid
           for (the firm, 10 Oct) -- and the list stands without it. */
        fetchFirmTrustSplit().catch(() => null),
        fetchPayoutsStatementOnly().catch(() => false),
        fetchTrustOwnAccount().catch(() => null),
      ])
      setRows(due); setPaid(gone); setFirm(pos); setStatementOnly(only); setOwn(trust)
      /* Everything payable is ticked; a tick somebody took off stays off across a reload. */
      setTicked((t) => (t.size === 0 ? defaultTicked(due) : new Set([...t].filter((k) => due.some((d) => keyOf(d) === k && canPay(d))))))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [since])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (params.get('draw') === '1' && firm && firm.drawable > 0.004) { setDrawing(true); setParams({}, { replace: true }) }
  }, [params, firm, setParams])

  /* FNB's file names the account it pays from; without a usable trust account number there is no file. */
  const ownAccount = fnbOwnAccount(own?.number)

  function download() {
    if (!rows || !ownAccount) return
    /* Paid today: everything in the file is due, and FNB reads an action date it cannot parse as today anyway. */
    const csv = bankFileCsv(rows, ticked, { ownAccount, actionDate: clockToday() })
    /* Saved, not drawn over the page, on an iPad too (fileSave.ts). */
    void saveFile(new Blob([csv], { type: 'text/csv' }), `trust-payments-${clockToday()}.csv`)
  }

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

  const waiting = paid.filter((p) => !p.confirmed)
  const mayDraw = canDrawFromTrust(currentUser)
  const payable = rows.filter(canPay)
  const pending = rows.filter((r) => !canPay(r))
  const inFile = rows.filter((r) => ticked.has(keyOf(r)) && canPay(r))
  const toggle = (k: string) => setTicked((t) => { const n = new Set(t); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const what = (p: OutgoingPayment) => p.kind === 'payover'
    ? <Link to={`/trust/runs/${p.id}`} className="text-gold-700 hover:text-gold-800">Payover {p.caseNumber ?? ''}</Link>
    : p.kind === 'refund'
      ? <Link to={`/accounts/${p.accountId}`} className="text-gold-700 hover:text-gold-800">Refund · {p.caseNumber ?? 'the debtor'}</Link>
      : <span className="text-slate-600">The firm&rsquo;s share, transferred</span>

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">Payments out</h1>
        <span className="text-xs text-slate-400">The one place money leaves the trust account: clients, refunds and the firm&rsquo;s own transfer</span>
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
          {/*
            THE BANK FILE (the firm, 13 Oct): every payment ticked and payable, in one upload. A payment
            the bank could not pay -- no account details yet, or not yet due -- is PENDING, says what is
            missing, and cannot be ticked.
          */}
          <Card className="px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-4" data-testid="bank-file-bar">
              <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
                <div>
                  <div className="text-[12px] text-slate-500">In the bank file</div>
                  <div className="text-2xl font-semibold tabular-nums text-slate-800" data-testid="file-total">{rand(fileTotal(rows, ticked))}</div>
                </div>
                <div className="text-[13px] text-slate-500">
                  {inFile.length} of {payable.length} ready to pay
                  {pending.length > 0 && <> · <span className="text-amber-700">{pending.length} pending</span></>}
                </div>
              </div>
              <button type="button" onClick={download} disabled={inFile.length === 0 || !ownAccount} data-testid="download-bank-file"
                className="inline-flex items-center gap-2 rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-navy-800 disabled:opacity-40">
                <Download size={15} /> Download bank file
              </button>
            </div>
            {/*
              WHAT TO DO WITH IT, IN ONE LINE (FNB's guide, step 6), and which account it pays from --
              read off the file's own row 3, so the screen cannot name one account and the file another.
              "As downloaded" because opening it in Excel and saving it again strips the leading zero off
              a branch code such as 051001.
            */}
            {ownAccount ? (
              <p className="mt-3 max-w-3xl text-[12.5px] leading-relaxed text-slate-600" data-testid="bank-file-how">
                In FNB: <span className="font-medium">Payments &rarr; Add (+) &rarr; Import</span>, and choose the file as downloaded.
                It pays from the trust account{own?.bank ? `, ${own.bank}` : ''} <span className="font-medium tabular-nums">{ownAccount}</span>.
              </p>
            ) : own !== undefined && (
              <p className="mt-3 max-w-3xl text-[12.5px] leading-relaxed text-amber-700" data-testid="bank-file-how">
                The bank file needs the trust account it pays from: add its account number in{' '}
                <Link to="/library/firm" className="font-medium underline">the firm&rsquo;s details</Link>.
              </p>
            )}
            <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-slate-500">
              Every payment goes on its BF reference. When the statement is imported each one
              matches itself and moves to Paid{statementOnly ? '' : ' (or mark one paid by hand)'}.
            </p>
          </Card>

          {firm !== null && firm.held > 0.004 && (
            <Card className="px-6 py-4" >
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2" data-testid="firm-to-draw">
                <div className="flex-1 min-w-[16rem]">
                  <div className="font-medium text-slate-800">Bredell Ferreira (business account)</div>
                  <div className="text-[12.5px] text-slate-500">
                    Earned, and its clients paid — the most that may be transferred now. Reference {transferReference(today)}.
                    Recorded, it joins the bank file below.
                  </div>
                  {firm.waiting > 0.004 && (
                    <div className="text-[12.5px] text-slate-500" data-testid="firm-waiting">
                      A further {rand(firm.waiting)} is the firm’s but waits until the clients it came from have been paid.
                    </div>
                  )}
                </div>
                <div className="text-lg font-semibold tabular-nums text-slate-800">{rand(Math.max(firm.drawable, 0))}</div>
                {mayDraw ? (
                  <button type="button" onClick={() => setDrawing(true)} disabled={firm.drawable <= 0.004}
                    className="rounded-lg bg-navy-900 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-navy-800 disabled:opacity-40">
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
              Nothing is waiting to be paid. Approved payover runs, decided refunds and a recorded transfer to the business account appear here until they are paid.
            </Card>
          ) : (
            <Card padded={false} className="overflow-x-auto">
              <table className="w-full list-table whitespace-nowrap">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-100">
                    <th className="w-8 pl-4 py-2">
                      <input type="checkbox" aria-label="Tick every payment that can be paid"
                        checked={payable.length > 0 && payable.every((p) => ticked.has(keyOf(p)))}
                        onChange={(e) => setTicked(e.target.checked ? defaultTicked(rows) : new Set())} />
                    </th>
                    <th className="font-medium text-left px-2 py-2">Pay to</th>
                    <th className="font-medium text-left px-3 py-2">What</th>
                    <th className="font-medium text-left px-3 py-2">Reference</th>
                    <th className="font-medium text-right px-3 py-2">Amount</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {[...payable, ...pending].map((p) => {
                    const missing = whatIsMissing(p)
                    return (
                    <tr key={keyOf(p)} className={clsx('border-b border-slate-50 last:border-b-0 hover:bg-slate-50', missing.length > 0 && 'bg-amber-50/40')} data-testid="payment-to-make">
                      <td className="w-8 pl-4 py-1.5">
                        <input type="checkbox" aria-label={`Pay ${p.payee}`} disabled={missing.length > 0}
                          checked={ticked.has(keyOf(p)) && missing.length === 0} onChange={() => toggle(keyOf(p))} />
                      </td>
                      <td className="px-2 py-1.5 max-w-[16rem]">
                        <div className="font-medium text-slate-800 truncate" title={p.payee}>{p.payee}</div>
                        {/* WHY IT IS PENDING, under the name: at the row's end it ran off an iPad. */}
                        {missing.length > 0
                          ? <div className="text-[11.5px] text-amber-800 whitespace-normal" data-testid="pending">Pending · {pendingWords(missing)}</div>
                          : <div className="text-[11.5px] text-slate-400" title={`${p.holder ?? ''} · ${p.bank ?? ''} · ${p.branch ?? ''}`}>{p.bank} ···{(p.accountNo ?? '').slice(-4)}</div>}
                      </td>
                      <td className="px-3 py-1.5">{what(p)}</td>
                      <td className="px-3 py-1.5">
                        {p.reference ? (
                          <button type="button" onClick={() => copy(p.reference!)} title="Copy the reference"
                            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-200 px-1.5 py-0.5 font-mono text-[12.5px] text-slate-800 hover:bg-slate-50">
                            {p.reference}
                            {copied === p.reference ? <Check size={13} className="text-positive-700" /> : <Copy size={13} className="text-slate-400" />}
                          </button>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-800 whitespace-nowrap">{rand(p.amount)}</td>
                      <td className="px-3 py-1.5 text-right">
                        {missing.length > 0 ? (
                          needsBanking(p) && p.kind !== 'drawing' ? (
                            <button type="button" onClick={() => setBanking(p)} data-testid="add-banking"
                              className="rounded-md border border-amber-300 bg-white px-2 py-0.5 text-[12px] font-medium text-amber-800 hover:bg-amber-50 whitespace-nowrap">
                              Add banking details
                            </button>
                          ) : needsBanking(p) ? (
                            <Link to="/library/firm" className="text-[12px] text-amber-800 underline whitespace-nowrap">Business account</Link>
                          ) : null
                        ) : statementOnly || p.kind === 'drawing' ? (
                          <span className="text-[11.5px] text-slate-400 whitespace-nowrap">Paid from the statement</span>
                        ) : (
                          <button type="button"
                            onClick={() => setPaying({ kind: p.kind as 'payover' | 'refund', id: p.id, payee: p.payee, amount: p.amount, reference: p.reference ?? '' })}
                            className="rounded-md border border-slate-200 px-2 py-0.5 text-[12px] font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap">
                            Mark paid
                          </button>
                        )}
                      </td>
                    </tr>
                    )
                  })}
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
      {banking && (
        <BankingBox payment={banking} onClose={() => setBanking(null)}
          onSave={async (h, b, br, a) => {
            await setPaymentBanking(banking.kind as 'payover' | 'refund', banking.id, h, b, br, a)
            setBanking(null)
            await load()
            setTicked((t) => new Set([...t, keyOf(banking)]))
          }} />
      )}
      {drawing && firm !== null && (
        <TransferBox
          available={Math.max(firm.drawable, 0)} reference={transferReference(today)}
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
      <table className="w-full list-table whitespace-nowrap">
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
              <td className="px-3 py-1.5 font-medium text-slate-800">{p.payee}</td>
              <td className="px-3 py-1.5 text-slate-600">
                {p.kind === 'payover' ? <Link to={`/trust/runs/${p.id}`} className="text-gold-700 hover:text-gold-800">{label(p)}</Link>
                  : p.kind === 'refund' && p.accountId ? <Link to={`/accounts/${p.accountId}`} className="text-gold-700 hover:text-gold-800">{label(p)}</Link>
                    : label(p)}
              </td>
              <td className="px-3 py-1.5 font-mono text-[12.5px] text-slate-700 whitespace-nowrap">{p.paidReference ?? p.reference ?? '—'}</td>
              <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{p.paidAt ? shortDate(p.paidAt.slice(0, 10)) : '—'}</td>
              <td className="px-3 py-1.5 whitespace-nowrap">
                {p.confirmed ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11.5px] font-semibold text-emerald-700">
                    On the statement {p.statementDate ? shortDate(p.statementDate) : ''}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11.5px] font-semibold text-amber-800">Waiting for the statement</span>
                )}
              </td>
              <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-800 whitespace-nowrap">{rand(p.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

/** Marking a payment paid by hand: the reference it went out on (prefilled) and the day. */
export function MarkPaidBox({ paying, today, onClose, onSave }: {
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
        {tooMuch && <p className="text-[12.5px] text-negative-700">The firm may transfer {rand(available)} now. More than that is either somebody else’s money or the firm’s share of money its clients have not yet been paid.</p>}
        <FormField label="Reference" required>
          <input className={inputClass} value={ref} onChange={(e) => setRef(e.target.value)} />
        </FormField>
        <p className="text-[12px] text-slate-500">Recorded as drawn now; it reads as confirmed when its debit on the trust statement is allocated as a transfer to the business account.</p>
      </div>
    </Modal>
  )
}

/**
 * THE BANKING A PAYMENT GOES TO, captured where it is missing (the firm, 13 Oct: a refund with no
 * debtor banking details "stays in a pending state"). A payover's is kept on the CLIENT, so the next
 * month's payover has it; a refund's on the refund. The database checks the shape: six-digit branch
 * code, 6 to 16 digits of account number.
 */
function BankingBox({ payment, onClose, onSave }: {
  payment: OutgoingPayment; onClose: () => void; onSave: (holder: string, bank: string, branch: string, account: string) => Promise<void>
}) {
  const [holder, setHolder] = useState(payment.holder ?? payment.payee)
  const [bank, setBank] = useState(payment.bank ?? '')
  const [branch, setBranch] = useState(payment.branch ?? '')
  const [account, setAccount] = useState(payment.accountNo ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const okBranch = /^\d{6}$/.test(branch.replace(/\s/g, ''))
  const okAccount = /^\d{6,16}$/.test(account.replace(/\s/g, ''))
  return (
    <Modal title={`Banking details: ${payment.payee}`} onClose={onClose} width={460}
      footer={(
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12.5px] text-negative-700">{err}</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={controlClass}>Cancel</button>
            <button type="button" disabled={busy || !holder.trim() || !bank.trim() || !okBranch || !okAccount}
              onClick={async () => { setBusy(true); setErr(null); try { await onSave(holder.trim(), bank.trim(), branch, account) } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false) } }}
              className="rounded-lg bg-navy-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              {busy ? <Loader2 size={15} className="animate-spin" /> : 'Save'}
            </button>
          </div>
        </div>
      )}>
      <div className="space-y-3">
        <FormField label="Account holder" required><input className={inputClass} value={holder} onChange={(e) => setHolder(e.target.value)} aria-label="Account holder" /></FormField>
        <FormField label="Bank" required><input className={inputClass} value={bank} onChange={(e) => setBank(e.target.value)} aria-label="Bank" placeholder="FNB, ABSA, Standard Bank, Nedbank, Capitec…" /></FormField>
        <FormField label="Branch code" required><input className={inputClass} inputMode="numeric" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch code" /></FormField>
        <FormField label="Account number" required><input className={inputClass} inputMode="numeric" value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Account number" /></FormField>
        <p className="text-[12px] text-slate-500">
          {payment.kind === 'payover' ? 'Kept on the client, so their next payover is paid to it too.' : 'Kept on this refund.'}
        </p>
      </div>
    </Modal>
  )
}
