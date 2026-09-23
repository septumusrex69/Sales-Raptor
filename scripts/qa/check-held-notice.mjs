/**
 * TELLING SOMEBODY A NOTICE DID NOT GO OUT — ONCE, AND TO A SCREEN THAT SHOWS IT.
 *
 * The runner holds a step and writes the reason onto it. That is correct and it is invisible:
 * nobody opens a workflow run to see what did not happen, so a section 129 could sit held for a
 * fortnight with the reason sitting in a column nobody reads.
 *
 * WHAT THIS GUARDS, and each of the three is its own way of being useless:
 *
 *   - A NOTIFICATION EVERY MORNING. A step waiting on a person waits every day until somebody
 *     releases it. Announced daily, the collector learns to clear the bell without reading it —
 *     on the one message that means a statutory demand has not gone out. CLAUDE.md: a warning
 *     that fires when nothing is wrong is worse than no warning.
 *   - A NOTIFICATION NOBODY CAN ACT ON. A hold looked at once and never again means filling in
 *     the listing reference changes nothing and the notice never goes. Held steps are asked
 *     again every morning, which is what makes "go and fill this in" a true instruction.
 *   - A NOTIFICATION POINTING AT NOTHING. It links to the account, and until the panel existed
 *     the account said nothing whatever about the run. "Go here and fix it" with nothing there
 *     is the same fault as the warning that fires for no reason.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-held-notice.mjs
 */
import { readFileSync, existsSync } from 'node:fs'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
/* Defensive: absence is one of the things broken here, and a missing file must fail the
   assertion that wanted it rather than the whole check. */
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

/*
 * IMPORTED DYNAMICALLY, INSIDE A TRY, because whether this file can be imported AT ALL is one of
 * the things asserted below. Held apart from accountRun.ts so a check can run its rules rather
 * than pattern-match them; put back beside the Supabase client it stops resolving here, and as a
 * STATIC import that killed the whole check with a stack trace instead of failing the assertion
 * that exists to catch it.
 */
let RUN_STEP_WORDS = {}
let needsAttention = () => []
let vocabularyLoaded = false
try {
  const m = await import('../../src/lib/runSteps.ts')
  RUN_STEP_WORDS = m.RUN_STEP_WORDS
  needsAttention = m.needsAttention
  vocabularyLoaded = true
} catch { /* reported below, rather than thrown */ }

/*
 * THE CRON HANDLER AND THE STEP MACHINERY, READ TOGETHER, because together they are what the
 * morning run is. The per-step work was lifted into step.ts when the release button needed to
 * take exactly the same path -- one runOneStep, so the wording, the fee, the Sent copy and the
 * record are identical whether a notice went out at six in the morning or because somebody
 * pressed a button. The rules below are unchanged; only which file holds them moved.
 */
const runner = read('api/_lib/workflow/run.ts')
  + read('api/_lib/workflow/step.ts')
const notify = read('api/_lib/workflow/notify.ts')
const panel = read('src/components/collections/WorkflowRunPanel.tsx')
const store = read('src/lib/accountRun.ts')
const words = read('src/lib/runSteps.ts')
const account = read('src/pages/accounts/AccountDetail.tsx')

