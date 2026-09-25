/**
 * STARTING A WORKFLOW BY HAND — WHAT THE SERVER REFUSES, AND WHAT IT SENDS.
 *
 * THE FIRM, ON THE SECTION 129: "the moment the section 129 is sent out via email, that is when
 * the workflow is triggered." Until this route there was no second way into a workflow at all:
 * the only thing in the system that ever created a run was workflow_start_on_allocation, the
 * database trigger the handover runs on. So the eleven steps of the section 129 sequence were
 * written, dated in business days, and unreachable.
 *
 * WHAT THIS FILE IS FOR IS THE REFUSALS. Issuing a statutory demand is not undoable — an email in
 * somebody's inbox, an SMS on their phone, a fee on the account and the start of a clock the NCA
 * measures — so every gate in front of it is worth holding up by name, and each one is here
 * because leaving it out would send a demand that should not have gone.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-workflow-start.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

const start = read('../../api/_lib/workflow/start.ts')
const route = read('../../api/workflow/[action].ts')
const release = read('../../api/_lib/workflow/release.ts')
const who = read('../../api/_lib/workflow/who.ts')
const store = read('../../src/lib/accountRun.ts')
const panel = read('../../src/components/collections/WorkflowRunPanel.tsx')

/* Asserted present before anything about their contents, or a deleted file passes vacuously. */
ok('there is a start route to read', start.length > 2000)
ok('...and it is wired into the one workflow function', /run, release, start,/.test(route))
/*
 * ONE FILE FOR ALL THREE ROUTES. Vercel's Hobby plan counts FILES: its own endpoint would cost a
 * twelfth of the deployment for a route that shares everything with the two beside it.
 */
ok('...without adding a serverless function to do it',
  /import start from '\.\.\/_lib\/workflow\/start\.js'/.test(route))

/* ------------------------------------------------ who may */

/*
 * A SESSION, NEVER THE CRON SECRET. Nothing about issuing a demand is scheduled, and the run
 * records who decided the file was ready.
 */
ok('it answers to a person, not to the timer', /requireCaller\(req, admin\)/.test(start))
ok('...and never to the cron secret', !/CRON_SECRET/.test(start))
ok('...and refuses anything but a POST', /req\.method !== 'POST'/.test(start))

/*
 * THE SAME RULE AS RELEASING A HELD STEP, FROM ONE PLACE. This has already drifted once as a
 * copy: 'Call Centre Manager' was added to canLeadCollections and left out of the route's own
 * list, so the manager could lead the floor everywhere except where it mattered. Two callers is
 * where a copy becomes a divergence, so there is no copy.
 */
ok('the account rule lives in one file', /export async function mayActOnAccount/.test(who))
ok('...used by the start route', /mayActOnAccount\(admin, caller\.id, accountId\)/.test(start))
ok('...and by the release route', /mayActOnAccount\(admin, caller\.id, run\.account_id\)/.test(release))
ok('...with no second copy left behind in either',
  !/async function mayRelease/.test(release) && !/profile\.role === 'Administrator'/.test(start))
/* And the rule itself is still the narrow one: the collector holding it, or somebody who leads. */
ok('the rule is the collector holding it, or a leader',
  /account\?\.assigned_to === userId/.test(who)
  && /'Call Centre Manager'/.test(who) && /'Pre-legal Team Leader'/.test(who))

/* ------------------------------------------------ what it refuses */

/*
 * A DRAFT IS BEING ARGUED ABOUT. What a file went through is a question an attorney asks eighteen
 * months later, and a draft can still have its wording, its days and its steps changed under it.
 */
ok('a draft cannot be started on a file', /version\.state !== 'active'/.test(start))
ok('...and says how to make it startable', /Publish it in the Library/.test(start))

/*
 * ONLY A WORKFLOW THAT WAITS FOR A PERSON. One that starts on an event starts itself in the
 * database; offering both would give an account two runs of one sequence.
 */
ok('only a by-hand workflow may be started by hand', /version\.trigger_kind !== 'by_hand'/.test(start))

/*
 * ONCE PER ACCOUNT AND VERSION, EVER. Not "no second LIVE run", which the partial unique index
 * already enforces -- the same rule workflow_start_on_allocation states in SQL, for the same
 * reason: two statutory clocks on one debt.
 */
ok('an account is not put through the same workflow twice',
  /\.eq\('account_id', accountId\)\.eq\('version_id', versionId\)/.test(start))
ok('...said as what it would mean', /second clock on one debt/.test(start))

/*
 * THE TWO THAT TAKE AN ACCOUNT OUT OF A WORKFLOW, CHECKED ON THE WAY IN.
 *
 * workflow_exit_on_promise and workflow_exit_on_dispute fire when a promise or a dispute is
 * CREATED. They cannot see one that already exists, which is this order: starting a sequence on
 * an account that already has a live arrangement would issue a demand to somebody the firm has an
 * agreement with.
 */
