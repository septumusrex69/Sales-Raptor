/**
 * A LOGIN CODE BY EMAIL WHEN AN ADMINISTRATOR SIGNS IN FROM A NEW DEVICE (S10, 21 Oct).
 *
 * Agreed with the firm after the authenticator-app version was removed at their word: "just
 * remove the two-factor sign-in ... I don't want to scan anything." Nothing is scanned here. An
 * Administrator on a browser Raptor has not seen for them is emailed six digits, types them once,
 * and that browser is remembered. Every other role is unaffected.
 *
 * THE RULES LIVE HERE, AS PURE FUNCTIONS, so the server that enforces them (api/_lib/email/
 * loginCode.ts) and the check that holds them (check-login-code) read one copy. Imported by the
 * API, so this file imports nothing.
 *
 * WHAT IT DOES AND DOES NOT STOP -- written down because a gate that is assumed to be stronger
 * than it is does more harm than one that is understood:
 *   - It stops somebody holding an Administrator's password from using RAPTOR on a new device
 *     without also holding that Administrator's mailbox. The app shows nothing until the code is
 *     typed, and the code is made, kept and checked on the server.
 *   - It does NOT stop a technical person with that password signing in against Supabase directly
 *     and using the session token with the API, never opening the app. The database grants an
 *     Administrator everything by role and does not know which browser a request came from.
 *     Putting a device check inside has_capability was weighed and left out: it sits under
 *     hundreds of policies and functions, and a guard that misfires there locks every
 *     Administrator out of the book at once. The real fix for that half is a strong, unshared
 *     password -- and, if the firm ever wants it, Supabase's own second factor at the token level.
 */

/** Only this role is asked. The firm agreed it for Administrators; nobody else sees a code. */
export function needsDeviceCode(role: string | null | undefined): boolean {
  return role === 'Administrator'
}

/** How long a code is good for. The email says the same number -- it reads this. */
export const CODE_TTL_MINUTES = 10
/** Wrong guesses before the code is spent and a new one has to be sent. Six digits, five tries. */
export const MAX_ATTEMPTS = 5
/** The wait between sends, so a stuck button cannot flood somebody's inbox. */
export const RESEND_SECONDS = 60
/** And the ceiling in a rolling hour, so a script cannot either. */
export const MAX_SENDS_PER_HOUR = 5
/** How long another Administrator's "let them in" lasts. Mirrored in login_code_waive. */
export const WAIVER_MINUTES = 30

/** A device id: 32 random bytes as lower-case hex. Anything else is refused before it is hashed. */
export function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/**
 * WHAT WAS TYPED, AS SIX DIGITS OR NOTHING. An iPad pastes "123 456" out of the mail app, and
 * somebody reading it aloud types "123-456"; both are the code. Letters are not.
 */
export function normaliseCode(typed: unknown): string | null {
  if (typeof typed !== 'string') return null
  const digits = typed.replace(/[\s-]/g, '')
  return /^\d{6}$/.test(digits) ? digits : null
}

export interface SendHistory {
  sentAt: string
  windowStartedAt: string
  sendsInWindow: number
}

export type ResendDecision =
  | { ok: true; windowStartedAt: string; sendsInWindow: number }
  | { ok: false; waitSeconds: number; reason: string }

/**
 * MAY ANOTHER CODE GO NOW? A minute between sends and five in a rolling hour. The window restarts
 * once an hour has passed since it opened, rather than sliding per send, so the arithmetic fits
 * in two columns.
 */
export function resendDecision(last: SendHistory | null, nowMs: number): ResendDecision {
  const now = new Date(nowMs).toISOString()
  if (!last) return { ok: true, windowStartedAt: now, sendsInWindow: 1 }
  const sinceSend = (nowMs - Date.parse(last.sentAt)) / 1000
  if (sinceSend < RESEND_SECONDS) {
    const wait = Math.ceil(RESEND_SECONDS - sinceSend)
    return { ok: false, waitSeconds: wait, reason: `A code was sent a moment ago. You can ask for another in ${wait} seconds.` }
  }
  const windowAge = (nowMs - Date.parse(last.windowStartedAt)) / 1000
  if (windowAge >= 3600) return { ok: true, windowStartedAt: now, sendsInWindow: 1 }
  if (last.sendsInWindow >= MAX_SENDS_PER_HOUR) {
    const wait = Math.ceil(3600 - windowAge)
    return { ok: false, waitSeconds: wait, reason: `That is ${MAX_SENDS_PER_HOUR} codes this hour. Try again in ${Math.ceil(wait / 60)} minutes, or ask another Administrator to let you in.` }
  }
  return { ok: true, windowStartedAt: last.windowStartedAt, sendsInWindow: last.sendsInWindow + 1 }
}

