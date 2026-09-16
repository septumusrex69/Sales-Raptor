/**
 * Working a trace: what the bureau claimed, and what the firm found out about it.
 *
 * THE DISTINCTION THIS WHOLE FEATURE RESTS ON. account_contacts is the curated list a collector
 * rings. A trace item is a third party's claim about somebody, often stale and occasionally about
 * a namesake. One becomes the other because a person tried it and said so — never because a
 * bureau printed it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-trace-work.mjs
 */
import { readFileSync } from 'node:fs'
import {
  TRACE_OUTCOMES, canPromote, contactKindFor, currentEmployer, heldProperty, outcomeLabel,
  principalAddress, principalPhone, traceSummary,
} from '../../src/lib/traceStore.ts'

let pass = 0
const failures = []
const ok = (name, actual) => {
  if (actual === true) { pass += 1; return }
  failures.push(`${name}\n    expected true\n    got      ${JSON.stringify(actual)}`)
}
const eq = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const schema = read('../../supabase/schema.sql')
const store = read('../../src/lib/traceStore.ts')
const data = read('../../src/lib/traceStoreData.ts')
const workspace = read('../../src/pages/accounts/TraceWorkspaceModal.tsx')
const detail = read('../../src/pages/accounts/AccountDetail.tsx')
const importer = read('../../src/lib/traceImport.ts')

const I = (over) => ({
  id: 'x', traceId: 't', accountId: 'a', kind: 'mobile', value: '0821110000', label: null,
  peopleLinked: null, seenOn: null, amount: null, status: null,
  outcome: null, outcomeAt: null, outcomeNote: null, promotedContactId: null, ...over,
})

/* ---------- four outcomes, and the middle two are not the same ---------- */

eq('there are four things that can happen to a number', TRACE_OUTCOMES.length, 4)
/*
 * A NUMBER THAT RINGS OUT IS NOT A DEAD NUMBER. One is a live line nobody answered — worth
 * another hour of the day — and the other is switched off or disconnected. The firm asked for
 * exactly this: "you couldn't make contact, but it was ringing or the phone was off or whatever."
 * Collapsed into one outcome, a collector has no way to say which and the next one re-dials a
 * disconnected line.
 */
ok('ringing out is told apart from being switched off',
  TRACE_OUTCOMES.some((o) => o.outcome === 'no_answer') && TRACE_OUTCOMES.some((o) => o.outcome === 'unreachable'))
ok('...and "not the debtor" is its own answer again',
  TRACE_OUTCOMES.some((o) => o.outcome === 'not_theirs'))
eq('an outcome reads as words', outcomeLabel('no_answer'), 'Rang, no answer')
eq('...and an untried one has no label', outcomeLabel(null), null)

/* ---------- the principal number ---------- */

/*
 * WHAT WE KNOW BEATS WHAT THE BUREAU SAID. A number somebody has actually reached the debtor on
 * is the principal number whatever its date — the bureau's "last seen" is when it saw the number,
 * not when it last worked.
 */
const phones = [
  I({ id: 'recent', value: '0821110001', seenOn: '2026-09-07', peopleLinked: 1 }),
  I({ id: 'reached', value: '0821110002', seenOn: '2019-01-01', outcome: 'verified' }),
  I({ id: 'rang', value: '0821110003', seenOn: '2026-09-06', outcome: 'no_answer' }),
]
eq('a number somebody reached them on is the principal one', principalPhone(phones).id, 'reached')
/* Below that, a line that at least rang beats one nobody has tried. */
eq('...then one that rang', principalPhone(phones.filter((p) => p.id !== 'reached')).id, 'rang')
eq('...then the bureau\'s own ordering',
  principalPhone([I({ id: 'old', seenOn: '2019-01-01' }), I({ id: 'new', seenOn: '2026-01-01' })]).id, 'new')
/* Tied on the date, the number against fewer other people is the more likely to be theirs. */
eq('...and a number against fewer people wins a tie', principalPhone([
  I({ id: 'shared', seenOn: '2026-01-01', peopleLinked: 12 }),
  I({ id: 'theirs', seenOn: '2026-01-01', peopleLinked: 1 }),
]).id, 'theirs')
/*
 * A NUMBER SOMEBODY RULED OUT IS NEVER OFFERED, however recent. That is the entire point of
 * recording an outcome — a summary that keeps promoting a number a collector has already proved
 * wrong teaches people to stop recording them.
 */
