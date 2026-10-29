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
 * PURE, AND IMPORTS ONLY clientPosition and handoverSheet (which import nothing): the server imports this file.
 */
import { CLIENT_POSITIONS, clientPosition, type ClientPosition } from './clientPosition.js'
import { HANDOVER_COLUMNS } from './handoverSheet.js'

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

/*
 * A PASSWORD, AFTER THE FIRST CODE (S16, Raptor · Handover 15). Stephan: "Maybe the first time [a code], but ...
 * if you have a password, then that's fine" -- and then, still being emailed codes: "Shouldn't be like that."
 * The code proves the address once and stays as the reset; every other visit is the address and a password.
 * Length is the rule, not a recipe of symbols -- a long phrase a person remembers beats "P@ssw0rd!" -- and the
 * address itself is refused, being the first guess anybody makes.
 */
export const PORTAL_PASSWORD_MIN = 8
export const PORTAL_PASSWORD_FAILURES = 5
export const PORTAL_PASSWORD_LOCK_MINUTES = 15
/** The same answer for an unknown address, a login with no password yet and a wrong password. */
export const PORTAL_PASSWORD_WRONG = 'That email address and password do not match. Forgot it, or first time here? Email yourself a code.'

/** Why a chosen password will not do, in words for the client; null when it will. */
export function portalPasswordProblem(password: unknown, email: string | null): string | null {
  if (typeof password !== 'string' || password.length < PORTAL_PASSWORD_MIN) return `Use at least ${PORTAL_PASSWORD_MIN} characters.`
  if (password.length > 200) return 'That is longer than a password needs to be.'
  if (/^(.)\1*$/.test(password)) return 'Use more than one character, repeated.'
  if (email && password.trim().toLowerCase() === email.toLowerCase()) return 'Use something other than your email address.'
  return null
}

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

/*
 * THE PORTAL'S EMAILS, DRAWN LIKE THE REMITTANCE ADVICE (S16, Raptor · Handover 15). Stephan: "make it look
 * nicer ... the link should be like a thing, like press here", and "don't say anything about ... at no
 * charge". One layout for both: a navy band with the firm's name in tracked gold capitals (TEXT, not a
 * picture -- a mail client that blocks images still shows who it is from), the message, the code in a box
 * of its own where there is one, and a gold BUTTON to the portal. Tables and inline styles only, because
 * that is all Outlook draws; the button is a padded link inside a cell, which every client draws alike.
 * The face is the firm's (CHARTER_EMAIL_STACK in emailStyle.ts, written out here because the server imports
 * this file and it imports nothing).
 */
const MAIL_FONT = "Charter, 'Bitstream Charter', Georgia, 'Times New Roman', serif"

