import type { Arrangement } from './arrangements.js'

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
  /** An instalment arrangement must settle the account within this long. */
  longestMonths: 24,
} as const

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
  if (p.arrangement === 'once_off') return null
  /* An instalment the size of the debt is a once-off settlement, not an instalment (promiseRules says the same). */
  if (p.amount >= money.settlement) return 'That pays everything at once. Choose "once-off" instead.'
  const months = monthsToSettle(p, money.settlement)
  if (months > PROPOSAL_RULES.longestMonths) {
    const per = p.arrangement === 'monthly' ? PROPOSAL_RULES.longestMonths : Math.floor((PROPOSAL_RULES.longestMonths * 52) / 12)
    const least = Math.ceil((money.settlement / per) * 100) / 100
    return `At ${rands(p.amount)} ${p.arrangement === 'monthly' ? 'a month' : 'a week'} it would take ${months} months to settle. `
      + `Online we can agree up to ${PROPOSAL_RULES.longestMonths} months: at least ${rands(least)} ${p.arrangement === 'monthly' ? 'a month' : 'a week'}. For anything else, please call us.`
  }
  return null
}

/** The offer in one line, as both the debtor and the collector read it. */
export function proposalSummary(p: ProposalInput, settlement: number): string {
  const day = (() => { const [y, m, d] = p.firstDueOn.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) })()
  if (p.arrangement === 'once_off') {
    const short = Math.round((settlement - p.amount) * 100) / 100
    return `${rands(p.amount)} once-off on ${day}${short > 0 ? `, leaving ${rands(short)} still to pay` : ''}`
  }
  const n = paymentsToSettle(p.amount, settlement)
  return `${rands(p.amount)} ${p.arrangement === 'monthly' ? 'a month' : 'a week'} from ${day}: about ${n} payment${n === 1 ? '' : 's'} to settle`
}
