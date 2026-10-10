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
 * The route works a day at a time and stops before its function's wall clock does; this calls it
 * again until it has arrived. `onDay` reports progress for the control's line.
 */
export async function jumpStagingClock(
  to: string, reason: string | null, onDay?: (reached: string) => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return { ok: false, error: 'You are signed out.' }
  let resume = false
  /* A ceiling on calls, not on days: each call walks as many days as it can in four minutes. */
  for (let call = 0; call < 20; call += 1) {
    const res = await fetch('/api/workflow/clock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, reason, resume }),
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string; reached?: string; done?: boolean }
    if (!res.ok) return { ok: false, error: body.error ?? `The jump stopped (${res.status}).` }
    if (body.reached) onDay?.(body.reached)
    if (body.done) return { ok: true }
    resume = true
  }
  return { ok: false, error: 'The jump did not finish. Press it again to carry on from where it stopped.' }
}

/** CLEAR STAGING: the book and the money emptied, the clock started again on `start`. */
export async function clearStaging(start: string, confirm: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc('clear_staging', { p_start: start, p_confirm: confirm })
  return error ? { ok: false, error: error.message } : { ok: true }
}
