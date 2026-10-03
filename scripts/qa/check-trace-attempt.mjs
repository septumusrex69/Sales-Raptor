/**
 * A TRACE THAT COULD NOT BE RUN, AND THE THREE THINGS THAT HAVE TO FOLLOW IT.
 *
 * THE FIRM: "I think it's some place that we have to say like trace attempted and there was no
 * trace on the data. We would need more information like an ID number -- or if there is no ID
 * number to complete the trace. The cell phone number can also be traced, however, you know, we
 * haven't been able to trace the data on the information provided."
 *
 * WHAT THIS FILE GUARDS:
 *
 *   1. THE MONEY. Nothing was searched, so nothing may be charged. recordTraceAttempt must not
 *      reach chargeItem, and the modal must not go on offering the tariff buttons once "we could
 *      not trace" is on the file -- two records that contradict each other, with the one on the
 *      debtor's statement being the one that gets taxed.
 *   2. THE CELL NUMBER IS A BUREAU KEY AND NOTHING ELSE'S. 086 and 087 are ten digits beginning
 *      08 and belong to a switchboard; SASSA, the voters' roll and CIPC cannot be searched on a
 *      cell number at all.
 *   3. THE CLIENT SENTENCE SAYS IT ABOUT THE INFORMATION, never about the debtor -- accountNarrative
 *      already holds that line and it holds here.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-trace-attempt.mjs
 */
import { readFileSync } from 'node:fs'
import {
  TRACE_REQUEST_FOR, mobileKeyFor, traceAttemptAsk, traceAttemptNote, traceNeeds, traceNeedsFor,
  traceableMobile,
} from '../../src/lib/traceAttempt.ts'
import { TRACE_SOURCES, traceSourceById } from '../../src/lib/traceSources.ts'
import { REQUEST_KINDS } from '../../src/lib/disputeCategories.ts'
import { clientLine } from '../../src/lib/accountNarrative.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const bureau = traceSourceById('xds')
const sassa = traceSourceById('sassa')
const iec = traceSourceById('iec')
const google = traceSourceById('google')

/* ---------------------------------------------------------------------------------------------
 * A CELL NUMBER, AND WHICH TEN DIGITS ACTUALLY ARE ONE
 * ------------------------------------------------------------------------------------------- */

check('a Vodacom number is a cell number', traceableMobile(['082 123 4567']), '0821234567')
check('an MTN number is', traceableMobile(['0831234567']), '0831234567')
check('a 06x number is', traceableMobile(['0601234567']), '0601234567')
check('a 07x number is', traceableMobile(['0791234567']), '0791234567')
/*
 * WRITTEN IN FULL WITH THE COUNTRY CODE, which is how a bureau report hands them back and how
 * half the imported book stores them. Normalised rather than refused: the number is the same line.
 */
check('+27 is read as the same number', traceableMobile(['+27 82 123 4567']), '0821234567')
check('...and 27 without the plus', traceableMobile(['27821234567']), '0821234567')

/*
 * 086 AND 087 ARE THE TRAP THIS REGEX EXISTS FOR. Ten digits, beginning 08, and a bureau searched
 * on one comes back with the business that rents the line -- a search the firm pays for about
 * somebody who is not the debtor. The same fault as the telephone number that was sitting in an
 * ID field.
 */
check('a share-call line is not a cell number', traceableMobile(['0860123456']), null)
check('a VoIP line is not a cell number', traceableMobile(['0871234567']), null)
check('a Johannesburg landline is not', traceableMobile(['011 123 4567']), null)
check('nine digits is not', traceableMobile(['082123456']), null)
check('eleven digits is not', traceableMobile(['08212345678']), null)
check('nothing at all is not', traceableMobile([null, undefined, '']), null)

/* THE FIRST ONE THAT IS A CELL NUMBER, in the order the contact list gives them -- which is
   primary first, so the number the firm itself considers the debtor's is the one searched. */
check('the first cell number in the list wins',
  traceableMobile(['011 123 4567', '0860123456', '083 999 8888', '082 111 2222']), '0839998888')

/* ---------------------------------------------------------------------------------------------
 * AND IT IS A KEY FOR THE BUREAU AND FOR NOTHING ELSE
 * ------------------------------------------------------------------------------------------- */

ok('the bureau can be searched on a cell number', mobileKeyFor(bureau, '0821234567') !== null)
check('...and it is called one on the screen', mobileKeyFor(bureau, '0821234567')?.what, 'cell number')
/*
 * SASSA WANTS AN IDENTITY NUMBER AND THE VOTERS' ROLL WANTS AN IDENTITY NUMBER. A key that is
 * wrong for the site is worse than no key: it is pasted, the form refuses it, and the collector
 * has made the trip for nothing.
 */
