/**
 * What the firm tells a client an account is doing.
 *
 * TWO VOCABULARIES, ONE MAPPING, and this protects the mapping. The internal statuses are the
 * ones inherited from Swordfish -- 'Active: Activated', sub-status 'Delinquent Payer' -- and the
 * client sees ten positions instead. Every assertion below is written against a real combination
 * counted off the live book, not an invented one, because the combinations that exist are the
 * only ones the report will ever have to render.
 *
 * The book as it stands: 372 Written-off, 150 Frozen, 88 Delinquent Payer, 55 Promise To Pay,
 * 43 Re-opened, 7 Defended Matter, 6 Unfrozen, 5 Tracing, 1 Section 129, 1 Payment Default.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-client-position.mjs
 */
import { readFileSync } from 'node:fs'
import {
  CLIENT_POSITIONS, CLIENT_POSITION_ORDER,
  clientPosition, frozenByLabel, needsClient, positionReport,
} from '../../src/lib/clientPosition.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)
const at = (status, subStatus, extra = {}) => clientPosition({ status, subStatus, ...extra })

/* ---------- every combination actually on the book ---------- */

check('written off is closed', at('Written-off', null), 'closed')
check('frozen is frozen', at('Frozen', null), 'frozen')
check('a promise to pay is arranged', at('Active: Activated', 'Promise To Pay'), 'arranged')
check('...on a re-opened account too', at('Active: Re-opened', 'Promise To Pay'), 'arranged')
check('...and an unfrozen one', at('Active: Unfrozen', 'Promise To Pay'), 'arranged')
check('a defended matter is disputed', at('Active: Activated', 'Defended Matter'), 'disputed')
check('tracing is tracing', at('Active: Activated', 'Tracing'), 'tracing')
check('section 129 is legal', at('Active: Activated', 'Section 129'), 'legal')
check('a payment default is a broken arrangement', at('Active: Activated', 'Payment Default'), 'broken_arrangement')
/*
 * NOT THE SAME FACT, and they were briefly reported as one. A payment default is an arrangement
 * that came up short -- they committed and an instalment did not arrive. A delinquent payer, in
 * the firm's words, "just doesn't pay at all, he refuses to pay" -- nothing was ever agreed, so
 * there is no arrangement to break. 90 accounts, the largest active group on the book, and
 * collapsing them told the client the wrong thing about all of them.
 */
check('a delinquent payer is refusing to pay',
  at('Active: Activated', 'Delinquent Payer'), 'refusing')
check('...on an unfrozen account too', at('Active: Unfrozen', 'Delinquent Payer'), 'refusing')
check('...and the plainer wording maps the same way', at('Active: Activated', 'Refuses to pay'), 'refusing')
// The two must never collapse back into one another.
ok('a refusal is not a broken arrangement',
  at('Active: Activated', 'Delinquent Payer') !== at('Active: Activated', 'Payment Default'))
// Reached and refused beats "we are still trying": contact HAS been made and the answer was no.
check('a refusal is not softened into being worked',
  at('Active: Activated', 'Delinquent Payer', { reachedInPeriod: false }), 'refusing')
check('money still beats a refusal — they paid after all',
  at('Active: Activated', 'Delinquent Payer', { paidInPeriod: true }), 'paying')
check('an active account with no sub-status is being worked', at('Active: Activated', null), 'being_worked')
check('a re-opened account with no sub-status is being worked', at('Active: Re-opened', null), 'being_worked')

/* ---------- reached or not is the whole difference ---------- */

check('reached in the period is negotiating',
  at('Active: Activated', null, { reachedInPeriod: true }), 'negotiating')
check('not reached is being worked',
  at('Active: Activated', null, { reachedInPeriod: false }), 'being_worked')

/* ---------- money, and where it sits in the precedence ---------- */

check('money in the period beats an empty sub-status',
  at('Active: Activated', null, { paidInPeriod: true }), 'paying')
check('...and beats a promise still to fall due',
  at('Active: Activated', 'Promise To Pay', { paidInPeriod: true }), 'paying')
/*
 * STRUCTURAL BEATS MONEY, deliberately. An account in summons that also paid is reported as
 * Legal: the client has to know a legal process is running, and "Paying" would hide it. The
 * money is not lost -- the report carries collections per position, so Legal reads
 * "14 accounts, R38 000 collected" and says both things at once.
 */
check('legal is reported even when it paid',
  at('Active: Activated', 'Section 129', { paidInPeriod: true }), 'legal')
check('a dispute is reported even when it paid',
  at('Active: Activated', 'Defended Matter', { paidInPeriod: true }), 'disputed')
check('a frozen account that paid is still frozen',
  at('Frozen', null, { paidInPeriod: true }), 'frozen')
check('a closed account that paid is still closed',
  at('Written-off', null, { paidInPeriod: true }), 'closed')

/* ---------- nothing may fall through ---------- */

check('an unknown status still reports something', at('Something Swordfish Invented', null), 'being_worked')
check('a null status still reports something', at(null, null), 'being_worked')
check('an empty status still reports something', at('', ''), 'being_worked')
check('whitespace is not a status', at('   ', '   '), 'being_worked')
ok('every position has a label and a meaning',
  CLIENT_POSITION_ORDER.every((p) => CLIENT_POSITIONS[p]?.label && CLIENT_POSITIONS[p]?.meaning))
