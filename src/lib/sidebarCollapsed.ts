import { useCallback, useEffect, useState } from 'react'

/**
 * Whether the sidebar is folded down to a rail.
 *
 * THE FIRM ASKED FOR IT while working in the library: "if that thing can collapse that sidebar it
 * could be easier to work on this... so if you want to be working on a bigger screen or something
 * like that it could be beneficial." The library is a two-column screen inside a two-column app,
 * and on an iPad the 240px of nav is the difference between reading a letter and scrolling one.
 *
 * REMEMBERED, because a preference that resets on every page load is not a preference. It lives
 * in localStorage rather than in the profile: it is about the screen somebody is sitting at, and
 * the same person on a phone and on a desktop wants different answers.
 *
 * Shared through a window event rather than context, for the same reason the theme stamp is:
 * anything that re-renders the whole tree to answer "is the nav narrow" pays for that on every
 * page, and two components need this — the sidebar itself and nothing else, today.
 */
const KEY = 'crm.sidebar.collapsed'
const CHANGED = 'raptor:sidebar-collapsed'

function read(): boolean {
  // Storage can be blocked outright in a private window, and the default is still the right
  // answer — a sidebar that fails to open is worse than one that fails to remember.
  try { return window.localStorage.getItem(KEY) === '1' } catch { return false }
}

export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(read)

  useEffect(() => {
    const onChanged = () => setCollapsed(read())
    window.addEventListener(CHANGED, onChanged)
    /* Another tab folding its nav should not fold this one's — but coming BACK to a tab that has
       been open for a day and finding it disagrees with every other tab is worse. */
    window.addEventListener('storage', onChanged)
    return () => {
      window.removeEventListener(CHANGED, onChanged)
      window.removeEventListener('storage', onChanged)
    }
  }, [])

  const toggle = useCallback(() => {
    const next = !read()
    try { window.localStorage.setItem(KEY, next ? '1' : '0') } catch { /* not worth an error */ }
    window.dispatchEvent(new Event(CHANGED))
  }, [])

  return [collapsed, toggle]
}
