import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../auth.js'
import { claimSync, releaseSync, syncConnection, type EmailConnectionRow } from '../emailSync.js'

/*
 * NOTHING IS PRUNED. Mail stays until somebody deals with it.
 *
 * There was a 30-day sweep of unmatched mail here, and the firm removed it: an email is either
 * matched to a record or it is junk to be blocked, and deleting one on a timer only means the
 * message quietly disappears before anyone gets to it. "If it doesn't work, it'll anyway be
 * deleted" — by a person, deliberately.
 *
 * THE COST, measured rather than guessed. A row averages 459 bytes and carries about 1.8x that
 * again in indexes, so ~826 bytes all told. At the firm's own 3 750 messages a day that is about
 * 3 MB a day and 1.1 GB a year, against roughly 89 MB steady-state under the old sweep. Which
 * puts Supabase's 500 MB free tier about five to six months out; on Pro's 8 GB it is years.
 *
 * Bodies are still not stored — only a ~150-character snippet — so this grows linearly and
 * slowly. If it ever needs bounding again, the honest lever is a much longer window (a year, or
 * two), not thirty days.
 */

/**
 * HOW LONG A PERSON'S PRESS MAY RUN BEFORE IT STOPS AND SAYS SO.
 *
 * The cron has all night and takes none of this. A person pressing a button does not, and the
 * failure without a budget is the worst kind: Vercel kills the function partway, the browser gets
 * nothing back, and the mailboxes that WERE synced are invisible because the response never
 * arrived. With a budget the run stops itself, answers, and says how many are left to do.
 *
 * FIFTY SECONDS against Vercel's sixty, leaving room to write the answer. This is one of the
 * numbers that stops mattering on Pro -- the firm: "eventually we will move over to Vercel Pro
 * when we launch" -- where the cap is five minutes and this route can simply be given a longer
 * one. Until then, pressing it twice finishes the job.
 */
const PRESS_BUDGET_MS = 50_000

/**
 * DON'T RE-OPEN A MAILBOX SOMEBODY JUST DID.
 *
 * Two minutes is long enough that a second press seconds later costs nothing and short enough
 * that a person waiting on a reply is never told to come back later. `claimSync` already refuses
 * two syncs of ONE mailbox inside sixty seconds; this is about not walking eighteen folders of a
 * mailbox that was read a moment ago.
 */
const RECENT_MS = 2 * 60_000

/**
 * AND THE SWEEP SKIPS ONE TOO, WHICH IT DID NOT USED TO.
 *
 * It ran ONCE A NIGHT, and a nightly run wants every mailbox whatever happened during the day --
 * that reasoning was right for a nightly run and inverts completely now that the sweep runs every
 * few minutes. The firm: "there's still possibilities that the company's got 50 people, so in 60
 * seconds it doesn't sync anything... you still have a loophole in your method." The answer to
 * that was minutes rather than days, and the cost of minutes is arithmetic: fifty mailboxes,
 * eighteen folders each, every five minutes is fourteen thousand mailbox opens a day against a
 * mail server that counts them.
 *
 * SO A MAILBOX IS OPENED ABOUT ONCE A CYCLE AND NOT MORE. Four minutes against a five-minute
 * schedule: a mailbox read by the person sitting in front of it, or by the previous sweep, is
 * passed over by the next one and picked up by the one after. Shorter than the cycle on purpose,
 * because a run that starts a little late must not skip the whole round.
 */
const SWEEP_RECENT_MS = 4 * 60_000

