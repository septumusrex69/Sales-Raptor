/**
 * THE HOURS A DEBTOR ASKED TO BE RUNG IN, AND THE SLOTS AROUND THEM.
 *
 * THE FIRM, LOOKING AT THE DEBTOR DETAILS PANEL: "it's important to show that a debtor has a
 * mobile primary number. He could have a secondary number, mobile. Then a work number -- I'd say a
 * work number, because nobody has a home number anymore. So an email address, there should be a
 * second, an alternative email address. And then the rest of the stuff... maybe we can add
 * something like there, contact time, between certain hours, and then you can choose the two hours
 * and then add a different schedule -- for example the debtor likes to be contacted between 8 and
 * 9, and 7 and 5."
 *
 * TWO WINDOWS IS THE WHOLE POINT. Somebody reachable before work and again after it is not
 * reachable all day, and one wide "08:00 to 17:00" says exactly that -- which is how a collector
 * rings a man on a factory floor at eleven, is told to stop calling, and the account goes quiet.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-contact-windows.mjs
 */
import { readFileSync } from 'node:fs'
import {
  describeWindows, formatWindow, insideWindow, isTime, parseWindows, windowProblem,
  withWindow, withoutWindow,
} from '../../src/lib/contactWindows.ts'
import { firmClock } from '../../src/lib/dateLabels.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

/* ---------------------------------------------------------------------------------------------
 * THE FIRM'S OWN EXAMPLE
 * ------------------------------------------------------------------------------------------- */

const BOTH = [{ from: '08:00', to: '09:00' }, { from: '17:00', to: '18:00' }]
check('the debtor who takes a call before work and after it has two windows', BOTH.length, 2)
check('...and they read as a range each', describeWindows(BOTH), '08:00 – 09:00, 17:00 – 18:00')
/* AN EN DASH, not a hyphen: it is a range and not a subtraction, and "08:00-09:00" in a column of
   figures reads as one number minus another. */
ok('...joined by a dash rather than a minus', formatWindow(BOTH[0]).includes('–'))

/* EARLIEST FIRST, whatever order they were typed in. A list in the order somebody happened to
   add things is a list people re-read every time. */
check('they come back earliest first',
  parseWindows([{ from: '17:00', to: '18:00' }, { from: '08:00', to: '09:00' }]).map((w) => w.from),
  ['08:00', '17:00'])

/* ---------------------------------------------------------------------------------------------
 * jsonb WILL HOLD ANYTHING, SO READING IT BACK CANNOT THROW
 * ------------------------------------------------------------------------------------------- */

/*
 * A PANEL THAT THROWS ON ONE BAD ROW TAKES THE DEBTOR'S NAME AND TELEPHONE NUMBER DOWN WITH IT.
 * The column is jsonb: an older shape, a hand-run UPDATE and a null are all things it will hold,
 * and none of them is a reason a collector cannot see who they are chasing.
 */
check('an empty column is no windows', parseWindows([]), [])
check('...and so is a null', parseWindows(null), [])
check('...and so is something that is not a list at all', parseWindows({ from: '08:00' }), [])
check('...and so is a string', parseWindows('08:00-09:00'), [])
check('a row missing half of itself is not a window', parseWindows([{ from: '08:00' }]), [])
check('...nor is one with a time that is not a time', parseWindows([{ from: '8am', to: '9am' }]), [])
check('...nor twenty-five o’clock', parseWindows([{ from: '25:00', to: '26:00' }]), [])
/* THE GOOD ONES SURVIVE THE BAD ONE. One wrong row must not cost the hours somebody did record. */
check('and a good window beside a bad one is kept',
  parseWindows([{ from: 'rubbish', to: '09:00' }, { from: '08:00', to: '09:00' }]),
  [{ from: '08:00', to: '09:00' }])
ok('a time is four digits and a colon', isTime('08:00') && isTime('23:59'))
ok('...and nothing else', !isTime('8:00') && !isTime('08:60') && !isTime('') && !isTime(null))

/* ---------------------------------------------------------------------------------------------
 * A WINDOW THAT RUNS BACKWARDS IS A TYPO, AND THIS ONE IS REFUSED
 * ------------------------------------------------------------------------------------------- */

/*
 * SAID RATHER THAN PREVENTED is this panel's rule everywhere else -- an ID number that looks wrong
 * is still stored, because what the collector was given is the only thing anybody has to work
 * from. A time is different: there is nothing to preserve in "17:00 to 09:00", and stored it would
 * read as a ban on the middle of the day.
 */
check('a window may not end before it starts',
  windowProblem({ from: '17:00', to: '09:00' }), 'The end of the window is before its start.')
check('...nor be the same time twice', windowProblem({ from: '09:00', to: '09:00' }), 'That is the same time twice.')
check('...and both times are needed', windowProblem({ from: '09:00', to: '' }),
  'Both times are needed, as hours and minutes.')
check('an ordinary window has nothing wrong with it', windowProblem({ from: '08:00', to: '09:00' }), null)
/* AND IT NEVER REACHES THE LIST. The button is disabled on the same answer, so this is the second
   of two locks on one door rather than the only one. */
check('a backwards window is not added', withWindow([], { from: '17:00', to: '09:00' }), [])
check('...while a good one is', withWindow([], { from: '08:00', to: '09:00' }).length, 1)
/* A DUPLICATE IS NOT A SECOND WINDOW: two identical rows read as two instructions and there is no
   way to tell which one the X is removing. */
check('the same window twice is one window', withWindow(BOTH, { from: '08:00', to: '09:00' }), BOTH)
check('and one can be taken out again', withoutWindow(BOTH, 0).map((w) => w.from), ['17:00'])
check('...by its place in the list the panel drew', withoutWindow(BOTH, 1).map((w) => w.from), ['08:00'])

