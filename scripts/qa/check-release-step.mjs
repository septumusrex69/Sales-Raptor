/**
 * A PERSON SAYING "SEND IT" — AND WHAT THAT DOES NOT MEAN.
 *
 * The firm's rule for the steps that carry `needsRelease`: day 39 tells a debtor their default
 * HAS been reported and quotes the listing reference, day 49 tells them their file HAS gone to
 * the attorneys. Sending either before it is true is a misrepresentation, and the firm's own note
 * says it is the kind of thing the Council for Debt Collectors acts on. So the morning run
 * prepares them and stops, and a person is the gate.
 *
 * WHAT THIS GUARDS:
 *
 *   - A RELEASE LIFTING MORE THAN IT SHOULD. It lifts the wait-for-a-person refusal and nothing
 *     else. A button cannot supply a missing listing reference, and a release that sent the
 *     notice anyway would put "{{listing_reference}}" into the paragraph telling a debtor how to
 *     query their bureau listing — which is the exact failure planSend exists to prevent, arrived
 *     at from the other direction.
 *   - TWO SEND PATHS. The button and the cron go through one `runOneStep`, so the wording, the
 *     fee, the Sent copy and the record are identical whoever sent it. Written twice, the drift
 *     shows up as a debtor charged differently depending on who pressed what.
 *   - ANY AGENT ON ANY ACCOUNT. The row policy admits all thirty-two pre-legal agents, because
 *     RLS cannot see which account a step belongs to without a join on every row. Left at that,
 *     any of them could issue a statutory demand on any of twenty-three thousand accounts, and
 *     the record would name them.
 *   - A BUTTON THAT LIES ABOUT WHAT IT DOES. On a hold waiting for a FACT, "Send it now" is not
 *     true; pressing it asks again and holds again.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-release-step.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { planSend } from '../../src/lib/workflowSend.ts'
import { sampleValues } from '../../src/lib/messageTemplates.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

const route = read('api/_lib/workflow/release.ts')
const step = read('api/_lib/workflow/step.ts')
const runner = read('api/_lib/workflow/run.ts')
const dispatcher = read('api/workflow/[action].ts')
const panel = read('src/components/collections/WorkflowRunPanel.tsx')
const store = read('src/lib/accountRun.ts')

ok('the release route exists', route.length > 0)
/*
 * SLICED TO THE TABLE ITSELF. Written as a lazy match from the word ROUTES this reported a
 * correctly routed action as missing: the declaration's TYPE contains `=>`, so a `[^=]*` hop to
 * the assignment stops dead at the arrow.
 */
const routeTable = dispatcher.slice(
  dispatcher.indexOf('Promise<void>> = {'),
  dispatcher.indexOf('export default'),
)
ok('the route table is the thing being read', routeTable.includes('run'))
ok('...and release is in it', /\brelease\b/.test(routeTable))
/* Both routes, one function: Hobby counts files, not routes. */
ok('...beside the morning run, in the same function', /\brun\b/.test(routeTable))

/* ------------------------------------------------ what a release lifts */

function node(over = {}) {
  return {
    id: 'n1', phaseId: null, key: 'k', kind: 'communication', label: 'Listed', description: null,
    day: 39, deadlineDays: null, deadlineUnit: null, channel: 'email',
    templateId: 't', templateCompanyId: null, afterMinutes: null,
    needsRelease: true, statutory: true, assignTo: null, ordinal: 0,
    ...over,
  }
}
const template = (body) => ({
  id: 't', kind: 'email', subject: 'Notice', body, audience: null, attachment: null,
})
const debtor = { kind: 'individual', email: 'd@example.com', mobile: '0821234567' }
const values = sampleValues()
const plan = (over, tmpl, vals = values) => planSend({
  node: node(over), individual: tmpl, company: null, debtor, values: vals, dueOn: '2026-09-23',
  ...(over.released === undefined ? {} : { released: over.released }),
})

/* Unreleased, a step that waits for a person waits. */
const waiting = plan({}, template('Dear {{debtor_name}}.'))
check('a step that waits for a person is refused until somebody says so',
  waiting.refusal, 'waits_for_person')

