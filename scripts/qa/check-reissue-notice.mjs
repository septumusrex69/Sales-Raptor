/**
 * THE ADDRESS WAS WRONG, SO THE DEMAND NEVER LANDED — AND THE QUESTION IS ASKED, NOT ANSWERED.
 *
 * THE FIRM: "when you've changed the primary email address, it should ask you, do you want to
 * restart the Section 129 process? And if you say yes, it restarts the Section 129 process in the
 * workflow. It still shows that the previous workflow went out to the wrong email address."
 *
 * WHAT THIS FILE GUARDS, and the first two are the ones that cost something:
 *
 *   1. IT ASKS ONLY WHERE A NOTICE WENT TO THE ADDRESS BEING REPLACED. A box that opens on every
 *      corrected typo is a box people dismiss without reading, and then the one time it matters it
 *      is dismissed too. The comparison is against what the step ACTUALLY went to, which is not the
 *      address the account carries today -- a sequence can run partly to one and partly to another.
 *   2. IT NEVER ACTS BY ITSELF. markStepNotServed says in as many words that re-serving must not be
 *      a side effect of correcting an address; a Yes is a person answering, and a No writes nothing.
 *   3. THE FIRST ATTEMPT SURVIVES, with the address it went to on it. The file has to read "went to
 *      the wrong address on the 1st, re-issued on the 8th".
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-reissue-notice.mjs
 */
import { readFileSync } from 'node:fs'
import { noticeToReissue, reissueReason, sameAddress } from '../../src/lib/reissueNotice.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

const OLD = 'promise@bredellferreira.co.za'
const NEW = 'stephan@novacall.co.za'

const step = (over = {}) => ({
  id: 'step-129', label: 'Section 129 / letter of demand', channel: 'email',
  state: 'sent', sentAt: '2026-10-03T08:09:28Z', sentTo: OLD, notServedAt: null, ...over,
})
const run = (over = {}) => ({
  id: 'run-1', versionId: 'ver-1', workflowName: 'Section 129', triggerKind: 'by_hand',
  steps: [step()], ...over,
})
const ask = (over = {}) => noticeToReissue({ before: OLD, after: NEW, runs: [run()], ...over })

/* ---------------------------------------------------------------------------------------------
 * THE ONE CASE IT IS FOR
 * ------------------------------------------------------------------------------------------- */

const offer = ask()
ok('a demand that went to the replaced address is offered', offer !== null)
check('...naming the step', offer?.stepLabel, 'Section 129 / letter of demand')
check('...the address it went to, not the one on the account now', offer?.sentTo, OLD)
/* THE VERSION, because that is what is started again -- the same sequence, not a new one, which
   is what makes the second run the FIRST good clock rather than a second clock on one debt. */
check('...and the version to issue again', offer?.versionId, 'ver-1')
check('...on its own run', offer?.runId, 'run-1')

/* ---------------------------------------------------------------------------------------------
 * AND THE MANY CASES IT IS NOT FOR. NULL IS THE ORDINARY ANSWER.
 * ------------------------------------------------------------------------------------------- */

check('nothing is asked when the address did not change',
  ask({ before: OLD, after: OLD }), null)
/*
 * CAPITALS ARE NOT A CHANGE. A collector retyping an address in title case has not moved where it
 * goes, and a question about re-serving a statutory demand there is the warning that fires when
 * nothing is wrong.
 */
check('...nor when only the capitals changed',
  ask({ before: OLD, after: 'Promise@BredellFerreira.co.za' }), null)
check('...nor when only the spacing changed', ask({ before: OLD, after: ` ${OLD} ` }), null)
ok('the comparison itself ignores case and spacing',
  sameAddress(' A@B.CO.ZA ', 'a@b.co.za') && !sameAddress('a@b.co.za', 'c@b.co.za'))

/* A FIRST ADDRESS IS NOT A CORRECTED ONE: nothing can have been served on a blank. */
check('nothing is asked when there was no address before',
  ask({ before: '', after: NEW }), null)
check('...nor when the address was cleared', ask({ before: OLD, after: '' }), null)

/*
 * AND NOTHING WAS SERVED ON THIS ADDRESS. The notice went somewhere else, so replacing this one
 * says nothing about whether the debtor received it. The book has exactly this: a demand to
 * promise@..., the final notice to stephan@..., on one account.
 */
check('nothing is asked where the notice went to a different address',
  ask({ runs: [run({ steps: [step({ sentTo: 'someone.else@example.com' })] })] }), null)
