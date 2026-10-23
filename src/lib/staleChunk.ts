/**
 * A SCREEN FROM A VERSION THAT NO LONGER EXISTS, MET BY RELOADING ONCE (23 Oct).
 *
 * The firm, on a call: "If she clicks on any tab, it just shows this" -- "Failed to fetch
 * dynamically imported module .../CalendarPage-DDBKRqOI.js" on React Router's developer error page.
 * Every screen behind a lazy() import is a file named by its content's hash. A deploy replaces
 * those files; a tab opened before it still asks for the old names, and Vercel no longer has them.
 * NewVersionWatcher reloads an idle page, but it deliberately waits while somebody is typing or in
 * a modal -- which is most of a call -- so the tab lived on until the next click found nothing.
 *
 * The answer is the newest version, so the page reloads -- ONCE. A second failure within the
 * window is not staleness (Vercel down, the network gone), and a reload loop would leave the person
 * staring at a flicker; it falls to the error screen instead, which says what to do.
 *
 * Pure apart from the storage, and the storage is guarded: a private window still gets the screen.
 */
const KEY = 'raptor.chunkReloadAt'
/** Long enough to cover a reload and the first click after it; short enough that tomorrow's deploy reloads again. */
export const RELOAD_WINDOW_MS = 30_000

/** Is this the error a missing hashed chunk throws, in any browser? */
export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError/i
    .test(message)
}

/** Reload unless one was tried moments ago. Returns whether it reloaded. */
export function reloadOnceForStaleChunk(now = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (now - last < RELOAD_WINDOW_MS) return false
    sessionStorage.setItem(KEY, String(now))
  } catch {
    return false
  }
  window.location.reload()
  return true
}