check('the order lists every position exactly once',
  CLIENT_POSITION_ORDER.length, Object.keys(CLIENT_POSITIONS).length)
ok('no two positions read the same to a client',
  new Set(CLIENT_POSITION_ORDER.map((p) => CLIENT_POSITIONS[p].label)).size === CLIENT_POSITION_ORDER.length)
// A client's book must account for itself: every account lands in exactly one position, so the
// counts add up to the book. A position outside the known set would silently drop rows.
ok('every mapping result is a known position', [
  ['Written-off', null], ['Frozen', null], ['Active: Activated', 'Delinquent Payer'],
  ['Active: Activated', 'Promise To Pay'], ['Active: Re-opened', null],
  ['Active: Activated', 'Defended Matter'], ['Active: Unfrozen', null],
  ['Active: Activated', 'Tracing'], ['Active: Activated', 'Section 129'],
  ['Active: Activated', 'Payment Default'], ['Active: Activated', null], [null, null],
].every(([st, sub]) => CLIENT_POSITION_ORDER.includes(clientPosition({ status: st, subStatus: sub }))))

/* ---------- in play ---------- */

ok('frozen is not in play', !CLIENT_POSITIONS.frozen.inPlay)
ok('closed is not in play', !CLIENT_POSITIONS.closed.inPlay)
ok('legal is not in play', !CLIENT_POSITIONS.legal.inPlay)
ok('being worked is in play', CLIENT_POSITIONS.being_worked.inPlay)
ok('a dispute is still in play', CLIENT_POSITIONS.disputed.inPlay)
// The whole point of separating it: it is the one position that asks the CLIENT a question.
ok('a refusal is in play', CLIENT_POSITIONS.refusing.inPlay)
ok('...and its meaning names the decision the client has to make',
  /legal/i.test(CLIENT_POSITIONS.refusing.meaning))

/* ---------- needs you ---------- */

ok('an open query with the client needs them', needsClient({ openQueryWithClient: true }))
ok('nothing with the client does not', !needsClient({ openQueryWithClient: false }))
ok('an unknown query state does not invent work for the client', !needsClient({}))
// It is an overlay, not a rung: an account can be waiting on the client AND actively worked,
// and collapsing the two onto one ladder loses whichever is not shown.
{
  const r = positionReport({ status: 'Active: Activated', subStatus: 'Tracing', openQueryWithClient: true })
  check('a traced account keeps its position', r.position, 'tracing')
  ok('...and still flags the client', r.needsClient)
  check('...and carries the label the client reads', r.label, 'Tracing')
}

/* ---------- a freeze says who ---------- */

check('a client freeze reads as theirs', frozenByLabel('client'), 'Frozen at your request')
ok('a firm freeze names the firm', /Bredell Ferreira/.test(frozenByLabel('firm')))
ok('the firm name can be changed without a migration', /Acme/.test(frozenByLabel('firm', 'Acme')))
// The state this whole feature exists to end: 150 accounts saying "Frozen" and nothing else.
ok('a freeze with nobody against it says so', /no reason recorded/i.test(frozenByLabel(null)))

/* ---------- the database has to agree ---------- */

const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
for (const col of ['frozen_by', 'frozen_reason', 'frozen_at', 'frozen_by_user']) {
  ok(`schema.sql carries ${col}`, new RegExp(`\\b${col}\\b`).test(schema))
}
ok('the freeze asker is constrained to the two keys the app writes',
  /frozen_by\s+text\s+check\s*\(\s*frozen_by\s+in\s*\(\s*'firm'\s*,\s*'client'\s*\)/i.test(schema))
ok('the status history table exists', /create table if not exists public\.account_status_events/.test(schema))
ok('it is filled by a trigger, not by the app', /record_account_status_event/.test(schema))
/*
 * Append-only by construction. A select policy and NOTHING else: the moment an insert or update
 * policy appears, history can be written by hand and it stops being evidence.
 */
ok('history is readable', /create policy account_status_events_select/.test(schema))
ok('...and has no write policy at all',
  !/create policy account_status_events_(insert|update|delete)/.test(schema))

// The hand-written account mapper drops anything not listed in it -- the trap that left
// diary_capacity dead for months. These are the fields the freeze UI reads.
const book = readFileSync(new URL('../../src/lib/accountBook.ts', import.meta.url), 'utf8')
for (const [field, col] of [['frozenBy', 'frozen_by'], ['frozenReason', 'frozen_reason'], ['frozenAt', 'frozen_at']]) {
  ok(`accountBook maps ${col}`, new RegExp(`${field}:[^,]*r\\.${col}`).test(book))
}

// A freeze without a reason is the state being fixed; it must be refused, not defaulted.
const freeze = readFileSync(new URL('../../src/lib/accountFreeze.ts', import.meta.url), 'utf8')
ok('a freeze with no reason is refused', /if \(!reason\) throw/.test(freeze))
ok('an unfreeze with no reason is refused too', /if \(!reason\) throw new Error\('Restarting/.test(freeze))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Every status combination on the live book maps to exactly one client position, a structural
state is never hidden by money, a freeze says who asked and why, and the movement history
cannot be written by hand.`)
