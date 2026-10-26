/**
 * A CLIENT THAT ASKED FOR NO NEWS AT ALL (S12).
 *
 * THE FIRM (26 Oct): "The client can be dormant but still receive information ... a client that ...
 * doesn't even want to receive any information from us. I wouldn't really call them dormant ... We
 * need to find a name for people that don't want to receive information. Like unsubscribes."
 *
 * Held here: the rule (src/lib/clientNews.ts) -- a sub-account follows its parent, a re-subscription
 * says why -- the columns and the database's refusal of a re-subscription without a reason, that
 * DORMANCY STILL STOPS NOTHING, and the screens that offer it. Who a campaign then goes to, and the
 * drain's re-read, are in check-marketing.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-client-news.mjs
 */
import { readFileSync } from 'node:fs'
import {
  mayChangeClientNews, newsResumePatch, newsStopPatch, newsStoppedBy, newsStoppedLine,
} from '../../src/lib/clientNews.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

/* ---------- the rule ---------- */
ok('an Administrator, Sales Manager or Liaison Manager may record it',
  ['Administrator', 'Sales Manager', 'Liaison Manager'].every((role) => mayChangeClientNews({ id: 'x', role }, { accountOwnerId: 'y' })))
ok('...and the client\'s own liaison', mayChangeClientNews({ id: 'y', role: 'Liaison' }, { accountOwnerId: 'y' }))
ok('...not another liaison or a rep', !mayChangeClientNews({ id: 'z', role: 'Liaison' }, { accountOwnerId: 'y' })
  && !mayChangeClientNews({ id: 'z', role: 'Sales Representative' }, { accountOwnerId: 'y' }))
ok('...nor nobody', !mayChangeClientNews(null, { accountOwnerId: 'y' }))

const family = [
  { id: 'top', parentCompanyId: null, newsStoppedAt: '2026-10-26T08:00:00Z' },
  { id: 'sub', parentCompanyId: 'top', newsStoppedAt: null },
  { id: 'subsub', parentCompanyId: 'sub', newsStoppedAt: null },
  { id: 'other', parentCompanyId: null, newsStoppedAt: null },
  { id: 'loopA', parentCompanyId: 'loopB', newsStoppedAt: null },
  { id: 'loopB', parentCompanyId: 'loopA', newsStoppedAt: null },
]
check('a client covers itself', newsStoppedBy('top', family)?.id, 'top')
check('...a sub-account follows its parent, however deep', [newsStoppedBy('sub', family)?.id, newsStoppedBy('subsub', family)?.id], ['top', 'top'])
check('...an unmarked client is not covered', newsStoppedBy('other', family), null)
check('...a parent loop in the data ends rather than hangs', newsStoppedBy('loopA', family), null)
check('...nothing to look up is nothing covered', [newsStoppedBy(null, family), newsStoppedBy('missing', family)], [null, null])

check('recording it says when, why and who', newsStopPatch('  Asked on a call ', 'me', 't'),
  { news_stopped_at: 't', news_stopped_reason: 'Asked on a call', news_stopped_by: 'me' })
check('...an empty reason is no reason, not an empty string', newsStopPatch('  ', 'me', 't').news_stopped_reason, null)
check('a re-subscription clears the stop and keeps when, why and who', newsResumePatch(' Asked again ', 'me', 't2'), {
  news_stopped_at: null, news_stopped_reason: null, news_stopped_by: null,
  news_resumed_at: 't2', news_resumed_reason: 'Asked again', news_resumed_by: 'me',
})
const line = newsStoppedLine({ name: 'Smit', newsStoppedAt: '2026-10-26T08:00:00Z', newsStoppedReason: 'Asked on a call' }, 'Nicole', true)
ok('the line says this client, since when, by whom and why, and what it stops',
  /^This client unsubscribed from our news on .+, recorded by Nicole — Asked on a call\. No newsletter or campaign goes to any of its people\.$/.test(line))
ok('...on somebody else\'s page it names the client', newsStoppedLine({ name: 'Smit', newsStoppedAt: '2026-10-26T08:00:00Z' }, null, false).startsWith('Smit unsubscribed'))
check('...and says nothing for a client that has not', newsStoppedLine({ name: 'Smit', newsStoppedAt: null }, null, true), '')

/* ---------- the database ---------- */
const schema = read('supabase/schema.sql')
for (const col of ['news_stopped_at', 'news_stopped_reason', 'news_stopped_by', 'news_resumed_at', 'news_resumed_reason', 'news_resumed_by']) {
  ok(`companies.${col} exists`, new RegExp(`alter table public\\.companies add column if not exists ${col}\\b`).test(schema))
}
ok('a re-subscription without a reason is refused by the database',
  /constraint companies_news_resumed_says_why\s+check \(news_resumed_at is null or length\(btrim\(coalesce\(news_resumed_reason, ''\)\)\) > 0\)/.test(schema))

/* ---------- dormancy still stops nothing ---------- */
const marketing = code('src/lib/marketing.ts') + code('api/_lib/marketing.ts')
ok('the campaign list does not read dormancy (the firm: a dormant client still receives our news)', !/dormant_?at/i.test(marketing))
ok('...it reads the client\'s no-news, when the list is drawn and again at the drain',
  /clientStopped\.has\(email\)/.test(code('src/lib/marketing.ts')) && /await clientStoppedEmails\(admin\)/.test(code('api/_lib/marketing.ts'))
  && /news_stopped_at/.test(code('api/_lib/marketing.ts')))

/* ---------- the screens ---------- */
ok('the client page offers it, on its own News card', /<NewsPreferenceCard key="news" emails=\{\[company\.email\]\} client=\{company\} own \/>/.test(code('src/pages/companies/CompanyDetail.tsx')))
ok('a contact\'s page says so when its client has recorded it', /<NewsPreferenceCard key="news" emails=\{\[contact\.email\]\} client=\{company \?\? undefined\} \/>/.test(code('src/pages/contacts/ContactDetail.tsx')))
const card = code('src/components/record/NewsPreferenceCard.tsx')
ok('the card writes through the companies_update policy, and asks why before a re-subscription',
  /supabase\.from\('companies'\)\.update\(patch\)/.test(card) && /disabled=\{busy \|\| \(stopped && !reason\.trim\(\)\)\}/.test(card))
ok('...only on the client\'s own page and only for those the policy allows', /const may = own && mayChangeClientNews\(currentUser, client\)/.test(card))
ok('...a sub-account covered by its parent is changed on the parent', /may && !inherited && !asking/.test(card))
ok('the clients list marks the row Unsubscribed', /c\.newsStoppedAt && \(/.test(code('src/pages/companies/CompaniesList.tsx'))
  && /data-testid="client-row-unsubscribed"/.test(read('src/pages/companies/CompaniesList.tsx')))
ok('the campaign screen counts the new reason', /'client unsubscribed'/.test(code('src/pages/news/NewsPage.tsx')))

if (failures.length) {
  console.log(`check-client-news: ${pass} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-client-news: ${pass} passed, 0 failed`)