/* Asserted present before anything about their contents, or deleting a file passes vacuously. */
ok('the notifier exists', notify.length > 0)
ok('the step vocabulary can be imported by a check at all', vocabularyLoaded)
ok('the panel exists', panel.length > 0)
ok('the account screen draws it', /<WorkflowRunPanel/.test(account))
ok('...and it is actually in the layout, not merely defined',
  /side=\{\[[^\]]*workflowPanel/.test(account))

/* ------------------------------------------------ once, not every morning */

/*
 * THE REASON IS WRITTEN EVERY TIME; ONLY A CHANGE IS ANNOUNCED. The step is the record and the
 * notification is the interruption, and they are not the same thing.
 */
ok('the reason is written onto the step whenever it holds',
  /update\(\{ state: 'held', note \}\)/.test(runner))
ok('a standing hold is not announced again',
  /const isNews = step\.state !== 'held' \|\| step\.note !== note/.test(runner))
ok('...and nobody is told unless it is news', /if \(!isNews\) return \{ result: 'stillHeld'/.test(runner))
ok('...while a new or changed reason is', /notifyHeld\(admin, \{ \.\.\.about, reason: note \}\)/.test(runner))
/*
 * COUNTED APART IN THE RESULT. A run reporting "held: 40" every morning reads as forty things
 * going wrong daily; forty standing holds and two new ones is the true shape of a floor.
 */
ok('a standing hold is counted apart from a new one', /stillHeld: 0/.test(runner))
ok('...and is kept out of the notes the run reports',
  /what\.result !== 'stillHeld'/.test(runner))

/* ------------------------------------------------ so that acting on it works */

/*
 * HELD STEPS ARE ASKED AGAIN. This is what turns the message into an instruction: fill in the
 * listing reference today and the notice goes tomorrow, with nobody having to find the step.
 */
ok('held steps are reconsidered, not only pending ones',
  /\.in\('state', \['pending', 'held'\]\)/.test(runner))
/*
 * AND FAILED ONES ARE NOT. That is a provider refusal rather than something the account is
 * missing, and quietly retrying a message the network rejected is how a debtor gets four copies.
 */
/*
 * SLICED TO THE DUE QUERY, because 'failed' appears legitimately elsewhere: the "is this run
 * finished" check asks whether anything is still pending, held OR failed, and a failed step
 * rightly keeps a run open. Written as a search over the whole file this reported the correct
 * line as the fault.
 */
const dueQuery = runner.slice(
  runner.indexOf("from('workflow_run_steps')"),
  runner.indexOf('.limit(200)'),
)
ok('the due query is the one being read', dueQuery.includes(".in('state'"))
ok('...but a failed send is never retried on a timer', !dueQuery.includes("'failed'"))
/*
 * A STATUTORY STEP STILL WAITS. planSend refuses a needsRelease step every time it is asked, so
 * re-asking cannot send a section 129 nobody released. Asserted on the runner's own note, because
 * this is the property that makes re-asking safe rather than reckless.
 */
ok('re-asking is safe because the decision is planSend’s, not the runner’s',
  /if \(!plan\.can\) return hold\(plan\.note/.test(runner))

/* ------------------------------------------------ who is told */

ok('the collector is told', /out = new Set<string>\(\[collector\.id as string\]\)/.test(notify))
ok('...and their own team’s leader with them',
  /eq\('team_id', collector\.team_id\)\.eq\('role', 'Pre-legal Team Leader'\)/.test(notify))
/*
 * NOT EVERY LEADER IN THE FIRM. Five pre-legal teams carry one leader each; fanning out would put
 * five notifications on the floor for one account nobody else can act on. Measured on staging:
 * an agent with a team has exactly one leader, so two people are told.
 */
ok('...and not every leader in the firm', /collector\.team_id/.test(notify))
/*
 * ADMINISTRATORS ARE NOT TOLD. canLeadCollections includes them because they may SEE the floor's
 * work; being shown it is not the same as being handed it every morning.
 */
ok('administrators are not handed the floor’s holds', !/'Administrator'/.test(notify))
/*
 * THE ONE FAN-OUT, DELIBERATELY. An account with nobody assigned has no collector to tell and no
 * team to find a leader in -- and it is the case a leader most needs to hear about, because a
 * live workflow on an unassigned account sends nothing at all until somebody is given it.
 */
ok('an unassigned account reaches the leaders instead',
  /if \(!collectorId\) \{[\s\S]{0,300}?eq\('role', 'Pre-legal Team Leader'\)/.test(notify))

/* A notification that cannot be raised must not fail the morning's sends. */
ok('a notification that cannot be raised does not stop the run',
  /return error \? 0 : audience\.length/.test(notify))

/* ------------------------------------------------ pointing somewhere real */

ok('the notification links to the account', /link: `\/accounts\/\$\{notice\.accountId\}`/.test(notify))
/*
 * AND THE ACCOUNT SHOWS THE HOLD. Both halves, because either one alone is the fault: the panel
 * must read the steps, and it must put the reason on the screen rather than only the state.
 */
ok('the panel reads the run’s steps', /workflow_run_steps\(/.test(store))
ok('...including the reason it is held', /note: s\.note \?\? null/.test(store))
/* The held card became its own component when the release button went on it, so the step is
   named `step` there rather than `s`. Asserted on the rule -- the note is rendered -- rather
   than on whichever identifier the component happens to use. */
ok('...and prints that reason, not just a state', /\{(s|step)\.note\}/.test(panel))
/*
 * LIFTED OUT OF THE SEQUENCE. Left in the list with everything else, the one line that needs
 * doing reads as a row in a table.
 */
ok('what is waiting is shown before the rest of the run', /needsAttention\(run\.steps\)/.test(panel))
/* RUN, not read back as text: the vocabulary is held apart from the query precisely so a check
   can execute it rather than pattern-match the source. */
check('...and what needs a person is the held and the failed',
  needsAttention([
    { state: 'sent' }, { state: 'pending' }, { state: 'held' },
    { state: 'failed' }, { state: 'cancelled' },
  ]).map((s) => s.state).sort(), ['failed', 'held'])

/*
 * NOTHING AT ALL WHERE THERE IS NO RUN. An empty "Workflow" card on every account in the book
 * pushes the figures down the page in order to say nothing.
 */
ok('the panel draws nothing on an account with no run',
  /if \(runs === null \|\| \(runs\.length === 0 && !error\)\) return null/.test(panel))

/* ------------------------------------------------ the firm's words */

/*
 * THE STATE VOCABULARY IS THE FIRM'S, NOT THE COLUMN'S. `held` describes how a row got into that
 * state; "Waiting on you" is what the collector needs to know. CLAUDE.md's first rule.
 */
check('every state a step can be in has a word for it',
  Object.keys(RUN_STEP_WORDS).sort(),
  ['cancelled', 'failed', 'held', 'pending', 'sent'])
check('held reads as what it is', RUN_STEP_WORDS.held?.label ?? null, 'Waiting on you')
check('...and failed does not read as the same thing', RUN_STEP_WORDS.failed?.label ?? null, 'Did not send')
/*
 * THE TWO THAT DESCRIBE THE ROW RATHER THAN THE WORK. "Sent" and "Cancelled" are the firm's word
 * and the column's at once, which is fine -- there is nothing to translate. `held` and `pending`
 * are the ones that say how a row got into a state and nothing about what to do with it, and
 * those are the two this insists are rewritten.
 */
for (const key of ['held', 'pending']) {
  /* `?.` because the vocabulary may not have loaded at all -- see the dynamic import above. An
     unreadable label must fail this assertion, not throw underneath it. */
  ok(`${key} is not shown to anybody as "${key}"`,
    (RUN_STEP_WORDS[key]?.label ?? key).toLowerCase() !== key)
}
/* And the two that need a person are the two that read as attention. */
check('the two that need somebody are the two marked for attention',
  Object.entries(RUN_STEP_WORDS).filter(([, v]) => v.tone === 'attention').map(([k]) => k).sort(),
  ['failed', 'held'])

/*
 * AND THE DAY NUMBER CARRIES ITS UNIT HERE TOO. This is the screen where somebody checks what
 * actually happened against what was meant to, so a business-day number read as calendar days is
 * a fortnight out on exactly the comparison it exists for.
 */
ok('the panel labels its day numbers with the unit', /dayLabel\(step\.day, run\.dayUnit\)/.test(panel))
ok('...read off the run’s own version', /dayUnit: \(r\.workflow_versions\?\.day_unit/.test(store))

/* ------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-held-notice: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
