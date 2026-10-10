import { useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * "BACK" GOES WHERE YOU CAME FROM, AND SAYS SO.
 *
 * The firm, 10 Oct, on a debtor's account (Kagiso Mokoena): clicking the client opened the client
 * page with "Back to Clients" -- "if you take that route from the [debtor] to the client, you
 * should be able to go back to the [debtor] ... go back to Kagiso or whatever." A fixed back link
 * names the list the page lives in; the person came from somewhere else.
 *
 * HOW. AppLayout calls `notePage` on every route change with the bar's title; a record page calls
 * `useRecordName` with its own name (a debtor, a client, a run number), which replaces the bar's
 * generic "Account" for that address. `useBackLink` captures, on the FIRST render of an address,
 * the page shown before it -- AppLayout's effect has not yet run for the new address, so the
 * remembered page is still the one we came from -- and offers it, or the list it lives in when
 * the page was opened directly (a link in an email, a refresh) or from itself.
 *
 * Module state, not context: it is one browser tab's memory of where it has been, nothing else
 * reads it, and a refresh losing it is the right behaviour (the default link is then correct).
 */

const names = new Map<string, string>()
/* The page on screen: its path (what names are kept by) and its full address, filters included,
   so going back to a filtered list lands on the same filter. */
let shown: { path: string; full: string } | null = null

/** AppLayout, on every route change: the address now on screen and the bar's title for it. */
export function notePage(path: string, search: string, title: string): void {
  if (!names.has(path) && title) names.set(path, title)
  shown = { path, full: path + search }
}

/** A record page's own name for its address -- "Kagiso Mokoena", "Highveld Tyre Services CC". */
export function useRecordName(name: string | null | undefined): void {
  const { pathname } = useLocation()
  useEffect(() => { if (name) names.set(pathname, name) }, [pathname, name])
}

/**
 * Where "back" goes: the page this one was opened from, or `fallback` when there is none worth
 * naming. `label` is what the link says.
 */
export function useBackLink(fallback: { to: string; label: string }): { to: string; label: string } {
  const { pathname } = useLocation()
  /* Captured once per address: see the file comment for why `shown` is still the previous page. */
  const from = useMemo(() => (shown && shown.path !== pathname ? shown : null), [pathname])
  if (!from) return fallback
  /* Came from the list itself: its own words, but back to the same filter. */
  if (from.path === fallback.to) return { to: from.full, label: fallback.label }
  const name = names.get(from.path)
  return name ? { to: from.full, label: `Back to ${name}` } : fallback
}
