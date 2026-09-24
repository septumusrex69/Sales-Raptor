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
  CLIENT_FLAGS, CLIENT_POSITIONS, CLIENT_POSITION_ORDER,
  clientFlag, clientPosition, frozenByLabel, needsClient, positionReport,
  DESK_POSITIONS, deskPosition,
} from '../../src/lib/clientPosition.ts'
import { accountNarrative, clientLine } from '../../src/lib/accountNarrative.ts'
import { DIARY_KINDS, DIARY_KIND_ORDER } from '../../src/lib/diaryPriority.ts'

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
/*
 * A section 129 letter of demand is the statutory step required BEFORE going to court, not legal
 * action itself — the firm telephones the debtor the day it goes out. 279 accounts carry it, 38%
 * of the book, and reporting them as Legal would tell clients a third of their book was in court.
 */
check('section 129 is ordinary collection, not legal', at('Active: Activated', 'Section 129'), 'in_progress')
check('summons is legal', at('Active: Activated', 'Summons issued'), 'legal')
check('with attorneys is legal', at('Active: Activated', 'Attorney instructed'), 'legal')
check('a payment default is a broken arrangement', at('Active: Activated', 'Payment Default'), 'broken_arrangement')
/*
 * NOT THE SAME FACT, and they were briefly reported as one. A payment default is an arrangement
 * that came up short -- they committed and an instalment did not arrive. A delinquent payer, in
 * the firm's words, "just doesn't pay at all, he refuses to pay" -- nothing was ever agreed, so
 * there is no arrangement to break. 90 accounts, the largest active group on the book, and
 * collapsing them told the client the wrong thing about all of them.
 */
/*
 * WILL NOT versus CANNOT, and they must never collapse.
 *
 * The firm's own definition of its inherited "Delinquent Payer" is a refusal -- "somebody that
 * just doesn't pay at all, he refuses to pay" -- and avoiding contact is read the same way, on
 * the same instruction: a debtor dodging a working number has answered, just not in words.
 *
 * But the firm's client documentation also files unemployed, pensioner, hospitalised and
 * business-closed under that heading, and those are people who CANNOT pay. Reported as refusals
 * they would appear on a list headed "consider legal action", which is how a client ends up
 * suing an unemployed pensioner in hospital.
 */
check('a delinquent payer is refusing', at('Active: Activated', 'Delinquent Payer'), 'refusing')
check('...on an unfrozen account too', at('Active: Unfrozen', 'Delinquent Payer'), 'refusing')
check('an outright refusal is a refusal', at('Active: Activated', 'Refuses to pay'), 'refusing')
check('avoiding contact is a refusal', at('Active: Activated', 'Debtor avoiding contact'), 'refusing')
for (const hardship of ['Unemployed', 'Pensioner', 'Hospitalisation', 'Business closed']) {
  check(`${hardship} is cannot pay, not a refusal`, at('Active: Activated', hardship), 'cannot_pay')
}
ok('the two never collapse into one another',
  at('Active: Activated', 'Unemployed') !== at('Active: Activated', 'Delinquent Payer'))
ok('a refusal is not a broken arrangement',
  at('Active: Activated', 'Delinquent Payer') !== at('Active: Activated', 'Payment Default'))
check('money still beats a refusal — they paid after all',
  at('Active: Activated', 'Delinquent Payer', { paidInPeriod: true }), 'paying')
check('...and beats a hardship', at('Active: Activated', 'Unemployed', { paidInPeriod: true }), 'paying')

/* ---------- reached or not is the whole difference ---------- */

check('reached in the period is negotiating',
  at('Active: Activated', null, { reachedInPeriod: true }), 'negotiating')
check('not reached is simply in progress',
  at('Active: Activated', null, { reachedInPeriod: false }), 'in_progress')

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
  at('Active: Activated', 'Summons issued', { paidInPeriod: true }), 'legal')
check('a dispute is reported even when it paid',
  at('Active: Activated', 'Defended Matter', { paidInPeriod: true }), 'disputed')
check('a frozen account that paid is still frozen',
  at('Frozen', null, { paidInPeriod: true }), 'frozen')
check('a closed account that paid is still closed',
  at('Written-off', null, { paidInPeriod: true }), 'closed')

/* ---------- nothing may fall through ---------- */

