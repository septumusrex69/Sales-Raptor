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

/* S11: READ ELSEWHERE AFTERWARDS IS READ HERE. The firm: "mail read on the phone also should show
   as read on Raptor." One IMAP search per folder per sync, the last READ_CATCH_UP_DAYS, one way. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
ok('each sync asks the folder which recent messages are \\Seen',
  /client\.search\(\{ seen: true, since \}, \{ uid: true \}\)/.test(code) && /READ_CATCH_UP_DAYS = 14/.test(code))
ok('...and marks only those rows, only where still unread',
  /\.eq\('user_id', userId\)\.eq\('folder', path\)\.is\('read_at', null\)\.in\('uid', /.test(code))
ok('...never un-reads anything', !/read_at: null\s*\}\)\s*\.eq\('user_id', userId\)/.test(code))
ok('...on an ordinary sync of a received folder, not Sent or a first read',
  /if \(!isSent && !firstRead && sinceUid\) await catchUpReadFlags\(client, admin, conn\.user_id, path\)/.test(code)
  && code.indexOf('await catchUpReadFlags(') < code.indexOf('return { logged, maxUid }'))
ok('...and a failure is logged, never thrown', /async function catchUpReadFlags[\s\S]*?\} catch \(e\) \{[\s\S]*?console\.log/.test(code))
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
ok('...with an index over the unread rows it updates',
  /create index if not exists user_emails_unread_by_folder\s+on public\.user_emails \(user_id, folder, uid\) where read_at is null/.test(schema))

if (failures.length) {
  console.error(`check-mail-seen: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-mail-seen: ${pass} passed, 0 failed`)
