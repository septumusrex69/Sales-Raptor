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
export const DEBTOR_CODE_SENT = 'If that case number is one of ours, a code is on its way to the email address (or cellphone) we have for you. It lasts 10 minutes.'

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