check('an unknown status still reports something', at('Something Swordfish Invented', null), 'in_progress')
check('a null status still reports something', at(null, null), 'in_progress')
check('an empty status still reports something', at('', ''), 'in_progress')
check('whitespace is not a status', at('   ', '   '), 'in_progress')
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
ok('in progress is in play', CLIENT_POSITIONS.in_progress.inPlay)
/*
 * ONE AXIS. Every position must describe the ACCOUNT, never the firm's effort. "Being worked"
 * described what we are doing while everything around it described what the account is -- and an
 * account that is refusing to pay is also being worked, so they were never alternatives. A label
 * about our own activity on this list is the fault the whole model exists to avoid.
 */
ok('no position describes the firm\u2019s effort rather than the account',
  !CLIENT_POSITION_ORDER.some((p) => /\bwork(ed|ing)?\b/i.test(CLIENT_POSITIONS[p].label)))
ok('a dispute is still in play', CLIENT_POSITIONS.disputed.inPlay)
// The whole point of separating it: it is the one position that asks the CLIENT a question.
ok('refusing is in play', CLIENT_POSITIONS.refusing.inPlay)
ok('cannot pay is in play — it is checked back on, not abandoned', CLIENT_POSITIONS.cannot_pay.inPlay)
ok('cannot pay does not accuse anybody of refusing', !/refus/i.test(CLIENT_POSITIONS.cannot_pay.label))
ok('...and names the circumstances instead', /unemployed|pension/i.test(CLIENT_POSITIONS.cannot_pay.meaning))

/* ---------- somebody else is administering the debtor ---------- */

for (const sub of ['Debt review', 'Business rescue', 'Liquidation', 'Sequestration', 'Deceased estate']) {
  check(`${sub} is under administration`, at('Active: Activated', sub), 'under_administration')
}
/*
 * ABOVE our own legal step, deliberately. An account we served with Section 129 that then went
 * under debt review is governed by the debt review. Reporting it as Legal would show the firm
 * taking action on a matter where it is in fact being held back.
 */
check('a debtor under administration outranks our own legal step',
  at('Active: Activated', 'Summons issued', { underAdministration: true }), 'under_administration')
ok('the two are opposite facts and must not merge',
  at('Active: Activated', 'Debt review') !== at('Active: Activated', 'Summons issued'))
ok('it is not counted as in play', !CLIENT_POSITIONS.under_administration.inPlay)

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

/* ---------- the four-state indicator ---------- */

/*
 * THREE OF THE FOUR ARE DERIVED, one is stored. Every sub-status maps to a fixed tone in the
 * firm's own table -- Paying is always progressing, Tracing always attention, Frozen always
 * inactive -- so storing them would only create a way for the two to disagree. These assertions
 * are that table, so a tone cannot drift from what the firm published to its clients.
 */
for (const [pos, tone] of [
  ['paying', 'progressing'], ['arranged', 'progressing'], ['broken_arrangement', 'attention'],
  ['refusing', 'attention'], ['cannot_pay', 'attention'], ['negotiating', 'progressing'],
  ['in_progress', 'progressing'], ['tracing', 'attention'], ['disputed', 'attention'],
  ['legal', 'progressing'], ['under_administration', 'attention'],
  ['frozen', 'inactive'], ['closed', 'inactive'],
]) {
  check(`${CLIENT_POSITIONS[pos].label} shows as ${tone}`, clientFlag(pos), tone)
}
ok('every position has a tone', CLIENT_POSITION_ORDER.every((p) => CLIENT_POSITIONS[p].tone))
ok('no position stores the red flag as its tone',
  CLIENT_POSITION_ORDER.every((p) => CLIENT_POSITIONS[p].tone !== 'client_action'))
check('the four flags all have words beside the colour',
  Object.values(CLIENT_FLAGS).every((f) => f.label && f.dot), true)

/*
 * A CLIENT REQUEST BEATS EVERYTHING, especially a paused or finished account. "The account
 * remains frozen pending your instruction" is precisely what a client must see, and a grey dot
 * reading "inactive" would bury it.
 */
for (const pos of CLIENT_POSITION_ORDER) {
  check(`a request overrides ${CLIENT_POSITIONS[pos].label}`, clientFlag(pos, true), 'client_action')
}

