import { LLANDUDNO_LOOK, type DayLook } from './portalPhotos.ts'

/*
 * TODAY'S APPROVED LOOK, HELD FOR THE STAFF APP (S16, 31 Oct): the Bredell Ferreira skin's photograph and line follow
 * the same approval as the client portal's (/portal-looks). Kept free of the database client on purpose -- themes.ts
 * reads it and the checks import themes.ts -- so the fetch lives in ThemeContext and only the answer lives here.
 * Llandudno until the answer comes, and wherever today was not approved.
 */
let current: DayLook = LLANDUDNO_LOOK
/*
 * WHETHER TODAY'S ANSWER IS IN (S18, 6 Nov). Stephan: "the picture changes, but then for an instant it shows the old
 * picture. And then it switches to the new one." Llandudno was painted while the question was still out, so every
 * day that was not Llandudno opened on the wrong photograph. Until the answer is in, applyDayPhoto paints the band
 * plain navy instead -- an empty band for a moment reads as loading; the wrong picture reads as the wrong picture.
 */
let known = false
const listeners = new Set<() => void>()

export function currentDayLook(): DayLook { return current }
export function dayLookKnown(): boolean { return known }

export function setDayLook(look: DayLook) {
  current = look
  known = true
  listeners.forEach((f) => f())
}

/*
 * TODAY'S ROW, REMEMBERED ON THIS DEVICE, so a second visit the same day paints the right photograph on the first
 * frame rather than after a round trip. Keyed by the day: yesterday's is never read as today's. Browser storage is
 * a convenience here -- unavailable (a private window), it simply asks, as before.
 */
const CACHE_KEY = 'raptor.dayLook'
export function rememberDayRow(day: string, row: unknown) {
  try { window.localStorage.setItem(CACHE_KEY, JSON.stringify({ day, row })) } catch { /* nothing to remember with */ }
}
export function rememberedDayRow(day: string): { row: unknown } | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? 'null') as { day?: string; row?: unknown } | null
    return v && v.day === day ? { row: v.row ?? null } : null
  } catch { return null }
}

export function subscribeDayLook(f: () => void): () => void {
  listeners.add(f)
  return () => { listeners.delete(f) }
}
