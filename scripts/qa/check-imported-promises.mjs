/**
 * A promise that came across from Swordfish is history, not a new arrangement.
 *
 * THE FIRM, after the test import sent four debtors a "confirmation of arrangement" -- and charged
 * them for it -- for promises made weeks earlier and already past their dates:
 *
 *   "if it's imported with a PTP workflow, it should continue with the workflow. But it's not
 *    necessary to send the emails and the SMSs ... It's like the arrangement that was."
 *
 * and, of the ones already past due: "it should just change the status to a broken promise ...
 * and then that person can filter it and allocate it themselves", rather than every one landing
 * in a collector's diary.
 *
 * So, held here:
 *   1. An "open" Swordfish promise already past its date comes in BROKEN (not defaulted, which
 *      would start the broken-promise workflow and write to the debtor), with a note saying why,
 *      and its account filed under 'Failed PTPs' so the Broken promises list finds it.
 *   2. One due today, or later, stays open.
 *   3. On an imported arrangement the promise workflow's confirmation is recorded as NOT SENT,
 *      dates already gone are not sent, and the dates still ahead -- including today -- are.
 *   4. A Raptor arrangement is unchanged, and only a PROMISE run is affected.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-imported-promises.mjs
 */
import { readFileSync } from 'node:fs'
import { readDebtorsPerClient } from '../../src/lib/swordfishDebtors.ts'
import { planRun } from '../../src/lib/workflowRun.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')

/* ---------- 1 and 2: what the import makes of Swordfish's promises ---------- */

/* 6 Oct 2026 at 08:00 in Johannesburg. */
const NOW = new Date('2026-10-06T06:00:00Z')
const row = (ref, status, due) => ({
  'Swordfish Reference': ref, 'Surname': 'Mokoena',
  'PTP Status': status, 'PTP Amount': '1000', 'PTP Due Date': due, 'PTP Creation Date': '2026-08-20',
})
const d = readDebtorsPerClient([
  row('A/1', 'Pending', '2026-09-30'),   // open in Swordfish, a week gone
  row('A/2', 'Late', '2026-10-04'),      // Swordfish's own "late" -- also gone
  row('A/3', 'Pending', '2026-10-06'),   // due today
  row('A/4', 'Pending', '2026-10-20'),   // still ahead
  row('A/5', 'Failed', '2026-08-31'),    // Swordfish already called it broken
], NOW)
const p = (ref) => (d.promisesByRef.get(ref) ?? [])[0]

check('an open promise already past its date comes in broken', p('A/1')?.status, 'broken')
check("...and so does one Swordfish called 'Late'", p('A/2')?.status, 'broken')
/* BROKEN, NOT DEFAULTED: defaulted starts the broken-promise workflow, which writes to the debtor. */
ok('...never as defaulted', ![p('A/1')?.status, p('A/2')?.status].includes('defaulted'))
ok('...with a note saying why', /Still open in Swordfish, but due on 2026-09-30 -- before it came across on 2026-10-06/
  .test(p('A/1')?.notes ?? ''))
check('...and its account filed under Failed PTPs, where the Broken promises list looks',
  d.patches.get('A/1')?.bucket, 'Failed PTPs')
check('one due today stays open', p('A/3')?.status, 'open')
check('...and is filed nowhere new', d.patches.get('A/3')?.bucket, undefined)
check('one still ahead stays open', p('A/4')?.status, 'open')
check("one Swordfish had already broken stays as it was", p('A/5')?.status, 'broken')
check('...and is not re-filed by this rule', d.patches.get('A/5')?.bucket, undefined)
check('the import counts them', d.stats.promisesPastDue, 2)
ok('...and says so on the review screen', d.notes.some((n) => /2 of them were still open in Swordfish but already past their date/.test(n)))

/* ---------- 3: the promise workflow on an imported arrangement ---------- */

