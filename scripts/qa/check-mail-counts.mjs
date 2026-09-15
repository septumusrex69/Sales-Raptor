/**
 * One definition of "unread mail", in three files that have to agree.
 *
 * WHAT WENT WRONG, and what this exists to stop happening again. The sidebar said 17 unread, the
 * Mail page showed no unread anywhere, and the No record needed tab was full of messages nobody
 * had put there. Three symptoms, one cause: three different answers to "what is unread work",
 * written in three places, none of which knew about the others.
 *
 *   nav_counts()           -- the sidebar badge: unread, not junk ... and counted sent mail
 *   countNeedsFiling()     -- the Mail page badge: unsettled AND unread
 *   scope('needs-filing')  -- the tab's own list: unsettled, read or not
 *
 * On the firm's own mailbox all 17 were their own sent messages and their real unread count was
 * nought. The badge could not be cleared by reading anything, because none of it was mail they
 * had received.
 *
 * So the rule this file enforces: the SQL in mail_unread_counts() and the clauses in scope() are
 * the same question asked in two languages, and the sidebar is the All tab's number. Break either
 * and the symptom is the one src/lib/userMail.ts warns about in scope() — a badge saying 3 over a
 * list of 5 — which nobody reports as a bug because it looks like they miscounted.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-mail-counts.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const mail = readFileSync(new URL('../../src/lib/userMail.ts', import.meta.url), 'utf8')
const sync = readFileSync(new URL('../../api/_lib/emailSync.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../../src/pages/mail/MailPage.tsx', import.meta.url), 'utf8')

/** Collapse runs of whitespace, so a reformatted clause is still the same clause. */
const flat = (s) => s.replace(/\s+/g, ' ')

/**
 * The body of the LAST definition of a function in an append-only schema.
 *
 * Last, not first: schema.sql is appended to, so an earlier `create or replace` of the same name
 * is history and the final one is what the database actually runs. Reading the first would have
 * this checking a definition that was replaced three migrations ago.
 */
function functionBody(name) {
  const head = `create or replace function public.${name}(`
  const at = schema.lastIndexOf(head)
  if (at === -1) return null
  const closed = schema.indexOf('$$;', at)
  if (closed === -1) return null
  // From the signature, not from `as $$`: the column names this checks are declared in
  // `returns table (...)`, which is above the body and would otherwise be invisible here.
  return schema.slice(at, closed)
}

/* ------------------------------------------------------------------ *
 * The sidebar badge
 * ------------------------------------------------------------------ */

const nav = functionBody('nav_counts')
// Presence BEFORE anything about its contents. Without this, deleting nav_counts outright would
// leave every assertion below reading `null`, and a check that passes because the thing it
// guards is gone is worse than no check at all.
ok('nav_counts is still defined in the schema', nav !== null)

if (nav) {
  /*
   * The mail clause only. nav_counts also counts tasks, disputes and the diary, and a bare
   * search of the whole body would happily find `is_sent = false` in somebody else's subquery.
   */
  const mailClause = flat(nav).split('from public.').find((part) => part.startsWith('user_emails'))
  ok('nav_counts counts user_emails', mailClause !== undefined)
  if (mailClause) {
    ok('the sidebar counts unread mail', mailClause.includes('read_at is null'))
    ok('...excluding junk, which is not work', mailClause.includes('is_junk = false'))
    // THE BUG. A badge that counts the mail you sent is a badge counting your own work back at
    // you, and no amount of reading mail will ever clear it.
    ok('...and excluding what you sent, which you have read by writing it',
      mailClause.includes('is_sent = false'))
    ok('...and only ever your own mail', mailClause.includes('user_id = auth.uid()'))
  }
}

/* ------------------------------------------------------------------ *
 * The per-tab counts, against scope()
 * ------------------------------------------------------------------ */

const counts = functionBody('mail_unread_counts')
ok('mail_unread_counts is defined in the schema', counts !== null)

