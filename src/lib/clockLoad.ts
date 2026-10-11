import { supabase } from './supabase'
import { applyClock, resetClock, type FirmClock } from './clock.ts'

/**
 * READ THE FIRM'S CLOCK, ONCE PER PAGE LOAD (prompt 10). AppLayout calls this before it draws any
 * page, so every date decision on every screen is made against the same day.
 *
 * A FAILURE IS THE REAL CLOCK, NOT A BLANK APP. If the question cannot be asked (a database without
 * the function, a network blip) the app runs on this machine's clock exactly as it did before the
 * staging clock existed -- which on production is the right answer anyway.
 */
export async function loadClock(): Promise<FirmClock | null> {
  const { data, error } = await supabase.rpc('raptor_clock')
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (error || !row || typeof row.business_now !== 'string') {
    resetClock()
    return null
  }
  const clock: FirmClock = {
    businessNow: row.business_now as string,
    businessToday: String(row.business_today),
    realNow: String(row.real_now),
    realToday: String(row.real_today),
    staging: row.staging === true,
    moved: row.moved === true,
  }
  applyClock(clock)
  return clock
}

/**
 * MOVE THE STAGING CLOCK FORWARD TO `to`, catching up every day in between (api/_lib/workflow/clock.ts).
 * The route works a few days at a time and says how far it got; this calls it again until it has
 * arrived. `onDay` reports progress for the control's line.
 *
 * A DROPPED CONNECTION IS NOT A FAILED JUMP. The server carries on with the day it was given even
 * when the browser stops listening -- an iPad that dims, a Wi-Fi blip -- and the firm saw exactly
 * that: the clock had moved and the banner still said it was moving, until they went to another
 * tab and back (11 Oct). So when a call does not come back, the CLOCK is asked where it is, and the
 * jump carries on from there. Only a refusal the route itself sends back is an error.
 */
export async function jumpStagingClock(
  to: string, reason: string | null, onDay?: (reached: string) => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return { ok: false, error: 'You are signed out.' }
  let resume = false
  let dropped = 0
  const startDay = (await loadClock().catch(() => null))?.businessToday ?? null
  /* A ceiling on calls, not on days: each call walks as many days as it can in its budget. */
  for (let call = 0; call < 80; call += 1) {
    let res: Response
    try {
      res = await fetchWithin('/api/workflow/clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to, reason, resume }),
      }, 90_000)
    } catch {
      /* Nothing came back. Ask the database where the clock is rather than guessing. */
      dropped += 1
      const now = await loadClock().catch(() => null)
      if (now?.businessToday && now.businessToday >= to) return { ok: true }
      if (now?.businessToday) onDay?.(now.businessToday)
      if (dropped > 3) {
        return { ok: false, error: 'The connection keeps dropping. The clock has moved as far as the banner shows; press the jump again to carry on.' }
      }
      /* A lost call that moved the clock began the jump, so from here it is a resume. One that moved
         nothing is asked again from the start, so the jump is still checked and logged once. */
      resume = resume || (!!now?.businessToday && now.businessToday !== startDay)
      continue
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; reached?: string; done?: boolean }
    if (!res.ok) return { ok: false, error: body.error ?? `The jump stopped (${res.status}).` }
    if (body.reached) onDay?.(body.reached)
    if (body.done) return { ok: true }
    resume = true
  }
  return { ok: false, error: 'The jump did not finish. Press it again to carry on from where it stopped.' }
}

/** fetch, given up on after `ms` -- a request the browser lost is otherwise waited on for ever. */
async function fetchWithin(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctl.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** CLEAR STAGING: the book and the money emptied, the clock started again on `start`. */
export async function clearStaging(start: string, confirm: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc('clear_staging', { p_start: start, p_confirm: confirm })
  return error ? { ok: false, error: error.message } : { ok: true }
}
