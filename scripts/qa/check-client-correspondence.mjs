/**
 * The client's email is not the debtor's correspondence.
 *
 * THE FIRM, looking at a debtor's Emails tab: "This email came from the client and then it came to
 * the debtor account. Should go to the ticket if there was one and or go to the client profile."
 * A liaison had forwarded a dispute to the client from its ticket; the client answered; the reply
 * threaded back by Message-ID and was filed as if the debtor had written it.
 *
 * THAT TAB IS EVIDENCE of what passed between the firm and the debtor -- what a section 129 proof
 * of communication rests on -- so a client's message in it is a false entry, not clutter. What this
 * holds:
 *
 *   1. The database decides who wrote it, on insert, once for all three writers -- and the
 *      DEBTOR'S OWN ADDRESS WINS, because a demand's addressee is a debtor whatever else is true.
 *   2. Nobody but the server and an Administrator can change the answer afterwards.
 *   3. The debtor's Emails tab reads only the debtor's; a ticket reads both.
 *   4. The Messages menu sends a client's answer to its ticket, and leaves out a client's email
 *      with no ticket -- the sync puts that one on the client's own record instead.
 *   5. THE FEE IS UNTOUCHED, by the firm's ruling: item 1(a) on the forward, item 6 on the reply.
 *      Asked whether the R13 should go, they said keep it -- "it's correspondence regarding the
 *      [debtor's account]". This moves where a message is shown, never what it costs.
 *
 * Run: node scripts/qa/check-client-correspondence.mjs
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
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
const sqlCode = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')

/* THE LAST DEFINITION, anchored on the full phrase -- schema.sql is append-only, and a bare name
   lands on a grant or a comment and tests an empty string, which fails OPEN. */
const schema = sqlCode(read('supabase/schema.sql'))
const lastFn = (name) => {
  const at = schema.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const open = schema.indexOf('$$', at)
  return schema.slice(at, schema.indexOf('$$', open + 2) + 2)
}

/* ---------- 1. the database decides, and the debtor wins ---------- */

ok('the column exists, defaulting to the debtor',
  /add column if not exists correspondent text not null default 'debtor'/.test(schema))
ok('...and holds only the two answers', /check \(correspondent in \('debtor', 'client'\)\)/.test(schema))

const rule = lastFn('account_email_correspondent')
ok('the rule is defined', rule.length > 0)
const debtorAt = rule.indexOf("then 'debtor'")
const clientAt = rule.indexOf("then 'client'")
/* PRESENCE BEFORE ORDER: indexOf is -1 on a missing branch, and -1 < anything passes an order check. */
ok('...it has a debtor branch', debtorAt > 0)
ok('...and a client branch', clientAt > 0)
ok("...and the debtor's own address is asked FIRST", debtorAt > 0 && clientAt > 0 && debtorAt < clientAt)
ok("...the debtor branch reads the account's email contacts",
  /from account_contacts ac[\s\S]*?ac\.account_id = p_account and ac\.kind = 'email'[\s\S]*?then 'debtor'/.test(rule))
ok("the client is the company record's address", /from companies k[\s\S]*?lower\(trim\(k\.email\)\) = a\.addr/.test(rule))
ok("...or a contact's at the company", /from contacts p[\s\S]*?lower\(trim\(p\.email\)\) = a\.addr/.test(rule))
ok('...the company or its parent', (rule.match(/in \(co\.company_id, co\.parent_company_id\)/g) ?? []).length === 2)
ok('...or a reply to a client message on the same account',
  /r\.message_id = p_in_reply_to[\s\S]*?r\.account_id = p_account and r\.correspondent = 'client'/.test(rule))
/* An empty address would match a client whose email is blank. */
ok('an empty address matches no client', (rule.match(/a\.addr <> ''/g) ?? []).length === 2)
ok('anything else stays the debtor', /else 'debtor'\s*end/.test(rule))
ok('...answered the same whoever asks (security definer)', /security definer/.test(rule.slice(0, 300)))

ok('it runs on insert, for every writer',
  /create or replace trigger account_email_correspondent\s+before insert on public\.account_emails/.test(schema))
ok('...setting the column from the rule',
  /new\.correspondent := public\.account_email_correspondent\(new\.account_id, new\.debtor_address, new\.in_reply_to\)/
    .test(lastFn('account_email_set_correspondent')))
/* THE HOUSE PATTERN: anon inherits from PUBLIC, so revoking from anon alone leaves it reachable. */
ok('nobody anonymous may ask it',
  /revoke execute on function public\.account_email_correspondent\(uuid, text, text\) from public, anon/.test(schema))

/* ---------- 2. and the answer cannot be edited back ---------- */

ok('a browser cannot move a client email back onto the debtor',
  /new\.correspondent := old\.correspondent/.test(lastFn('protect_account_mail_fields')))

/* ---------- 3. the debtor's tab reads the debtor's; a ticket reads both ---------- */

const lib = code('src/lib/accountEmails.ts')
const fnBody = (src, name) => {
  const at = src.indexOf(`export async function ${name}(`)
  return at < 0 ? '' : src.slice(at, src.indexOf('\n}\n', at))
}
const accountList = fnBody(lib, 'fetchAccountEmails')
const ticketList = fnBody(lib, 'fetchQueryEmails')
ok("the debtor's Emails tab is read", accountList.length > 0)
ok("...and reads only the debtor's", /\.eq\('correspondent', 'debtor'\)/.test(accountList))
ok('the ticket is read', ticketList.length > 0)
ok('...and reads both sides of the dispute', !/\.(eq|neq|or|not)\([^)]*correspondent/.test(ticketList))
/* CLAUDE.md: a column in the select and the type but not the mapper reads as undefined for ever. */
ok('the column reaches the screen through the mapper',
  /correspondent: r\.correspondent === 'client' \? 'client' : 'debtor'/.test(lib))
