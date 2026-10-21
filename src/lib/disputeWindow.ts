/**
 * HOW LONG A DEBTOR HAS TO PUT A DISPUTE IN WRITING, AND WHICH DATE THAT IS.
 *
 * THE FIRM'S RULE, IN THEIR OWN WORDS: "Section 129 / letter of demand not yet sent: 10 business
 * days, and {{respond_by}} is today plus 10 business days. Already sent: the business days
 * remaining until that notice's own {{respond_by}}, and that same date is used. A debtor who
 * alleges a dispute on day 4 gets 6 business days, not a fresh 10. Floor of 5 business days. If
 * the notice period has already expired, the debtor still gets 5 business days and {{respond_by}}
 * is set accordingly for this message."
 *
 * THE POINT OF THE SECOND CASE IS THAT A DISPUTE MUST NOT RESET THE STATUTORY CLOCK. The section
 * 129 gives ten business days to respond; a debtor who telephones on day 4 and says "I dispute
 * this" has six of those left, and handing them a fresh ten would extend a period the Act fixed --
 * by the simple expedient of saying the word. Worse, it would put TWO dates in front of them: the
 * notice's and the dispute's, days apart, each headed "respond by". So one date is used and it is
 * the notice's.
 *
 * AND THE FLOOR IS THE FIRM BEING FAIR, NOT THE ACT BEING GENEROUS. A debtor who alleges a dispute
 * on day 9, or after the period has run out altogether, would otherwise be given one day or none
 * at all -- which is not a chance to do anything, and a letter saying "you had until yesterday"
 * invites the answer that they were never given time. Five business days, always, and the date
 * moves with it.
 *
 * Pure: no database, no clock of its own. Everything 'YYYY-MM-DD'.
 */
import { addWorkingDays, workingDaysBetween } from './workingDays.js'

/** The firm's own two numbers. Named because they appear in the letters as well as the code. */
export const DISPUTE_WINDOW_DAYS = 10
export const DISPUTE_WINDOW_FLOOR = 5

export interface DisputeWindow {
  /** How many business days the debtor has from today. Never fewer than the floor. */
  days: number
  /** The date those days run to, which is what {{respond_by}} merges as on a dispute message. */
  respondBy: string
  /**
   * WHY IT IS THIS LONG, for the collector rather than the debtor. Three readings, and they are
   * three different facts about the account rather than three wordings of one.
   */
  basis:
    /** No demand has gone out, so the dispute sets its own ten days. */
    | 'fresh'
    /** A demand is running and this is what is left of ITS period. */
    | 'notice'
    /** What was left was too little to be a chance, so the floor gave them five. */
    | 'floor'
}

/**
 * The window, given what the account already has running.
 *
 * `noticeRespondBy` is the date the SECTION 129 (or letter of demand) itself runs to -- null where
 * none has gone out. It is passed rather than looked up because this file touches no database and
 * because the caller is the one that knows which notice is the live one.
 */
export function disputeWindow(today: string, noticeRespondBy: string | null): DisputeWindow {
  /*
   * NOTHING SENT: the dispute sets its own clock, ten business days from today. `addWorkingDays`
   * counts from the day after today, so ten of them is ten clear days to act in.
   */
  if (!noticeRespondBy) {
    return { days: DISPUTE_WINDOW_DAYS, respondBy: addWorkingDays(today, DISPUTE_WINDOW_DAYS), basis: 'fresh' }
  }

  /*
   * A DEMAND IS RUNNING: what is left of ITS period, to ITS date. workingDaysBetween excludes
   * today and includes the end, which is the same count a debtor makes on a calendar -- day 4 of
   * ten leaves six, and the sixth of them is the day the notice runs to.
   */
  const left = workingDaysBetween(today, noticeRespondBy)
  if (left >= DISPUTE_WINDOW_FLOOR) {
    return { days: left, respondBy: noticeRespondBy, basis: 'notice' }
  }

  /*
   * TOO LITTLE LEFT TO BE A CHANCE, so the floor applies and the date moves with it. Both have to
   * move together: five days counted to a date three days away is a sentence that contradicts
   * itself on the page, and the debtor would be entitled to read whichever half suited them.
   */
  return {
    days: DISPUTE_WINDOW_FLOOR,
    respondBy: addWorkingDays(today, DISPUTE_WINDOW_FLOOR),
    basis: 'floor',
  }
}