export function portalEmailHtml(input: { lines: string[]; code?: string; codeNote?: string; button?: { url: string; label: string }; signOff: string }): string {
  const p = (html: string) => `<p style="margin:0 0 16px;font-family:${MAIL_FONT};font-size:16px;line-height:1.55;color:#1B2B3E">${html}</p>`
  const code = input.code ? `
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr>
          <td style="background:#F2F5F8;border:1px solid #D5DBE3;border-radius:10px;padding:16px 28px;font-family:Consolas,'Courier New',monospace;font-size:30px;font-weight:bold;letter-spacing:8px;color:#111E2D">${escapeHtml(input.code)}</td>
        </tr></table>${input.codeNote ? p(`<span style="color:#5A6B80;font-size:14px">${input.codeNote}</span>`) : ''}` : ''
  const button = input.button ? `
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr>
          <td style="background:#C69F54;border-radius:8px">
            <a href="${escapeHtml(input.button.url)}" style="display:inline-block;padding:13px 26px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#111E2D;text-decoration:none">${escapeHtml(input.button.label)} &rarr;</a>
          </td>
        </tr></table>` : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F5F8;padding:24px 0"><tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border:1px solid #D5DBE3;border-radius:12px;overflow:hidden">
    <tr><td style="background:#111E2D;padding:22px 32px;border-bottom:3px solid #C69F54">
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:4px;font-weight:bold;color:#C69F54">BREDELL FERREIRA</div>
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;color:#AEBBCB;margin-top:4px">CLIENT PORTAL</div>
    </td></tr>
    <tr><td style="padding:30px 32px 14px">
        ${input.lines.map(p).join('\n        ')}${code}${button}
        ${p(input.signOff)}
    </td></tr>
    <tr><td style="padding:14px 32px 22px;border-top:1px solid #EEF2F6;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#5A6B80">
      Bredell Ferreira &middot; Debt collection
    </td></tr>
  </table>
</td></tr></table>`
}

/** The six digits the sign-in emails: the first visit, or a forgotten password (S16). The code in the body, not
    the subject, so a lock screen does not show it. */
export function portalCodeEmail(input: { name: string; code: string; url?: string; from?: string }): { subject: string; html: string } {
  const first = input.name.trim().split(' ')[0] || 'there'
  return {
    subject: 'Your Bredell Ferreira client portal code',
    html: portalEmailHtml({
      lines: [`Hi ${escapeHtml(first)},`, 'Here is your code to sign in to the client portal:'],
      code: input.code,
      codeNote: `It works once, for ${PORTAL_CODE_MINUTES} minutes. Next you choose a password, so you will not need a code to sign in again.`,
      button: input.url ? { url: input.url, label: 'Open the client portal' } : undefined,
      signOff: `If you did not ask for this code, you can ignore this email: nobody can sign in without it.<br><br>Kind regards<br>${input.from ? `${escapeHtml(input.from)}<br>` : ''}Bredell Ferreira`,
    }),
  }
}

/** The invitation the liaison's Invite sends, from the liaison's own mailbox. */
export function portalInviteEmail(input: { name: string; clientName: string; url: string; from: string }): { subject: string; html: string } {
  const first = input.name.trim().split(' ')[0] || 'there'
  return {
    subject: `${input.clientName}: your Bredell Ferreira client portal`,
    html: portalEmailHtml({
      lines: [
        `Hi ${escapeHtml(first)},`,
        `You can now see ${escapeHtml(input.clientName)}'s accounts with us online: every debtor, what has been collected, where each one stands, and every remittance advice we have sent you.`,
        'Press the button below and type this email address. The first time, we email you a code and you choose a password; after that you sign in with your password.',
      ],
      button: { url: input.url, label: 'Open the client portal' },
      signOff: `Kind regards<br>${escapeHtml(input.from)}<br>Bredell Ferreira`,
    }),
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

/**
 * WHAT THE CLIENT WANTS, IN ONE PICK (S15). Stephan, on the first portal question ("Update"): "what does the
 * client want? ... we shouldn't make it too complicated." So a short closed list above the box -- enough for
 * the liaison to know what kind of answer is wanted before reading a word -- and the box for the rest.
 * Carried as the first line of the ticket's description: no column, because nothing sorts on it yet.
 */
export const PORTAL_TOPICS = [
  'An update on this account',
  'New details for the debtor',
  'Stop or withdraw this account',
  'Something else',
] as const
export type PortalTopic = typeof PORTAL_TOPICS[number]

export function portalTopic(value: unknown): PortalTopic {
  return (PORTAL_TOPICS as readonly string[]).includes(value as string) ? value as PortalTopic : 'Something else'
}

/** The ticket's description: the topic on its own line, then the client's words. */
export function portalQuestion(topic: PortalTopic, text: string): string {
  return `${topic}\n\n${text}`
}

/**
 * A PAYMENT THE DEBTOR MADE TO THE CLIENT, RECORDED BY THE CLIENT (S15). Stephan: "record a payment ...
 * like a PTC, a payment made to you, on a specific account" -- then, of where it goes: "straight to the
 * account ... it shows up in the trust thing for approval ... and it also notifies the liaison."
 *
 * So it is a real payment row, UNAPPROVED (portal_record_ptc): nothing is allocated, no fee raised and no
 * payover touched until somebody approves it in Trust, exactly like every other receipt. The rules are the
 * database's; this is the browser's and the server's first reading of what was typed.
 */
export interface PortalPaymentReport { amount: number; paidOn: string; reference: string; note: string }

export function portalPaymentReport(input: { amount?: unknown; paidOn?: unknown; reference?: unknown; note?: unknown }, today: string):
  { ok: true; report: PortalPaymentReport } | { ok: false; error: string } {
  const amount = typeof input.amount === 'number' ? input.amount
    : typeof input.amount === 'string' ? Number(input.amount.replace(/[\sR\u00a0]/g, '').replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, '')) : NaN
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Type the amount the debtor paid you.' }
  if (amount > 100_000_000) return { ok: false, error: 'That amount looks wrong. Check it.' }
  const paidOn = typeof input.paidOn === 'string' ? input.paidOn.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || Number.isNaN(Date.parse(paidOn))) return { ok: false, error: 'Say which day it was paid.' }
  if (paidOn > today) return { ok: false, error: 'A payment cannot be in the future.' }
  const reference = typeof input.reference === 'string' ? input.reference.trim().slice(0, 120) : ''
  if (!reference) return { ok: false, error: 'Put your reference on it -- your receipt or bank reference.' }
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : ''
  return { ok: true, report: { amount: Math.round(amount * 100) / 100, paidOn, reference, note } }
}

