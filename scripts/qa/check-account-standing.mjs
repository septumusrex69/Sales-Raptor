/**
 * Who is behind a debtor, and what is already against them.
 *
 * Three facts that change what the call is, and that the book could hold none of:
 *
 *   - an appointed PRACTITIONER, because once a debtor is liquidated, sequestrated, curated,
 *     deceased, in business rescue or under debt review the debt is still owed but the DEBTOR IS
 *     NO LONGER THE PERSON TO ASK;
 *   - the DIRECTORS of a company, because a company is not rung, its people are;
 *   - JUDGMENTS other creditors already hold, which the firm has said will drive an internal
 *     likelihood of collection reported back to clients.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-account-standing.mjs
 */
import { readFileSync } from 'node:fs'
import {
  PRACTITIONER_KINDS, directorshipSummary, judgmentSummary, practitionerLabel,
  practitionerMeaning, sortDirectors, splitJudgments,
} from '../../src/lib/accountStanding.ts'

let pass = 0
const failures = []
const ok = (name, actual) => {
  if (actual === true) { pass += 1; return }
  failures.push(`${name}\n    expected true\n    got      ${JSON.stringify(actual)}`)
}
/*
 * Compared by VALUE, not by identity. Object.is on two equal arrays is false, so an assertion
 * about a list failed while printing two identical lines — which reads as a broken check rather
 * than a broken list, and is the fastest way to teach somebody to stop trusting the output.
 */
const eq = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const schema = read('../../supabase/schema.sql')
const book = read('../../src/lib/accountBook.ts')
const detail = read('../../src/pages/accounts/AccountDetail.tsx')
const practitionerModal = read('../../src/pages/accounts/PractitionerModal.tsx')
const standingData = read('../../src/lib/accountStandingData.ts')

/* ---------- the practitioner: who to deal with instead of the debtor ---------- */

ok('the account can say who is appointed',
  /add column if not exists practitioner_kind/.test(schema))
/*
 * SIX KINDS, NOT FREE TEXT. Each is a different office with a different claim procedure, and a
 * collector has to tell them apart at a glance. Free text would let one estate be filed under
 * "liquidator", the next under "Liq." and the third under a firm's name.
 */
for (const kind of ['liquidator', 'trustee', 'curator', 'executor', 'business_rescue', 'debt_counsellor']) {
  ok(`...and '${kind}' is one of them`,
    new RegExp(`check \\(practitioner_kind in[\\s\\S]{0,200}'${kind}'`).test(schema))
}
/* Their reference, because every claim submission has to quote it back. */
ok('the estate reference is kept', /add column if not exists practitioner_reference text/.test(schema))
/* Claims run on deadlines counted from the appointment, not from our handover. */
ok('...and the appointment date', /add column if not exists practitioner_appointed_on date/.test(schema))
ok('the column says what null means',
  /comment on column public\.debtor_accounts\.practitioner_kind/.test(schema))

/* Every kind in the database has a label and a meaning in the app, and no more. */
eq('the app offers exactly the six the database allows', PRACTITIONER_KINDS.length, 6)
for (const p of PRACTITIONER_KINDS) {
  ok(`'${p.kind}' is in the column's check constraint`,
    new RegExp(`check \\(practitioner_kind in[\\s\\S]{0,200}'${p.kind}'`).test(schema))
  ok(`...and says what it means for the collector`, p.meaning.length > 20)
}
eq('a kind reads as a label', practitionerLabel('business_rescue'), 'Business rescue practitioner')
/* Null is the ordinary case — nobody appointed — and must not read as a missing label. */
eq('nobody appointed has no label', practitionerLabel(null), null)
eq('...and no meaning', practitionerMeaning(null), null)

/* ---------- and it survives the hand-written mapper ---------- */

/*
 * THE TRAP THIS CODEBASE ALREADY HAS A NAME FOR. accountBook.toAccount lists every field by
 * hand, so a column in the database, in the type and in the select('*') but missing from the
 * mapper reads as undefined for ever and nothing fails. diary_capacity sat there for months.
 */
