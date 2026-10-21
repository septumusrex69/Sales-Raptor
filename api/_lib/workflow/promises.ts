import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * THE 48 HOURS RUNNING OUT.
 *
 * THE FIRM'S NOTICE OF DEFAULT PROMISES THE WINDOW IN THESE WORDS: "Payment of the missed
 * {{ptp_amount}} must reach our trust account within 48 hours of the date of this letter. If it
 * does, the arrangement continues on its existing terms and no further step is taken. If the 48
 * hours pass without payment, the hold on the account falls away for good."
 *
 * SO SOMETHING HAS TO END THEM, and it cannot be the database. A promise that falls into default
 * is `defaulted` and stays that way until either a payment revives it -- which is a trigger, and
 * built -- or the clock runs out, which is not an event anything writes a row for. The other half
 * of the firm's own sentence needs a thing that wakes up.
 *
 * IN THE MORNING SWEEP, WHICH ALREADY WAKES UP. It runs once a day for the whole book on the
 * cron, and for one account the moment the app nudges it. A job of its own would be a thirteenth
 * serverless function on a plan that allows twelve, and a second timer to notice had stopped.
 *
 * ONE DAY'S GRAIN ON A TWO-DAY WINDOW, WHICH IS HONEST IN THE RIGHT DIRECTION. A sweep at six in
 * the morning finds an arrangement that defaulted at four yesterday afternoon 38 hours old and
 * leaves it; it breaks the next morning at 62 hours. The debtor always gets AT LEAST the 48 hours
 * they were promised and sometimes a little more, which is the error to make -- the other way
 * round the firm resumes a section 129 against somebody whose window had not closed.
 *
 * IT WRITES `broken` AND NOTHING ELSE. workflow_resume_on_promise_broken is watching that column
 * and lets the paused sequence go; redateResumedRuns, further down the same sweep, then moves
 * whatever had not gone by the working days the hold lasted. Reaching in and resuming from here
 * would be a second copy of a rule that already exists in SQL.
 */
export interface Expired {
  promiseId: string
  accountId: string
}

/** Calendar hours, not working ones. The letter says "48 hours" to a debtor, and a debtor counts
    them off a wall clock -- reading it as working hours would quietly make it most of a week. */
const WINDOW_HOURS = 48

export async function expireDefaultedPromises(
  admin: SupabaseClient, accounts?: string[], now: Date = new Date(),
): Promise<Expired[]> {
  const cutoff = new Date(now.getTime() - WINDOW_HOURS * 3600_000).toISOString()

  let query = admin
    .from('promises_to_pay')
    .select('id, account_id')
    .eq('status', 'defaulted')
    /*
     * NULL IS NOT EXPIRED. `lt` excludes nulls in PostgREST, which is the behaviour wanted rather
     * than a quirk to work around: a defaulted promise with no defaulted_at has no window to have
     * run out of. The stamping trigger makes that impossible going forward, and a row that
     * predates it must not be broken on the strength of a column nobody set.
     */
    .lt('defaulted_at', cutoff)
    .limit(200)
  if (accounts?.length) query = query.in('account_id', accounts)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const out: Expired[] = []
  for (const row of (data ?? []) as { id: string; account_id: string }[]) {
    /*
     * ONE AT A TIME AND STILL GUARDED ON `defaulted`. A payment arriving between the read and the
     * write would have revived the arrangement, and a blind update would break it again -- the
     * exact case the whole window exists to protect. The filter makes the write a no-op there.
     */
    const { error: bad } = await admin
      .from('promises_to_pay')
      /* The firm's now (the staging clock's on staging), the same moment the window was measured to. */
      .update({ status: 'broken', resolved_at: now.toISOString() })
      .eq('id', row.id)
      .eq('status', 'defaulted')
    if (!bad) out.push({ promiseId: row.id, accountId: row.account_id })
  }
  return out
}
