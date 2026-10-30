/**
 * A MESSAGE CAN BE DONE, AND DONE MAIL LEAVES THE INBOX (S16, Raptor · Handover 15).
 *
 * Stephan, of the staff: "what they want is if an email has been dealt with ... that it's archived ...
 * completed or responded to ... they want their inboxes to show that it's empty ... that's how they used
 * to working." He approved the design ("go ahead with done button"): Done is its own fact beside read,
 * done mail leaves All for a Done tab, search still finds it, Not done puts it back, filing can mark it
 * done in the same step, the sidebar badge leaves it out, and nothing reaches the mail server.
 *
 * What is held here, and the failure each one stops:
 *  - All excludes done and Done includes only done -- or the inbox never empties, or Done shows the inbox.
 *  - tabOf agrees, done after junk and sent -- or a link that names a done message opens All and finds nothing.
 *  - nav_counts (the LAST definition: schema.sql is append-only) excludes done -- or the sidebar says 3
 *    over an inbox the person has just cleared.
 *  - the sync never writes done_at and never overwrites a row -- or a re-sync puts done mail back.
 *  - the columns, the constraint and the indexes are in schema.sql -- or the file lies about staging.
 *  - match-and-done exists, in the same claiming update, and plain filing writes no done column.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-mail-done.mjs
 */
import fs from 'node:fs'
import { bumpUnread, tabOf } from '../../src/lib/emailRules.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`)
}
const ok = (name, cond) => check(name, !!cond, true)
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
const sqlStrip = (src) => src.replace(/--.*$/gm, '')

/* ---------- 1. the rule, exercised: which tab a message is on ---------- */

const mail = (over) => ({ isSent: false, isJunk: false, doneAt: null, ...over })
const at = '2026-10-29T08:00:00Z'
check('an ordinary message is in All', tabOf(mail({})), 'all')
check('a done message is in Done', tabOf(mail({ doneAt: at })), 'done')
check('...but done junk is still Junk -- Done is All\'s other half, not a fourth folder', tabOf(mail({ isJunk: true, doneAt: at })), 'junk')
check('...and done sent mail is still Sent', tabOf(mail({ isSent: true, doneAt: at })), 'sent')
const zero = { all: 0, done: 0, junk: 0, sent: 0 }
const moved = bumpUnread(bumpUnread({ ...zero, all: 1 }, mail({}), -1), mail({ doneAt: at }), 1)
check('marking an unread message done moves its unread off All', moved.all, 0)
check('...and onto Done, where nothing shows it', moved.done, 1)

/* ---------- 2. the clause builder ---------- */

const userMail = strip(fs.readFileSync('src/lib/userMail.ts', 'utf8'))
const allClause = /input\.filter === 'all'\) out = out([^\n]*)/.exec(userMail)?.[1] ?? ''
const doneClause = /input\.filter === 'done'\) out = out([^\n]*)/.exec(userMail)?.[1] ?? ''
ok('All has a clause', allClause.length > 0)
ok('...which leaves done mail out', /\.is\('done_at', null\)/.test(allClause))
ok('...still beside the junk and sent exclusions', /\.eq\('is_junk', false\)/.test(allClause) && /\.eq\('is_sent', false\)/.test(allClause))
ok('Done has a clause', doneClause.length > 0)
ok('...which holds only done mail', /\.not\('done_at', 'is', null\)/.test(doneClause))
ok('...and only mail that would otherwise be in All', /\.eq\('is_junk', false\)/.test(doneClause) && /\.eq\('is_sent', false\)/.test(doneClause))
/* NOTHING IS LOST: a search that reaches the whole mailbox applies no tab clause, done included. */
ok('a whole-mailbox search applies no tab clause, so done mail is found',
  /if \(wholeMailbox\) \{\s*\}\s*else if \(input\.filter === 'sent'\)/.test(userMail))
ok('Done is counted with the other tabs', /const tabs: MailFilter\[\] = \[[^\]]*'done'/.test(userMail))
ok('the list reads done_at', /read_at, done_at,/.test(userMail) && /doneAt: r\.done_at/.test(userMail))

/* Done and not done write the column, and only on rows that change. */
const markDone = userMail.slice(userMail.indexOf('export async function markMailDone'), userMail.indexOf('export async function markMailNotDone'))
const markNotDone = userMail.slice(userMail.indexOf('export async function markMailNotDone'), userMail.indexOf('export async function deleteMail'))
ok('marking done sets when and who', /done_at: new Date\(\)\.toISOString\(\), done_by: actorId/.test(markDone))
ok('...only on rows not already done', /\.is\('done_at', null\)/.test(markDone))
ok('...and the sidebar follows', /refreshNavCounts\(\)/.test(markDone))
ok('not done clears both', /done_at: null, done_by: null/.test(markNotDone))
ok('...and the sidebar follows', /refreshNavCounts\(\)/.test(markNotDone))
/* READ IS NOT DONE: neither function touches read_at, and marking read does not touch done. */
ok('done does not change read', !/read_at/.test(markDone + markNotDone))
const markRead = userMail.slice(userMail.indexOf('export async function markMailRead'), userMail.indexOf('export async function markMailUnread'))
ok('...nor read change done', markRead.length > 0 && !/done_at/.test(markRead))

/* ---------- 3. file and mark done ---------- */

