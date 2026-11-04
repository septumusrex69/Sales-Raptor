import type { Arrangement } from './arrangements.js'
import { addWorkingDays } from './workingDays.js'

/**
 * WHAT A DEBTOR MAY OFFER ON THE PORTAL (Raptor H16, part 3).
 *
 * Stephan, 2 Nov: "offer a promise to pay or instalments within rules you set; a collector approves it." These are
 * those rules, in one place, read by the debtor's page (to say no before they press Send), by the portal's server
 * (which says no again, because a page can be edited) and by the collector's card (which shows how the offer sits
 * against them). A collector can still accept anything the rules allow; the rules only say what may be ASKED online.
 * Anything outside them is a conversation, and the page says to call.
 *
 * THE NUMBERS ARE THE FIRM'S TO MOVE. They are named here, not scattered, so changing "24 months" is one line.
 */
export const PROPOSAL_RULES = {
  /** The first payment may be no further off than this. A promise for next quarter is not a promise. */
  firstPaymentWithinDays: 30,
  /**
   * AN OFFER THAT SETTLES WITHIN THIS LONG IS AN ORDINARY OFFER; ONE THAT TAKES LONGER IS AN APPLICATION.
   * Stephan, 3 Nov: "24 months is too much. Like 12 months. Anything more than 12 months needs like an application
   * ... we have a document for that. They can fill in online" -- the affordability assessment. Not a refusal: the
   * debtor still offers, fills the assessment in, and a collector decides once it is signed.
   */
  longestMonths: 12,
  /**
   * A ONCE-OFF PAYMENT SETTLES THE ACCOUNT, AND THE SETTLEMENT FIGURE HOLDS FOR FIVE WORKING DAYS (Stephan, 4 Nov):
   * "if you want to settle it within 5 business days, then that's fine. But if it's more than 5 business days,
   * there's going to be possible increases in fees and stuff." A later date is still accepted -- it becomes an
   * ordinary promise, and the promise-to-pay workflow sends the reminder two working days before and the notice on
   * the day -- but the page says the amount may have grown by then rather than quoting today's as if it would hold.
   */
  settlementHoldsWorkingDays: 5,
} as const

/** The last day today's settlement figure holds: five working days from the firm's today. */
export function settlementHoldsUntil(today: string): string {
  return addWorkingDays(today, PROPOSAL_RULES.settlementHoldsWorkingDays)
}

/** Does a once-off payment on `on` settle at today's figure? On or before settlementHoldsUntil. */
export function settlementHolds(on: string, today: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(on) && on <= settlementHoldsUntil(today)
}

/** Does this offer need the affordability assessment? Instalments that take longer than PROPOSAL_RULES.longestMonths. */
export function needsApplication(p: Pick<ProposalInput, 'arrangement' | 'amount'>, settlement: number): boolean {
  return p.arrangement !== 'once_off' && p.amount > 0 && monthsToSettle(p, settlement) > PROPOSAL_RULES.longestMonths
}

export interface ProposalInput { arrangement: Arrangement; amount: number; firstDueOn: string }

const DAY_MS = 86_400_000
const dayNumber = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY_MS }
/* The portal's own way of writing money ("R 1 500,00"), so the rule and the page beside it read alike. */
const rands = (n: number) => `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split(' ').join(' ')}`

/** How many payments of `amount` it takes to reach `settlement`. */
export function paymentsToSettle(amount: number, settlement: number): number {
  if (!(amount > 0)) return Infinity
  return Math.max(1, Math.ceil(Math.round(settlement * 100) / Math.round(amount * 100)))
}

/** How long that is, in months, for the rule. A week is 12/52 of a month, not a quarter of one. */
export function monthsToSettle(p: Pick<ProposalInput, 'arrangement' | 'amount'>, settlement: number): number {
  const n = paymentsToSettle(p.amount, settlement)
  if (p.arrangement === 'once_off') return 0
  return p.arrangement === 'monthly' ? n : Math.ceil((n * 12) / 52)
}

/**
 * WHY AN OFFER CANNOT BE MADE ONLINE, in words a debtor can act on -- or null. `balance` and `settlement` are the
 * portal's own figures (computeBalance on the server), and `today` the firm's day.
 */
