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
  traceSourceById, traceSourceNote, traceSourceUrl, tracingThisMonth,
} from '../../src/lib/traceSources.ts'
import { MONTHLY_LIMIT, TRACING_ACTION_CODE } from '../../src/lib/actionTariff.ts'
import { registrationIn } from '../../src/lib/traceStore.ts'
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

/* ---------------------------------------------------------------------------------------------
 * THE LINKS, AND THE KEY EACH SITE ACTUALLY TAKES
 *
 * THE FIRM, sending screenshots of the four sites they work by hand: "the CSA and those other
 * things is only this stuff, so it's the links that you would put in here. It would open the link
 * so the data would be traced appropriately. If you go to Google AI, you want to copy name,
 * surname, or company. Or if you go to the SASSA grant, you'd want an ID number."
 *
 * EVERY SOURCE COPIED THE ID NUMBER, because the button was written when XDS was the only one. A
 * key that is wrong for the site is worse than no key: it gets pasted, it returns nothing, and the
 * collector concludes the person is not there.
 * ------------------------------------------------------------------------------------------- */

/* THE ONES THE FIRM SENT A SCREENSHOT OF ARE ALL REACHABLE. A source with no link is one somebody
   has to go and find, which is how a feature ships and is never used. */
for (const id of ['sassa', 'iec', 'sars_vat', 'cipc', 'google']) {
  const source = traceSourceById(id)
  check(`${id} is a source Raptor knows`, source.id, id)
  ok(`...and it has a link`, typeof source.url === 'string' && source.url.startsWith('https://'))
}

/* AND EACH IS SEARCHED ON WHAT IT ASKS FOR. SARS's own page says "a valid VAT Number or an Exact
   VAT Trading Name", so an ID number is the one thing it cannot use. */
check('SASSA is searched on the ID number', traceSourceById('sassa').searchOn, 'identity')
check('the voters\u2019 roll too', traceSourceById('iec').searchOn, 'identity')
check('CIPC on the registration number', traceSourceById('cipc').searchOn, 'identity')
check('SARS VAT on the trading name', traceSourceById('sars_vat').searchOn, 'name')
check('and a web search on the name', traceSourceById('google').searchOn, 'name')
/* EVERY SOURCE SAYS WHICH, or one added later silently inherits whatever the caller defaults to --
   and the default is the ID number, which is the bug this field exists to end. */
ok('every source says what it is searched on',
  TRACE_SOURCES.every((s) => s.searchOn === 'identity' || s.searchOn === 'name'))

/* ---------------------------------------------------------------------------------------------
 * AND THE KEY GOES INTO THE ADDRESS WHERE THE SITE TAKES ONE
 * ------------------------------------------------------------------------------------------- */

/*
 * CALLED DEFENSIVELY, because the thing being guarded here is a NULL.
 *
 * Breaking the guard in traceSourceUrl -- which is the only way to prove this check works -- makes
 * it throw on a null key rather than return one, and an uncaught throw kills the run two lines
 * below the assertion that should have reported it. CLAUDE.md names this exact trap. So the throw
 * is caught and reported as the failure it is.
 */
const url = (source, key) => {
  try { return traceSourceUrl(source, key) } catch (e) { return `threw: ${e.message}` }
}

check('a web search carries the name in the link',
  url(traceSourceById('google'), 'Promise Sikelele'),
  'https://www.google.com/search?q=Promise%20Sikelele')
/* ENCODED, WHICH IS NOT A FORMALITY: a company is "Rinda Roo Company" with spaces in it, and an
   unencoded space ends the URL at the first word. */
ok('...with the spaces encoded',
  !(url(traceSourceById('google'), 'Rinda Roo Company') ?? '').includes(' '))
/* A TEMPLATED LINK WITH NOTHING TO PUT IN IT OPENS NOTHING, rather than searching for the literal
   "{key}" -- which is a tab the collector has to read before realising it is nonsense. */
check('...and nothing to search opens nothing',
  url(traceSourceById('google'), ''), null)
check('...including a null', url(traceSourceById('google'), null), null)
/* A PLAIN LINK IS UNTOUCHED whether or not a key is to hand: these post a form, and the key is
   pasted rather than carried. */
