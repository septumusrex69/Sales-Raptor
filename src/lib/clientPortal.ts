/**
 * THE CLIENT PORTAL'S RULES (S14, Raptor H13, 28 Oct).
 *
 * THE FIRM: clients see their own book, their reports and their tickets, hand accounts over and ask about
 * a debtor -- and it is included for them, not charged. This is phase 1: signing in, and the book.
 *
 * HOW A CLIENT SIGNS IN, AND WHY NOT LIKE STAFF. A client is never a Supabase user (see the client_portal
 * migration): too many policies read "anyone signed in". They type their email, are emailed six digits,
 * and the portal server (api/_lib/portal.ts) hands their browser a session token. No password to forget
 * or share, which is how a client's book ends up being read by somebody who left the client last year.
 *
 * WHAT THE CLIENT IS SHOWN -- the firm's own line, "limited transparency": one line per debtor, their
 * reference and ours, capital handed over, paid this month, paid to date, capital outstanding, and the
 * position in the firm's words. No notes, no call history, and CAPITAL rather than the balance, because
 * interest and fees are the firm's side of the debt.
 *
 * PURE, AND IMPORTS ONLY clientPosition (which imports nothing): the server imports this file.
 */
import { CLIENT_POSITIONS, clientPosition, type ClientPosition } from './clientPosition.js'

/** The same ten minutes and five tries as a staff sign-in code (loginCode.ts). */
export const PORTAL_CODE_MINUTES = 10
export const PORTAL_MAX_ATTEMPTS = 5
/**
 * A month signed in. A client looks at the portal when a report arrives, about once a month, and a code
 * every visit is a portal nobody opens; a session that never ends is one left open on a shared office PC.
 */
export const PORTAL_SESSION_DAYS = 30
/** The header the browser sends its session in. Not Authorization, which means a staff token everywhere else. */
export const PORTAL_TOKEN_HEADER = 'x-portal-token'

/** A typed address, as the one form it is stored and looked up in. Null when it is not one. */
export function normalisePortalEmail(typed: unknown): string | null {
  if (typeof typed !== 'string') return null
  const e = typed.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null
}