/* THE FIRM'S OWN ACCOUNT, THE OTHER WAY ROUND: correcting the address the LATER notices went to
   must not offer to re-issue on the strength of the demand, which went somewhere else. */
check('...and correcting the second address does not reach back to the first',
  noticeToReissue({
    before: NEW, after: 'third@example.com',
    runs: [run({ steps: [step(), step({ id: 's2', label: 'Final notice', sentTo: NEW, sentAt: '2026-10-03T08:15:01Z' })] })],
  })?.stepLabel, 'Final notice')

check('nothing is asked on a step that has not been sent',
  ask({ runs: [run({ steps: [step({ state: 'held', sentAt: null })] })] }), null)
check('...nor on a pending one', ask({ runs: [run({ steps: [step({ state: 'pending' })] })] }), null)
/* ALREADY SAID TO HAVE FAILED. The run is unlocked and the panel says so; asking again would
   offer a second re-issue of a sequence already waiting to be re-issued. */
check('nothing is asked where it is already marked never served',
  ask({ runs: [run({ steps: [step({ notServedAt: '2026-10-03T09:00:00Z' })] })] }), null)

/*
 * AN SMS CARRIES NO ADDRESS AND IS NOT WHAT SERVICE TURNS ON. A section 129 is served by EMAIL;
 * the text behind it tells the debtor to go and read it, so a wrong mobile costs the nudge rather
 * than the service.
 */
check('nothing is asked on an SMS step',
  ask({ runs: [run({ steps: [step({ channel: 'sms', sentTo: null })] })] }), null)

/*
 * AND ONLY A SEQUENCE A PERSON STARTS. api/workflow/start refuses anything else outright, so
 * offering to re-issue a handover run would be a question whose Yes the server then declines.
 */
check('nothing is asked on a run that starts itself',
  ask({ runs: [run({ triggerKind: 'allocated' })] }), null)
check('...nor on one whose version is not known',
  ask({ runs: [run({ versionId: null })] }), null)
check('an account with no runs at all asks nothing', ask({ runs: [] }), null)

/* ---------------------------------------------------------------------------------------------
 * THE EARLIEST ONE, BECAUSE THAT IS THE ONE THAT STARTED THE CLOCK
 * ------------------------------------------------------------------------------------------- */

/*
 * A sequence that ran to a wrong address sent several things to it. Marking a LATER one would say
 * the sequence was good up to day 12 when the debtor never saw day 1 -- and every interval after
 * the demand is counted from the demand.
 */
const several = ask({
  runs: [run({
    steps: [
      step({ id: 'later', label: 'Final notice', sentAt: '2026-10-15T08:00:00Z' }),
      step({ id: 'first', label: 'Section 129 / letter of demand', sentAt: '2026-10-03T08:00:00Z' }),
    ],
  })],
})
check('the earliest notice is the one offered', several?.stepId, 'first')
/* A STEP WITH NO DATE SORTS LAST rather than first: it is a row we know less about, not an older
   one, and it must not outrank a notice carrying a real date. */
const undated = ask({
  runs: [run({
    steps: [
      step({ id: 'undated', sentAt: null }),
      step({ id: 'dated', sentAt: '2026-10-03T08:00:00Z' }),
    ],
  })],
})
check('...and an undated one does not outrank a dated one', undated?.stepId, 'dated')

/* ---------------------------------------------------------------------------------------------
 * WHAT GOES ON THE RECORD
 * ------------------------------------------------------------------------------------------- */

const reason = reissueReason(OLD, NEW)
ok('the reason names the address it went to', reason.includes(OLD))
/* BOTH ADDRESSES, because eighteen months later the question is WHICH address -- and the run only
   knows what it sent to, never what it was replaced with. */
ok('...and the one it was corrected to', reason.includes(NEW))
ok('...and says the notice did not reach them', /did not reach them/.test(reason))

/* ---------------------------------------------------------------------------------------------
 * THE ADDRESS AS SENT IS CARRIED, AND SHOWN
 * ------------------------------------------------------------------------------------------- */

const accountRun = read('src/lib/accountRun.ts')
/* OFF account_emails.workflow_step_id, which is the link a bounce already travels back along. The
   address the ACCOUNT carries is a different thing the moment somebody corrects one, which is the
   entire case this exists for. */
ok('the runs query asks for the address each notice went to',
  /account_emails\(debtor_address\)/.test(accountRun))
