import { portalEmailHtml } from './clientPortal.js'
import type { BalanceBreakdown } from './accountBalance.js'

/**
 * THE DEBTOR PORTAL (Raptor H16, part 1): the rules both its server (api/_lib/debtorPortal.ts) and its page
 * (src/pages/debtor/) need, with nothing that touches a database, so a check can run them.
 *
 * Stephan, 2 Nov, chose the first version: a debtor sees their balance and statement, how to pay, can propose an
 * arrangement and raise a dispute or a question; they sign in with their CASE NUMBER and a code sent to the
 * email (or mobile) already on the account. Part 1 is the sign-in, the balance, the payments and how to pay.
 *
 * WHY THE CASE NUMBER. It is Raptor's own, unique and never reused (CLAUDE.md, "THREE numbers live on an
 * account"), and it is what every notice and SMS the firm sends quotes -- so it is the one number the debtor has
 * in front of them. It is NOT a secret, which is why it is never enough: the code goes only to a contact the firm
 * already holds, and the answer to "send me a code" never says whether the case number exists.
 *
 * `.js` SPECIFIERS: the API imports this file (check-api-imports).
 */

export const DEBTOR_TOKEN_HEADER = 'x-debtor-token'
export const DEBTOR_CODE_MINUTES = 10
/** A debtor signs in now and then, often on somebody else's phone; a week, not the client portal's month. */
export const DEBTOR_SESSION_DAYS = 7

/**
 * READ A CASE NUMBER THE WAY A DEBTOR TYPES IT. "RAP-125318", "rap 125318", "RAP125318" and "125318" are the same
 * case: the prefix is the same on every account and a debtor copying it off an SMS drops or mangles it. Anything
 * that is not digits after an optional RAP is not a case number. Null rather than a guess.
 */
export function normaliseCaseNumber(typed: unknown): string | null {
  if (typeof typed !== 'string') return null
  const s = typed.trim().toUpperCase().replace(/[\s ._/-]+/g, '')
  const m = /^(?:RAP)?(\d{4,9})$/.exec(s)
  return m ? `RAP-${m[1]}` : null
}

export interface ContactRow { kind: string; value: string; is_primary: boolean | null; retired_at: string | null }
export type CodeChannel = 'email' | 'sms'

/**
 * WHERE THE CODE GOES: the account's own contacts, never one typed at sign-in -- that is what makes the case
 * number safe to accept. EMAIL FIRST, because an SMS is a cost and an email is not; a mobile only where there is
 * no usable email at all. A retired contact is one the firm knows is wrong, so it is never used. Primary first.
 */
export function codeDestination(contacts: readonly ContactRow[]): { channel: CodeChannel; to: string } | null {
  const live = contacts.filter((c) => !c.retired_at && (c.value ?? '').trim())
  const pick = (kind: (k: string) => boolean) => {
    const of = live.filter((c) => kind((c.kind ?? '').toLowerCase()))
    return of.find((c) => c.is_primary) ?? of[0] ?? null
  }
  const email = pick((k) => k === 'email')
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) return { channel: 'email', to: email.value.trim() }
  const mobile = pick((k) => k === 'mobile')
  if (mobile) return { channel: 'sms', to: mobile.value.trim() }
  return null
}

/**
 * THE ONE ANSWER TO "SEND ME A CODE", whatever happened: a case number that is not ours, an account with no contact,
 * a closed account and a code really sent all read alike, so the page cannot be used to learn whose case is whose.
 */
export const DEBTOR_CODE_SENT = 'If that is one of our accounts, a code is on its way to the email address (or cellphone) we have for you. It lasts 10 minutes. If you have more than one account with us, use the case number.'

/**
 * THE SMS, IN THE GSM ALPHABET ONLY: no non-breaking space, no curly quote, under 160 characters -- a single
 * segment (CLAUDE.md: anything outside GSM drops the message to 70-character segments). The firm pays for it; a
 * sign-in code is not a communication about the debt, so it is never charged to the debtor.
 */