check('a form site opens the same either way',
  url(traceSourceById('sassa'), null), 'https://srd.sassa.gov.za/sc19/status')
check('a source with no portal opens nothing',
  url(traceSourceById('csa'), '8806045286087'), null)
/* NO '{key}' SURVIVES INTO ANY ADDRESS, which is the one failure that would reach the debtor's
   screen as a search for a placeholder. */
ok('no link is left holding the placeholder',
  TRACE_SOURCES.every((s) => !(url(s, 'x') ?? '').includes('{key}')))

/* SASSA SAYS WHAT IT WILL ALSO ASK FOR. Its status page wants the phone number the grant was
   applied on, which the firm does not hold -- said before the trip rather than after it. */
ok('SASSA warns about the second field it asks for',
  /phone number/i.test(traceSourceById('sassa').alsoNeeds ?? ''))

/* ---------------------------------------------------------------------------------------------
 * AND WHAT CAME BACK IS TYPED, NOT SCREENSHOTTED
 *
 * THE FIRM: "how do we capture the data? They should either capture it or the screenshots should
 * be uploaded. I believe maybe things should just be typed in. That might be better."
 * ------------------------------------------------------------------------------------------- */

const grants = traceSourceById('sassa')
check('the finding is what the note says',
  traceSourceNote({ source: grants, found: 'Drawing an SRD grant since March.' }),
  'Trace done — searched SASSA — Drawing an SRD grant since March.')
/* NOTHING FOUND IS STILL A RECORD. The next collector needs to know where has already been tried,
   so an empty finding leaves the sentence that says the work happened. */
check('...and nothing found still records the search',
  traceSourceNote({ source: grants, found: '' }), 'Trace done — searched SASSA.')
check('...as does a finding of only spaces',
  traceSourceNote({ source: grants, found: '   ' }), 'Trace done — searched SASSA.')
/* A BUREAU SEARCH IS NOT CAPTURED THIS WAY. It has a whole workspace behind it -- every number,
   address and linked person as its own row -- so a free-text box would be a second, worse place
   to put the same findings. */
ok('a bureau search ignores the typed finding',
  !traceSourceNote({ source: traceSourceById('xds'), found: 'something', count: 2 })
    .includes('something'))

/* ---------------------------------------------------------------------------------------------
 * AND THE BUTTON USES THE RIGHT ONE OF THE TWO
 * ------------------------------------------------------------------------------------------- */

ok('the button picks the key off the source', /source\.searchOn === 'name'/.test(button))
ok('...and the account supplies a name for it', /debtorName: string \| null/.test(button))
/*
 * READ OFF THE SOURCE BEING PICKED, NOT OFF THE ONE IN STATE, and this is the bug that would have
 * been invisible. setSource has not run when pick() opens the tab, so reading `source` there copies
 * and opens for the PREVIOUS source -- the right site for the wrong debtor, or the wrong key for
 * the right site, on every press after the first.
 */
ok('...for the source being picked rather than the last one',
  /const copying = s\.searchOn === 'name'/.test(button)
  && /const wanted = s\.searchOn === 'name'/.test(button))