eq('a number proved not theirs is never principal', principalPhone([
  I({ id: 'wrong', seenOn: '2026-09-09', outcome: 'not_theirs' }),
  I({ id: 'ok', seenOn: '2020-01-01' }),
]).id, 'ok')
eq('...nor is a dead one', principalPhone([
  I({ id: 'dead', seenOn: '2026-09-09', outcome: 'unreachable' }),
  I({ id: 'ok', seenOn: '2020-01-01' }),
]).id, 'ok')
eq('...and if they are all ruled out, there is no principal number', principalPhone([
  I({ outcome: 'not_theirs' }), I({ outcome: 'unreachable' }),
]), null)
/* An address or a job is not a number, whatever else is true of it. */
eq('only a number can be the principal number',
  principalPhone([I({ kind: 'address', value: 'somewhere' })]), null)
eq('nothing at all is not a number', principalPhone([]), null)

/* ---------- address, employer, property ---------- */

eq('the principal address is the most recent', principalAddress([
  I({ id: 'old', kind: 'address', seenOn: '2019-01-01' }),
  I({ id: 'new', kind: 'address', seenOn: '2026-01-01' }),
]).id, 'new')
eq('...unless one was confirmed', principalAddress([
  I({ id: 'new', kind: 'address', seenOn: '2026-01-01' }),
  I({ id: 'seen', kind: 'address', seenOn: '2010-01-01', outcome: 'verified' }),
]).id, 'seen')
eq('...and one ruled out is not an address', principalAddress([
  I({ kind: 'address', seenOn: '2026-01-01', outcome: 'not_theirs' }),
]), null)
eq('the employer is the most recently seen', currentEmployer([
  I({ id: 'old', kind: 'employer', seenOn: '2011-01-01' }),
  I({ id: 'now', kind: 'employer', seenOn: '2026-01-01' }),
]).id, 'now')

/*
 * ONLY WHAT THEY STILL OWN. The deeds section lists every transaction, including houses sold
 * fifteen years ago, and a sold property on a summary reads as an asset to anybody skimming it —
 * which is the kind of thing that ends up quoted to a client.
 */
const properties = [
  I({ id: 'sold', kind: 'property', status: 'past', amount: 4000000 }),
  I({ id: 'small', kind: 'property', status: 'current owner', amount: 400000 }),
  I({ id: 'big', kind: 'property', status: 'current owner', amount: 900000 }),
]
eq('only property they still hold counts', heldProperty(properties).map((p) => p.id), ['big', 'small'])
eq('...biggest first', heldProperty(properties)[0].id, 'big')

/* ---------- the summary the panel shows ---------- */

const summary = traceSummary([
  I({ id: 'p', value: '0821110001', seenOn: '2026-09-07' }),
  I({ id: 'e', kind: 'email', value: 'a@b.co.za' }),
  I({ id: 'addr', kind: 'address', value: 'somewhere', seenOn: '2026-01-01' }),
  I({ id: 'job', kind: 'employer', value: 'Kopano', seenOn: '2026-01-01' }),
  I({ id: 'kin', kind: 'link', value: 'Nomsa Radebe', status: 'relative' }),
  I({ id: 'other', kind: 'link', value: 'Pieter Grobler', status: 'link' }),
  I({ id: 'dir', kind: 'directorship', value: 'Karoo Bulk Haul', status: 'Active' }),
  I({ id: 'gone', kind: 'directorship', value: 'Old Co', status: 'Resigned' }),
  I({ id: 'prop', kind: 'property', value: 'a house', status: 'current owner', amount: 1 }),
])
eq('the summary names a phone', summary.phone.id, 'p')
eq('...an address', summary.address.id, 'addr')
eq('...where they work', summary.employer.id, 'job')
eq('...what they still own', summary.properties.map((p) => p.id), ['prop'])
/*
 * A POSSIBLE RELATIVE IS ONE THE IMPORT JUDGED TO SHARE THE SURNAME, and only that one. Every
 * other link on the report is a co-director or somebody who once shared a phone number — filing
 * those as next of kin would put a stranger on the account as family.
 */
eq('...who might be family', summary.relatives.map((r) => r.id), ['kin'])
/* A resigned directorship is not a company they run. */
eq('...and what they actually direct', summary.directorships.map((d) => d.id), ['dir'])
/*
 * UNTRIED IS THE MEASURE OF WHETHER THE SEARCH HAS BEEN USED. The firm pays for every trace; a
 * count of what nobody has rung yet is the one number that says whether it was worth it.
 */
eq('...and how much of it nobody has tried', summary.untried, 2)
eq('an address is not counted as an untried number',
  traceSummary([I({ kind: 'address' })]).untried, 0)
eq('...nor is one already tried',
  traceSummary([I({ outcome: 'no_answer' })]).untried, 0)

/* ---------- what may be put on the account ---------- */

ok('an untried number can be promoted', canPromote(I({})))
/* Pressing the button twice must not put the same number on the list twice. */
ok('...but not one already on the account', !canPromote(I({ promotedContactId: 'c1' })))
/* Promoting a number a collector has just disproved is the one thing this must never allow. */
ok('...and never one proved not theirs', !canPromote(I({ outcome: 'not_theirs' })))
/*
 * A PROPERTY IS NOT A WAY OF REACHING SOMEBODY. It is an asset, and the contact list is a list of
 * ways to make contact — an address to serve at is one, a deeds record is not.
 */