{
  const r = positionReport({ status: 'Frozen', subStatus: null, openQueryWithClient: true })
  check('a frozen account waiting on the client is not reported as inactive', r.flag, 'client_action')
  check('...while its position still says frozen', r.position, 'frozen')
  check('...and the flag carries its words', r.flagLabel, 'Client action required')
}
check('nothing owed leaves the tone alone',
  positionReport({ status: 'Active: Activated', subStatus: 'Tracing' }).flag, 'attention')

/* ---------- the sentence the client reads ---------- */

/*
 * TWO SENTENCES, NOT ONE. What HAPPENED and what we will DO are different facts and a client
 * reads them differently — the first is the firm showing its work, the second is a commitment it
 * can be held to. Run together, the commitment gets lost at the end of a longer sentence.
 *
 * This is the firm's own worked example: a promise taken on the 15th to pay on the 30th, with the
 * diary booked to confirm it.
 */
{
  const l = clientLine({
    promise: { amount: 2000, dueOn: '2026-09-30', takenOn: '2026-09-15', status: 'open', arrangement: 'once_off' },
    next: { kind: 'promise_due', dueOn: '2026-09-30' },
  })
  check('the promise says who arranged it, when they said so and when it falls due',
    l.happened, 'On 15 September 2026, the debtor made an arrangement to pay on 30 September 2026.')
  check('...and the next action names the work, not just a date',
    l.next, 'We will confirm the arranged payment on 30 September 2026.')
}
// A parenthesis reads as a single payment with a note stapled on; this is what was agreed.
check('a recurring promise reads as an arrangement, not a parenthesis',
  clientLine({ promise: { amount: 750, dueOn: '2026-09-30', takenOn: '2026-09-15', arrangement: 'monthly' } }).happened,
  'On 15 September 2026, the debtor made an arrangement to pay monthly instalments, beginning on 30 September 2026.')
check('a broken promise names the debtor as the one who did not pay',
  clientLine({ promise: { amount: 2000, dueOn: '2026-08-30', status: 'broken' } }).happened,
  'The debtor did not make the payment arranged for 30 August 2026.')

/*
 * NO FIGURE ON A PROMISE, at the firm's instruction: "don't disclose the amount that is going to
 * pay to the client — it could create confusion because of the NCA fees." What a debtor undertakes
 * to pay is not what settles the account, because interest and recoverable costs move between the
 * promise and the payment, so a client shown "R2 000" reads it as the balance.
 *
 * Asserted over every shape a promise can take, because one of the three still carrying a figure
 * would be the one that reaches a client.
 */
for (const p of [
  { amount: 2000, dueOn: '2026-09-30', takenOn: '2026-09-15', status: 'open', arrangement: 'once_off' },
  { amount: 750, dueOn: '2026-09-30', takenOn: '2026-09-15', arrangement: 'monthly' },
  { amount: 2000, dueOn: '2026-08-30', status: 'broken' },
]) {
  ok(`a ${p.status ?? 'open'} ${p.arrangement ?? 'once_off'} promise names no figure`,
    !/R\s?\u00a0?[\d]/.test(clientLine({ promise: p }).happened))
}
/*
 * BUT MONEY RECEIVED KEEPS ITS FIGURE. That is not an undertaking, it is what actually arrived,
 * and it is the number a client most wants to see. Removing it along with the promise amounts
 * would be over-applying the rule.
 */
ok('a payment received still says how much',
  /R\s?\u00a0?2/.test(clientLine({ paidInPeriod: { amount: 2000, on: '2026-09-15' } }).happened))

/*
 * EVERY DIARY KIND HAS ITS OWN NEXT ACTION, and none of them may fall back to a bare date. The
 * diary already records WHY an account comes back; "we will follow up on the 22nd" throws that
 * away, and it is the half of the sentence a client actually checks the firm against.
 */
for (const kind of DIARY_KIND_ORDER) {
  const line = clientLine({ next: { kind, dueOn: '2026-09-30' } }).next
  ok(`${DIARY_KINDS[kind].label} has its own next action`, line.length > 0)
  ok(`...naming the date`, /30 September 2026/.test(line))
  ok(`...and saying what we will do`, /^We will /.test(line))
}
ok('no two kinds produce the same next action',
  new Set(DIARY_KIND_ORDER.map((k) => clientLine({ next: { kind: k, dueOn: '2026-09-30' } }).next)).size
    === DIARY_KIND_ORDER.length)


