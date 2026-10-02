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
  BUREAU_ITEM, OTHER_ITEM, TRACE_SOURCES, bureauSearchCounts, chargeForSource, chargesForThisSearch,
  traceSourceById, traceSourceNote,
} from '../../src/lib/traceSources.ts'
import { ANNEXURE_B_2026, scheduleFor } from '../../src/lib/annexureB.ts'

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

/* ---------------------------------------------------------------------------------------------
 * HOW MANY SEARCHES THE BUTTON MAY OFFER
 *
 * THE FIRM, looking at a row of buttons running to ten: "make it only go up to four, not more than
 * that." They are reading their own tariff. Item 4(c) is `maxPerMonth: 4`, so five through ten
 * offered a collector a number the gazette does not have.
 * ------------------------------------------------------------------------------------------- */

check('the button offers the gazette\u2019s four and no more',
  bureauSearchCounts(ANNEXURE_B_2026), [1, 2, 3, 4])
/*
 * AND IT IS READ OFF THE SCHEDULE, NOT TYPED. The proof is that a schedule saying something else
 * moves the buttons: a literal four here would pass this file and then disagree with the gazette
 * the day the gazette changes.
 */
check('...taken off the schedule rather than written down',
  bureauSearchCounts({ items: [{ id: '4c', maxPerMonth: 7 }] }), [1, 2, 3, 4, 5, 6, 7])
/* A SCHEDULE THAT DOES NOT SAY FALLS BACK ON THE GAZETTE'S FOUR, not on one: every schedule
   Raptor holds carries the cap, so a schedule without it is one with something wrong with it. */
check('...and a schedule that does not say still offers four',
  bureauSearchCounts({ items: [] }), [1, 2, 3, 4])
check('...as does an item with no cap on it',
  bureauSearchCounts({ items: [{ id: '4c' }] }), [1, 2, 3, 4])
/* AND A NONSENSE ZERO STILL DRAWS A BUTTON. An empty row is a modal a collector cannot get out of
   except by saying they did not trace -- after they have already run the search. */
check('...and never an empty row', bureauSearchCounts({ items: [{ id: '4c', maxPerMonth: 0 }] }), [1])
/* EVERY SCHEDULE RAPTOR HOLDS AGREES, because a 2019 fee re-read today is still a 2019 fee and the
   button is drawn from whichever schedule the action's date lands on. */
for (const year of [2019, 2023, 2026]) {
  const schedule = scheduleFor(new Date(`${year}-06-15T00:00:00Z`))
  const item = schedule.items.find((i) => i.id === '4c')
  ok(`the ${year} schedule caps a bureau search at four`, item?.maxPerMonth === 4)
  check(`...and the button follows it`, bureauSearchCounts(schedule), [1, 2, 3, 4])
}

/* ---------------------------------------------------------------------------------------------
 * AND THE BUTTON ASKS THE QUESTION THE CHARGE ACTUALLY ANSWERS
 *
 * The count row was drawn for every source. Item 3 is ONE expense however many places were looked
 * in -- recordTrace forces its quantity to 1 -- so pressing seven on a SASSA search raised one fee.
 * The same rule the trace outcomes follow: a question with no true answer is worse than none.
 * ------------------------------------------------------------------------------------------- */

const button = readFileSync(new URL('../../src/pages/accounts/TraceButton.tsx', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')

ok('the ten is gone', !/\[1, 2, 3, 4, 5, 6, 7, 8, 9, 10\]/.test(button))
ok('...and the row is drawn from the schedule', /counts\.map\(\(n\) =>/.test(button))
ok('...which the button asks for', /bureauSearchCounts\(schedule\)/.test(button))
/* ONE SCHEDULE FOR THE PRICE AND THE COUNT, or the row and the rand figure under it can describe
   two different gazettes. */
ok('...the same schedule the price comes off',
  /const schedule = scheduleFor\(new Date\(\)\)/.test(button)
  && /schedule\.items\.find\(\(i\) => i\.id === '4c'\)/.test(button))
/* COUNTED ONLY WHERE COUNTING MEANS SOMETHING, and the predicate is the same one the charge uses. */
ok('only a bureau search is counted', /const counted = source\.kind === 'credit_bureau'/.test(button))
ok('...so the numbers are not drawn otherwise', /!result && counted && \(/.test(button))
ok('...and there is a single button instead', /!result && !counted && \(/.test(button))
/* AND THE PRICE LINE NAMES THE ITEM IT IS ACTUALLY CHARGED UNDER. It said 4(c) whatever the
   source was, which quoted the bureau's line of the gazette on a fee raised under item 3. */
ok('a non-bureau search is priced under item 3', /under Annexure B item 3/.test(button))

/* ---------------------------------------------------------------------------------------------
 * AND THE OFFER TO UPLOAD IS MADE WHERE THE FILES ARE
 *
 * THE FIRM: "after you've reached this tab, I think I can automatically already ask you to upload
 * if you want to upload the trace." It was a link under the button that cleared itself after ten
 * seconds -- so the one minute a collector certainly has the PDFs was spent on a link already gone.
 * ------------------------------------------------------------------------------------------- */

/* THE MODAL STAYS OPEN ON THE RESULT, which is the whole of the fix: setAsking(false) on a
   successful charge is what closed it before the offer could be made. */
ok('recording does not close the box', !/setResult\(\{ charge: c, count \}\)\s*\n\s*setAsking\(false\)/.test(button))
ok('...and the box offers the upload itself', /Upload what it found/.test(button))
/* BOTH CALL SITES, WRITTEN DIFFERENTLY ON PURPOSE: the modal has to close itself first, the line
   under the button is already outside it. Asserted separately so neither can quietly go. */
ok('...calling the handler from inside the box', /setResult\(null\); onUpload\(\)/.test(button))
ok('...and the line under the button still calls it too', /onClick=\{onUpload\}/.test(button))
/* ASKED, NOT DONE. "If you want to" is the firm's own qualifier: a declining answer has to exist,
   and it must not read as though it undoes the fee that was just raised. */
ok('...and it can be declined', /Not now/.test(button))
ok('...without the word Cancel beside a charge already raised',
  !/>\s*Cancel\s*</.test(button))
/* AND THE SENTENCE ABOUT THE MONEY IS WRITTEN ONCE. Two accounts of one fee is how somebody comes
   to believe a charge was raised that was not. */
ok('what it cost is said by one function', /function chargeWords\(/.test(button))
ok('...and both places call it', (button.match(/chargeWords\(result, source\)/g) ?? []).length === 2)

console.log(`\ncheck-trace-sources: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