/* ---------------------------------------------------------------------------------------------
 * IS NOW ONE OF THOSE HOURS?
 * ------------------------------------------------------------------------------------------- */

/* INCLUSIVE AT THE START, EXCLUSIVE AT THE END, the way an hour is spoken: "between 8 and 9"
   means you may ring at 8 and not at 9. */
ok('eight o’clock is inside eight to nine', insideWindow(BOTH, '08:00'))
ok('...and so is half past', insideWindow(BOTH, '08:30'))
ok('...and nine is not', !insideWindow(BOTH, '09:00'))
ok('...and neither is the middle of the day', !insideWindow(BOTH, '13:00'))
ok('the second window counts too', insideWindow(BOTH, '17:30'))
/*
 * NO WINDOWS IS NOT A BAD TIME. Nearly every account on the book has none recorded, and a caution
 * on all of them is a caution nobody reads -- this screen's own rule is that a warning which fires
 * when nothing is wrong is worse than no warning.
 */
ok('an account nobody has asked is callable at any hour', insideWindow([], '03:00'))
ok('...and a clock that is not a clock does not accuse anybody', insideWindow(BOTH, 'now'))

/* THE HOUR IS JOHANNESBURG'S, not the browser's: a collector on a laptop still set to London
   would be told four in the afternoon was six, and the wrong-hour call is the whole point. */
check('the clock is read in Johannesburg', firmClock(new Date('2026-10-03T14:05:00Z')), '16:05')
check('...and midnight is 00:xx rather than 24:xx', firmClock(new Date('2026-10-03T22:30:00Z')), '00:30')

/* ---------------------------------------------------------------------------------------------
 * AND THE PANEL
 * ------------------------------------------------------------------------------------------- */

const panel = read('src/pages/accounts/AccountWorkspacePanels.tsx')
ok('the panel is there to read', panel.length > 1000)

/* THE FIRM'S SLOTS, IN THE FIRM'S ORDER: a primary mobile, a second mobile, a work number, an
   address, an alternative address, and then the rest of it. */
const labels = [...panel.matchAll(/label="([^"]+)"/g)].map((m) => m[1])
const wanted = ['Mobile (Primary)', 'Mobile (Second)', 'Work number', 'Email address',
  'Alternative email', 'Residential address', 'Employer']
for (const w of wanted) ok(`the panel has a slot for "${w}"`, labels.includes(w))
/* PRESENCE FIRST AND THEN ORDER. indexOf returns -1, so an order-only assertion passes vacuously
   the day somebody deletes the slot it was ordering -- CLAUDE.md's own trap. */
check('...and they are in the order the firm gave them',
  wanted.map((w) => labels.indexOf(w)),
  [...wanted.map((w) => labels.indexOf(w))].sort((a, b) => a - b))
/* A SECOND CELLPHONE ADDS A CELLPHONE. The old alternative slot added kind 'phone', which is the
   home line the firm has just said nobody has. */
ok('the second mobile slot adds a mobile',
  /label="Mobile \(Second\)"[\s\S]{0,200}setAddKind\('mobile'\)/.test(panel))
ok('...and the work slot adds a work number',
  /label="Work number"[\s\S]{0,400}setAddKind\('work'\)/.test(panel))

/* THE HOURS, DRAWN AND WRITTEN. */
ok('the panel asks when they may be telephoned', /label="Best time to call"/.test(panel))
ok('...reading the column through the parser rather than trusting it',
  /parseWindows\(account\.contactWindows\)/.test(panel))
ok('...and writing it back the same way',
  /saveDebtorPreferences\(account\.id, \{ contactWindows: next \}\)/.test(panel))
/* A WHEEL, NOT A BOX. The firm works on an iPad, and it is the one control that cannot produce
   "half past eight" where the column holds "HH:MM". */
/* COUNTED ON THE CONTROL AND NOT THE WORDS: the comment above it says `type="time"` too, and a
   count that includes prose is a count that changes when somebody rewrites a sentence. */
const times = panel.match(/<input type="time" value=\{/g) ?? []
check('the two times are pickers', times.length, 2)
/* AND THE CAUTION IS SHOWN ONLY WHERE SOMEBODY HAS BEEN TOLD AN HOUR. */
ok('a caller outside those hours is told',
  /windows\.length > 0 && !insideWindow\(windows, firmClock\(\)\)/.test(panel))

/* THE SIZE, WHICH IS WHAT THE FIRM SAW FIRST. "The script is really big -- it should be the same
   as the other one." One component draws a contact everywhere on this panel, so the size belongs
   on it: inside a slot the `dd` set it and in the lists below nothing did. */
ok('a contact is drawn at one size wherever it appears',
  /THE SAME SIZE WHEREVER IT IS DRAWN[\s\S]{0,900}<div className="text-sm">/.test(panel))

/* THE WRITER TAKES THEM, and re-reads them on the way out so the one shape stored is the one
   shape parseWindows recognises. */
const store = read('src/lib/accountWorkspace.ts')
ok('the preferences writer takes the hours',
  /row\.contact_windows = parseWindows\(patch\.contactWindows \?\? \[\]\)/.test(store))
/* AND THE COLUMN REACHES THE APP. A column present in the database, in the type and in the
   select, and missing from the mapper, reads as undefined for ever and nothing fails. */
const book = read('src/lib/accountBook.ts')
ok('the column is named in the mapper by hand', /contactWindows: r\.contact_windows \?\? \[\]/.test(book))
const schema = read('supabase/schema.sql')
ok('...and it exists in the schema', /add column if not exists contact_windows jsonb/.test(schema))

console.log(`\ncheck-contact-windows: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