export function debtorCodeSms(code: string): string {
  return `Bredell Ferreira: ${code} is your code to see your account online. It works for ${DEBTOR_CODE_MINUTES} minutes. If you did not ask for it, ignore this SMS.`
}

export function debtorCodeEmail(input: { name: string; code: string; caseNumber: string; url?: string }): { subject: string; html: string } {
  const first = (input.name.trim().split(' ')[0] || '').replace(/[<>&"]/g, '')
  return {
    subject: `Your code to see your account ${input.caseNumber}`,
    html: portalEmailHtml({
      kicker: 'YOUR ACCOUNT',
      lines: [first ? `Dear ${first},` : 'Good day,', `Here is your code to see your account ${input.caseNumber} online:`],
      code: input.code,
      codeNote: `It works once, for ${DEBTOR_CODE_MINUTES} minutes.`,
      button: input.url ? { url: input.url, label: 'Open my account' } : undefined,
      signOff: 'If you did not ask for this code, you can ignore this email: nobody can see your account without it.<br><br>Kind regards<br>Bredell Ferreira',
    }),
  }
}

/* ---------------------------------------------------------------- what the debtor sees */

export interface DebtorSummary {
  capital: number
  interest: number
  /** Annexure B fees and receipt fees together, VAT included: to a debtor both are "fees and costs". */
  fees: number
  paid: number
  /** What is owed today. */
  balance: number
  /** What settling in full today would cost: the balance plus the receipt fee on it. */
  settleToday: number
  /** Said in words where a rule stopped the debt growing, so the figure explains itself. */
  note: string | null
}

/**
 * THE ACCOUNT PAGE'S OWN NUMBERS, NOT A SECOND SUM. computeBalance worked these out on the server over the same
 * ledgers the collector sees; this only chooses which to show and words them. In duplum is said, because a
 * debtor who sees interest stop is owed the reason -- the law, not the firm's kindness.
 */
export function debtorSummary(b: BalanceBreakdown): DebtorSummary {
  const r = (n: number) => Math.round(n * 100) / 100
  return {
    capital: r(b.capital),
    interest: r(b.interest),
    fees: r(b.fees + b.receiptFees),
    paid: r(b.payments),
    balance: r(b.balance),
    settleToday: r(b.settlement),
    note: b.cappedBy === 'in duplum'
      ? 'Interest, fees and costs on this account have reached the legal maximum (the in duplum rule): they can no longer grow, so what you see is the most that can be claimed on top of the amount you owed.'
      : null,
  }
}

/** A payment as the debtor sees it: the day and the amount. */
export interface DebtorPayment { on: string; amount: number }

export function debtorPayments(rows: readonly { received_at: string; amount: number | string; approved_at: string | null; reversed_at: string | null; rejected_at: string | null }[]): DebtorPayment[] {
  return rows
    /* ONLY MONEY THAT STANDS. A receipt waiting for approval is not yet the firm's to confirm, and a reversed or
       rejected one is not money paid -- showing either would tell a debtor something the statement will contradict. */
    .filter((x) => x.approved_at && !x.reversed_at && !x.rejected_at)
    .map((x) => ({ on: new Date(x.received_at).toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' }), amount: Number(x.amount) }))
    .sort((a, b) => b.on.localeCompare(a.on))
}

/* ---------------------------------------------------------------- part 2: statement and proof of payment */

/**
 * A PROOF OF PAYMENT, AS A DEBTOR SENDS IT: a PDF from the bank app or a photo of a slip. 3 MB, like the client
 * portal's handover sheet, because the request carries it as base64 (a third larger) inside Vercel's 4.5 MB body.
 * HEIC is accepted because an iPhone's camera writes it and a debtor will not know to convert.
 */
export const DEBTOR_POP_MAX_BYTES = 3_000_000
const POP_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.heic': 'image/heic', '.heif': 'image/heif', '.webp': 'image/webp',
}

/** The file's name made safe to store, and its type off the extension; null for anything that is not a PDF or a photo. */
export function debtorPopFile(name: unknown): { name: string; contentType: string } | null {
  if (typeof name !== 'string') return null
  const base = name.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot < 1) return null
  const ext = base.slice(dot).toLowerCase()
  const contentType = POP_TYPES[ext]
  if (!contentType) return null
  const stem = base.slice(0, dot).replace(/[^\w\-() ]+/g, '_').trim().slice(0, 80) || 'proof-of-payment'
  return { name: `${stem}${ext}`, contentType }
}

/**
 * WHAT THE DEBTOR SAYS THEY PAID, OPTIONAL BOTH: the slip is the evidence, these only help finance find the line on
 * the bank statement. An amount must be positive and a date may not be in the future or more than a year back --
 * either is a typing mistake, and a wrong date sends finance looking in the wrong month.
 */
export function debtorPopClaim(input: { amount?: unknown; paidOn?: unknown }, today: string):
  { ok: true; amount: number | null; paidOn: string | null } | { ok: false; error: string } {
  let amount: number | null = null
  if (input.amount !== undefined && input.amount !== null && String(input.amount).trim() !== '') {
    const n = Number(String(input.amount).replace(/[^\d.,]/g, '').replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) return { ok: false, error: 'That amount does not look right. Type it as a number, for example 500.' }
    amount = Math.round(n * 100) / 100
  }
  let paidOn: string | null = null
  if (typeof input.paidOn === 'string' && input.paidOn.trim()) {
    const d = input.paidOn.trim()
    const [y, m] = today.split('-').map(Number)
    const yearAgo = `${y - 1}-${String(m).padStart(2, '0')}-${today.slice(8, 10)}`
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > today || d < yearAgo) return { ok: false, error: 'The date you paid cannot be in the future, or more than a year ago.' }
    paidOn = d
  }
  return { ok: true, amount, paidOn }
}

/** The line on the account's timeline, and the collector's bell, in one sentence. */
export function debtorPopNote(caseNumber: string, claim: { amount: number | null; paidOn: string | null }, money: (n: number) => string): string {
  const what = claim.amount !== null ? ` of ${money(claim.amount)}` : ''
  const when = claim.paidOn ? ` paid on ${claim.paidOn}` : ''
  return `The debtor sent a proof of payment${what}${when} from the debtor portal (${caseNumber}). It is under Documents. Check it against the trust account before it is treated as paid.`
}

/* ---------------------------------------------------------------- part 4: a dispute, or a question */

/**
 * WHY A DEBTOR DISPUTES, IN THEIR WORDS -- each one the firm's own classification underneath (QUERY_CATEGORIES in
 * disputeCategories.ts, "what every report groups by"), so a dispute raised online is counted with every other. The
 * debtor never sees "Liability dispute"; the firm never sees "This is not my debt" in a report.
 */
export const DEBTOR_DISPUTE_REASONS: { label: string; category: string }[] = [
  { label: 'The amount is wrong', category: 'Amount dispute' },
  { label: 'I have already paid', category: 'Payment query' },
  { label: 'This is not my debt', category: 'Liability dispute' },
  { label: 'I did not get the goods or service', category: 'Product/service dispute' },
  { label: 'I cancelled the contract', category: 'Contract/cancellation' },
  { label: 'Someone else is meant to pay (insurance, medical aid, employer)', category: 'Third-party payment' },
  { label: 'I am under debt review, sequestration or similar', category: 'Legal/status issue' },
  { label: 'Something else', category: 'Other' },
]

/** Enough words for a person to act on. "Other" needs the firm's own minimum (EXPLANATION_MIN_LENGTH, 15). */
export const DEBTOR_TICKET_MIN = 10
export const DEBTOR_TICKET_MAX = 2000

export function debtorDispute(input: { reason?: unknown; text?: unknown }): { ok: true; category: string; text: string } | { ok: false; error: string } {
  const reason = DEBTOR_DISPUTE_REASONS.find((r) => r.label === input.reason)
  if (!reason) return { ok: false, error: 'Choose why you dispute the account.' }
  const text = typeof input.text === 'string' ? input.text.trim().slice(0, DEBTOR_TICKET_MAX) : ''
  const min = reason.category === 'Other' ? 15 : DEBTOR_TICKET_MIN
  if (text.length < min) return { ok: false, error: 'Tell us what is wrong, in a sentence or two, so we can look into it.' }
  return { ok: true, category: reason.category, text }
}

export function debtorQuestion(input: { text?: unknown }): { ok: true; text: string } | { ok: false; error: string } {
  const text = typeof input.text === 'string' ? input.text.trim().slice(0, DEBTOR_TICKET_MAX) : ''
  if (text.length < DEBTOR_TICKET_MIN) return { ok: false, error: 'Type your question first.' }
  return { ok: true, text }
}

/** A ticket as the debtor sees it: what, when, and whether it is still open -- never who holds it inside the firm. */
export interface DebtorTicket { no: number | null; kind: 'dispute' | 'question'; raisedOn: string; open: boolean; about: string }

/* ---------------------------------------------------------------- a code once, a password after */

/**
 * THE SAME ANSWER for a case number that is not ours, a login with no password yet and a wrong password -- so the
 * sign-in cannot be used to learn whose case is whose (DEBTOR_CODE_SENT's rule, for the password half).
 */
export const DEBTOR_PASSWORD_WRONG = 'Those details and that password do not match. First time here, or forgot your password? Send yourself a code.'
/** "Keep me signed in on this device": a month. Without it, the session ends with the day (and the tab). */
export const DEBTOR_REMEMBER_DAYS = 30

/**
 * THE INVITATION A COLLECTOR SENDS (Stephan, 3 Nov: "I don't know how to invite someone to that"). The link carries the
 * case number, so the debtor arrives with it already typed and only has to ask for their first code. No code and no
 * password in the email: the link is not a key, it is directions.
 */
export function debtorInviteEmail(input: { name: string; caseNumber: string; client: string; url: string; from: string }): { subject: string; html: string } {
  const first = (input.name.trim().split(' ')[0] || '').replace(/[<>&"]/g, '')
  const esc = (s: string) => s.replace(/[<>&"]/g, '')
  return {
    subject: `Your account ${input.caseNumber} online`,
    html: portalEmailHtml({
      kicker: 'YOUR ACCOUNT',
      lines: [
        first ? `Dear ${first},` : 'Good day,',
        `You can now see your account ${input.caseNumber}${input.client ? ` (on behalf of ${esc(input.client)})` : ''} online, whenever it suits you: what you owe, what you have paid and how to pay. You can also download your statement, send us a proof of payment, offer a payment arrangement or ask us a question.`,
        'The first time, we will send you a code to confirm it is you, and you choose a password. After that you sign in with your case number and that password.',
      ],
      button: { url: input.url, label: 'Open my account' },
      signOff: `Kind regards<br>${esc(input.from)}<br>Bredell Ferreira`,
    }),
  }
}

/** The link an invitation carries: the portal, with the case number filled in. */
export function debtorPortalLink(origin: string, caseNumber: string): string {
  return `${origin.replace(/\/+$/, '')}/my-account?case=${encodeURIComponent(caseNumber)}`
}

/* ---------------------------------------------------------------- signing in by case number, ID number or email */

/**
 * WHAT A DEBTOR MAY SIGN IN WITH (Raptor H16, 4 Nov). Stephan: "you should be able to sign in ... with your ID number,
 * and then a password also, your email address, or your case number." He typed something that was not a case number
 * and the page refused it before asking anybody -- which read as the portal being broken.
 *
 * READ, NOT GUESSED: an @ is an email address; thirteen digits is a South African identity number (the case number's
 * digits are fewer, so the two cannot be mistaken); anything normaliseCaseNumber accepts is a case number. Null for
 * the rest, and the page says what it takes. None of the three is a secret -- the password (or the code, which goes
 * only to a contact the firm holds) is what lets anybody in.
 */
export type DebtorLogin = { kind: 'case'; value: string } | { kind: 'email'; value: string } | { kind: 'id'; value: string }

export function debtorLogin(typed: unknown): DebtorLogin | null {
  if (typeof typed !== 'string') return null
  const t = typed.trim()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return { kind: 'email', value: t.toLowerCase() }
  const digits = t.replace(/[\s -]/g, '')
  if (/^\d{13}$/.test(digits)) return { kind: 'id', value: digits }
  const c = normaliseCaseNumber(t)
  return c ? { kind: 'case', value: c } : null
}

export const DEBTOR_LOGIN_HINT = 'Type your case number (for example RAP-123456), your ID number or your email address.'

/* ---------------------------------------------------------------- where the account stands */

/**
 * WHERE THE ACCOUNT STANDS, AT A GLANCE (Stephan, 4 Nov: "on the dashboard ... where the account stands ... so when
 * they log in, that they can see that. But progress bar"). Two things: how much of the debt is behind them, and the
 * one thing happening on it now. The share is paid over paid-plus-owed -- what a debtor means by "how far am I" --
 * not paid over the original amount, which would read past 100% on an account where interest and fees grew it.
 *
 * ONE STAGE, IN THIS ORDER, because each above silences the ones below: a closed account says nothing else; an open
 * dispute has stopped collection; a missed payment is the urgent thing on a live arrangement; then the arrangement,
 * the offer waiting on the firm, and last, nothing agreed yet -- the only stage with a button, because it is the only
 * one the debtor moves.
 */
export interface StandingInput {
  closed: string | null
  summary: { paid: number; balance: number }
  live: { arrangement: string; amount: number; dueOn: string; missed: boolean } | null
  proposal: { status: string } | null
  tickets: { kind: 'dispute' | 'question'; open: boolean }[]
}
export interface Standing {
  paidShare: number
  stage: 'closed' | 'dispute' | 'missed' | 'arranged' | 'offered' | 'nothing'
  headline: string
  action: 'arrangement' | 'payments' | null
}
export function debtorStanding(a: StandingInput, money: (n: number) => string, day: (iso: string) => string): Standing {
  const owed = Math.max(0, a.summary.balance)
  const paid = Math.max(0, a.summary.paid)
  const paidShare = a.closed ? 1 : paid + owed > 0 ? Math.min(1, paid / (paid + owed)) : 0
  if (a.closed) return { paidShare, stage: 'closed', headline: 'This account is closed.', action: null }
  if (a.tickets.some((t) => t.kind === 'dispute' && t.open)) return { paidShare, stage: 'dispute', headline: 'Your dispute is open. Collection is paused while we look at it.', action: null }
  if (a.live?.missed) return { paidShare, stage: 'missed', headline: `A payment on your arrangement was missed. Please pay ${money(a.live.amount)} now, or call us.`, action: 'payments' }
  if (a.live) return { paidShare, stage: 'arranged', headline: `Arrangement in place. Next payment: ${money(a.live.amount)} on ${day(a.live.dueOn)}.`, action: null }
  if (a.proposal?.status === 'pending') return { paidShare, stage: 'offered', headline: 'Your offer is with us. We will reply, usually within one working day.', action: null }
  return { paidShare, stage: 'nothing', headline: owed > 0 ? 'Nothing is agreed yet. Settle the account, or tell us what you can pay.' : 'Nothing is owed on this account.', action: owed > 0 ? 'arrangement' : null }
}
