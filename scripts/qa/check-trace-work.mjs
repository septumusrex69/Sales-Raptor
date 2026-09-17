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
  keepNewestPerThing, principalAddress, principalPhone, traceSummary,
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
/* And the summary block is itself the target: every line of it is the beginning of a call. */
ok('...and the whole summary opens it', /<button type="button" onClick=\{onOpen\}\s*\n\s*className="block w-full text-left/.test(detail))

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
for (const line of ['Phone', 'Address', 'Works at', 'Property', 'Possible next of kin', 'Directs']) {
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
  /outcome_at: input\.outcome === null \? null : new Date/.test(data))
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
ok('...filed under their own name', /personName: asNextOfKin \? item\.value : subjectName/.test(data))
ok('...with the relationship as their role', /personRole: asNextOfKin \? 'Next of kin' : null/.test(data))
/*
 * NEVER PRIMARY FROM HERE. Which number a collector rings first is a decision about the whole
 * account, taken on the contact list where all of them are visible — not a side effect of
 * promoting one finding out of one trace.
 */
ok('promoting never decides the primary number', /isPrimary: false/.test(data))

/* ---------- starting the search ---------- */

/*
 * THE ID NUMBER GOES WITH YOU. The firm's instruction: "you would click on the trace, it would
 * automatically copy the ID number to paste into the tracing system." Thirteen digits have to
 * arrive in somebody else's search box exactly right, and a digit retyped wrong is a search about
 * a different person that the firm still pays for.
 */
const button = readFileSync(new URL('../../src/pages/accounts/TraceButton.tsx', import.meta.url), 'utf8')
ok('the trace click copies what XDS is searched on', /navigator\.clipboard\?\.writeText\(key\.value\)/.test(button))
/*
 * AND ONLY WHEN IT COULD BE ONE. It copied the raw ID field, and on a real account that field
 * held a telephone number -- pasted into XDS that is an enquiry the firm pays for, run against
 * something that is not a person.
 */
ok('...checked before it is copied', /const key = traceSearchKey\(debtorKind, idNumber, isValidSaId\)/.test(button))
ok('...and an unusable number is not copied at all', /if \(key\.ok\) \{/.test(button))
ok('...but is named, so it gets corrected', /\{problem\}/.test(button))
/*
 * BOTH INSIDE THE TAP. Safari allows a new tab, and a clipboard write, only while it can still
 * see the tap that asked. Either moved after an await is silently refused and the button looks
 * broken. Asserted as presence first — indexOf returns -1 for something deleted, and -1 beats
 * everything, so an order-only check passes the moment its subject is gone.
 */
ok('...and opens the portal in the same click', button.includes("window.open(XDS_PORTAL_URL"))
ok('...with the copy started before the tab steals the gesture',
  button.indexOf('navigator.clipboard') < button.indexOf('window.open(XDS_PORTAL_URL'))
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
  /problem !== null &&/.test(button) && /searchKeyProblem\(key, debtorKind\)/.test(button))

/*
 * ASKED AFTERWARDS, which is the only moment the answer exists — an account can carry a company
 * and three sureties and nobody knows before opening the portal how many they will look for.
 */
ok('it asks how many searches were run', /How many traces did you do\?/.test(button))
ok('...and charges item 4\u00a0(c) on the answer', /recordTrace\(\{ accountId, actor, count \}\)/.test(button))
/* Closing without answering is a portal opened by mistake, and charges nothing. */
ok('...and closing without answering charges nothing', /Didn&apos;t trace/.test(button))

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