/*
 * THREE STATES FOR "DID THEY ANSWER", not two. The imported book logs 8 calls across 736
 * accounts and records an answer on none of them, so "we do not know" is the normal case.
 * Printing "no reply" there would put a claim about the DEBTOR in front of a client when the
 * gap is in our own records.
 */
ok('a recorded non-answer says no reply',
  /no reply/.test(accountNarrative({ lastAttemptOn: '2026-09-12', reached: false })))
/*
 * AND IT NAMES THE ACTION, NOT "WORK". The firm: "we don't say that an account was worked. It is
 * a very vague and stupid way to say it ... we had actions. We got in touch, we negotiated, we
 * made an arrangement, we attempted contact."
 *
 * So the channel becomes the verb. Asserted per channel, because a single case would pass on a
 * map with four entries missing -- and asserted that the old vague wording is gone, because that
 * is the sentence the client reads.
 */
for (const [channel, said] of [
  ['phone', 'We telephoned the debtor on'],
  ['email', 'We emailed the debtor on'],
  ['sms', 'We sent the debtor an SMS on'],
  ['letter', 'We wrote to the debtor on'],
  ['whatsapp', 'We messaged the debtor on WhatsApp on'],
]) {
  ok(`an unrecorded outcome on ${channel} names what was done`,
    accountNarrative({ lastAttemptOn: '2026-09-12', lastAttemptChannel: channel }).includes(said))
}
/* Where even the channel is unknown there is nothing descriptive left, so it names the fact it
   has -- an action, on a date -- rather than dressing it up as contact. */
ok('an unrecorded outcome with no channel still says only what is known',
  /We logged an action on this account on/.test(accountNarrative({ lastAttemptOn: '2026-09-12' })))
ok('...and the vague wording is gone from the client’s sentence',
  !/worked the account/.test(accountNarrative({ lastAttemptOn: '2026-09-12', lastAttemptChannel: 'phone' })))
ok('...and never claims the debtor failed to reply',
  !/no reply/.test(accountNarrative({ lastAttemptOn: '2026-09-12', reached: null })))

// "attempted" is now in the sentence itself, so the count is what must be absent, not the word.
ok('a single attempt does not boast about being the first',
  !/attempt during the reporting period/.test(accountNarrative({ lastAttemptOn: '2026-09-12', reached: false, attemptsThisPeriod: 1 })))
ok('several attempts are counted',
  /third attempt during the reporting period/.test(accountNarrative({
    lastAttemptOn: '2026-09-12', reached: false, attemptsThisPeriod: 3 })))

/*
 * THE CLAUSE THAT MATTERS MOST. When the firm has not worked an account, the sentence says so.
 * A client report that dressed the firm's own silence up as the debtor's would be the one
 * dishonest thing in the document, and it is the easiest to write by accident.
 */
check('nothing done reads as nothing done', clientLine({}).happened, 'No contact attempt has been made yet.')
ok('...and is not hidden by a follow-up date being booked',
  /No contact attempt has been made/.test(accountNarrative({ next: { kind: 'review', dueOn: '2026-09-20' } })))
/*
 * AN ACTIVE ACCOUNT WITH NOTHING BOOKED IS ADRIFT — the firm has stopped working it without
 * deciding to — and the client is entitled to see that rather than a blank space.
 */
check('nothing scheduled says so', clientLine({ lastAttemptOn: '2026-09-07' }).next,
  'No further action has been scheduled.')

ok('a freeze is said first', /^Work was paused/.test(accountNarrative({
  frozenReason: 'Debtor in debt review.', lastAttemptOn: '2026-09-12' })))
ok('...and a paused account promises no next action it cannot keep',
  /remain paused until we receive further instruction/.test(clientLine({ frozenReason: 'Debtor in debt review.' }).next))
ok('a freeze reason is not double-stopped',
  !/\.\./.test(accountNarrative({ frozenReason: 'Debtor in debt review.' })))
ok('money received is reported',
  /received a payment of R1\u00a0500/.test(accountNarrative({ paidInPeriod: { amount: 1500, on: '2026-09-03' } })))
