/**
 * The three numbers the sidebar wears.
 *
 * One rule decides what belongs here: a badge earns its place only if it counts something ONE
 * PERSON CAN CLEAR TODAY. A number that counts everything the firm has open never reaches zero,
 * and a number that never reaches zero stops being read inside a week — at which point every
 * other badge stops being read with it.
 *
 * So: unread debtor mail waiting to be filed, my tasks due by tonight, and disputes waiting on
 * me. Not Accounts (a catalogue of 100 000), not Leads, not Deals, not Clients.
 *
 * One round trip, not three. Three count queries would be three trips to Paris on every page
 * load for 50 people to render three small numbers; nav_counts() returns all of them at once and
 * scopes each to the caller in SQL.
 */
import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from './supabase'

export interface NavCounts {
  mail: number
  tasks: number
  disputes: number
}

const EMPTY: NavCounts = { mail: 0, tasks: 0, disputes: 0 }

/** Fired by a page that has just changed one of these, so the badge drops without a reload. */
export const NAV_COUNTS_CHANGED = 'raptor:nav-counts'

export function refreshNavCounts(): void {
  // Guarded because the data modules that call this (userMail, accountQueries, the store) are
  // also loadable outside a browser — a QA script importing one must not die on `window`.
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(NAV_COUNTS_CHANGED))
}

/** How often the badges catch up on their own — mail arrives while somebody is reading a page. */
const POLL_MS = 120_000

export function useNavCounts(): NavCounts {
  const [counts, setCounts] = useState<NavCounts>(EMPTY)
  const { pathname } = useLocation()

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('nav_counts').single<NavCounts>()
    // A count we could not read is not worth an error on the chrome of every page. The badges
    // keep their last value rather than flashing to zero and back.
    if (!error && data) {
      setCounts({
        mail: Number(data.mail ?? 0),
        tasks: Number(data.tasks ?? 0),
        disputes: Number(data.disputes ?? 0),
      })
    }
  }, [])

  // On mount, whenever the page changes — reading your mail and coming back should show the
  // number down — on an explicit refresh, and slowly on a timer for what arrives meanwhile.
  useEffect(() => { void load() }, [load, pathname])
  useEffect(() => {
    const onChanged = () => void load()
    window.addEventListener(NAV_COUNTS_CHANGED, onChanged)
    const timer = setInterval(() => void load(), POLL_MS)
    return () => {
      window.removeEventListener(NAV_COUNTS_CHANGED, onChanged)
      clearInterval(timer)
    }
  }, [load])

  return counts
}
