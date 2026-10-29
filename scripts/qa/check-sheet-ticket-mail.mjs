/**
 * A HANDOVER-SHEET TICKET SENDS AND RECEIVES EMAIL, AND IT IS NOT CHARGED (S15, Raptor · Handover 14).
 *
 * Stephan, asked S14's question 1 ("should a handover-sheet ticket send and receive email?"): yes, not
 * charged. A sheet ticket is about the client's spreadsheet; there is no debtor to bill under item 1(a)
 * or item 6, and no account timeline to note it on. The mail stays in account_emails with account_id
 * null and query_id set (migration sheet_ticket_mail), so the ticket's own list reads it unchanged.
 *
 * What would go wrong quietly, and so what this holds:
 *   - a fee raised on a sheet email (chargeItem / chargeItemWith in the sheet paths),
 *   - the database refusing the row (account_id still NOT NULL, or the same-account trigger),
 *   - inbound mail quoting a sheet ticket's number dropped on the floor (the old `ticket?.account_id`),
 *   - the page still hiding the Emails tab or the compose box behind `q.accountId`.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-sheet-ticket-mail.mjs
 */
import { readFileSync } from 'node:fs'
import { sheetTicketBody, sheetTicketSubject, ticketNumberIn } from '../../src/lib/ticketEmail.ts'

let pass = 0
const failures = []
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const sql = read('supabase/schema.sql')
/* THE LAST DEFINITION IS THE LIVE ONE (CLAUDE.md), opening paren included. */
const lastFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const opens = sql.indexOf('as $$', at)
  return sql.slice(opens, sql.indexOf('$$;', opens + 5))
}

/* ---------- the database lets the row in, and calls it the client's ---------- */
ok('account_emails.account_id may be null', /alter table public\.account_emails alter column account_id drop not null/.test(sql))
const same = lastFn('ticket_belongs_to_the_same_account')
ok('a sheet ticket\'s own mail passes the same-account rule',
  /tg_table_name = 'account_emails' and v_ticket_account is null and new\.account_id is null/.test(same))
ok('...and an account ticket still needs its own account', /v_ticket_account is null or new\.account_id is null or v_ticket_account <> new\.account_id/.test(same))
const corr = lastFn('account_email_set_correspondent')
ok('mail with no account is the client\'s', /if new\.account_id is null then\s+new\.correspondent := 'client'/.test(corr))

/* ---------- sending: filed on the ticket, no fee, no account note ---------- */
const lib = read('src/lib/accountEmails.ts')
const at = lib.indexOf('export async function recordSheetTicketEmail(')
const sheetSend = at < 0 ? '' : strip(lib.slice(at, lib.indexOf('\n}\n', at)))
ok('there is a recorder for a sheet ticket\'s mail', at >= 0)
ok('...that files it on the ticket with no account', /account_id: null,\s+query_id: input\.queryId/.test(sheetSend))
ok('...raises no fee', sheetSend.length > 0 && !/chargeItem/.test(sheetSend) && /charged_excl_vat: 0/.test(sheetSend))
ok('...and writes no account note', sheetSend.length > 0 && !/addNote/.test(sheetSend))

/* ---------- receiving: a reply or a quoted T-number reaches the ticket ---------- */
const sync = read('api/_lib/emailSync.ts')
const syncCode = strip(sync)
ok('a ticket number on a sheet ticket is no longer dropped',
  !/if \(ticket\?\.account_id\) return/.test(syncCode)
  && /accountId: \(ticket\.account_id as string \| null\) \?\? null, queryId: ticket\.id as string, via: 'ticket'/.test(syncCode))
ok('...and a reply threads to it', /accountId: \(data\.account_id as string \| null\) \?\? null/.test(syncCode))
ok('sheet mail goes to its own filer, before the account path',
  /if \(found && found\.accountId === null && found\.queryId\)[\s\S]{0,300}fileSheetTicketEmail\(/.test(syncCode))
const fAt = sync.indexOf('async function fileSheetTicketEmail(')
const filer = fAt < 0 ? '' : strip(sync.slice(fAt, sync.indexOf('\n}\n', fAt)))
ok('the sheet filer raises no item 6 fee', filer.length > 0 && !/chargeItemWith/.test(filer))
ok('...writes no account note', filer.length > 0 && !/account_notes/.test(filer))
ok('...and is idempotent on message_id like the account one', /onConflict: 'message_id', ignoreDuplicates: true/.test(filer))

/* ---------- the page: Emails tab and compose on every ticket ---------- */
const page = strip(read('src/pages/queries/QueryDetail.tsx'))
ok('the tab strip is on every ticket', !/\{q\.accountId && \(\s*<RecordTabs/.test(page) && /<RecordTabs<TicketTab>/.test(page))
ok('...the Emails tab too', /\{tab === 'Emails' && \(/.test(page))
ok('...but Notes only where there is an account', /\.\.\.\(q\.accountId \? \[\{ id: 'Notes'/.test(page))
ok('the compose box opens on a sheet ticket', /\{\(forwarding \|\| writing \|\| replyTo\) && \(/.test(page))
ok('a sheet ticket\'s send is recorded without a fee', /!q\.accountId[\s\S]{0,200}\? recordSheetTicketEmail\(\{/.test(page))
ok('...and the box says it is not charged', /Not charged: it is about the client/.test(page))

/* ---------- the subject carries the number the inbound filer reads ---------- */
const subject = sheetTicketSubject({ sheetReference: 'Bonnitta Oct', ticketNo: 1042 })
ok(`the subject names the sheet and the ticket ("${subject}")`, /Bonnitta Oct/.test(subject) && /T-1042/.test(subject))
ok('...and the inbound filer reads that number back', ticketNumberIn(subject) === 1042)
ok('a sheet with no reference still makes a subject', sheetTicketSubject({ sheetReference: null, ticketNo: 1001 }) === 'Your handover sheet — ticket T-1001')
const body = sheetTicketBody({ sheetReference: 'Bonnitta Oct', description: 'Rows 4 to 19 have no reference.', contact: 'Rinda', from: 'Nicole', ticketNo: 1042 })
ok('the body greets, says the sheet, quotes the question and asks for the number back',
  /^Dear Rinda\n/.test(body) && /handover sheet Bonnitta Oct/.test(body) && /Rows 4 to 19/.test(body) && /quote ticket T-1042/.test(body))

if (failures.length) { console.error(`check-sheet-ticket-mail: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`); process.exit(1) }
console.log(`check-sheet-ticket-mail: ${pass} passed, 0 failed`)
