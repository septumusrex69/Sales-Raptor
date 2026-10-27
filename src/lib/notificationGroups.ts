/**
 * The bell, read as a list of THINGS rather than a list of messages (S14, Raptor H13).
 *
 * THE FIRM, looking at the bell on 27 Oct: every line said "just now"; R-6 was there twice (two
 * replies from Rinda, each its own line); and R-8 still showed as unread after Stephan had opened
 * it and approved it -- "the notifications are not linked to the actions". Three rules follow, and
 * they are kept here, apart from the menu, so a check can hold them.
 */
import type { AppNotification } from '../types'

/*
 * ONE LINE PER THING, AND THE LINK IS WHAT A THING IS. Every notification about one request opens
 * the same `/requests?r=N`; every one about one account opens that account. So notifications that
 * share a link are one line: the newest message, how many more, unread while any of them is. A
 * notification with no link stands alone -- there is nothing to say it is about the same thing as
 * another.
 */
export interface NotificationGroup {
  key: string
  /** The newest notification in the group: its message is the line. */
  latest: AppNotification
  /** Every id in the group, newest first -- pressing the line marks them all read. */
  ids: string[]
  /** How many besides the newest. */
  more: number
  unread: number
}

export function groupNotifications(list: AppNotification[]): NotificationGroup[] {
  const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const groups = new Map<string, NotificationGroup>()
  for (const n of sorted) {
    const key = n.link ? `link:${n.link}` : `id:${n.id}`
    const g = groups.get(key)
    if (!g) groups.set(key, { key, latest: n, ids: [n.id], more: 0, unread: n.read ? 0 : 1 })
    else { g.ids.push(n.id); g.more += 1; if (!n.read) g.unread += 1 }
  }
  /* Map keeps insertion order, and insertion was newest first: a group sits where its newest is. */
  return [...groups.values()]
}

/*
 * OPENING THE THING READS ITS NOTIFICATIONS. A link is open when the page is on its path and every
 * parameter it names is on the address with the same value -- /requests?r=8 is open on
 * /requests?view=list&r=8, and not on /requests?r=18. Acting on a request means opening it first,
 * so this is what ties the bell to the action without every button having to know the bell exists.
 */
export function linkIsOpen(link: string | undefined, pathname: string, search: string): boolean {
  if (!link) return false
  const [path, query = ''] = link.split('?')
  if (path !== pathname) return false
  const here = new URLSearchParams(search)
  for (const [k, v] of new URLSearchParams(query)) if (here.get(k) !== v) return false
  return true
}

/*
 * A DATE AND A TIME, ON THE REAL CLOCK. Every line said "just now" because the age was measured
 * from the app's TODAY, which on staging is the staging clock (23 Oct) -- and a notification is
 * stamped by the database on the REAL clock (27 Oct), so each one looked four days in the future
 * and came out as "just now". A notification is a thing that happened, at a time; it is told on
 * the clock it happened on. Johannesburg's day, so a 01:30 message is not "yesterday" because the
 * server runs on UTC.
 */
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' })
const TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false })
const DATE = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short' })
const DATE_YEAR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric' })

export function notificationWhen(iso: string, nowMs: number): string {
  const at = new Date(iso)
  const day = DAY.format(at)
  const today = DAY.format(new Date(nowMs))
  const yesterday = DAY.format(new Date(nowMs - 24 * 60 * 60 * 1000))
  const time = TIME.format(at)
  if (day === today) return `Today ${time}`
  if (day === yesterday) return `Yesterday ${time}`
  return `${(day.slice(0, 4) === today.slice(0, 4) ? DATE : DATE_YEAR).format(at)} ${time}`
}
