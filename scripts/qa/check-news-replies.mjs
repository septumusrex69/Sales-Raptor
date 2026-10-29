/**
 * WHERE REPLIES TO NEWS GO, AND WHAT DID NOT ARRIVE (S10, 22 Oct).
 *
 * The firm: a lead's reply to info@, a client's to reports@; bounces never in an inbox, but listed
 * in Raptor with the reason and the record to fix. Holds replyToFor's choice, that the drain uses it
 * for news only, and that the News page lists the undeliverable addresses.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-news-replies.mjs
 */
import { readFileSync } from 'node:fs'
import { replyToFor } from '../../src/lib/marketing.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const to = { leads: 'info@firm.test', clients: 'reports@firm.test' }
check('a lead replies to info@', replyToFor({ lead_id: 'l', company_id: null, contact_id: null }, to, 'fallback@firm.test'), 'info@firm.test')
check('a client company replies to reports@', replyToFor({ lead_id: null, company_id: 'c', contact_id: null }, to, 'fallback@firm.test'), 'reports@firm.test')
check('a client contact replies to reports@', replyToFor({ lead_id: null, company_id: null, contact_id: 'p' }, to, 'fallback@firm.test'), 'reports@firm.test')
check('a lead who became a client is a client', replyToFor({ lead_id: 'l', company_id: 'c', contact_id: null }, to, 'fallback@firm.test'), 'reports@firm.test')
check('an unset address falls back, never to nothing', replyToFor({ lead_id: 'l', company_id: null, contact_id: null }, { leads: null, clients: null }, 'fallback@firm.test'), 'fallback@firm.test')

const drain = strip(readFileSync(new URL('../../api/_lib/marketing.ts', import.meta.url), 'utf8'))
ok('the drain uses it for news, and only news', /campaign\.kind === 'news' && !personal\s*\?\s*replyToFor\(row, \{\s*leads: process\.env\.MARKETING_REPLY_TO_LEADS[\s\S]{0,120}clients: process\.env\.MARKETING_REPLY_TO_CLIENTS/.test(drain))
/* S13: News from a liaison, reports@ or an extra address answers to that same address -- the client is writing back to Nicole. */
ok('...and news from a person replies to that person', /firmSender\(await nameOf\(address\), address\)/.test(drain)
  && /halt = await sendChunk\(campaign, from, rows, key, true\)/.test(drain))
const page = strip(readFileSync(new URL('../../src/pages/news/CampaignList.tsx', import.meta.url), 'utf8'))
ok('the News page lists what did not arrive', /<UndeliveredCard \/>/.test(page))
const card = strip(readFileSync(new URL('../../src/pages/news/UndeliveredCard.tsx', import.meta.url), 'utf8'))
ok('...read from the undeliverable and complained addresses', /\.or\('status\.eq\.undeliverable,how\.eq\.complaint'\)/.test(card))

if (failures.length) {
  console.error(`check-news-replies: ${failures.length} failed, ${pass} passed\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log(`check-news-replies: ${pass} passed, 0 failed`)
