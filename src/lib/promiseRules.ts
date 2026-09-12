/**
 * What a promise to pay is allowed to say, and what it costs.
 *
 * Pure, and kept out of accountPromises.ts for the same reason arrangements.ts is kept out of
 * accountWorkspace.ts: that file lives beside the Supabase client, and these are rules about
 * money that should be arguable without a browser or a database in front of you. The firm asked
 * for them after watching a collector take a promise for more than the account was worth.
 */
import { describeArrangement, type Arrangement } from './arrangements.ts'
/*
 * The same money the rest of the app writes. The first attempt hand-rolled it here and produced
 * "R1 500.00" with a full stop, while every other figure on the page reads "R 1 500,00" -- two
 * spellings of one amount on one screen. mockData is types and formatters only, no database, so
 * a pure module may import it.
 */
import { formatMoney } from '../data/mockData.ts'

/**
 * Item 5: "Settlement account drawn up and furnished at the debtor's request, other than the
 * six-monthly one." R50 excluding VAT under the 2026 schedule.
 *
 * Not a guess. The firm's own charging history maps its "Promise to Pay" action onto item 5 --
 * see TARIFF_HISTORY in actionTariff.ts, where promise_to_pay carries the item 5 rate in all
 * four schedules. Taking an arrangement means working out and furnishing what it takes to
 * settle, which is what item 5 pays for. It was simply never wired into the button, so every
 * arrangement taken in Raptor so far has been free.
 */
export const PROMISE_ITEM_ID = '5'

/** What the debtor reads on the statement. Not "promise to pay" -- that is our word for it. */
export const PROMISE_DESCRIPTION = 'Payment arrangement'

/**
 * The charge, as much of it as these rules need.
 *
 * Structural rather than importing ChargeResult, which lives next to the Supabase client.
 */
export interface ChargeOutcome {
  exclVat: number
  reason: 'charged' | 'written-off' | 'item-total-spent' | 'monthly-limit' | 'at-ceiling'
}

/**
 * The most a promise may be for.
 *
 * A once-off settlement is quoted at the settlement figure -- the balance PLUS the item 9 receipt
 * fee that settling in full attracts -- because that is the number that actually clears the
 * account. Quoting the bare balance takes a promise that leaves the debtor still owing the
 * receipt fee, which is how an account everybody believes is closed turns up open.
 *
 * An instalment is capped at the balance instead: a single instalment larger than the whole debt
 * is not an instalment. The firm's words -- "the monthly instalment or the weekly instalment
 * cannot be more than the actual outstanding balance".
 */
export function promiseCeiling(arrangement: Arrangement, balance: number, settlement: number): number {
  return arrangement === 'once_off' ? settlement : balance
}

/**
 * Why an amount cannot be taken, or null if it can.
 *
 * Returns the sentence rather than a boolean, because "no" without "why" on a form somebody is
 * filling in with a debtor on the phone is the worst of both.
 */
export function promiseProblem(
  arrangement: Arrangement,
  amount: number,
  balance: number,
  settlement: number,
): string | null {
  if (!(amount > 0)) return null
  // Questioned on the form, never refused here: a once-off above the settlement figure is
  // legitimate, since interest runs until the money actually arrives and a debtor may be
  // rounding up to cover it.
  if (arrangement === 'once_off') return null
  if (amount > promiseCeiling(arrangement, balance, settlement)) {
    return `That is more than the ${formatMoney(balance)} outstanding on the account. `
      + 'A single payment that size is a once-off settlement, not an instalment.'
  }
  return null
}

/**
 * What the timeline says happened.
 *
 * No fee named. Every charge is already its own entry on this timeline and its own line on
 * Transactions, and the firm had the fee sentence taken out of the notes for exactly that
 * reason: "it's on the transaction list."
 */
export function promiseNote(p: {
  amount: number
  arrangement: Arrangement
  dueOn: string
  dayOfMonth: number | null
  onLastDay: boolean
  dayOfWeek: number | null
}): string {
  const how = describeArrangement(p).toLowerCase()
  return `Payment arrangement taken — ${formatMoney(p.amount)} ${how}, first due ${p.dueOn}.`
}