for (const [field, column] of [
  ['practitionerKind', 'practitioner_kind'],
  ['practitionerName', 'practitioner_name'],
  ['practitionerFirm', 'practitioner_firm'],
  ['practitionerReference', 'practitioner_reference'],
  ['practitionerPhone', 'practitioner_phone'],
  ['practitionerEmail', 'practitioner_email'],
  ['practitionerAppointedOn', 'practitioner_appointed_on'],
]) {
  ok(`the type carries ${field}`, new RegExp(`\\n  ${field}:`).test(book))
  ok(`...and the mapper reads ${column}`, new RegExp(`${field}: \\(?r\\.${column}\\b`).test(book))
}

/* ---------- judgments ---------- */

ok('judgments have their own table', /create table if not exists public\.account_judgments/.test(schema))
/*
 * ROWS, NOT A COUNT. Which creditor and how long ago is the whole content: a count cannot tell a
 * small retail judgment from six years ago from SARS last year. Four columns carry that.
 */
for (const col of ['case_number', 'case_type', 'case_reason', 'plaintiff', 'filed_on', 'amount']) {
  ok(`...recording ${col}`,
    new RegExp(`create table if not exists public\\.account_judgments[\\s\\S]{0,900}\\n  ${col} `).test(schema))
}
/* A re-pulled bureau profile must update a judgment, never add a second copy of it. */
ok('a re-pulled profile cannot duplicate a judgment', /unique \(account_id, case_number\)/.test(schema))
ok('...and they are read newest first',
  /account_judgments_account_idx[\s\S]{0,90}\(account_id, filed_on desc\)/.test(schema))
ok('the table is not readable by the world',
  /alter table public\.account_judgments enable row level security/.test(schema))

/* ---------- what the judgments add up to ---------- */

const J = (over) => ({
  id: 'x', accountId: 'a', caseNumber: 'c', caseType: null, caseReason: null, plaintiff: null,
  filedOn: null, amount: null, sourceText: null, source: 'xds', againstDirectorId: null,
  recordedAt: '2026-01-01T00:00:00Z', ...over,
})

const none = judgmentSummary([])
eq('no judgments is a count of none', none.count, 0)
eq('...with nothing to date', none.newest, null)
eq('...and nothing owing', none.total, 0)

const two = judgmentSummary([
  J({ id: 'j1', caseNumber: '40990/2023', filedOn: '2023-11-08', amount: 412870.44, plaintiff: 'SARS' }),
  J({ id: 'j2', caseNumber: '40021/2024', filedOn: '2024-10-04', amount: null, plaintiff: 'Bosveld Plant Hire' }),
])
eq('two judgments count as two', two.count, 2)
/*
 * THE NEWEST IS WHAT SAYS WHETHER THIS IS HISTORY OR A LIVE PROBLEM, and it is not the first row
 * or the last: the newest FILING date wins whatever order they arrive in. Both real judgments on
 * one real profile were filed out of case-number order.
 */
eq('...and the newest is the latest filing, not the first row', two.newest, '2024-10-04')
/*
 * A JUDGMENT WITHOUT AN AMOUNT IS NOT ZERO. A summary profile often carries none. Counting it as
 * zero would be a total that reads as the whole when it is a floor, so it is counted separately
 * and the panel says "at least".
 */
eq('...the total leaves out the ones with no amount', two.total, 412870.44)
eq('...and says how many those were', two.withoutAmount, 1)

const undated = judgmentSummary([J({ filedOn: null, amount: 100 })])
eq('a judgment with no filing date leaves the newest unknown', undated.newest, null)
eq('...but still counts', undated.count, 1)

/* ---------- directors ---------- */

const D = (fullName, status) => ({
  id: fullName, accountId: 'a', idNumber: null, fullName, status, appointedOn: null,
  source: 'xds', tracedAt: null, companies: [],
})
/*
 * ACTIVE FIRST, THEN BY NAME. One real profile carries six directors of whom four have resigned.
 * Sorted by name alone the two people worth a call sit third and fifth in a list nobody reads to
 * the end — so the order is the difference between two calls and six.
 */