/* Released, the same step goes. */
const released = plan({ released: true }, template('Dear {{debtor_name}}.'))
ok('...and goes once they have', released.can)
check('...with nothing else standing in the way', released.refusal, null)

/*
 * AND A RELEASE CANNOT SUPPLY A FACT. This is the assertion the whole design turns on: the same
 * released step, on an account whose listing reference is still missing, must hold again. A
 * button that sent it anyway would post the four-page notice with "{{listing_reference}}" in the
 * middle of the paragraph telling the debtor how to query their bureau listing.
 */
const short = { ...values, listing_reference: '', listing_date: '' }
const stillShort = plan({ released: true },
  template('Reported on {{listing_date}} under {{listing_reference}}.'), short)
ok('a release does not make a missing fact appear', !stillShort.can)
check('...and the step holds on the fact, not on the person', stillShort.refusal, 'unfilled')
check('...naming both fields, so somebody can go and fill them',
  stillShort.unfilled.sort(), ['listing_date', 'listing_reference'])

/* Every other guard likewise. A released step with nowhere to send still has nowhere to send. */
const noAddress = planSend({
  node: node(), individual: template('Dear {{debtor_name}}.'), company: null,
  debtor: { ...debtor, email: null }, values, dueOn: '2026-09-23', released: true,
})
check('a release does not conjure an address either', noAddress.refusal, 'no_address')

/* And an ordinary step is unaffected by the flag: it never waited for a person to begin with. */
const ordinary = planSend({
  node: node({ needsRelease: false, statutory: false }), individual: template('Dear {{debtor_name}}.'),
  company: null, debtor, values, dueOn: '2026-09-23',
})
ok('a step that never waited for anybody is unaffected', ordinary.can)

/* ------------------------------------------------ one path, not two */

ok('the step machinery is its own module', step.length > 0)
ok('the morning run goes through it', /runOneStep\(admin, step, today\)/.test(runner))
ok('...and so does the release', /runOneStep\(admin, step, todayInJohannesburg\(\), caller\.id\)/.test(route))
/*
 * AND NEITHER CALLER SENDS ANYTHING ITSELF. Two sends is two paths however they are spelled --
 * a fee, a Sent copy or the firm's font added to one and not the other is the drift this exists
 * to prevent.
 */