/**
 * EVERY MAILBOX IN THE FIRM, AND NOW TWO THINGS CAN ASK FOR IT.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on its own requests, which is what this
 * used to check INSTEAD of a session -- so the only way the whole company's mail was ever read was
 * the nightly run at 05:00 UTC, and nothing a person could press.
 *
 * THE FIRM ASKED FOR THE OTHER DOOR: "give an option to sync your email address and to sync for
 * the whole company for now, just for in the interim." The case is exact and they described it
 * themselves: an account allocated to somebody sends from that person's address, the debtor
 * replies to it, and if that person is not signed in nothing pulls their mailbox until the morning.
 * A collector who can see the reply is sitting in a colleague's inbox should be able to fetch it
 * rather than wait a night.
 *
 * IT DISCLOSES NOTHING NEW. This writes mail into the database; who may READ a message is decided
 * by row-level security exactly as before, and a sync somebody else triggers shows them nothing
 * they could not already see. What it spends is IMAP connections, which is why the budget and the
 * recency skip are here and why `claimSync` still owns each mailbox one at a time.
 *
 * WHEN THE FIRM MOVES TO PRO this becomes a schedule rather than a button -- "when we go over to
 * Pro, it'll sync every couple of minutes" -- and the button can stay as the manual override it
 * is. Nothing here has to be undone for that; the cron simply runs more often.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = adminClient()
  if (!admin) {
    res.status(500).json({ error: 'Server is missing Supabase configuration.' })
    return
  }

  /*
   * THE CRON FIRST, because its request carries no session and must not be made to have one.
   *
   * `cronSecret &&` is kept exactly as it was: with no CRON_SECRET set, a cron request has no
   * bearer to check and is allowed through. That is deliberate for local and preview deployments
   * -- and it is also why a caller with no session at all still reaches the branch below, which
   * refuses it.
   */
  const cronSecret = process.env.CRON_SECRET
  const fromCron = !cronSecret || req.headers.authorization === `Bearer ${cronSecret}`
  let pressedBy: string | null = null
  if (!fromCron) {
    const caller = await requireCaller(req, admin)
    if (!caller) {
      res.status(401).json({ error: 'Invalid or expired session.' })
      return
    }
    pressedBy = caller.id
  }
  const pressed = !fromCron

  /*
   * THE STALEST MAILBOX FIRST, AND THIS IS A BUG FIX WITH A NAME ON IT.
   *
   * It was `select('*')` with no order, so the rows arrived in whatever order Postgres handed them
   * back -- which is stable in practice. Pair that with the budget below, and the mailboxes at the
   * tail of that order are skipped by EVERY press and by every cron run that hits Vercel's cap.
   * They do not sync late; they never sync at all.
   *
   * IT HAPPENED. The firm sent a section 129 from samuel@ and the debtor replied to it. Four days
   * later the reply still was not on the account, Raptor's own Emails tab said "0 received", and
   * the firm pressed sync on their own address and then on the whole company and nothing changed.
   * `samuel@` carried `last_sync_attempt_at = null` -- the sweep had never once opened it, while
   * four other mailboxes were read that same morning.
   *
   * OLDEST FIRST IS SELF-CORRECTING, which is why it is the right rule rather than merely a
   * better one: every run takes the mailbox that has gone longest unread, and finishing it moves
   * it to the back of the queue. A mailbox cannot be starved, however short the budget, because
   * going unread is exactly what promotes it. Nulls lead, because a mailbox that has never been
   * synced at all is the most overdue thing there is.
   */
  const { data: connections, error } = await admin.from('email_connections').select('*')
    .order('last_synced_at', { ascending: true, nullsFirst: true })
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const started = Date.now()
  const results: { userId: string; email?: string; logged?: number; error?: string; skipped?: boolean }[] = []
  /*
   * WHICH MAILBOXES THE BUDGET DID NOT REACH, BY ADDRESS.
   *
   * A count cannot be acted on. "2 left -- press again" is a spinner's worth of information; "not
   * reached: samuel@bredellferreira.co.za" is the sentence that would have ended the four days
   * above, because the person reading it knows which mailbox the reply they are waiting for is in.
   */
  const notReached: string[] = []
  let remaining = 0
  const all = (connections ?? []) as EmailConnectionRow[]
  for (const conn of all) {
    /*
     * OUT OF TIME. Everything already done is real and is reported; what is left is counted so the
     * person is told "9 of 15 -- press again" rather than watching a spinner die. The cron never
     * reaches this, because `pressed` is false for it.
     */
    if (pressed && Date.now() - started > PRESS_BUDGET_MS) {
      remaining += 1
      if (conn.email) notReached.push(conn.email)
      continue
    }
    /* Read a moment ago -- by somebody else's press, by the person whose mailbox it is, or by the
       sweep before this one. Nothing to gain and a connection to spend. */
    const freshFor = pressed ? RECENT_MS : SWEEP_RECENT_MS
    if (conn.last_synced_at
        && Date.now() - new Date(conn.last_synced_at).getTime() < freshFor) {
      results.push({ userId: conn.user_id, email: conn.email, skipped: true })
      continue
    }
    /*
     * THE CRON DEFERS TO A PERSON. If somebody has their mailbox open and Raptor is already
     * pulling it, the nightly run must not open a second connection to the same account — mail
     * servers cap those per account, and the collision slows down the person who is actually
     * sitting there. Skipping costs nothing: this mailbox was being synced anyway.
     */
    if (!(await claimSync(admin, conn.user_id))) {
      results.push({ userId: conn.user_id, email: conn.email, skipped: true })
      continue
    }
    /*
     * THE ATTEMPT IS RECORDED WHETHER IT WORKS OR NOT, and the reason is kept when it does not.
     *
     * This used to collect each failure into `results` and return 200, which meant a mailbox that
     * failed every night said nothing to anybody: one was connected on 24 September and had still
     * never been read four nightly runs later, and the only sign was a debtor's reply that never
     * arrived. `last_synced_at` alone cannot tell "never connected" from "nobody ran the job".
     */
    await admin.from('email_connections')
      .update({ last_sync_attempt_at: new Date().toISOString() })
      .eq('user_id', conn.user_id)
    try {
      const result = await syncConnection(admin, conn)
      /* Cleared on success, so it never describes a mailbox that has since recovered. */
      await admin.from('email_connections').update({ sync_error: null }).eq('user_id', conn.user_id)
      results.push({ userId: conn.user_id, email: conn.email, logged: result.logged })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed.'
      await admin.from('email_connections')
        .update({ sync_error: message.slice(0, 500) })
        .eq('user_id', conn.user_id)
      results.push({ userId: conn.user_id, email: conn.email, error: message })
    } finally {
      await releaseSync(admin, conn.user_id)
    }
  }

  /*
   * KNOWN LIMIT, recorded where somebody will find it.
   *
   * This loops every mailbox inside one request. At the firm's real volume — 50 agents taking
   * 50-100 messages a day — that is 50 IMAP handshakes and thousands of messages in a single
   * invocation, and it will hit Vercel's function duration cap and stop partway. Mailboxes that
   * were not reached simply sync next time, or when their owner opens Raptor (the Messages menu
   * syncs the signed-in agent's own mailbox on demand), so nothing is lost — but this route is
   * the wrong shape for that many mailboxes and needs to become one invocation per mailbox.
   *
   * WHAT CHANGED IS THAT A PRESS NOW STOPS ITSELF RATHER THAN BEING KILLED. PRESS_BUDGET_MS ends
   * the loop in time to answer, and `remaining` says how many were not reached — so the limit is
   * a sentence on the screen instead of a spinner that dies. The CRON still runs unbudgeted and
   * still hits the cap; that part is unchanged and still wants one invocation per mailbox.
   *
   * `results` shows how far it actually got, which is the evidence for when that matters.
   */
  /*
   * WHAT THE PERSON IS TOLD, in the shape the button needs: how many mailboxes were read, how much
   * came in, how many were skipped because somebody had just done them, how many failed, and how
   * many the budget did not reach.
   *
   * `results` still carries the per-mailbox detail for the cron's log and for an administrator
   * reading it, and it is the evidence for the known limit recorded above.
   */
  const logged = results.reduce((t, r) => t + (r.logged ?? 0), 0)
  const failed = results.filter((r) => r.error).length
  const skipped = results.filter((r) => r.skipped).length
  res.status(200).json({
    ok: true,
    syncedMailboxes: results.length,
    mailboxes: all.length,
    logged,
    failed,
    skipped,
    remaining,
    /* Named, not counted -- see notReached. */
    notReached,
    pressedBy,
    results,
  })
}