check('a frozen account does not also claim nobody rang',
  /No contact attempt has been made/.test(accountNarrative({ frozenReason: 'Client asked us to hold.' })), false)

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

/*
 * The client line is shown to the clerk whose work produces it, and it must stay READ-ONLY. The
 * moment somebody can type into it, it stops being a faithful reading of the records and becomes
 * a second place where the truth is kept -- which is the whole problem the composed sentence was
 * built to avoid.
 */
const detail = readFileSync(new URL('../../src/pages/accounts/AccountDetail.tsx', import.meta.url), 'utf8')
ok('the account page shows the client line', /What the client sees/.test(detail))
ok('...composed, not taken from the main comment', /clientLine\(\{/.test(detail))
{
  const panel = detail.slice(detail.indexOf('function ClientLinePanel'), detail.indexOf('/* ---------- right: the figures'))
  ok('...and it cannot be typed into', !/<textarea|<input|contentEditable/.test(panel))
}

/*
 * THE PREVIEW AT THE MOMENT THE DATE IS BOOKED. Asked for directly: the clerk should confirm
 * what the client will see. It must appear wherever a diary date is set — both finish flows —
 * and it must be a mirror, never a second place to type.
 */
for (const file of ['CompleteDiaryModal', 'DiaryWorkBar']) {
  const src = readFileSync(new URL(`../../src/components/diary/${file}.tsx`, import.meta.url), 'utf8')
  ok(`${file} previews the client line`, /<ClientLinePreview/.test(src))
  ok(`${file} follows the kind AND date being chosen`, /next=\{plan\.comesBack \? \{ kind: plan\.kind/.test(src))
}
{
  const preview = readFileSync(new URL('../../src/components/diary/ClientLinePreview.tsx', import.meta.url), 'utf8')
  ok('the preview cannot be typed into', !/<textarea|<input|contentEditable/.test(preview))
  // The one clause that must never be faked: nothing here knows whether the debtor answered.
  ok('...and never claims the debtor failed to reply', !/reached:\s*false/.test(preview))
}

/*
 * The ask is the feature, not the flag. "Client action required" tells a client nothing; a
 * request with no words cannot be acted on, so it must be refused rather than raised empty.
 */
const freezeSrc = readFileSync(new URL('../../src/lib/accountFreeze.ts', import.meta.url), 'utf8')
ok('a client request with no words is refused', /if \(!ask\) throw/.test(freezeSrc))
ok('the flag is raised by the ask, never by a separate switch',
  !/client_action_required/.test(freezeSrc))
for (const col of ['client_action_ask', 'client_action_due']) {
  ok(`schema.sql carries ${col}`, new RegExp(`\\b${col}\\b`).test(schema))
  ok(`accountBook maps ${col}`, new RegExp(`${col.replace(/_(.)/g, (_, c) => c.toUpperCase())}:`).test(book))
}

// A freeze without a reason is the state being fixed; it must be refused, not defaulted.
const freeze = readFileSync(new URL('../../src/lib/accountFreeze.ts', import.meta.url), 'utf8')
ok('a freeze with no reason is refused', /if \(!reason\) throw/.test(freeze))
ok('an unfreeze with no reason is refused too', /if \(!reason\) throw new Error\('Restarting/.test(freeze))

/*
 * NEGOTIATING IS ALSO A SUB-STATUS, not only something inferred from a conversation in the
 * period. The firm types it, and reading it only from `reachedInPeriod` reported accounts
 * somebody had recorded as in talks as "In progress".
 */
check('a recorded negotiation is a negotiation',
  clientPosition({ status: 'Active: Activated', subStatus: 'Negotiating' }), 'negotiating')
/*
 * BUT BELOW THE STRUCTURAL RUNGS, and the assertion has to contain BOTH words or it proves
 * nothing about the order. Checking a plain 'Defended Matter' passes wherever the negotiating
 * line is put — it was written that way first, and moving the line above `legal` left it green.
 * A sub-status that names both is the only thing that pins the precedence down.
 */
check('a defended matter under negotiation is still a dispute',
  clientPosition({ status: 'Active: Activated', subStatus: 'Defended Matter — negotiating settlement' }),
  'disputed')
check('...and a summons under negotiation is still legal',
  clientPosition({ status: 'Active: Activated', subStatus: 'Summons issued, negotiating' }), 'legal')
check('...and a debtor under debt review is still theirs to run',
  clientPosition({ status: 'Active: Activated', subStatus: 'Debt Review — negotiating' }),
  'under_administration')
/* And Section 129 still is NOT legal — the firm's rule, and 848 accounts ride on it. */
check('section 129 is still not legal action',
  clientPosition({ status: 'Active: Activated', subStatus: 'Section 129' }), 'in_progress')

/* ---------- the bucket is evidence, and only where nothing better exists ---------- */

/*
 * HALF THE INHERITED BOOK HAS NO SUB-STATUS. 2 791 of the real import carry none at all, and for
 * 426 of them Swordfish's own filing — the PTPs and Failed PTPs buckets — is the only record that
 * a promise was ever made or broken. Reporting those as "In progress" threw that away and told
 * the client nothing, which is exactly the mistake this whole file exists to prevent.
 */
check('a failed-PTP bucket with nothing else is a broken arrangement',
  clientPosition({ status: 'Active: Activated', bucket: 'Failed PTPs' }), 'broken_arrangement')
check('...and a PTP bucket is an arrangement',
  clientPosition({ status: 'Active: Activated', bucket: 'PTPs' }), 'arranged')
check('...while the diary bucket says nothing either way',
  clientPosition({ status: 'Active: Activated', bucket: 'Diary' }), 'in_progress')

/*
 * BUT IT NEVER OVERRIDES A SUB-STATUS, and this is the case that matters. "Delinquent Payer" in
 * the Failed PTPs bucket is a REFUSAL — somebody who does not pay at all — not an arrangement
 * that came up short. The two are already the subject of a correction earlier in this file, and a
 * coarser field is not allowed to undo it.
 */
check('a refusal in the failed bucket is still a refusal',
  clientPosition({ status: 'Active: Activated', subStatus: 'Delinquent Payer', bucket: 'Failed PTPs' }),
  'refusing')
check('...and a dispute is still a dispute',
  clientPosition({ status: 'Active: Activated', subStatus: 'Defended Matter', bucket: 'Failed PTPs' }),
  'disputed')
check('...and tracing is still tracing',
  clientPosition({ status: 'Active: Activated', subStatus: 'Tracing', bucket: 'PTPs' }), 'tracing')

/*
 * And nothing structural is touched. A frozen or written-off account is off the book whatever
 * bucket it was filed in — those two are tested before anything else for exactly this reason.
 */
check('a frozen account in the PTP bucket is still frozen',
  clientPosition({ status: 'Frozen', bucket: 'PTPs' }), 'frozen')
check('...and a written-off one is still closed',
  clientPosition({ status: 'Written-off', bucket: 'Failed PTPs' }), 'closed')

/* ---------- one more rung, and only we see it ---------- */

/*
 * THE FIRM'S DECISION: New, but internal only. A brand-new account and one worked for six months
 * without getting anywhere both reported as "In progress", and inside the firm those are not the
 * same thing — one needs a first call, the other needs a different approach. A client still sees
 * thirteen rungs, because adding a word to their vocabulary changes what every historical report
 * means.
 */
check('a never-worked account reads New to us',
  deskPosition({ status: 'Active: Activated', everWorked: false }), 'new')
check('...and In progress once somebody has touched it',
  deskPosition({ status: 'Active: Activated', everWorked: true }), 'in_progress')
/*
 * Not knowing is not the same as knowing it is new. Where `everWorked` is not supplied at all the
 * rung must not appear — a caller that has not been taught about it should not start showing it.
 */
check('...and nothing without being told',
  deskPosition({ status: 'Active: Activated' }), 'in_progress')

/*
 * IT ONLY EVER DISPLACES "IN PROGRESS". An account nobody has worked yet but which is frozen, or
 * disputed, or under administration IS those things — they are facts about the account, not about
 * whether we have got to it.
 */
check('a never-worked frozen account is still frozen',
  deskPosition({ status: 'Frozen', everWorked: false }), 'frozen')
check('...a never-worked dispute is still disputed',
  deskPosition({ status: 'Active: Activated', subStatus: 'Defended Matter', everWorked: false }), 'disputed')
check('...and a never-worked promise is still arranged',
  deskPosition({ status: 'Active: Activated', subStatus: 'Promise To Pay', everWorked: false }), 'arranged')

/*
 * AND THE CLIENT NEVER SEES IT. This is the line that keeps two vocabularies two, and the one
 * this whole file exists to hold.
 */
check('the client report has no such rung',
  positionReport({ status: 'Active: Activated', everWorked: false }).position, 'in_progress')
ok('...and clientPosition cannot return it',
  clientPosition({ status: 'Active: Activated', everWorked: false }) !== 'new')
check('the client vocabulary is still thirteen', Object.keys(CLIENT_POSITIONS).length, 13)
check('...and ours is exactly one more', Object.keys(DESK_POSITIONS).length, 14)
ok('...which is the one we added', 'new' in DESK_POSITIONS && !('new' in CLIENT_POSITIONS))

/* ---------- what the DEBTOR said, not what we did ---------- */

/*
 * "I DON'T LIKE THE FACT THAT YOU TELL THE CLIENT THAT WE WORKED THE ACCOUNT. IT'S STUPID." The
 * firm's words, and they are right: it says nothing happened while sounding like something did.
 * Where a collector has recorded what the debtor actually said, that is the sentence — it is a
 * fact about the debtor, which is what the client is asking about.
 */
check('a negotiation says so',
  clientLine({ position: 'negotiating', lastAttemptOn: '2026-09-16' }).happened,
  'We negotiated with the debtor on 16 September 2026.')
check('a hardship is stated as the debtor stated it',
  clientLine({ position: 'cannot_pay', lastAttemptOn: '2026-09-16' }).happened,
  'The debtor advised on 16 September 2026 that they are not in a position to pay the account.')
check('a refusal is stated as the debtor stated it',
  clientLine({ position: 'refusing', lastAttemptOn: '2026-09-16' }).happened,
  'The debtor advised on 16 September 2026 that they are not willing to pay the account.')
check('an administration names the practitioner as the route',
  clientLine({ position: 'under_administration' }).happened,
  'The debtor is under a formal process and the matter is being dealt with through the appointed practitioner.')
/*
 * WILL NOT AND CANNOT MUST NOT READ THE SAME. One is a legal decision and the other is a
 * pensioner, and the firm's rule is that they never appear on one list. Two sentences that
 * differ by a word would put them on one in a client's eyes.
 */
ok('cannot and will not read differently',
  clientLine({ position: 'cannot_pay', lastAttemptOn: '2026-09-16' }).happened
  !== clientLine({ position: 'refusing', lastAttemptOn: '2026-09-16' }).happened)
/* And "we worked the account" survives only where genuinely nothing else is known. */
ok('the weak sentence is gone once anything is recorded',
  !/We worked the account/.test(clientLine({ position: 'refusing', lastAttemptOn: '2026-09-16' }).happened))

/*
 * A FOLLOW-UP IS NOT ONE THING. Four rungs book a plain follow-up and "we will follow the account
 * up" tells a client nothing about any of them. The firm spelled out what each is actually going
 * to do, and it is different work in each case.
 */
{
  const nextFor = (position) => clientLine({ position, next: { kind: 'review', dueOn: '2026-09-23' } }).next
  check('negotiations continue', nextFor('negotiating'),
    'We will continue negotiations with the debtor on 23 September 2026.')
  check('a hardship is revisited for an arrangement', nextFor('cannot_pay'),
    'We will follow up on 23 September 2026 to establish whether an arrangement can be made.')
  check('a refusal is pressed for one', nextFor('refusing'),
    'We will follow up on 23 September 2026 to press for an arrangement.')
  check('an administration goes to the practitioner', nextFor('under_administration'),
    'We will take the matter up with the appointed practitioner on 23 September 2026.')
  ok('...and none of them reads the same as another',
    new Set(['negotiating', 'cannot_pay', 'refusing', 'under_administration'].map(nextFor)).size === 4)
}
/*
 * The rung only speaks where the diary has nothing better. A dispute chase already names the work
 * exactly, and letting the position override it would make the sentence vaguer, not sharper.
 */
check('a dispute chase keeps its own words',
  clientLine({ position: 'negotiating', next: { kind: 'dispute_chase', dueOn: '2026-09-23' } }).next,
  'We will follow up the written dispute on 23 September 2026.')

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