for (const [name, src] of [['the cron handler', runner], ['the release route', route]]) {
  ok(`${name} does not send on its own`,
    !/sendAsUser\(/.test(src) && !/sendSms\(/.test(src))
}
ok('the step machinery is where sending happens',
  /sendAsUser\(/.test(step) && /await sendSms\(/.test(step))

/* WHO SENT IT IS RECORDED. "Who sent this section 129" is asked long afterwards, and "the
   system" is not an answer. */
ok('a released send carries the name of whoever released it',
  /sent_by: releasedBy \?\? null/.test(step))
ok('...and the morning run leaves it empty, because nobody pressed anything',
  /releasedBy\?: string/.test(step))

/* ------------------------------------------------ what the route refuses */

/* A SESSION, NOT THE CRON SECRET: the point of the route is that a named person takes
   responsibility. Asserted both ways -- the cron guard must NOT be here. */
ok('the release answers to a session', /requireCaller\(req, admin\)/.test(route))
ok('...and never to the cron secret', !/CRON_SECRET/.test(route))
ok('the morning run is still the one with the secret', /CRON_SECRET/.test(runner))

ok('only a held step may be released', /step\.state !== 'held'/.test(route))
ok('...and a notice already sent says so rather than going twice',
  /already gone out/.test(route))
ok('a run the account has left sends nothing more', /run\.state !== 'running'/.test(route))

/*
 * AND IT IS THE ACCOUNT'S OWN COLLECTOR, OR SOMEBODY WHO LEADS THE FLOOR. Not any pre-legal
 * agent, which is what the row-level policy alone would allow.
 *
 * READ FROM who.ts, WHERE THE RULE NOW LIVES. It moved out of this route when a second one began
 * asking the same question -- starting a workflow by hand -- because this exact rule has already
 * drifted once as a copy. Both halves are asserted: that the rule is right, and that this route
 * is the thing that calls it rather than keeping a version of its own.
 */
const who = read('api/_lib/workflow/who.ts')
ok('there is one rule about who may act on an account', /export async function mayActOnAccount/.test(who))
ok('...and this route asks it', /mayActOnAccount\(admin, caller\.id, run\.account_id\)/.test(route))
ok('...rather than keeping its own copy', !/async function mayRelease/.test(route))
ok('...the collector it is assigned to', /account\?\.assigned_to === userId/.test(who))
ok('...or a team leader', /'Pre-legal Team Leader'/.test(who))
ok('...and an agent who holds nothing is refused',
  /Boolean\(account\?\.assigned_to\) && account\?\.assigned_to === userId/.test(who))
/* A step with no assignee must not be released by anybody who happens to be an agent: the
   Boolean() guard is what stops null === null passing. */
ok('...with an unassigned account refused rather than open to all',
  /Boolean\(account\?\.assigned_to\)/.test(who))

/* ------------------------------------------------ the button */

ok('the panel offers to send a held step', /releaseStep\(session\.access_token, step\.id\)/.test(panel))
/*
 * AND IT SAYS WHAT PRESSING IT DOES. On a step waiting for a PERSON the person is the gate, so
 * "Send it now" is the truth. On a hold waiting for a FACT it is not, and pressing it asks again
 * -- so there it offers to try again, which is what happens.
 */
ok('...saying "Send it now" only where a person is what it waits for',
  /step\.needsRelease \? 'Send it now' : 'Try again'/.test(panel))
ok('...which means the panel knows which kind of hold it is',
  /needsRelease: Boolean\(s\.workflow_nodes\?\.needs_release\)/.test(store))
/* A run the account has already left sends nothing more, so it offers nothing. */
ok('no button on a run the account has left', /live=\{run\.state === 'running'\}/.test(panel))
/*
 * AND THE BROWSER DOES NOT WRITE THE ROW. Marking a step 'sent' from the client would mark it
 * sent and send nothing: the wording, the PDF, the fee and the Sent copy all happen on the
 * server. The step's state is the record of something that reached a debtor.
 */
ok('the browser never marks a step sent itself',
  !/from\('workflow_run_steps'\)[\s\S]{0,200}?update\(/.test(store))
ok('...it asks the endpoint', /fetch\('\/api\/workflow\/release'/.test(store))
/*
 * A RELEASE THAT HOLDS AGAIN SAYS SO, AND SAYS IT ONCE.
 *
 * The reason printed twice, in the same words, under the same card: once as the reason stored on
 * the step and once as the answer the attempt came back with. Holding again for the same reason
 * is the ORDINARY case, so that is what the firm saw, and they asked whether it was a bug. It
 * was. The reason above is refreshed from the database, so all this line adds is that the
 * attempt happened and whether the answer moved.
 */
ok('a release that holds again reports the attempt', /kind: 'held', changed:/.test(panel))
ok('...and does not print the reason a second time',
  !/setSaid\(out\.note/.test(panel) && !/\{said\}<\/p>/.test(panel))
ok('...saying plainly that nothing moved',
  /the reason above has not changed/.test(panel))
ok('...and pointing at it when it did', /the reason above is new/.test(panel))
/*
 * COMPARED AGAINST THE REASON AS IT WAS BEFORE THE ATTEMPT. By the time the answer is in hand,
 * onSent has refreshed step.note to that same answer -- so a comparison against the refreshed
 * note reads "the same" every time, including on the attempt that changed it, which is the one
 * worth pointing at. Asserted on the read happening BEFORE the request, not merely existing.
 */
const beforeAt = panel.indexOf("const before = (step.note ?? '').trim()")
const askAt = panel.indexOf('await releaseStep(session.access_token, step.id)')
ok('the old reason is read at all', beforeAt > 0)
ok('...and the request is there to order it against', askAt > 0)
ok('...and it is read before the request, not after', beforeAt > 0 && beforeAt < askAt)
/* A failed REQUEST is not a reason a step holds, and is not on the card above, so it is still
   printed in full. */
ok('a request that failed outright still says what went wrong',
  /kind: 'error', text: e instanceof Error/.test(panel))

/* ------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-release-step: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