ok('a live promise stops it', /\.from\('promises_to_pay'\)[\s\S]{0,120}?\.eq\('status', 'open'\)/.test(start))
ok('...in words that say what is there', /live promise to pay on this account/.test(start))
ok('an open dispute stops it',
  /\.from\('account_queries'\)[\s\S]{0,200}?\.eq\('kind', 'dispute'\)[\s\S]{0,80}?\.neq\('status', 'closed'\)/.test(start))
ok('...and says it has to be answered first', /answered before a demand goes out/.test(start))
/*
 * 'help' AND 'litigation' ARE NOT DISPUTES. account_queries carries all three because they need
 * the same queue -- but one is an agent asking a team leader what to do and the other is the firm
 * deciding to sue, and stopping the pre-legal sequence because somebody recommended suing is
 * precisely backwards. The schema says so about the exit trigger; the same reading applies here.
 */
ok('...but only a dispute, not a help or litigation query',
  !/kind', 'help'/.test(start) && !/kind', 'litigation'/.test(start))

/* ------------------------------------------------ what it does */

/*
 * THE FIRM'S DAY. The function runs in Paris and the firm is two hours ahead in winter; around
 * midnight the two disagree about the date, and started_on is what every step of the sequence is
 * counted from. Ten business days from the wrong day is the wrong day.
 */
ok('the run starts on the firm’s day, not the server’s', /todayInJohannesburg\(\)/.test(start))
ok('...and the run records who started it', /started_by: caller\.id/.test(start))
/* Dated by the app, because the working-day calendar is workingDays.ts and a second copy in SQL
   would be the one that is wrong about Heritage Day in the year nobody checks. */
ok('the steps are dated by the planner', /planUnplannedRuns\(admin, accountId\)/.test(start))

/*
 * AND THE FIRST STEP GOES IN THE SAME PRESS, which is the firm's whole sentence: the moment the
 * 129 is sent is when the workflow is triggered. Day 1 carries needs_release, and passing the
 * caller to runOneStep is what lifts that one refusal -- the person pressed a button that says
 * what it sends.
 */
ok('what is due today is sent now', /runOneStep\(admin, step, today, caller\.id\)/.test(start))
ok('...and only this run’s steps', /\.eq\('run_id', created\.id\)/.test(start))
/* A step due LATER is not dragged forward by the press. */
ok('...and only what has come due', /\.lte\('due_on', today\)/.test(start))
/*
 * THE LATER STATUTORY ONES STILL WAIT. Nothing here releases day 39 or day 49: the caller is
 * passed to runOneStep only for the steps due on the day the run starts, and those two are dated
 * weeks out. Asserted as the absence of any second pass over the run's steps.
 */
check('nothing releases the rest of the sequence',
  (start.match(/runOneStep\(/g) ?? []).length, 1)

/* ------------------------------------------------ the browser half */

/*
 * OFFERED ONLY WHERE IT WOULD BE ACCEPTED. A button that appears to work and is then refused is
 * worse than one that is not there, so the same three conditions are read in the browser: it is
 * published, it waits for a person, and this account has not been through it.
 */
ok('the offer is read from published workflows', /\.eq\('state', 'active'\)/.test(store))
ok('...that wait for a person', /\.eq\('trigger_kind', 'by_hand'\)/.test(store))
ok('...and not offered where the account has been through it', /!been\.has\(v\.id\)/.test(store))
/* The browser never writes the run: the wording, the PDF, the fee and the Sent copy all happen on
   the server, and a run inserted here would be a clock started against a notice nobody sent. */
ok('the browser asks the endpoint rather than writing the row',
  /fetch\('\/api\/workflow\/start'/.test(store))
ok('...and never inserts a run itself', !/from\('workflow_runs'\)[\s\S]{0,120}?insert\(/.test(store))

/*
 * ASKED TWICE, BECAUSE IT CANNOT BE UNDONE. And the second question says what will happen in the
 * firm's own words rather than "are you sure", which is a question nobody reads.
 */
ok('the panel asks before it sends', /const \[asking, setAsking\]/.test(panel))
ok('...saying what goes out now', /The first step goes out now/.test(panel))
ok('...and that the later ones still wait', /still wait for you/.test(panel))
ok('...with the firm’s own note on when to start it', /\{offer\.note\}/.test(panel))
/* The server's sentence, verbatim: "there is a live promise to pay on this account" says what to
   go and look at, and a generic failure sends somebody to ask somebody else. */
ok('a refusal is shown in the server’s own words', /\{failed\}/.test(panel))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-workflow-start: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
