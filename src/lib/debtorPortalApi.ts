/**
 * THE DEBTOR PORTAL PAGE'S CALLS (Raptor H16) -- a debtor's browser, never staff (except `inviteDebtor`, which a
 * collector presses on the account page). Imports no Supabase for the debtor's half.
 *
 * WHERE THE SESSION IS KEPT: "Keep me signed in on this device" puts it in localStorage (a month, the server's
 * DEBTOR_REMEMBER_DAYS); otherwise sessionStorage -- this tab only -- because a debtor is as likely to be on a
 * borrowed phone as their own. Read defensively: a private window throws, and the answer then is "sign in".
 */
import { DEBTOR_TOKEN_HEADER, type DebtorPayment, type DebtorSummary, type DebtorTicket } from './debtorPortal'

const KEY = 'raptor.debtor.token'

export function debtorToken(): string | null {
  try { return localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY) } catch { return null }
}
export function saveDebtorToken(token: string | null, remember = false): void {
  try {
    localStorage.removeItem(KEY); sessionStorage.removeItem(KEY)
    if (token) (remember ? localStorage : sessionStorage).setItem(KEY, token)
  } catch { /* signed in for this page only */ }
}

export class DebtorSignedOut extends Error {}

async function call<T>(action: string, body: Record<string, unknown> = {}, token: string | null = null): Promise<T> {
  const res = await fetch(`/api/debtor/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { [DEBTOR_TOKEN_HEADER]: token } : {}) },
    body: JSON.stringify(body),
  })
  const out = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (res.status === 401) throw new DebtorSignedOut(out.error ?? 'Please sign in again.')
  if (!res.ok) throw new Error(out.error ?? 'We could not be reached just now. Please try again.')
  return out
}

export const requestDebtorCode = (caseNumber: string) => call<{ message: string }>('request-code', { caseNumber })
export const verifyDebtorCode = (caseNumber: string, code: string, remember: boolean, reset = false) =>
  call<{ token: string; expiresAt: string; needsPassword: boolean }>('verify', { caseNumber, code, remember, reset })
/* A code once, a password after (Stephan, 3 Nov). */
export const signInDebtor = (caseNumber: string, password: string, remember: boolean) =>
  call<{ token: string; expiresAt: string }>('sign-in', { caseNumber, password, remember })
export const setDebtorPassword = (token: string, password: string) => call<{ ok: boolean }>('set-password', { password }, token)

export interface DebtorAccount {
  asAt: string
  name: string
  caseNumber: string
  client: string
  clientReference: string | null
  closed: string | null
  summary: DebtorSummary
  payments: DebtorPayment[]
  pay: { accountName: string; bank: string | null; branchCode: string | null; accountNumber: string | null; accountType: string | null; reference: string } | null
  contact: { phone: string | null; email: string | null } | null
  /** Part 3: the arrangement in force, if any, and the latest offer (pending, or how it was answered). */
  live: { arrangement: string; amount: number; dueOn: string; missed: boolean } | null
  proposal: {
    status: 'pending' | 'accepted' | 'declined'; arrangement: string; amount: number; firstDueOn: string; declineReason: string | null; createdAt: string
    /** More than 12 months: an application, with the affordability assessment (its state and the debtor's link). */
    needsAssessment: boolean
    assessment: { state: string; link: string } | null
  } | null
  /** Part 4: the disputes on the account and the questions asked here, newest first. */
  tickets: DebtorTicket[]
}
export const fetchDebtorAccount = (token: string) => call<DebtorAccount>('account', {}, token)
export const signOutDebtor = (token: string) => call<{ ok: boolean }>('sign-out', {}, token)

/* Part 2: the statement PDF (base64 off the wire, a Blob in the browser) and a proof of payment. */
export const fetchDebtorStatement = (token: string) => call<{ fileName: string; pdf: string }>('statement', {}, token)
export const sendDebtorProofOfPayment = (token: string, input: { fileName: string; data: string; amount?: string; paidOn?: string }) =>
  call<{ ok: boolean }>('proof-of-payment', input, token)

/* Part 3: an arrangement offered. Nothing is agreed until a collector accepts it. */
export const proposeDebtorArrangement = (token: string, input: { arrangement: string; amount: string; firstDueOn: string; note?: string }) =>
  call<{ ok: boolean; application: boolean; assessmentLink: string | null }>('propose', input, token)

/* Part 4: a written dispute, or a question -- each a ticket on the account. */
export const raiseDebtorDispute = (token: string, input: { reason: string; text: string }) => call<{ ticketNo: number | null }>('dispute', input, token)
export const askDebtorQuestion = (token: string, text: string) => call<{ ticketNo: number | null }>('ask', { text }, token)

/**
 * STAFF: email the debtor the link to their account, from the caller's own mailbox. Sent with the Raptor session, not a
 * debtor token -- the server checks it is somebody signed in to Raptor.
 */
export async function inviteDebtor(accessToken: string, accountId: string): Promise<{ to: string; url: string }> {
  const res = await fetch('/api/debtor/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ accountId }),
  })
  const out = (await res.json().catch(() => ({}))) as { to?: string; url?: string; error?: string }
  if (!res.ok) throw new Error(out.error ?? 'The invitation could not be sent just now.')
  return { to: out.to ?? '', url: out.url ?? '' }
}
