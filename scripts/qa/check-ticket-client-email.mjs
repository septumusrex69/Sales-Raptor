/**
 * An email to the client from a ticket is on the client's own Emails tab (R-12).
 *
 * Nicole asked a client for a statement from a ticket; the client's profile did not show it. The send
 * was filed on the ticket and the account (account_emails) and never written as an Email activity,
 * which is what the client's Emails tab reads. What this holds: the ticket's send writes that
 * activity on the client, only when it went to the client, and charges nothing of its own.
 *
 * Run: node scripts/qa/check-ticket-client-email.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, actual) => { if (actual === true) pass += 1; else failures.push(name) }
const code = readFileSync(new URL('../../src/pages/queries/QueryDetail.tsx', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')

const at = code.indexOf("type: 'Email'")
ok('the ticket send writes an Email activity', at > 0)
const before = code.slice(Math.max(0, at - 200), at)
ok('...only when it went to the client', /if \(toClient && clientId\)/.test(before))
ok('...on the client the ticket belongs to', /companyId: clientId/.test(code.slice(at, at + 200)))
ok('...and carries the Message-ID so a reply threads', /emailMessageId: messageId/.test(code.slice(at, at + 250)))
ok('the client comes from the batch or the account', /data\.batch\?\.companyId \?\? data\.account\?\.companyId/.test(code))
ok('the activity adds no charge of its own', !/chargeItem/.test(code.slice(at - 200, at + 300)))

console.log(`\ncheck-ticket-client-email: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  \u2717 ${f}`)
process.exit(failures.length ? 1 : 0)
