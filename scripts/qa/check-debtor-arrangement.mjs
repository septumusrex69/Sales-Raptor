/**
 * A DEBTOR OFFERS AN ARRANGEMENT; A COLLECTOR DECIDES (Raptor H16, debtor portal part 3).
 *
 * Stephan, 2 Nov: "offer a promise to pay or instalments within rules you set; a collector approves it." Held here:
 * the rules say what they say, the server applies them too (a page can be edited), an offer is never a promise until
 * a person accepts, and accepting is the collector's own recordPromise -- item 5, the note, the confirmation.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-debtor-arrangement.mjs
 */
import { readFileSync } from 'node:fs'
import { PROPOSAL_RULES, proposalProblem, proposalSummary, paymentsToSettle, monthsToSettle } from '../../src/lib/debtorArrangement.ts'
import { stripSqlComments } from './sqlComments.mjs'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
const T = '2026-11-03'
const M = { balance: 9600, settlement: 9840 }
const P = (arrangement, amount, firstDueOn = '2026-11-25') => ({ arrangement, amount, firstDueOn })

check('the rules are a month to start and two years to finish', [PROPOSAL_RULES.firstPaymentWithinDays, PROPOSAL_RULES.longestMonths], [30, 24])
check('R500 a month on R9 840 is 20 payments', paymentsToSettle(500, 9840), 20)
check('...and 20 months, inside the rule', [monthsToSettle(P('monthly', 500), 9840), proposalProblem(P('monthly', 500), M, T)], [20, null])
const tooSlow = proposalProblem(P('monthly', 300), M, T)
ok(`R300 a month (33 months) is refused, with the least that would do (${tooSlow})`, /33 months/.test(tooSlow ?? '') && /at least R 410[.,]00 a month/.test(tooSlow ?? ''))
check('R100 a week on R9 840 is 99 weeks: 23 months, allowed', [monthsToSettle(P('weekly', 100), 9840), proposalProblem(P('weekly', 100), M, T)], [23, null])
ok('R90 a week (110 weeks, 26 months) is not', /26 months/.test(proposalProblem(P('weekly', 90), M, T) ?? ''))
check('a once-off of any size may be offered (the collector decides)', proposalProblem(P('once_off', 2000), M, T), null)
ok('...and says what it leaves owing', /leaving R 7[ \u00a0]?840[.,]00 still to pay/.test(proposalSummary(P('once_off', 2000), 9840)))
ok('an instalment that pays everything is a once-off, said so', /Choose "once-off" instead/.test(proposalProblem(P('monthly', 9840), M, T) ?? ''))
ok('the first payment cannot be in the past', /cannot be in the past/.test(proposalProblem(P('monthly', 500, '2026-11-02'), M, T) ?? ''))
check('...may be today', proposalProblem(P('monthly', 500, '2026-11-03'), M, T), null)
check('...or 30 days out', proposalProblem(P('monthly', 500, '2026-12-03'), M, T), null)
ok('...but not 31', /within 30 days/.test(proposalProblem(P('monthly', 500, '2026-12-04'), M, T) ?? ''))
ok('nothing owed, nothing to arrange', /nothing to pay/.test(proposalProblem(P('monthly', 500), { balance: 0, settlement: 0 }, T) ?? ''))
ok('nought is not an offer', /amount you can pay/.test(proposalProblem(P('monthly', 0), M, T) ?? ''))

/* ---------- the server ---------- */
const api = read('api/_lib/debtorPortal.ts')
const prop = api.slice(api.indexOf('const propose: Handler'), api.indexOf('const signOut: Handler'))
ok('the server applies the same rules, to the same balance the page shows', /proposalProblem\(offer, \{ balance: b\.balance, settlement: b\.settlement \}, today\)/.test(prop) && /balanceOf\(admin, a, who\.accountId, today\)/.test(prop))
ok('...refuses while an arrangement is live', /if \(state\.live\) \{ res\.status\(409\)/.test(prop))
ok('...and while an offer is waiting', /state\.proposal\?\.status === 'pending'\) \{ res\.status\(409\)/.test(prop))
ok('an offer is NOT a promise: the portal writes no promise, no fee, starts no workflow', prop.length > 0
  && !/promises_to_pay'\)\.(insert|update)|account_fees|chargeItem|rpc\(/.test(prop))
ok('...and the collector hears of it', /type: 'debtor\.arrangement_offer'/.test(prop))

/* ---------- the collector's decision ---------- */
const decide = read('src/lib/debtorProposals.ts')
ok('accepting is recordPromise -- the collector\'s own press, with its fee, note and confirmation', /await recordPromise\(\{/.test(decide) && /accessToken/.test(decide))
ok('...and the promise comes BEFORE the offer is marked accepted', decide.indexOf('await recordPromise(') >= 0 && decide.indexOf('await recordPromise(') < decide.indexOf("status: 'accepted'"))
ok('a decline needs a reason, which the debtor reads', /if \(!why\) throw/.test(decide) && /decline_reason: why/.test(decide))
const card = read('src/components/accounts/DebtorProposalCard.tsx')
ok('the card is on the account page, first in the side column', /side=\{\[proposalPanel, /.test(read('src/pages/accounts/AccountDetail.tsx')) && /DebtorProposalCard/.test(card))

/* ---------- the table ---------- */
const schema = stripSqlComments(read('supabase/schema.sql'))
ok('one offer waiting per account', /create unique index if not exists debtor_proposals_one_pending on public\.debtor_arrangement_proposals \(account_id\) where status = 'pending'/.test(schema))
ok('nobody signed in to Raptor can write an offer -- no insert policy', !/create policy \w+ on public\.debtor_arrangement_proposals for (insert|all)\b/.test(schema))
ok('staff may only decide a PENDING offer, into accepted or declined', /for update to authenticated\s*using \(auth\.uid\(\) is not null and status = 'pending'\) with check \(auth\.uid\(\) is not null and status in \('accepted', 'declined'\)\)/.test(schema))
ok('a decline without a reason is refused by the table too', /constraint debtor_proposals_declined_says_why check/.test(schema))

console.log(`\ncheck-debtor-arrangement: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
