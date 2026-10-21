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
  keepNewestPerThing, principalAddress, principalPhone, propertyAcross, traceSummary,
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

/*
 * SEVEN NOW, AND THE THREE THAT ARRIVED ARE WHY. The firm, looking at the workspace: "if you click
 * on the not tested, it says, okay, well, wrong person or disconnected. What does that mean? An
 * address is an address or not an address. Employment the same." Four outcomes written for a
 * telephone were offered against every list.
 *
 * ASSERTED BY NAME RATHER THAN BY COUNT. A count only says the number changed; naming them says a
 * value cannot quietly disappear and take every row that carries it with it.
 */
eq('every outcome a finding can have', TRACE_OUTCOMES.map((o) => o.outcome).sort(),
  ['denies_link', 'moved_on', 'no_answer', 'not_theirs', 'reached_other', 'unreachable', 'verified'])
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
eq('an outcome reads as words', outcomeLabel('no_answer'), 'No answer')
eq('...and an untried one has no label', outcomeLabel(null), null)
/*
 * "Wrong person", not "Not the debtor". A director's trace has a director as its subject, and a
 * collector reading "not the debtor" against a director's own number would take it to mean the
 * number is fine and the person is not the one who owes.
 */
eq('the wrong-number answer does not assume the subject is the debtor',
  outcomeLabel('not_theirs'), 'Wrong person')

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

/* ---------- and everything anybody connected to the account still owns ---------- */

/*
 * THE FIRM: "if the directors of these companies, and we see that they have properties, that is
 * displayed on the main page."
 *
 * Each trace already showed its own. What it could not show was the answer: a company with three
 * directors traced draws four panels, each naming one property, and "is there anything here worth
 * attaching" was spread across them and never added up. A company with no assets whose director
 * owns three houses is the whole reason a suretyship gets called in.
 */
const T = (id, subjectKind, subjectName, items) => ({ id, subjectKind, subjectName, items })
const across = propertyAcross([
  T('t-co', 'debtor', 'Adowa Property Managers', [
    I({ id: 'co-1', kind: 'property', value: 'Erf 21 Sunnyside', status: 'current owner', amount: 300000 }),
    I({ id: 'co-sold', kind: 'property', value: 'Erf 99 Menlo', status: 'past', amount: 9000000 }),
  ]),
  T('t-dir', 'director', 'P Coetzee', [
    I({ id: 'd-1', kind: 'property', value: '14 Protea Street', status: 'current owner', amount: 1800000 }),
  ]),
])
eq('property is gathered off every trace', across.map((p) => p.item.id), ['d-1', 'co-1'])
/* BIGGEST FIRST ACROSS ALL OF THEM, which is the order somebody deciding what to do next reads
   in -- and it is what puts a director's house above the company's own erf. */
eq('...biggest first, whoever owns it', across[0].item.id, 'd-1')
/* WHOSE IT IS TRAVELS WITH IT. A judgment against the company does not attach a director's
   house; that takes a suretyship, or piercing, and a collector who cannot see whose name is on
   the deed cannot tell which of those they are looking at. */
eq('...with whose it is', across[0].owner, 'P Coetzee')
eq('...and what kind of owner that is', across[0].ownerKind, 'director')
/* And the trace it came off, so the panel can open the right one of four. */
eq('...and which report it came off', across[0].traceId, 't-dir')
/* SOLD IS STILL EXCLUDED, through heldProperty, or the biggest number in the list is a house
   somebody sold in 2011. */
ok('a house they sold is not gathered', !across.some((p) => p.item.id === 'co-sold'))

/*
 * DE-DUPLICATED ON THE DEED. A property a director holds shows on the commercial report AND on
 * that director's own consumer one; counted twice it doubles what the account appears to be
 * worth, which is a number that ends up quoted to a client.
 */
const twice = propertyAcross([
  T('t-1', 'debtor', 'A Company', [
    I({ id: 'x1', kind: 'property', value: '14 Protea Street, Sunnyside', status: 'current owner', amount: 1800000 }),
  ]),
  T('t-2', 'director', 'P Coetzee', [
    I({ id: 'x2', kind: 'property', value: '14 Protea Street Sunnyside', status: 'current owner', amount: 1800000 }),
  ]),
])
eq('one deed on two reports is one property', twice.length, 1)
/* The first trace handed in wins, which is the newest -- the caller passes them newest first. */
eq('...and the newer report is the one kept', twice[0].traceId, 't-1')