const sorted = sortDirectors([
  D('Yolanda Pillay', 'Resigned'),
  D('Thabo Radebe', 'Active'),
  D('Elmarie du Toit', 'Resigned'),
  D('Sipho Radebe', 'Active'),
])
eq('the active directors come first', sorted.slice(0, 2).every((d) => d.status === 'Active'), true)
eq('...in name order among themselves', sorted[0].fullName, 'Sipho Radebe')
eq('...and the resigned follow, also in name order', sorted[2].fullName, 'Elmarie du Toit')
/* Sorting must not reorder the caller's array under it — the fetch reuses the mapped list. */
const original = [D('B', 'Resigned'), D('A', 'Active')]
sortDirectors(original)
eq('sorting leaves the caller\'s list alone', original[0].fullName, 'B')
/*
 * AN UNKNOWN STATUS IS NOT ACTIVE. A bureau row with a blank status must not jump the queue.
 *
 * The names are deliberately the wrong way round: the blank-status director sorts FIRST by name,
 * so only a rule that ranks Active above everything else puts the active one on top. With both
 * names in alphabetical agreement the assertion passes whatever the rule is — which is exactly
 * how it read the first time.
 */
eq('an unknown status does not rank as active',
  sortDirectors([D('Abel Unknown', null), D('Zanele Active', 'Active')])[0].fullName, 'Zanele Active')

/*
 * A JUDGMENT NOBODY COULD PARSE IS STILL A JUDGMENT. It counts, and it is named separately so the
 * screen can say which ones are quoted rather than read — and so nothing ever reports on a
 * plaintiff that was never established.
 */
const quoted = judgmentSummary([
  J({ id: 'a', caseNumber: '1/2024', plaintiff: 'SARS', amount: 100, filedOn: '2024-01-01' }),
  J({ id: 'b', caseNumber: '2/2024', plaintiff: null, sourceText: 'SOMETHING NOBODY SPLIT', filedOn: '2024-02-01' }),
])
eq('an unread judgment still counts', quoted.count, 2)
eq('...and is counted as unread', quoted.unread, 1)
/* A row that WAS read carries no quoted text, so it must never be counted among them. */
eq('...while a row that read cleanly is not',
  judgmentSummary([J({ plaintiff: 'SARS', sourceText: 'anything' })]).unread, 0)

/* ---------- whose judgment is it ---------- */

/*
 * THE READ SIDE OF THE DISTINCTION, and it is the half that was missing.
 *
 * The importer files a director's own judgments against them, the column exists and the schema
 * check passed — and the fetch then selected every judgment on the account and handed them to one
 * list. The rows were filed correctly and displayed wrongly, which is worse than not storing them
 * at all: the screen asserts something the database does not, and the number it shows is the one
 * the firm has said will drive what it reports to clients.
 */
const mixed = [
  J({ id: 'a', caseNumber: '1/2024', plaintiff: 'SARS' }),
  J({ id: 'b', caseNumber: '2/2024', plaintiff: 'A supplier' }),
  J({ id: 'c', caseNumber: '3/2024', plaintiff: 'A bank', againstDirectorId: 'dir-1' }),
  J({ id: 'd', caseNumber: '4/2024', plaintiff: 'A retailer', againstDirectorId: 'dir-1' }),
  J({ id: 'e', caseNumber: '5/2024', plaintiff: 'A council', againstDirectorId: 'dir-2' }),
]
const split = splitJudgments(mixed)
eq('only the debtor\'s own are the debtor\'s own', split.own.map((j) => j.caseNumber), ['1/2024', '2/2024'])
/*
 * READ DEFENSIVELY. `.get()` on a Map returns undefined, and calling .map on that throws a
 * TypeError two lines below the assertion that should have reported the problem — so a genuine
 * failure came out as a stack trace with zero failed checks printed. The house has a name for
 * this one; see CLAUDE.md.
 */
