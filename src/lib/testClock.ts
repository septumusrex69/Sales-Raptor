/**
 * A TEST CLOCK: WALKING AN ACCOUNT THROUGH A SEQUENCE IN AN AFTERNOON.
 *
 * THE FIRM: "Can we start testing the workflows in real time, kind of... everything go out one
 * minute after the other... two minutes where everything happens. So it could switch between
 * workflows... and I will tick received or not received."
 *
 * WHY THIS MOVES THE ACCOUNT AND NOT THE ENGINE. A step's `due_on` is a DATE and the runner sends
 * everything where `due_on <= today`; there is no time of day anywhere in it. Making steps fire
 * minutes apart would mean giving every step a timestamp and rewriting planRun, landsOn, the
 * re-dating after a pause, the runner's comparison and every screen that shows a date -- rebuilding
 * the code that issues section 129s so that a test can run quickly. So the calendar stays exactly
 * as it is and the ACCOUNT is moved backwards under it: pull the next step onto today, run the
 * ordinary daily pass, and everything downstream happens for real.
 *
 * WHAT THAT DOES AND DOES NOT EXERCISE. It runs the real planner, the real ordering, the real
 * holds, the real "waits for you" gates, the real exit triggers, the real templates, the real
 * charges and the real messages. The one thing it does NOT exercise is the date arithmetic itself
 * -- which is the part already covered hard by check-working-days, check-workflow-start-day and
 * check-workflow-schedule, and the part a browser is worst at testing.
 *
 * THREE LOCKS, AND THEY ARE NOT THE SAME LOCK TWICE. This endpoint rewrites the dates on statutory
 * notices, so: the server refuses unless the database is STAGING; the server refuses unless the
 * account is a TEST account; and `workflow_test_advance` refuses a non-test account again in the
 * DATABASE, where no client can talk its way past it. The last is the one that matters -- the same
 * reasoning as the ledgers having no update policy.
 */

/** Staging. The only database a test clock may touch. See CLAUDE.md's environment table. */
export const STAGING_PROJECT_REF = 'kvkajxpremantdkhmjvb'

/**
 * The firm's test accounts, by the numbering they already use.
 *
 * A PREFIX RATHER THAN A FLAG COLUMN, deliberately: a column is something somebody can tick on a
 * real account by accident, and a debtor whose account number begins BF-TEST does not exist. The
 * same predicate is applied on the server, in the database and on the screen, so the button is
 * never offered where the endpoint would refuse it.
 */
export const TEST_ACCOUNT_PREFIX = 'BF-TEST'

export function isTestAccount(accountNumber: string | null | undefined): boolean {
  return typeof accountNumber === 'string' && accountNumber.startsWith(TEST_ACCOUNT_PREFIX)
}

/**
 * Is this Supabase URL the staging project?
 *
 * READ OFF THE HOST, not off a NODE_ENV or a branch name: what decides whether this is safe is
 * which DATABASE the deployment is pointed at, and a preview build of this branch pointed at
 * production would pass every other test anybody thought to write.
 */
export function isStagingDatabase(supabaseUrl: string | null | undefined): boolean {
  if (!supabaseUrl) return false
  try {
    return new URL(supabaseUrl).hostname.split('.')[0] === STAGING_PROJECT_REF
  } catch {
    /* Not a URL at all. Refuse rather than guess -- an unconfigured environment should refuse
       more, not less, which is the same way round as run.ts's CRON_SECRET. */
    return false
  }
}

const parse = (s: string) => new Date(`${s}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Days between two ISO dates, positive where `to` is later. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000)
}

/** An ISO date moved back by `days`. */
export function shiftBack(date: string, days: number): string {
  return iso(new Date(parse(date).getTime() - days * 86_400_000))
}

/**
 * HOW FAR TO JUMP SO THAT THE NEXT STEP FALLS DUE TODAY.
 *
 * ONE TICK IS ONE EVENT, which is the firm's choice: "to the next event" rather than one day at a
 * time, so a quiet gap between day 20 and day 39 of a section 129 costs nobody twenty minutes of
 * waiting. The gaps between the steps AFTER the next one are untouched, because every one of them
 * moves by the same number of days -- so the sequence keeps its real shape and only its starting
 * point moves.
 *
 * ZERO WHERE SOMETHING IS ALREADY DUE, and that is not a failure: it means the account has work
 * waiting that the pass will do without moving anything. The caller runs the pass either way.
 *
 * ZERO WHERE THERE IS NOTHING LEFT, which reads on the screen as "nothing further to advance to"
 * rather than as an error -- a sequence that has finished is the ordinary end of a test.
 */
export function daysToNextStep(today: string, dueDates: string[]): number {
  let soonest: string | null = null
  for (const d of dueDates) {
    if (d <= today) return 0
    if (!soonest || d < soonest) soonest = d
  }
  return soonest ? daysBetween(today, soonest) : 0
}
