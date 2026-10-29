/**
 * THE PORTAL PAGE'S CALLS (S14, Raptor H13) -- a client's browser, never staff. Imports no Supabase: the
 * client has no Supabase session and the portal's chunk has no use for the library.
 *
 * The session token lives in localStorage, read defensively: a private window or an iPad with site data
 * blocked throws on access, and the answer then is "sign in", not a blank page.
 */
import { PORTAL_TOKEN_HEADER, type PortalHandover, type PortalLine, type PortalMessage, type PortalTicket } from './clientPortal'

const KEY = 'raptor.portal.token'

export function portalToken(): string | null {
  try { return localStorage.getItem(KEY) } catch { return null }
}
export function savePortalToken(token: string | null): void {
  try { if (token) localStorage.setItem(KEY, token); else localStorage.removeItem(KEY) } catch { /* signed in for this tab only */ }
}

export class PortalSignedOut extends Error {}

async function call<T>(action: string, body: Record<string, unknown> = {}, token: string | null = null): Promise<T> {
  const res = await fetch(`/api/portal/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { [PORTAL_TOKEN_HEADER]: token } : {}) },
    body: JSON.stringify(body),
  })
  const out = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (res.status === 401) throw new PortalSignedOut(out.error ?? 'Please sign in again.')
  if (!res.ok) throw new Error(out.error ?? 'The portal could not be reached just now.')
  return out
}

export const requestPortalCode = (email: string) => call<{ message: string }>('request-code', { email })
export const verifyPortalCode = (email: string, code: string) => call<{ token: string; expiresAt: string }>('verify', { email, code })

export interface PortalMe { name: string; email: string; client: string }
export const fetchPortalMe = (token: string) => call<PortalMe>('me', {}, token)

export interface PortalBook {
  total: number
  totals: { capitalHandedOver: number; paidThisMonth: number; paidToDate: number; capitalOutstanding: number }
  lines: PortalLine[]
}
export const fetchPortalBook = (token: string, q: { search: string; includeClosed: boolean; offset: number }) =>
  call<PortalBook>('book', q, token)

export const portalSignOut = (token: string) => call<{ ok: boolean }>('sign-out', {}, token)

/* Phase 2a (S15): tickets, questions and callbacks. */
export const fetchPortalTickets = (token: string) => call<{ tickets: PortalTicket[] }>('tickets', {}, token)
export const fetchPortalTicket = (token: string, ticketNo: number) => call<{ messages: PortalMessage[] }>('ticket', { ticketNo }, token)
export const replyPortalTicket = (token: string, ticketNo: number, message: string) =>
  call<{ ok: boolean }>('ticket-reply', { ticketNo, message }, token)
export const askPortalQuestion = (token: string, caseNumber: string, topic: string, question: string) =>
  call<{ ticketNo: number }>('ask', { caseNumber, topic, question }, token)
export const requestPortalCallback = (token: string, req: { caseNumber?: string; phone: string; when: string; about: string }) =>
  call<{ ok: boolean }>('callback', req, token)
export const recordPortalPayment = (token: string, req: { caseNumber: string; amount: string; paidOn: string; reference: string; note: string }) =>
  call<{ ticketNo: number | null }>('payment-report', req, token)

export interface PortalDashboard {
  accounts: number
  open: number
  figures: { capitalHandedOver: number; collectedToDate: number; collectedThisMonth: number; capitalOutstanding: number }
  outcomes: import('./clientPortal').PortalOutcomeLine[]
  tickets: { waitingOnYou: number; open: number }
}
export const fetchPortalDashboard = (token: string) => call<PortalDashboard>('dashboard', {}, token)

export interface PortalReport {
  id: string; kind: 'remittance'; version: number; sentAt: string; title: string; client: string; amount: number
  periodStart: string | null; periodEnd: string | null; hasPdf: boolean; hasSheet: boolean
}
export const fetchPortalReports = (token: string) => call<{ reports: PortalReport[] }>('reports', {}, token)
export const portalReportFile = (token: string, id: string, file: 'pdf' | 'xlsx') =>
  call<{ url: string }>('report-file', { id, file }, token)

/* Phase 2b (S15): handing accounts over. */
export const fetchPortalHandovers = (token: string) => call<{ handovers: PortalHandover[] }>('handovers', {}, token)
export const sendPortalHandoverSheet = (token: string, req: { fileName: string; content: string; pdfs: { name: string; content: string }[]; note: string }) =>
  call<{ id: string }>('handover-sheet', req, token)
export const sendPortalHandoverSingle = (token: string, account: Record<string, string>) =>
  call<{ id: string }>('handover-single', { account }, token)

/** A file as base64, for the JSON body the portal's server takes. */
export async function fileBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