check('SASSA cannot', mobileKeyFor(sassa, '0821234567'), null)
check('the voters’ roll cannot', mobileKeyFor(iec, '0821234567'), null)
check('a web search cannot', mobileKeyFor(google, '0821234567'), null)
check('and no number is no key', mobileKeyFor(bureau, null), null)

/* EXACTLY ONE SOURCE CARRIES THE FALLBACK. Asserted as a count rather than per source, so adding
   a seventh source that quietly claims it fails here rather than on a debtor's statement. */
check('exactly one source takes a cell number',
  TRACE_SOURCES.filter((s) => s.fallbackOn === 'mobile').map((s) => s.id), ['xds'])

/* ---------------------------------------------------------------------------------------------
 * WHAT GOES ON THE TIMELINE
 * ------------------------------------------------------------------------------------------- */

const noId = traceAttemptNote({ source: bureau, debtorKind: 'individual', mobile: null })
ok('the note says a trace was attempted', /^Trace attempted/.test(noId))
ok('...names the source', noId.includes('XDS'))
ok('...says what the account is missing', noId.includes('no identity number'))
ok('...and says it about the information, not about the debtor',
  noId.includes('could not be traced on the information provided'))
/*
 * NEVER "UNTRACEABLE". accountNarrative's traceSentence holds this line at length: whether a
 * debtor is untraceable is a decision a team leader makes about an account, not a conclusion a
 * function may reach on their behalf.
 */
ok('...and never calls the debtor untraceable', !/untraceable/i.test(noId))
ok('...and names what would fix it', noId.includes('we need an identity number'))

const company = traceAttemptNote({ source: bureau, debtorKind: 'company', mobile: null })
ok('a company needs a registration number', company.includes('no registration number'))
ok('...and is never asked for an identity number', !/identity number/.test(company))

/*
 * THE WRONG NUMBER IS NAMED ON THE RECORD AS WELL AS ON THE SCREEN. 24 accounts in the book hold
 * a telephone number in the ID field; a note saying only "no identity number" sends the next
 * collector to look at an empty field that is not empty.
 */
const unusable = traceAttemptNote({
  source: bureau, debtorKind: 'individual', mobile: null, unusable: '0821234567',
})
ok('an unusable identity number is quoted on the record', unusable.includes('0821234567'))
ok('...and said to be the wrong kind of thing', unusable.includes('is not an identity number'))

/*
 * A CELL NUMBER ON FILE IS ONLY WORTH MENTIONING AGAINST A SOURCE THAT CANNOT USE ONE. On the
 * bureau a cell number means the search ran and there is no attempt to record at all; on SASSA it
 * is the obvious thing to try and the note has to say why nobody did.
 */
const sassaWithCell = traceAttemptNote({ source: sassa, debtorKind: 'individual', mobile: '0821234567' })
ok('SASSA says it cannot use the cell number on file',
  sassaWithCell.includes('cannot be searched on the cell number on file'))
const bureauWithCell = traceAttemptNote({ source: bureau, debtorKind: 'individual', mobile: '0821234567' })
ok('the bureau does not, because there the cell number is the key',
  !bureauWithCell.includes('cannot be searched on the cell number'))

/* A SOURCE SEARCHED ON A NAME FAILS FOR A DIFFERENT REASON AND SAYS SO. Asking a client for an
   identity number because a web search had no name would be asking for the wrong thing. */
const noName = traceAttemptNote({ source: google, debtorKind: 'individual', mobile: null })
ok('a name source says there is no name', noName.includes('no name to search on'))
ok('...and does not blame a missing identity number', !/identity number/.test(noName))

/* ---------------------------------------------------------------------------------------------
 * AND THE ASK
 * ------------------------------------------------------------------------------------------- */

/* IT IS ONE OF REQUEST_KINDS. The database refuses a value outside that list, so a rename there
   has to be a rename here -- and the failure belongs in this file rather than at an insert. */
ok('the request kind is one the board knows',
  REQUEST_KINDS.some((r) => r.value === TRACE_REQUEST_FOR))

const ask = traceAttemptAsk({ debtorKind: 'individual', debtorName: 'Promise Sikelele', mobile: null, source: bureau })
ok('the ask names the debtor', ask.includes('Promise Sikelele'))
ok('...says what was tried', ask.includes('not been able to trace'))
ok('...and asks for the thing that would fix it', ask.includes('Please let us have an identity number'))
const askWithCell = traceAttemptAsk({ debtorKind: 'individual', debtorName: 'Promise Sikelele', mobile: '0821234567', source: sassa })
ok('...and says what the firm already holds, where it holds something',
  askWithCell.includes('We hold a cell number'))
const askCompany = traceAttemptAsk({ debtorKind: 'company', debtorName: 'Rinda Roo (Pty) Ltd', mobile: null, source: bureau })
ok('a company is asked for a registration number',
  askCompany.includes('Please let us have a registration number'))