eq('no traces, nothing owned', propertyAcross([]), [])
eq('a trace with no property contributes none',
  propertyAcross([T('t', 'debtor', 'X', [I({ id: 'p', kind: 'mobile', value: '0821234567' })])]), [])

/* AND IT IS ON THE SCREEN, above the per-trace panels rather than inside one of them. */
{
  const detail = readFileSync('src/pages/accounts/AccountDetail.tsx', 'utf8')
  ok('the account page gathers property across the traces',
    /propertyAcross\(traces\)/.test(detail))
  ok('...and shows whose each one is',
    /p\.ownerKind === 'director' \? 'director' : null/.test(detail))
  /* ONLY WHERE THERE IS MORE THAN ONE OWNER IN PLAY. On a plain consumer account the single
     trace panel below says it already, and a summary of one line above one line is noise. */
  ok('...only where more than one person is in play',
    /new Set\(ownedProperty\.map\(\(p\) => p\.owner\)\)\.size > 1/.test(detail))
}

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
/*
 * FOUR, NOT TWO -- THE TWO LINKED PEOPLE COUNT NOW.
 *
 * The firm, testing on a real account: "there is a Cherie Hennen and I saved it as a next of kin.
 * But Elise Ferreira is there. What if I haven't tried to call Elise Ferreira? There should be
 * outcomes of these ones as well." They were not counted, so a trace read as fully worked through
 * with every relative untouched -- and a wrong number on the debtor's own profile is exactly when
 * the relatives become the work.
 */
eq('...and how much of it nobody has tried', summary.untried, 4)
/*
 * AN ADDRESS IS STILL NOT COUNTED, and that is a decision rather than an omission. An address is
 * confirmed by a letter coming back or by somebody going there, which is not the same day's work
 * as going down a list of numbers -- and a trace that could never read as finished until somebody
 * had posted something would read as unfinished for ever.
 */
eq('an address is not counted as an untried number',
  traceSummary([I({ kind: 'address' })]).untried, 0)
eq('...nor an employer', traceSummary([I({ kind: 'employer' })]).untried, 0)
/* A LINKED PERSON IS. See above: they are the work once the debtor's own numbers are spent. */
eq('but a linked person nobody has rung is',
  traceSummary([I({ kind: 'link', value: 'Elise Ferreira' })]).untried, 1)
eq('...nor is one already tried',
  traceSummary([I({ outcome: 'no_answer' })]).untried, 0)

/* ---------- what may be put on the account ---------- */

/*
 * AND A NUMBER MUST HAVE BEEN ANSWERED FIRST. THE FIRM: "if you're working a trace and it says no
 * answer and you saved it as a home number, how can that be? You can't save it as a home number if
 * it has not been tested... wrong person and then save as their own number -- it doesn't make
 * sense."
 *
 * The fault was that Save asked nothing. Promoting marks the contact VERIFIED, so an untested
 * number went onto the account under a tick and the next collector rang it believing somebody had
 * proved it.
 */
ok('an untried number cannot be promoted', !canPromote(I({})))
ok('...nor one that merely rang', !canPromote(I({ outcome: 'no_answer' })))
ok('...but one the debtor answered can', canPromote(I({ outcome: 'verified' })))
/* REACHING SOMEBODY ELSE IS STILL REACHING. A wife who picks up the debtor's old mobile is a live
   line and a person who knows them -- see the next-of-kin button beside Save. */
ok('...and so can one somebody else answered', canPromote(I({ outcome: 'reached_other' })))
/* AN ADDRESS AND AN EMPLOYER ARE NOT WORKED AT ALL, so there is nothing for them to have been
   answered on: the firm's "they just save as an address if you want to". */
ok('an address can be saved without any of that', canPromote(I({ kind: 'address', value: '1 Main Rd' })))
ok('...and an employer too', canPromote(I({ kind: 'employer', value: 'Acme' })))
/* A LINKED PERSON goes on as a next of kin, which records who the bureau connected rather than
   claiming a line works -- so it needs no outcome either. */
ok('...and a linked person', canPromote(I({ kind: 'link', value: 'Elise Ferreira' })))
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
ok('...and every finding on it', /from\('account_trace_items'\)\s*\n?\s*\.upsert/.test(importer))
ok('...including the ones nobody ticked',
  /\.\.\.profile\.contacts\.map/.test(importer) && /\.\.\.profile\.addresses\.map/.test(importer))
