import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { unexplainedDebitAction } from '../../lib/bankLineAllocation'
import { rand } from '../../lib/money'
import {
  fetchFirmHeld, fetchOverpaymentsKept, fetchTrustCycles, fetchTrustOpening, fetchTrustPosition,
  fetchUnreconciledPayouts,
  type TrustCycle, type TrustOpening, type TrustPosition, type UnreconciledPayout,
} from '../../lib/trust'
import {
  cycleCollected, cycleLabel, cycleState, cycleTodo, cycleTotals, overdueCycles,
} from '../../lib/trustCycles'
import { trustChecks, trustHeadline, trustVerdict } from '../../lib/trustBalance'
import { firmHeldLines, firmHeldSum, type FirmHeld } from '../../lib/firmHeld'

/**
 * IS THE TRUST ACCOUNT RIGHT, AND WHOSE PAYOVER IS EACH PART OF IT WAITING FOR?
 *
 * The first question was the one nothing in Raptor answered; the second was the one THIS screen
 * could not. The firm: "it should reflect everything that is currently in the trust. How much
 * money is currently in the trust? And what is for this month's payover? And what is for next
 * month's payover? ... if we're on the 6th of October, the money for last month that was running
 * from the 10th of August to the 11th of September has not been paid out on the 11th of October.
 * So that money's in there. Plus, money from the 11th of September to the 6th of October is in
 * there as well."
 *
 * WHICH IS THE WHOLE POINT. On any day after the 11th the trust holds at least two payovers at
 * once -- a closed cycle waiting for its day and an open one still filling up -- and a running
 * total per party adds them together. "Clients: R11 362,50" is a true figure that answers neither
 * "what goes out on the 11th" nor "what have we collected this month", and those are the two
 * things somebody standing in front of this screen actually wants.
 *
 * IT STILL OPENS ON THE DIFFERENCE. Cash against what is owed, and the gap between them is the
 * headline whether or not it is zero. A trust screen whose arithmetic can only ever come out at
 * nil is worth nothing: the whole reason to reconcile is the day it does not, and the firm's own
 * trust account is short right now -- a payment out with no run behind it, and a bank charge that
 * belongs to no creditor.
 *
 * AND IT EXPLAINS THE DIFFERENCE RATHER THAN REPORTING IT. `unreconciled_payouts` already knows
 * which debits are unmatched, so they are named with the action each one needs -- a payout gets
 * matched to its run, a bank charge gets funded from the business account, and those are
 * different jobs that a single "investigate" would flatten.
 *
 * TWO VIEWS OF ONE BALANCE AND ONE PIECE OF ARITHMETIC. The cycle bands and the control block are
 * the SAME money read two ways: `trust_by_cycle` buckets every creditor entry exactly once, so its
 * client column sums to the control's `owedToClients` and its two firm columns to `owedToFirm`.
 * That is asserted in `check-trust-cycles` against the live database rather than assumed, because
 * the same money described two ways on two halves of one screen is exactly the drift the payover
 * arithmetic was centralised to avoid.
 */
