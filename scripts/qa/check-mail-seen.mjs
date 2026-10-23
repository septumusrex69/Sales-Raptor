/**
 * MAIL ALREADY READ IN THE MAILBOX ARRIVES READ (S10, 22 Oct).
 *
 * The firm: a new user's mailbox synced and everything showed unread. Sync never fetched the IMAP
 * \Seen flag. Holds: the sync fetch asks for flags, \Seen is passed on, and read_at is set from it
 * (as well as for sent mail).
 *
 * Run: node scripts/qa/check-mail-seen.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, v) => { if (v === true) pass += 1; else failures.push(name) }
const src = readFileSync(new URL('../../api/_lib/emailSync.ts', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

ok('the sync fetch asks the server for the flags', /fetchOne\(String\(uid\), \{ source: true, flags: true \}, \{ uid: true \}\)/.test(src))
ok('...passes \\Seen on with the message', /seen: msg\.flags\?\.has\('\\\\Seen'\) \?\? false/.test(src))
ok('...and a seen message is stored read', /read_at: \(message\.isSent \|\| message\.seen\) \?/.test(src))

if (failures.length) {
  console.error(`check-mail-seen: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-mail-seen: ${pass} passed, 0 failed`)
