/**
 * A REPLY FINDS ITS WAY BACK TO THE TICKET IT ANSWERS.
 *
 * THE FIRM, ASKING HOW: "a response should also be linked to this. If the client responds, for
 * example, or if I want to respond as a liaison to a clerk, they should also be able to respond
 * towards that. I don't know how we will link it. Would it be the subject line and the debtor's
 * email address, or the client's email address, that takes it to a specific ticket and files it
 * there? What do you suggest?"
 *
 * MESSAGE-ID, AND NEITHER OF THE TWO THEY OFFERED. Both break, and they break quietly:
 *
 *   A SUBJECT LINE IS NOT AN IDENTIFIER. Mail clients rewrite it -- "Re:", "Fwd: Re:", a
 *   translated prefix -- people edit it mid-thread, and two disputes on one account share it word
 *   for word. A reply about March's statement would land on a dispute about delivery.
 *
 *   AN ADDRESS IS NOT ONE EITHER. A client replies from whichever of four people opened the mail,
 *   and a debtor's attorney is not in account_contacts at all.
 *
 * In-Reply-To and References carry the Message-ID of what is being answered, every mail client
 * echoes them back, and they are unique by construction. The sync ALREADY walked them to find the
 * account -- carrying the ticket back at the same time is one more column on the same query.
 *
 * AND IT ONLY WORKS DOWN A THREAD, which this file asserts rather than hides: a client who starts
 * a new message instead of replying lands on the account, or on nothing. There is no honest way to
 * guess a ticket from a message that points at nothing, and guessing is how one debtor's dispute
 * ends up carrying another's correspondence.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-reply-lands-on-the-ticket.mjs
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
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const sql = read('supabase/schema.sql')
const sync = code('api/_lib/emailSync.ts')
const ticket = code('src/pages/queries/QueryDetail.tsx')

/* ---------------- matched by Message-ID, not by words ---------------- */

/* PRESENT BEFORE ANYTHING ABOUT IT. A renamed lookup makes every assertion below pass against a
   function that no longer threads anything. */
ok('the sync looks a thread up', /async function findAccount\(/.test(sync))
const find = sync.slice(sync.indexOf('async function findAccount('), sync.indexOf('async function fileAccountEmail('))
ok('...by the ids a reply carries', /threadIds\(parsed\.inReplyTo, parsed\.references\)/.test(find))
ok('...against what we sent', /\.eq\('message_id', id\)/.test(find))
/*
 * AND NOT BY SUBJECT, ASSERTED AS AN ABSENCE. This is the one the firm suggested and the one that
 * would look like it worked: subjects match often enough to seem right and wrongly often enough to
 * put a reply on the wrong dispute.
 */
ok('...and never by the subject line', !/\.eq\('subject'/.test(find) && !/ilike\('subject'/.test(find))

/* ---------------- and it brings the ticket back with it ---------------- */

ok('the lookup returns the ticket too', /queryId: string \| null/.test(find))
ok('...read off the message being answered', /\.select\('account_id, query_id'\)/.test(find))
/*
 * AN ADDRESS MATCH CARRIES NO TICKET, and that is deliberate. Matching a sender to a debtor contact
 * says WHOSE account this is and nothing about which of its tickets; guessing one would be worse
 * than leaving the reply on the account where somebody can see it.
 */
ok('...and an address match brings none', /accountId: contact\.account_id as string, queryId: null/.test(find))

ok('the filer takes a ticket', /queryId\?: string \| null/.test(sync))
ok('...and writes it', /query_id: message\.queryId \?\? null,/.test(sync))
ok('the reply is filed with the ticket it answers', /queryId: accountMatch\.queryId,/.test(sync))

/* ---------------- and the database refuses a threading mistake ---------------- */

/*
 * THE HALF THAT MAKES GUESSING SAFE TO GET WRONG. `mail_ticket_same_account` refuses a ticket
 * belonging to another account on this very column, so a bad thread match is a refused insert
 * rather than one debtor's dispute quietly carrying another debtor's correspondence.
 */
ok('a ticket from another account is refused on the mail row',
  /create trigger mail_ticket_same_account\s*\n\s*before insert or update of query_id, account_id on public\.account_emails/.test(sql))
ok('...and the guard compares the ticket to the row’s own account',
  /v_ticket_account <> new\.account_id/.test(sql))

/* ---------------- the ticket can reach the client ---------------- */

/*
 * THE FIRM: "there should also be an option on the ticket file to go to the client folder, the
 * client's particulars and stuff." A liaison about to write to them needs the contact, the mandate
 * and the commission rate, and finding it meant going out to Clients and searching by name.
 */
ok('an account ticket links to the client', /to=\{`\/companies\/\$\{data\.account\.companyId\}`\}/.test(ticket))
/*
 * ONLY WHERE THE PERSON MAY LOOK. `client.view` is a capability and a pre-legal agent does not have
 * it -- they work debtors, not the firm's relationships. A link that 404s on a permission is worse
 * than no link.
 */
ok('...only for somebody who may see one', /canViewClients\(currentUser\)/.test(ticket))
/*
 * AND IT IS A SECOND LINK, NOT THE BACK LINK RELABELLED. On an account ticket "back" is the
 * ACCOUNT -- the debtor whose dispute this is, where the ledger and the correspondence are. The
 * client is somewhere else worth reaching, not the same place.
 */
ok('...beside a back link that still goes to the account',
  /to=\{data\.batch \? `\/companies\/\$\{data\.batch\.companyId\}` : `\/accounts\/\$\{q\.accountId\}`\}/.test(ticket))

console.log(`\ncheck-reply-lands-on-the-ticket: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
