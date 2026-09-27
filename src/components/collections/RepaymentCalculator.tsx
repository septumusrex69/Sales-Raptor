import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, Info } from 'lucide-react'
import type { BalanceInput } from '../../lib/accountBalance.ts'
import type { Recurring } from '../../lib/arrangements.ts'
import {
  instalmentToSettleIn, repaymentPlan, type RepaymentPlan,
} from '../../lib/repaymentPlan.ts'
import { shortDate } from '../../lib/dateLabels.ts'

/**
 * WHAT THE OFFER ON THE TABLE ACTUALLY DOES, WHILE THE COLLECTOR IS STILL ON THE CALL.
 *
 * THE FIRM ASKED FOR IT HERE, BESIDE THE PROMISE TO PAY: "the guy owes 10 000 rand, he wants to pay
 * 500 rand a month, take into account interest... how long will it take him?"
 *
 * THE ANSWER IS ALMOST ALWAYS WORSE THAN BOTH SIDES THINK, and that is the reason this exists
 * rather than a calculator on somebody's desk. R500 a month against R10 200 at 2% a month is not
 * twenty payments: R204 of the first one is interest before anything touches the debt, item 9 takes
 * R57.50 more, and the account clears in THIRTY-ONE payments having cost R15 267. A collector who
 * can say that out loud, with the month, is negotiating instead of taking down a number.
 *
 * IT READS THE FORM RATHER THAN ASKING AGAIN. The amount, the shape and the first date are the ones
 * being typed into the promise above it, so the figures are about the arrangement that is actually
 * going to be recorded -- a second set of inputs here would let somebody quote one arrangement and
 * save a different one.
 *
 * AND IT SAYS WHAT IT ASSUMES. The firm's own condition -- "in a world where no fees accumulate,
 * however the receipt fee is still applicable" -- is on the screen, because the number goes to a
 * debtor and an account that is charged for a call next week will not match it.
 */