const countsFlat = counts ? flat(counts) : ''
if (counts) {
  ok('the tab counts are unread only', countsFlat.includes('read_at is null'))
  ok('...and scoped to the caller', countsFlat.includes('user_id = auth.uid()'))

  /*
   * Each clause against the tab it stands for. These mirror scope() in src/lib/userMail.ts; the
   * pairs below check that the mirror is still true in both directions.
   */
  ok('All is the mailbox less junk and less sent',
    countsFlat.includes('count(*) filter (where is_junk = false and is_sent = false)'))
  ok('Needs matching is what is unsettled, less junk and less sent',
    countsFlat.includes('count(*) filter (where is_settled = false and is_junk = false and is_sent = false)'))
  ok('Matched is on a record, and only that',
    countsFlat.includes('count(*) filter (where is_filed)'))
  // The second half of the same bug: no_record_at means two different things, and the tab that
  // reads it has to say which one it wants.
  ok('No record needed excludes sent mail, which only carries no_record_at to stay out of the queue',
    countsFlat.includes('count(*) filter (where no_record_at is not null and is_sent = false)'))
  ok('Junk is junk', countsFlat.includes('count(*) filter (where is_junk)'))
  ok('Sent is sent', countsFlat.includes('count(*) filter (where is_sent)'))
}

/*
 * The column names, both sides.
 *
 * This is the silent one. Rename a column in the SQL and fetchMailUnreadCounts reads undefined,
 * `Number(undefined ?? 0)` is 0, and every badge quietly shows nothing — no error, no warning,
 * and a mailbox that looks empty. The same shape as the mapper bug CLAUDE.md describes.
 */
for (const column of ['all_mail', 'needs_matching', 'matched', 'no_record', 'junk', 'sent']) {
  ok(`the SQL declares ${column}`, countsFlat.includes(column))
  ok(`...and userMail.ts reads it back`, mail.includes(column))
}

/* ------------------------------------------------------------------ *
 * scope(), which builds the list the badges sit above
 * ------------------------------------------------------------------ */

const scopeAt = mail.indexOf('function scope<Q>')
ok('scope() is still the one clause builder for the mailbox', scopeAt !== -1)

if (scopeAt !== -1) {
  const scopeBody = flat(mail.slice(scopeAt, mail.indexOf('\n}', scopeAt)))
  const noRecord = scopeBody.split("input.filter === 'no-record'")[1] ?? ''
  ok('the No record needed tab filters on no_record_at', noRecord.includes('no_record_at'))
  // The list and the count have to agree about this, or the badge is right and the tab is wrong.
  ok('...and excludes sent mail, exactly as its count does',
    noRecord.slice(0, 120).includes("eq('is_sent', false)"))

  const all = scopeBody.split("input.filter === 'all'")[1] ?? ''
  ok('All excludes junk and sent, exactly as its count does',
    all.slice(0, 120).includes("eq('is_junk', false)") && all.slice(0, 120).includes("eq('is_sent', false)"))
}

/*
 * The third definition is gone, and must stay gone.
 *
 * countNeedsFiling counted unsettled AND unread while its own tab listed unsettled whatever the
 * read state, so reading five unmatched messages took the badge to nought over a list of five.
 */
check('countNeedsFiling has not come back',
  /export\s+async\s+function\s+countNeedsFiling/.test(mail), false)
check('...nor is the page still calling it', /countNeedsFiling\s*\(/.test(page), false)

/* ------------------------------------------------------------------ *
 * Sent mail arrives read
 * ------------------------------------------------------------------ */

ok('the sync stamps sent mail as read when it files it',
  flat(sync).includes('read_at: message.isSent ? message.at : null'))
/*
 * Dated when it was SENT, not when the sync happened to run. A mailbox connected today would
 * otherwise stamp a year of sent mail with today's date, and anything ordered by when a message
 * was dealt with would put the whole Sent folder at the top.
 */
check('...dated when it was sent rather than now()',
  flat(sync).includes('read_at: message.isSent ? new Date().toISOString() : null'), false)

/* ------------------------------------------------------------------ *
 * The tab strip
 * ------------------------------------------------------------------ */

// The firm's word, and the one people look for: "that one is actually should be blocked".
ok('the senders tab is called Blocked', page.includes("label: 'Blocked'"))
// Every tab carries its own number. A single count shown on two tabs is what hid a full
// No record needed tab from the firm in the first place.
ok('every tab reads its own unread count', page.includes('unreadCounts[t.id]'))
check('the old single count is gone from the page', page.includes('outstanding'), false)

/* ------------------------------------------------------------------ */

if (failures.length > 0) {
  console.error(`check-mail-counts: ${failures.length} FAILED, ${pass} passed\n`)
  for (const f of failures) console.error(`  ✗ ${f}\n`)
  process.exit(1)
}
console.log(`check-mail-counts: ${pass} checks passed`)