const linkAcc = userMail.slice(userMail.indexOf('export async function linkMailToAccount'), userMail.indexOf('async function fileOnAccount'))
const linkRec = userMail.slice(userMail.indexOf('export async function linkMailToRecord'), userMail.indexOf('export async function setJunk'))
ok('filing to an account can mark done', /markDone\?: boolean/.test(linkAcc))
ok('...in the same claiming update as the link', /\.update\(\{\s*\.\.\.doneFields\(input\.markDone, input\.actor\.id\),\s*linked_account_id/.test(linkAcc))
ok('filing to a record can mark done', /markDone\?: boolean/.test(linkRec))
ok('...in the same claiming update', /\.update\(\{\s*\.\.\.doneFields\(input\.markDone, input\.actor\.id\),\s*\[column\]/.test(linkRec))
ok('plain filing writes no done column at all', /return markDone \? \{ done_at: new Date\(\)\.toISOString\(\), done_by: actorId \} : \{\}/.test(userMail))
const page = strip(fs.readFileSync('src/pages/mail/MailPage.tsx', 'utf8'))
ok('the match box offers it', /data-testid="mail-match-done"/.test(page))
ok('...on by default, off when opened by Reply', /useState\(!replying && !mail\.isJunk && !mail\.isSent && !mail\.doneAt\)/.test(page))
ok('...and both ways of filing honour it',
  /linkMailToRecord\(\{ mail, to: hit, actor, markDone: doneOffered && alsoDone \}\)/.test(page)
  && /linkMailToAccount\(\{ mail, accountId, actor, queryId: ticketId, markDone: doneOffered && alsoDone \}\)/.test(page))

/* ---------- 4. the screen ---------- */

/* Called ARCHIVE since 30 Oct, and to the right of Drafts (Stephan: "instead of done, just say archive and just put it
   to the right of drafts. Still don't know how to archive something."). */
ok('there is an Archive tab', /\{ id: 'done', label: 'Archive',/.test(page))
ok('...and no tab or button is called Done', !/label: 'Done'/.test(page) && !/label="Mark done"/.test(page) && !/label="Not done"/.test(page))
ok('...to the right of Drafts', /style=\{\{ order: t\.id === 'done' \? 2 : 0 \}\}/.test(page) && /data-testid="mail-drafts-tab" style=\{\{ order: 1 \}\}/.test(page))
ok('...with no unread badge', /const n = t\.id === 'blocked' \|\| t\.id === 'done' \? 0/.test(page))
ok('the open message offers Archive and Move to inbox, on its bar', /label="Archive"/.test(page) && /label="Move to inbox"/.test(page))
ok('...and at its top, in words', /data-testid="mail-archive"/.test(page))
ok('...and so does the list row', /data-testid="mail-row-archive"/.test(page))
ok('...and a selection', /doneChosen\(true\)/.test(page) && /doneChosen\(false\)/.test(page))
ok('...never on junk or sent', /const canBeDone = \(m: MailItem\) => !m\.isJunk && !m\.isSent/.test(page))
ok('leaving a selection is no longer called Done', !/selecting \? 'Done'/.test(page))

/* ---------- 5. the sync cannot undo it, and new mail is never done ---------- */

for (const f of ['api/_lib/emailSync.ts', 'api/_lib/email/send.ts']) {
  const src = strip(fs.readFileSync(f, 'utf8'))
  ok(`${f} was read`, /from\('user_emails'\)/.test(src))
  ok(`${f} never writes done_at`, !/done_at|done_by/.test(src))
}
const sync = strip(fs.readFileSync('api/_lib/emailSync.ts', 'utf8'))
const upsert = sync.slice(sync.indexOf(".from('user_emails')\n    .upsert("), sync.indexOf('.select(', sync.indexOf(".from('user_emails')\n    .upsert(")))
ok('the sync\'s insert is found', upsert.length > 0)
ok('...and leaves an existing row alone, so a re-sync cannot put done mail back', /ignoreDuplicates: true/.test(upsert))

/* ---------- 6. the database ---------- */

const schema = fs.readFileSync('supabase/schema.sql', 'utf8')
const mig = sqlStrip(schema.slice(schema.lastIndexOf('-- user_emails_done (S16')))
ok('the migration is mirrored', mig.length > 0 && schema.lastIndexOf('-- user_emails_done (S16') > -1)
ok('done_at is added', /add column if not exists done_at timestamptz/.test(mig))
ok('...with no default, so new mail is never done', !/done_at timestamptz[^,\n]*default/.test(mig))
ok('done_by is added, pointing at a profile', /add column if not exists done_by uuid references public\.profiles\(id\)/.test(mig))
ok('...and who needs when', /check \(done_at is not null or done_by is null\)/.test(mig))
ok('the inbox has an index shaped to it', /on public\.user_emails \(user_id, occurred_at desc\)\s*where done_at is null and is_junk = false and is_sent = false/.test(mig))

/* THE LAST DEFINITION IS THE LIVE ONE (CLAUDE.md): read the last create-or-replace, never the bare name. */
const navAt = schema.lastIndexOf('create or replace function public.nav_counts()')
ok('nav_counts is found', navAt > -1)
const nav = sqlStrip(schema.slice(navAt, schema.indexOf('$$;', navAt)))
const mailCount = nav.slice(nav.indexOf('from public.user_emails'), nav.indexOf('from public.tasks'))
ok('the badge reads user_emails', mailCount.length > 0)
ok('...leaving done mail out', /and done_at is null/.test(mailCount))
ok('...still unread, unsent, not junk, and mine',
  /read_at is null/.test(mailCount) && /is_sent = false/.test(mailCount) && /is_junk = false/.test(mailCount) && /user_id = auth\.uid\(\)/.test(mailCount))
ok('...and its signature unchanged, which Postgres would refuse to alter',
  /returns table \(mail integer, tasks integer, disputes integer, diary integer\)/.test(nav))

if (failures.length) {
  console.log(`check-mail-done: ${pass} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-mail-done: ${pass} passed, 0 failed`)
