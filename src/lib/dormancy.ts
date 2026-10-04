/**
 * AN ACCOUNT NOBODY CAN FIND, AND THE TWO HONEST THINGS TO DO WITH IT.
 *
 * THE END OF A SPENT TRACE IS A DECISION, AND IT WAS NOWHERE. A collector who has worked a report
 * right through and reached nobody had three buttons -- work the ones that rang, upload a new
 * trace, or nothing -- and "nothing" is what happens on most of them: the account sits on a desk
 * at 500 to a book, consuming a diary slot every few weeks for a review nobody can do anything
 * with. That is the shape of the imported book's "5 accounts say Tracing and none has ever been
 * charged for a trace".
 *
 * TWO DECISIONS, AND THEY ARE NOT THE SAME ONE:
 *
 *   PARK IT. The firm's money has gone and the debtor cannot be found TODAY. People resurface --
 *   they take a job, open an account, apply for credit -- and a bureau report in six months is a
 *   different report. So the account is set aside with a date to come back on, and it comes back
 *   as a TRACE rather than as a review, because re-tracing is the work that is waiting.
 *
 *   ASK THE CLIENT TO WRITE IT OFF. Parking it again and again is the firm quietly carrying a
 *   file it cannot collect. The decision to stop is the CLIENT'S -- it is their money -- so this
 *   is a request, never something Raptor does on their behalf.
 *
 * NEITHER IS AUTOMATIC. Nothing here moves an account: both are sentences and both are offered.
 * An account parked by a rule is an account that left somebody's desk without anybody deciding,
 * and the collector who spent two rounds on it is the person most entitled to make the call.
 *
 * PURE: no database and no clock. The dates are passed in.
 */

/**
 * HOW A PARK IS RECORDED: A FIRM FREEZE WITH THE WAKE DATE IN ITS REASON.
 *
 * NO NEW COLUMN, AND THAT IS THE DESIGN. A freeze already does everything a park needs --
 * refuse_frozen_workflow stops every sequence in the database, the account reads as Frozen on the
 * firm's own ladder, and the freeze history records who did it and why. A `dormant_until` column
 * beside it would be a second state meaning almost the same thing, and the two would disagree the
 * first day somebody unfroze an account without clearing it.
 *
 * AND THE WAKE-UP IS A DIARY ENTRY, not a stored date anything has to sweep. The diary is what a
 * collector's day is read from; a date in a column needs a nightly job, and a night the job does
 * not run is a night the account is simply lost. Same reasoning as the diary's own carry-over.
 */
export const DORMANT_PREFIX = 'Dormant — traced out'

export function dormantFreezeReason(wakeOn: string, rounds: number): string {
  const many = rounds === 1 ? 'One trace was' : `${rounds} traces were`
  return `${DORMANT_PREFIX}. ${many} worked right through and none reached the debtor. `
    + `Set aside until ${wakeOn}, when it comes back to be traced again.`
}

/** Is this account parked rather than frozen for some other reason? Read off the freeze reason. */
export function isDormant(frozenReason: string | null | undefined): boolean {
  return (frozenReason ?? '').startsWith(DORMANT_PREFIX)
}

/**
 * HOW LONG A PARK LASTS, AND WHY SIX MONTHS.
 *
 * A BUREAU RECORD HAS TO HAVE CHANGED for a re-trace to be worth the client's money, and what
 * changes it is the debtor appearing somewhere: a new employer's payroll, a credit application, a
 * new address on a utility account. Six months is the shortest period over which that is likely
 * rather than possible -- a re-trace a month later buys the same report at the same price.
 *
 * NOT A SETTING, YET. The firm has not been asked, and a settings page full of numbers nobody
 * chose is worse than one honest default. It is a parameter so the screen can offer three months
 * and a year beside it, and so the day the firm says "make it four" it is one edit.
 */
export const DORMANT_MONTHS = 6

/** The day a parked account comes back, counted in whole months from the day it was parked. */
export function wakeDate(from: string, months = DORMANT_MONTHS): string {
  const d = new Date(`${from}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return from
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  /*
   * THE LAST DAY OF A SHORTER MONTH, NOT THE FIRST OF THE NEXT.
   *
   * 31 August plus six months is 28 February, not 3 March. Adding to the day directly is what
   * rolls over, which is why the month is moved first and the day clamped to what that month
   * actually has -- the same trap the instalment schedule carries a note about.
   */
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  return d.toISOString().slice(0, 10)
}

/**
 * WHY AN ACCOUNT CAN BE WRITTEN OFF, as a closed list.
 *
 * WRITTEN DOWN BECAUSE THE BOOK CARRIES FREE TEXT. `debtor_accounts.write_off_reason` arrived from
 * Swordfish as whatever somebody typed, and "what has this client written off and why" is a
 * question a free-text column cannot answer. These are the reasons the firm's own work produces.
 *
 * UNCONTACTABLE IS THE NEW ONE, and it is the reason this list exists: until now a file nobody
 * could find had no ending at all. It is NOT the same as "cannot pay" -- a pensioner who answers
 * the telephone is a different account from one whose every number is dead -- and it is not
 * "refusing to pay", which is a decision somebody made and told us.
 *
 * THE CLIENT DECIDES, ALWAYS. These are the reasons a REQUEST quotes; nothing here writes a
 * write-off onto an account.
 */
export const WRITE_OFF_REASONS = [
  'Uncontactable',
  'Cannot pay',
  'Deceased, no estate',
  'Sequestrated, no dividend',
  'Liquidated, no dividend',
  'Prescribed',
  'Disputed and conceded',
] as const

export type WriteOffReason = typeof WRITE_OFF_REASONS[number]

/**
 * THE REQUEST THE FIRM PUTS TO THE CLIENT, in the firm's own words.
 *
 * IT SAYS WHAT WAS SPENT AND WHAT IT BOUGHT. A client asked to write off a balance is entitled to
 * the account of the work: how many searches, what they came to, what else was tried. "We cannot
 * find this debtor, please write it off" with nothing behind it is the firm asking to be let off
 * a file, and a client is right to refuse it.
 *
 * AND IT DOES NOT ASK FOR A DECISION TODAY. The alternative to writing off is parking it, which
 * costs the client nothing, so the request offers both -- see dormantFreezeReason.
 */
export function uncontactableAsk(input: {
  rounds: number
  searches: number
  parkedUntil?: string | null
}): string {
  const r = input.rounds === 1 ? 'one trace' : `${input.rounds} traces`
  const s = input.searches === 1 ? 'one bureau search' : `${input.searches} bureau searches`
  const park = input.parkedUntil
    ? ` We have set the account aside until ${input.parkedUntil} and will trace it again then `
      + 'if you would rather we did not close it.'
    : ' We can set the account aside and trace it again in six months if you would rather we did '
      + 'not close it.'
  return 'We have been unable to reach this debtor. '
    + `${s.charAt(0).toUpperCase()}${s.slice(1)} ${input.searches === 1 ? 'has' : 'have'} been run `
    + `and ${r} ${input.rounds === 1 ? 'has' : 'have'} been worked right through — every number, `
    + 'email and linked person on the reports — without reaching them. '
    + 'We are asking for your instruction to write the balance off as uncontactable.'
    + park
}