ok('...and the address is built from it too', /traceSourceUrl\(s, wanted\)/.test(button))
ok('...never from the one in state', !/traceSourceUrl\(source,/.test(button))

/* AN ID IS LUHN-CHECKED AND A NAME IS NOT, which is not laxness: a transposed pair traces somebody
   ELSE and is thirteen digits either way, while a misspelt name costs a search that finds nothing.
   So the only way a name fails is by being absent. */
ok('a missing name is the only way a name fails',
  /This source is searched on a name and the account has none recorded/.test(button))

/* WHAT CAME BACK IS TYPED, AND ONLY WHERE THERE IS NO WORKSPACE BEHIND IT. */
ok('the box asks what was found', /What did you find\?/.test(button))
ok('...only on the sources with no workspace', /!result && !counted && \(\s*<label/.test(button))
ok('...and it reaches the record', /sourceId: source\.id, named, found,/.test(button))
/* CLEARED WITH THE SOURCE, or a finding typed against SASSA follows the collector on to the
   voters' roll and lands on the wrong note. */
ok('...and is cleared when the source changes', /setFound\(''\)/.test(button))

/* AND THE SITE'S SECOND FIELD IS SAID BEFORE THE TRIP, not discovered on arrival. */
ok('the box warns what else the site asks for', /source\.alsoNeeds &&/.test(button))

/* ---------------------------------------------------------------------------------------------
 * A LINKED COMPANY IS SOMETHING YOU CAN TRACE IN ITS OWN RIGHT
 *
 * THE FIRM, reading a row with nothing on the end of it: "again, at the companies, like, you
 * should ask if you can trace them." A directorship cannot be rung and cannot answer, so the
 * companies list is not one you WORK -- which left the whole column with no action at all. But a
 * company the debtor directs is exactly where the money is.
 * ------------------------------------------------------------------------------------------- */

const workspace = readFileSync(
  new URL('../../src/pages/accounts/TraceWorkspaceModal.tsx', import.meta.url), 'utf8')
ok('a companies row offers a trace', /category === 'companies' \? \(\s*\n?\s*<TraceButton/.test(workspace))
/* AS A COMPANY, which is what decides the key and therefore which sources make sense: CIPC and the
   VAT vendor search answer about a company, and SASSA does not answer about one at all. */
ok('...as a company rather than as the debtor', /debtorKind="company"/.test(workspace))
ok('...searched on the registration number where the bureau printed one',
  /idNumber=\{registrationIn\(row\.label\)\}/.test(workspace))
ok('...and on its name either way', /debtorName=\{row\.value\}/.test(workspace))

/* THE NUMBER IS FOUND IN THE LABEL, not assumed to be the whole of it: the bureau stores it as
   "<role> · <what it had>". */
check('a registration number is read out of a label',
  registrationIn('Director · 2016/210735/07'), '2016/210735/07')
check('...including a bureau prefix letter', registrationIn('Member · K2016/210735/07'), 'K2016/210735/07')
/* NULL RATHER THAN A GUESS where none was printed. traceSearchKey refuses anything that is not a
   registration number, so a half-read string would report "that is not a registration number" on a
   company whose number the bureau simply never carried -- which reads as the firm's data being
   wrong rather than the bureau's being thin. Null falls through to the name. */
check('...and nothing where there is none', registrationIn('Director · Fastcase (Pty) Ltd'), null)
check('...and nothing from an empty label', registrationIn(null), null)
/* AND A TELEPHONE NUMBER IS NOT A REGISTRATION NUMBER. The two live in the same label field, and
   one read as the other is a CIPC search for a debtor's mobile. */
check('...and never a phone number', registrationIn('Cell · 082 573 3344'), null)

/* ---------------------------------------------------------------------------------------------
 * FOUR TRACING CHARGES A MONTH, COUNTING BOTH ITEMS TOGETHER
 *
 * THE FIRM: "I don't think you have to charge the other necessary expenses for every single one.
 * It's just if you're starting to conduct those traces... Cap all the tracing activities at four a
 * month. Whether or not it's a trace or the other necessary expense. Just detail them."
 * ------------------------------------------------------------------------------------------- */

check('the cap is four', MONTHLY_LIMIT[TRACING_ACTION_CODE], 4)
/*
 * KEYED ON THE ACTION, NOT THE ITEM, and that is the whole of "whether or not". A bureau search is
 * item 4(c) and a SASSA or deeds search is item 3; four is the total of BOTH. Keyed on the item it
 * would be two separate fours -- twice what was asked for -- and item 3 also carries the perusal of
 * documents, so an item-3 cap would stop a collector opening a PDF because somebody had searched
 * the deeds office that month.
 */
check('...and it is the code the fees actually carry', TRACING_ACTION_CODE, 'TRC')
/* NOT 'trace', WHICH IS IN THE ActionCode UNION AND NOTHING WRITES. A cap on the tidier spelling
   would count nothing for ever and refuse nobody: a guard that looks right in a diff and is not
   there. Every tracing fee on the book carries TRC. */
ok('...rather than the spelling nothing writes', MONTHLY_LIMIT.trace === undefined)
/* AND NOTHING ELSE IS CAPPED BY MONTH. A second entry here would be a rule the firm never asked
   for, applied to somebody's money. */
check('...and it is the only monthly cap', Object.keys(MONTHLY_LIMIT), [TRACING_ACTION_CODE])

const engine = readFileSync(new URL('../../src/lib/chargeEngine.ts', import.meta.url), 'utf8')
ok('the engine counts the month on the action code',
  /\.eq\('action_code', input\.actionCode\)[\s\S]{0,300}monthStart/.test(engine)
  || /monthStart[\s\S]{0,400}\.eq\('action_code', input\.actionCode\)/.test(engine))
/* BILLED ROWS ONLY, like both allowances beside it: a search recorded at nought took nothing from
   the debtor, so it cannot be the reason the next one goes unrecovered. */
ok('...counting only what earned something',
  /actionMonthRoom[\s\S]{0,600}\.eq\('billed', true\)/.test(engine))
/* AND IT ACTUALLY STOPS THE FEE. A room that is computed and never consulted is the commonest
   shape of a cap that does not exist. */
ok('...and a spent allowance earns nothing', /&& actionMonthRoom > 0/.test(engine))
/* SAID IN ITS OWN WORDS RATHER THAN BLAMING THE GAZETTE -- this is the firm's rule, and the
   collector who meets it is usually doing necessary work on a multi-debtor account. */
ok('...and the refusal names the firm s four',
  /four tracing charges have already been raised/.test(engine))
ok('...as its own reason rather than the gazette s',
  /'tracing-limit'/.test(engine) && /\| 'tracing-limit'/.test(engine))

/* ---------------------------------------------------------------------------------------------
 * "JUST DETAIL THEM"
 * ------------------------------------------------------------------------------------------- */

const fee = (over) => ({
  incurredAt: '2026-10-02T09:00:00Z', description: 'Credit bureau search',
  amountExclVat: 16, billed: true, actionCode: 'TRC', ...over,
})
const month = tracingThisMonth([
  fee({ incurredAt: '2026-10-01T09:00:00Z' }),
  fee({ incurredAt: '2026-10-02T09:00:00Z', description: 'ONE', amountExclVat: 25 }),
], '2026-10-15', 4)
check('it counts both items together', month.used, 2)
check('...and says how many are left', month.left, 2)
/* THE LIST IS THE POINT: a collector told "four already" has no way to know whether that was four
   real searches or one counted four times, and no way to put the case to a team leader. */
check('...and details each one', month.charges.map((c) => c.description), ['Credit bureau search', 'ONE'])
check('...oldest first', month.charges.map((c) => c.on), ['2026-10-01', '2026-10-02'])

/* COUNTED THE SAME WAY THE ENGINE COUNTS, which is what must not drift: a panel counting unbilled
   rows would show four used while the engine still allowed one, and one screen would give a
   collector two different numbers. */
check('an unbilled search does not count',
  tracingThisMonth([fee({ billed: false })], '2026-10-15', 4).used, 0)
check('...nor one from last month',
  tracingThisMonth([fee({ incurredAt: '2026-09-30T09:00:00Z' })], '2026-10-15', 4).used, 0)
check('...nor one from next month',
  tracingThisMonth([fee({ incurredAt: '2026-11-01T09:00:00Z' })], '2026-10-15', 4).used, 0)
/* AND A PERUSAL IS NOT A TRACE, which is the item-3 confusion this is keyed on the action to
   avoid: opening a PDF must not spend a tracing charge. */
check('a perusal is not a tracing charge',
  tracingThisMonth([fee({ actionCode: 'perusal', description: 'Perusal of documents' })], '2026-10-15', 4).used, 0)
/* LEFT NEVER GOES NEGATIVE: five charged in a month -- possible on history, or if the cap is ever
   lowered -- must read as none left rather than as minus one. */
check('an over-spent month reads as none left',
  tracingThisMonth([fee(), fee(), fee(), fee(), fee()], '2026-10-15', 4).left, 0)

ok('the box shows the month before you spend one', /tracing charges used on this account this month/.test(button))
ok('...and lists what they went on', /tracing\.charges\.map/.test(button))
ok('...and says the search is still recorded when the four are gone',
  /it just earns nothing until next month/.test(button))

console.log(`\ncheck-trace-sources: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
