import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2, RotateCcw, Search, Undo2, X } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Modal, inputClass } from '../../components/ui/Modal'
import { rand } from '../../lib/money'
import { formatDate } from '../../data/mockData'
import { fetchAccounts, type DebtorAccount } from '../../lib/accountBook'
import {
  fetchAwaitingApproval, approvePayments, setPaymentAccount, suspendPayment,
  awaitingAllocation, fetchRejectedPayments, rejectPayments, unrejectPayment,
  type AwaitingPayment, type RejectedPayment,
} from '../../lib/payover'
import { checkAllocation } from '../../lib/allocationRules'
/*
 * THE THREE SECTIONS ARE DRAWN BY ONE COMPONENT, shared with the administrator's check of posted
 * payments. The firm asked to see these figures in two places; CLAUDE.md's rule about the same
 * figures on two screens applies to the drawing as much as to the arithmetic -- written out twice,
 * the queue and the audit list would quietly disagree about what a payment paid.
 */
import {
  FeeBodyCells, FeeHeadCells, feeColumns, toggled, type SectionKey,
} from '../../components/finance/FeeSections'

/**
 * THE DAY'S PAYMENTS, WAITING TO BE APPROVED.
 *
 * THE FIRM: "There should be a state of payments and payments that should be approved on a daily
 * basis... You should be able to approve every payment singly, or approve all payments, or
 * highlight certain ones and approve them."
 *
 * NOTHING HERE HAS HAPPENED YET, and that is the point. The figures are `preview_allocation` --
 * the same arithmetic the collector's dry run uses -- so what is approved is what was shown. No
 * balance has moved, no receipt fee has been raised, and no payover run can see any of it: an
 * unapproved payment has no allocation, and a run gathers allocations.
 *
 * THEY CARRY OVER BY THEMSELVES. The firm: "if there's a payment that has not been approved on a
 * specific day, then it carries over and it stays there." This list is everything not yet
 * approved, whatever day it arrived -- no nightly job, and so no night it fails to run.
 */