eq('...a director\'s go under that director',
  (split.byDirector.get('dir-1') ?? []).map((j) => j.caseNumber), ['3/2024', '4/2024'])
eq('...and each director keeps their own', (split.byDirector.get('dir-2') ?? []).length, 1)
eq('...with nobody counted twice', split.own.length + [...split.byDirector.values()].flat().length, mixed.length)
/*
 * AND THE COUNT THE CLIENT SEES IS THE SPLIT ONE. This is the assertion that matters: a company
 * with two judgments and three directors who have been sued must read as two, not five.
 */
eq('the count is of the debtor\'s judgments alone', judgmentSummary(split.own).count, 2)

/* ---------- the other companies a director sits on ---------- */

const K = (companyName, status, appointedOn) => ({
  id: companyName, directorId: 'd', companyName, status, appointedOn, registrationNumber: null,
})
/*
 * THE FIRM'S OWN SHAPE: "We could mention the active directorships. But if there are other
 * directorships where he's not active, there can be a little sign that says there are other
 * directors that he's not active anymore."
 *
 * So the live ones are NAMED — those are companies that could be approached — and the rest are a
 * count. One real profile carries thirty; listed in full they bury the account under a CV.
 */
const held = directorshipSummary([
  K('Marico Civils CC', 'Resigned', '2011-08-15'),
  K('Kopano Freight Services', 'Active', '2019-04-02'),
  K('Vaalkop Transport', 'Resigned', '2015-06-30'),
  K('Setlogelo Holdings', 'Active', '2023-01-10'),
])
eq('the live directorships are named', held.active.map((c) => c.companyName),
  ['Setlogelo Holdings', 'Kopano Freight Services'])
eq('...newest appointment first, because that is the live one', held.active[0].companyName, 'Setlogelo Holdings')
eq('...and the rest are a count, not a list', held.resigned, 2)
/* An unknown status is not Active — it must not be named as a company that can be approached. */
eq('an unknown status is counted, not named', directorshipSummary([K('Somewhere', null, null)]).active.length, 0)
eq('...but it is still counted', directorshipSummary([K('Somewhere', null, null)]).resigned, 1)
eq('nobody with directorships shows nothing', directorshipSummary([]), { active: [], resigned: 0 })

/* ---------- and the collector can see all of it ---------- */

ok('there is a panel for it', /function StandingPanel/.test(detail))
ok('...fetched with the account', /fetchStanding\(id\)/.test(detail))
ok('...and refetched after a write', /fetchStanding\(account\.id\)/.test(detail))
/*
 * WITH THE DEBTOR'S DETAILS, NOT AMONG THE FIGURES.
 *
 * It sat in the right-hand column with the money panels and the firm's word for that was "a weird
 * place" — correctly. Standing is not a figure: the directors are how you reach a company at all,
 * and the judgments say what queue you are joining. Beside the phone numbers it is part of one
 * thought; under the settlement figure it is an interruption.
 *
 * PRESENCE ASSERTED BEFORE ORDER. indexOf returns -1 for something missing, so an order-only
 * assertion passes vacuously the day the panel is deleted — and passes twice over, because -1 is
 * less than everything.
 */
const detailsSlot = /const detailsPanel = \(([\s\S]*?)\n  \)\n/.exec(detail)?.[1] ?? ''
ok('the panel is in the details column', detailsSlot.includes('<StandingPanel'))
ok('...beside the debtor\'s own details', detailsSlot.includes('<DebtorDetailsPanel'))
ok('...after them, because it answers the same question',
  detailsSlot.indexOf('<DebtorDetailsPanel') < detailsSlot.indexOf('<StandingPanel'))