ok('...and marks which links share the surname', /relatives\.has\(l\.fullName\) \? 'relative'/.test(importer))
/* A sold property must not read as an asset, so the bureau's flag is carried through. */
ok('...and whether a property is still theirs', /pr\.currentOwner \? 'current owner' : 'past'/.test(importer))

/* ---------- one row per thing, or the whole search is lost ---------- */

/*
 * A PROFILE LISTS EMPLOYMENT ONCE PER JOB TITLE, so the same company arrives three times. The
 * table's key is one row per (trace, kind, value), so the batch was rejected whole — and because
 * the trace row is written first, the account was left carrying a trace with nothing in it, no
 * timeline note, and no way for anybody to tell what had gone wrong.
 *
 * That is what the firm hit, and it is why this is deduplicated in the importer rather than left
 * to the database to complain about.
 */
const jobs = keepNewestPerThing([
  { kind: 'employer', value: 'Thekwini Plant Services', seen_on: '2019-01-01', label: 'Technician' },
  { kind: 'employer', value: 'THEKWINI PLANT SERVICES', seen_on: '2023-12-31', label: 'Manager All Types' },
  { kind: 'employer', value: 'Kopano Freight', seen_on: '2020-01-01', label: 'Driver' },
])
eq('the same employer twice is one finding', jobs.length, 2)
/* Newest wins: a job title from 2009 is not what somebody does now. */
eq('...keeping the most recent title', jobs.find((j) => /thekwini/i.test(j.value)).label, 'Manager All Types')
/*
 * MATCHED HOWEVER THE BUREAU CAPITALISED IT. The same employer comes through in title case on
 * one row and in upper case on another; compared case-sensitively those are two
 * things, and the pair goes to the database as two rows with the same key.
 *
 * The value kept is the newest row exactly as it was printed — this collapses duplicates, it does
 * not tidy what the bureau wrote.
 */
eq('...whatever the case it was printed in', jobs.filter((j) => /thekwini/i.test(j.value)).length, 1)
/* Two different things that happen to share a kind are two things. */
eq('...and different employers stay separate', jobs.filter((j) => j.kind === 'employer').length, 2)
/* A number and an address with the same text are not the same finding. */
eq('the kind is part of what makes a thing itself', keepNewestPerThing([
  { kind: 'phone', value: 'x', seen_on: null }, { kind: 'address', value: 'x', seen_on: null },
]).length, 2)
ok('the importer actually uses it', /const deduped = keepNewestPerThing\(itemRows\)/.test(importer))
/* The seatbelt: a duplicate nobody anticipated must not throw the whole search away a second time. */
ok('...and a stray duplicate cannot fail the import',
  /onConflict: 'trace_id,kind,value', ignoreDuplicates: true/.test(importer))
/*
 * A TRACE WITH NO FINDINGS IS WORSE THAN NO TRACE — a collector opens it, reads nothing, and
 * cannot tell whether that is the report or a bug. A failed import takes its own trace row with
 * it rather than leaving one behind.
 */
ok('a failed import leaves no empty trace behind',
  /await supabase\.from\('account_traces'\)\.delete\(\)\.eq\('id', traceId\)/.test(importer))

/* ---------- and a person can work it ---------- */

ok('there is somewhere to work a trace', /export function TraceWorkspaceModal/.test(workspace))
ok('...reachable from the account', /<TraceWorkspaceModal/.test(detail))
/*
 * THE WAY IN HAS TO BE A BUTTON. It was a line of small text inside a summary block and the
 * firm's report was "I don't know how to open that area where all the information is", which is
 * the only verdict that matters on a control nobody found.
 */