/**
 * THE PHRASE THE TEMPLATES MERGE: "10 business days", "6 business days".
 *
 * A PHRASE RATHER THAN A NUMBER, because that is what the firm wrote into their own wording --
 * "You have {{dispute_days_left}}, that is by {{respond_by}}" -- and a field that merged a bare
 * "6" would leave the templates to supply the noun, which is how one of them ends up saying "6
 * business days days".
 *
 * SINGULAR WHERE IT WOULD BE WRONG, which the floor makes unreachable today and which costs one
 * line to get right for the day somebody lowers it.
 */
export function disputeDaysPhrase(days: number): string {
  const n = Math.max(0, Math.round(days))
  return `${n} business day${n === 1 ? '' : 's'}`
}

/**
 * WHETHER THE FIRST REMINDER IS WORTH SENDING AT ALL.
 *
 * THE FIRM: "skip the first reminder if the window is 3 business days or shorter." The stage A
 * reminder goes at half the window rounded down -- on a three-day window that is day 1, which
 * would chase a debtor for a document they were asked for yesterday.
 *
 * THE FLOOR MAKES THIS UNREACHABLE THROUGH disputeWindow, which never returns fewer than five. It
 * is kept because the rule is the firm's and the two numbers are set separately: lower the floor
 * to three and this is what stops the reminder going out the morning after the request.
 */
export function remindsAt(days: number): number | null {
  if (days <= 3) return null
  return Math.floor(days / 2)
}

/**
 * A NOTICE THAT HAS GONE OUT AND THE PERIOD IT GAVE THE DEBTOR.
 *
 * `deadlineDays` and `deadlineUnit` are the NODE's, not this file's: workflow_nodes separates "when
 * the step runs" from "the period this step gives the debtor" precisely so that the ten business
 * days of a section 129 are declared once, on the notice itself. Read from there rather than
 * assumed, a firm that revises its own chart to eleven days does not have to find this file too.
 */
export interface SentNotice {
  /** The day it actually went out, which is not the day it was due. */
  sentOn: string
  /** Null where the node declares no period, which is most steps: a reminder gives no deadline. */
  deadlineDays: number | null
  deadlineUnit: 'calendar' | 'business' | null
}

/**
 * THE DATE THE LIVE DEMAND RUNS TO, off the notices already sent on the account.
 *
 * THE LATEST OF THEM WINS, and that is the decision in this function. An account can carry a
 * section 129 sent on day 1 and a final notice sent on day 12, each with its own period; the clock
 * a debtor is actually running against is the one that ends last. Taking the FIRST would hand a
 * debtor who disputed after the final notice a window that closed weeks ago, and the floor would
 * then quietly give them five days -- a fair answer arrived at by ignoring the notice they are
 * holding.
 *
 * A PERIOD OF ZERO OR LESS IS NOT A PERIOD, and a step with no `deadlineDays` gave the debtor
 * nothing to respond within, so neither counts. Null where there is nothing to count, which is
 * what disputeWindow reads as "no demand has gone out" -- the ten-day case.
 *
 * NOT A DATABASE QUERY. The caller finds the account's sent steps; this decides what they mean.
 */
export function noticeRespondBy(notices: SentNotice[]): string | null {
  let latest: string | null = null
  for (const n of notices) {
    if (n.deadlineDays === null || n.deadlineDays <= 0) continue
    /* Business is the statutory clock and calendar is the debtor's. "20" means two different dates,
       and on a statutory period that is a notice to be served again -- so the unit is honoured and
       an absent one is read as business, which is what every notice in the firm's chart is. */
    const on = n.deadlineUnit === 'calendar'
      ? addCalendarDays(n.sentOn, n.deadlineDays)
      : addWorkingDays(n.sentOn, n.deadlineDays)
    if (latest === null || on > latest) latest = on
  }
  return latest
}

/* Local rather than imported: workingDays.ts is about the office's calendar and this is the
   debtor's, which does not stop on a Saturday. Written out so the two cannot be confused at the
   call site above. */
function addCalendarDays(from: string, days: number): string {
  const d = new Date(`${from}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