/** A rand amount as the client typed it back to them: spaces for thousands, never a non-breaking one. */
export function portalRands(v: number): string {
  /* By hand, not toLocaleString: en-ZA's decimal mark is a comma in one runtime and a point in another,
     and this text is stored on a ticket -- it has to read the same whoever wrote it. */
  const [whole, cents] = Math.abs(v).toFixed(2).split('.')
  return `${v < 0 ? '-' : ''}R ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${cents}`
}

/** The ticket's words for it: what the client sees they said, and what the liaison reads. */
export function portalPaymentText(r: PortalPaymentReport): string {
  return `Payment made to us directly\n\nThe debtor paid us ${portalRands(r.amount)} on ${r.paidOn}. Our reference: ${r.reference}.`
    + (r.note ? `\n\n${r.note}` : '')
    + '\n\nRecorded on the account. It counts once Bredell Ferreira has approved it.'
}

/* ------------------------------------------------------------------ the dashboard by outcome (S15) */

/**
 * ONE GROUP OF ACCOUNTS AS portal_summary RETURNS IT: every account sharing the columns a position is
 * read off, counted, with its capital.
 */
export interface PortalSummaryGroup {
  book: string | null
  ended_as: string | null
  status: string | null
  sub_status: string | null
  bucket: string | null
  paid_now: boolean
  disputed: boolean
  accounts: number
  handed_over: number
  outstanding: number
  paid_to_date: number
}

/**
 * WHERE THE CLIENT'S ACCOUNTS ARE, BY OUTCOME (S15). Stephan: "how many accounts have been paid up? How many
 * accounts are kind of in progress, how many accounts are in dispute, how many accounts are in negotiation"
 * -- "not open or closed". So a finished account is counted by HOW it finished (ended_as: paid up, settled,
 * written off, withdrawn), and an open one by its position, decided by clientPosition exactly as portalLine
 * decides it for the Accounts list. One rule, two screens.
 */
export type PortalOutcome = ClientPosition | 'paid_up' | 'settled' | 'written_off' | 'withdrawn'

export const PORTAL_ENDING_LABEL: Record<'paid_up' | 'settled' | 'written_off' | 'withdrawn', string> = {
  paid_up: 'Paid up', settled: 'Settled', written_off: 'Written off', withdrawn: 'Withdrawn',
}
/** The finished outcomes' colours, beside CLIENT_POSITION_COLOUR for the open ones. */
export const PORTAL_ENDING_COLOUR: Record<'paid_up' | 'settled' | 'written_off' | 'withdrawn', string> = {
  paid_up: '#065f46', settled: '#0f766e', written_off: '#9f1239', withdrawn: '#94a3b8',
}

export interface PortalOutcomeLine {
  outcome: PortalOutcome
  label: string
  finished: boolean
  accounts: number
  handedOver: number
  outstanding: number
  paidToDate: number
}

export function portalOutcomes(groups: readonly PortalSummaryGroup[]): PortalOutcomeLine[] {
  const by = new Map<PortalOutcome, PortalOutcomeLine>()
  for (const g of groups) {
    const ending = g.ended_as && g.ended_as in PORTAL_ENDING_LABEL ? g.ended_as as keyof typeof PORTAL_ENDING_LABEL : null
    const open = !ending && (g.book === 'active' || g.book === 'on_hold')
    const outcome: PortalOutcome = ending ?? (open
      ? clientPosition({ closed: false, status: g.status, subStatus: g.sub_status, bucket: g.bucket,
        paidInPeriod: g.paid_now, disputed: g.disputed })
      : 'closed')
    const line = by.get(outcome) ?? {
      outcome, label: ending ? PORTAL_ENDING_LABEL[ending] : CLIENT_POSITIONS[outcome as ClientPosition].label,
      finished: !open, accounts: 0, handedOver: 0, outstanding: 0, paidToDate: 0,
    }
    line.accounts += Number(g.accounts) || 0
    line.handedOver += Number(g.handed_over) || 0
    /* A finished account owes the client nothing more from us: its outstanding is not "outstanding". */
    if (open) line.outstanding += Number(g.outstanding) || 0
    line.paidToDate += Number(g.paid_to_date) || 0
    by.set(outcome, line)
  }
  return [...by.values()].sort((a, b) => Number(a.finished) - Number(b.finished) || b.accounts - a.accounts)
}

