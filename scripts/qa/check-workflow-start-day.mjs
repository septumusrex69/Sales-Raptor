/**
 * THE DAY A WORKFLOW'S FIRST NOTICE ACTUALLY GOES, AND THE SENTENCE THAT SAYS SO.
 *
 * THE FIRM STARTED A SECTION 129 ON A SUNDAY AND NOTHING WENT OUT: "it said it started, but when
 * is it going to send out the SMS and the letter? I thought it does that immediately." The button
 * had told them, in so many words, that the first step went out now.
 *
 * THE DATES WERE RIGHT AND THE SENTENCE WAS WRONG, and that distinction is the whole reason this
 * file exists. The section 129 sequence counts in BUSINESS days; `landsOn` normalises a start that
 * lands on a weekend forward to the Monday; day 1 of that chart IS the demand; and the release
 * guard refuses a step before its `due_on`, because "sent early" on a statutory interval is a
 * misrepresentation. Making it send on the Sunday to satisfy the button would break the one rule
 * the dates exist to keep. So the button says when instead.
 *
 * WHAT WOULD BREAK IF THIS WENT UNCHECKED is a screen that promises a debtor has been written to
 * when they have not — which on a section 129 is the date an attorney will ask about.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-workflow-start-day.mjs
 */
import { readFileSync } from 'node:fs'
import { firstStepOn, startSentence, startShortLabel, weekdayName } from '../../src/lib/workflowStart.ts'
import { landsOn } from '../../src/lib/workflowBuilder.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
/* Comments carry the firm's words, and their words include the sentences under test. Stripped so
   a quotation in a comment cannot stand in for the code that has to say it. */
const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* ---------- the arithmetic ---------- */

/*
 * 2026-09-27 IS THE SUNDAY THE FIRM PRESSED IT. 28 September is the Monday, and 24 September is
 * Heritage Day — a public holiday on a Thursday, which is what makes "weekend" the wrong word for
 * what this is guarding.
 */
const SUNDAY = '2026-09-27'
const MONDAY = '2026-09-28'
const HERITAGE = '2026-09-24'
const WEDNESDAY = '2026-09-30'

/*
 * DAY 1 IS THE DAY IT STARTS, INCLUDING A SUNDAY, and that is the firm's own correction after
 * watching a section 129 start on one: "if you issue the section 129, it should be done
 * immediately. Shouldn't wait one day."
 *
 * WHY DAY 1 AND NOTHING ELSE. Every other day on the chart is an OFFICE day -- a clerk acts, a
 * notice leaves a working mailbox, a period runs. Day 1 is the PRESS, and the firm's rule for this
 * sequence is that the press IS the issuing. Normalising it forward made the system wait a day to
 * do the thing the person had just done.
 */
check('a business day 1 pressed on a Sunday is that Sunday',
  firstStepOn(SUNDAY, 1, 'business'), SUNDAY)
check('...and on a working day it is still that day',
  firstStepOn(WEDNESDAY, 1, 'business'), WEDNESDAY)
check('...and on a public holiday it is that holiday',
  firstStepOn(HERITAGE, 1, 'business'), HERITAGE)
/*
 * AND EVERY LATER DAY IS STILL AN OFFICE DAY, counted off the first working day on or after the
 * start -- so every interval keeps the length it had and only the FIRST date moved. These four are
 * the dates the firm was looking at on their own screen when they asked for this.
 */
check('day 7 off a Sunday press is unchanged', firstStepOn(SUNDAY, 7, 'business'), '2026-10-06')
check('...and day 12', firstStepOn(SUNDAY, 12, 'business'), '2026-10-13')
check('...and day 39, the credit bureau listing', firstStepOn(SUNDAY, 39, 'business'), '2026-11-19')
check('...and day 49, the intended summons', firstStepOn(SUNDAY, 49, 'business'), '2026-12-03')
/*
 * A PUBLIC HOLIDAY IS SKIPPED FOR THE LATER DAYS TOO, not only a weekend: Heritage Day 2026 is a
 * Thursday, and a check written against Saturdays alone would pass on code that ignored holidays.
 *
 * AND THIS IS WHERE THE SEAM SHOWS, so it is asserted rather than left to be discovered. Pressed on
 * Heritage Day, day 1 is the Thursday (the press) and day 2 is the MONDAY -- the Friday belongs to
 * no day number at all. That gap is the price of keeping every later interval exactly where the
 * firm charted it: day 2 counts off the first working day as it always did, so days 7, 12, 39 and
 * 49 have not moved by an hour. Making day 2 the Friday instead would pull the whole statutory
 * chart a day earlier, which is not what was asked for and not something to do by accident.
 *
 * IN PRACTICE THERE IS NO SEAM: a press on a working day has day 1 and day 2 adjacent, as before.
 */
check('day 2 off a public holiday is the next working day after it',
  firstStepOn(HERITAGE, 2, 'business'), '2026-09-28')
