/**
 * A SECOND TRACE SAYS WHAT IT ACTUALLY FOUND, WHERE SOMEBODY IS READING IT.
 *
 * THE FIRM, looking at two reports on one subject: "if you upload a new trace, I see it shows the
 * new trace, but it's kind of the same data as the other one. So it should kind of show you, oh,
 * there's new information or there's not new information."
 *
 * EVERY PIECE OF THE COMPARISON WAS ALREADY WRITTEN. traceCompare has done it since the firm first
 * asked, and the account's trace panel renders a one-line summary of it. The modal -- which is
 * where somebody actually reads a trace -- showed nothing. So this is wiring, not arithmetic, and
 * what is asserted here is that the wiring exists and that it did not get the careful parts wrong.
 *
 * THE COUNT IS NOT THE ANSWER, which is the half worth having a check for. "4 new findings" still
 * leaves somebody reading thirty-eight rows to find the four.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-trace-compare-screen.mjs
 */
import { readFileSync } from 'node:fs'
import { compareTraceReports, comparisonLine, previousTraceFor, traceKey } from '../../src/lib/traceCompare.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')

const modal = code('src/pages/accounts/TraceWorkspaceModal.tsx')

/* ---------------------------------------------------------------------------------------------
 * THE MODAL SAYS WHAT THE REPORT BOUGHT
 * ------------------------------------------------------------------------------------------- */

ok('the trace itself compares against the one before it', /compareTraceReports\(trace\.items/.test(modal))
ok('...and says so in the firm s own sentence', /comparisonLine\(since\)/.test(modal))
/*
 * AGAINST THE SAME SUBJECT, never simply the report before it by date. A company account carries
 * one report for the company and one per director, so the previous trace is usually a different
 * PERSON -- and compared against that, every finding on both comes back as new, which is worse
 * than saying nothing. This is the assertion that matters most.
 */
ok('...read against the same subject', /previousTraceFor\(traces, trace\)/.test(modal))

/* AND NOTHING IS SAID WHERE THERE IS NO EARLIER REPORT. A first trace has nothing to compare
   with, and "0 new findings" against it would be a lie about what it found. */
ok('a first trace claims nothing', /since && earlier && \(/.test(modal))

/* ---------------------------------------------------------------------------------------------
 * AND MARKS WHICH ROWS THEY ARE
 * ------------------------------------------------------------------------------------------- */

ok('each finding knows whether it is new', /isNew=\{newKeys\?\.has\(/.test(modal))
ok('...and the row draws it', /\{isNew && \(/.test(modal))
/*
 * KEYED ON THE THING, NOT THE SPELLING. traceKey is what makes 082 123 4567 and 0821234567 one
 * finding; keyed on the raw value the badge would appear against every number on every re-trace,
 * which is the feature manufacturing the work it exists to save.
 */
ok('...matched on the number rather than how it was written', /traceKey\(row\.items\[0\]\.kind/.test(modal))
check('which is what traceKey does', traceKey('mobile', '082 123 4567'), traceKey('mobile', '0821234567'))

/* ---------------------------------------------------------------------------------------------
 * THE TAB SAYS WHICH REPORT IT IS, AND WHO IT IS ABOUT
 * ------------------------------------------------------------------------------------------- */

/*
 * TWO REPORTS ON ONE SUBJECT WERE IDENTICAL BUTTONS. That is the firm's complaint in its simplest
 * form: two tabs reading exactly the same words and no way to tell which was the new one.
 */
ok('a tab carries its report s date', /formatDate\(t\.enquiredOn \?\? t\.createdAt\)/.test(modal))
/*
 * AND THE BUG FOUND WHILE BUILDING IT. The tab read `subjectKind === 'director' ? 'Director' :
 * 'Company'`, so EVERY trace of the debtor was labelled Company whoever the debtor was -- the
 * firm's own screenshot shows "Stephan Ferreira · Company" against a thirteen-digit identity
 * number. Held as an absence as well as a presence: the old expression must not come back.
 */
ok('a consumer report is not called a company', /t\.reportKind === 'consumer' \? 'Person'/.test(modal))
ok('...and a commercial one still is', /t\.reportKind === 'commercial' \? 'Company'/.test(modal))
ok('...and nothing assumes the debtor is a company',
  !/subjectKind === 'director' \? 'Director' : 'Company'/.test(modal))

/* ---------------------------------------------------------------------------------------------
 * AND THE LIBRARY UNDERNEATH STILL SAYS WHAT IT SAID
 * ------------------------------------------------------------------------------------------- */

const I = (kind, value) => ({
  id: value, traceId: 't', accountId: 'a', kind, value, label: null,
  peopleLinked: null, seenOn: null, amount: null, status: null,
  outcome: null, outcomeAt: null, outcomeNote: null, promotedContactId: null,
})

const same = compareTraceReports([I('mobile', '082 123 4567')], [I('mobile', '0821234567')])
check('one number written two ways is not a new finding', same.added, 0)
check('...it is carried', same.carried, 1)
check('and nothing new is said out loud', comparisonLine(same),
  'Nothing on this report that the previous one did not already have. 1 was on the earlier one too.')

const found = compareTraceReports(
  [I('mobile', '0821234567'), I('mobile', '0839998888')], [I('mobile', '0821234567')],
)
check('a genuinely new number counts', found.added, 1)
ok('...and is said first', comparisonLine(found).startsWith('1 new finding on this report.'))

/* A DROPPED FINDING IS NOT A DEAD ONE. Bureaux age records out and two profiles carry different
   columns; only a collector who dialled it may say otherwise. */
const gone = compareTraceReports([I('mobile', '0821234567')], [I('mobile', '0839998888')])
check('a finding off the earlier report is reported, not condemned', gone.dropped, 1)
ok('...and nothing calls it dead',
  !/dead|disconnected|no longer valid/i.test(comparisonLine(gone)))

/* AND THE PAIRING IS BY SUBJECT. A company's report must never be compared with a director's. */
const T = (id, subjectKind, directorId, createdAt) => ({
  id, subjectKind, directorId, enquiredOn: null, createdAt, items: [],
})
const all = [
  T('new-dir', 'director', 'd1', '2026-10-01'),
  T('company', 'debtor', null, '2026-09-15'),
  T('old-dir', 'director', 'd1', '2026-07-01'),
]
check('a director s report is read against that director s', previousTraceFor(all, all[0]).id, 'old-dir')
check('...and never against the company s', previousTraceFor(all, all[1]), null)

console.log(`\ncheck-trace-compare-screen: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