/* ------------------------------------------------------------------ handing accounts over (S15, phase 2b) */

/**
 * WHAT A CLIENT MAY SEND (S15). Stephan: "go ahead with handover accounts". The same files the import reads
 * (HandoverImportCard: csv, a zipped csv, xlsx, xlsm) and PDFs beside them, matched by filename there as
 * everywhere. Capped so the whole of it, base64 and all, fits under the 4.5 MB a request to the portal's server
 * may carry; a bigger book is a
 * conversation with the liaison, and the screen says so.
 */
export const PORTAL_HANDOVER_SHEETS = ['.csv', '.zip', '.xlsx', '.xlsm'] as const
export const PORTAL_HANDOVER_MAX_BYTES = 3_000_000

export function portalHandoverSheetName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  return PORTAL_HANDOVER_SHEETS.some((x) => clean.toLowerCase().endsWith(x)) ? clean : null
}
export function portalHandoverPdfName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  return clean.toLowerCase().endsWith('.pdf') ? clean : null
}

/**
 * ONE ACCOUNT, TYPED -- THE FIELDS THE PORTAL ASKS FOR. A short form, not the sheet's forty columns: the
 * four the import cannot do without (their reference, the name, the handover amount, the date of default)
 * and the handful that make the first call possible. The key is the sheet's own column key, so what is
 * typed lands in exactly the column the import reads.
 */
export const PORTAL_SINGLE_FIELDS = [
  'client_reference', 'account_number', 'debtor_kind', 'first_name', 'name', 'id_number', 'registration_number',
  'capital', 'default_date', 'last_payment_date', 'cell_1', 'email_1', 'street_1', 'suburb', 'city', 'street_code',
  'employer', 'notes',
] as const
export type PortalSingleField = typeof PORTAL_SINGLE_FIELDS[number]
const SINGLE_REQUIRED: PortalSingleField[] = ['client_reference', 'name', 'capital', 'default_date']

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/**
 * THE ONE ACCOUNT AS A ONE-LINE HANDOVER SHEET, headed with the sheet's own labels -- so it goes through the
 * same import as a hundred-line sheet, and nothing about loading one account by hand has to be built twice.
 * The required four are refused here, by name, before anything is stored: an import that cannot read the
 * line would only send it back.
 */
export function portalSingleHandover(input: Record<string, unknown>):
  { ok: true; csv: string; reference: string } | { ok: false; error: string } {
  const value = (k: PortalSingleField) => (typeof input[k] === 'string' ? (input[k] as string).replace(/[\r\n]+/g, ' ').trim().slice(0, 300) : '')
  const label = (k: PortalSingleField) => HANDOVER_COLUMNS.find((c) => c.key === k)?.label ?? k
  for (const k of SINGLE_REQUIRED) {
    if (!value(k)) return { ok: false, error: `Fill in ${label(k).toLowerCase()}.` }
  }
  const capital = Number(value('capital').replace(/[\sR\u00a0]/g, '').replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, ''))
  if (!Number.isFinite(capital) || capital <= 0) return { ok: false, error: 'The handover amount must be a number above nothing.' }
  const kind = value('debtor_kind')
  if (kind && kind !== 'Person' && kind !== 'Business') return { ok: false, error: 'Say whether it is a person or a business.' }
  const keys = PORTAL_SINGLE_FIELDS.filter((k) => value(k))
  const cells = keys.map((k) => (k === 'capital' ? capital.toFixed(2) : value(k)))
  return { ok: true, reference: value('client_reference'), csv: `${keys.map((k) => csvCell(label(k))).join(',')}\r\n${cells.map(csvCell).join(',')}\r\n` }
}

/** One of the client's handovers as the portal lists it. */
export interface PortalHandover {
  id: string
  kind: 'sheet' | 'single'
  fileName: string
  accounts: number | null
  pdfs: number
  status: 'received' | 'loaded' | 'declined'
  submittedBy: string
  createdAt: string
  decidedAt: string | null
  declineReason: string | null
}