ok('...from a button on the panel, not a line of text', /Open \{traces\.length > 1 \? `\$\{traces\.length\} traces`/.test(detail))
/*
 * TWO WAYS IN, and the card is no longer one giant button.
 *
 * It was, on the reasoning that every line of a trace summary is the beginning of a call. The
 * firm's own design replaced it with a card that has a number you can DIAL inside it — and a
 * PhoneLink inside a button is a control inside a control, where pressing the number opens the
 * modal instead of ringing. So the ways in are named: "Review trace" at the top, and the untried
 * count at the foot.
 */
/* ONE LINK, AND IT OPENS THE TRACE. The firm: "I'd rather just leave one, like open the trace, not
   review trace" -- and there were two of them on screen because there were two cards for one
   person, which is what traceSubjects fixed. */
ok('...and the summary carries its own way in', /Open the trace &rarr;/.test(detail))
ok('...and no longer calls it a review', !/'Review trace'/.test(detail))
/*
 * PhoneLink is given its own content on purpose. Its default rendering is "<icon> number", and
 * the gutter of this row already carries a telephone -- so the row shipped with two receivers on
 * it. Asserted on the CHILDREN, because that is the whole of the fix.
 */
ok('...and the number in it is dialled, not swallowed by a wrapping button',
  /<PhoneLink number=\{found\.phone\.value\}>\{found\.phone\.value\}<\/PhoneLink>/.test(detail))
/*
 * WHERE THE ATTEMPT STANDS IS A WAY IN TOO -- and it is no longer a count that vanishes.
 *
 * THIS USED TO ASSERT "{found.untried} finding(s) nobody has tried yet", drawn only while
 * something was untried. The firm asked for the other half: "if we've worked through an entire
 * trace, it should mention that the entire trace has been worked through." A line that disappears
 * on completion makes finished and never-started read identically -- as silence -- so the panel
 * now reports the ROUND, in all three of its states, and goes quiet only where there was never
 * anything to ring. See traceRound and check-trace-round, which holds the rule itself.
 */
ok('...and where the attempt stands is a way in too', /roundLine\(round\)/.test(detail))
ok('...drawn whenever there was something to ring', /\{round\.workable > 0 && \(/.test(detail))
/* AND NOT ONLY WHILE SOMETHING IS UNTRIED, which is the fault that was being asserted. */
ok('...and no longer vanishes once everything is tried',
  !/\{found\.untried > 0 && \(/.test(detail))

/*
 * MOVING BETWEEN THE TRACES, in the firm's words: "I need to go, for example, between the traces."
 * A company account collects one per director plus one for the company, and comparing them is the
 * work — a number dead on one director's profile is often live on another's.
 */
ok('every trace on the account is reachable from inside', /traces: FiledTrace\[\]/.test(workspace))
ok('...and switching does not close what is open', /onClick=\{\(\) => onOpen\(t\.id\)\}/.test(workspace))
ok('...with the one you are on marked', /t\.id === trace\.id/.test(workspace))
/*
 * A COMPANY PROFILE HAS NOTHING OF THIS KIND AND HAS TO SAY SO. Numbers, addresses and next of
 * kin come off a PERSON's report; a commercial one carries directors and judgments, which live on
 * the account itself. Silent, it reads as a bug.
 */
ok('an empty trace says why it is empty', /Nothing to work on this one/.test(workspace))
ok('...and where the company\'s findings actually are', /A company profile carries directors and judgments/.test(workspace))
/* The firm's own list of what the summary must carry. */
for (const line of ['Phone number', 'Address', 'Employer', 'Property', 'Possible next of kin', 'Directs']) {
  ok(`the summary carries ${line.toLowerCase()}`, new RegExp(`"${line}"|>${line}[ <]`).test(detail))
}
ok('a number can be dialled from inside the trace', /<PhoneLink number=\{row\.value\}/.test(workspace))
ok('...and what came of it recorded', /onOutcome\(e\.target\.value === ''/.test(workspace))
/*
 * UNDOING IT, at the firm's instruction — "you can unverify it". A wrong outcome left standing is
 * worse than none: the next collector trusts a "reached them" that was somebody else. It is the
 * picker's own first choice now rather than a separate button, which is why the empty option is
 * what has to map back to null — an "unset" that recorded a fifth state would be a lie.
 */
ok('...and undone when it was wrong', /\? null : e\.target\.value as TraceOutcome/.test(workspace))
ok('...which clears it rather than recording a fifth state',
  /outcome_at: input\.outcome === null \? null : clockNow\(\)/.test(data))
/*
 * AN OUTCOME GOES ON EVERY FINDING BEHIND THE ROW. One number printed under Cell, Home and Work
 * is one row over three findings; writing to one of them leaves the other two reading "Not
 * tested" against a number somebody has just rung, and the untried count then lies.
 */
ok('an outcome reaches every finding behind the row',
  /for \(const item of row\.items\) await recordTraceOutcome/.test(workspace))
/*
 * ...and saving does NOT. Three findings promoted separately put the same number on the contact
 * list three times, which is the list a collector then has to read.
 */
ok('...but saving it to the account happens once',
  /const item = row\.items\.find\(\(i\) => i\.promotedContactId === null\)/.test(workspace))
ok('a finding can be put on the account', /<Plus size=\{13\} \/> Save/.test(workspace))
ok('...and a relative added as next of kin', /onPromote\(true\)/.test(workspace))
ok('...labelled as one', /as next of kin/.test(workspace))
/*
 * FILED AS THEIR OWN PERSON, so nobody opens the call to the wrong one. The name on the row is
 * the relative's and their role is the relationship — it used to be crammed into a free-text
 * label, where nothing could group by it and a company's contacts were a flat run of numbers with
 * names buried in their captions. See check-contact-people.
 */
ok('...filed under their own name',
  /personName: item\.kind === 'link' \? item\.value : \(asNextOfKin \? item\.value : subjectName\)/.test(data))
ok('...with the relationship as their role', /personRole: asNextOfKin \? 'Next of kin'/.test(data))
/* AND ON A NUMBER RATHER THAN ON THEIR NAME. A linked person's finding carries the name in `value`
   and the number in `label`; saved that way round the account held names nobody could dial. */
ok('...on the number they were linked through', /value: linkedTo \?\? item\.value/.test(data))
/*
 * NEVER PRIMARY FROM HERE. Which number a collector rings first is a decision about the whole
 * account, taken on the contact list where all of them are visible — not a side effect of
 * promoting one finding out of one trace.
 */
ok('promoting never decides the primary number', /isPrimary: false/.test(data))

/*
 * A LINKED PERSON IS SOMEBODY YOU CAN RING. The firm: "the number and how they are linked should
 * basically be shown and you should be able to call the number when you're working the trace."
 * The number was on the screen, inside the label, and was not dialable — which is the number a
 * collector chasing a relative most wants to press.
 */
ok('a linked person\'s shared number is pulled out of the label',
  /const shared = category === 'people' \? linkedNumber\(row\.label\) : null/.test(workspace))
ok('...and is rung through the same button as every other number',
  /\{shared !== null && \([\s\S]{0,200}<PhoneLink number=\{shared\}/.test(workspace))
/* AND THE RING REACHES THE ACCOUNT. It did not: the press dialled and recorded nothing -- no item
   2 fee, no timeline line, no account_calls row for BuzzBox to match. See check-call-outcome. */
ok('...and that ring is recorded on the account',
  /<PhoneLink number=\{shared\} onDialled=\{\(c\) => onDial\(c\.to\)\} \/>/.test(workspace))
ok('...with how they are linked said beside it', /linkedHow\(row\.label\)/.test(workspace))

/* ---------- starting the search ---------- */

/*
 * THE KEY GOES WITH YOU. The firm's instruction: "you would click on the trace, it would
 * automatically copy the ID number to paste into the tracing system." Thirteen digits have to
 * arrive in somebody else's search box exactly right, and a digit retyped wrong is a search about
 * a different person that the firm still pays for.
 *
 * WHICH KEY DEPENDS ON THE SITE NOW, and that is the firm again: "if you go to Google AI, you want
 * to copy name, surname, or company. Or if you go to the SASSA grant, you'd want an ID number."
 * Every source used to get the ID number. See check-trace-sources, which holds the mapping itself;
 * this only asserts that whatever was chosen is what reaches the clipboard.
 */
const button = readFileSync(new URL('../../src/pages/accounts/TraceButton.tsx', import.meta.url), 'utf8')
ok('the trace click copies what this source is searched on',
  /navigator\.clipboard\?\.writeText\(copying\)/.test(button))
/*
 * AND ONLY WHEN IT COULD BE ONE. It copied the raw ID field, and on a real account that field
 * held a telephone number -- pasted into XDS that is an enquiry the firm pays for, run against
 * something that is not a person.
 */
ok('...checked before it is copied',
  /const identity = traceSearchKey\(debtorKind, idNumber, isValidSaId\)/.test(button))
/* NOTHING UNUSABLE IS COPIED, whichever key the source wants: `copying` is empty for a refused ID
   and for a missing name alike, and the write is behind it. */
ok('...and an unusable key is not copied at all', /if \(copying\) \{/.test(button))
ok('...but is named, so it gets corrected', /\{problem\}/.test(button))
/*
 * BOTH INSIDE THE TAP. Safari allows a new tab, and a clipboard write, only while it can still
 * see the tap that asked. Either moved after an await is silently refused and the button looks
 * broken. Asserted as presence first — indexOf returns -1 for something deleted, and -1 beats
 * everything, so an order-only check passes the moment its subject is gone.
 */
ok('...and opens the portal in the same click', button.includes('window.open(href'))
ok('...with the copy started before the tab steals the gesture',
  button.indexOf('navigator.clipboard') > 0
  && button.indexOf('navigator.clipboard') < button.indexOf('window.open(href'))
/*
 * AND A SOURCE WITH NO PORTAL OPENS NOTHING -- a blank tab would be the app pretending to have
 * done something.
 *
 * THE LIST OF THOSE HAS SHRUNK, which is the firm's doing: "it's the links that you would put in
 * here." SASSA, the voters' roll, CIPC and SARS all have one now, so the sources this protects are
 * the ones still being confirmed. The decision moved into traceSourceUrl, which returns null both
 * for a source with no address and for a templated one with no key to put in it.
 */
ok('...and a source with no portal opens no tab', /const href = traceSourceUrl\(s, wanted\)/.test(button)
  && /if \(href\) window\.open/.test(button))
/*
 * A CLIPBOARD WRITE CAN BE REFUSED AFTER IT IS ACCEPTED — writeText resolves asynchronously. So
 * what the modal claims waits for the real answer, and where it was refused the number is shown
 * to be copied by hand. Told nothing, a collector retypes it off the account behind the modal.
 */
ok('what it claims waits for the clipboard to answer',
  /write\.then\(\(\) => setCopied\('yes'\)\)\.catch\(\(\) => setCopied\('no'\)\)/.test(button))
ok('...and a refused copy shows the number instead', /copied === 'no' \|\| copied === 'asking'/.test(button))
/*
 * A MISSING NUMBER AND A WRONG ONE ARE DIFFERENT PROBLEMS, and both are said out loud. One needs
 * capturing, the other correcting -- and a collector told only "no ID" would go and type the
 * telephone number sitting in that field straight into the portal.
 */
ok('...and an account with nothing usable says which of the two it is',
  /problem !== null &&/.test(button) && /searchKeyProblem\(identity, debtorKind\)/.test(button))

/*
 * ASKED AFTERWARDS, which is the only moment the answer exists — an account can carry a company
 * and three sureties and nobody knows before opening the portal how many they will look for.
 *
 * ASSERTED ON THE QUESTION AND NOT ITS WORDING. This held the exact string "How many traces did you
 * do?" and broke when the title became "How many searches did you run?" -- a check that fails on a
 * reworded label is a check that gets loosened rather than read. What matters is that the count is
 * asked for, that it is asked AFTER the portal opens, and that it is only asked where the charge
 * actually multiplies. See check-trace-sources for the four it may offer.
 */
ok('it asks how many searches were run', /title=\{result \? 'Trace recorded' : counted \?/.test(button))
ok('...only where the count changes the fee',
  /const counted = source\.kind === 'credit_bureau'/.test(button))
/* AFTER THE PORTAL, NOT BEFORE: the tab is opened by pick() and the asking flag is set in the same
   tap, so the question is on screen behind the portal rather than in front of it. */
ok('...after the portal has been opened',
  button.indexOf('window.open(s.url') < button.indexOf('setAsking(true)'))
/*
 * AND THE SOURCE GOES WITH IT. THE FIRM: "where do I do the other traces, like for example CSA and
 * stuff." The button went straight to XDS, so the only search Raptor could record was the one it
 * had a portal for -- every other one was done, charged to nobody, and written down nowhere.
 */
ok('...and charges on the answer, naming where they looked',
  /recordTrace\(\{\s*\n\s*accountId, actor, count, sourceId: source\.id, named,/.test(button))
ok('...choosing the source before anything opens', /TRACE_SOURCES\.map\(\(s\) => \(/.test(button))
/* WHAT IT COSTS THE DEBTOR IS ON THE ROW. The gazette's item is the one fact that decides whether
   a fee is lawful, and it is not something to find out afterwards on a statement. */
ok('...with the item it is charged under beside each one',
  /Credit bureau \u00b7 item 4\(c\)/.test(button) && /Item 3 \u00b7 R25\.00 \u00b7 once per person/.test(button))
/*
 * Closing without answering is a portal opened by mistake, and charges nothing.
 *
 * THE WORDS CHANGE ONCE "we could not trace" HAS BEEN RECORDED, and that is the point: "Didn't
 * trace" beside a note saying exactly that reads as an offer to undo it. So the button says Close
 * there and keeps its own words everywhere else. Both halves are held, because the half that
 * matters is the one on the ordinary path.
 */
ok('...and closing without answering charges nothing', /Didn\\u2019t trace/.test(button))
ok('...and says Close instead once the attempt is on the file',
  /attempt === 'saved' \? 'Close' :/.test(button))

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
