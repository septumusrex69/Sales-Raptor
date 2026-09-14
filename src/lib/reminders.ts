import { supabase } from './supabase'
import { dueAt, SNOOZE_MINUTES } from './reminderTime.ts'

/**
 * Short reminders: "call me back in an hour".
 *
 * Reads and writes only. The arithmetic is in reminderTime.ts and the screen is in
 * components/reminders — this is the join between them.
 */
export interface Reminder {
  id: string
  accountId: string
  ownerId: string
  dueAt: string
  body: string
  state: 'waiting' | 'done' | 'cancelled'
  snoozes: number
  account: {
    accountNumber: string | null
    debtorFirstName: string | null
    debtorSurname: string | null
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped JSON from PostgREST. */
const toReminder = (r: any): Reminder => ({
  id: r.id,
  accountId: r.account_id,
  ownerId: r.owner_id,
  dueAt: r.due_at,
  body: r.body,
  state: r.state,
  snoozes: Number(r.snoozes ?? 0),
  account: {
    accountNumber: r.debtor_accounts?.account_number ?? null,
    debtorFirstName: r.debtor_accounts?.debtor_first_name ?? null,
    debtorSurname: r.debtor_accounts?.debtor_surname ?? null,
  },
})
/* eslint-enable @typescript-eslint/no-explicit-any */

// Named embed, for the reason ROW_SELECT in diary.ts is named: an ambiguous embed fails the
// whole request rather than dropping a field, and a watcher that silently stops watching is
// the worst failure this feature has.
const SELECT = `
  *,
  debtor_accounts!account_reminders_account_id_fkey (
    account_number, debtor_first_name, debtor_surname
  )
`

/** Who the reminder is about, as it should read in the popup. */
export function reminderWho(r: Reminder): string {
  const name = [r.account.debtorFirstName, r.account.debtorSurname].filter(Boolean).join(' ').trim()
  return name || r.account.accountNumber || 'this account'
}

export async function setReminder(input: {
  accountId: string
  ownerId: string
  minutes: number
  body: string
  /** An exact moment, where the person picked a clock time instead of a preset. */
  at?: Date
  createdBy: string | null
}): Promise<void> {
  const { error } = await supabase.from('account_reminders').insert({
    account_id: input.accountId,
    owner_id: input.ownerId,
    due_at: (input.at ?? dueAt(input.minutes)).toISOString(),
    body: input.body.trim() || 'Call back',
    created_by: input.createdBy,
  })
  if (error) throw new Error(error.message)
}

/**
 * Everything of mine that is due, oldest first.
 *
 * Asks for what is DUE rather than what is soon: a reminder whose moment passed while the tab
 * was closed still has to arrive, and arrive saying how late it is. Nothing expires on its own.
 */
export async function fetchDue(ownerId: string, now: Date = new Date()): Promise<Reminder[]> {
  const { data, error } = await supabase
    .from('account_reminders')
    .select(SELECT)
    .eq('owner_id', ownerId)
    .eq('state', 'waiting')
    .lte('due_at', now.toISOString())
    .order('due_at')
    .limit(20)
  if (error) throw new Error(error.message)
  return (data ?? []).map(toReminder)
}

/** Still to come, for the account's own panel. */
export async function fetchForAccount(accountId: string): Promise<Reminder[]> {
  const { data, error } = await supabase
    .from('account_reminders')
    .select(SELECT)
    .eq('account_id', accountId)
    .eq('state', 'waiting')
    .order('due_at')
  if (error) throw new Error(error.message)
  return (data ?? []).map(toReminder)
}

/** Done — the person confirmed they did the thing. */
export async function completeReminder(id: string): Promise<void> {
  const { error } = await supabase.from('account_reminders')
    .update({ state: 'done', done_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Push it back.
 *
 * The count goes up as well as the time, because a reminder snoozed nine times is worth being
 * able to see. Without it, "I keep meaning to ring them" leaves no trace at all.
 */
export async function snoozeReminder(id: string, snoozes: number, minutes = SNOOZE_MINUTES): Promise<void> {
  const { error } = await supabase.from('account_reminders')
    .update({ due_at: dueAt(minutes).toISOString(), snoozes: snoozes + 1 })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/** Called off before it came round. */
export async function cancelReminder(id: string): Promise<void> {
  const { error } = await supabase.from('account_reminders').update({ state: 'cancelled' }).eq('id', id)
  if (error) throw new Error(error.message)
}