/* A DEBTOR WITH NO NAME ON THE ACCOUNT STILL GETS A SENTENCE. A request reading "We have not been
   able to trace  on the information provided" is the kind of thing that goes to a client. */
const askNameless = traceAttemptAsk({ debtorKind: 'individual', debtorName: null, mobile: null, source: bureau })
ok('a nameless account still reads as a sentence', askNameless.includes('trace the debtor on'))
ok('...with no gap where the name was', !/\s{2,}/.test(askNameless))

ok('...and says what the firm already holds without the article left in the middle',
  !/no an identity number/.test(askWithCell))

/*
 * AND IT ASKS FOR WHAT **THIS** SOURCE NEEDED. A web search is searched on a name, so asking the
 * client for an identity number because a web search had no name is a request they cannot act on.
 */
const askName = traceAttemptAsk({ debtorKind: 'individual', debtorName: null, mobile: null, source: google })
ok('a name source asks for the name', askName.includes('full name'))
ok('...and not for an identity number', !/identity number/.test(askName))
check('the bureau asks for an identity number', traceNeedsFor(bureau, 'individual'), 'an identity number')
check('...and a web search for a name', traceNeedsFor(google, 'individual'), 'the debtor’s full name')
check('...and a company’s registered name', traceNeedsFor(google, 'company'), 'the registered name')

check('the words for what is needed are the firm’s', traceNeeds('individual'), 'an identity number')
check('...and a company’s are its own', traceNeeds('company'), 'a registration number')

/* ---------------------------------------------------------------------------------------------
 * WHAT THE CLIENT IS TOLD
 * ------------------------------------------------------------------------------------------- */

const told = clientLine({
  traceAttempt: { attemptedOn: '2026-10-01', needs: 'an identity number', askedClient: true },
  next: null,
})
ok('the client is told the trace was attempted', told.happened.includes('attempted to trace'))
ok('...and dated', told.happened.includes('1 October 2026'))
ok('...and told what it is waiting on', told.happened.includes('an identity number'))
ok('...about the information rather than the debtor',
  told.happened.includes('information handed over does not allow'))
ok('...and never that the debtor is untraceable', !/untraceable/i.test(told.happened))

/*
 * WAITING ON SOMETHING IS NOT NOTHING BEING SCHEDULED. An account whose trace cannot run until the
 * client answers has no diary date to report, and "no further action has been scheduled" would
 * read as the firm having dropped it.
 */
ok('the next sentence says what it is waiting for', told.next.includes('as soon as you'))
ok('...rather than reporting nothing scheduled', !told.next.includes('No further action'))

/*
 * AND IT ONLY SAYS "WE HAVE ASKED YOU" WHERE THE REQUEST HAS ACTUALLY REACHED THEM. A request
 * sitting with the collector or the liaison is the firm asking itself, and a claim a client can
 * check and find false is the one thing accountNarrative exists to avoid.
 */
const internal = clientLine({
  traceAttempt: { attemptedOn: '2026-10-01', needs: 'an identity number', askedClient: false },
  next: null,
})
ok('an internal request does not tell the client they were asked',
  !/\byou\b/.test(internal.next))
ok('...and still says the trace is waiting on it',
  internal.next.includes('as soon as an identity number is available'))

/*
 * A DIARY DATE STILL WINS THE "NEXT" SENTENCE. Where the firm has booked a day, that day is the
 * real commitment and the diary already names the work; the ask is carried by `happened` either
 * way, so nothing is lost.
 */
const booked = clientLine({
  traceAttempt: { attemptedOn: '2026-10-01', needs: 'an identity number', askedClient: true },
  next: { kind: 'trace', dueOn: '2026-10-20' },
})
ok('a booked day is still what the client is promised',
  booked.next.includes('20 October 2026'))

/* AND NOTHING CHANGES ON AN ACCOUNT THAT HAS NO SUCH REQUEST. The clause fires off the request,
   not off a missing column -- most of the book has no identity number and is collected fine. */
const ordinary = clientLine({ handedOverOn: '2026-09-17', next: null })
ok('an account with no request says nothing about tracing',
  !/trace/i.test(ordinary.happened))

/* ---------------------------------------------------------------------------------------------
 * NO FEE, AND NO WAY TO MAKE ONE
 * ------------------------------------------------------------------------------------------- */

const write = readFileSync(new URL('../../src/lib/accountTrace.ts', import.meta.url), 'utf8')
const fn = write.slice(write.indexOf('export async function recordTraceAttempt'))
const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
ok('recordTraceAttempt exists', body.includes('recordTraceAttempt'))
/*
 * NOTHING WAS SEARCHED, SO NOTHING IS CHARGED. Annexure B prices ACTIONS -- item 4(c) a bureau
 * search, item 3 a necessary expense incurred -- and here there was neither. A debtor billed R16
 * because the client's handover sheet arrived without an identity number would be paying for
 * somebody else's omission.
 */
