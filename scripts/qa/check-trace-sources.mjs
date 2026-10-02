/**
 * WHERE A DEBTOR CAN BE LOOKED FOR, AND WHAT EACH PLACE COSTS THEM.
 *
 * THE FIRM: "where do I do the other traces, like for example CSA and stuff." Raptor could record
 * exactly one search -- the one it had a portal button for -- so every other place the firm looks
 * was searched, cost somebody an afternoon, and was charged to nobody and written down nowhere.
 *
 * WHAT THIS FILE GUARDS IS THE MONEY. Item 4(c) is "necessary registered CREDIT BUREAU search" and
 * that wording is narrow on purpose; item 3 is "other necessary expenses not specifically provided
 * for". Charging a SASSA enquiry under 4(c) would bill a debtor under a line of the gazette that
 * does not describe what was done, and it is the kind of thing only ever found at a taxation.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-trace-sources.mjs
 */
import { readFileSync } from 'node:fs'
import {
  BUREAU_ITEM, OTHER_ITEM, TRACE_SOURCES, chargeForSource, chargesForThisSearch,
  traceSourceById, traceSourceNote,
} from '../../src/lib/traceSources.ts'
import { scheduleFor } from '../../src/lib/annexureB.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/* ---------------------------------------------------------------------------------------------
 * THE GAZETTE DECIDES THE ITEM, NOT US
 * ------------------------------------------------------------------------------------------- */

const bureau = traceSourceById('xds')
const sassa = traceSourceById('sassa')

check('a credit bureau is charged under item 4(c)', chargeForSource(bureau).itemId, BUREAU_ITEM)
check('...and everything else under item 3', chargeForSource(sassa).itemId, OTHER_ITEM)
/*
 * AND ONLY A REGISTERED BUREAU MAY BE. Asserted over the whole list rather than on the two above,
 * because the failure is a source ADDED later under the wrong kind -- which is a fee raised under
 * a line of the gazette that does not describe the work.
 */
for (const s of TRACE_SOURCES) {
  const got = chargeForSource(s).itemId
  check(`${s.name} is charged under the item its kind says`,
    got, s.kind === 'credit_bureau' ? BUREAU_ITEM : OTHER_ITEM)
}
/* THE FIRM USES ONE BUREAU. A second one is a real possibility and not a mistake, so this counts
   rather than forbids -- but it is worth knowing when the number changes. */
check('exactly one source is a registered credit bureau',
  TRACE_SOURCES.filter((s) => s.kind === 'credit_bureau').length, 1)

/*
 * THE DEBTOR READS TWO DESCRIPTIONS AND NEVER A VENDOR.
 *
 * The firm's own earlier instruction, about XDS: "the bureau's name came off... it told the debtor
 * nothing they needed and named a supplier on a document that goes outside the building." That
 * holds for every source, which is why the description comes from the KIND and not the name.
 */
for (const s of TRACE_SOURCES) {
  const d = chargeForSource(s).description
  ok(`${s.name} does not put its own name on the statement`, !d.includes(s.name) || s.name === 'ONE')
  check(`...and says what the firm's statements say`, d,
    s.kind === 'credit_bureau' ? 'Credit bureau search' : 'ONE')
}

/* AND THE PRICES ARE THE GAZETTE'S, read off the schedule rather than written here twice. */
const schedule = scheduleFor(new Date('2026-10-02'))
const amount = (id) => schedule.items.find((i) => i.id === id)?.amount ?? null
check('item 4(c) is the bureau rate', amount(BUREAU_ITEM), 16)
check('item 3 is the other-expenses rate', amount(OTHER_ITEM), 25)

/* ---------------------------------------------------------------------------------------------
 * ONCE PER SUBJECT, WHICH IS NOT A MONTHLY CAP
 * ------------------------------------------------------------------------------------------- */

/*
 * THE FIRM, correcting an earlier reading of item 3: "it's per action, not a total amount of R25."
 * So item 3 is raised each time the work is done -- what is capped is narrower: looking for ONE
 * PERSON across several places is one search for that person. Tracing a director later is a
 * different person and a different expense.
 */
ok('a bureau search always charges', chargesForThisSearch({ source: bureau, alreadyChargedForSubject: false }))
ok('...even where this person has been searched elsewhere',
  chargesForThisSearch({ source: bureau, alreadyChargedForSubject: true }))
ok('a first search anywhere else charges',
  chargesForThisSearch({ source: sassa, alreadyChargedForSubject: false }))
ok('...and a second place for the same person does not',
  !chargesForThisSearch({ source: sassa, alreadyChargedForSubject: true }))

/* ---------------------------------------------------------------------------------------------
 * AND THE TIMELINE NAMES WHERE THEY LOOKED, WHICH THE STATEMENT DOES NOT
 * ------------------------------------------------------------------------------------------- */

/* Read inside the building by the next collector: "we looked at SASSA and found nothing" is the
   single most useful thing to know before looking there again. */
ok('the timeline says where', /SASSA/.test(traceSourceNote({ source: sassa })))
ok('...and a bureau note still counts the searches',
  /2 credit bureau searches/.test(traceSourceNote({ source: bureau, count: 2 })))
/* SOMEWHERE ELSE IS NAMED BY THE COLLECTOR, because a closed list would make every source the firm
   has not told us about unrecordable -- and an unrecordable search is one the firm pays for. */
const elsewhere = traceSourceById('other')
ok('somewhere else carries what they typed',
  /Deeds office/.test(traceSourceNote({ source: elsewhere, named: 'Deeds office' })))
ok('...and says something sensible where they typed nothing',
  /another source/.test(traceSourceNote({ source: elsewhere, named: '  ' })))

/* AN UNKNOWN ID FALLS BACK rather than throwing: a stored source removed from the list later must
   not take an account page down with it. */
check('an unknown source falls back', traceSourceById('nonsense').id, 'xds')

/* ---------------------------------------------------------------------------------------------
 * AND NOTHING IS CHARGED TWICE BY THE RECORDER
 * ------------------------------------------------------------------------------------------- */

const recorder = readFileSync(new URL('../../src/lib/accountTrace.ts', import.meta.url), 'utf8')
ok('the recorder asks the shared rule', /chargesForThisSearch\(\{/.test(recorder))
ok('...and takes its item from the shared one too', /chargeForSource\(source\)/.test(recorder))
/*
 * A SEARCH THAT EARNS NOTHING IS STILL RECORDED. The work happened, and the next collector needs
 * to know somebody has already looked there -- so the note is written outside the charge branch.
 */
ok('...and writes the note whether or not it charged',
  recorder.indexOf('await addNote({') > recorder.indexOf('chargesForThisSearch({'))
/*
 * AND NOTHING WAS CHARGED IS NOT A REFUSAL. `reason` is a closed list of the ways the GAZETTE
 * stops a fee; adding a value to it would have every screen that explains a refusal start
 * explaining this one in the gazette's voice. Null instead.
 */
ok('...returning nothing rather than inventing a reason',
  /Promise<ChargeResult \| null>/.test(recorder))
ok('...and never a made-up one', !/reason: 'ceiling'/.test(recorder))
/* ONLY A BUREAU CHARGES BY THE SEARCH. Item 3 is one expense however many places were looked in. */
ok('the count only multiplies a bureau search',
  /quantity: source\.kind === 'credit_bureau' \? count : 1/.test(recorder))

console.log(`\ncheck-trace-sources: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
