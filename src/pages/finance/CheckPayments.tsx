import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, RotateCcw } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Modal, inputClass } from '../../components/ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { canReversePayment } from '../../lib/permissions'
import { useAppStore } from '../../store/AppStore'
import { fetchAccount } from '../../lib/accountBook'
import { accountRate } from '../../lib/commissionRule'
import { rand } from '../../lib/money'
import { formatDate } from '../../data/mockData'
import {
  fetchPostedPayments, postedAllocation, reversePayment, reversePaymentToUnplaced, type PostedPayment,
} from '../../lib/payover'
import { checkAllocation, feesSideTaking, type Violation } from '../../lib/allocationRules'
import {
  FeeBodyCells, FeeHeadCells, feeColumns, toggled, type SectionKey,
} from '../../components/finance/FeeSections'

/**
 * EVERY RECEIPT THAT HAS GONE THROUGH, CHECKED AGAINST THE FIRM'S OWN FORMULAS.
 *
 * THE FIRM: "you can add whatever you need for the administrator to ensure that we can double
 * check every single thing that comes in."
 *
 * ------------------------------------------------------------------------------------------------
 * WHY THE APPROVAL QUEUE WAS NOT ENOUGH
 * ------------------------------------------------------------------------------------------------
 *
 * The queue checks the PREVIEW -- what a payment would do -- and then the payment leaves it. Once
 * approved, the allocation is written, the client is paid on it, and nothing looks at it again. So
 * the one figure the firm could never go back to was the one that actually moved money, and the
 * one place a mistake would be expensive was the one place nothing was watching.
 *
 * THIS RUNS THE SAME RULES OVER WHAT HAPPENED. Not a re-derivation against today's book -- that
 * answers a different question every day -- but over the thirteen before-figures the engine WROTE
 * at the moment of posting. allocationRules.ts is the one set of formulas and it does not know or
 * care which screen is asking.
 *
 * AND THE LEDGER IS READ TOO, WHICH IS A DIFFERENT QUESTION. An allocation can be internally
 * perfect and still sit on an account whose own rows say something else; that is what a reversal
 * that half-ran looks like, and no check that only reads the allocation can see it. So each row
 * also carries what the account's fees, interest and payments add up to TODAY, and the opened
 * panel shows them.
 *
 * NOTHING HERE CHANGES ANYTHING. Financial records are immutable once a payment has been processed
 * -- the four ledgers have no update or delete policy and Postgres refuses -- so this screen is
 * deliberately all reading. What an administrator does about a row it flags is a reversal, on the
 * payment, with a reason, which is the one route that leaves a record of itself.
 *
 * AND THE REVERSAL IS HERE NOW. It was the row action of the all-payments list on Payments in,
 * which the firm removed -- "Payments in is only for processing current payments" -- and it was
 * the only place in the app that could reverse a payment. This is where a processed payment is
 * found, so it is where it is undone: from the opened receipt, after reading what it did.
 */