export interface StoredCode {
  deviceHash: string
  expiresAt: string
  attempts: number
}

export type CodeCheck = 'none' | 'other-device' | 'expired' | 'used-up' | 'compare'

/**
 * WHETHER A TYPED CODE MAY EVEN BE COMPARED. In this order, and the order matters: a code sent
 * to one browser is refused on another before anything else is said about it, and a spent code
 * says so rather than "wrong", which would invite a sixth guess.
 */
export function codeCheck(stored: StoredCode | null, deviceHash: string, nowMs: number): CodeCheck {
  if (!stored) return 'none'
  if (stored.deviceHash !== deviceHash) return 'other-device'
  if (Date.parse(stored.expiresAt) <= nowMs) return 'expired'
  if (stored.attempts >= MAX_ATTEMPTS) return 'used-up'
  return 'compare'
}

/** What each refusal says on the code screen. Short; the button under it is the next step. */
export const CODE_CHECK_MESSAGE: Record<Exclude<CodeCheck, 'compare'>, string> = {
  none: 'There is no code waiting. Press "Send a new code".',
  'other-device': 'That code was sent for a different device. Press "Send a new code".',
  expired: `That code has expired (they last ${CODE_TTL_MINUTES} minutes). Press "Send a new code".`,
  'used-up': 'Too many wrong tries. Press "Send a new code".',
}

/**
 * WHICH MAILBOX SENDS THE CODE, IN ORDER OF PREFERENCE.
 *
 * Raptor has no system mailbox -- every message it sends goes through a person's connected
 * mailbox (sendAsUser). The server holds those credentials, so a person's OWN mailbox works on a
 * brand-new device: nothing about the browser is involved. So:
 *   1. their own connected mailbox, to their own address;
 *   2. otherwise another active Administrator's, oldest name first so it is predictable --
 *      Barry has no mailbox connected on staging, and his code has to come from somewhere.
 * Never a non-Administrator's mailbox: a sign-in code for the people who can move trust money
 * does not go out through a collector's account.
 */
export function codeSenderOrder(
  callerId: string,
  admins: { id: string; name: string; hasMailbox: boolean; active: boolean }[],
): string[] {
  const usable = admins.filter((a) => a.hasMailbox && a.active)
  const own = usable.filter((a) => a.id === callerId).map((a) => a.id)
  const others = usable.filter((a) => a.id !== callerId)
    .sort((a, b) => a.name.localeCompare(b.name)).map((a) => a.id)
  return [...own, ...others]
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * THE EMAIL. From the firm, short: the code, that it expires in ten minutes, and who to tell.
 * "If this was not you, tell Stephan" is the firm's own instruction for who hears about it.
 *
 * The code is in the body and NOT the subject, so a lock screen showing the subject does not
 * show the code.
 */
export function loginCodeEmail(input: { name: string; code: string; device: string }): { subject: string; text: string; html: string } {
  const first = input.name.split(' ')[0] || input.name
  const subject = 'Your Raptor sign-in code'
  const lines = [
    `Hi ${first},`,
    `Your Raptor sign-in code is ${input.code}. It expires in ${CODE_TTL_MINUTES} minutes.`,
    `Somebody is signing in to Raptor as you on a device it has not seen before (${input.device}).`,
    'If this was not you, tell Stephan straight away.',
    'Bredell Ferreira',
  ]
  const html = [
    `${escapeHtml(lines[0])}`,
    `Your Raptor sign-in code is <b style="font-size:20px;letter-spacing:3px">${escapeHtml(input.code)}</b>. It expires in ${CODE_TTL_MINUTES} minutes.`,
    escapeHtml(lines[2]),
    `<b>${escapeHtml(lines[3])}</b>`,
    escapeHtml(lines[4]),
  ].join('<br><br>')
  return { subject, text: lines.join('\n\n'), html }
}

/**
 * "Safari on iPad", so a person removing a device can tell which one it was. A label, never a
 * credential -- the browser chooses what it says, so nothing is decided by it.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ''
  const device = /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua)) ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux'
    : 'a device'
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome'
    : /FxiOS|Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'a browser'
  return `${browser} on ${device}`.slice(0, 80)
}

/** "st••••@bredellferreira.co.za" -- enough to recognise the address on screen, not to harvest it. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at < 1) return email
  const local = email.slice(0, at)
  return `${local.slice(0, Math.min(2, local.length))}${'•'.repeat(4)}${email.slice(at)}`
}
