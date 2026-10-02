import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, FileDown, Info, Loader2, Mail, Maximize2 } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { letterPdfBytes } from '../../lib/letterAttachment.ts'
import { letterFilename, toBase64 } from '../../lib/letterPdf.ts'
import { repaymentLetter, repaymentLetterRefusal } from '../../lib/repaymentLetter.ts'
import type { BalanceInput } from '../../lib/accountBalance.ts'
import type { Recurring } from '../../lib/arrangements.ts'
import {
  repaymentPlan, settlementLadder, type RepaymentPlan,
} from '../../lib/repaymentPlan.ts'
import { moneyProgress, progressPercent } from '../../lib/paymentProgress.ts'
import { shortDate } from '../../lib/dateLabels.ts'
import { fetchLibrary } from '../../lib/templateLibrary.ts'
import { longDate, renderTemplate } from '../../lib/messageTemplates'
import type { AttachedFile } from '../../lib/letterAttachment.ts'

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
export function RepaymentCalculator({ account, amount, schedule, money, values, reference, balanceToday, settlementFeeToday, paidSoFar, audience, onEmail }: {
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
   * The item 9 fee on settling in full today, which the progress bar counts as still to come.
   *
   * THE FIRM: "the receipt fee should be added and also included always in that bar if the person
   * settles the full amount." Passed in rather than worked out here, off the same computeBalance
   * the statement beside it is drawn from -- recomputed it would be a second opinion about the
   * same money, and in duplum can cap it to nothing.
   */
  settlementFeeToday?: number
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
  /** Which half of the library the covering email comes from. Undefined falls back to the
      individual wording, which is what 97% of the book is. */
  audience?: 'individual' | 'company' | null
  /**
   * SEND IT TO THE DEBTOR, rather than download it and attach it by hand.
   *
   * THE FIRM: "if you click on that, it sends it to the debtor as an email and it charges it as
   * well. So you can send it from the emails or you can send it from the promise to pay section."
   *
   * HANDED UP RATHER THAN SENT FROM HERE, and the difference is where the fee is raised. The
   * account's own compose box already sends through the collector's mailbox, files the message on
   * the account and charges item 1(a) -- one path, one charge, one record. A second sender here
   * would be a second place that has to remember the R25, and the one that forgot it would be the
   * one nobody was watching.
   *
   * SO THIS OPENS THE BOX WITH EVERYTHING IN IT: the wording merged from the firm's own template,
   * and the simulation already drawn and attached. The collector reads it and presses Send, which
   * is right for a page of figures going to a debtor mid-negotiation -- and is one press, not
   * eleven.
   */
  onEmail?: (sim: {
    file: AttachedFile
    /** The account's values with the three the simulation answers overlaid. See simValues. */
    values: Record<string, string>
    subject: string
    body: string
    /** Fields the firm's template asked for that nothing could fill. Shown, never swallowed. */
    missing: string[]
  }) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
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
  /* Where this panel is being read. See the note on `body`. */
  const [big, setBig] = useState(false)
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
    ? moneyProgress({
      payments: paidSoFar, balance: balanceToday, settlementFee: settlementFeeToday ?? 0,
    })
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

  /*
   * THE THREE FIELDS A SIMULATION ANSWERS AND NOTHING ELSE ON THE ACCOUNT CAN.
   *
   * The firm: "this is before you conclude the payment arrangement" -- so there is no promise on
   * the account for mergeValuesFor to read, and {{ptp_amount}} would stand unresolved on the very
   * email that is about it. These are the figures being TRIED, which is what the collector is
   * talking about on the call.
   *
   * {{ptp_amount}} IS REUSED RATHER THAN DUPLICATED, at the firm's instruction. It is the same
   * fact in the same words; a second field meaning "the amount, but hypothetically" is one more
   * thing to pick wrongly on a template.
   *
   * AND `money` IS THE CALLER'S, the one every other figure in this panel and on the PDF goes
   * through -- so the amount in the covering email and the amount in the attachment are formatted
   * by one function and cannot read as two systems.
   */
  const simValues = values && plan ? {
    ...values,
    ptp_amount: money(plan.rows[0].amount),
    sim_frequency: each,
    sim_start: longDate(plan.rows[0].dueOn),
  } : null

  /* Built in one place and drawn twice -- downloaded, and attached to the covering email. Written
     out at both, the page the collector checks and the page the debtor receives could differ. */
  function simulation() {
    if (!plan) return null
    return repaymentLetter({
      plan, money, each, balanceToday: balanceToday ?? plan.rows[0].balanceAfter + plan.rows[0].offDebt,
      settlementFeeToday,
      /* The same two the screen is showing, so the page the debtor reads and the panel the
         collector quoted from are one set of figures. */
      faster: ladder,
      paidSoFar,
    })
  }

  /*
   * THROUGH letterPdfBytes, which is what draws every other letter this firm sends: it fetches
   * the letterhead as bytes, embeds Charter, and refuses a document whose merge fields this
   * account cannot fill. Drawn any other way this simulation would be the one PDF that does not
   * come out on the firm's paper.
   */
  async function simulationPdf(): Promise<Uint8Array | null> {
    const doc = simulation()
    if (!doc || !simValues) return null
    return letterPdfBytes({
      doc, scope: 'collections', values: simValues, filled: true, name: 'The payment simulation',
    })
  }

  async function download() {
    if (!plan || !values) return
    setSaving(true); setFailed(null)
    try {
      const bytes = await simulationPdf()
      if (!bytes) return
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = letterFilename('Payment simulation', reference ?? null)
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      /* The reason verbatim: "the payment simulation was not attached: {{firm_bank}} cannot be
         filled from this account" says what to go and fix, and a generic failure does not. */
      setFailed(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  /**
   * THE SAME DOCUMENT, ON ITS WAY TO THE DEBTOR.
   *
   * THE WORDING IS THE FIRM'S OWN TEMPLATE, merged here rather than typed by the collector: it is
   * the message that tells the debtor this is a simulation, that an arrangement exists only once
   * it is confirmed in writing, and that the Annexure B fees are not in any of the figures. A
   * collector writing that from memory on a call will leave out the third one.
   *
   * THE AUDIENCE PICKS THE HALF, like every other collections template -- "Dear" against "To the
   * directors of", an identity number against a registration number.
   *
   * IT DOES NOT SEND. See onEmail: the account's compose box is the one path that sends through
   * the collector's mailbox, files the message and raises item 1(a), and a second sender here
   * would be a second place that has to remember the R25.
   */
  async function emailIt() {
    if (!plan || !simValues || !onEmail) return
    setSending(true); setFailed(null)
    try {
      const wanted = audience === 'company'
        ? 'email-ptp-simulation-company'
        : 'email-ptp-simulation-individual'
      const template = (await fetchLibrary('collections')).find((t) => t.seedKey === wanted)
      if (!template) {
        setFailed('The covering email for a payment simulation is not in the library.')
        return
      }
      const bytes = await simulationPdf()
      if (!bytes) return
      const subject = renderTemplate(template.subject, simValues)
      const body = renderTemplate(template.body, simValues)
      onEmail({
        file: {
          filename: letterFilename('Payment simulation', reference ?? null),
          contentType: 'application/pdf',
          size: bytes.length,
          content: toBase64(bytes),
        },
        values: simValues,
        subject: subject.text,
        body: body.text,
        /* Both halves, deduplicated: an unresolved field in the subject is as bad as one in the
           body, and the box warns once rather than twice about the same key. */
        missing: [...new Set([...subject.missing, ...body.missing])],
      })
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  /*
   * ----------------------------------------------------------------------------------------
   * THE SAME PANEL, SOMEWHERE WITH ROOM IN IT.
   * ----------------------------------------------------------------------------------------
   * THE FIRM, on the three-column layout: "for the one with the three columns, it views very
   * small... perhaps we can put it in the middle, so there's more space to see — or you click on
   * something and it opens something else, you know, like it opens a better view."
   *
   * THIS IS THE SECOND OF THOSE, and it is the one that does not disturb the page. The rail is
   * about two hundred and fifty pixels and this panel carries a four-column ladder of rand
   * amounts and a five-column schedule under it; moving the whole promise panel into the middle
   * would fix the simulation by taking the timeline's width away from it, on a page every
   * collector uses all day, to help the one card that happens to be widest.
   *
   * ONE INSTANCE, MOVED — NOT A SECOND ONE DRAWN BIGGER. The body is built once and rendered
   * either in the rail or in the dialog, so it keeps its place in the React tree and everything on
   * it survives the move: the figure typed into "try a different amount", a schedule half
   * expanded, a send in flight. A modal that mounted its own copy would open empty, and the
   * collector would be mid-sentence on a call.
   */
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        {/* THE DIALOG'S OWN TITLE SAYS IT, so the eyebrow would be the same four words twice an
            inch apart. It still draws for the "paid this instead" case, which is a different
            sentence and the one a collector needs to see mid-call. */}
        <p className="text-[11px] uppercase tracking-wide text-slate-400">
          {whatIf === null ? (big ? '' : 'If they pay this') : 'If they paid this instead'}
        </p>
        {/* ONLY WHERE IT IS CRAMPED. Inside the dialog there is nothing bigger to open. */}
        {!big && (
          <button type="button" onClick={() => setBig(true)}
            title="Open the simulation where there is room to read it"
            className="shrink-0 inline-flex items-center gap-1 text-[11px] text-slate-400
              hover:text-slate-700">
            <Maximize2 size={11} /> Bigger
          </button>
        )}
      </div>
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
      {/*
        AND IT NOW SAYS WHY, which is the difference between a fact and an answer.
        ----------------------------------------------------------------------
        THE FIRM, reading this exact line on a freshly handed-over account: "it says that interest
        is not running. Why is interest not running? It should be running. So I'm sure that these
        calculations are incorrect."

        THE CALCULATION WAS RIGHT AND THE SENTENCE WAS USELESS. The account carried no rate -- the
        handover sheet stopped asking for one on the firm's own instruction, "the rate is in the
        agreement the firm already holds", and until now nothing in Raptor held that agreement's
        rate -- so every imported account opened at 0% and this line reported it correctly and
        inexplicably. A sentence that states a surprising fact without its cause reads as a bug in
        the arithmetic, and the firm read it as exactly that.

        THE RATE AND THE ACCRUAL ARE DIFFERENT ABSENCES. A rate of nought is a mandate that charges
        no interest, or one nobody has recorded; a rate with nothing to accrue from is an account
        whose interest has not started. Only the first is somebody's to fix, so only the first says
        where.
      */}
      {!plan.interestRunning && (
        <p className="mt-1.5 text-[11px] text-slate-500">
          {(account.interestRateAnnual ?? 0) > 0
            ? 'No interest is running on this account, so none is included above.'
            : 'This account is at 0% a year, so no interest is included above. The rate comes from '
              + 'the client’s mandate — set it on the client, and accounts opened after that '
              + 'inherit it.'}
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
          {/*
            AND IT SCROLLS RATHER THAN COLLIDES, which is what the firm was actually looking at:
            "R 50,00R 1 608,60" in one cell, because four columns of rand amounts do not fit in a
            two-hundred-and-fifty pixel rail and a table with no minimum simply overlaps them. A
            figure touching the figure beside it is not a cramped table, it is a wrong number.

            THE MINIMUM IS ON THE TABLE AND THE SCROLL ON ITS BOX -- the other way round does
            nothing, because a table with no width of its own shrinks to whatever it is given and
            never overflows anything. In the dialog there is room and neither applies.
          */}
          <div className="overflow-x-auto">
          <table aria-label="What paying it off faster would cost"
            className={`mt-1 w-full tabular-nums ${big ? 'text-xs min-w-0' : 'text-[11px] min-w-[17rem]'}`}>
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
                  {/* THE COUNT ON THEIR OWN ROW TOO -- see repaymentLetter, which carries the
                      argument. The collector is reading off the same page the debtor is sent, so a
                      number the PDF states and the panel does not is the one thing that cannot
                      differ between them. */}
                  <td className={`text-left ${o.theirs ? 'font-medium' : ''}`}>
                    {o.theirs
                      ? `Their offer (${o.instalments})`
                      : (o.instalments === 1 ? 'Settle now' : o.instalments)}
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
        </div>
      )}

      {/* AND THE WORKING, because a debtor is entitled to ask how the figure was arrived at and a
          collector should not have to say "the system worked it out". */}
      {plan.rows.length > 0 && (
        <div className="mt-2 border-t border-slate-200 pt-2">
          {/* Five columns here rather than four, so the floor is wider. Same reasoning as above. */}
          <div className="overflow-x-auto">
          <table aria-label="Every payment of this arrangement"
            className={`w-full tabular-nums ${big ? 'text-xs min-w-0' : 'text-[11px] min-w-[21rem]'}`}>
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
          </div>
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
          {/*
            TWO WAYS OUT OF THIS PANEL, AND THE FIRM ASKED FOR THE SECOND: "if you click on that, it
            sends it to the debtor as an email and it charges it as well."

            EMAIL FIRST, because it is the one they will press. The download is what a collector
            uses to read the page before they send it, or to give it to somebody over a counter.

            BOTH REFUSED FOR THE SAME REASON AND AT THE SAME MOMENT. A simulation that never
            settles the account is not a document to download OR to send, and a button offered and
            then refused is worse than one that is not there.
          */}
          <div className="flex flex-wrap items-center gap-1.5">
            {onEmail && (
              <button type="button" onClick={() => { void emailIt() }} disabled={sending || saving || refusal !== null}
                title={refusal ?? 'Opens an email to the debtor with the simulation attached'}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
                  refusal !== null
                    ? 'cursor-not-allowed border-dashed border-slate-200 text-slate-300'
                    : 'border-[#c9a052] bg-navy-950 text-white hover:bg-navy-900'}`}>
                {sending ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />}
                Email the simulation
              </button>
            )}
            <button type="button" onClick={() => { void download() }} disabled={saving || sending || refusal !== null}
              title={refusal ?? 'A PDF on the firm’s letterhead, to send the debtor'}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
                refusal !== null
                  ? 'cursor-not-allowed border-dashed border-slate-200 text-slate-300'
                  : 'border-[#c9a052] bg-white text-navy-950 hover:bg-gold-100'}`}>
              {saving ? <Loader2 size={11} className="animate-spin" /> : <FileDown size={11} />}
              Download it
            </button>
          </div>
          {/* WHAT THE PRESS COSTS, SAID BEFORE IT. Every other place in Raptor that raises an
              Annexure B fee says so on the control, because a collector deciding whether to send
              something is deciding whether to charge a debtor for it. */}
          {onEmail && refusal === null && (
            <p className="mt-1 text-[11px] leading-snug text-slate-500">
              The email is charged R25 under item 1(a), like any other. Nothing is sent until you
              press Send.
            </p>
          )}
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
    </>
  )

  /*
   * THE DIALOG IS WIDE BECAUSE THE TABLES ARE WIDE, and 820 is what the schedule's five columns
   * need before anything wraps. The panel keeps its place in the rail underneath -- a modal over a
   * gap where the card was reads as the card having been destroyed.
   */
  if (big) {
    return (
      <Modal title="If they pay this" width={820} onClose={() => setBig(false)}
        subtitle="The same figures as the panel, with room to read them.">
        {body}
      </Modal>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
      {body}
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