const node = (over) => ({
  id: over.id, day: over.day ?? 0, ordinal: over.ordinal ?? 0,
  needsRelease: false, statutory: false,
  anchor: over.anchor ?? 'run', anchorOffset: over.anchorOffset ?? null, anchorUnit: over.anchorUnit ?? null,
})
/* The firm's promise workflow as it stands on staging: confirmation on the day, a reminder two
   working days before each instalment, a message on the day. */
const NODES = [
  node({ id: 'conf-email', ordinal: 0 }),
  node({ id: 'conf-sms', ordinal: 1 }),
  node({ id: 'rem-email', ordinal: 2, anchor: 'instalment', anchorOffset: -2, anchorUnit: 'business' }),
  node({ id: 'due-email', ordinal: 4, anchor: 'instalment', anchorOffset: 0, anchorUnit: 'business' }),
]
/* Imported on Tue 6 Oct: one instalment gone (30 Sep), one today, one ahead (20 Oct). */
const INSTALMENTS = [
  { no: 1, amount: 1000, dueOn: '2026-09-30' },
  { no: 2, amount: 1000, dueOn: '2026-10-06' },
  { no: 3, amount: 1000, dueOn: '2026-10-20' },
]
const imported = planRun({
  nodes: NODES, dayUnit: 'calendar', startedOn: '2026-10-06', instalments: INSTALMENTS, arrangementFromImport: true,
})
const step = (plan, id, no = 0) => plan.find((s) => s.nodeId === id && s.instalmentNo === no)

check('imported: the confirmation is not sent', step(imported, 'conf-email')?.state, 'cancelled')
check('...nor its SMS', step(imported, 'conf-sms')?.state, 'cancelled')
ok('...and the chart says why', /made in Swordfish and confirmed to the debtor then/.test(step(imported, 'conf-email')?.note ?? ''))
check('imported: a date already gone is not sent', step(imported, 'due-email', 1)?.state, 'cancelled')
ok('...and says it passed before the arrangement came across',
  /already passed when the arrangement came across from Swordfish/.test(step(imported, 'due-email', 1)?.note ?? ''))
/* NOTHING CONFIRMED IT TODAY, so "due today" is news rather than a third message. */
check('imported: a payment due on the import day still gets its message', step(imported, 'due-email', 2)?.state, 'pending')
check('imported: the dates ahead carry on -- the reminder', step(imported, 'rem-email', 3)?.state, 'pending')
check('...and the day itself', step(imported, 'due-email', 3)?.state, 'pending')
ok('the workflow continues: its steps are all still on the plan', imported.length === 2 + 3 * 2)

/* ---------- 4: nothing else changed ---------- */

const raptor = planRun({ nodes: NODES, dayUnit: 'calendar', startedOn: '2026-10-06', instalments: INSTALMENTS })
check('a Raptor arrangement still sends its confirmation', step(raptor, 'conf-email')?.state, 'pending')
/* The firm's earlier ruling stands for a Raptor arrangement: due the day it is agreed, the
   confirmation already says so. */
check('...and still skips a due-today message the confirmation already covered', step(raptor, 'due-email', 2)?.state, 'cancelled')

/* ONLY A PROMISE RUN, AND ONLY ON A SWORDFISH ARRANGEMENT -- a section 129 started on the same
   account must still send its day 1. Read off the planner, which is the only place the flag is set. */
const plan = strip(readFileSync(new URL('../../api/_lib/workflow/plan.ts', import.meta.url), 'utf8'))
ok('the planner reads the version trigger', /select\('id, day_unit, trigger_kind'\)/.test(plan))
ok("...sets the flag only for a promise run on a Swordfish arrangement",
  /arrangementFromImport = isPromiseRun && live\?\.source === 'swordfish'/.test(plan)
    && /const isPromiseRun = version\.trigger_kind === 'promise_due'/.test(plan))
ok('...reads the live arrangement the same way liveArrangement does',
  /\.filter\(\(p\) => p\.status === 'open' \|\| p\.status === 'defaulted'\)/.test(plan))
ok('...and hands it to planRun', /instalments,\s*arrangementFromImport,\s*\}\)/.test(plan))

console.log(`\ncheck-imported-promises: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
