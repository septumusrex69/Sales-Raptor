import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, Search, Undo2, X,
} from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Modal, inputClass } from '../../components/ui/Modal'
import { rand } from '../../lib/money'
import { formatDate } from '../../data/mockData'
import { fetchAccounts, type DebtorAccount } from '../../lib/accountBook'
import {
  fetchAwaitingApproval, approvePayments, setPaymentAccount, suspendPayment,
  awaitingAllocation, fetchRejectedPayments, rejectPayments, unrejectPayment, fetchHandoverDates,
  type AwaitingPayment, type RejectedPayment,
} from '../../lib/payover'
import type { Allocation, Violation } from '../../lib/allocationRules'
import {
  batchReconciliation, batchTotals, checkedRow, splitForBatch, totalsByClient,
  type QueueException, type QueueFigures,
} from '../../lib/paymentsQueue'
import { cycleStartOn, shortDate } from '../../lib/trustCycles'
/*
 * THE FOUR FIGURES BEHIND EACH FEE LINE ARE DRAWN FROM ONE DEFINITION, shared with the
 * administrator's check of posted payments. On the queue they moved out of the table and into the
 * breakdown drawer -- a row is one line of answers now -- but the definitions are the same ones,
 * so the queue and the audit list cannot quietly disagree about what a payment paid.
 */
import { BEFORE, SECTIONS } from '../../components/finance/FeeSections'

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
 *
 * ------------------------------------------------------------------------------------------------
 * ONE LINE A PAYMENT (the redesign)
 * ------------------------------------------------------------------------------------------------
 *
 * About three thousand payments a month, so a row is 44-56px of figures, not a card: the debtor
 * pinned on the left, the money scrolling sideways in the order it is spent -- payment, interest
 * and fees, capital, commission, the final split, then what is unusual about it. Everything a row
 * cannot hold is in the breakdown drawer, one tap away. Every figure is the engine's;
 * `paymentsQueue.ts` names and sums them and never re-splits a payment.
 */
const PAGE = 100

