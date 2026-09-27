import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, FileDown, Info, Loader2 } from 'lucide-react'
import { letterPdfBytes } from '../../lib/letterAttachment.ts'
import { letterFilename } from '../../lib/letterPdf.ts'
import { repaymentLetter, repaymentLetterRefusal } from '../../lib/repaymentLetter.ts'
import type { BalanceInput } from '../../lib/accountBalance.ts'
import type { Recurring } from '../../lib/arrangements.ts'
import {
  repaymentPlan, settlementLadder, type RepaymentPlan,
} from '../../lib/repaymentPlan.ts'
import { moneyProgress, progressPercent } from '../../lib/paymentProgress.ts'
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
export function RepaymentCalculator({ account, amount, schedule, money, values, reference, balanceToday, paidSoFar }: {
  /** The statement's own assembly, so this cannot be a second opinion about the same money. */
  account: Omit<BalanceInput, 'accrueTo'>
  amount: number
  schedule: Recurring | null
  money: (n: number) => string
  /**
   * The account's merge values, for the document. Same map every other letter is drawn with, so
   * the trust account on this schedule is the trust account on the section 129.
   */
  values?: Record<string, string>
  /** What the debtor knows the account by. Goes in the filename, not in the letter. */
  reference?: string | null
  /** What is owed today, printed at the top of the schedule so the debtor sees where it starts. */
  balanceToday?: number
  /**
   * WHAT HAS ALREADY BEEN PAID ON THIS ACCOUNT, for the progress bar.
   *
   * THE FIRM: "how far are they with their payments? What is the progress and the percentage of
   * what's been paid?" Measured against everything the account has been CHARGED -- capital,
   * interest and fees -- rather than against the capital handed over, because a debtor who has
   * paid the capital and owes three thousand in interest is not finished, and a bar that said
   * 100% would tell them they were.
   */
  paidSoFar?: number
}) {
  const [showAll, setShowAll] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  /*
   * A FIGURE TO TRY, WHICH IS NOT THE ONE BEING RECORDED.
   *
   * THE FIRM: "let's say Rita wants to negotiate and wants to know, oh, what would happen if I pay
   * 3 000 rand a month? We have to give them that kind of... it'll be a nice tool."
   *
   * ITS OWN BOX RATHER THAN THE FORM'S. Answered by typing into the promise above, the collector
   * would have to put a figure nobody has agreed into the field that RECORDS the arrangement -- and
   * the one thing worse than not being able to answer the question is answering it and then saving
   * it. Empty is the normal state and the panel follows the form; a figure here overrides the
   * arithmetic and nothing else.
   */
  const [trying, setTrying] = useState('')
  const tried = Number(trying.replace(/[^\d.]/g, ''))
  const whatIf = trying.trim() !== '' && tried > 0 ? tried : null
  const shown = whatIf ?? amount

  const plan = useMemo<RepaymentPlan | null>(() => {
    if (!schedule || !(shown > 0)) return null
    return repaymentPlan({ account, instalment: shown, schedule })
  }, [account, shown, schedule])

  /*
   * WHAT THE SAME DEBT COSTS AT DIFFERENT SPEEDS, AND WHAT PAYING FASTER SAVES THEM.
   *
   * THE FIRM: "show how it would look like in, for example, settling this in three or four
   * instalments... so that we can negotiate and the people can see how fast they would pay it off
   * and how much they would save -- kind of as a motivational thing that they pay more faster."
   *
   * THE SAVING IS THE COLUMN THAT DOES THE WORK. "Thirty-one payments" is a fact about the
   * calendar and a debtor hears it as one; "six payments and you keep three thousand rand" is a
   * reason to stretch, and it is their money rather than the firm's.
   */
  const ladder = useMemo(() => {
    if (!schedule || !plan || schedule.arrangement === 'once_off') return []
    return settlementLadder({ account, schedule }, plan)
  }, [account, schedule, plan])

  /*
   * HOW FAR THE DEBTOR ALREADY IS. Null where nothing has been paid: see hasProgress -- an empty
   * bar is a graphic whose only message is "you have paid nothing", which the figures below say
   * already and better.
   */
  const progress = paidSoFar !== undefined && paidSoFar > 0 && balanceToday !== undefined
    ? moneyProgress({ payments: paidSoFar, balance: balanceToday })
    : null

  if (!plan) return null

  const rows = showAll ? plan.rows : plan.rows.slice(0, 3)
  const each = schedule?.arrangement === 'weekly' ? 'a week' : 'a month'
  /*
   * WHY THE DOCUMENT CANNOT BE MADE, or null where it can. A schedule with no end is not something
   * to send anybody, and the button says which rather than being quietly absent -- a collector who
   * cannot find it once stops looking for it.
   */
  const refusal = repaymentLetterRefusal(plan)

  async function download() {
    if (!plan || !values) return
    setSaving(true); setFailed(null)
    try {
      const doc = repaymentLetter({
        plan, money, each, balanceToday: balanceToday ?? plan.rows[0].balanceAfter + plan.rows[0].offDebt,
        /* The same two the screen is showing, so the page the debtor reads and the panel the
           collector quoted from are one set of figures. */
        faster: ladder,
        paidSoFar,
      })
      /*
       * THROUGH letterPdfBytes, which is what draws every other letter this firm sends: it fetches
       * the letterhead as bytes, embeds Charter, and refuses a document whose merge fields this
       * account cannot fill. Drawn any other way this schedule would be the one PDF that does not
       * come out on the firm's paper.
       */
      const bytes = await letterPdfBytes({
        doc, scope: 'collections', values, filled: true, name: 'The repayment schedule',
      })
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = letterFilename('Payment arrangement', reference ?? null)
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      /* The reason verbatim: "the repayment schedule was not attached: {{firm_bank}} cannot be
         filled from this account" says what to go and fix, and a generic failure does not. */
      setFailed(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">
        {whatIf === null ? 'If they pay this' : 'If they paid this instead'}
      </p>
      {/*
        WHAT IF THEY PAID SOMETHING ELSE, on its own line under the heading.

        NOT BESIDE IT. This panel lives in the account's right-hand column, which is about two
        hundred pixels wide, and a heading sharing a row with a box wrapped to two lines around it.
        Near the top rather than at the foot of the panel, because it is the question a collector is
        asked mid-sentence on a call.
      */}
      <label className="mt-1 flex items-center justify-end gap-1 text-[11px] text-slate-400">
        <span>Try a different amount</span>
        <input
          value={trying}
          onChange={(e) => { setTrying(e.target.value) }}
          inputMode="decimal"
          placeholder={amount > 0 ? String(amount) : 'amount'}
          aria-label="Try a different instalment"
          className="w-16 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-right tabular-nums text-slate-700 focus:border-[#c9a052] focus:outline-none"
        />
      </label>
      {/*
        AND IT SAYS SO, EVERY TIME. A panel quietly describing a figure that is not the one in the
        form above it is how a collector reads out one arrangement and saves a different one -- and
        the schedule button below would send the debtor the same mistake on the firm's letterhead.
      */}
      {whatIf !== null && (
        <p className="mt-0.5 text-[11px] leading-snug text-[var(--c-gold-deep)]">
          Working on {money(whatIf)} {each}. The arrangement being recorded above is still
          {' '}{amount > 0 ? money(amount) : 'unset'}.
        </p>
      )}

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
            {money(shown)} {each} does not cover the interest, so the account never clears.
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
            {plan.belowTheInterest && ` ${money(shown)} ${each} does not cover the interest.`}
          </span>
        </p>
      )}

      {/*
        HOW FAR THEY ALREADY ARE, where there is anything to show.

        NOTHING PAID IS NOT PROGRESS -- an empty bar on every account in the book is a thing people
        stop seeing, and on an account that has paid nothing the figures below already say so. The
        bar is measured against everything CHARGED rather than the capital handed over, so interest
        accruing moves it BACKWARDS, which is true and is exactly what a debtor paying the minimum
        needs to see.
      */}
      {progress !== null && (
        <div className="mt-2">
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="text-slate-500">Paid so far</span>
            <span className="tabular-nums text-slate-600">
              <span className="font-medium text-slate-800">{money(progress.recovered)}</span>
              {' of '}{money(progress.charged)}
              {' \u00b7 '}<span className="font-medium">{progressPercent(progress)}%</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
            role="img" aria-label={`${progressPercent(progress)}% of this account has been paid`}>
            <div className="h-full rounded-full bg-[var(--color-positive)]"
              style={{ width: `${progressPercent(progress)}%` }} />
          </div>
        </div>
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

      {/*
        WHAT TO ASK FOR INSTEAD, AND WHAT IT SAVES THEM. The half of the conversation that turns a
        report into a negotiation -- and the saving is measured against what the debtor themselves
        offered, which is the only baseline that is not a number the firm chose.
      */}
      {ladder.length > 0 && (
        <div className="mt-2 border-t border-slate-200 pt-2">
          <p className="text-[11px] text-slate-500">Their offer, and paying it off faster</p>
          {/* Named, so what it is survives being read out of context -- by a screen reader, and by
              the browser check that has to tell this table from the schedule below it. */}
          <table aria-label="What paying it off faster would cost"
            className="mt-1 w-full text-[11px] tabular-nums">
            <thead>
              <tr className="text-slate-400">
                <th className="text-left font-normal">Payments</th>
                <th className="text-right font-normal">Each</th>
                <th className="text-right font-normal">Total</th>
                <th className="text-right font-normal">They save</th>
              </tr>
            </thead>
            <tbody>
              {ladder.map((o) => (
                /* THEIR OWN OFFER IS THE FIRST ROW AND IS MARKED AS THEIRS, which is what makes the
                   rows under it a comparison rather than four figures the firm came up with. Same
                   order and same anchor as the PDF the debtor is sent, so the collector is reading
                   off the page in front of them. */
                <tr key={o.instalments} className={o.theirs ? 'text-slate-800' : 'text-slate-600'}>
                  <td className={`text-left ${o.theirs ? 'font-medium' : ''}`}>
                    {o.theirs ? 'Their offer' : (o.instalments === 1 ? 'Settle now' : o.instalments)}
                  </td>
                  <td className={`text-right ${o.theirs ? 'font-medium' : ''}`}>{money(o.each)}</td>
                  <td className={`text-right ${o.theirs ? 'font-medium' : ''}`}>{money(o.totalPaid)}</td>
                  {/* The one figure in the panel that is good news, and it is the debtor's. A dash
                      on their own row: a nought under "They save" reads as a saving of nothing
                      rather than as the row everything else is measured from. */}
                  <td className="text-right font-medium text-positive-700">
                    {o.theirs ? '\u2014' : money(o.saving)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* AND THE WORKING, because a debtor is entitled to ask how the figure was arrived at and a
          collector should not have to say "the system worked it out". */}
      {plan.rows.length > 0 && (
        <div className="mt-2 border-t border-slate-200 pt-2">
          <table aria-label="Every payment of this arrangement"
            className="w-full text-[11px] tabular-nums">
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

      {/*
        AND THE DEBTOR CAN BE SENT IT. The firm: "even if possible, we can create a document that we
        can send him." On the firm's letterhead, through the same letterPdfBytes every other notice
        goes out on, and saying twice on its own face that it is an illustration rather than a
        demand -- a page of figures on a letterhead is treated as binding unless it says otherwise.
      */}
      {values && (
        <div className="mt-2 border-t border-slate-200 pt-2">
          <button type="button" onClick={() => { void download() }} disabled={saving || refusal !== null}
            title={refusal ?? 'A PDF on the firm’s letterhead, to send the debtor'}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
              refusal !== null
                ? 'cursor-not-allowed border-dashed border-slate-200 text-slate-300'
                : 'border-[#c9a052] bg-white text-navy-950 hover:bg-gold-100'}`}>
            {saving ? <Loader2 size={11} className="animate-spin" /> : <FileDown size={11} />}
            Schedule as a PDF
          </button>
          {/* The reason it cannot be made, beside the button rather than in a tooltip only: on the
              iPad the firm works on there is no hover to reveal one. */}
          {refusal && <p className="mt-1 text-[11px] leading-snug text-slate-500">{refusal}</p>}
          {failed && <p className="mt-1 text-[11px] leading-snug text-negative-700">{failed}</p>}
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