export function CheckPayments() {
  const [rows, setRows] = useState<PostedPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [opened, setOpened] = useState<Set<SectionKey>>(new Set())
  /* Which receipt is open end to end. One at a time: this is a reading screen, and two open panels
     is two columns of figures nobody is comparing. */
  const [open, setOpen] = useState<string | null>(null)
  /* THE DEFAULT IS EVERY RECEIPT THERE HAS EVER BEEN, which is what "every single thing that comes
     in" means. The box narrows it; it does not widen it. */
  const [onlyBroken, setOnlyBroken] = useState(false)
  const { currentUser } = useAuth()
  const mayReverse = canReversePayment(currentUser)
  const [reversing, setReversing] = useState<PostedPayment | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setRows(await fetchPostedPayments()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load the posted payments.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  /*
   * THE RULES, RUN ON EVERY ROW.
   *
   * AN ALLOCATION WRITTEN BEFORE THE FIGURES EXISTED IS NOT REPORTED AS BROKEN, and that
   * distinction is the whole reason `beforeTheRecord` exists. `v1-5050` rows have nought in the
   * two fee-split columns and null in the thirteen before-figures, so every formula that subtracts
   * one of them would fire -- a screen of red on payments that were correct when they were made.
   * "We did not record that then" and "that does not add up" are different sentences and the firm
   * must not be shown the second when the first is true.
   */
  const checked = useMemo(() => rows.map((r) => {
    const a = postedAllocation(r)
    const problems: Violation[] = r.beforeTheRecord ? [] : checkAllocation(a)
    return { row: r, a, problems }
  }), [rows])

  const broken = useMemo(() => checked.filter((c) => c.problems.length > 0), [checked])
  const older = useMemo(() => checked.filter((c) => c.row.beforeTheRecord), [checked])
  const shown = onlyBroken ? broken : checked
  const total = useMemo(() => rows.reduce((n, r) => n + r.amount, 0), [rows])

  function toggleSection(k: SectionKey) { setOpened((p) => toggled(p, k)) }

  return (
    <div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800">Payment history</h3>
            <p className="text-[12px] text-slate-500">
              {/* RENAMED FROM "CHECK" (the firm, 10 Oct): the check happens BEFORE approval, in the
                  approval queue; this is where every processed payment lives afterwards, and
                  where one is reversed. The formulas still run over every row. */}
              Every payment processed into the trust, newest first, with every formula still run
              over it. Open one to see its split, or to reverse it.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12.5px] text-slate-600">
              <input type="checkbox" checked={onlyBroken}
                onChange={(e) => setOnlyBroken(e.target.checked)} />
              Only the ones that do not add up
            </label>
            <span className="text-[15px] font-semibold tabular-nums text-navy-950">{rand(total)}</span>
          </div>
        </div>

        {/*
          THE VERDICT IN ONE LINE, AND IT SAYS SO WHEN EVERYTHING IS RIGHT.
          A screen that only speaks when something is wrong leaves "nothing wrong" and "nothing
          checked" looking identical, which is the distinction financeHealth.ts keeps as two
          different sentences for the same reason.
        */}
        {!loading && rows.length > 0 && (
          <div className={`border-b px-4 py-2.5 text-[13px] ${
            broken.length > 0
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-emerald-100 bg-emerald-50 text-emerald-900'}`}>
            <p className="flex items-center gap-1.5 font-medium">
              {broken.length > 0
                ? <AlertTriangle className="w-4 h-4 shrink-0" />
                : <Check className="w-4 h-4 shrink-0" />}
              {broken.length > 0
                ? `${broken.length} of ${rows.length} do not obey the allocation formulas.`
                : `All ${rows.length} obey every allocation formula.`}
              {older.length > 0 && (
                <span className="font-normal">
                  {' '}{older.length} {older.length === 1 ? 'was' : 'were'} posted before Raptor
                  recorded the figures behind them and {older.length === 1 ? 'is' : 'are'} not
                  checked.
                </span>
              )}
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-negative-50 px-4 py-2.5 text-[13px] text-negative-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center"><Loader2 className="mx-auto w-4 h-4 animate-spin text-slate-400" /></div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-slate-500">
            No payment has been approved yet. Receipts waiting to be approved are on the Payments
            tab, where they are checked before they post.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] whitespace-nowrap">
              <thead className="text-[10.5px] uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-100 text-slate-400">
                  <th colSpan={5} />
                  <th colSpan={feeColumns(opened)}
                    className="px-2 py-1.5 text-left font-semibold tracking-wider border-l border-slate-200">
                    The fees side — half the payment
                  </th>
                  <th colSpan={7}
                    className="px-2 py-1.5 text-left font-semibold tracking-wider border-l border-slate-200">
                    The capital side
                  </th>
                  <th colSpan={2} />
                </tr>
                <tr className="border-b border-slate-100">
                  <th className="px-3 py-2" />
                  <th className="px-2 py-2 text-left font-medium">Received</th>
                  <th className="px-2 py-2 text-left font-medium">Account</th>
                  <th className="px-2 py-2 text-left font-medium">Debtor</th>
                  <th className="px-2 py-2 text-right font-medium">Payment</th>
                  <FeeHeadCells opened={opened} onToggle={toggleSection} />
                  <th className="px-2 py-2 text-right font-normal text-slate-400 border-l border-slate-200">
                    Capital outstanding
                  </th>
                  <th className="px-2 py-2 text-right font-medium">Capital taken</th>
                  <th className="px-2 py-2 text-right font-normal text-slate-400">Capital after</th>
                  <th className="px-2 py-2 text-right font-medium">Commission</th>
                  <th className="px-2 py-2 text-right font-medium">VAT</th>
                  <th className="px-2 py-2 text-right font-medium">To client</th>
                  <th className="px-2 py-2 text-right font-medium border-l border-slate-200">Due to BF</th>
                  <th className="px-2 py-2 text-left font-medium">Paid over</th>
                  <th className="px-2 py-2 text-left font-medium">Reference</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ row: r, a, problems }) => (
                  <PostedRow key={r.paymentId} r={r} a={a} problems={problems}
                    opened={opened}
                    isOpen={open === r.paymentId}
                    onOpen={() => setOpen(open === r.paymentId ? null : r.paymentId)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/*
        THE OPENED RECEIPT IS BELOW THE TABLE AND NOT INSIDE IT, which is a layout decision the
        screenshot made for me.
        
        A panel in a `colSpan` cell takes the TABLE's width, and this table is wider than the
        window -- fifteen columns before anybody opens a fee section, and five more each time they
        do. So the third of its three columns, the one headed "Whether it holds", was drawn off the
        right-hand edge: the verdict, which is the entire point of the screen, was the part you had
        to scroll sideways to read. Outside the table it takes the card's width and always fits.
        
        AND IT READS BETTER FOR THE SAME REASON THE FIRM'S OWN SCREENS DO: a row is for finding one
        receipt among many, and this is for reading one closely. They are different jobs and the
        table stays a table.
      */}
      {open && (() => {
        const c = checked.find((x) => x.row.paymentId === open)
        if (!c) return null
        return (
          <Card className="mt-4">
            {/* NAMED FOR THE BROWSER CHECK, which has to read this panel and must not find it by
                counting table rows -- it is deliberately not one. */}
            <div data-check-panel>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[15px] font-semibold text-slate-800">
                {c.row.caseNumber ?? c.row.accountNumber} · {c.row.debtor}
              </h3>
              <div className="flex items-center gap-3">
                <p className="text-[12px] text-slate-500">
                  {rand(c.row.amount)} banked {formatDate(c.row.receivedOn)}
                </p>
                {mayReverse && !c.row.reversedOn && (
                  <button type="button" onClick={() => setReversing(c.row)}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-100">
                    Reverse
                  </button>
                )}
              </div>
            </div>
            <Opened r={c.row} a={c.a} problems={c.problems} />
            </div>
          </Card>
        )
      })()}
      {reversing && (
        <ReverseModal row={reversing} onClose={() => setReversing(null)}
          onDone={async () => { setReversing(null); setOpen(null); await load() }} />
      )}
    </div>
  )
}

