/**
 * The segment counter, shared with the app.
 *
 * One implementation, because it decides what the debtor is charged: the compose box shows the
 * cost as you type and the server charges it, and those two disagreeing would be a bug nobody
 * notices until a statement is queried. Re-exported rather than copied — the app's tsconfig covers
 * `src` only, so the canonical file lives there and this reaches across.
 */
export * from '../../../src/lib/smsSegments.js'