export function proposalProblem(p: ProposalInput, money: { balance: number; settlement: number }, today: string): string | null {
  if (!['once_off', 'weekly', 'monthly'].includes(p.arrangement)) return 'Choose once-off, weekly or monthly.'
  if (!(p.amount > 0) || !Number.isFinite(p.amount)) return 'Type the amount you can pay.'
  if (money.balance <= 0) return 'There is nothing to pay on this account.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.firstDueOn)) return 'Choose the date of your first payment.'
  const ahead = dayNumber(p.firstDueOn) - dayNumber(today)
  if (ahead < 0) return 'The first payment cannot be in the past.'
  if (ahead > PROPOSAL_RULES.firstPaymentWithinDays) return `The first payment must be within ${PROPOSAL_RULES.firstPaymentWithinDays} days. For a later date, please call us.`
  /* A ONCE-OFF IS THE WHOLE SETTLEMENT (Stephan, 4 Nov: "it should show that the outstanding amount is due"). Part of
     it on one day is an instalment plan of one, which is a conversation -- weekly or monthly, or a call. */
  if (p.arrangement === 'once_off') return Math.round(p.amount * 100) < Math.round(money.settlement * 100)
    ? `A once-off payment settles the account: ${rands(money.settlement)}. To pay less now, choose weekly or monthly, or call us.`
    : null
  /* An instalment the size of the debt is a once-off settlement, not an instalment (promiseRules says the same). */
  if (p.amount >= money.settlement) return 'That pays everything at once. Choose "once-off" instead.'
  /* MORE THAN 12 MONTHS IS NOT A PROBLEM, IT IS AN APPLICATION -- see needsApplication and applicationNote. */
  return null
}

/**
 * WHAT THE DEBTOR IS TOLD WHEN THEIR OFFER IS AN APPLICATION -- before they send it, so filling in the assessment is
 * no surprise -- with the instalment that would keep it an ordinary offer, in case they can manage that instead.
 */
export function applicationNote(p: Pick<ProposalInput, 'arrangement' | 'amount'>, settlement: number): string {
  const months = monthsToSettle(p, settlement)
  const per = p.arrangement === 'monthly' ? PROPOSAL_RULES.longestMonths : Math.floor((PROPOSAL_RULES.longestMonths * 52) / 12)
  const least = Math.ceil((settlement / per) * 100) / 100
  const every = p.arrangement === 'monthly' ? 'a month' : 'a week'
  return `At ${rands(p.amount)} ${every} it would take ${months} months to settle. Anything longer than ${PROPOSAL_RULES.longestMonths} months is an application: `
    + `after you send it we will ask you to fill in a short form about your income and expenses (an affordability assessment). `
    + `At ${rands(least)} ${every} or more it is an ordinary offer and needs no form.`
}

/** The offer in one line, as both the debtor and the collector read it. */
export function proposalSummary(p: ProposalInput, settlement: number): string {
  const day = (() => { const [y, m, d] = p.firstDueOn.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) })()
  if (p.arrangement === 'once_off') return `${rands(p.amount)} on ${day}, settling the account in full`
  const n = paymentsToSettle(p.amount, settlement)
  return `${rands(p.amount)} ${p.arrangement === 'monthly' ? 'a month' : 'a week'} from ${day}: about ${n} payment${n === 1 ? '' : 's'} to settle`
}

/**
 * WHAT A ONCE-OFF SETTLEMENT ON `on` MEANS, as the debtor is told it before they send it (Stephan, 4 Nov). Within five
 * working days, today's figure is the figure. Later, it is a promise: the figure may grow, and the promise-to-pay
 * workflow reminds them two working days before and on the day. Stephan asked for a STATEMENT two days before; the
 * reminder quotes the promised amount and attaches nothing yet, so the page promises the reminders it sends and points
 * at this page, which always shows what settles it -- never a statement nobody sends (HANDOFF: open question).
 */
export function onceOffNote(on: string, today: string, settlement: number): string {
  const until = settlementHoldsUntil(today)
  const long = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) }
  return settlementHolds(on, today)
    ? `Pay ${rands(settlement)} by ${long(until)} and your account is settled in full.`
    : `${rands(settlement)} settles the account if it is paid by ${long(until)}. After that, interest and fees may add to it. We will remind you two working days before ${long(on)} and again on the day; this page always shows what settles it on the day.`
}