/**
 * REVERSING ASKS WHY, AND THE ANSWER IS KEPT.
 *
 * It becomes the cancellation reason on the receipt fee -- so the account's own ledger says a fee
 * was raised and then cancelled because the cheque came back, rather than the fee simply
 * vanishing. Everything else follows in the database.
 */
function ReverseModal({ row, onClose, onDone }: { row: PostedPayment; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /*
   * WHERE IT GOES (the firm, 10 Oct): back to the approval queue on this debtor (the figures were
   * wrong -- or move it to the right debtor there), or back to Needs an account (the wrong
   * reference -- it is somebody else's money). Only a receipt off a statement has a line to put back.
   */
  const fromStatement = row.bankDescription !== null
  const [to, setTo] = useState<'queue' | 'unplaced'>('queue')
  /* ALREADY ON A RUN: the invoice that carried it is not touched -- see below. */
  const invoiced = Boolean(row.runInvoice)
  return (
    <Modal title="Reverse this payment" onClose={onClose} width={440}>
      <div className="space-y-3">
        <p className="text-[13px] text-slate-600">
          {rand(row.amount)} received {formatDate(row.receivedOn)}. The receipt fee is cancelled, the
          capital goes back on the account, and every later payment is re-split against the balances
          this one moved.
        </p>
        {/*
          WHERE THE MONEY GOES, which the firm asked about directly: "not really the suspense
          account -- it goes back into a state ready for approval." Said here because it is the
          difference between a reversal that loses the receipt and one that hands it back to be
          redone, and nobody should have to find that out by looking afterwards.
        */}
        <div className="space-y-2" data-testid="reverse-to">
          <div className="text-xs font-medium text-slate-600">Where does the money go?</div>
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px] text-slate-700">
            <input type="radio" className="mt-1" checked={to === 'queue'} onChange={() => setTo('queue')} />
            <span>
              <span className="font-medium">Back to the approval queue</span>
              <span className="block text-xs text-slate-500">
                The figures were wrong, or it belongs on another of this debtor&rsquo;s files. It waits
                on Payments in as {rand(row.amount)} to be moved or approved again.
              </span>
            </span>
          </label>
          <label className={clsx('flex items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px]',
            fromStatement ? 'text-slate-700' : 'text-slate-400')}>
            <input type="radio" className="mt-1" disabled={!fromStatement} checked={to === 'unplaced'}
              onChange={() => setTo('unplaced')} data-testid="reverse-to-unplaced" />
            <span>
              <span className="font-medium">Back to Needs an account</span>
              <span className="block text-xs text-slate-500">
                {fromStatement
                  ? 'The wrong reference: it is somebody else\u2019s money. The statement line goes back to be placed on the right debtor.'
                  : 'Only for a receipt off a bank statement. This one was recorded by hand: send it to the queue and reject it there.'}
              </span>
            </span>
          </label>
        </div>
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-[13px] text-slate-700">
          Until it is approved or placed again, the Trust overview shows it under
          {to === 'queue' ? ' Waiting for approval' : ' Unallocated receipts'}. This reversal stays on
          the ledger with your reason on it.
        </p>
        {invoiced && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            This payment has already been paid over to the client. The client now owes back
            what it was paid from it: that comes off their next payover as a negative line, and
            Bredell Ferreira&rsquo;s fees on it are taken back.
          </p>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Why</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass}
            placeholder="Cheque returned, debit order unpaid, captured twice…" />
        </div>
        {error && <p className="rounded-lg bg-negative-50 px-3 py-2 text-[13px] text-negative-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          {/*
            THROUGH THE FUNCTION, NOT AT THE TABLE. account_payments is one of the four ledgers
            with no update policy: a direct PATCH matches no rows, PostgREST answers 204, and the
            box would close on a reversal that never happened. reverse_payment asks
            payment.reverse and keeps the reason; the rest is the trigger on reversed_at.
          */}
          <button type="button" disabled={busy || !reason.trim()}
            onClick={() => {
              setBusy(true); setError(null)
              void (to === 'unplaced'
                ? reversePaymentToUnplaced(row.paymentId, reason.trim())
                : reversePayment(row.paymentId, reason.trim()))
                .then(async () => { await onDone(); setBusy(false) })
                .catch((e: unknown) => {
                  setError(e instanceof Error ? e.message : 'That payment could not be reversed.')
                  setBusy(false)
                })
            }}
            className="rounded-lg bg-negative-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-negative-700 disabled:opacity-50">
            {busy ? 'Reversing…' : 'Reverse it'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** One receipt as a row. What it did in full is drawn below the table -- see the screen. */
function PostedRow({ r, a, problems, opened, isOpen, onOpen }: {
  r: PostedPayment
  a: ReturnType<typeof postedAllocation>
  problems: Violation[]
  opened: Set<SectionKey>
  isOpen: boolean
  onOpen: () => void
}) {
  return (
    <>
      <tr className={`border-b border-slate-50 ${
        problems.length > 0 ? 'bg-amber-50'
          : r.reversedOn ? 'bg-slate-50'
            : isOpen ? 'bg-gold-50/40' : ''}`}>
        <td className="px-3 py-1.5">
          <button type="button" onClick={onOpen} className="text-slate-400 hover:text-navy-950"
            title={isOpen ? 'Close this receipt' : 'Open this receipt end to end'}>
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        </td>
        <td className="px-2 py-1.5 text-slate-600">{formatDate(r.receivedOn)}</td>
        <td className="px-2 py-1.5 text-slate-600">
          {r.caseNumber ?? r.accountNumber}
          {problems.length > 0 && (
            <span className="ml-1 inline-flex align-middle text-amber-700"
              title={problems.map((v) => `${v.rule} — ${v.detail}`).join('\n')}>
              <AlertTriangle size={11} />
            </span>
          )}
          {/* AN OLDER ALLOCATION SAYS SO rather than reading as one that paid nothing. */}
          {r.beforeTheRecord && (
            <span className="ml-1 text-[10px] text-slate-400"
              title={`Posted by engine ${r.engineVersion ?? 'v1'}, which did not record the figures behind the split`}>
              not checked
            </span>
          )}
        </td>
        <td className="px-2 py-1.5 text-slate-600 max-w-[12rem] truncate">{r.debtor}</td>
        <td className="px-2 py-1.5 text-right tabular-nums font-medium text-navy-950">{rand(r.amount)}</td>
        <FeeBodyCells a={a} opened={opened} />
        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400 border-l border-slate-200">
          {rand(r.capitalBefore)}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{rand(r.toCapital)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{rand(r.capitalAfter)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">
          {/* NO RATE IS NOT A ZERO: the allocation was written `needs_rate` and the exceptions
              screen carries it, but a confident 0.00 would read as a client who pays nothing. */}
          {r.status === 'needs_rate'
            ? <span className="text-amber-700">no rate</span>
            : rand(r.commission)}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{rand(r.commissionVat)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums text-[var(--c-green)]">{rand(r.toClient)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums text-slate-600 border-l border-slate-200">
          {rand(r.dueToBf)}
        </td>
        <td className="px-2 py-1.5">
          {/* WHERE THE CLIENT'S MONEY ACTUALLY GOT TO, which is the end of the chain and the thing
              a client telephones about. Four states, and "on a run that has not been paid" is not
              the same as "paid". */}
          {r.reversedOn ? (
            <span className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded
              bg-slate-200 text-slate-700"
              title={`Reversed ${formatDate(r.reversedOn)} — ${r.reversalReason ?? 'no reason given'}`}>
              <RotateCcw size={10} /> Reversed
            </span>
          ) : r.runPaidOn ? (
            <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800"
              title={`Invoice ${r.runInvoice ?? ''}`}>
              Paid {formatDate(r.runPaidOn)}
            </span>
          ) : r.runInvoice ? (
            <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600"
              title={`Invoice ${r.runInvoice}`}>
              On run · {r.runStatus}
            </span>
          ) : (
            <span className="text-[10.5px] text-slate-400">Not on a run</span>
          )}
        </td>
        <td className="px-2 py-1.5 text-slate-500 max-w-[14rem] truncate"
          title={r.bankDescription ?? ''}>
          {r.reference ?? r.bankDescription ?? '—'}
        </td>
      </tr>

    </>
  )
}

/** The chain behind one receipt: where it came from, what it did, and whether it holds. */
function Opened({ r, a, problems }: {
  r: PostedPayment
  a: ReturnType<typeof postedAllocation>
  problems: Violation[]
}) {
  const side = feesSideTaking(a)
  const half = Math.round((r.amount / 2) * 100) / 100
  /*
   * WHERE THE RATE CAME FROM (prompt 9). Read when the row is opened, not for the whole list: a
   * month of receipts is hundreds of accounts, and this is a question asked of one of them.
   */
  const { companies } = useAppStore()
  const [rateLabel, setRateLabel] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void fetchAccount(r.accountId).then((acct) => {
      if (!live || !acct) return
      const client = companies.find((c) => c.id === acct.companyId)
      setRateLabel(accountRate({
        accountRate: acct.commissionRate, capitalHandedOver: acct.capitalHandedOver,
        imported: !!acct.importedAt || !!acct.swordfishReference,
        reference: acct.swordfishReference, client: client ?? {},
      }).label)
    }).catch(() => { /* the line is a courtesy; the figures above it stand without it */ })
    return () => { live = false }
  }, [r.accountId, companies])
  return (
    <div className="grid gap-4 md:grid-cols-3 text-[12.5px]">
      {/* ---------------------------------------------------------------- where it came from */}
      <section>
        <h4 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
          Where it came from
        </h4>
        <Lines rows={[
          ['Banked', formatDate(r.receivedOn)],
          ['Approved', r.approvedOn ? formatDate(r.approvedOn) : '—'],
          ['Approved by', r.approvedByName ?? '—'],
          ['How it arrived', r.source === 'bank_import' ? 'Bank statement' : (r.source ?? '—')],
          ['On the statement', r.bankDescription ?? '—'],
          ['Reference', r.reference ?? '—'],
          /* THE DIRECTION OF THE MONEY, which decides who owes whom and is the one thing on this
             panel that changes the whole arithmetic below it. */
          ['Who received it', r.paidToClient ? 'The client, directly' : 'Bredell Ferreira'],
          ['Client', r.client ?? '—'],
        ]} />
      </section>

      {/* ---------------------------------------------------------------- what it did */}
      <section>
        <h4 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
          What it did
        </h4>
        <Lines rows={[
          ['Payment', rand(r.amount)],
          ['Half of it', rand(half)],
          ['Receipt fee raised', `${rand(r.receiptFee)} + ${rand(r.receiptFeeVat)} VAT`],
          ['Interest taken', rand(r.toInterest)],
          ['Receipt fees taken', rand(r.toReceiptFees)],
          ['Annexure B fees taken', rand(r.toFees)],
          ['The fees side', rand(side)],
          ['Capital taken', rand(r.toCapital)],
          ['Held as a credit', rand(r.excess)],
          ['Commission', `${rand(r.commission)}${r.commissionRate !== null
            ? ` (${(r.commissionRate * 100).toFixed(2)}% of capital)` : ''}`],
          ['The account\'s rate', rateLabel ?? '…'],
          ['VAT on it', rand(r.commissionVat)],
          [r.paidToClient ? 'Owed to BF by the client' : 'Paid over to the client',
            rand(r.paidToClient ? r.dueToBf : r.toClient)],
          ['Engine', `${r.engineVersion ?? '—'} · ${r.computedAt ? formatDate(r.computedAt) : '—'}`],
        ]} />
      </section>

      {/* ---------------------------------------------------------------- whether it holds */}
      <section>
        <h4 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
          Whether it holds
        </h4>
        {r.beforeTheRecord ? (
          <p className="text-slate-500">
            This was posted by engine {r.engineVersion ?? 'v1'}, which did not record what the
            split was computed against. The formulas need those figures, so this receipt is shown
            rather than checked — the arithmetic above is what it did, and it is not being called
            wrong.
          </p>
        ) : problems.length === 0 ? (
          <>
            <p className="mb-2 flex items-center gap-1.5 font-medium text-emerald-800">
              <Check className="w-4 h-4 shrink-0" /> Every formula holds.
            </p>
            <Lines rows={[
              ['Fees + capital + credit', `${rand(side + r.toCapital + r.excess)} = ${rand(r.amount)}`],
              ['Interest available − taken', `${rand(a.interest.available)} − ${rand(r.toInterest)} = ${rand(a.interest.after)}`],
              ['Receipt fees + fees', `${rand(r.toReceiptFees + r.toFees)} = ${rand(r.toCosts)} of the pool`],
              ['Capital before − taken', `${rand(r.capitalBefore)} − ${rand(r.toCapital)} = ${rand(r.capitalAfter)}`],
              ['Client + firm + SARS', rand(r.toClient + side + r.commission + r.commissionVat)],
            ]} />
          </>
        ) : (
          <>
            <p className="mb-2 flex items-center gap-1.5 font-medium text-amber-900">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {problems.length === 1 ? 'One formula does not hold' : `${problems.length} formulas do not hold`}
            </p>
            <ul className="space-y-1.5">
              {problems.map((v) => (
                <li key={v.rule}>
                  <span className="font-medium text-amber-900">{v.rule}</span>
                  <br />
                  <span className="text-slate-600 tabular-nums">{v.detail}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {/*
          AND WHAT THE ACCOUNT ITSELF ADDS UP TO, WHICH IS A DIFFERENT QUESTION.
          Read now rather than stored: these are the account's own rows as they stand today, not
          what this payment was computed against. They are here because an allocation can be
          internally perfect and sit on an account whose ledger says otherwise, and nothing above
          this line could ever see that.
        */}
        <h4 className="mb-1.5 mt-3 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
          The account today
        </h4>
        <Lines rows={[
          ['Fees raised, incl VAT', rand(r.feesRaised)],
          ['Interest allowed', rand(r.interestPosted)],
          ['Payments banked', rand(r.paymentsBanked)],
          ['Capital outstanding', rand(r.capitalAfter)],
        ]} />
      </section>
    </div>
  )
}

/** A label-and-figure list. Tight, because the firm reads these in pairs. */
function Lines({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="space-y-0.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3">
          <dt className="text-slate-500">{k}</dt>
          <dd className="tabular-nums text-slate-800 text-right">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