export function AwaitingApproval({ refreshKey, onApproved }: {
  refreshKey: number
  onApproved: () => void
}) {
  const [rows, setRows] = useState<AwaitingPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  /* The receipt whose debtor is being corrected, if one is. */
  const [moving, setMoving] = useState<AwaitingPayment | null>(null)
  /*
   * AND THE RECEIPT NOBODY IS READY TO PLACE AT ALL.
   *
   * THE FIRM: "when something is in that state of approval, it should also give you an option to
   * put it into suspense... Otherwise you have to go and look for it in suspense and allocate it
   * later." Move is for when you KNOW the right debtor; this is for when you do not, and the
   * alternative was leaving it on the queue where the next person approves it onto the wrong one.
   */
  const [parking, setParking] = useState<AwaitingPayment | null>(null)
  /*
   * AND THE ONES BEING THROWN OUT, which is neither of the two above.
   *
   * THE FIRM: "there are no way to reject payments that are imported. From an import sheet...
   * there's some ones waiting in the queue to be approved, but I don't want to approve them."
   *
   * Move is "I know whose this is and it is not this debtor's". Suspense is "I do not know whose
   * this is yet". Reject is "this should not become a payment at all" -- and until now the only
   * way to clear one off the list was to approve it, which is the one thing the firm was saying
   * they did not want to do.
   *
   * A LIST RATHER THAN A ROW, because a morning's rubbish is thrown out together and for the same
   * reason. One row goes through the same box with one id in it.
   */
  const [rejecting, setRejecting] = useState<AwaitingPayment[] | null>(null)
  /* WHAT WAS THROWN OUT, so it is visible rather than vanished -- and so the undo is beside the
     mistake. Rejecting happens at speed down a list, which is when the wrong row gets pressed. */
  const [rejected, setRejected] = useState<RejectedPayment[]>([])
  /*
   * WHICH OF THE THREE FEE SECTIONS IS OPENED OUT.
   *
   * THE FIRM: "the column that you will be showing to us is the interest that we are taking now.
   * But if you click on the interest taking, it expands all of the other columns just to double
   * check." So the default is one column a section -- what this payment takes -- and the
   * arithmetic behind it is a click away rather than always on the screen. Per SECTION and not
   * per row: the four figures are a column each, and a row that opened its own would put a
   * different number of cells in one table.
   */
  const [opened, setOpened] = useState<Set<SectionKey>>(new Set())

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [queue, thrown] = await Promise.all([
        fetchAwaitingApproval(),
        /* TODAY'S ONLY. The record is permanent, but the strip under the queue is about what just
           happened -- a month of rejections there would be a second list nobody reads. */
        fetchRejectedPayments(new Date().toISOString().slice(0, 10)),
      ])
      setRows(queue)
      setRejected(thrown)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the day’s payments.')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load, refreshKey])

  const total = useMemo(() => rows.reduce((n, r) => n + r.amount, 0), [rows])
  const pickedTotal = useMemo(
    () => rows.filter((r) => picked.has(r.paymentId)).reduce((n, r) => n + r.amount, 0),
    [rows, picked],
  )

  /*
   * THE FIGURES AS THE RULES SEE THEM, AND WHAT THE RULES MAKE OF THEM.
   *
   * THE FIRM: "you can build in testing mechanisms... These formulas are the key and they are the
   * rules about how which we will abide. IF ANYTHING TOUCHES A FORMULA, THERE IS A PROBLEM." So
   * the screen does not merely draw what the engine said -- it checks it, on every row, every
   * time the list loads, and says so where it does not hold.
   *
   * THE CHECK DOES NOT STOP THE APPROVAL, and that is deliberate. The money has arrived either
   * way; a screen that refused to show a receipt it could not reconcile would leave the firm with
   * nothing to act on. It is marked, named and approvable.
   */
  const checked = useMemo(() => rows.map((r) => {
    const a = awaitingAllocation(r)
    return { row: r, a, problems: checkAllocation(a) }
  }), [rows])
  const broken = useMemo(() => checked.filter((c) => c.problems.length > 0), [checked])

  function toggleSection(k: SectionKey) {
    setOpened((p) => toggled(p, k))
  }

  async function approve(ids: string[]) {
    if (ids.length === 0 || busy) return
    setBusy(true); setError(null)
    try {
      const out = await approvePayments(ids)
      /* A PAYMENT THAT COULD NOT GO THROUGH NAMES ITSELF and the rest still did -- the database
         approves them one at a time inside one call. Reported rather than swallowed. */
      if (out.problems.length > 0) {
        setError(`${out.approved} approved, ${out.skipped} could not be: ${out.problems.slice(0, 3).join('; ')}`)
      }
      setPicked(new Set())
      await load()
      onApproved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Those payments could not be approved.')
    } finally { setBusy(false) }
  }

  /*
   * PUT ONE BACK. Refused by the database where the statement line has since been placed on
   * another payment -- then putting this one back would claim money that is already somewhere
   * else -- so the error is shown rather than swallowed.
   */
  async function putBack(id: string) {
    setBusy(true); setError(null)
    try {
      await unrejectPayment(id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That receipt could not be put back.')
    } finally { setBusy(false) }
  }

  function toggle(id: string) {
    setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  if (loading) {
    return <Card><div className="py-8 text-center"><Loader2 className="mx-auto w-4 h-4 animate-spin text-slate-400" /></div></Card>
  }
  /*
   * AN EMPTY QUEUE STILL CARRIES THE UNDO, because rejecting the last receipt is how the queue
   * empties -- the firm's own words are "I want to start throwing things in", and a Put it back
   * button that disappears at the moment it is most likely to be wanted is not an undo at all.
   *
   * AND IT NO LONGER SAYS EVERYTHING WAS APPROVED. It said that unconditionally, which is untrue
   * on exactly the morning this screen was built for: nothing was approved, eight things were
   * thrown out. A line that is wrong when something unusual has happened is worse than no line,
   * because it is read on the day somebody is checking.
   */
  if (rows.length === 0) {
    return (
      <Card padded={false}>
        <p className="px-4 py-4 text-center text-[13px] text-slate-500">
          {rejected.length > 0
            ? 'No payments waiting. Everything that has arrived has been approved or rejected.'
            : 'No payments waiting. Everything that has arrived has been approved.'}
        </p>
        <RejectedToday rejected={rejected} busy={busy} onPutBack={putBack} />
      </Card>
    )
  }

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-[15px] font-semibold text-slate-800">Payments waiting for you</h3>
          <p className="text-[12px] text-slate-500">
            Nothing has moved yet. These are the figures each one would post if you approve it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold tabular-nums text-navy-950">{rand(total)}</span>
          <button type="button" disabled={busy || picked.size === 0}
            onClick={() => void approve([...picked])}
            className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-slate-200
              text-slate-600 hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-40">
            Approve {picked.size} · {rand(pickedTotal)}
          </button>
          {/*
            AND THE OTHER WAY OFF THE LIST, beside the one that was there.

            THE FIRM: "there's some ones waiting in the queue to be approved, but I don't want to
            approve them." Until now the only button that cleared a row was the one that posted it.
          */}
          <button type="button" disabled={busy || picked.size === 0}
            onClick={() => setRejecting(rows.filter((r) => picked.has(r.paymentId)))}
            className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-slate-200
              text-slate-600 hover:border-negative-300 hover:bg-negative-50 disabled:opacity-40">
            Reject {picked.size}
          </button>
          <button type="button" disabled={busy}
            onClick={() => void approve(rows.map((r) => r.paymentId))}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg
              border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500 disabled:opacity-40">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Approve all {rows.length}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-negative-50 px-4 py-2.5 text-[13px] text-negative-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {/*
        AND THE FORMULAS THEMSELVES, WHERE ONE OF THEM DID NOT HOLD.

        THE FIRM ASKED FOR THIS DIRECTLY: "if anything touches a formula, there is a problem." The
        band is absent when everything holds -- a warning that fires when nothing is wrong is worse
        than no warning, because people stop reading it. Named rules, not "the figures do not
        balance": one tells somebody where to look and the other tells them to call somebody.
      */}
      {broken.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-900">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {broken.length === 1 ? 'One payment does not' : `${broken.length} payments do not`} obey
            the allocation formulas. Nothing is blocked — check these before approving.
          </p>
          <ul className="mt-1 ml-5 list-disc space-y-0.5">
            {broken.slice(0, 4).map((c) => (
              <li key={c.row.paymentId}>
                <span className="font-medium">{c.row.caseNumber ?? c.row.accountNumber}</span>
                {' · '}{c.problems[0].rule}: {c.problems[0].detail}
                {c.problems.length > 1 && ` (and ${c.problems.length - 1} more)`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] whitespace-nowrap">
          {/*
            TWO HEADER ROWS, BECAUSE A PAYMENT HAS TWO SIDES AND THE FIRM DREW IT THAT WAY.

            THE FIRM: "what I need you to do is to split the payments into two... you'll see the
            payment. Then first we will handle the fees section and then we will handle the capital
            section. It's 50-50 unless the fees are less than 50% of the payment, then the rest is
            allocated to the capital."

            THE SPANS ARE COMPUTED FROM WHAT IS OPEN, so an opened section widens its own group
            rather than pushing the headings out of line -- a colspan written as a constant goes
            wrong the first time somebody clicks.
          */}
          <thead className="text-[10.5px] uppercase tracking-wide text-slate-500">
            <tr className="border-b border-slate-100 text-slate-400">
              {/*
                SIX: the tick box, Received, Account, Debtor, Client and Payment. It was five until
                the client name went in, and a span left behind shifts every heading after it by one
                column -- so the figure under "Commission" is the VAT. Nothing warns; the screen
                looks right and the firm reads the wrong number off it. check-allocation-rules adds
                the three fixed spans up against the number of fixed columns for exactly this, and
                it is what caught the stale five.
              */}
              <th colSpan={6} />
              <th colSpan={feeColumns(opened)}
                className="px-2 py-1.5 text-left font-semibold tracking-wider border-l border-slate-200">
                The fees side — half the payment
              </th>
              {/* SEVEN: capital outstanding, taking and after, then commission, its VAT, what the
                  client is paid and what the client owes. `Due to BF` belongs on this side and not
                  outside it -- it is the same money read from the other direction, owed BY the
                  client where the debtor paid them rather than the firm. */}
              <th colSpan={7}
                className="px-2 py-1.5 text-left font-semibold tracking-wider border-l border-slate-200">
                The capital side — the other half, and whatever the fees side could not spend
              </th>
              <th colSpan={2} />
            </tr>
            <tr className="border-b border-slate-100">
              <th className="px-3 py-2">
                <input type="checkbox"
                  checked={picked.size === rows.length && rows.length > 0}
                  onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.paymentId)) : new Set())} />
              </th>
              <th className="px-2 py-2 text-left font-medium">Received</th>
              <th className="px-2 py-2 text-left font-medium">Account</th>
              <th className="px-2 py-2 text-left font-medium">Debtor</th>
              {/* THE FIRM ASKED FOR THIS ONE. The queue mixes every client, and every column to the
                  right of the payment -- commission, VAT, what goes to the client -- is about a
                  client the row did not name. The rows reading "no rate" are the sharpest case: the
                  question that answers is "which client has no mandate rate here", and the screen
                  could not say. */}
              <th className="px-2 py-2 text-left font-medium">Client</th>
              <th className="px-2 py-2 text-right font-medium">Payment</th>
              <FeeHeadCells opened={opened} onToggle={toggleSection} />
              {/*
                THE LINE ITEM THE FIRM FOUND MISSING: "one line item that is missing is the capital
                outstanding. So the capital outstanding will be what is outstanding on the capital
                of the payment." Drawn either side of what the payment takes, the same shape as an
                opened fee section, so the two sides of the screen read the same way.
              */}
              <th className="px-2 py-2 text-right font-normal text-slate-400 border-l border-slate-200">
                Capital outstanding
              </th>
              <th className="px-2 py-2 text-right font-medium">Capital taking</th>
              <th className="px-2 py-2 text-right font-normal text-slate-400">Capital after</th>
              {/*
                "COMMISSION", NOT "RETAINED COL. COMMISSION" -- the firm's own correction: "the
                retained collection commission, just call that commission and then VAT is the VAT
                on commission and then pay to the client, due to BF."
              */}
              <th className="px-2 py-2 text-right font-medium">Commission</th>
              <th className="px-2 py-2 text-right font-medium">VAT</th>
              <th className="px-2 py-2 text-right font-medium">To client</th>
              <th className="px-2 py-2 text-right font-medium border-l border-slate-200">Due to BF</th>
              <th className="px-2 py-2 text-left font-medium">Type</th>
              <th className="px-2 py-2 text-left font-medium">Reference</th>
            </tr>
          </thead>
          <tbody>
            {checked.map(({ row: r, a, problems }) => (
              <tr key={r.paymentId}
                /*
                  A RETURNED RECEIPT IS TINTED, and that is not decoration. The firm: a reversal
                  "goes back into a state ready for approval" -- so it arrives on this list looking
                  exactly like the morning's new money, and approving it unread puts it straight
                  back onto the debtor it should never have been on.
                */
                className={`border-b border-slate-50 ${
                  picked.has(r.paymentId) ? 'bg-gold-50/40'
                    : problems.length > 0 ? 'bg-amber-50'
                      : r.cameBackFrom ? 'bg-amber-50/50' : ''}`}>
                <td className="px-3 py-1.5">
                  <input type="checkbox" checked={picked.has(r.paymentId)}
                    onChange={() => toggle(r.paymentId)} />
                </td>
                <td className="px-2 py-1.5 text-slate-600">{formatDate(r.receivedOn)}</td>
                <td className="px-2 py-1.5 text-slate-600">
                  {r.caseNumber ?? r.accountNumber}
                  {/* THE RULES THAT DID NOT HOLD, ON THE ROW THEY DID NOT HOLD ON. The band at the
                      top carries the first four; a morning with more than four needs the rest
                      findable, and the row is where somebody is already looking. */}
                  {problems.length > 0 && (
                    <span className="ml-1 inline-flex align-middle text-amber-700"
                      title={problems.map((v) => `${v.rule} — ${v.detail}`).join('\n')}>
                      <AlertTriangle size={11} />
                    </span>
                  )}
                  {/*
                    THE ONE THING THIS SCREEN MAY CHANGE, and the firm chose it: which debtor the
                    money goes on. The amount and the date are what the bank said. Offered on every
                    row rather than only the returned ones -- a receipt placed on the wrong debtor
                    by a mistyped reference is the same mistake found one step earlier.
                  */}
                  <button type="button" onClick={() => setMoving(r)}
                    className="ml-1.5 text-[11px] font-medium text-slate-400 underline underline-offset-2
                      hover:text-slate-700">
                    Move
                  </button>
                  {/*
                    BESIDE MOVE, BECAUSE THEY ARE THE SAME QUESTION ANSWERED TWO WAYS. Move is "I
                    know whose this is"; Suspense is "I know it is not this debtor's and I do not
                    yet know whose". The second had no button at all, so the only ways out of the
                    queue were approving it onto an account somebody doubted or leaving it there.
                  */}
                  <button type="button" onClick={() => setParking(r)}
                    className="ml-1.5 text-[11px] font-medium text-slate-400 underline underline-offset-2
                      hover:text-slate-700">
                    Suspense
                  </button>
                  {/* AND THE THIRD ANSWER. Move is "I know whose this is"; Suspense is "I do not
                      know whose"; Reject is "this should not be a payment at all". */}
                  <button type="button" onClick={() => setRejecting([r])}
                    className="ml-1.5 text-[11px] font-medium text-slate-400 underline underline-offset-2
                      hover:text-negative-700">
                    Reject
                  </button>
                </td>
                <td className="px-2 py-1.5 text-slate-600 max-w-[12rem] truncate">{r.debtor}</td>
                {/*
                  WHOSE BOOK THIS RECEIPT IS ON, at the firm's asking.
                  
                  The queue mixes every client, and the columns to the right -- commission, VAT,
                  what goes to the client -- are all ABOUT a client this row never named. The rows
                  reading "no rate" are the sharpest case: the question that answers is "which
                  client has no mandate rate on this account", and the screen could not say.
                  
                  TRUNCATED LIKE THE DEBTOR BESIDE IT. "Highveld Glass & Aluminium (Pty) Ltd" is a
                  real client name and wrapping it doubles the height of a row in a hundred-row
                  morning; the full name is on the title.
                */}
                <td className="px-2 py-1.5 text-slate-500 max-w-[11rem] truncate" title={r.client ?? undefined}>
                  {r.client || '—'}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums font-medium text-navy-950">{rand(r.amount)}</td>
                {/*
                  NOT YET A LEDGER ROW, AND THE SCREEN SAYS SO. Most of the interest here is the
                  open period -- computed to the day the money arrived, written only when somebody
                  approves. A collector reading it down the telephone is quoting a real amount; one
                  looking for it in the ledger before approval will not find it, and the marker is
                  what stops that being a surprise.
                */}
                <FeeBodyCells a={a} opened={opened}
                  note={r.interestOpen > 0 && r.interestOpenFrom
                    ? `${rand(r.interestOpen)} of the interest has accrued since ${
                        formatDate(r.interestOpenFrom)} and is posted when you approve`
                    : undefined} />
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-400 border-l border-slate-200">
                  {rand(r.capitalBefore)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{rand(r.toCapital)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{rand(r.capitalAfter)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">
                  {/* NO RATE IS NOT A ZERO. Approving still writes the allocation, marked
                      needs_rate, and the exceptions screen carries it -- but a confident 0.00
                      here would read as "this client pays us nothing". */}
                  {r.hasRate ? rand(r.commission) : <span className="text-amber-700">no rate</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{rand(r.commissionVat)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-[var(--c-green)]">{rand(r.toClient)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600 border-l border-slate-200">
                  {rand(r.dueToBf)}
                </td>
                <td className="px-2 py-1.5">
                  {/* THE TWO DIRECTIONS OF MONEY, named the way the firm's own export names them. */}
                  <span className={`text-[10.5px] px-1.5 py-0.5 rounded ${
                    r.paidToClient
                      ? 'bg-[var(--tint-steel)] text-[var(--c-navy-mid)]'
                      : 'bg-slate-100 text-slate-600'}`}>
                    {r.paidToClient ? 'Client direct' : 'Direct'}
                  </span>
                  {/*
                    WHY IT IS BACK, carried from the reversal it replaces. Without it the row is
                    indistinguishable from new money and gets approved again exactly as it was.
                  */}
                  {r.cameBackFrom && (
                    <span className="ml-1 inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5
                      rounded bg-amber-100 text-amber-900"
                      title={`Reversed ${r.cameBackOn ? formatDate(r.cameBackOn) : ''} — ${
                        r.cameBackReason ?? 'no reason given'}`}>
                      <RotateCcw size={10} /> Came back
                    </span>
                  )}
                  {/* AND THE MONEY THAT PAID NOTHING. An overpayment is held as a credit, never
                      paid over -- the client is owed capital and this is not capital. */}
                  {r.excess > 0 && (
                    <span className="ml-1 text-[10.5px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600"
                      title="Everything on the account is settled, so this is held as a credit rather than paid over">
                      {rand(r.excess)} credit
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-slate-500 max-w-[14rem] truncate"
                  title={r.bankDescription ?? r.details ?? ''}>
                  {r.reference ?? r.bankDescription ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {moving && (
        <MoveAccountModal
          payment={moving}
          onClose={() => setMoving(null)}
          onDone={async () => { setMoving(null); await load() }}
        />
      )}
      <RejectedToday rejected={rejected} busy={busy} onPutBack={putBack} />

      {rejecting && (
        <RejectModal
          payments={rejecting}
          onClose={() => setRejecting(null)}
          onDone={async () => { setRejecting(null); setPicked(new Set()); await load() }}
        />
      )}
      {parking && (
        <SuspendModal
          payment={parking}
          onClose={() => setParking(null)}
          onDone={async () => { setParking(null); await load() }}
        />
      )}
    </Card>
  )
}

/**
 * THROWING ONE OUT.
 *
 * THE FIRM: "there are no way to reject payments that are imported. From an import sheet. I don't
 * know if we can quickly build that in. So there's some ones waiting in the queue to be approved,
 * but I don't want to approve them."
 *
 * ------------------------------------------------------------------------------------------------
 * REJECTING IS NOT REVERSING, AND THE DIFFERENCE IS THE WHOLE DESIGN
 * ------------------------------------------------------------------------------------------------
 *
 * A REVERSAL undoes a payment that was approved and POSTED: a balance moved, a fee was raised, a
 * client may already have been paid on it, so it writes contra entries through the ledger. A
 * rejected receipt never reached any of that -- no allocation, no balance, no payover run -- so
 * there is nothing to reverse, and calling it one would put it on reports as money that came back.
 *
 * NOTHING IS DELETED EITHER. The money arrived in the trust account whatever anybody decided about
 * it; a receipt that disappeared from every screen is one nobody can reconcile against the bank
 * statement. So the payment row stands with the reason on it and the STATEMENT LINE is what moves.
 *
 * ------------------------------------------------------------------------------------------------
 * AND WHERE THE LINE GOES IS THE QUESTION THE BOX ASKS
 * ------------------------------------------------------------------------------------------------
 *
 * Two answers, and they are genuinely different work:
 *
 *   BACK ON THE UNALLOCATED LIST -- the money arrived and still has to be placed; it is this
 *   PAYMENT that is wrong. The firm picks it up on the Back office tab and places it properly.
 *
 *   NOT A RECEIPT AT ALL -- an interbank transfer, a bank error, something the importer misread.
 *   The line is marked excluded and leaves both lists. Putting one of these back on the
 *   unallocated list is work the firm would do again every morning, for ever.
 *
 * THE FIRST IS THE DEFAULT, because it is the safer wrong answer: a line that should have been
 * excluded and is on the unallocated list is noise somebody clears, and a line that should have
 * been placed and was excluded is money nobody is looking for.
 *
 * ONE REASON BETWEEN THEM. The receipts being thrown out together are being thrown out for the
 * same reason, and asking eight times is how somebody starts typing "x".
 */
/**
 * WHAT WAS THROWN OUT TODAY, AND THE WAY BACK.
 *
 * A rejection that left no trace would be a receipt gone from every screen -- and the money still
 * arrived in the trust account, so the bank would never reconcile against a list that quietly lost
 * rows.
 *
 * TODAY'S ONLY. The record is permanent and `payments_rejected` carries all of it, but this strip
 * is about what just happened; a month of rejections here would be a second list nobody reads.
 *
 * ONE COMPONENT BECAUSE IT IS DRAWN IN TWO PLACES -- under the queue, and under the empty-queue
 * line, since rejecting the last receipt is how the queue empties. Written out twice they drift,
 * and the half that would rot is the one somebody only sees on the morning they threw everything
 * out.
 */
function RejectedToday({ rejected, busy, onPutBack }: {
  rejected: RejectedPayment[]
  busy: boolean
  onPutBack: (id: string) => Promise<void>
}) {
  if (rejected.length === 0) return null
  return (
    <div className="border-t border-slate-100 px-4 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
        Rejected today · {rejected.length}
      </p>
      <ul className="mt-1.5 space-y-1">
        {rejected.map((r) => (
          <li key={r.paymentId} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
            <span className="text-slate-600">{r.caseNumber ?? r.accountNumber}</span>
            <span className="tabular-nums text-slate-500">{rand(r.amount)}</span>
            <span className="text-slate-500 truncate max-w-[22rem]"
              title={r.rejectionReason ?? ''}>
              {r.rejectionReason}
            </span>
            {/* WHERE THE STATEMENT LINE WENT, because that is what somebody has to act on
                next: back on the unallocated list to be placed, or marked as not a receipt. */}
            <span className="text-[11px] text-slate-400">
              {r.lineStatus === 'excluded' ? 'not a receipt'
                : r.lineStatus === 'unallocated' ? 'back on the unallocated list'
                  : r.source === 'bank_import' ? '' : 'captured by hand'}
            </span>
            <button type="button" disabled={busy} onClick={() => void onPutBack(r.paymentId)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400
                underline underline-offset-2 hover:text-slate-700 disabled:opacity-40">
              <Undo2 size={10} /> Put it back
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function RejectModal({ payments, onClose, onDone }: {
  payments: AwaitingPayment[]
  onClose: () => void
  onDone: () => Promise<void> | void
}) {
  const [reason, setReason] = useState('')
  const [notAReceipt, setNotAReceipt] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total = payments.reduce((n, p) => n + p.amount, 0)
  /* ONLY WHAT CAME OFF A STATEMENT HAS A LINE TO SEND ANYWHERE. A receipt captured by hand has
     none, so the choice below would be a question about nothing -- and offering it would suggest
     the firm is deciding something they are not. */
  const fromTheBank = payments.filter((p) => p.bankLineId).length

  async function throwOut() {
    if (!reason.trim()) return
    setBusy(true); setError(null)
    try {
      const out = await rejectPayments(
        payments.map((p) => p.paymentId), reason.trim(), notAReceipt)
      /* ONE THAT COULD NOT BE REJECTED NAMES ITSELF AND THE REST STILL WERE -- the same shape
         approve uses, because two people clearing one morning's queue is ordinary. */
      if (out.problems.length > 0) {
        setError(`${out.rejected} rejected, ${out.skipped} could not be: ${
          out.problems.slice(0, 3).join('; ')}`)
        setBusy(false)
        return
      }
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Those receipts could not be rejected.')
      setBusy(false)
    }
  }

  return (
    <Modal
      title={payments.length === 1 ? 'Reject this receipt' : `Reject ${payments.length} receipts`}
      subtitle={`${rand(total)}`}
      onClose={onClose} width={480}>
      <p className="text-sm text-slate-500">
        {payments.length === 1 ? 'It leaves' : 'They leave'} the approval queue without being
        split. No balance moves, no fee is raised and nothing reaches a payover run.
      </p>
      {/* NOT DELETED, SAID ON THE SCREEN. Somebody pressing this needs to know the money is still
          accounted for, or they will go looking for it. */}
      <p className="text-[11px] text-slate-400 mt-2">
        Nothing is deleted. {payments.length === 1 ? 'The receipt stays' : 'The receipts stay'} on
        the record with your reason, and you can put {payments.length === 1 ? 'it' : 'them'} back.
      </p>

      <label className="block mt-3">
        <span className="text-xs font-medium text-slate-600">Why?</span>
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Duplicate of the receipt on the 3rd"
          className={`${inputClass} mt-1`} />
      </label>

      {fromTheBank > 0 && (
        <fieldset className="mt-3">
          <legend className="text-xs font-medium text-slate-600">
            And the {fromTheBank === 1 ? 'statement line' : 'statement lines'}?
          </legend>
          <label className="mt-1.5 flex items-start gap-2 text-[13px] text-slate-600">
            <input type="radio" name="line" checked={!notAReceipt} className="mt-0.5"
              onChange={() => setNotAReceipt(false)} />
            <span>
              Back on the unallocated list
              <span className="block text-[11px] text-slate-400">
                The money arrived and still has to be placed — it is this payment that is wrong.
              </span>
            </span>
          </label>
          <label className="mt-1.5 flex items-start gap-2 text-[13px] text-slate-600">
            <input type="radio" name="line" checked={notAReceipt} className="mt-0.5"
              onChange={() => setNotAReceipt(true)} />
            <span>
              It is not a debtor receipt at all
              <span className="block text-[11px] text-slate-400">
                A transfer, a bank error, something the import misread. It leaves both lists.
              </span>
            </span>
          </label>
        </fieldset>
      )}

      {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose}
          className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600">
          Keep {payments.length === 1 ? 'it' : 'them'}
        </button>
        <button type="button" disabled={busy || !reason.trim()} onClick={() => void throwOut()}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-1.5 rounded-lg
            border border-negative-200 bg-negative-50 text-negative-700
            hover:bg-negative-100 disabled:opacity-40">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
          Reject {payments.length === 1 ? 'it' : `all ${payments.length}`}
        </button>
      </div>
    </Modal>
  )
}

/**
 * PARKING A RECEIPT NOBODY IS READY TO APPROVE.
 *
 * THE FIRM: "when something is in that state of approval, it should also give you an option to put
 * it into suspense. So, for example, if you reverse a payment, it goes to a state of approval and
 * then you just say move to suspense."
 *
 * THE REASON IS REQUIRED AND THAT IS THE WHOLE OF THE BOX. `suspend_payment` refuses without one,
 * because a receipt sitting in suspense with no words is one nobody can place without going to
 * find whoever parked it -- and the person who parked it is the only one who knows why the account
 * it is on is wrong.
 *
 * IT STAYS ON ITS ACCOUNT, WRONGLY, AND ON PURPOSE. Detaching it would leave money belonging to
 * nobody and throw away the one clue to where it came from: the account somebody thought it was
 * for. The history then reads "received, reversed, parked, placed on the right debtor", which is
 * what happened.
 */
function SuspendModal({ payment, onClose, onDone }: {
  payment: AwaitingPayment
  onClose: () => void
  onDone: () => Promise<void> | void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function park() {
    if (!reason.trim()) return
    setBusy(true); setError(null)
    try {
      await suspendPayment(payment.paymentId, reason.trim())
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not move it to suspense.')
      setBusy(false)
    }
  }

  return (
    <Modal title="Move this receipt to suspense"
      subtitle={`${rand(payment.amount)} received ${formatDate(payment.receivedOn)}`}
      onClose={onClose} width={460}>
      <p className="text-sm text-slate-500">
        It leaves the approval queue and waits in suspense until somebody places it on the right
        debtor. Nothing is split and no fee is raised.
      </p>

      {/* WHERE IT IS SITTING NOW, said plainly: it is still on this account, and that is the only
          clue the next person has to where the money came from. */}
      <p className="text-[11px] text-slate-400 mt-2">
        It stays recorded against {payment.caseNumber ?? payment.accountNumber ?? 'this account'}
        {payment.debtor ? ` — ${payment.debtor}` : ''} until it is placed.
      </p>

      {/* AND WHY IT CAME BACK, where a reversal put it here. The person parking it should not have
          to go and find the words somebody else already wrote. */}
      {payment.cameBackReason && (
        <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2 mt-2">
          Came back {payment.cameBackOn ? formatDate(payment.cameBackOn) : ''} — {payment.cameBackReason}
        </p>
      )}

      <div className="mt-3">
        <label htmlFor="suspense-reason" className="text-sm font-medium text-slate-700">
          Why is it going to suspense?
        </label>
        <textarea id="suspense-reason" rows={3} value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reference matched two accounts — waiting for the client to confirm which."
          className={`${inputClass} mt-1 resize-none`} />
        <span className="block text-[11px] text-slate-400 mt-1">
          This is what the next person reads when they come to place it.
        </span>
      </div>

      {error && <p className="text-sm text-negative-700 mt-2">{error}</p>}

      <div className="flex items-center gap-2 mt-4">
        <button type="button" onClick={() => void park()} disabled={busy || !reason.trim()}
          className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg
            bg-brand-600 text-white disabled:opacity-40">
          {busy && <Loader2 size={15} className="animate-spin" />}
          Move it to suspense
        </button>
        <button type="button" onClick={onClose} className="text-sm text-slate-600 hover:text-slate-800 px-2">
          Cancel
        </button>
      </div>
    </Modal>
  )
}

/**
 * PUTTING AN UNAPPROVED RECEIPT ON THE RIGHT DEBTOR.
 *
 * THE FIRM, ASKED WHAT THIS SCREEN MAY CHANGE: the account only. Which debtor the money goes on is
 * what was wrong; the amount and the date are the bank's own facts and nobody may quietly turn
 * R 5 000 into R 500.
 *
 * IT IS NOT AN EDIT TO A FINANCIAL RECORD, and `set_payment_account` is what makes that true
 * rather than this screen: nothing has been split, no receipt fee raised and no remittance run
 * against an unapproved payment, which is the whole reason the approval gate exists. Approved, the
 * function refuses and says to reverse it instead.
 *
 * THE SEARCH IS THE ACCOUNTS LIST'S OWN -- the same one Suspense uses to place a receipt. A second,
 * subtly different way to find a debtor is how somebody puts money on a similar-looking account.
 */
function MoveAccountModal({ payment, onClose, onDone }: {
  payment: AwaitingPayment
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<DebtorAccount[]>([])
  const [looking, setLooking] = useState(false)
  const [chosen, setChosen] = useState<DebtorAccount | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const q = term.trim()
    if (q.length < 2) { setHits([]); return }
    let cancelled = false
    setLooking(true)
    /* Debounced, and no count: 100 000 rows per keystroke otherwise -- see fetchAccounts. */
    const t = setTimeout(() => {
      void fetchAccounts({ search: q, pageSize: 10, countRows: false })
        .then((r) => { if (!cancelled) setHits(r.accounts) })
        .catch(() => { if (!cancelled) setHits([]) })
        .finally(() => { if (!cancelled) setLooking(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [term])

  async function move() {
    if (!chosen || busy) return
    setBusy(true); setError(null)
    try {
      await setPaymentAccount(payment.paymentId, chosen.id)
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That payment could not be moved.')
      setBusy(false)
    }
  }

  return (
    <Modal title="Which debtor is this?" onClose={onClose} width={520}>
      <div className="space-y-3">
        <div className="rounded-lg bg-slate-50 px-3 py-2.5">
          <p className="text-[15px] font-semibold tabular-nums text-navy-950">{rand(payment.amount)}</p>
          <p className="text-[12px] text-slate-600 mt-0.5 wrap-anywhere">
            {payment.reference ?? payment.bankDescription ?? 'No reference'}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Received {formatDate(payment.receivedOn)} · on {payment.debtor} at the moment
          </p>
          {payment.cameBackFrom && (
            <p className="text-[11px] text-amber-800 mt-1">
              Reversed {payment.cameBackOn ? formatDate(payment.cameBackOn) : ''} —{' '}
              {payment.cameBackReason ?? 'no reason given'}
            </p>
          )}
        </div>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Move it to</span>
          <span className="relative block mt-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={term} onChange={(e) => { setTerm(e.target.value); setChosen(null) }}
              autoFocus placeholder="Case number, account number, reference or surname"
              className={`${inputClass} pl-8`} />
          </span>
        </label>

        {looking && <p className="text-[12px] text-slate-400">Looking…</p>}

        {hits.length > 0 && !chosen && (
          <ul className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
            {hits.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => setChosen(a)}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50">
                  <span className="block text-[13px] text-slate-800">
                    {[a.debtorFirstName, a.debtorSurname].filter(Boolean).join(' ') || 'No name'}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    {a.caseNumber} · {a.accountNumber} · {rand(a.capitalOutstanding)} outstanding
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {chosen && (
          <div className="rounded-lg border border-brand-500 bg-brand-50/50 px-3 py-2">
            <p className="text-[13px] text-slate-800">
              {[chosen.debtorFirstName, chosen.debtorSurname].filter(Boolean).join(' ') || 'No name'}
            </p>
            <p className="text-[11px] text-slate-500">{chosen.caseNumber} · {chosen.accountNumber}</p>
            <button type="button" onClick={() => setChosen(null)}
              className="text-[11px] text-slate-500 underline mt-1">Pick a different one</button>
          </div>
        )}

        {/* NOTHING IS SPLIT YET, said so nobody thinks moving it also books it. */}
        {chosen && (
          <p className="text-[12px] text-slate-500">
            Nothing is split until you approve it. The figures on the list are redrawn against this
            debtor&rsquo;s balances.
          </p>
        )}

        {error && <p className="rounded-lg bg-negative-50 px-3 py-2 text-[13px] text-negative-700">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="button" onClick={() => void move()} disabled={!chosen || busy}
            className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white
              hover:bg-brand-700 disabled:opacity-50">
            {busy ? 'Moving…' : 'Move it'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