ok('...and it raises no fee', !/chargeItem|chargeForSource|scheduleFor/.test(body))
ok('...it writes a note and that is all', /addNote\(/.test(body))

/* ---------------------------------------------------------------------------------------------
 * THE BOX: A WAY TO RECORD IT, AND THE TARIFF BUTTONS GONE ONCE IT IS RECORDED
 * ------------------------------------------------------------------------------------------- */

const btn = readFileSync(new URL('../../src/pages/accounts/TraceButton.tsx', import.meta.url), 'utf8')
ok('the box offers a way to record that we could not trace',
  btn.includes('Record that we could not trace'))
ok('...which writes the attempt', /recordTraceAttempt\(\{/.test(btn))
/*
 * AND THE CHARGE CONTROLS GO WITH IT. Recording that the search could not be run and then charging
 * for it is two records that contradict each other, and the one on the debtor's statement is the
 * one that gets taxed. Asserted on all three: the bureau's count row, the one-press record, and
 * the tariff line under them.
 */
/*
 * ANCHORED ON WHAT EACH GATE SITS IN FRONT OF, not counted. A count passes while the gate has
 * moved onto the wrong control, and `!counted` contains `counted` -- so a loose regex for the
 * single record button matches the yes/no question's gate instead and the money goes unguarded.
 */
ok('the row of counts is gated',
  /\{!result && counted && attempt === 'no' && \(/.test(btn))
ok('...and so is the single record button',
  /\{!result && !counted && attempt === 'no' && \(\s*\n\s*<button type="button" onClick=\{\(\) => void charge\(1\)\}/.test(btn))
/* AND THE TARIFF LINE WITH THEM: "R16.00 plus VAT under item 4(c)" under a recorded non-search
   reads as a fee that was raised. */
ok('...and the price under them',
  /\{!result && attempt === 'no' && \(\s*\n\s*<p className="text-xs text-slate-400/.test(btn))
/*
 * THE OFFER TO ASK THE CLIENT COMES AFTER THE RECORD, NOT INSTEAD OF IT. A client asked for an
 * identity number with no attempt on the file is a request with nothing behind it.
 *
 * PRESENCE BEFORE ORDER, which is CLAUDE.md's named trap: indexOf returns -1, so an order-only
 * assertion passes vacuously the moment one of the two things it orders is deleted.
 */
ok('the box confirms the attempt was recorded', btn.includes('Recorded on the account'))
ok('...and says nothing was charged, where somebody is reading it',
  btn.includes('nothing charged, because nothing was searched'))
ok('the ask is offered after the attempt is on the file, not instead of it',
  btn.indexOf('Ask the client for') > btn.indexOf('Recorded on the account'))
ok('...and it opens the Escalate box rather than raising a ticket here',
  /onAskClient\(traceAttemptAsk\(/.test(btn) && !/raiseQuery/.test(btn))
/* AND THE BUTTON SAYS WHAT IS BEING ASKED FOR, off the source rather than off the debtor's kind --
   see traceNeedsFor. A button reading "ask the client for an identity number" under a web search
   that had no name is the wrong ask offered in the right place. */
ok('the button names what this source needed',
  /Ask the client for \{traceNeedsFor\(source, debtorKind\)\}/.test(btn))

const detail = readFileSync(new URL('../../src/pages/accounts/AccountDetail.tsx', import.meta.url), 'utf8')
ok('the page prefills the request kind', detail.includes('initialRequestFor={TRACE_REQUEST_FOR}'))
ok('...and the reason', detail.includes('initialDescription={askingTrace}'))
ok('...and hands the trace box a cell number', /mobile=\{traceMobile\}/.test(detail))
/* OFF THE WHOLE REACHABLE LIST, not off the contacts labelled 'mobile'. Half the imported book has
   every number under one label, so a cell number filed as a "phone" is the ordinary case. */
ok('...read off every number that could reach the debtor',
  /traceableMobile\(smsNumbers\.map/.test(detail))

/*
 * AND THE LINKED COMPANY GETS NONE. The debtor's cell number is the DEBTOR'S: searching a bureau
 * on it while the subject of the trace is a linked company would charge the account for a search
 * about somebody else and file the answer under the company.
 */
const workspace = readFileSync(new URL('../../src/pages/accounts/TraceWorkspaceModal.tsx', import.meta.url), 'utf8')
ok('a linked company is never traced on the debtor’s cell number',
  /mobile=\{null\}/.test(workspace))

console.log(`\ncheck-trace-attempt: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
