import { LLANDUDNO_LOOK, type DayLook } from './portalPhotos.ts'

/*
 * TODAY'S APPROVED LOOK, HELD FOR THE STAFF APP (S16, 31 Oct): the Bredell Ferreira skin's photograph and line follow
 * the same approval as the client portal's (/portal-looks). Kept free of the database client on purpose -- themes.ts
 * reads it and the checks import themes.ts -- so the fetch lives in ThemeContext and only the answer lives here.
 * Llandudno until the answer comes, and wherever today was not approved.
 */
let current: DayLook = LLANDUDNO_LOOK
const listeners = new Set<() => void>()

export function currentDayLook(): DayLook { return current }

export function setDayLook(look: DayLook) {
  current = look
  listeners.forEach((f) => f())
}

export function subscribeDayLook(f: () => void): () => void {
  listeners.add(f)
  return () => { listeners.delete(f) }
}