check('...and day 2 off an ordinary Wednesday is the Thursday',
  firstStepOn(WEDNESDAY, 2, 'business'), '2026-10-01')
/* Calendar day 0 is the day it starts, unchanged, which is what every workflow drawn before the
   unit existed meant. */
check('a calendar day 0 is today, weekend or not', firstStepOn(SUNDAY, 0, 'calendar'), SUNDAY)
check('...and a calendar day 5 is five days later', firstStepOn(SUNDAY, 5, 'calendar'), '2026-10-02')

/*
 * THE SAME landsOn THE PLANNER USES, not a second opinion about the same date. Written out twice
 * the failure is a button that promises Monday for a notice the planner dates Tuesday.
 */
for (const [from, day, unit] of [[SUNDAY, 1, 'business'], [HERITAGE, 7, 'business'], [SUNDAY, 12, 'calendar']]) {
  check(`firstStepOn is landsOn (${from} ${unit} ${day})`,
    firstStepOn(from, day, unit), landsOn(from, day, unit))
}

check('a weekday has its name', weekdayName(MONDAY), 'Monday')
check('...and a Sunday is a Sunday', weekdayName(SUNDAY), 'Sunday')

/* ---------- the sentence ---------- */

const now = startSentence(WEDNESDAY, WEDNESDAY, 'business')
ok('on a working day it says the first step goes out now', /first step goes out now/.test(now))
/* The other half of what the press does, which the panel used to carry and must not lose: the
   steps that assert something has already happened still wait for a person. */
ok('...and that the later steps still wait for you', /still wait for you/.test(now))

/*
 * A BUSINESS CHART WHOSE FIRST STEP IS DAY 1 CAN NO LONGER REACH THIS WORDING, because day 1 is now
 * the press. It is still reached by a chart whose first step is day 2 or later, and by a calendar
 * chart that starts later, so the sentence is kept and tested rather than deleted along with the
 * one case that used to produce it.
 */
const shut = startSentence(SUNDAY, MONDAY, 'business')
ok('on a Sunday it does not say anything goes out now', !/goes out now/.test(shut))
ok('...it says nothing goes out today', /Nothing goes out today/.test(shut))
/*
 * WITH THE DATE IN IT. "Not today" is the complaint the firm already made; a date is the answer to
 * it. Both the weekday and the date, because "Monday" alone on a Sunday evening is ambiguous the
 * moment somebody reads the screen on Tuesday.
 */
ok('...naming the weekday', /Monday/.test(shut))
ok('...and the date', /28 Sep 2026/.test(shut))
ok('...and why, in the firm’s unit', /business\s+days/.test(shut))

/*
 * AND WHAT HAPPENS ON THAT MORNING, WHERE THE FIRST STEP WAITS FOR A PERSON.
 *
 * THE START PRESS LIFTS `needsRelease` FOR WHAT IS DUE THAT DAY and on a Sunday nothing is due, so
 * nothing is lifted: the Monday sweep finds a statutory demand that waits for a person and holds it
 * for a press. Left unsaid, "it starts on Monday" reads as "it sends on Monday" -- the same
 * misreading the rest of this sentence exists to stop, moved three days along.
 */
const held = startSentence(SUNDAY, MONDAY, 'business', true)
ok('a first step that waits for a person says so', /waits for a person/.test(held))
ok('...and says it will be there to send', /that morning to send/.test(held))
/* NOT ADDED WHERE IT IS NOT TRUE. Every day 1 the firm has drawn needs a release; a version whose
   first step does not must not have a press promised on it. */
ok('...and nothing of the sort where it does not',
  !/waits for a person/.test(startSentence(SUNDAY, MONDAY, 'business', false)))
/* NOR ON THE DAY IT ACTUALLY GOES: the press that starts it IS the release for that day. */
ok('...nor on a working day, when the press is the release',
  !/waits for a person/.test(startSentence(WEDNESDAY, WEDNESDAY, 'business', true)))

/*
 * A CHART THAT SIMPLY STARTS LATER IS A THIRD FACT, not a softer wording of the second. A calendar
 * version whose first step is day 30 is not waiting for the office to open, and describing it as
 * "the office is shut" would be a plain untruth on a Wednesday.
 */
const later = startSentence(WEDNESDAY, '2026-10-30', 'calendar')
ok('a chart whose first step is dated later says so', /dated Friday 30 Oct 2026/.test(later))
ok('...without blaming the office being shut', !/office is shut/.test(later))
ok('...and without claiming anything goes now', !/goes out now/.test(later))

/* ---------- the short label ---------- */

/*
 * THE FIRM PUT THE BUTTON IN THE ACTION ROW: "129, promise to pay and escalate is kind of like,
 * it's three workflows actually, so they should be together." The row's labels are two words and
 * the workflow is called "Section 129 / letter of demand".
 */
