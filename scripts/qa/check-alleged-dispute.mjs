/**
 * THE ALLEGED DISPUTE IS THREE DAYS LONG.
 *
 * THE FIRM: day 1 ask for it in writing with 48 hours to respond, day 3 remind with 24 hours, day
 * 4 deemed undisputed.
 *
 * WHAT IT WAS: day 1 with TEN BUSINESS DAYS to respond, day 6, day 10 "Last day", day 12 deemed
 * undisputed -- the better part of three weeks in which a section 129 sequence sits still because
 * somebody said on the telephone that they dispute the account.
 *
 * AND THE TEN DAYS WERE BORROWED. Ten business days is the SECTION 129's statutory period -- the
 * time the Act gives a debtor to refer the agreement to a debt counsellor or an ombud. Nothing in
 * the Act gives anybody ten days to put an alleged dispute in writing. It had been copied onto a
 * step that is not statutory at all, which is the kind of mistake that looks like care.
 *
 * WHAT THIS FILE CAN AND CANNOT SEE. The schedule lives in the DATABASE, so this holds the SQL
 * that puts it there -- the file the firm runs. It cannot say what is live on staging; the script
 * reads that back itself when it runs.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-alleged-dispute.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const sql = readFileSync(new URL('../../scripts/sql/alleged-dispute-three-days.sql', import.meta.url), 'utf8')

/* THE THREE DAYS THE FIRM NAMED, each asserted on its own: a single "contains 3 and 4" would pass
   on a file that had moved the wrong step. */
ok('the reminder moves to day 3', /set day = 3\s*\n\s*where version_id = v_draft and key like 'dispute-reminder-%'/.test(sql))
ok('deemed undisputed moves to day 4', /set day = 4\s*\n\s*where version_id = v_draft and key like 'dispute-undisputed-%'/.test(sql))
/* 48 AND 24 HOURS, IN THE UNIT THIS MODEL HAS. Day 1 + 2 = day 3 and day 3 + 1 = day 4, which is
   the arithmetic behind the firm's own day numbers. */
ok('the first notice gives two business days', /deadline_days = 2, deadline_unit = 'business'/.test(sql))
ok('...and the reminder one', /deadline_days = 1, deadline_unit = 'business'/.test(sql))
/* AND THE TEN DAYS ARE GONE. The assertion that matters most, because ten is the number that was
   wrong and it is the section 129's, not this sequence's. */
ok('nothing still gives ten days', !/deadline_days = 10/.test(sql))
/* THE "LAST DAY" PAIR GOES. There is no room for a third warning in three days. */
ok('the last-day steps are removed',
  /delete from public\.workflow_nodes\s*\n\s*where version_id = v_draft and key like 'dispute-final-reminder-%'/.test(sql))

/*
 * NEVER THE LIVE VERSION. Version 1 carries a run, and a debtor already on a sequence keeps the
 * schedule they started under -- the dates in a notice they have already been sent. Asserted as
 * presence before order, because indexOf returns -1 for something deleted and -1 beats everything.
 */
const draft = sql.indexOf('workflow_take_draft(v_active)')
const edit = sql.indexOf('delete from public.workflow_nodes')
const publish = sql.indexOf('workflow_publish(v_draft)')
ok('it takes a draft, edits it, then publishes',
  draft !== -1 && edit !== -1 && publish !== -1 && draft < edit && edit < publish)
/* AND IT TOUCHES NOTHING BUT THE DRAFT. A statement keyed on the active version would edit the
   sequence a debtor is on, which the database refuses -- and a check is cheaper than finding out. */
ok('...and every change is keyed on the draft',
  (sql.match(/version_id = v_draft/g) ?? []).length === 5
  && !/version_id = v_active/.test(sql))

/* SAFE TO RUN TWICE: take_draft returns the draft that already exists rather than making a second,
   and every statement is written to be true after it has run. */
ok('it says it is safe to run twice', /SAFE TO RUN MORE THAN ONCE/.test(sql))
/* AND IT READS BACK WHAT IT DID, like every other script the firm is asked to run. */
ok('...and reads back what is live afterwards', /order by n\.day, n\.ordinal;/.test(sql))

console.log(`\ncheck-alleged-dispute: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