export function TrustOverview() {
  const [position, setPosition] = useState<TrustPosition | null>(null)
  const [cycles, setCycles] = useState<TrustCycle[]>([])
  const [payouts, setPayouts] = useState<UnreconciledPayout[]>([])
  const [firmHeld, setFirmHeld] = useState<FirmHeld | null>(null)
  const [kept, setKept] = useState<{ amount: number; accounts: number } | null>(null)
  const [opening, setOpening] = useState<TrustOpening | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([
      fetchTrustPosition(), fetchUnreconciledPayouts(), fetchTrustCycles(),
      /* THE SPLIT IS AN EXPLANATION, NOT THE RECONCILIATION: if it cannot be read, the rest of the
         page still answers "does it balance?" and the split is simply not drawn. */
      fetchFirmHeld().catch(() => null),
      /* Same: a split of the debtors' line, never needed for the arithmetic. */
      fetchOverpaymentsKept().catch(() => null),
      /* Only says where the bank figure starts; the figure itself is trust_position's. */
      fetchTrustOpening().catch(() => null),
    ])
      .then(([p, u, c, f, k, o]) => { if (live) { setPosition(p); setPayouts(u); setCycles(c); setFirmHeld(f); setKept(k); setOpening(o) } })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-sm py-10">
        <Loader2 size={16} className="animate-spin" /> Reading the trust account…
      </div>
    )
  }

  if (error) {
    return (
      <Card className="p-5 text-sm text-negative-700 bg-negative-50 border-negative-100">
        The trust account could not be read: {error}
      </Card>
    )
  }

  /*
   * NO ROW MEANS NOT ALLOWED, NOT EMPTY. trust_position() carries its guard in a `where` clause,
   * so it returns nothing rather than raising. Drawing zeroes here would tell somebody who may not
   * see the trust account that it is empty -- a claim about the firm's money, where a refusal is
   * the truth.
   */
  if (!position) {
    return (
      <Card className="p-5 text-sm text-slate-500">
        The trust account is not yours to see. Ask an administrator if you need it.
      </Card>
    )
  }

  /*
   * TODAY ON THE FIRM'S CLOCK, because every date on this screen came out of Postgres on
   * Africa/Johannesburg and "how many days until the 11th" compared against a browser in another
   * zone is off by one for a third of the day. `en-CA` is the shortest way to a real ISO date out
   * of Intl; `toISOString` would hand back UTC, which is the bug.
   */
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' })
  /*
   * THE FOUR CHECKS, BUILT FROM THE FIGURES ALREADY ON THE PAGE. `rand` is handed in rather than
   * reached for inside, so the sentences are formatted by the same money function as every figure
   * around them -- a panel that said "7873.6" beside tiles reading "R 7 873,60" would read as a
   * different number.
   */
  const checks = trustChecks(
    position,
    overdueCycles(cycles, today).map((c) => ({
      label: cycleLabel(c.periodStart, c.periodEnd), toClients: c.toClients,
    })),
    rand,
  )

  /*
   * THE RECONCILIATION, ADDED UP HERE FROM THE PARTS -- not read back as one more figure from the
   * database. It used to run ledger LESS owners, which was nil by construction (the ledger is built
   * out of the same owners). Since 10 Oct it runs from the BANK: in the trust account, less what
   * has an owner, is what has not -- and that CAN be non-nil, because the bank figure (opening
   * balance plus statement lines) is measured independently of the ledger. It splits into the
   * receipts nobody has placed and the bank/ledger gap; `trustHeadline` keeps any remainder
   * neither explains as its own line rather than folding it in.
   */
  /*
   * CLIENTS ARE OWED THE POSITIVE PART ONLY. `owedToClients` is the clients' NET balance -- a client
   * in debit already pulls it down -- and the "owed back" line subtracts that debit again, so the
   * total came out short by exactly what clients owe back (8 Oct, staging: R321.88 "unexplained"
   * that was this screen counting it twice). The Clients line draws what is owed TO clients, the
   * owed-back line what is owed by them, and the two add back to the net.
   */
  const owedToClientsGross = r2(position.owedToClients + position.owedByClients)
  /*
   * ACCOUNTED FOR IS MONEY WITH A NAME ON IT: clients, the firm, debtors, less what clients owe
   * back. Unallocated receipts used to be summed in here too, which is why the old total always
   * equalled the ledger -- but a receipt nobody has placed is exactly what the firm means by "not
   * accounted for" (10 Oct), so it now sits on that side with the bank/ledger gap.
   */
  const accounted = r2(owedToClientsGross + position.owedToFirm + position.owedToDebtors
    - position.owedByClients)
  const head = trustHeadline({
    trustCash: position.trustCash, owners: accounted,
    unidentified: position.unidentified, difference: position.difference,
  })
  const openingSet = Boolean(opening?.asAt)
  const verdict = trustVerdict(checks)
  const totals = cycleTotals(cycles)
  const open = checks.filter((c) => c.tone !== 'clear')

  return (
    <div className="space-y-8">
      {/*
        THE FIRM'S OWN LAYOUT, from the revised design they sent ("Raptor Trust Overview, Revised"):
        the three figures across a dark band, who owns the money with its reconciliation beside it,
        then the collections by period as a table. The previous version kept the figures and then
        put two warning panels and a stack of cycle cards above the ownership table, and the firm's
        verdict was "It doesn't look nice ... not in the format that I requested."
      */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-800">Trust overview</h1>
          <p className="text-sm text-slate-500 mt-1">
            Trust balance, ownership and reconciliation &middot; as at today
          </p>
        </div>
        {/* A STATEMENT, NOT A PICKER. The position is today's; a box that looked like a date
            input would promise a history this screen cannot read. */}
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
          As at {longDate(today)}
        </div>
      </div>

      {/* ------------------------------ the three figures ------------------------------ */}
      {/*
        THE MONEY FIRST, THEN HOW MUCH OF IT HAS A NAME ON IT. The firm, 10 Oct: "the trust balance
        should be the main thing ... this is how much is in the trust. This has been accounted for.
        This has not been accounted for." The band used to read Bank balance / Trust ledger balance
        / difference, which the firm took for the BUSINESS account's balance beside the trust's --
        two balances side by side read as two accounts. It is one account, said so under the figure.
      */}
      <div className="rounded-2xl bg-navy-950 text-white px-6 sm:px-8 py-6
        grid grid-cols-1 sm:grid-cols-3 gap-6" data-testid="trust-headline">
        <div>
          <Figure label="In the trust account" value={rand(head.inTrust)} />
          <div className={clsx('mt-2 text-xs', openingSet ? 'text-slate-300' : 'text-amber-300 font-semibold')}>
            {openingSet && opening?.amount !== null && opening?.asAt
              ? `Opening ${rand(opening.amount)} at ${longDate(opening.asAt)}, plus statements since`
              : 'Statement lines only \u2014 no opening balance captured'}
          </div>
        </div>
        <div>
          <Figure label="Accounted for" value={rand(head.accounted)} />
          <div className="mt-2 text-xs text-slate-300">Due to clients, Bredell Ferreira and debtors</div>
        </div>
        <div>
          <Figure label="Not accounted for" value={rand(head.notAccounted)}
            tone={head.notAccounted === 0 ? undefined : head.gap < 0 ? 'text-negative-300' : 'text-amber-300'} />
          {/* THE VERDICT IS ON THE PANEL, not inferred from a zero: nobody should have to know
              that R 0.00 is the good answer. */}
          <div className={clsx('mt-2 text-xs font-semibold',
            head.notAccounted === 0 && head.gap === 0 ? 'text-positive-100' : head.gap < 0 ? 'text-negative-300' : 'text-amber-300')}>
            {head.notAccounted === 0 && head.gap === 0
              ? 'Every rand has an owner'
              : head.gap < 0 ? 'Bank holds less than the books owe' : 'Needs placing or explaining'}
          </div>
        </div>
      </div>

      {/* --------------------------- who owns the money --------------------------- */}
      <section>
        <h2 className="text-xl font-semibold tracking-tight text-slate-800">
          Who owns the money in trust?
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Current outstanding balances across all periods, after transfers and payovers.
        </p>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <Card className="lg:col-span-7 px-6 py-2">
            {/*
              NAMED AS THE FIRM NAMES THEM -- whose it is first, what the money is waiting for
              beside it. Largest claim first, as their design orders it.
            */}
            <Owner who="Clients" what="Awaiting client payover" amount={owedToClientsGross} lead />
            <Owner who="Bredell Ferreira" what="Earned and still held in trust" amount={position.owedToFirm} />
            {/*
              OVERPAYMENTS KEPT ARE PART OF THE DEBTORS' MONEY, drawn apart (the firm, 8 Oct: "under
              the suspense account ... just to say overpayments kept"). Taken out of the debtors'
              line by the same amount, so the total accounted for does not move.
            */}
            <Owner who="Debtors" what="Overpayments / refunds outstanding"
              amount={position.owedToDebtors - (kept?.amount ?? 0)} />
            {kept && kept.amount > 0 && (
              <Owner who="Overpayments kept"
                what={`Too small to refund; the debtor's until taken (${kept.accounts} ${kept.accounts === 1 ? 'account' : 'accounts'})`}
                amount={kept.amount} />
            )}
            {/*
              THE OTHER DIRECTION, ONLY WHEN THERE IS ONE. A client in debit to the trust (a debtor
              paid them direct, so the firm's fees on it are owed back) reduces what is accounted
              for. The firm's design has no row for it because their example has none; leaving it
              out when it is real would make the total below disagree with the ledger by exactly
              that amount and nothing on the screen would say why.
            */}
            {position.owedByClients > 0 && (
              <Owner who="Less: owed back by clients" what="Comes off the client's next payover"
                amount={-position.owedByClients} />
            )}
            <Subtotal label="Total accounted for" value={head.accounted} />
            {/*
              NOT ACCOUNTED FOR, BY WHAT IT IS MADE OF -- two different jobs. An unplaced receipt is
              placed on Exceptions; a bank/ledger gap is a statement not yet imported, an opening
              balance not captured, or (short) money that has left with nothing behind it. A line
              is drawn only when it is not nil, except the receipts, which always say where they are.
            */}
            <div className="pt-4 text-xs font-bold uppercase tracking-wider text-slate-400">Not accounted for</div>
            <Owner who="Unallocated receipts" what="Owner not yet identified" amount={head.unplaced} />
            {head.gap !== 0 && (
              <Owner who="Bank / ledger difference"
                what={head.gap < 0
                  ? (openingSet ? 'The bank holds less than the books owe' : 'The books owe more than the imported statements hold \u2014 capture the opening balance')
                  : 'In the bank, not yet in the books'}
                amount={head.gap} />
            )}
            {head.residual !== 0 && (
              <Owner who="Unexplained" what="The parts above do not add up to the bank" amount={head.residual} />
            )}
            <Subtotal label="Total not accounted for" value={head.notAccounted} />
            <Subtotal label="In the trust account" value={head.inTrust} strong />
          </Card>

          {/*
            A PLAIN CARD WITH A COLOURED RULE, NOT A TINTED PANEL. The whole panel used to be washed
            pink when the account did not balance (green when it did); the firm, 10 Oct: "a weird
            pink thing ... I agree that there should be different colours, but change it." The
            state is now the rule along the top and the pill beside the heading -- red short, amber
            work outstanding, green nothing to do -- and the figures sit on the same white as the
            owners beside them.
          */}
          <Card className={clsx('lg:col-span-5 px-6 py-6 flex flex-col border-t-4',
            verdict.tone === 'bad' ? 'border-t-negative-500' : verdict.tone === 'warn' ? 'border-t-amber-400' : 'border-t-positive-600')}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-lg font-semibold text-slate-800">Ownership reconciliation</div>
              <span className={clsx('rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap',
                verdict.tone === 'bad' ? 'bg-negative-50 text-negative-700'
                  : verdict.tone === 'warn' ? 'bg-amber-100 text-amber-800' : 'bg-positive-50 text-positive-700')}>
                {verdict.tone === 'bad' ? 'Does not balance' : verdict.tone === 'warn' ? 'Balances, work outstanding' : 'Balances'}
              </span>
            </div>
            <Recon label="In the trust account" value={rand(head.inTrust)} />
            <Recon label="Less: accounted for" value={rand(head.accounted)} />
            <div className="mt-4 pt-4 border-t border-slate-200/70 flex items-baseline gap-4">
              <div className="flex-1 text-[15px] font-semibold text-slate-800">Not accounted for</div>
              <div className={clsx('text-2xl font-semibold tabular-nums',
                head.notAccounted === 0 ? 'text-positive-700' : head.gap < 0 ? 'text-negative-700' : 'text-amber-700')}>
                {rand(head.notAccounted)}
              </div>
            </div>
            {/*
              THE LIKELIEST REASON FOR A GAP, SAID WHERE THE GAP IS. Until the bank's balance on the
              cut-over day is captured, the bank figure is the imported statements alone and the gap
              is mostly what the account held before them.
            */}
            {!openingSet && head.gap !== 0 && (
              <p className="mt-3 text-[13px] text-slate-600" data-testid="no-opening">
                No opening balance is captured, so the bank figure is only the statements imported
                so far. <Link to="/trust/settings" className="font-medium text-gold-700 hover:text-gold-800">
                Capture it in Trust settings</Link>.
              </p>
            )}

            <div className="mt-5 space-y-2 text-[13px]">
              {open.length === 0 ? (
                <p className="text-positive-700">Bank, ledger and ownership totals match.</p>
              ) : open.map((c) => (
                <p key={c.id} className={c.tone === 'bad' ? 'text-negative-700 font-medium' : 'text-slate-600'}>
                  {c.answer}
                </p>
              ))}
              {/*
                THE SHORTFALL, NAMED. `unreconciled_payouts` already knows which debits nothing
                accounts for, and each needs a different job -- a payout is matched to its run, a
                bank charge is funded from the business account -- so they are listed with the
                action rather than flattened into "investigate".

                THE CANDIDATE IS A SUGGESTION, and the word matters: the match is by amount and
                date, a guess that is usually right, and "matched" would be pressed past unread.
              */}
              {position.difference !== 0 && payouts.length > 0 && (
                <ul className="pt-1 space-y-1.5">
                  {payouts.map((p) => (
                    <li key={p.id} className="text-[12.5px] rounded-lg bg-slate-50 px-3 py-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold tabular-nums text-negative-700">{rand(Math.abs(p.amount))}</span>
                        {(() => {
                          const act = unexplainedDebitAction(p.description, p.candidateRun ? (p.candidateInvoice ?? 'the run') : null)
                          return (
                            <Link to={act.to} className="font-medium text-gold-700 hover:text-gold-800 whitespace-nowrap">
                              {act.label}
                            </Link>
                          )
                        })()}
                      </div>
                      <div className="text-slate-500 truncate" title={p.description || undefined}>
                        {p.description || 'No description'}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
        {/*
          THE FIRM'S DESIGN HAS ONE MORE LINE HERE -- "BF funds held: Commission + Fees + VAT" --
          asked for again on 8 October ("We can do that"). Read from firm_held_parts: what the firm's
          share EARNED, part by part, less what LEFT it. A drawing takes from the share as a whole,
          so it is its own line rather than shared out by a rule nobody chose; that is what lets the
          lines add up, by construction, to the Bredell Ferreira figure above. When they do not
          (the two were read a moment apart and somebody posted between), it says so instead of
          drawing a total that disagrees with the row it explains.
        */}
        {firmHeld && <FirmHeldCard held={firmHeld} owedToFirm={position.owedToFirm} />}
      </section>

      {/* --------------------------- collections by period --------------------------- */}
      <section>
        <h2 className="text-xl font-semibold tracking-tight text-slate-800">Collections by period</h2>
        <p className="text-sm text-slate-500 mt-1">
          Period earnings are shown below. The balances above show what remains in trust today.
        </p>
        {cycles.length === 0 ? (
          <Card className="mt-4 p-6 text-sm text-slate-500 text-center">
            Nothing is waiting to be paid over. Every cycle Raptor knows about has been settled.
          </Card>
        ) : (
          /* Scrolls sideways inside its card on a phone, rather than pushing the page wider. */
          <Card className="mt-4 p-0 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="text-left font-bold px-6 pt-5 pb-3">Period / client payover</th>
                  <th className="text-right font-bold px-4 pt-5 pb-3">Collected</th>
                  <th className="text-right font-bold px-4 pt-5 pb-3">Client portion</th>
                  <th className="text-right font-bold px-4 pt-5 pb-3">BF earned</th>
                  <th className="text-right font-bold px-6 pt-5 pb-3">Other held</th>
                </tr>
              </thead>
              <tbody>
                {/*
                  THE ONE THAT LEAVES SOONEST IS AT THE TOP -- "what is for this month's payover?
                  And what is for next month's payover" -- and the database orders it so.
                */}
                {cycles.map((c, i) => (
                  <CycleRow key={c.periodStart} cycle={c} today={today}
                    previousSeen={cycles.slice(0, i).some((x) => !x.isOpen)} />
                ))}
              </tbody>
              {/*
                THE TIE-OUT, quietly. Not in the firm's design, which shows two periods and no
                total -- but the periods and the ownership block are the SAME money read two ways,
                so the client column here sums to the Clients line above and the BF column to what
                Bredell Ferreira holds before drawings. Without the row, a reader has to add them
                up to find out the two halves of the screen agree. Only where there is more than
                one period, because a total of one row is the row again.
              */}
              {cycles.length > 1 && (
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50 text-slate-600">
                    <td className="px-6 py-3 text-[11px] font-bold uppercase tracking-wider">All periods</td>
                    <td className="px-4 py-3 text-right tabular-nums">{rand(totals.collected)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{rand(totals.toClients)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{rand(totals.firmEarned)}</td>
                    <td className="px-6 py-3 text-right tabular-nums">
                      {rand(r2(totals.collected - totals.toClients - totals.firmEarned))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </Card>
        )}
        <p className="mt-3 text-xs text-slate-500 leading-relaxed">
          Collection cycle: 11th&ndash;10th, paid over after it closes &mdash; how long after
          is <Link to="/trust/settings" className="font-medium text-gold-700 hover:text-gold-800">
          a trust setting</Link>. BF earned is what each period&rsquo;s receipts earned the firm;
          what remains to be drawn is the Bredell Ferreira line above.
        </p>
      </section>
    </div>
  )
}

const r2 = (v: number): number => Math.round(v * 100) / 100

const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December']
/* Written out rather than through Intl: en-ZA abbreviates September to "Sept" (CLAUDE.md). */
function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${LONG_MONTHS[m - 1]} ${y}`
}

/**
 * ONE PERIOD, ONE ROW, IN THE FIRM'S COLUMNS: COLLECTED, CLIENT PORTION, BF EARNED, OTHER HELD.
 *
 * COLLECTED LEADS, at the firm's asking: the two figures after it are both SHARES of it, and
 * without the whole a small client column cannot be told from a quiet month. OTHER HELD is what
 * is neither -- debtor overpayments and receipts not yet placed -- so the four always add up.
 *
 * NAMED AS THE FIRM NAMES THEM: Running for the open cycle, Previous for the one waiting for its
 * payover, and Overdue for one that has gone past its day, which is the only row anybody has to
 * act on and so the only one that says so in colour.
 */
function CycleRow({ cycle, today, previousSeen }: {
  cycle: TrustCycle; today: string; previousSeen: boolean
}) {
  const state = cycleState(cycle, today)
  const todo = cycleTodo(cycle)
  const name = cycle.isOpen ? 'Running' : state.tone === 'late' ? 'Overdue' : previousSeen ? 'Earlier' : 'Previous'
  const other = r2(cycle.toDebtors + cycle.unplaced)
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-6 py-4">
        <div className="font-semibold text-slate-800">
          {name} &middot; {cycleLabel(cycle.periodStart, cycle.periodEnd)}
        </div>
        <div className={clsx('text-[12.5px] mt-1',
          state.tone === 'late' ? 'text-gold-800 font-medium'
            : cycle.isOpen ? 'text-positive-700' : 'text-slate-500')}>
          Payover {longDate(cycle.paysOn)}{cycle.isOpen ? ' · provisional' : ''}
          {state.tone === 'late' ? ' · past its day' : ''}
        </div>
        {todo && (
          <Link to="/trust/payover"
            className="mt-1.5 inline-block text-[12.5px] font-medium text-gold-700 hover:text-gold-800">
            {todo} &rarr;
          </Link>
        )}
      </td>
      <td className="px-4 py-4 text-right tabular-nums font-semibold text-slate-800">{rand(cycleCollected(cycle))}</td>
      <td className="px-4 py-4 text-right tabular-nums font-semibold text-positive-700">{rand(cycle.toClients)}</td>
      <td className="px-4 py-4 text-right tabular-nums font-semibold text-slate-800">{rand(cycle.firmEarned)}</td>
      <td className="px-6 py-4 text-right tabular-nums font-semibold text-slate-800">{rand(other)}</td>
    </tr>
  )
}

function Owner({ who, what, amount, lead }: {
  who: string; what: string; amount: number; lead?: boolean
}) {
  return (
    /* THREE FIXED COLUMNS, so every amount sits on one right edge -- a column of money that
       wanders with the length of the words beside it cannot be read down. On a phone the
       description drops under the name. */
    <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(9rem,11rem)_1fr_auto] items-baseline
      gap-x-4 gap-y-0.5 py-4 border-b border-slate-100 last:border-b-0">
      <div className="text-[15px] font-semibold text-slate-800">{who}</div>
      <div className="col-start-1 row-start-2 sm:col-start-2 sm:row-start-1 text-[13px] text-slate-500">{what}</div>
      <div className={clsx('col-start-2 row-start-1 sm:col-start-3 text-right text-lg font-semibold tabular-nums whitespace-nowrap',
        lead ? 'text-positive-700' : amount < 0 ? 'text-gold-800' : 'text-slate-800')}>
        {rand(amount)}
      </div>
    </div>
  )
}

function FirmHeldCard({ held, owedToFirm }: { held: FirmHeld; owedToFirm: number }) {
  const lines = firmHeldLines(held)
  const sum = firmHeldSum(held)
  const ties = Math.round(sum * 100) === Math.round(owedToFirm * 100)
  return (
    <div className="mt-6" data-testid="firm-held"><Card padded={false} className="px-6 py-2">
      <div className="pt-4 pb-1 text-[15px] font-semibold text-slate-800">Bredell Ferreira funds held</div>
      <div className="pb-2 text-[13px] text-slate-500">
        What the firm's share in trust is made of: what it earned, less what has left it.
      </div>
      {lines.map((l) => (
        <div key={l.key} className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(9rem,16rem)_1fr_auto] items-baseline
          gap-x-4 gap-y-0.5 py-2.5 border-b border-slate-100">
          <div className="text-[14px] text-slate-800">{l.label}</div>
          <div className="col-start-1 row-start-2 sm:col-start-2 sm:row-start-1 text-[12.5px] text-slate-500">{l.note}</div>
          <div className={clsx('col-start-2 row-start-1 sm:col-start-3 text-right text-[15px] font-semibold tabular-nums whitespace-nowrap',
            l.amount < 0 ? 'text-gold-800' : 'text-slate-800')}>
            {rand(l.amount)}
          </div>
        </div>
      ))}
      <div className="flex items-baseline gap-4 py-4">
        <div className="flex-1 text-xs font-bold uppercase tracking-wider text-slate-500">Total held for the firm</div>
        <div className="text-lg font-semibold tabular-nums text-slate-800" data-testid="firm-held-total">{rand(sum)}</div>
      </div>
      {!ties && (
        <p className="pb-4 text-[12.5px] text-negative-700">
          This does not match the {rand(owedToFirm)} above: the ledger changed between the two readings. Reload the page.
        </p>
      )}
    </Card></div>
  )
}

function Subtotal({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={clsx('flex items-baseline gap-4 py-4 border-t',
      strong ? 'border-slate-300' : 'border-slate-200')}>
      <div className="flex-1 text-xs font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={clsx('font-semibold tabular-nums text-slate-800', strong ? 'text-2xl' : 'text-lg')}>
        {rand(value)}
      </div>
    </div>
  )
}

function Recon({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-4 flex items-baseline gap-4">
      <div className="flex-1 text-[14px] text-slate-700">{label}</div>
      <div className="text-[15px] font-semibold tabular-nums text-slate-800">{value}</div>
    </div>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 mb-2">
        {label}
      </div>
      <div className={clsx('text-3xl lg:text-4xl font-semibold tabular-nums leading-none', tone)}>
        {value}
      </div>
    </div>
  )
}
