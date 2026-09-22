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
 * page.
 *
 * NOW TAKES A KEY, because there is a second pane. THE FIRM: "the pane on the left hand side has
 * been collapsed, but now that you've got all these other settings, that pane should also be able
 * to collapse, because now the screen is getting small." Settings is a two-column screen inside
 * the two-column app, so on an iPad the handover table was reading through about 450px of nav.
 *
 * ONE KEY EACH, AND ONE EVENT EACH. Sharing the event would fold both panes on either press and
 * sharing the key would make them one preference, and they are not: somebody folds the settings
 * menu to read a forty-column table and still wants the main menu where it was.
 */
const CHANGED = (key: string) => `raptor:collapsed:${key}`

function read(key: string): boolean {
  // Storage can be blocked outright in a private window, and the default is still the right
  // answer — a pane that fails to open is worse than one that fails to remember.
  try { return window.localStorage.getItem(key) === '1' } catch { return false }
}

/** Whether the pane stored under `key` is folded, and a toggle for it. */
export function useCollapsed(key: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => read(key))

  useEffect(() => {
    /* Re-read on the way in as well as on the event: the key can change between renders, and a
       hook that only listened would show the previous pane's answer until something moved. */
    setCollapsed(read(key))
    const onChanged = () => setCollapsed(read(key))
    window.addEventListener(CHANGED(key), onChanged)
    /* Another tab folding its nav should not fold this one's — but coming BACK to a tab that has
       been open for a day and finding it disagrees with every other tab is worse. */
    window.addEventListener('storage', onChanged)
    return () => {
      window.removeEventListener(CHANGED(key), onChanged)
      window.removeEventListener('storage', onChanged)
    }
  }, [key])

  const toggle = useCallback(() => {
    const next = !read(key)
    try { window.localStorage.setItem(key, next ? '1' : '0') } catch { /* not worth an error */ }
    window.dispatchEvent(new Event(CHANGED(key)))
  }, [key])

  return [collapsed, toggle]
}

/** The main menu. Its key is unchanged, so nobody's folded sidebar springs open on deploy. */
export function useSidebarCollapsed(): [boolean, () => void] {
  return useCollapsed('crm.sidebar.collapsed')
}

/** The settings menu, folded separately from the main one. */
export function useSettingsNavCollapsed(): [boolean, () => void] {
  return useCollapsed('crm.settingsNav.collapsed')
}
