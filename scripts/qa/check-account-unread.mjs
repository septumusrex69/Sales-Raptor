/**
 * ON AN ACCOUNT, "UNREAD" MEANS NOBODY HAS LOOKED.
 *
 * THE FIRM, looking at a section 129 reply still bold on the account days after it was dealt
 * with: "These things remain unread. But I don't know if it was because it was Stefan that was
 * reading and not to Itumeleng." That guess was exactly right, and it is the whole bug:
 * `account_emails_mark_read` scoped the UPDATE to `received_by`, so the account's copy could only
 * ever be cleared by whoever the message happened to arrive for. Everybody else on the file saw
 * it unread for ever, and the browser knew it -- the panel only offered to mark it read to that
 * one person, because offering it to anybody else would have been a button that silently did
 * nothing.
 *
 * TWO READ STATES, ON PURPOSE, AND THEY ARE NOT THE SAME QUESTION. `user_emails` is a person's
 * own inbox and stays scoped to `user_id`: unread there means THEY have not looked. On the
 * account it is the floor's correspondence, and asked what unread should mean, the firm chose
 * "unread by anybody".
 *
 * WHAT OPENING THE POLICY COSTS, AND WHAT PAYS FOR IT. The UPDATE policy can no longer be the
 * thing that protects the record -- so `protect_account_mail_fields` reverts every column but the
 * read state. That trigger is the load-bearing half of this change: without it, an authenticated
 * browser could rewrite the body of a debtor's email, which is the record of what was said.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-account-unread.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

const sql = read('supabase/schema.sql')
const mailLib = code('src/lib/accountEmails.ts')
const mirror = code('src/lib/mailReadState.ts')
const panel = code('src/pages/accounts/EmailsPanel.tsx')

/* ---------------- the account's copy is the account's ---------------- */

/*
 * THE LAST DEFINITION IS THE LIVE ONE. schema.sql is append-only, so the superseded
 * received_by-scoped policy is still in the file above this one -- reading with indexOf would
 * assert against the very policy this change replaced.
 */
const policyAt = sql.lastIndexOf('create policy account_emails_mark_read on public.account_emails')
ok('the account’s read state has a policy', policyAt > 0)
const policy = policyAt > 0 ? sql.slice(policyAt, policyAt + 400) : ''
ok('...open to anybody signed in', /using \(auth\.uid\(\) is not null\)/.test(policy))
ok('...on both sides of the update', /with check \(auth\.uid\(\) is not null\)/.test(policy))
/* THE OLD RULE IS GONE FROM THE LIVE DEFINITION, not merely added to. */
ok('...and no longer scoped to the mailbox it arrived in', !/received_by = auth\.uid\(\)/.test(policy))

/* ---------------- but only the read state ---------------- */

const guardAt = sql.lastIndexOf('create or replace function public.protect_account_mail_fields(')
ok('a trigger protects the record instead', guardAt > 0)
const guard = guardAt > 0 ? sql.slice(guardAt, sql.indexOf('$$;', guardAt)) : ''
/*
 * EVERY COLUMN THAT IS A RECORD OF WHAT HAPPENED. Listed by hand here for the same reason the
 * mappers are listed by hand -- and held here for the same reason firmSettings is: a column added
 * to the table and forgotten in the trigger is a column an ordinary user can rewrite on a
 * statutory demand's reply.
 */
for (const col of [
  'account_id', 'query_id', 'direction', 'subject', 'body', 'debtor_address', 'message_id',
  'received_by', 'occurred_at', 'attachment_names', 'email_folder', 'email_uid',
]) {
  ok(`...reverting ${col}`, new RegExp(`new\\.${col} := old\\.${col};`).test(guard))
}
/* AND NOT THE READ STATE, which is the one thing it is there to let through. */
ok('...and letting the read state through',
  !/new\.read_at := old\.read_at/.test(guard) && !/new\.read_by := old\.read_by/.test(guard))
/*
 * THE SERVER IS NOT A BROWSER. The mail sync and api/_lib/email/ticket.ts file messages with the
 * service key and no auth.uid() -- ticket.ts writes query_id onto the thread, which this trigger
 * would otherwise revert, silently, leaving a ticket with no email on it.
 */
ok('...with the service key carved out', /auth\.uid\(\) is null/.test(guard))
ok('...and an Administrator too', /current_user_role\(\) = 'Administrator'/.test(guard))
ok('the trigger is actually attached',
  /create trigger protect_account_mail_fields\s*\n\s*before update on public\.account_emails/.test(sql))

/* ---------------- who read it ---------------- */

ok('the account’s copy records who cleared it',
  /add column if not exists read_by uuid references public\.profiles\(id\)/.test(sql))
/*
 * AND IT HAS TO REACH THE SCREEN. CLAUDE.md's standing warning: a column in the table, the type
 * and the select but missing from the hand-written mapper reads as undefined for ever and nothing
 * fails. `diary_capacity` sat in that state for months.
 */
ok('...and the select asks for it', /read_at, read_by, received_by/.test(mailLib))
ok('...the row type names it', /read_by: string \| null/.test(mailLib))
ok('...and the mapper carries it', /readBy: r\.read_by \?\? null/.test(mailLib))

/* ---------------- reading it clears it for everybody ---------------- */

ok('marking read stamps who did it', /read_at: new Date\(\)\.toISOString\(\), read_by: /.test(mailLib))
/* UNREAD CLEARS THE READER WITH IT: a row nobody has read has no reader to name. */
ok('...and marking unread clears them', /read_at: null, read_by: null/.test(mailLib))
/*
 * NO LONGER GATED ON THE RECIPIENT, ON EITHER BUTTON. The panel used to check
 * `email.receivedBy === userId` before offering to mark read or unread, because that was all the
 * policy permitted. Both are now the account's.
 */
ok('the panel reads it for whoever opened it', /if \(!email\.readAt\) onRead\(email\)/.test(panel))
ok('...and offers mark-unread to anybody', /onMarkUnread=\{inbound && email\.readAt \? onUnread : null\}/.test(panel))
ok('...so nothing there still compares to the recipient', !/receivedBy === userId/.test(panel))

/* ---------------- and the mailbox copy goes with it ---------------- */

/*
 * THE JOIN BETWEEN THE TWO COPIES IS WHAT MAKES THIS WORTH HAVING: reading a debtor's reply in
 * YOUR mailbox now clears it on the account even though it arrived in somebody else's, which
 * before was exactly the case that could not work.
 */
ok('reading it in a mailbox clears the account’s copy too',
  /mirrorReadToAccount/.test(mirror) && /read_at: new Date\(\)\.toISOString\(\), read_by: /.test(mirror))
ok('...naming the reader there as well', /supabase\.auth\.getUser\(\)/.test(mirror))
ok('...and putting it back clears the reader', /update\(\{ read_at: null, read_by: null \}\)/.test(mirror))
/* THE MAILBOX'S OWN READ STATE STAYS ONE PERSON'S -- it is their inbox, not the floor's. */
ok('the mailbox copy is untouched by all this',
  /\.from\('user_emails'\)\s*\n\s*\.update\(\{ read_at: new Date\(\)\.toISOString\(\) \}\)/.test(mirror))

console.log(`\ncheck-account-unread: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
