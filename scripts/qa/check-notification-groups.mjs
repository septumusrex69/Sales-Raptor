/**
 * THE BELL: ONE LINE PER THING, A REAL DATE AND TIME, AND OPENING THE THING READS IT (S14, Raptor H13).
 *
 * The firm, 27 Oct: every notification said "just now" (aged against the staging clock while
 * stamped on the real one), two replies on R-6 were two lines, and R-8 stayed unread after it had
 * been opened and approved. See src/lib/notificationGroups.ts.
 *
 * Run: node scripts/qa/check-notification-groups.mjs
 */
import { readFileSync } from 'node:fs'
import { groupNotifications, linkIsOpen, notificationWhen } from '../../src/lib/notificationGroups.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`)
}
const n = (id, at, link, read = false) => ({ id, type: 'change_request.reply', message: `m-${id}`, createdAt: at, read, link })

const groups = groupNotifications([
  n('a', '2026-10-27T05:43:50Z', '/requests?r=6'),
  n('b', '2026-10-27T05:43:51Z', '/requests?r=6', true),
  n('c', '2026-10-27T05:39:00Z', '/requests?r=8'),
  n('d', '2026-10-26T10:00:00Z', undefined, true),
  n('e', '2026-10-26T09:00:00Z', undefined),
])
check('one line per link, newest first; no link stands alone', groups.map((g) => g.key), ['link:/requests?r=6', 'link:/requests?r=8', 'id:d', 'id:e'])
check('...the line is the newest message, and says how many more', [groups[0].latest.id, groups[0].more, groups[0].ids], ['b', 1, ['b', 'a']])
check('...and is unread while ANY of it is', [groups[0].unread, groups[2].unread], [1, 0])

check('a link is open on its own address', linkIsOpen('/requests?r=8', '/requests', '?r=8'), true)
check('...with other parameters beside it', linkIsOpen('/requests?r=8', '/requests', '?view=list&r=8'), true)
check('...not on another request', linkIsOpen('/requests?r=8', '/requests', '?r=18'), false)
check('...not on the list without one', linkIsOpen('/requests?r=8', '/requests', ''), false)
check('...not on another page', linkIsOpen('/requests?r=8', '/accounts', '?r=8'), false)
check('...a plain path link is open on its path', linkIsOpen('/companies/c1', '/companies/c1', '?tab=Notes'), true)
check('...and no link is never open', linkIsOpen(undefined, '/requests', '?r=8'), false)

/* 27 Oct 09:00 SAST, the moment "now" is pinned to below. */
const NOW = Date.parse('2026-10-27T07:00:00Z')
check('today says Today and the time, in Johannesburg', notificationWhen('2026-10-27T05:39:00Z', NOW), 'Today 07:39')
check('...yesterday says so', notificationWhen('2026-10-26T12:36:00Z', NOW), 'Yesterday 14:36')
check('...an older one its date', notificationWhen('2026-10-23T08:05:00Z', NOW), '23 Oct 10:05')
check('...another year its year', notificationWhen('2025-12-30T08:05:00Z', NOW), '30 Dec 2025 10:05')
check('...00:30 SAST is today though UTC still says yesterday', notificationWhen('2026-10-26T22:30:00Z', NOW), 'Today 00:30')
check('...and never "just now": the old bug was a future time against the staging clock', /just now/.test(notificationWhen('2026-10-27T06:59:59Z', NOW)), false)

const menu = readFileSync(new URL('../../src/components/layout/NotificationsMenu.tsx', import.meta.url), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
check('the menu draws groups, on the real clock', [/groupNotifications\(notifications\)/.test(menu), /notificationWhen\(g\.latest\.createdAt, Date\.now\(\)\)/.test(menu), /timeAgo/.test(menu)], [true, true, false])
check('...and marks read what the page has open', /linkIsOpen\(n\.link, location\.pathname, location\.search\)\) \{\s*marked\.current\.add\(n\.id\)\s*markNotificationRead\(n\.id\)/.test(menu), true)

if (failures.length) {
  console.log(`check-notification-groups: ${pass} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-notification-groups: ${pass} passed, 0 failed`)
