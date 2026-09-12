/**
 * How a person likes to read email in Raptor.
 *
 * One preference for every surface that shows email — the mailbox, a debtor account, a client, a
 * lead, a deal. Somebody who thinks in a reading pane thinks that way everywhere, and having to
 * set it four times would be four chances to find it set the other way.
 *
 * Stored per browser rather than per user row. It is a preference about eyes and a screen, not a
 * fact about a person: the same collector on a laptop and on an iPad may well want different
 * answers, and a round trip to save it would be a round trip to save nothing.
 */
import { useCallback, useEffect, useState } from 'react'

export type EmailView =
  /** Rows in one column; opening one expands it in place. */
  | 'list'
  /** Outlook's shape: the list down the left, the message you picked beside it. */
  | 'reading'

const KEY = 'raptor.email.view'

/**
 * The event that keeps two switchers in step.
 *
 * `storage` only fires in OTHER tabs, so without this a page showing the switcher twice — or a
 * page and a panel — would have one of them stuck showing the old choice until a reload.
 */
const CHANGED = 'raptor:email-view'

export function storedEmailView(): EmailView {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'list' || saved === 'reading') return saved
  } catch { /* private window, or storage switched off. The default is fine. */ }
  return 'list'
}

export function useEmailView(): [EmailView, (next: EmailView) => void] {
  const [view, setView] = useState<EmailView>(storedEmailView)

  useEffect(() => {
    const sync = () => setView(storedEmailView())
    window.addEventListener(CHANGED, sync)
    // A change made in another tab.
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CHANGED, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const choose = useCallback((next: EmailView) => {
    setView(next)
    try { localStorage.setItem(KEY, next) } catch { /* nothing to remember it with. */ }
    window.dispatchEvent(new Event(CHANGED))
  }, [])

  return [view, choose]
}
