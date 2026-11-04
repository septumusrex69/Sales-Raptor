/**
 * Tell us when the app breaks, instead of waiting for someone to mention it.
 *
 * Three ways an error reaches here:
 *   - a page crashes while rendering        -> ErrorBoundary calls reportError()
 *   - a click handler / timer throws        -> window 'error'
 *   - a promise rejects and nobody catches  -> window 'unhandledrejection'
 *
 * Each goes to /api/report-error, which stores it and emails whoever is on ERROR_ALERT_EMAIL.
 *
 * Deliberately quiet on localhost: a developer mid-edit produces a dozen errors a minute and
 * already has the console open. Set VITE_REPORT_ERRORS_LOCALLY=1 to test the pipe end to end.
 */
import { supabase } from './supabase'

const ENDPOINT = '/api/report-error'
/** One bad loop must not become a thousand emails, or a thousand requests from one tab. */
const MAX_PER_SESSION = 15
const sent = new Set<string>()
let count = 0

export type ErrorSource = 'render' | 'window' | 'promise' | 'manual'

function enabled(): boolean {
  if (typeof window === 'undefined') return false
  const local = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
  return !local || import.meta.env.VITE_REPORT_ERRORS_LOCALLY === '1'
}

/*
 * Noise that is not ours to fix. A browser extension throwing inside our page, a ResizeObserver
 * that took two frames, a tab that lost the network for a second. Alerts that are always noise
 * teach people to ignore alerts -- so these never become one.
 */
const IGNORED = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i, // cross-origin script, no detail available
  /chrome-extension:|moz-extension:|safari-extension:/i,
  /AbortError/i,
]

function normalise(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: `${err.name}: ${err.message}`, stack: err.stack }
  if (typeof err === 'string') return { message: err }
  try { return { message: JSON.stringify(err) } } catch { return { message: String(err) } }
}

export async function reportError(err: unknown, source: ErrorSource, extra?: { componentStack?: string }) {
  const { message, stack } = normalise(err)
  // Always visible to whoever has devtools open, enabled or not.
  console.error(`[raptor:${source}]`, err)
  if (!enabled()) return
  if (IGNORED.some((re) => re.test(message) || (stack && re.test(stack)))) return

  const key = `${message}|${stack?.split('\n')[1] ?? ''}`
  if (sent.has(key) || count >= MAX_PER_SESSION) return
  sent.add(key)
  count++

  // Who saw it is what makes a report actionable ("ask Thandi what she clicked"). Optional:
  // the login page can crash too, with nobody signed in.
  let token: string | undefined
  try { token = (await supabase.auth.getSession()).data.session?.access_token } catch { /* fine */ }

  const body = JSON.stringify({
    message: message.slice(0, 1000),
    stack: stack?.slice(0, 6000),
    componentStack: extra?.componentStack?.slice(0, 4000),
    source,
    url: window.location.href,
    userAgent: navigator.userAgent,
    // The build that broke. Vite stamps a new hash on every deploy; the entry script carries it.
    build: document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.src.split('/').pop(),
  })
  try {
    // keepalive lets the report finish even if the error is followed by a reload.
    await fetch(ENDPOINT, {
      method: 'POST',
      keepalive: body.length < 60_000,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body,
    })
  } catch {
    // A reporter that throws would report itself. Losing one report is the lesser harm.
  }
}

let installed = false
/** Call once, before the app renders. */
export function installGlobalErrorHandlers() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => { void reportError(e.error ?? e.message, 'window') })
  window.addEventListener('unhandledrejection', (e) => { void reportError(e.reason, 'promise') })
}