export function RepaymentCalculator({ account, amount, schedule, money }: {
  /** The statement's own assembly, so this cannot be a second opinion about the same money. */
  account: Omit<BalanceInput, 'accrueTo'>
  amount: number
  schedule: Recurring | null
  money: (n: number) => string
}) {
  const [showAll, setShowAll] = useState(false)

  const plan = useMemo<RepaymentPlan | null>(() => {
    if (!schedule || !(amount > 0)) return null
    return repaymentPlan({ account, instalment: amount, schedule })
  }, [account, amount, schedule])

  /*
   * WHAT TO ASK FOR INSTEAD, and six is the number that matters: the firm's own letters tell the
   * debtor that an arrangement running longer than six instalments is reported to the credit
   * bureaus as slow paying. Each of these is the SAME projection bisected to the rand, so the
   * counter-offer and the schedule beside it cannot disagree.
   */
  const targets = useMemo(() => {
    if (!schedule || schedule.arrangement === 'once_off') return []
    return [6, 12, 24].map((n) => ({
      n, rand: instalmentToSettleIn({ account, schedule }, n),
    })).filter((t): t is { n: number; rand: number } => t.rand !== null)
  }, [account, schedule])

  if (!plan) return null

  const rows = showAll ? plan.rows : plan.rows.slice(0, 3)
  const each = schedule?.arrangement === 'weekly' ? 'a week' : 'a month'

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">If they pay this</p>

      {/* THE HEADLINE IS THE SENTENCE SOMEBODY SAYS OUT LOUD, not a row of figures to interpret. */}
      {plan.outcome === 'settles' && (
        <p className="mt-1 text-[13px] text-slate-800">
          <span className="font-medium tabular-nums">{plan.rows.length}</span>
          {' '}payments{each === 'a week' ? ', weekly' : ', monthly'}, settling{' '}
          <span className="font-medium">{shortDate(plan.settlesOn ?? '')}</span>.
        </p>
      )}
      {plan.outcome === 'never' && (
        <p className="mt-1 flex items-start gap-1.5 text-[13px] font-medium text-negative-700">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            {money(amount)} {each} does not cover the interest, so the account never clears.
            {plan.minimumInstalment ? ` Nothing below ${money(plan.minimumInstalment)} can.` : ''}
          </span>
        </p>
      )}
      {plan.outcome === 'not_within' && (
        <p className="mt-1 flex items-start gap-1.5 text-[13px] font-medium text-[var(--c-gold-deep)]">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            {/* A once-off that does not settle is one payment and a balance left over, which is a
                different sentence from an arrangement that outruns the horizon. */}
            {schedule?.arrangement === 'once_off'
              ? `That leaves ${money(plan.leftOwing)} on the account.`
              : `After ${plan.rows.length} payments ${money(plan.leftOwing)} would still be owing.`}
            {plan.belowTheInterest && ` ${money(amount)} ${each} does not cover the interest.`}
          </span>
        </p>
      )}

      {/*
        THE THREE FIGURES THAT MAKE THE CASE. What they hand over in all, and how much of it never
        touches the debt -- which is the part a debtor has never been shown and the part that makes
        a shorter arrangement worth agreeing to.
      */}
      <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <Figure label="They pay" value={money(plan.totalPaid)} strong />
        <Figure label="Interest" value={money(plan.totalInterest)} />
        <Figure label="Receipt fees" value={money(plan.totalReceiptFees)} />
      </dl>

      {/* INTEREST THAT IS NOT RUNNING IS SAID OUT LOUD. A zero here has two meanings and only one
          of them is safe: a quotation that silently omits interest is one a debtor can hold the
          firm to. */}
      {!plan.interestRunning && (
        <p className="mt-1.5 text-[11px] text-slate-500">
          No interest is running on this account, so none is included above.
        </p>
      )}
      {plan.hitInDuplum && (
        <p className="mt-1.5 text-[11px] text-slate-500">
          In duplum caps this: interest and fees stop at the capital handed over, so the figures
          above are what may be recovered rather than what would accrue.
        </p>
      )}
      {plan.readsAsSlowPaying && plan.outcome === 'settles' && (
        <p className="mt-1.5 text-[11px] text-[var(--c-gold-deep)]">
          Over six instalments, so it is reported to the credit bureaus as slow paying &mdash; which
          is what our own letters tell the debtor.
        </p>
      )}

      {/* WHAT TO ASK FOR INSTEAD. The half of the conversation that turns a report into a
          negotiation, and the reason six is first. */}
      {targets.length > 0 && (
        <div className="mt-2 border-t border-slate-200 pt-2">
          <p className="text-[11px] text-slate-500">To clear it sooner</p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {targets.map((t) => (
              <li key={t.n} className="text-[11px] text-slate-600">
                <span className="font-medium tabular-nums text-slate-800">{money(t.rand)}</span>
                {' '}&rarr; {t.n} payments
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* AND THE WORKING, because a debtor is entitled to ask how the figure was arrived at and a
          collector should not have to say "the system worked it out". */}
      {plan.rows.length > 0 && (
        <div className="mt-2 border-t border-slate-200 pt-2">
          <table className="w-full text-[11px] tabular-nums">
            <thead>
              <tr className="text-slate-400">
                <th className="text-left font-normal">Due</th>
                <th className="text-right font-normal">Pays</th>
                <th className="text-right font-normal">Interest</th>
                <th className="text-right font-normal">Fee</th>
                <th className="text-right font-normal">Owing</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.no} className="text-slate-600">
                  <td className="text-left">{shortDate(r.dueOn)}</td>
                  <td className="text-right">{money(r.amount)}</td>
                  <td className="text-right">{money(r.interest)}</td>
                  <td className="text-right">{money(r.receiptFee)}</td>
                  <td className="text-right">{money(r.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.rows.length > 3 && (
            <button type="button" onClick={() => setShowAll((v) => !v)}
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800">
              <ChevronDown size={12} className={showAll ? 'rotate-180 transition-transform' : 'transition-transform'} />
              {showAll ? 'Show fewer' : `Every payment (${plan.rows.length})`}
            </button>
          )}
        </div>
      )}

      {/* THE ASSUMPTION GOES WITH THE NUMBER. The firm chose it and a debtor is entitled to it. */}
      <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-snug text-slate-400">
        <Info size={11} className="mt-0.5 shrink-0" />
        <span>{plan.assumption}</span>
      </p>
    </div>
  )
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-slate-400">{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-medium text-slate-800' : 'text-slate-600'}`}>{value}</dd>
    </div>
  )
}
