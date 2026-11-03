/**
 * THE DEBTOR PORTAL PAGE'S CALLS (Raptor H16) -- a debtor's browser, never staff. Imports no Supabase: the debtor
 * has no Supabase session and the page's chunk has no use for the library.
 *
 * The token lives in sessionStorage -- this tab only -- because a debtor is as likely to be on a borrowed or a
 * shared phone as their own, and a debt is the last thing to leave signed in on somebody else's.
 */
import { DEBTOR_TOKEN_HEADER, type DebtorPayment, type DebtorSummary } from './debtorPortal'

const KEY = 'raptor.debtor.token'

export function debtorToken(): string | null {
  try { return sessionStorage.getItem(KEY) } catch { return null }
}
export function saveDebtorToken(token: string | null): void {
  try { if (token) sessionStorage.setItem(KEY, token); else sessionStorage.removeItem(KEY) } catch { /* this page only */ }
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
export const verifyDebtorCode = (caseNumber: string, code: string) => call<{ token: string; expiresAt: string }>('verify', { caseNumber, code })

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
}
export const fetchDebtorAccount = (token: string) => call<DebtorAccount>('account', {}, token)
export const signOutDebtor = (token: string) => call<{ ok: boolean }>('sign-out', {}, token)

/* Part 2: the statement PDF (base64 off the wire, a Blob in the browser) and a proof of payment. */
export const fetchDebtorStatement = (token: string) => call<{ fileName: string; pdf: string }>('statement', {}, token)
export const sendDebtorProofOfPayment = (token: string, input: { fileName: string; data: string; amount?: string; paidOn?: string }) =>
  call<{ ok: boolean }>('proof-of-payment', input, token)
