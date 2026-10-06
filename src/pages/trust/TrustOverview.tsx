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
  cycleLabel, cycleProgress, cycleState, cycleTodo, cycleTotals, shortDate,
} from '../../lib/trustCycles'

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

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">Trust overview</h1>
        <span className="text-xs text-slate-400">
          Money the firm holds for other people, as at {shortDate(today)}
        </span>
      </div>

      {/* Cash, what is owed, and the gap. The gap is the point of the panel. */}
      <div className="rounded-xl bg-navy-950 text-white px-6 py-5 flex flex-wrap items-end gap-10">
        <Figure label="In the bank" value={rand(position.trustCash)} />
        <Figure label="Owed out of it" value={rand(position.netOwed)} />
        <Figure
          label="Difference"
          value={rand(position.difference)}
          small
          tone={position.difference === 0 ? 'text-positive-100' : 'text-negative-300'}
        />
      </div>

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
              NEWEST FIRST, WHICH IS THE ORDER THE FIRM SAID IT IN -- "what is for this month's
              payover? And what is for next month's payover" -- and it is the open cycle that
              everybody is adding to, so it goes where the eye lands.
            */}
            {cycles.map((c) => (
              <CycleRow key={c.periodStart} cycle={c} today={today} />
            ))}
            {cycles.length > 1 && (
              <div className="flex items-center gap-4 px-5 py-3.5 border-t border-slate-200 bg-slate-50">
                <div className="flex-1 text-[12.5px] font-bold uppercase tracking-wide text-slate-600">
                  Across every cycle
                </div>
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
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            Trust control
          </div>
          {/*
            THE SAME FOUR PARTIES AS BEFORE, DRAWN AS A SUM THAT HAS TO COME OUT. It used to be a
            list headed "whose money is in there", which is true and answers nothing: four figures
            and a total, with the bank balance on a dark panel at the top of the page and no line
            anywhere connecting the two. A trust control is the one place the firm reads DOWN to a
            difference, so it ends where the page began.
          */}
          <Card className="overflow-hidden p-0">
            <Party who="Clients" tone="bg-brand-500"
              note="Capital recovered less commission, until the payover is paid"
              amount={position.owedToClients} />
            <Party who="Debtors" tone="bg-gold-600"
              note="Overpaid their account, awaiting a decision"
              amount={position.owedToDebtors} />
            <Party who="Bredell Ferreira" tone="bg-positive"
              note="Fees, interest and commission earned, not yet drawn"
              amount={position.owedToFirm} />
            <Party who="Not yet identified" tone="bg-slate-400"
              note="Receipts on the statement nobody has placed"
              amount={position.unidentified} />
            <div className="flex items-center gap-4 px-5 py-3 border-t border-slate-100 bg-slate-50">
              <div className="flex-1 text-[12.5px] font-bold uppercase tracking-wide text-slate-600">
                Owed out of trust
              </div>
              <div className="text-[17px] font-semibold tabular-nums">{rand(position.netOwed)}</div>
            </div>
            <div className="flex items-center gap-4 px-5 py-3 bg-slate-50 border-t border-slate-100">
              <div className="flex-1 text-[12.5px] text-slate-500">In the bank</div>
              <div className="text-[17px] tabular-nums text-slate-600">{rand(position.trustCash)}</div>
            </div>
            <div className={clsx('flex items-center gap-4 px-5 py-3.5 border-t',
              position.difference === 0
                ? 'bg-positive-50 border-positive-100'
                : 'bg-negative-50 border-negative-100')}>
              <div className="flex-1 text-[12.5px] font-bold uppercase tracking-wide text-slate-600">
                Difference
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

function Money({ label, value, big }: { label: string; value: number; big?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
        {label}
      </div>
      <div className={clsx('tabular-nums font-medium leading-none',
        big ? 'text-[19px] text-slate-800' : 'text-[15px] text-slate-600')}>
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

function Party({ who, note, amount, tone }: {
  who: string; note: string; amount: number; tone: string
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-slate-100 last:border-b-0">
      <div className={clsx('w-[3px] h-8 rounded-sm shrink-0', tone)} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-800">{who}</div>
        <div className="text-[12.5px] text-slate-500 mt-0.5">{note}</div>
      </div>
      <div className="text-[17px] font-medium tabular-nums">{rand(amount)}</div>
    </div>
  )
}