ok('...and the mapper names it, so it is not undefined for ever',
  /sentTo: \(Array\.isArray\(s\.account_emails\)/.test(accountRun))
/* THE VERSION TOO, or there is nothing to start again. CLAUDE.md on hand-written mappers: a column
   in the select and the type but missing from the mapper reads as undefined and nothing fails. */
ok('...and the version to start again', /version_id/.test(accountRun) && /versionId: r\.version_id/.test(accountRun))

const panel = read('src/components/collections/WorkflowRunPanel.tsx')
ok('the panel shows where a notice went', /Sent to \{step\.sentTo\}/.test(panel))
/* ON EVERY SENT EMAIL, not only the failed ones. A line that appears only when something has gone
   wrong teaches people that its absence means nothing happened. */
ok('...on any sent email rather than only the failed ones',
  /\{step\.sentTo && step\.state === 'sent' &&/.test(panel))
/* AND THE FIRST ATTEMPT IS NEVER DELETED. A send cannot be un-sent. */
ok('...and a notice that never arrived still says so', /Never reached them/.test(panel))

/* ---------------------------------------------------------------------------------------------
 * ASKED, NEVER DONE
 * ------------------------------------------------------------------------------------------- */

const contacts = read('src/pages/accounts/AccountWorkspacePanels.tsx')
/* READ BEFORE THE SAVE. `contact` is re-rendered off the reloaded workspace the moment the write
   resolves, so taken afterwards this is the new value twice and nothing ever looks changed. */
ok('the old address is read before the save', /const before = contact\.value/.test(contacts))
ok('...and the question is only raised where the value really moved',
  /if \(before\.trim\(\) !== draft\.trim\(\)\) onValueChanged\?\./.test(contacts))
/* THE EMAIL SLOT AND NOTHING ELSE. Offering to re-serve a statutory demand because somebody fixed
   a telephone number would be the warning that fires when nothing is wrong. */
/* COUNTED ON THE PAGE'S OWN CALLBACK, not on the prop name: ContactSlot passes `onValueChanged`
   through to ContactValue, so counting the prop counts the plumbing as well as the one slot that
   is wired to it. */
const wired = contacts.match(/onValueChanged=\{onEmailChanged\}/g) ?? []
check('exactly one contact slot asks the question', wired.length, 1)
ok('...and it is the email one',
  /label="Email address"[\s\S]{0,400}onValueChanged=\{onEmailChanged\}/.test(contacts))

const detail = read('src/pages/accounts/AccountDetail.tsx')
ok('the page decides whether to ask, off the runs it holds',
  /noticeToReissue\(\{ before, after, runs \}\)/.test(detail))
ok('...and opens the box only where there is something to offer',
  /if \(offer\) setReissuing/.test(detail))

const modal = read('src/pages/accounts/ReissueNoticeModal.tsx')
/*
 * TWO WRITES, ONE DECISION, AND THE ORDER IS LOAD-BEARING. api/workflow/start reads
 * `reissue_allowed` to decide whether this account may go through again, and only
 * workflow_step_not_served sets it -- started the other way round the press is simply refused.
 */
ok('the box marks the notice unserved', /markStepNotServed\(\{/.test(modal))
ok('...and then starts the sequence again', /startWorkflow\(/.test(modal))
ok('...in that order', modal.indexOf('markStepNotServed({') < modal.indexOf('startWorkflow('))
/* AND THE NO WRITES NOTHING. Most address edits are typos on accounts with nothing running. */
ok('saying no writes nothing', /onClick=\{onClose\} disabled=\{busy\}/.test(modal))
ok('...and the box says so', /nothing is recorded/.test(modal))
/* IT NAMES BOTH ADDRESSES, so the person answering can see what they are deciding about. */
ok('the box names the address it went to', /\{offer\.sentTo\}/.test(modal))
ok('...and the one it will go to now', /\{after\}/.test(modal))
ok('...and promises the first attempt stays on the file', /stays on the file/.test(modal))

/*
 * AND THE RULE markStepNotServed IS WRITTEN AROUND STILL STANDS. It says, in as many words, that
 * re-serving must never be a side effect of correcting an address -- so nothing here may call it
 * from the contact save itself.
 */
ok('correcting a contact does not mark anything unserved by itself',
  !/markStepNotServed/.test(contacts))
ok('...and neither does updateContact', !/markStepNotServed/.test(read('src/lib/accountWorkspace.ts')))

console.log(`\ncheck-reissue-notice: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
