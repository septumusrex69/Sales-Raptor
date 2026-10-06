import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import {
  fetchTrustCycles, fetchTrustPosition, fetchUnreconciledPayouts,
  type TrustCycle, type TrustPosition, type UnreconciledPayout,
} from '../../lib/trust'
import {
  cycleCollected, cycleLabel, cycleProgress, cycleState, cycleTodo, cycleTotals,
  overdueCycles, shortDate,
} from '../../lib/trustCycles'
import { trustChecks, trustVerdict, type TrustCheck } from '../../lib/trustBalance'

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([fetchTrustPosition(), fetchUnreconciledPayouts(), fetchTrustCycles()])
      .then(([p, u, c]) => { if (live) { setPosition(p); setPayouts(u); setCycles(c) } })
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

  const short = position.difference < 0
  /*
   * TODAY ON THE FIRM'S CLOCK, because every date on this screen came out of Postgres on
   * Africa/Johannesburg and "how many days until the 11th" compared against a browser in another
   * zone is off by one for a third of the day. `en-CA` is the shortest way to a real ISO date out
   * of Intl; `toISOString` would hand back UTC, which is the bug.
   */
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' })
  const totals = cycleTotals(cycles)
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

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">Trust overview</h1>
        <span className="text-xs text-slate-400">
          Money the firm holds for other people, as at {shortDate(today)}
        </span>
      </div>

      {/*
        THE THREE FIGURES, IN THE FIRM'S OWN ACCOUNTING WORDS.

        They were "In the bank / Owed out of it / Difference", which is the same arithmetic said
        conversationally. The firm's sketch names them BANK BALANCE, TRUST LEDGER BALANCE and BANK /
        LEDGER DIFFERENCE, and that is better here rather than merely more formal: "owed out of it"
        describes a consequence, where "trust ledger balance" names the thing being reconciled, and
        a reconciliation is only legible when both sides are named as the two records they are.

        AND THE VERDICT IS ON THE PANEL, not inferred from a zero. A reader should not have to know
        that R 0.00 is the good answer.
      */}
      <div className="rounded-xl bg-navy-950 text-white px-6 py-5 flex flex-wrap items-end gap-10">
        <Figure label="Bank balance" value={rand(position.trustCash)} />
        <Figure label="Trust ledger balance" value={rand(position.netOwed)} />
        <div className="flex items-end gap-3">
          <Figure
            label="Bank / ledger difference"
            value={rand(position.difference)}
            small
            tone={position.difference === 0 ? 'text-positive-100' : 'text-negative-300'}
          />
          <span className={clsx('mb-1 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
            position.difference === 0
              ? 'bg-positive-100 text-positive-700'
              : 'bg-negative-100 text-negative-700')}>
            {position.difference === 0 ? 'Matched' : 'Not matched'}
          </span>
        </div>
      </div>

      {/*
        ---------------------------- DOES IT BALANCE? ----------------------------

        THE FIRM, on their sketch of this screen: "it shows all the money that's currently in the
        trust fund and where that money should go. If the trust fund balances in the overview, then
        everything is fine."

        THE SKETCH'S OWN VERSION OF THIS CANNOT FAIL, and that is why it is not what was built. It
        read "trust ledger balance LESS amounts accounted for = unexplained difference" over the
        four owners below -- but `trust_position` derives the ledger balance BY ADDING THOSE FOUR
        UP, so the difference is 0.00 on every row of data that can ever exist. Checked against
        staging rather than argued about: net owed R7 873,60, sum of owners R7 873,60, gap R0,00.
        A green light that cannot go red is worse than none, which is the firm's own rule about
        warnings applied to the most important screen they have.

        So the panel keeps the shape they liked and fills it with the four things that CAN be wrong.
        See trustBalance.ts, which is pure so a check can import it.
      */}
      <TrustBalancePanel checks={checks} />

      {position.difference !== 0 && (
        <Card className={clsx('p-4 border', short
          ? 'bg-negative-50 border-negative-100'
          : 'bg-gold-50 border-gold-100')}>
          <div className={clsx('text-sm font-semibold', short ? 'text-negative-700' : 'text-gold-800')}>
            {short
              ? `The bank holds ${rand(Math.abs(position.difference))} less than Raptor says is owed.`
              : `The bank holds ${rand(position.difference)} more than Raptor says is owed.`}
          </div>
          <div className="text-[13px] text-slate-500 mt-1">
            {short
              ? 'Money has left the trust account that nothing accounts for.'
              : 'Something has been received that nobody is yet recorded as being owed.'}
          </div>
          {payouts.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {payouts.map((p) => (
                <div key={p.id}
                  className="bg-white border border-negative-100 rounded-lg px-3 py-2
                    flex items-baseline gap-3 text-[13px]">
                  <span className="font-semibold text-negative-700 tabular-nums">
                    {rand(Math.abs(p.amount))}
                  </span>
                  <span className="text-slate-500">{p.description || 'No description'}</span>
                  {/*
                    THE CANDIDATE IS A SUGGESTION, AND THE WORD MATTERS. The function matches a
                    debit to a run by amount and date, which is a guess that happens to be right
                    most of the time; a screen that said "matched" would have somebody pressing
                    past it without looking.
                  */}
                  <Link to="/trust/payover" className="font-medium text-gold-700 hover:text-gold-800">
                    {p.candidateRun ? `Match to ${p.candidateInvoice ?? 'the run'}` : 'Find its run'}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ------------------------------ the cycles ------------------------------ */}

      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
          Which payover each part of it is waiting for
        </div>
        {cycles.length === 0 ? (
          <Card className="p-6 text-sm text-slate-500 text-center">
            Nothing is waiting to be paid over. Every cycle Raptor knows about has been settled.
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            {/*
              THE ONE THAT LEAVES SOONEST IS THE ONE AT THE TOP, which is the order the firm said it
              in -- "what is for this month's payover? And what is for next month's payover" -- and
              the closed cycle is the one that answers the first half. Newest first read backwards:
              the cycle still being collected sat above the one going out in five days, and a cycle
              that has gone PAST its day -- the only thing on this table somebody has to act on --
              would have been at the bottom. The database orders it; nothing sorts up here.
            */}
            {cycles.map((c) => (
              <CycleRow key={c.periodStart} cycle={c} today={today} />
            ))}
            {cycles.length > 1 && (
              <div className="flex items-center gap-4 px-5 py-3.5 border-t border-slate-200 bg-slate-50">
                <div className="flex-1 text-[12.5px] font-bold uppercase tracking-wide text-slate-600">
                  Across every cycle
                </div>
                <Money label="Collected" value={totals.collected} muted />
                <Money label="Clients" value={totals.toClients} />
                <Money label="Bredell Ferreira" value={totals.firmEarned} />
              </div>
            )}
          </Card>
        )}
        <p className="mt-3 text-[12.5px] text-slate-500 leading-relaxed">
          A cycle runs the 11th to the 10th and is paid over after it closes &mdash; how long after
          is <Link to="/trust/settings" className="font-medium text-gold-700 hover:text-gold-800">
          a trust setting</Link>, and Raptor guessed it. The Bredell Ferreira column is what each
          cycle&rsquo;s receipts <em>earned</em> the firm; what may actually be drawn today is the
          figure below, because a drawing is made against the whole account rather than against one
          month.
        </p>
      </div>

      {/* ------------------------------ the control ------------------------------ */}

      <div className="flex flex-wrap gap-5 items-start">
        <div className="flex-[999_1_28rem] min-w-0">
          {/*
            THE FIRM'S OWN HEADING, AND IT IS A QUESTION. Their sketch asks "Who owns the money in
            trust?" over these four rows, which is better than "Trust control" for the reason the
            whole screen exists: a control is a procedure somebody performs, and the question is
            what a person standing in front of it actually wants answered.
          */}
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            Who owns the money in trust?
          </div>
          {/*
            THE SAME FOUR PARTIES AS BEFORE, DRAWN AS A SUM THAT HAS TO COME OUT. It used to be a
            list headed "whose money is in there", which is true and answers nothing: four figures
            and a total, with the bank balance on a dark panel at the top of the page and no line
            anywhere connecting the two. A trust control is the one place the firm reads DOWN to a
            difference, so it ends where the page began.
          */}
          <Card className="overflow-hidden p-0">
            {/*
              NAMED BY WHAT THE MONEY IS, WITH WHOSE IT IS BESIDE IT -- the firm's sketch does this
              and it is the better way round. "Clients R 2 557,90" is a fact about a column;
              "Awaiting client payover" is the same figure saying what will happen to it, which is
              the second half of the firm's sentence: all the money in the trust fund AND where that
              money should go.

              THE ORDER IS THE SKETCH'S, largest claim first: clients, then the firm, then debtors,
              then what has no owner yet. It used to run clients, debtors, firm.
            */}
            <Party who="Awaiting client payover" whose="Clients" tone="bg-brand-500"
              note="Capital recovered less commission, until the payover is paid"
              amount={position.owedToClients} />
            <Party who="Earned and still held in trust" whose="Bredell Ferreira" tone="bg-positive"
              note="Fees, interest and commission earned, not yet drawn"
              amount={position.owedToFirm} />
            <Party who="Overpayments and refunds outstanding" whose="Debtors" tone="bg-gold-600"
              note="Overpaid their account, awaiting a decision"
              amount={position.owedToDebtors} />
            <Party who="Owner not yet identified" whose="Unallocated receipts" tone="bg-slate-400"
              note="Receipts on the statement nobody has placed"
              amount={position.unidentified} />
            <div className="flex items-center gap-4 px-5 py-3 border-t border-slate-100 bg-slate-50">
              <div className="flex-1 text-[12.5px] font-bold uppercase tracking-wide text-slate-600">
                Total accounted for
              </div>
              <div className="text-[17px] font-semibold tabular-nums">{rand(position.netOwed)}</div>
            </div>
            <div className="flex items-center gap-4 px-5 py-3 bg-slate-50 border-t border-slate-100">
              <div className="flex-1 text-[12.5px] text-slate-500">Bank balance</div>
              <div className="text-[17px] tabular-nums text-slate-600">{rand(position.trustCash)}</div>
            </div>
            <div className={clsx('flex items-center gap-4 px-5 py-3.5 border-t',
              position.difference === 0
                ? 'bg-positive-50 border-positive-100'
                : 'bg-negative-50 border-negative-100')}>
              <div className="flex-1 text-[12.5px] font-bold uppercase tracking-wide text-slate-600">
                Bank / ledger difference
              </div>
              <div className={clsx('text-lg font-semibold tabular-nums',
                position.difference === 0 ? 'text-positive-700' : 'text-negative-700')}>
                {rand(position.difference)}
              </div>
            </div>
          </Card>
          <p className="mt-3 text-[12.5px] text-slate-500 leading-relaxed">
            A client nets across their whole book, because that is how they are paid &mdash; one
            payover run for the company. A debtor nets per account: two files of the same person
            are two debts.
          </p>
        </div>

        <div className="flex-[1_1_20rem] min-w-0 space-y-4">
          {position.owedByClients > 0 && (
            /*
              THE OTHER DIRECTION, AND IT ONLY DRAWS WHEN THERE IS ONE. A trust debtor is unusual
              enough that a permanent card reading R 0.00 would be noise; absent is the honest
              resting state, and the firm's own instruction about warnings is that one which fires
              when nothing is wrong is worse than none.
            */
            <Card className="p-5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Owed back to the trust
              </div>
              <div className="text-2xl font-semibold tabular-nums text-gold-800">
                {rand(position.owedByClients)}
              </div>
              <p className="text-[12.5px] text-slate-500 mt-2 leading-relaxed">
                A debtor paid the client direct, so the firm&rsquo;s fees on that money are owed
                back. It comes off the client&rsquo;s next payover.
              </p>
            </Card>
          )}

          <Card className="p-5 bg-navy-950 text-white border-navy-950">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
              Yours to draw
            </div>
            <div className="text-2xl font-semibold tabular-nums">{rand(position.owedToFirm)}</div>
            <p className="text-[12.5px] text-slate-400 mt-2 leading-relaxed">
              Fees, interest and commission already earned, sitting in trust until they are moved
              to the business account.
            </p>
            {/*
              EARNED LESS DRAWN, WRITTEN OUT WHERE ANYTHING HAS BEEN DRAWN. Without the second line
              the cycle bands above add up to more than this card says, and the only way to find
              out why is to know that a drawing happened. It is absent where nothing has moved,
              rather than drawn as a nil.
            */}
            {totals.firmMoved !== 0 && (
              <p className="text-[12px] text-slate-400 mt-3 pt-3 border-t border-white/10 tabular-nums">
                {rand(totals.firmEarned)} earned across the cycles above,
                less {rand(Math.abs(totals.firmMoved))} already drawn or corrected.
              </p>
            )}
            {/*
              NOT A BUTTON YET, AND SAYING SO. `draw_from_trust` exists and refuses an overdrawing,
              but the screen that decides the amount and records the reference is the business
              side's, which is not built. A control here that opened nothing would be worse than
              the sentence.
            */}
            <p className="text-[12px] text-slate-500 mt-3 pt-3 border-t border-white/10">
              Drawing it is done from the business account, which is still being built.
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}

/**
 * ONE CYCLE: WHAT IT HOLDS, AND WHEN IT LEAVES.
 *
 * THE OPEN ONE CARRIES A BAR AND THE CLOSED ONES DO NOT. On the open cycle the bar is how far
 * through the collecting period today is, which says plainly that the figure beside it is not
 * final. Drawn on a closed cycle the same bar would read as progress towards being paid, which is
 * not what the number knows and would be a promise the screen cannot keep.
 */
function CycleRow({ cycle, today }: { cycle: TrustCycle; today: string }) {
  const state = cycleState(cycle, today)
  const todo = cycleTodo(cycle)
  const progress = cycleProgress(cycle, today)
  return (
    <div className="px-5 py-4 border-b border-slate-100 last:border-b-0">
      <div className="flex items-baseline gap-3 flex-wrap">
        <div className="text-sm font-semibold text-slate-800">
          {cycleLabel(cycle.periodStart, cycle.periodEnd)}
        </div>
        <span className={clsx(
          'text-[11px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded',
          state.tone === 'open' && 'bg-brand-50 text-brand-700',
          state.tone === 'due' && 'bg-slate-100 text-slate-600',
          state.tone === 'late' && 'bg-gold-50 text-gold-800',
        )}>
          {state.word}
        </span>
        <span className="text-[12.5px] text-slate-500">{state.detail}</span>
      </div>

      <div className="mt-2.5 flex items-end gap-8 flex-wrap">
        {/*
          COLLECTED LEADS THE ROW, at the firm's asking -- their sketch orders it COLLECTED, CLIENT
          PORTION, BF EARNED, OTHER HELD. The two figures that follow are both SHARES of it, and
          without the whole on the row a small client column cannot be told apart from a quiet
          month. Greyed rather than bold: it is the context for the two that are money owed to
          somebody, not a third thing owed to anybody.
        */}
        <Money label="Collected" value={cycleCollected(cycle)} big muted />
        <Money label="Due to clients" value={cycle.toClients} big />
        <Money label="Due to Bredell Ferreira" value={cycle.firmEarned} big />
        {/* Only where there is one. A permanent R 0.00 for debtor overpayments on every cycle is
            four rows of noise for a thing that happens to one account in a hundred. */}
        {cycle.toDebtors !== 0 && <Money label="Held for debtors" value={cycle.toDebtors} />}
      </div>

      {cycle.isOpen && (
        <div className="mt-3 h-1 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full bg-brand-500 rounded-full"
            style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}

      {todo && (
        <Link to="/trust/payover"
          className="mt-2.5 inline-block text-[12.5px] font-medium text-gold-700 hover:text-gold-800">
          {todo} &rarr;
        </Link>
      )}
    </div>
  )
}

/**
 * DOES IT BALANCE, AND WHAT IS LEFT TO DO?
 *
 * FOUR ROWS, ALWAYS ALL FOUR, even when they all pass. A panel that listed only problems is one
 * nobody can tell apart from a panel that failed to load, and the firm's sentence is about being
 * told that everything IS fine as much as about being told when it is not.
 *
 * EACH ROW IS A QUESTION WITH AN ANSWER, not a label with a number. "Unallocated receipts R 485,00"
 * is a fact somebody has to already know the significance of; "Does every rand in there have an
 * owner? -- R 485,00 is in the account with nobody's name on it" is the same figure doing the work.
 */
function TrustBalancePanel({ checks }: { checks: TrustCheck[] }) {
  const verdict = trustVerdict(checks)
  return (
    <Card className="overflow-hidden p-0">
      <div className={clsx('px-5 py-3.5 border-b flex items-baseline gap-3 flex-wrap',
        verdict.tone === 'clear' ? 'bg-positive-50 border-positive-100'
          : verdict.tone === 'warn' ? 'bg-gold-50 border-gold-100'
            : 'bg-negative-50 border-negative-100')}>
        <div className={clsx('text-sm font-semibold',
          verdict.tone === 'clear' ? 'text-positive-700'
            : verdict.tone === 'warn' ? 'text-gold-800' : 'text-negative-700')}>
          {verdict.line}
        </div>
        {/*
          THE WORDS THE FIRM USED, kept where they will be read. The panel exists because of this
          sentence and the sentence is not obvious from the rows.
        */}
        <div className="text-[12.5px] text-slate-500">
          Everything in the trust account, and where it should go.
        </div>
      </div>
      {checks.map((c) => (
        <div key={c.id} className="flex items-start gap-4 px-5 py-3 border-b border-slate-100 last:border-b-0">
          <span className={clsx('mt-1.5 h-2 w-2 rounded-full shrink-0',
            c.tone === 'clear' ? 'bg-positive' : c.tone === 'warn' ? 'bg-gold-500' : 'bg-negative-500')} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-slate-700">{c.question}</div>
            <div className="text-[12.5px] text-slate-500 mt-0.5">{c.answer}</div>
          </div>
          {/* THE AMOUNT ONLY WHERE THERE IS ONE TO SHOW. R 0,00 against a row that passed is a
              number somebody has to read and discard; the answer beside it already says nothing
              is outstanding. */}
          {c.amount !== null && c.amount !== 0 && (
            <div className={clsx('text-[15px] font-semibold tabular-nums shrink-0',
              c.tone === 'bad' ? 'text-negative-700' : 'text-gold-800')}>
              {rand(Math.abs(c.amount))}
            </div>
          )}
        </div>
      ))}
    </Card>
  )
}

function Money({ label, value, big, muted }: {
  label: string; value: number; big?: boolean; muted?: boolean
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
        {label}
      </div>
      <div className={clsx('tabular-nums font-medium leading-none',
        big ? 'text-[19px]' : 'text-[15px]',
        /* Muted is for a figure that is CONTEXT rather than a balance owed to somebody — the gross
           collected beside the two shares of it. Same size, lighter, so the eye reads the shares. */
        muted ? 'text-slate-400' : big ? 'text-slate-800' : 'text-slate-600')}>
        {rand(value)}
      </div>
    </div>
  )
}

function Figure({ label, value, small, tone }: {
  label: string; value: string; small?: boolean; tone?: string
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
        {label}
      </div>
      <div className={clsx(
        'font-medium tabular-nums leading-none',
        small ? 'text-2xl' : 'text-3xl',
        tone,
      )}>
        {value}
      </div>
    </div>
  )
}

function Party({ who, whose, note, amount, tone }: {
  who: string; whose: string; note: string; amount: number; tone: string
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-slate-100 last:border-b-0">
      <div className={clsx('w-[3px] h-8 rounded-sm shrink-0', tone)} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-800">{who}</div>
        {/* WHOSE IT IS, KEPT. The line above says what the money is waiting for; this says who
            would be out of pocket if it went missing, which is the whole point of a trust. */}
        <div className="text-[12.5px] text-slate-500 mt-0.5">
          <span className="font-medium text-slate-600">{whose}</span> &middot; {note}
        </div>
      </div>
      <div className="text-[17px] font-medium tabular-nums">{rand(amount)}</div>
    </div>
  )
}
