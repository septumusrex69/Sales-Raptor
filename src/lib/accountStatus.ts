/**
 * What an account's status means, in the one place that decides it.
 *
 * A written-off account is a closed book. The statement already knows this — it drops interest
 * and fees dated after the write-off — but nothing stopped the app RAISING one, so a trace on a
 * "Paid in Full" account charged R48, told the collector it had charged R48, and then never
 * appeared on the statement. Two parts of the app disagreeing about what an account is.
 *
 * The test lives here so they cannot drift apart again.
 */

/**
 * THE IMPORTED ANSWER, AND IT IS A STRING MATCH BECAUSE THAT IS WHAT THE DATA GIVES US.
 *
 * The book carries Swordfish's own statuses — "Written-off", "Active: Activated" — on every row
 * that came across in the import, and `IMPORTED HISTORY IS FROZEN AT WHAT WAS IMPORTED`: those
 * strings are the record and are not rewritten. So this still answers for them.
 *
 * IT IS NO LONGER THE WHOLE ANSWER. See `accountEnded` below.
 */
export function isWrittenOff(status: string | null | undefined): boolean {
  return /written.off/i.test(status ?? '')
}

/**
 * HAS THIS ACCOUNT ENDED, BY EITHER ROUTE.
 *
 * THE REAL COLUMN ARRIVED, which this file asked for by name: "worth replacing with a real column
 * when the status model is next touched." `ended_as` is that column — a fact the firm asserts,
 * carrying who said so and when, rather than a word inherited from another system.
 *
 * BOTH ARE CHECKED AND NEITHER REPLACES THE OTHER. An account Raptor closed has `ended_as` and
 * very likely still carries whatever Swordfish status it was imported with; an account written off
 * in Swordfish before the import has only the string. Reading one would miss half the book.
 *
 * AND A WITHDRAWAL COUNTS. The client took the file back — nothing more may be charged on it, no
 * notice may go out on it, and it is off the book exactly as surely as a write-off is. It is only
 * the REASON that differs, which is why `ended_as` records that separately.
 */
export function accountEnded(
  account: { endedAs?: string | null; status?: string | null } | null | undefined,
): boolean {
  if (!account) return false
  return !!account.endedAs || isWrittenOff(account.status)
}

/**
 * WHAT THE STATUS PILL SAYS: THE STATE, NOT HOW IT GOT THERE (S19; Stephan, 7 Nov, on the account banner:
 * "Active: Activated, what does that mean? ... it's a live account, it's not been archived?").
 *
 * Yes. The book carries Swordfish's five statuses, and the three Active ones differ only in history --
 * Activated (loaded live), Re-opened (closed, then opened again), Unfrozen (frozen, then restarted). That is
 * provenance baked into a label (accountFreeze.ts says the same), so the pill says "Active" and the history
 * moves to the hover. The stored status is untouched: imported history is frozen at what was imported.
 */
export function statusWord(status: string | null | undefined): { word: string; meaning: string } {
  const s = (status ?? '').trim()
  if (!s) return { word: '—', meaning: 'No status recorded' }
  if (isWrittenOff(s)) return { word: 'Written off', meaning: 'Closed: written off. Nothing more is charged on it.' }
  if (/^frozen$/i.test(s)) return { word: 'Frozen', meaning: 'On hold: no notices and no charges until it is unfrozen.' }
  const active = s.match(/^active\s*:\s*(.+)$/i)
  if (active || /^active$/i.test(s)) {
    const how = (active?.[1] ?? '').toLowerCase()
    const since = how === 'activated' ? 'live since it was loaded'
      : how === 're-opened' ? 'closed once, then opened again'
        : how === 'unfrozen' ? 'frozen once, then restarted'
          : null
    return { word: 'Active', meaning: `A live account, being worked${since ? ` (${since})` : ''}.` }
  }
  return { word: s, meaning: s }
}
