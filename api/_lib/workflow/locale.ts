/**
 * THE FIRM'S DAY AND THE FIRM'S MONEY, on a server that is neither in their country nor their
 * currency.
 */

/**
 * Today, in Johannesburg, as a yyyy-mm-dd key.
 *
 * THE FUNCTION RUNS IN PARIS. vercel.json pins the region to cdg1, and South Africa is two hours
 * ahead of Paris in winter and one in summer -- so between 22:00 and midnight Paris time the two
 * disagree about what day it is. A cron at 06:00 UTC is nowhere near that boundary today, but a
 * runner whose correctness depends on nobody ever moving the schedule is a runner that breaks
 * silently the day somebody does, and the failure is a statutory notice going out a day early.
 *
 * `en-CA` because its short date format IS yyyy-mm-dd, which is the key shape used everywhere
 * else in this codebase. Not a coincidence worth relying on without saying so.
 */
export function todayInJohannesburg(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/**
 * Rand, the way the rest of Raptor writes it.
 *
 * NOTE WHAT en-ZA DOES: it groups thousands with a NON-BREAKING space. That is deliberate on a
 * letter -- it stops "R 180 000.00" breaking across two lines -- and it costs money in an SMS,
 * where U+00A0 is not in the GSM alphabet and one of them halves every segment. `planSend` strips
 * it for the SMS channel and only for that channel, which is why this does not strip it here.
 */
export function moneyZa(amount: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency', currency: 'ZAR', minimumFractionDigits: 2,
  }).format(amount)
}
