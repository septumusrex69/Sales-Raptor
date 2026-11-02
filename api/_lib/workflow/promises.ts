import type { SupabaseClient } from '@supabase/supabase-js'
import { settlePromise, type SettlePayment, type SettlePromise } from '../../../src/lib/promiseSettle.js'

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

/* ---------------------------------------------------------------------------------------------
 * KEPT OR MISSED, EVERY MORNING (request #17, Raptor H16).
 *
 * The call centre opened forty accounts a day to press Kept or Payment missed. settlePromise
 * (src/lib/promiseSettle.ts) decides; this reads the rows and writes the answer, exactly as the
 * buttons would -- the same columns, so the same triggers fire: a kept instalment starts the
 * receipt, a miss starts the notice of default and its 48 hours, which expireDefaultedPromises
 * then ends as it always has. Nothing here sends anything itself.
 *
 * RUN BEFORE expireDefaultedPromises, so a payment that landed inside the 48 hours revives the
 * arrangement before the window is checked -- the firm's notice promises exactly that.
 *
 * EACH WRITE IS GUARDED ON WHAT WAS READ (status and due date). A clerk who pressed the button
 * between the read and the write has decided already, and their decision stands.
 * ------------------------------------------------------------------------------------------- */

export interface Settled { promiseId: string; accountId: string; action: 'keep' | 'miss' }

const rand = (n: number) => `R${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split(String.fromCharCode(0xa0)).join(' ')}`

export async function settleDuePromises(
  admin: SupabaseClient, accounts: string[] | undefined, today: string, now: Date = new Date(),
): Promise<Settled[]> {
  let query = admin
    .from('promises_to_pay')
    .select('id, account_id, status, amount, due_on, arrangement, day_of_month, on_last_day, day_of_week, instalments_kept, created_at, counted_after')
    .in('status', ['open', 'defaulted'])
    .order('due_on')
    .limit(500)
  if (accounts?.length) query = query.in('account_id', accounts)
  const { data, error } = await query
  if (error) throw new Error(error.message)

  const out: Settled[] = []
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const p: SettlePromise = {
      id: String(r.id), accountId: String(r.account_id), status: r.status === 'defaulted' ? 'defaulted' : 'open',
      amount: Number(r.amount), dueOn: String(r.due_on),
      arrangement: (r.arrangement as SettlePromise['arrangement']) ?? 'once_off',
      dayOfMonth: (r.day_of_month as number | null) ?? null, onLastDay: !!r.on_last_day,
      dayOfWeek: (r.day_of_week as number | null) ?? null, instalmentsKept: Number(r.instalments_kept ?? 0),
      createdAt: String(r.created_at), countedAfter: (r.counted_after as string | null) ?? null,
    }
    const { data: pays, error: payErr } = await admin
      .from('account_payments')
      .select('id, amount, received_at, approved_at, reversed_at, rejected_at')
      .eq('account_id', p.accountId)
      .gte('received_at', new Date(new Date(p.createdAt).getTime() - 86_400_000).toISOString())
    if (payErr) continue
    const payments: SettlePayment[] = ((pays ?? []) as Record<string, unknown>[]).map((x) => ({
      id: String(x.id), amount: Number(x.amount), receivedAt: String(x.received_at),
      approved: !!x.approved_at, undone: !!x.reversed_at || !!x.rejected_at,
    }))

    const s = settlePromise(p, payments, today)
    if (s.action === 'wait') continue

    let note: string
    let write: Record<string, unknown>
    if (s.action === 'keep') {
      write = s.finished
        ? { status: 'kept', resolved_at: now.toISOString(), resolved_by: null, payment_id: s.paymentId, counted_after: s.countedAfter,
            instalments_kept: p.instalmentsKept + s.instalments }
        /* An arrangement carries on: the count goes up and the due date moves -- keepInstalment's two columns.
           A defaulted one is put back to open by revive_promise_on_payment, on the count going up. */
        : { instalments_kept: p.instalmentsKept + s.instalments, due_on: s.nextDueOn, counted_after: s.countedAfter }
      note = s.finished
        ? `Raptor marked the promise to pay of ${rand(p.amount)} due ${p.dueOn} as kept: ${rand(s.paid)} approved since it was made.`
        : `Raptor marked ${s.instalments === 1 ? 'an instalment' : `${s.instalments} instalments`} of ${rand(p.amount)} as paid (${rand(s.paid)} approved). Next due ${s.nextDueOn}.`
    } else {
      write = { status: 'defaulted' }
      note = `Raptor marked the promise to pay of ${rand(p.amount)} due ${p.dueOn} as missed: ${s.seen > 0 ? `only ${rand(s.seen)}` : 'nothing'} received by ${s.graceEnded}, two working days after it was due.`
    }

    const { data: done, error: bad } = await admin
      .from('promises_to_pay')
      .update(write)
      .eq('id', p.id)
      .eq('status', p.status)
      .eq('due_on', p.dueOn)
      .select('id')
    if (bad || !done?.length) continue
    await admin.from('account_notes').insert({ account_id: p.accountId, body: note, source: 'system', author_name: 'Raptor' })
    out.push({ promiseId: p.id, accountId: p.accountId, action: s.action })
  }
  return out
}