/** A session token: 32 random bytes as hex. Anything else is refused before it is hashed. */
export function isPortalToken(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/**
 * THE SAME ANSWER WHETHER OR NOT THE ADDRESS MAY SIGN IN. A sign-in box that says "we don't know that
 * address" is a way to find out which companies are the firm's clients, one guess at a time.
 */
export const CODE_SENT_MESSAGE = 'If that address may sign in, a code is on its way. It lasts 10 minutes.'

export type PortalCodeCheck = 'none' | 'expired' | 'used-up' | 'compare'

export function portalCodeCheck(stored: { expiresAt: string; attempts: number } | null, nowMs: number): PortalCodeCheck {
  if (!stored) return 'none'
  if (Date.parse(stored.expiresAt) <= nowMs) return 'expired'
  if (stored.attempts >= PORTAL_MAX_ATTEMPTS) return 'used-up'
  return 'compare'
}

export const PORTAL_CODE_MESSAGE: Record<Exclude<PortalCodeCheck, 'compare'>, string> = {
  /* 'none' reads like a wrong code on purpose: an address with no code waiting is also an address that
     may not sign in, and the two must not be told apart. */
  none: 'That code is not right. Check it, or ask for a new one.',
  expired: `That code has expired (they last ${PORTAL_CODE_MINUTES} minutes). Ask for a new one.`,
  'used-up': 'Too many wrong tries. Ask for a new one.',
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The code email. The code in the body, not the subject, so a lock screen does not show it. */
export function portalCodeEmail(input: { name: string; code: string }): { subject: string; html: string } {
  const first = input.name.trim().split(' ')[0] || 'there'
  return {
    subject: 'Your Bredell Ferreira client portal code',
    html: [
      `Hi ${escapeHtml(first)},`,
      `Your code is <b style="font-size:20px;letter-spacing:3px">${escapeHtml(input.code)}</b>. It expires in ${PORTAL_CODE_MINUTES} minutes.`,
      'If you did not ask for it, you can ignore this email: nobody can sign in without the code.',
      'Bredell Ferreira',
    ].join('<br><br>'),
  }
}

/** The invitation the liaison's Invite sends, from the liaison's own mailbox. */
export function portalInviteEmail(input: { name: string; clientName: string; url: string; from: string }): { subject: string; html: string } {
  const first = input.name.trim().split(' ')[0] || 'there'
  const url = escapeHtml(input.url)
  return {
    subject: `${input.clientName}: your Bredell Ferreira client portal`,
    html: [
      `Hi ${escapeHtml(first)},`,
      `You can now see ${escapeHtml(input.clientName)}'s accounts with us online: every debtor, what has been paid and where each one stands.`,
      `Open <a href="${url}">${url}</a> and type this email address. We email you a code each time you sign in; there is no password to remember.`,
      'The portal is included in our service at no charge.',
      `Kind regards<br>${escapeHtml(input.from)}<br>Bredell Ferreira`,
    ].join('<br><br>'),
  }
}

/** One debtor as portal_book returns it. */
export interface PortalBookRow {
  case_number: string | null
  account_number: string | null
  client_reference: string | null
  debtor: string
  client_name: string
  capital_handed_over: number
  capital_outstanding: number
  paid_this_month: number
  paid_to_date: number
  status: string | null
  sub_status: string | null
  bucket: string | null
  book: string | null
  ended_as: string | null
  disputed: boolean
}

/**
 * ONE LINE OF THE CLIENT'S BOOK, AS IT LEAVES THE SERVER. The status columns the position is read off
 * are DROPPED here: "Active: Unfrozen" is how a row got into a table, not an answer (CLAUDE.md), and a
 * column the browser receives is a column the client can read.
 */
export interface PortalLine {
  ourReference: string
  yourReference: string
  debtor: string
  /** The sub-account, where the client has several. */
  client: string
  capitalHandedOver: number
  paidThisMonth: number
  paidToDate: number
  capitalOutstanding: number
  position: ClientPosition
  positionLabel: string
}

export function portalLine(r: PortalBookRow): PortalLine {
  const position = clientPosition({
    closed: !(r.book === 'active' || r.book === 'on_hold') || !!r.ended_as,
    status: r.status, subStatus: r.sub_status, bucket: r.bucket,
    paidInPeriod: Number(r.paid_this_month) > 0,
    disputed: !!r.disputed,
  })
  return {
    ourReference: r.case_number ?? '',
    /* THEIR reference is the one on their own sheet: the client's filing first, then the account number
       the sheet carried (CLAUDE.md, "three numbers"). */
    yourReference: r.client_reference || r.account_number || '',
    debtor: r.debtor || '—',
    client: r.client_name,
    capitalHandedOver: Number(r.capital_handed_over) || 0,
    paidThisMonth: Number(r.paid_this_month) || 0,
    paidToDate: Number(r.paid_to_date) || 0,
    capitalOutstanding: Number(r.capital_outstanding) || 0,
    position,
    positionLabel: CLIENT_POSITIONS[position].label,
  }
}

/* ------------------------------------------------------------------ phase 2a: tickets, questions, callbacks */

/**
 * WHAT A CLIENT'S TICKET IS CALLED ON THE PORTAL (S15, Raptor · Handover 14). The client's words, not the
 * board's: the board says "Client data" to a liaison; the client is told what the firm is asking them.
 * Only the kinds portal_tickets returns are here -- 'help' and 'request' never reach a client.
 */
export type PortalTicketKind = 'dispute' | 'import' | 'litigation' | 'client'

export const PORTAL_TICKET_LABEL: Record<PortalTicketKind, string> = {
  dispute: 'The debtor disputes the account',
  import: 'Your handover needs correcting',
  litigation: 'We recommend legal action',
  client: 'Your question',
}

/** One ticket as portal_tickets returns it. */
export interface PortalTicket {
  ticketNo: number
  kind: PortalTicketKind
  status: 'open' | 'closed'
  stage: string
  description: string
  raisedAt: string
  closedAt: string | null
  caseNumber: string | null
  accountNumber: string | null
  clientReference: string | null
  debtor: string | null
  sheetReference: string | null
  lastMessageAt: string | null
  messages: number
}

export interface PortalMessage {
  direction: 'in' | 'out'
  subject: string | null
  body: string
  at: string
  from: string | null
  attachments: string[]
}

/**
 * WHOSE TURN IT IS, in a word the client can act on. Stage 'client' is the firm waiting on them; every
 * other open stage is the firm's side of the desk, which is all the client needs to know of it.
 */
export function portalTicketTurn(t: Pick<PortalTicket, 'status' | 'stage'>): 'yours' | 'ours' | 'closed' {
  if (t.status === 'closed') return 'closed'
  return t.stage === 'client' ? 'yours' : 'ours'
}

/** The longest message a client may send in one go. A page of text; a novel is a phone call. */
export const PORTAL_MESSAGE_MAX = 4000

/** A typed message as it is stored, or null when there is nothing in it. */
export function portalMessageText(typed: unknown): string | null {
  if (typeof typed !== 'string') return null
  const t = typed.replace(/\r\n/g, '\n').trim()
  return t ? t.slice(0, PORTAL_MESSAGE_MAX) : null
}

/** A ticket number typed or sent as "T-123", "123" or 123. */
export function portalTicketNo(value: unknown): number | null {
  const s = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim().replace(/^T-?/i, '') : ''
  return /^\d{1,12}$/.test(s) ? Number(s) : null
}

/**
 * WHEN A CLIENT ASKS TO BE CALLED. Free text for the time on purpose ("after two", "tomorrow morning"):
 * a liaison reads it, and a time picker would make the client pick a slot nobody promised to keep.
 * The number is checked only for being a number -- the liaison will ring it, not a machine.
 */
export function portalCallback(input: { phone?: unknown; when?: unknown; about?: unknown }):
  { ok: true; phone: string; when: string; about: string } | { ok: false; error: string } {
  const phone = typeof input.phone === 'string' ? input.phone.trim().slice(0, 40) : ''
  if (phone.replace(/\D/g, '').length < 9) return { ok: false, error: 'Type the number we should call.' }
  const when = typeof input.when === 'string' ? input.when.trim().slice(0, 120) : ''
  const about = portalMessageText(input.about) ?? ''
  return { ok: true, phone, when: when || 'Any time', about }
}
