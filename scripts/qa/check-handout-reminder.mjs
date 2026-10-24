/**
 * A BATCH NOBODY HANDED OUT IS SAID TO THE LIAISON AND THE LIAISON MANAGERS (S11).
 *
 * THE FIRM: "unhanded, handed out batches, I think that's still also with the liaison and the
 * liaison manager." The rule is src/lib/handoutReminder.ts; the morning run writes it
 * (api/_lib/workflow/handoutReminder.ts). Held here: when it is due, who hears, that it is said once
 * and closed when done, and that only the timer's morning sends it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-handout-reminder.mjs
 */
import { readFileSync } from 'node:fs'
import {
  handoutLink, handoutReminderDue, handoutReminderMessage, handoutReminderRecipients, handoutTaskTitle,
} from '../../src/lib/handoutReminder.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* WHEN: the first working morning after it came in -- the loader's own day is theirs to finish. */
ok('not on the day it came in', !handoutReminderDue('2026-10-22', '2026-10-22'))
ok('the next working morning', handoutReminderDue('2026-10-22', '2026-10-23'))
ok('a Friday batch is not late on Saturday', !handoutReminderDue('2026-10-23', '2026-10-24'))
ok('...nor on Sunday', !handoutReminderDue('2026-10-23', '2026-10-25'))
ok('...it is on Monday', handoutReminderDue('2026-10-23', '2026-10-26'))
ok('not on a public holiday (Christmas)', !handoutReminderDue('2026-12-24', '2026-12-25'))

/* WHO: the client's liaison and every Liaison Manager, each once; no liaison is the managers alone. */
check('the liaison and the managers', handoutReminderRecipients('bonnitta', ['nicole', 'x']), ['bonnitta', 'nicole', 'x'])
check('...once each, when the liaison IS a manager', handoutReminderRecipients('nicole', ['nicole']), ['nicole'])
check('...no liaison is the managers alone', handoutReminderRecipients(null, ['nicole']), ['nicole'])

/* WHAT: says how many, whose, and opens the hand-out. */
check('the task', handoutTaskTitle(12, 'Bonnitta Pharmacy'), 'Hand out 12 accounts: Bonnitta Pharmacy')
check('...one account', handoutTaskTitle(1, 'Bonnitta Pharmacy'), 'Hand out 1 account: Bonnitta Pharmacy')
ok('the message names the count, the total and the client',
  /^12 of 19 accounts from Bonnitta Pharmacy's batch BOP-1 are on nobody's desk/.test(handoutReminderMessage(12, 19, 'Bonnitta Pharmacy', 'BOP-1')))
check('it opens the batch\'s hand-out', handoutLink('h1'), '/accounts?handover=h1&handout=1')

/* THE WRITER: once per batch, closed when done, only from the timer, never fatal. */
const api = code('api/_lib/workflow/handoutReminder.ts')
ok('a batch already reminded is not reminded again', /handout_reminded_at/.test(api) && /!already\.has\(x\.handover_id\)/.test(api))
ok('...stamped only after the notification and the task went in',
  api.indexOf("update({ handout_reminded_at") > api.indexOf("from('tasks').insert") && api.indexOf("from('tasks').insert") > api.indexOf("from('notifications').insert"))
ok('a reminder task closes once nobody is left in the pile', /\.is\('assigned_to', null\)/.test(api) && /status: 'Completed'/.test(api))
ok('it reads the same batches the Data Import warning reads', /rpc\('unallocated_batches'/.test(api))
ok('the managers are the active Liaison Managers', /eq\('role', 'Liaison Manager'\)\.neq\('status', 'Inactive'\)/.test(api))
const run = code('api/_lib/workflow/run.ts')
ok('only the timer\'s morning sends it, after the sweep', /accountIds\.length === 0\s*\?\s*await remindUnallocatedBatches/.test(run)
  && run.indexOf('remindUnallocatedBatches(admin') > run.indexOf('await sweep(admin'))
ok('...and it cannot fail the sweep', /remindUnallocatedBatches\(admin, clock\.today, clock\.now\)\s*\.catch\(/.test(run))

/* THE COLUMNS EXIST. */
const schema = read('supabase/schema.sql')
ok('handovers.handout_reminded_at is in the schema', /alter table public\.handovers add column if not exists handout_reminded_at timestamptz/.test(schema))
ok('tasks.handover_id is in the schema', /alter table public\.tasks add column if not exists handover_id uuid;/.test(schema))

console.log(`\ncheck-handout-reminder: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