ok('...and both lists select it', (lib.match(/occurred_at, query_id, correspondent'/g) ?? []).length === 2)

/* ---------- 4. the Messages menu ---------- */

const replies = fnBody(lib, 'fetchUnreadReplies')
ok('unread replies leave out client email with no ticket',
  /\.or\('correspondent\.eq\.debtor,query_id\.not\.is\.null'\)/.test(replies))
const menu = code('src/components/layout/MessagesMenu.tsx')
ok("a client's answer opens its ticket",
  /to: r\.fromClient && r\.queryId\s*\?\s*`\/queries\/\$\{r\.queryId\}`/.test(menu))
ok("...and the debtor's still opens the account", /`\/accounts\/\$\{r\.accountId\}\?email=/.test(menu))
ok('...and following it is reading it, because nothing else ever will', /readOnFollow: r\.fromClient,/.test(menu))
ok('...and it says it is from the client', /r\.fromClient \? 'From the client' : null/.test(menu))

/* ---------- 4b. the sync puts ticketless client mail on the client ---------- */

const sync = code('api/_lib/emailSync.ts')
const file = sync.slice(sync.indexOf('async function fileAccountEmail('), sync.indexOf('async function withMessageStructure'))
ok('the sync reads the answer back', /\.select\('id, correspondent'\)/.test(file))
const clientBlock = file.indexOf("if (inserted[0].correspondent === 'client' && !message.queryId) {")
ok('...and gives ticketless client mail to the client', clientBlock > 0)
ok('...as the shared email activity, on the company',
  /from\('activities'\)\.upsert\(\s*clientMailActivity\(\{[\s\S]{0,200}companyId: acc\.company_id/.test(file.slice(clientBlock)))
ok('...once, however often a mailbox is resynced',
  /onConflict: 'user_id,email_message_id', ignoreDuplicates: true/.test(file.slice(clientBlock)))

/* ---------- 4c. and so does a person filing it by hand ---------- */

/*
 * HANDOFF section 5 named the gap: "only the SYNC writes the client-record activity, so that one is
 * on nobody's screen except the person's own mailbox." Filing by hand now reads the database's
 * answer back and writes the same row through the same builder -- one shape, two doors.
 */
const { clientMailActivity } = await import('../../src/lib/clientMailActivity.ts')
const row = clientMailActivity({
  userId: 'u', companyId: 'c', subject: 'Re: KIS0012', body: 'We accept.', at: '2026-10-07T08:00:00Z',
  messageId: '<m@x>', attachmentNames: [], toRecipients: [], ccRecipients: [], folder: 'INBOX', uid: 4,
})
check('the shared row is an email activity on the client', [row.type, row.company_id], ['Email', 'c'])
/* UNREAD FOR THE LIAISON, even when the filer has read it: the client's record is theirs. */
check('...and lands unread', row.is_read, false)
check('...keyed for the resync index', row.email_message_id, '<m@x>')

const userMail = code('src/lib/userMail.ts')
const byHand = userMail.slice(userMail.indexOf('async function fileOnAccount('), userMail.indexOf('export async function saveAccountContacts('))
ok('filing by hand reads the answer back', /\.select\('correspondent'\)/.test(byHand))
const handBlock = byHand.indexOf("if (filed?.correspondent === 'client'")
ok('...and gives client mail to the client', handBlock > 0)
ok('...through the same builder', /clientMailActivity\(\{[\s\S]{0,200}companyId: acc\.company_id/.test(byHand.slice(handBlock)))
ok('...once, where there is a Message-ID to key it on',
  /onConflict: 'user_id,email_message_id', ignoreDuplicates: true/.test(byHand.slice(handBlock)))
/* THE FEE STILL COMES FIRST, whoever wrote it -- the firm's ruling, as on the sync. */
const handCharge = byHand.indexOf('const charge = await chargeItem({')
ok('...after the item 6 charge, which is not gated on who wrote it', handCharge > 0 && handCharge < handBlock)

/* ---------- 5. the fee is not touched ---------- */

/*
 * THE CHARGE RUNS FOR EVERY FILED MESSAGE, before any question of who wrote it. The firm was asked
 * outright whether a client's reply should still cost the debtor R13, and ruled that it should
 * (CLAUDE.md). A change that wraps the charge in `correspondent === 'debtor'` reverses that ruling.
 */
const chargeAt = file.indexOf('charge = await chargeItemWith(admin, {')
ok('the item 6 charge is still raised', chargeAt > 0)
ok('...before the client question is asked', chargeAt > 0 && clientBlock > 0 && chargeAt < clientBlock)
ok('...and nothing about who wrote it gates it', !/correspondent\s*[!=]==|if \([^)]*correspondent/.test(file.slice(0, chargeAt)))
ok('the forward to the client is still charged item 1(a)',
  /const charge = await chargeItem\(\{[\s\S]{0,120}itemId: EMAIL_ITEM_ID/.test(fnBody(lib, 'recordSentEmail')))

console.log(`\ncheck-client-correspondence: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