check('the row’s label is the name before the slash',
  startShortLabel('Section 129 / letter of demand'), 'Section 129')
/* NOTHING ELSE IS TRIMMED. Guessing which words of somebody else's title are surplus is how a
   button ends up saying something the Library does not. */
check('...and a name with no slash is left alone',
  startShortLabel('Promise to pay'), 'Promise to pay')
check('...even a long one', startShortLabel('Notice of intention to list with the credit bureaux'),
  'Notice of intention to list with the credit bureaux')
/* A name that is nothing but a slash would otherwise label the button with an empty string. */
check('...and an empty head falls back to the whole name', startShortLabel('/ demand'), '/ demand')

/* ---------- where it is used ---------- */

const store = read('../../src/lib/accountRun.ts')
const panel = read('../../src/components/collections/WorkflowRunPanel.tsx')
const detail = read('../../src/pages/accounts/AccountDetail.tsx')
const api = read('../../api/_lib/workflow/start.ts')
const lib = read('../../src/lib/workflowStart.ts')

ok('there is a start-words library to read', lib.length > 1500)

/*
 * THE OFFER CARRIES THE DATE, which means reading the version's unit and its nodes' day numbers.
 * Assumed rather than read, a version whose first step is day 3 would have a button under it
 * saying the demand goes out today.
 */
ok('the offer reads the version’s day unit', /day_unit/.test(store))
ok('...and the day numbers on its nodes', /workflow_nodes\(day, needs_release\)/.test(store))
ok('...and works out when the first step would go', /firstStepOn\(today, first, unit\)/.test(store))
ok('...from the lowest day on the chart, not an assumed one', /Math\.min\(\.\.\.days\)/.test(store))
/* ANY NODE ON THE FIRST DAY, not all of them: day 1 of the section 129 is the letter and the SMS
   together, and a day where one of the two needs a press is still a day that ends in a press. */
ok('...and whether that day waits for a person',
  /nodes\.some\(\(n\) => n\.day === first && n\.needs_release\)/.test(store))
ok('...which it reads off the nodes', /workflow_nodes\(day, needs_release\)/.test(store))

/* ONE SENTENCE, TWO BUTTONS. The action row's button and the tab's card make the same promise; a
   promise written twice is a promise that drifts. */
ok('the panel’s question uses it',
  /startSentence\(todayIso\(\), offer\.firstStepOn, offer\.dayUnit, offer\.firstStepNeedsRelease\)/.test(bare(panel)))
ok('...and so does the action row’s button',
  /startSentence\(todayIso\(\), startable\[0\]\.firstStepOn, startable\[0\]\.dayUnit, startable\[0\]\.firstStepNeedsRelease\)/.test(bare(detail)))
/*
 * AND THE BUTTON SAYS THE SAME THING ITS SENTENCE DOES. "Yes, send it now" on a Sunday was the
 * other half of the lie, and it is the half somebody presses.
 */
ok('the confirm button reads on the day as well',
  /firstStepOn <= todayIso\(\) \? 'Yes, send it now' : 'Yes, start it'/.test(bare(panel)))

/*
 * THE ROW'S BUTTON DOES NOT CONFIRM IT ITSELF. The second press and its wording are legal wording;
 * asked in two places it becomes two wordings, and the day they differ is the day somebody sends a
 * notice on the strength of the softer one. So the row opens the tab's card.
 */
ok('the row’s button hands the press to the Workflow tab',
  /setTab\('Workflow'\); setAskStart/.test(bare(detail)))
ok('...and the card opens on it', /askingFor === w\.versionId/.test(bare(panel)))
ok('...and the request is cleared once taken', /onAsked\?\.\(\)/.test(bare(panel)))
/* SEVERAL ON OFFER IS A CHOICE, and a choice belongs where both are written out with the firm's
   own note under each — not as two more buttons in a row that already has ten. */
ok('one offer is labelled with its own name', /startShortLabel\(startable\[0\]\.name\)/.test(bare(detail)))
ok('...and several is one button to the tab', /startable\.length > 1/.test(bare(detail)))
/* NOTHING WHERE THERE IS NOTHING TO START: a permanently dashed "Section 129" on the thousands of
   accounts that have been through one is noise in the one row that must stay trustworthy. */
ok('...and none is no button at all', /startable\.length === 1/.test(bare(detail)))

/* THE SERVER SENDS BACK THE FACT, so a screen reports the run's own date rather than the button's
   guess where the press crossed midnight in Johannesburg. */
ok('the endpoint reports the day its first step is dated', /firstStepOn:/.test(bare(api)))
ok('...read back from what the planner wrote', /\.order\('due_on', \{ ascending: true \}\)\s*\n\s*\.limit\(1\)/.test(api))
ok('...and the browser carries it through', /firstStepOn: body\.firstStepOn/.test(bare(store)))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-workflow-start-day: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
