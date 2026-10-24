import type { SupabaseClient } from '@supabase/supabase-js'
import { johannesburgDay } from '../../../src/lib/clock.js'
import {
  handoutLink, handoutReminderDue, handoutReminderMessage, handoutReminderRecipients, handoutTaskTitle,
} from '../../../src/lib/handoutReminder.js'

/**
 * THE MORNING'S REMINDER ABOUT BATCHES NOBODY HANDED OUT (S11) -- the rule is src/lib/handoutReminder.ts.
 *
 * Run by the 06:00 sweep only (never by the app's per-account nudge), after the workflow pass, and
 * NEVER FATAL: a reminder that could not be written is a line in the log, not a morning whose
 * section 129s did not go. Two things, in this order:
 *   1. CLOSE what is done. A reminder task whose batch has nobody left in the pile is completed, so
 *      the task list never tells a liaison to do what somebody already did.
 *   2. REMIND, once per batch (handovers.handout_reminded_at), the client's liaison and every
 *      Liaison Manager: a notification and a task each, both opening the batch's hand-out.
 * Written as the service role, so straight into notifications and tasks: notify_user needs a
 * signed-in caller, and at six in the morning there is nobody.
 */
export async function remindUnallocatedBatches(admin: SupabaseClient, today: string, now: Date) {
  const out = { closed: 0, reminded: 0, problems: [] as string[] }
  const nowIso = now.toISOString()

  /* 1. Close. */
  const { data: open, error: openError } = await admin.from('tasks').select('id, handover_id')
    .not('handover_id', 'is', null).in('status', ['Not Started', 'In Progress'])
  if (openError) out.problems.push(`open reminders: ${openError.message}`)
  for (const handoverId of new Set((open ?? []).map((t) => String(t.handover_id)))) {
    const { count } = await admin.from('debtor_accounts').select('id', { count: 'exact', head: true })
      .eq('handover_id', handoverId).is('assigned_to', null)
    if (count === 0) {
      const { data: done } = await admin.from('tasks').update({ status: 'Completed', completed_at: nowIso })
        .eq('handover_id', handoverId).in('status', ['Not Started', 'In Progress']).select('id')
      out.closed += done?.length ?? 0
    }
  }

  /* 2. Remind. The same fourteen days the Data Import warning reads, from the same function. */
  const { data: batches, error } = await admin.rpc('unallocated_batches', { p_days: 14 })
  if (error) { out.problems.push(`unallocated batches: ${error.message}`); return out }
  type Batch = { handover_id: string; reference: string | null; company_id: string | null; company_name: string | null; received_at: string; unallocated: number; total: number }
  const due = ((batches ?? []) as Batch[])
    .filter((b) => handoutReminderDue(johannesburgDay(new Date(b.received_at)), today))
  if (due.length === 0) return out

  const { data: stamped } = await admin.from('handovers').select('id, handout_reminded_at')
    .in('id', due.map((b) => b.handover_id))
  const already = new Set((stamped ?? []).filter((h) => h.handout_reminded_at).map((h) => String(h.id)))
  const { data: managers } = await admin.from('profiles').select('id').eq('role', 'Liaison Manager').neq('status', 'Inactive')
  const managerIds = (managers ?? []).map((m) => String(m.id))
  const dueDate = `${today}T16:00:00+02:00`

  for (const b of due.filter((x) => !already.has(x.handover_id))) {
    const { data: client } = b.company_id
      ? await admin.from('companies').select('account_owner_id').eq('id', b.company_id).maybeSingle()
      : { data: null }
    const to = handoutReminderRecipients((client?.account_owner_id as string | null) ?? null, managerIds)
    if (to.length === 0) { out.problems.push(`${b.reference ?? b.handover_id}: nobody to remind`); continue }
    const link = handoutLink(b.handover_id)
    const message = handoutReminderMessage(b.unallocated, b.total, b.company_name, b.reference)
    const { error: nErr } = await admin.from('notifications').insert(to.map((userId) => ({
      user_id: userId, type: 'handover.unallocated', message, link })))
    const { error: tErr } = await admin.from('tasks').insert(to.map((userId) => ({
      title: handoutTaskTitle(b.unallocated, b.company_name), type: 'Follow-up', status: 'Not Started', priority: 'High',
      owner_id: userId, due_date: dueDate, company_id: b.company_id, handover_id: b.handover_id,
      related_to_label: b.reference ?? null })))
    if (nErr || tErr) { out.problems.push(`${b.reference ?? b.handover_id}: ${(nErr ?? tErr)?.message}`); continue }
    /* Stamped only once both went in, so a failed morning is tried again tomorrow. */
    await admin.from('handovers').update({ handout_reminded_at: nowIso }).eq('id', b.handover_id)
    out.reminded += 1
  }
  return out
}