export function AwaitingApproval({ refreshKey, onApproved, onLoaded }: {
  refreshKey: number
  onApproved: () => void
  /** The queue's size, for the overview tile above it -- read once, not fetched twice. */
  onLoaded?: (count: number, total: number) => void
}) {
  const [rows, setRows] = useState<AwaitingPayment[]>([])
  const [handovers, setHandovers] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* A failed READ, kept apart so a good reload clears it without wiping an action's report. */
  const [loadError, setLoadError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(0)
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
   * this is yet". Reject is "this should not become a payment at all" -- and REJECTING IS NOT A
   * REFUND: no money leaves the trust, the receipt simply does not become a payment.
   *
   * A LIST RATHER THAN A ROW, because a morning's rubbish is thrown out together and for the same
   * reason. One row goes through the same box with one id in it.
   */
  const [rejecting, setRejecting] = useState<AwaitingPayment[] | null>(null)
  /* WHAT WAS THROWN OUT, so it is visible rather than vanished -- and so the undo is beside the
     mistake. Rejecting happens at speed down a list, which is when the wrong row gets pressed. */
  const [rejected, setRejected] = useState<RejectedPayment[]>([])
  /* The payment open in the breakdown drawer. */
  const [opened, setOpened] = useState<string | null>(null)
  /* APPROVE ALL ASKS FIRST, because "all" is the whole queue and not the page on the screen. */
  const [confirmAll, setConfirmAll] = useState(false)

  /*
   * A RELOAD DOES NOT CLEAR THE ERROR LINE. Approving reloads this list twice -- once itself and
   * once through the page's refresh key -- and a reload that cleared it wiped "2 approved, 1 could
   * not be" before anybody could read it, which is the one sentence the firm needs after a partial
   * approval. Each action clears it when it starts instead.
   */
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [queue, thrown] = await Promise.all([
        fetchAwaitingApproval(),
        /* TODAY'S ONLY. The record is permanent, but the strip under the queue is about what just
           happened -- a month of rejections there would be a second list nobody reads. */
        fetchRejectedPayments(new Date().toISOString().slice(0, 10)),
      ])
      setRows(queue)
      setRejected(thrown)
      setLoadError(null)
      /* A ROW THAT LEFT THE QUEUE LEAVES THE SELECTION, or "Approve 3" would approve a payment
         somebody else already approved -- or worse, count one that is no longer here. */
      setPicked((p) => new Set([...p].filter((id) => queue.some((r) => r.paymentId === id))))
      /* The badge only. Without it a row is drawn without "before handover", never with a pass. */
      fetchHandoverDates(queue.map((r) => r.accountId)).then(setHandovers).catch(() => setHandovers(new Map()))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the day’s payments.')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load, refreshKey])

  /*
   * THE FIGURES AS THE RULES SEE THEM, AND WHAT THE RULES MAKE OF THEM.
   *
   * THE FIRM: "you can build in testing mechanisms... These formulas are the key and they are the
   * rules about how which we will abide. IF ANYTHING TOUCHES A FORMULA, THERE IS A PROBLEM." So
   * the screen does not merely draw what the engine said -- it checks it, on every row, every
   * time the list loads, and says so where it does not hold.
   *
   * AND THE CHECK COMES BEFORE THE APPROVAL (the firm, 8 Oct: "the check should happen before the
   * payment is done"). A row that breaks a formula is held out of Approve selected and Approve all
   * and is approved on its own from its breakdown, by somebody ticking that they checked it. Held,
   * not refused: the money has arrived either way. See splitForBatch.
   */
  const checked = useMemo(() => rows.map((r) =>
    checkedRow(r, awaitingAllocation(r), handovers.get(r.accountId) ?? null)), [rows, handovers])
  const broken = useMemo(() => checked.filter((c) => c.problems.length > 0), [checked])
  /* What a batch may carry: never a row that breaks a formula. */
  const batchAll = useMemo(() => splitForBatch(checked), [checked])
  const batchPicked = useMemo(() => splitForBatch(checked.filter((c) => picked.has(c.row.paymentId))), [checked, picked])
  const cleanTotal = useMemo(() => rows.filter((r) => batchAll.clean.includes(r.paymentId)).reduce((n, r) => n + r.amount, 0), [rows, batchAll])
  const totals = useMemo(() => batchTotals(rows), [rows])
  const total = totals.total
  useEffect(() => { if (!loading) onLoaded?.(rows.length, total) }, [loading, rows.length, total, onLoaded])

  const pickedRows = useMemo(() => rows.filter((r) => picked.has(r.paymentId)), [rows, picked])
  const pickedTotal = useMemo(() => pickedRows.reduce((n, r) => n + r.amount, 0), [pickedRows])
  const pages = Math.max(1, Math.ceil(checked.length / PAGE))
  const shown = checked.slice(page * PAGE, page * PAGE + PAGE)
  useEffect(() => { if (page > pages - 1) setPage(pages - 1) }, [page, pages])

  async function approve(ids: string[]) {
    /* BUSY IS THE GUARD AGAINST A SECOND PRESS: every approve button is disabled while one runs,
       and this refuses a call that slipped in before the re-render. */
    if (ids.length === 0 || busy) return
    setBusy(true); setError(null)
    try {
      const out = await approvePayments(ids)
      setPicked(new Set())
      await load()
      onApproved()
      /* A PAYMENT THAT COULD NOT GO THROUGH NAMES ITSELF and the rest still did -- the database
         approves them one at a time inside one call. Reported rather than swallowed. */
      if (out.problems.length > 0) {
        setError(`${out.approved} approved, ${out.skipped} could not be: ${out.problems.slice(0, 3).join('; ')}`)
      }
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

  if (loading && rows.length === 0) {
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
      <QueueSection count={0}>
        <Card padded={false}>
          {(error ?? loadError) && (
            <div className="flex items-start gap-2 bg-negative-50 px-4 py-2.5 text-[13px] text-negative-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error ?? loadError}</span>
            </div>
          )}
          <div className="flex items-start gap-3 px-5 py-4" data-testid="queue-empty">
            <Check size={20} className="mt-0.5 shrink-0 text-[var(--c-steel)]" />
            <div>
              <p className="text-[14px] font-medium text-slate-800">No payments waiting for approval</p>
              <p className="text-[12.5px] text-slate-500">
                {rejected.length > 0
                  ? 'Everything that has arrived has been approved or rejected.'
                  : 'All payments in the approval queue have been approved.'}
              </p>
            </div>
          </div>
          <RejectedToday rejected={rejected} busy={busy} onPutBack={putBack} />
        </Card>
      </QueueSection>
    )
  }

  const open = opened ? checked.find((c) => c.row.paymentId === opened) ?? null : null
  const allOnPage = shown.length > 0 && shown.every((c) => picked.has(c.row.paymentId))

  return (
    <QueueSection count={rows.length}>
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <p className="text-[12.5px] text-slate-500">
          Nothing has moved yet. These are the figures each one would post if you approve it.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy || batchPicked.clean.length === 0}
            onClick={() => void approve(batchPicked.clean)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-slate-200
              text-slate-600 hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-40">
            Approve selected · {batchPicked.clean.length} · {rand(batchPicked.held.length > 0
              ? rows.filter((r) => batchPicked.clean.includes(r.paymentId)).reduce((n, r) => n + r.amount, 0)
              : pickedTotal)}
            {batchPicked.held.length > 0 && ` (${batchPicked.held.length} held to check)`}
          </button>
          {/*
            AND THE OTHER WAY OFF THE LIST, beside the one that was there.

            THE FIRM: "there's some ones waiting in the queue to be approved, but I don't want to
            approve them." Until then the only button that cleared a row was the one that posted it.
          */}
          <button type="button" disabled={busy || picked.size === 0}
            onClick={() => setRejecting(pickedRows)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-slate-200
              text-slate-600 hover:border-negative-300 hover:bg-negative-50 disabled:opacity-40">
            Reject selected · {picked.size}
          </button>
          <button type="button" disabled={busy || batchAll.clean.length === 0} onClick={() => setConfirmAll(true)}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg
              border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500 disabled:opacity-40">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Approve all {batchAll.clean.length} · {rand(cleanTotal)}
          </button>
        </div>
      </div>

      {(error ?? loadError) && (
        <div className="flex items-start gap-2 bg-negative-50 px-4 py-2.5 text-[13px] text-negative-700"
          data-testid="queue-error">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error ?? loadError}</span>
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
            the allocation formulas. {broken.length === 1 ? 'It is' : 'They are'} held out of
            Approve all: open each one, check it, and approve it on its own.
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

      <BatchSummary rows={rows} />

      {/*
        THE TABLE SCROLLS SIDEWAYS AND THE DEBTOR DOES NOT.

        The tick box and the debtor are `sticky` on the left with an OPAQUE background -- a
        translucent one lets the figures scrolling under it show through, and a row then reads as
        two payments printed over each other. `touch-pan-x` and momentum scrolling are for the
        firm's iPad; the scrollbar stays visible on a desktop, where a hidden one leaves half the
        columns undiscoverable.
      */}
      <div className="overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] queue-scroll"
        data-testid="queue-scroll">
        <table className="min-w-full text-[12.5px] whitespace-nowrap border-separate border-spacing-0 text-[12.5px]">
          <thead className="text-[10.5px] uppercase tracking-wide text-slate-500">
            <tr className="text-slate-400">
              <th colSpan={2} className={`${STICKY_HEAD} left-0 z-20`} />
              <GroupHead span={3}>Payment</GroupHead>
              {/* "INCL. VAT" ONCE, ON THE GROUP, not on every column under it (the firm, 8 Oct: the long
                  headings did not sit with the rest). Every figure under these two groups includes it. */}
              <GroupHead span={4} note="incl. VAT">Interest and fees</GroupHead>
              <GroupHead span={3}>Capital</GroupHead>
              <GroupHead span={3}>Commission</GroupHead>
              <GroupHead span={4} note="incl. VAT">Final split</GroupHead>
              <GroupHead span={3}>Review</GroupHead>
            </tr>
            <tr>
              <th className={`${STICKY_HEAD} left-0 z-20 ${TICK_COL} py-2 border-b border-slate-100`}>
                <input type="checkbox" aria-label="Select every payment on this page" checked={allOnPage}
                  onChange={(e) => setPicked((p) => {
                    const n = new Set(p)
                    for (const c of shown) { if (e.target.checked) n.add(c.row.paymentId); else n.delete(c.row.paymentId) }
                    return n
                  })} />
              </th>
              <th className={`${STICKY_HEAD} left-10 z-20 px-2 py-2 text-left font-medium border-b border-r border-slate-100 min-w-[13rem]`}>
                Debtor
              </th>
              <Th first>Received</Th><Th right>Amount</Th><Th>Route</Th>
              <Th first right>Interest</Th><Th right>Receipt fee</Th>
              <Th right>Earlier fees</Th><Th right>Unused → capital</Th>
              <Th first right>Outstanding before</Th><Th right>Paid</Th><Th right>Remaining</Th>
              <Th first right>Rate</Th><Th right>Amount</Th><Th right>VAT on commission</Th>
              <Th first right>To client</Th><Th right>BF keeps</Th>
              <Th right>Debtor credit</Th><Th right>PTC due to BF</Th>
              <Th first>Exceptions</Th><Th>Reference</Th><Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ row: r, f, exceptions, problems }) => {
              const sel = picked.has(r.paymentId)
              /*
               * A TINTED ROW IS A ROW TO READ. A returned receipt arrives looking exactly like the
               * morning's new money, and approving it unread puts it straight back onto the debtor
               * it should never have been on.
               */
              const tint = sel ? 'bg-gold-50' : problems.length > 0 || r.cameBackFrom ? 'bg-amber-50' : ''
              return (
                <tr key={r.paymentId} data-testid="queue-row" data-payment={r.paymentId}
                  className={`h-12 ${tint}`}>
                  {/* THE PINNED CELLS STAY SOLID and carry the row's state as a bar instead: a
                      tint is translucent on some skins, and a pinned cell must hide what scrolls
                      beneath it. */}
                  <td className={`${STICKY_CELL} left-0 ${TICK_COL} ${sel ? 'shadow-[inset_3px_0_0_#c9a052]'
                    : tint ? 'shadow-[inset_3px_0_0_#d97706]' : ''}`}>
                    <input type="checkbox" aria-label={`Select ${r.debtor ?? 'this payment'}`} checked={sel}
                      onChange={() => toggle(r.paymentId)} />
                  </td>
                  <td className={`${STICKY_CELL} left-10 px-2 border-r min-w-[13rem] max-w-[16rem]`}>
                    <button type="button" onClick={() => setOpened(r.paymentId)}
                      className="block w-full text-left" title="Open the breakdown">
                      <span className="block truncate font-medium text-slate-800 hover:underline">
                        {r.debtor || 'Unnamed debtor'}
                      </span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {r.caseNumber ?? r.accountNumber}{r.client ? ` · ${r.client}` : ''}
                      </span>
                    </button>
                  </td>
                  <Td first muted>{formatDate(r.receivedOn)}</Td>
                  <Td right strong>{rand(r.amount)}</Td>
                  <Td>
                    <span className={`text-[10.5px] px-1.5 py-0.5 rounded ${f.route === 'ptc'
                      ? 'bg-[var(--tint-steel)] text-[var(--c-navy-mid)]' : 'bg-slate-100 text-slate-600'}`}>
                      {f.route === 'ptc' ? 'Paid client (PTC)' : 'Paid into trust'}
                    </span>
                  </Td>
                  <Td first right>{rand(f.interestPaid)}</Td>
                  <Td right>{rand(f.receiptFeePaid)}</Td>
                  <Td right>{rand(f.earlierFeesPaid)}</Td>
                  <Td right muted>{rand(f.halfAUnused)}</Td>
                  <Td first right muted>{rand(f.capitalBefore)}</Td>
                  <Td right>{rand(f.capitalPaid)}</Td>
                  <Td right muted>{rand(f.capitalAfter)}</Td>
                  {/* NO RATE IS NOT A ZERO. Approving still writes the allocation, marked
                      needs_rate, and the exceptions screen carries it -- but a confident 0.00
                      here would read as "this client pays us nothing". */}
                  <Td first right muted>{f.commissionRate !== null ? pct(f.commissionRate) : <span className="text-amber-700">no rate</span>}</Td>
                  <Td right>{r.hasRate ? rand(f.commission) : '—'}</Td>
                  <Td right muted>{rand(f.commissionVat)}</Td>
                  <Td first right emph>
                    {rand(f.toClient)}
                    {/* ON A PTC THE CLIENT ALREADY HAS ITS SHARE, and nought paid over has to say
                        so or it reads as a client who gets nothing. */}
                    {f.route === 'ptc' && (
                      <span className="block text-[10.5px] font-normal text-slate-400">{rand(f.clientShare)} held by client</span>
                    )}
                  </Td>
                  <Td right emph>{rand(f.bfShare)}</Td>
                  <Td right muted>{f.credit > 0 ? rand(f.credit) : rand(0)}</Td>
                  <Td right>{f.ptcDueToBf !== null ? rand(f.ptcDueToBf) : <span className="text-slate-300">—</span>}</Td>
                  <Td first><Badges list={exceptions} /></Td>
                  <Td muted>
                    <span className="block max-w-[12rem] truncate" title={r.bankDescription ?? r.details ?? ''}>
                      {r.reference ?? r.bankDescription ?? '—'}
                    </span>
                  </Td>
                  <Td>
                    {/*
                      THE THREE ANSWERS TO "THIS SHOULD NOT BE APPROVED AS IT IS". Move is "I know
                      whose this is"; Suspense is "I do not yet know whose"; Reject is "this should
                      not be a payment at all". The amount and the date are the bank's facts and no
                      action here changes them.
                    */}
                    {/* INLINE, NOT A MENU: a dropdown inside the sideways scroller is clipped by it,
                        and on the last row of the page it opened into nothing. */}
                    <span className="inline-flex gap-2 text-[11px] font-medium">
                      <button type="button" onClick={() => setMoving(r)}
                        className="text-slate-400 underline underline-offset-2 hover:text-slate-700">Move</button>
                      <button type="button" onClick={() => setParking(r)}
                        className="text-slate-400 underline underline-offset-2 hover:text-slate-700">Suspense</button>
                      <button type="button" onClick={() => setRejecting([r])}
                        className="text-slate-400 underline underline-offset-2 hover:text-negative-700">Reject</button>
                    </span>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-[12.5px]">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Back</button>
          <span className="text-slate-500">
            {page * PAGE + 1}–{Math.min(checked.length, page * PAGE + PAGE)} of {checked.length.toLocaleString('en-ZA')}
          </span>
          <button type="button" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-40">Next {PAGE}</button>
        </div>
      )}

      {open && (
        <Breakdown key={open.row.paymentId} row={open.row} a={open.a} f={open.f} problems={open.problems}
          exceptions={open.exceptions} onClose={() => setOpened(null)}
          busy={busy} onApprove={async () => { await approve([open.row.paymentId]); setOpened(null) }} />
      )}
      {confirmAll && (
        <ApproveAllModal count={batchAll.clean.length} total={cleanTotal} trust={totals.direct} ptc={totals.ptc}
          held={batchAll.held.length}
          busy={busy} onClose={() => setConfirmAll(false)}
          onConfirm={async () => { await approve(batchAll.clean); setConfirmAll(false) }} />
      )}
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
    </QueueSection>
  )
}

/**
 * THE QUEUE'S HEADING SITS ABOVE ITS CARD, as the firm's mock-up draws it: "Approval queue" with the
 * count on the right, empty or not -- so an empty queue still says what it is and that it is empty,
 * rather than the section disappearing and leaving the page to be read for its absence.
 */
function QueueSection({ count, children }: { count: number; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[16px] font-semibold text-slate-800" data-testid="queue-heading">Approval queue</h2>
        <span className="text-[13px] text-slate-500">{count.toLocaleString('en-ZA')} pending</span>
      </div>
      {children}
    </section>
  )
}

/* ---------------------------------------------------------------- table pieces */

/* THE BACKGROUND IS THE CARD'S, MADE SOLID. `--color-card` is translucent on the glass skin, and a
   sticky cell must hide what scrolls beneath it -- so it reads `--color-card-solid` where a skin
   defines one. */
const STICKY_HEAD = 'sticky bg-[var(--color-card-solid,var(--color-card))]'
/* EXACTLY 2.5rem, because the debtor column is pinned at `left-10`: a tick-box column a few pixels
   wider lets the scrolled headings show through the gap between the two pinned cells. */
const TICK_COL = 'w-10 min-w-10 max-w-10 px-0 text-center'
const STICKY_CELL = 'sticky z-10 bg-[var(--color-card-solid,var(--color-card))] border-b border-slate-100 border-r-slate-200'

function GroupHead({ span, children, note }: { span: number; children: string; note?: string }) {
  return (
    <th colSpan={span}
      className="px-2 pt-2 pb-1 text-left font-semibold tracking-wider border-l border-slate-200">
      {children}
      {note && <span className="ml-1.5 font-normal normal-case tracking-normal text-slate-400">· {note}</span>}
    </th>
  )
}

function Th({ children, right, first }: { children: ReactNode; right?: boolean; first?: boolean }) {
  return (
    <th className={`px-2 py-2 font-medium border-b border-slate-100 ${right ? 'text-right' : 'text-left'} ${
      first ? 'border-l border-l-slate-200' : ''}`}>
      {children}
    </th>
  )
}

function Td({ children, right, first, muted, strong, emph }: {
  children: ReactNode; right?: boolean; first?: boolean; muted?: boolean; strong?: boolean; emph?: boolean
}) {
  return (
    <td className={`px-2 py-1.5 border-b border-slate-100 ${right ? 'text-right tabular-nums' : ''} ${
      first ? 'border-l border-l-slate-200' : ''} ${
      emph ? 'font-semibold text-navy-950' : strong ? 'font-medium text-navy-950' : muted ? 'text-slate-400' : 'text-slate-700'}`}>
      {children}
    </td>
  )
}

const pct = (r: number) => `${(Math.round(r * 10000) / 100).toString()}%`

/** The badges, warnings first. Each says what it means on hover and again in the drawer. */
function Badges({ list }: { list: QueueException[] }) {
  if (list.length === 0) return <span className="text-slate-300">—</span>
  const sorted = [...list].sort((a, b) => Number(b.warn) - Number(a.warn))
  return (
    <span className="inline-flex flex-wrap gap-1 max-w-[16rem] whitespace-normal">
      {sorted.map((e) => (
        <span key={e.key} title={e.detail} data-exception={e.key}
          className={`text-[10.5px] px-1.5 py-0.5 rounded whitespace-nowrap ${
            e.warn ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600'}`}>
          {e.label}
        </span>
      ))}
    </span>
  )
}

/* ---------------------------------------------------------------- the batch summary */

/**
 * WHAT THE QUEUE WOULD DO, ADDED UP -- AND SAID TO BE A PROJECTION.
 *
 * "Projected on approval" is on it because none of it has happened: approve half and these are
 * half wrong. Trust receipts and PTCs are kept apart because they are different money -- one is in
 * the firm's bank, the other is in the client's. The firm's share is ONE figure across both routes;
 * the PTC due is shown as part of it, never added to it a second time. And where a PTC overpaid,
 * the credit is counted but nothing here says whose bank holds it -- that is not decided.
 */
function BatchSummary({ rows }: { rows: AwaitingPayment[] }) {
  const [byClient, setByClient] = useState(false)
  const t = useMemo(() => batchTotals(rows), [rows])
  const checks = useMemo(() => batchReconciliation(t), [t])
  const clients = useMemo(() => (byClient ? totalsByClient(rows) : []), [rows, byClient])
  const failing = checks.filter((c) => !c.holds)
  return (
    <div className="border-b border-slate-100 px-4 py-3" data-testid="batch-summary">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
        Projected on approval · the whole queue
      </p>
      <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 xl:grid-cols-5">
        <Figure wide label="Total awaiting" value={rand(t.total)}
          note={`${rand(t.direct.amount)} into trust · ${rand(t.ptc.amount)} paid to clients`} />
        <Figure label="To pay clients" value={rand(t.toClients)} note="From trust, on direct receipts" emph />
        <Figure label="BF share" value={rand(t.bfShare)}
          note={t.ptc.count > 0 ? `Incl. VAT · includes ${rand(t.ptc.dueToBf)} due from clients on PTCs` : 'Fees, interest, commission and its VAT'} emph />
        {/* HELD IN TRUST ONLY. A debtor who overpaid the CLIENT is the client's to sort out (the
            firm, 7 Oct), so it is named under the figure and never counted as money the firm holds. */}
        <Figure label="Debtor credit" value={rand(t.direct.credit)}
          note={t.ptc.credit > 0
            ? `Held in trust · plus ${rand(t.ptc.credit)} overpaid to clients, theirs to sort out`
            : 'Held for the debtor, never paid over'} />
        <Figure label="PTC due to BF" value={rand(t.ptc.dueToBf)}
          note={`Incl. VAT · ${t.ptc.count} PTC${t.ptc.count === 1 ? '' : 's'} · client already holds ${rand(t.ptc.clientShareHeld)}`} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]" data-testid="batch-checks">
        {checks.map((c) => (
          <span key={c.label} className={c.holds ? 'text-emerald-700' : 'text-negative-700 font-medium'}
            title={`${rand(c.left)} against ${rand(c.right)}`}>
            {c.holds ? <Check size={11} className="inline mr-0.5" /> : <AlertTriangle size={11} className="inline mr-0.5" />}
            {c.label}
          </span>
        ))}
        {failing.length > 0 && (
          <span className="text-negative-700">— {failing.map((c) => `${rand(c.left)} against ${rand(c.right)}`).join('; ')}</span>
        )}
        <button type="button" onClick={() => setByClient((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 hover:text-navy-950">
          {byClient ? <ChevronDown size={12} /> : <ChevronRight size={12} />} By client
        </button>
      </div>
      {byClient && (
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-[12px] whitespace-nowrap text-[12.5px]" data-testid="batch-by-client">
            <thead className="text-[10.5px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-2 py-1 text-left font-medium">Client</th>
                <th className="px-2 py-1 text-right font-medium">Payments</th>
                <th className="px-2 py-1 text-right font-medium">Into trust</th>
                <th className="px-2 py-1 text-right font-medium">Paid to client</th>
                <th className="px-2 py-1 text-right font-medium">To pay client</th>
                <th className="px-2 py-1 text-right font-medium">BF share <span className="normal-case tracking-normal text-slate-300">incl. VAT</span></th>
                <th className="px-2 py-1 text-right font-medium">Credit</th>
                <th className="px-2 py-1 text-right font-medium">PTC due to BF</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {clients.map((c) => (
                <tr key={c.client} className="border-t border-slate-100">
                  <td className="px-2 py-1 text-slate-700">{c.client}</td>
                  <td className="px-2 py-1 text-right">{c.count}</td>
                  <td className="px-2 py-1 text-right">{rand(c.direct.amount)}</td>
                  <td className="px-2 py-1 text-right">{rand(c.ptc.amount)}</td>
                  <td className="px-2 py-1 text-right font-medium">{rand(c.toClients)}</td>
                  <td className="px-2 py-1 text-right font-medium">{rand(c.bfShare)}</td>
                  <td className="px-2 py-1 text-right">{rand(c.credit)}</td>
                  <td className="px-2 py-1 text-right">{rand(c.ptc.dueToBf)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* `wide` spans both columns below xl: five figures in a two-column grid would leave an empty cell,
   which the hairline grid draws as a grey block. */
function Figure({ label, value, note, emph, wide }: { label: string; value: string; note?: string; emph?: boolean; wide?: boolean }) {
  return (
    <div className={`bg-[var(--color-card-solid,var(--color-card))] px-3 py-2.5 ${wide ? 'col-span-2 xl:col-span-1' : ''}`}>
      <p className="text-[12px] text-slate-500">{label}</p>
      <p className={`text-[15px] tabular-nums ${emph ? 'font-semibold text-navy-950' : 'font-medium text-slate-800'}`}>{value}</p>
      {note && <p className="text-[11px] leading-snug text-slate-400 mt-0.5">{note}</p>}
    </div>
  )
}

/* ---------------------------------------------------------------- approve all */

/** "ALL" IS THE WHOLE QUEUE, said before it is pressed -- including the rows on other pages. */
function ApproveAllModal({ count, total, trust, ptc, held, busy, onClose, onConfirm }: {
  count: number; total: number; held: number
  trust: { count: number; amount: number }; ptc: { count: number; amount: number }
  busy: boolean; onClose: () => void; onConfirm: () => Promise<void>
}) {
  return (
    <Modal title={`Approve all ${count} payments`} subtitle={rand(total)} onClose={onClose} width={460}>
      <p className="text-sm text-slate-600">
        Every payment in the queue that adds up, not only the ones on this page
        {held === 0 ? `: ${trust.count} into trust (${rand(trust.amount)}) and ${ptc.count} paid to clients directly (${rand(ptc.amount)}).` : '.'}
      </p>
      <p className="text-[12px] text-slate-400 mt-2">
        Each is split as shown and posted. A payment that cannot go through is named and the rest
        still are.
      </p>
      {held > 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900" data-testid="held-note">
          {held === 1 ? 'One payment that does not' : `${held} payments that do not`} obey the formulas
          {held === 1 ? ' is' : ' are'} left out. Open {held === 1 ? 'it' : 'each'} and approve it on its own once checked.
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose}
          className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600">Cancel</button>
        <button type="button" disabled={busy} onClick={() => void onConfirm()}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-1.5 rounded-lg
            border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500 disabled:opacity-40">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Approve all {count}
        </button>
      </div>
    </Modal>
  )
}

/* ---------------------------------------------------------------- the breakdown drawer */

/**
 * ONE PAYMENT, END TO END, FROM THE ENGINE'S OWN FIGURES.
 *
 * What the row cannot hold: the receipt fee raised against what was paid, half A spent line by
 * line with the firm's four figures behind each (the arithmetic that used to open out of the
 * table's column headings), capital, commission, the three-way split and a reconciliation to the
 * cent. A DRAWER rather than a modal so the table stays visible beside it on an iPad.
 *
 * "CAN'T RECOVER", NEVER A SILENT ZERO. What the in duplum ceiling refuses is shown as such. The
 * items 1-7 cap is NOT reported per payment by the engine, and the drawer says that rather than
 * calling the payment within the limit.
 */
function Breakdown({ row: r, a, f, problems, exceptions, onClose, busy, onApprove }: {
  row: AwaitingPayment; a: Allocation; f: QueueFigures; problems: Violation[]
  exceptions: QueueException[]; onClose: () => void
  busy: boolean; onApprove: () => Promise<void>
}) {
  const [checkedIt, setCheckedIt] = useState(false)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const recon = Math.round((f.clientShare + f.bfShare + f.credit) * 100) / 100
  const cycle = cycleStartOn(r.receivedOn)
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Payment breakdown">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-navy-950/30" />
      <aside className="relative h-full w-full max-w-md overflow-y-auto bg-[var(--color-card-solid,var(--color-card))] shadow-xl"
        data-testid="payment-breakdown">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100
          bg-[var(--color-card-solid,var(--color-card))] px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold text-slate-800">{r.debtor || 'Unnamed debtor'}</h3>
            <p className="text-[12px] text-slate-500">
              {r.caseNumber ?? r.accountNumber}{r.client ? ` · ${r.client}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close the breakdown">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4 px-4 py-3 text-[12.5px]">
          <Section title="The payment">
            <Lines rows={[
              ['Amount', rand(r.amount)],
              ['Received', formatDate(r.receivedOn)],
              ['Route', f.route === 'ptc' ? 'Paid to the client directly (PTC)' : 'Paid into the trust account'],
              ['Reference', r.reference ?? '—'],
              ['On the statement', r.bankDescription ?? '—'],
            ]} />
            {exceptions.length > 0 && (
              <ul className="mt-2 space-y-1">
                {exceptions.map((e) => (
                  <li key={e.key} className={e.warn ? 'text-amber-900' : 'text-slate-600'}>
                    <span className="font-medium">{e.label}</span> — {e.detail}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Receipt fee (item 9)">
            <Lines rows={[
              ['Raised by this payment', `${rand(r.receiptFee)} + ${rand(r.receiptFeeVat)} VAT = ${rand(r.receiptFee + r.receiptFeeVat)}`],
              ['Paid by this payment, incl. VAT', rand(f.receiptFeePaid)],
            ]} />
          </Section>

          <Section title={`Half A — ${rand(f.halfA)} for interest and fees`}>
            {SECTIONS.map((sec) => {
              const c = sec.of(a)
              return (
                <div key={sec.key} className="mb-1.5">
                  <p className="font-medium text-slate-700">{sec.label}: {rand(c.taking)}</p>
                  <Lines rows={BEFORE.map((b) => [
                    b.label === 'ceiling refuses' ? "can't recover (in duplum)" : b.label,
                    rand(b.of(c)),
                  ] as [string, string]).concat([['after', rand(c.after)]])} muted />
                </div>
              )
            })}
            <Lines rows={[
              ['Half A spent', rand(f.feesSide)],
              ['Unused, rolled to capital', rand(f.halfAUnused)],
            ]} />
            {r.interestOpen > 0 && r.interestOpenFrom && (
              <p className="mt-1 text-[11px] text-slate-400">
                {rand(r.interestOpen)} of the interest has accrued since {formatDate(r.interestOpenFrom)} and
                is posted when you approve.
              </p>
            )}
          </Section>

          <Section title="Half B and the rollover — capital">
            <Lines rows={[
              ['Half B', rand(Math.round((r.amount - f.halfA) * 100) / 100)],
              ['Plus the rollover', rand(f.halfAUnused)],
              ['Capital outstanding before', rand(f.capitalBefore)],
              ['Capital paid', rand(f.capitalPaid)],
              ['Capital remaining', rand(f.capitalAfter)],
            ]} />
            {f.feesSide > f.halfA + 0.005 && (
              <p className="mt-1 text-[11px] text-slate-500">
                Capital is paid off, so {rand(Math.round((f.feesSide - f.halfA) * 100) / 100)} beyond half A
                went to the interest and costs still standing.
              </p>
            )}
          </Section>

          <Section title="Commission">
            <Lines rows={[
              ['Rate', f.commissionRate !== null ? pct(f.commissionRate) : 'No rate — needs one before it is final'],
              ['Commission on capital paid', rand(f.commission)],
              ['VAT on commission', rand(f.commissionVat)],
            ]} />
          </Section>

          <Section title="The split">
            <Lines rows={[
              ['Client share', rand(f.clientShare)],
              [f.route === 'ptc' ? 'To pay the client' : 'To pay the client from trust', rand(f.toClient)],
              ['BF share incl. VAT', rand(f.bfShare)],
              [f.route === 'ptc' ? 'Overpaid to the client — theirs to sort out' : 'Debtor credit', rand(f.credit)],
              ...(f.ptcDueToBf !== null
                ? [['Due to BF from the client, incl. VAT', rand(f.ptcDueToBf)] as [string, string]]
                : []),
            ]} strong />
            <p className={`mt-1.5 text-[12px] ${Math.abs(recon - r.amount) <= 0.005 ? 'text-emerald-700' : 'text-negative-700 font-medium'}`}
              data-testid="breakdown-reconciliation">
              {rand(f.clientShare)} + {rand(f.bfShare)} + {rand(f.credit)} = {rand(recon)}
              {Math.abs(recon - r.amount) <= 0.005 ? ' — the whole payment, to the cent.' : ` — not the payment of ${rand(r.amount)}.`}
            </p>
          </Section>

          <Section title="Ceilings">
            <Lines rows={[
              ["Interest that can't be recovered", rand(r.interestCant)],
              ["Receipt fees that can't be recovered", rand(r.rfCant)],
              ["Other fees that can't be recovered", rand(r.feesCant)],
            ]} />
            <p className="mt-1 text-[11px] text-slate-400">
              The in duplum ceiling is applied by the engine and shown above. The engine does not
              report per payment what the items 1–7 cap held back, so nothing here says this payment
              is within it.
            </p>
          </Section>

          <Section title="Payover">
            <p className="text-slate-600">
              {f.route === 'ptc'
                ? `Nothing is paid over: the client holds the money. What it owes the firm is set off in its payover.${
                    f.credit > 0 ? ` The ${rand(f.credit)} overpaid is the client's to sort out with the debtor.` : ''}`
                : `Received in the payover cycle opening ${shortDate(cycle)}. It reaches a payover run only once approved.`}
            </p>
          </Section>

          {problems.length > 0 && (
            <Section title="Formulas that do not hold">
              <ul className="space-y-1">
                {problems.map((v) => (
                  <li key={v.rule}><span className="font-medium text-amber-900">{v.rule}</span><br />
                    <span className="tabular-nums text-slate-600">{v.detail}</span></li>
                ))}
              </ul>
              {/* THE CHECK, BEFORE THE MONEY MOVES: held out of every batch, approved only here. */}
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="approve-checked">
                <label className="flex items-start gap-2 text-[12.5px] text-amber-900">
                  <input type="checkbox" checked={checkedIt} onChange={(e) => setCheckedIt(e.target.checked)} className="mt-0.5" />
                  I have checked these figures and this payment is right to post as shown.
                </label>
                <button type="button" disabled={!checkedIt || busy} onClick={() => void onApprove()}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gold-500 bg-gold-400 px-3 py-1.5 text-[12.5px] font-medium text-navy-950 hover:bg-gold-500 disabled:opacity-40">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Approve this payment
                </button>
              </div>
            </Section>
          )}
        </div>
      </aside>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{title}</h4>
      {children}
    </section>
  )
}

function Lines({ rows, muted, strong }: { rows: [string, string][]; muted?: boolean; strong?: boolean }) {
  return (
    <dl className="space-y-0.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3">
          <dt className={muted ? 'text-slate-400' : 'text-slate-500'}>{k}</dt>
          <dd className={`tabular-nums text-right ${muted ? 'text-slate-500' : strong ? 'font-medium text-slate-900' : 'text-slate-800'}`}>{v}</dd>
        </div>
      ))}
    </dl>
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
