import { supabase } from './supabase'
import type { HoldReason } from './accountBooks.ts'

/**
 * MOVING AN ACCOUNT BETWEEN BOOKS.
 *
 * Both of these are database functions rather than updates from here, for the reason every other
 * money-or-mandate action in Raptor is: the guard has to be somewhere a browser cannot skip.
 * `hold_account` and `release_account` ask `book.freeze` -- the same tick as a freeze, because it
 * is the same decision -- and `has_capability` is never NULL, so they fail CLOSED with no session.
 *
 * NEITHER WRITES THE HISTORY. `account_status_events` is filled by a TRIGGER on the account row,
 * which is what makes it complete: an import, a bulk action or a fix applied in SQL at half past
 * eleven all record themselves. Application code that wrote those rows would lose history every
 * time a path forgot to.
 */

/** How many running workflows were paused. The screen says so, because a paused sequence is news. */
export async function holdAccount(input: {
  accountId: string
  reason: HoldReason
  reviewOn: string
  note: string
}): Promise<number> {
  const { data, error } = await supabase.rpc('hold_account', {
    p_account: input.accountId,
    p_reason: input.reason,
    p_review_on: input.reviewOn,
    p_note: input.note,
  })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

/**
 * Back onto the active book, from On hold OR from Closed.
 *
 * ONE FUNCTION FOR BOTH DOORS. An account reaches the far side of Active three ways -- a hold the
 * firm placed, the Frozen status it was imported with, and a closure -- and a release that cleared
 * one and not the others would leave the account exactly where it was with its reason gone, which
 * is worse than refusing.
 */
export async function releaseAccount(accountId: string, note: string): Promise<number> {
  const { data, error } = await supabase.rpc('release_account', {
    p_account: accountId, p_note: note,
  })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}
