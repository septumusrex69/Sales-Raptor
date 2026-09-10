/**
 * What an account's status means, in the one place that decides it.
 *
 * A written-off account is a closed book. The statement already knows this — it drops interest
 * and fees dated after the write-off — but nothing stopped the app RAISING one, so a trace on a
 * "Paid in Full" account charged R48, told the collector it had charged R48, and then never
 * appeared on the statement. Two parts of the app disagreeing about what an account is.
 *
 * The test lives here so they cannot drift apart again. It is a string match because that is
 * what the data gives us: the book carries statuses like "Written-off" and "Active: Activated",
 * and there is no separate written_off_at column — the write-off DATE is inferred from the last
 * action. Worth replacing with a real column when the status model is next touched.
 */
export function isWrittenOff(status: string | null | undefined): boolean {
  return /written.off/i.test(status ?? '')
}