ok('...and a property is not a contact', !canPromote(I({ kind: 'property' })))
/*
 * A LINK BECOMES 'other', NOT A PHONE. What is stored about a relative is their NAME; the number
 * to reach them on is something the collector still has to find. Filed under 'mobile' it would
 * put a name where the dialler expects a number.
 */
eq('a person is not filed as a phone number', contactKindFor('link'), 'other')
eq('...a mobile stays a mobile', contactKindFor('mobile'), 'mobile')
eq('...and an address stays an address', contactKindFor('address'), 'address')

/* ---------- it is all actually stored, and readable ---------- */

ok('a trace is a record of its own', /create table if not exists public\.account_traces/.test(schema))
ok('...saying whether it is of the debtor or a director',
  /subject_kind text not null check \(subject_kind in \('debtor', 'director'\)\)/.test(schema))
ok('...and its findings hang off it',
  /create table if not exists public\.account_trace_items/.test(schema))
ok('...with only the four outcomes',
  /outcome text check \(outcome in \('verified', 'no_answer', 'unreachable', 'not_theirs'\)\)/.test(schema))
/* One row per thing per trace: re-reading the same PDF must update, never duplicate. */
ok('...one row per finding per trace', /unique \(trace_id, kind, value\)/.test(schema))
/* The link back is what stops a finding being promoted twice and shows which have earned a place. */
ok('...remembering which contact it became',
  /promoted_contact_id uuid references public\.account_contacts/.test(schema))
ok('the account can read its findings in one query',
  /account_trace_items_account_idx[\s\S]{0,80}\(account_id, kind\)/.test(schema))

/* ---------- the import keeps the whole search, not just the ticks ---------- */

/*
 * EVERYTHING THE SEARCH FOUND. The ticks decide what goes on the account's principal details; the
 * trace keeps the rest. A number the bureau last saw in 2019 is not worth a contact row and is
 * worth a great deal when the two recent ones turn out to be dead — thrown away at import, the
 * firm pays for the same search again.
 */
ok('the import files the trace itself', /from\('account_traces'\)\.insert/.test(importer))
ok('...and every finding on it', /from\('account_trace_items'\)\s*\n?\s*\.insert/.test(importer))
ok('...including the ones nobody ticked',
  /\.\.\.profile\.contacts\.map/.test(importer) && /\.\.\.profile\.addresses\.map/.test(importer))
ok('...and marks which links share the surname', /relatives\.has\(l\.fullName\) \? 'relative'/.test(importer))
/* A sold property must not read as an asset, so the bureau's flag is carried through. */
ok('...and whether a property is still theirs', /pr\.currentOwner \? 'current owner' : 'past'/.test(importer))

/* ---------- and a person can work it ---------- */

ok('there is somewhere to work a trace', /export function TraceWorkspaceModal/.test(workspace))
ok('...reachable from the account', /<TraceWorkspaceModal/.test(detail))
ok('...from the summary of what it found', /Work the trace/.test(detail))
/* The firm's own list of what the summary must carry. */
for (const line of ['Phone', 'Address', 'Works at', 'Property', 'Possible next of kin', 'Directs']) {
  ok(`the summary carries ${line.toLowerCase()}`, new RegExp(`"${line}"|>${line}[ <]`).test(detail))
}
ok('a number can be dialled from inside the trace', /<PhoneLink number=\{item\.value\}/.test(workspace))
ok('...and what came of it recorded', /onOutcome\(o\.outcome\)/.test(workspace))
/*
 * UNDOING IT IS A BUTTON, at the firm's instruction — "you can unverify it". A wrong outcome left
 * standing is worse than none: the next collector trusts a "reached them" that was somebody else.
 */
ok('...and undone when it was wrong', /onOutcome\(null\)/.test(workspace))
ok('...which clears it rather than recording a fifth state',
  /outcome_at: input\.outcome === null \? null : new Date/.test(data))
ok('a finding can be put on the account', /Add to contact details/.test(workspace))
ok('...and a relative added as next of kin', /Add as next of kin/.test(workspace))
ok('...labelled as one, so nobody opens the call to the wrong person',
  /Next of kin\$\{item\.label/.test(data))
/*
 * NEVER PRIMARY FROM HERE. Which number a collector rings first is a decision about the whole
 * account, taken on the contact list where all of them are visible — not a side effect of
 * promoting one finding out of one trace.
 */
ok('promoting never decides the primary number', /isPrimary: false/.test(data))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A trace is kept whole and worked: ring a number, say what happened, and put the ones that are real
on the account. What the bureau claimed and what the firm has confirmed are different things, and
the summary a collector reads is built from the second.`)
