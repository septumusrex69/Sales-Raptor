/**
 * HAS TODAY'S PHOTOGRAPH ARRIVED? (S19 · Raptor H18). Stephan, 8 Nov: "The pictures still keep hopping for the daily
 * thing. It would show yesterday's picture or something, and then another one ... from the dashboard and ... the hero
 * panes."
 *
 * S18 stopped the wrong photograph being painted while today's ANSWER was out. What was left was the photograph
 * ITSELF: every slot painted `url(today), url(Llandudno)` -- Llandudno underneath as a safety net -- and Llandudno is
 * Raptor's own file, there at once, while today's came from Unsplash a second later. So every page opened on
 * Llandudno and then changed. And the dashboard asked for 3 200 pixels where the bands asked for 2 400: two downloads,
 * two hops.
 *
 * So the photograph is fetched ONCE, off-screen, at one size; the bands stay plain navy until it has arrived, then it
 * goes on everywhere at once; Llandudno only when it FAILED. Remembered on the device per URL, so the next page and
 * the next visit -- the browser has it cached -- paint it on the first frame.
 */
export type PhotoState = 'loaded' | 'failed' | 'loading'

const state = new Map<string, PhotoState>()
const KEY = 'raptor.dayPhotoLoaded'

function remembered(url: string): boolean {
  try { return window.localStorage.getItem(KEY) === url } catch { return false }
}

/** Where today's photograph stands. Undefined: nobody has asked for it yet. */
export function photoState(url: string): PhotoState | undefined {
  return state.get(url) ?? (remembered(url) ? 'loaded' : undefined)
}

/**
 * Fetch it off-screen, once, and call `done` when it has arrived or failed. Without a browser (the checks) nothing is
 * fetched and it stays 'loading'.
 */
export function loadPhoto(url: string, done: () => void): void {
  if (state.has(url)) return
  state.set(url, 'loading')
  if (typeof Image === 'undefined') return
  const img = new Image()
  img.onload = () => {
    state.set(url, 'loaded')
    try { window.localStorage.setItem(KEY, url) } catch { /* a convenience */ }
    done()
  }
  img.onerror = () => { state.set(url, 'failed'); done() }
  img.src = url
}

/** For the checks. */
export function setPhotoStateForTest(url: string, s: PhotoState | null) {
  if (s) state.set(url, s); else state.delete(url)
}