/* And gone from the figures column, or it renders twice. */
ok('...and not left among the figures', !/side=\{\[[^\]]*[Ss]tandingPanel/.test(detail))
/*
 * The details slot is ONE node and two of RecordLayout's three arrangements put no gap between
 * siblings, so the two cards touched. The wrapper is what keeps them apart in all three.
 */
ok('the two cards are spaced in every layout', /const detailsPanel = \(\s*\n\s*<div className="space-y-4">/.test(detail))
/*
 * THE EMPTY STATE IS THE WAY IN, on every account.
 *
 * This card used to hide itself on an individual with nothing on it — an empty card across
 * several hundred thousand accounts is a card people stop seeing. The firm asked for it back:
 * "put it there as an empty box where you can upload a trace or do the trace." They are right,
 * and the old reasoning answered the wrong question. It is not an empty card, it is where the
 * work starts, and an individual with no bureau profile is exactly the account where somebody
 * needs to run a search.
 */
ok('the panel knows when it is empty',
  /const bare = !hasPractitioner && directors\.length === 0 && judgments\.length === 0/.test(detail))
ok('...and shows the box rather than hiding itself',
  !/if \(bare && account\.debtorKind !== 'company'\) return null/.test(detail))
ok('...saying plainly that there is no trace', /No trace on this account yet/.test(detail))
/*
 * BOTH WAYS IN, which is the point of the box: run a search, or read a PDF you already have.
 * The search is the one that costs money, so it is the one that carries the weight.
 */
ok('...offering the search itself', /\{traceAction\}/.test(detail))
ok('...and the upload beside it', /Upload a trace I already have/.test(detail))
/*
 * ONE Trace button, handed in rather than rebuilt. A second copy in the panel would be a second
 * place for item 4(c) to drift from the one in the action row.
 */
ok('the panel does not build its own trace button',
  (detail.match(/<TraceButton/g) ?? []).length === 2 && /traceAction: React\.ReactNode/.test(detail))

/* The firm's word for this panel. It is about the trace, not about an abstract "standing". */
ok('the panel is called Trace', />Trace<\/PanelTitle>/.test(detail))
/*
 * A WARNING THAT ONLY FIRES WHEN SOMETHING IS ACTUALLY WRONG. The account reports as under
 * administration and there is no record of who is administering it — a claim nobody can submit.
 * On every other rung a missing practitioner is simply the normal case, and warning there would
 * train people to stop reading the warnings.
 */
ok('a missing practitioner is a warning only where it is one',
  /position === 'under_administration' && !hasPractitioner/.test(detail))
ok('...and it says what cannot happen until it is filled in',
  /Nobody recorded to claim from/.test(detail))
ok('the panel says not to deal with the debtor',
  /Deal with the \{\(kindLabel \?\? 'practitioner'\)\.toLowerCase\(\)\}, not the debtor/.test(detail))
/*
 * NO SCORE. The firm has said this data will drive a likelihood of collection reported back to
 * clients — which has to be calibrated against their own recovered outcomes, not invented here.
 * Until then the panel shows the rows and lets a collector read them. See BACKLOG.
 */
ok('the judgments are shown as rows, not as a score', /Judgments against \{account\.debtorKind/.test(detail))
/* The panel must count and list the split ones, not the raw fetch. */
ok('the panel splits before it counts', /splitJudgments\(judgments\)/.test(detail))
ok('...and summarises only the debtor\'s own', /judgmentSummary\(ownJudgments\)/.test(detail))
ok('...and lists only those', /\{ownJudgments\.map\(\(j\) =>/.test(detail))
/* A director's own judgments still appear — under their name, where they belong. */
ok('a director\'s own judgments show under the director',
  /<PersonalJudgments judgments=\{directorJudgments\.get\(d\.id\)/.test(detail))
ok('...saying plainly that they are personal', /judgments against them personally/.test(detail))
/*
 * AND THE COLUMN HAS TO SURVIVE THE HAND-WRITTEN MAPPER — both halves of it, asserted separately.
 *
 * A file-wide search for the column name passes with the mapper line deleted, because the select
 * still names it. That is the silent-undefined trap this codebase already has a name for, dressed
 * up as a check: the row comes back carrying who the judgment is against, the mapper throws it
 * away, and every judgment reads as the company's.
 */
ok('the select asks for who it is against',
  /select\('id,account_id,against_director_id,case_number/.test(standingData))
ok('...and the mapper reads it off the row',
  /againstDirectorId: r\.against_director_id/.test(standingData))
ok('...and on the type', /againstDirectorId: string \| null/.test(read('../../src/lib/accountStanding.ts')))
/* The quoted rows are quoted on screen too, never dressed up as a plaintiff. */
ok('an unread judgment is shown in the bureau\'s own words', /As printed: &ldquo;\{j\.sourceText\}/.test(detail))
ok('...only where nothing was read from it', /j\.plaintiff === null && j\.sourceText !== null/.test(detail))

/* ---------- the directorships, and the little sign ---------- */

ok('a director carries their other companies', /<Directorships companies=\{d\.companies\}/.test(detail))
ok('...naming the live ones', /Also directs \{named\.map/.test(detail))
/*
 * BUT NOT ALL OF THEM. One real director on the firm's own book actively directs twenty-five
 * companies; named in full they take more room than the rest of the panel and the point of naming
 * them is lost. The newest few are named — those are the live concerns — and the rest are a count.
 */
ok('...capped, with the rest counted', /const named = active\.slice\(0, NAME_AT_MOST\)/.test(detail))
ok('...and the overflow said out loud', /\$\{unnamed\} more/.test(detail))
ok('...and counting the rest', /has resigned from.{0,40}\{resigned\}/s.test(detail))
ok('a director with none shows nothing', /if \(companies\.length === 0\) return null/.test(detail))

/* ---------- the client's line reads from the rung, not from the fallback ---------- */

/*
 * THE SENTENCE THE FIRM CALLED STUPID, and why it was still on screen.
 *
 * accountNarrative writes a different sentence per position — that was the whole point of the
 * rewrite — and every one of them is guarded on `position`. The account page computed the rung
 * for the panel's heading and did not pass it to the sentence, so clientLine fell through to its
 * last resort on every single account: "We worked the account on 2 September."
 *
 * Asserted at the call site, because the library was right and the caller was not.
 */
const lineCall = /line=\{clientLine\(\{([\s\S]*?)\n      \}\)\}/.exec(detail)?.[1] ?? ''
ok('the client line is given the rung', /position: clientReport\.position/.test(lineCall))
/* The same value the heading uses, or the label and the sentence can disagree on one account. */
ok('...the same one the panel is headed with', /position=\{CLIENT_POSITIONS\[clientReport\.position\]\}/.test(detail))

/* ---------- somebody can actually record the practitioner ---------- */

/*
 * IT IS NOT ON THE PDF. A profile that says "Final Liquidation" does not name the liquidator —
 * that is published in the Gazette and held by the Master's office. So the fields exist, the
 * warning names the gap, and this is where a person fills it.
 */
ok('there is a form for it', /export function PractitionerModal/.test(practitionerModal))
ok('...offering each office by name', /PRACTITIONER_KINDS\.map/.test(practitionerModal))
ok('...and saying where to go and look when you do not have it',
  /Master of the[\s\S]{0,20}High Court/.test(practitionerModal))
ok('...writing every field', /practitioner_appointed_on/.test(standingData))
/* Clearing the kind is a correction, not an appointment ending — it must not touch the rung. */
ok('recording a practitioner does not move the account', !/sub_status/.test(practitionerModal))
/* A warning with no way out is a nag. The one on the panel carries the thing that clears it. */
ok('the warning carries the fix', /Add the practitioner/.test(detail))
ok('...and the panel can change one already on file', /action=\{\{ label: 'Change', onClick: onPractitioner \}\}/.test(detail))
ok('...and the total says it is a floor when one has no amount',
  /summary\.withoutAmount > 0 \? 'At least ' : ''/.test(detail))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
An account can say who to deal with when the debtor is no longer the person to ask, who the
directors of a company are, and what judgments other creditors already hold. The judgments are
shown as rows and not as a score: the likelihood of collection they will feed goes onto a client
report, and has to be calibrated against the firm's own outcomes first.`)
