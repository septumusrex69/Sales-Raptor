/**
 * Setting what a collector is trusted with.
 *
 * WITHOUT THIS SCREEN THE HAND-OUT IS UNUSABLE. A grade is what marks somebody as a collector:
 * ungraded, they are offered nothing and the planner cannot give them an account. The three
 * numbers existed in the database, in the types and in the planner for a whole feature before
 * anything could set them — and the hand-out modal told people to go to a screen that could not
 * do it. These checks are what stop that gap reopening.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-collector-settings.mjs
 */
import { readFileSync } from 'node:fs'
import { canLeadCollections } from '../../src/lib/permissions.ts'
import {
  COLLECTOR_GRADES, DEFAULT_BOOK_CEILING, DEFAULT_DIARY_RESERVE,
  bookCeilingOf, diaryReserveOf, selfBookingLimit,
} from '../../src/lib/collectorGrade.ts'
import { DEFAULT_DIARY_CAPACITY } from '../../src/lib/diaryPriority.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const panel = read('../../src/components/settings/CollectorsPanel.tsx')
const settings = read('../../src/pages/settings/SettingsPage.tsx')
const modal = read('../../src/components/diary/DiariseModal.tsx')
const auth = read('../../src/store/AuthContext.tsx')

/* ---------- the company standard is one set of numbers ---------- */

check('the book standard', DEFAULT_BOOK_CEILING, 500)
check('the day standard', DEFAULT_DIARY_CAPACITY, 50)
check('the reserve standard', DEFAULT_DIARY_RESERVE, 10)
/*
 * The panel must SHOW the standard rather than restate it. A hardcoded "500" in the subtitle
 * goes stale the day the firm changes its mind, and then the screen teaches the wrong number to
 * everybody who reads it.
 */
ok('the panel reads the standard from code', /\{DEFAULT_BOOK_CEILING\}/.test(panel))
ok('...for the day too', /\{DEFAULT_DIARY_CAPACITY\}/.test(panel))
ok('...and the reserve', /\{DEFAULT_DIARY_RESERVE\}/.test(panel))
ok('no hardcoded 500 in the copy', !/standard is 500/.test(panel))

/* ---------- unset means the standard, and there is a way back to it ---------- */

check('an unset ceiling is the standard', bookCeilingOf(undefined), 500)
check('an unset reserve is the standard', diaryReserveOf(undefined), 10)
/* Zero is a CHOICE — hold nothing back — and must not collapse into the default. */
check('a reserve of none is honoured', diaryReserveOf(0), 0)
/*
 * Clearing the box writes undefined, which is how somebody is put back onto the standard after
 * an override. Without it the only way back is typing the standard in by hand — and then that
 * person stops following the standard the next time it changes.
 */
ok('an empty box clears the override', /if \(trimmed === ''\) \{ onChange\(undefined\); return \}/.test(panel))
ok('...and the placeholder shows what that means', /placeholder=\{String\(fallback\)\}/.test(panel))

/*
 * Out of range is a typo, not an instruction. A capacity of 500 is a mistyped 50 with a stuck
 * key, and accepting it makes every day read as empty for ever afterwards.
 */
ok('a typo is clamped, not written', /Math\.min\(max, Math\.max\(min, Math\.round\(n\)\)\)/.test(panel))
ok('a reserve cannot close the day', /max=\{Math\.max\(0, capacity - 1\)\}/.test(panel))

/* ---------- the grade ---------- */

ok('every grade is offered', COLLECTOR_GRADES.every((g) => panel.includes(`>{g}</option>`) || panel.includes('COLLECTOR_GRADES.map')))
/*
 * "Not a collector" is a real choice, not an absence. A liaison who answers client queries
 * should be offered no accounts at all, and a blank grade is what takes them out of the
 * hand-out list entirely.
 */
ok('ungraded is a choice', /<option value="">Not a collector<\/option>/.test(panel))
/*
 * SET BY A PERSON, NEVER COMPUTED — and the screen should say so, because a screen full of
 * performance numbers next to a grade invites somebody to wire the two together.
 */
ok('the panel says the grade is a human decision', /NEVER COMPUTED|never computed/.test(panel))

/* ---------- carrying now is IN PLAY ---------- */

/*
 * A collector holding 500 accounts of which 372 are written off is holding 128. A ceiling that
 * counted the corpses would refuse them work they have room for, and the screen would show a
 * warning triangle on somebody who is fine.
 */
ok('the panel asks the database what is in play', /collector_book_load/.test(panel))
ok('...and says when somebody is over', /over their ceiling|over<\/span>|\} over/.test(panel))

/* ---------- the role that gates all of this is assignable ---------- */

/*
 * Pre-legal Team Leader is what CAN_SEE_OTHER_DESKS checks for, so it decides who may hand work
 * out at all — and it was missing from the only dropdown that sets a role. The feature was
 * reachable by nobody until this was fixed.
 */
/*
 * Matched inside the ROLE LIST itself, not anywhere in the file. A bare search for the string
 * passes vacuously — the same name appears in the canEdit test two lines below — so deleting it
 * from the only list that assigns roles would leave this check green while nobody could be made
 * a team leader. Assert the thing, not a mention of the thing.
 *
 * READ OFF `ASSIGNABLE_ROLES` NOW. This used to match the dropdown's own inline array, and there
 * turned out to be THREE such arrays in the file differing by one entry — the invite box and the
 * "someone who has left" box both left the team leader out, so the role could be set on an
 * existing person and given to nobody new. They are one list now, and this reads it. Sliced from
 * the `= [` because the `UserRole[]` annotation carries a `]` of its own.
 */
const listAt = settings.indexOf('export const ASSIGNABLE_ROLES')
const arrayAt = settings.indexOf('= [', listAt)
const roleList = listAt < 0 ? '' : settings.slice(arrayAt, settings.indexOf(']', arrayAt))
ok('the role dropdown exists at all', roleList.includes("'Administrator'"))
ok('a team leader can actually be appointed', roleList.includes("'Pre-legal Team Leader'"))
ok('the collectors panel is mounted', /<CollectorsPanel/.test(settings))
/*
 * ASSERTED THROUGH canLeadCollections, NOT AS THE PAIR OF ROLES IT USED TO BE WRITTEN AS.
 *
 * Pinned to `isAdmin || role === 'Pre-legal Team Leader'`, this broke the moment the panel
 * started asking the shared permission -- a correct change reported as a fault. Worse, the
 * hand-written pair was itself the bug: it was left behind when Call Centre Manager was added, so
 * the person who runs the floor could lead it everywhere except the screen where ranks are set.
 *
 * Run rather than read, so this says what must be TRUE of the permission rather than how the
 * call happens to be spelt.
 */
ok('the panel asks the shared collections permission',
  /canEdit=\{canLeadCollections\(/.test(settings))
ok('...so a team leader may edit it, not only an administrator',
  canLeadCollections('Pre-legal Team Leader') && canLeadCollections('Administrator'))
ok('...and so may the person who runs the floor', canLeadCollections('Call Centre Manager'))
ok('...while a collector may not', !canLeadCollections('Pre-legal Agent'))

/* ---------- the mapper carries the columns ---------- */

/*
 * AuthContext.mapProfileRow is hand-written, so a column present in the database, in the type
 * and in the select but missing here reads as undefined for ever and nothing fails. Three new
 * columns all went through it; if one were dropped the settings screen would save a value that
 * never came back.
 */
for (const f of ['collectorGrade: row.collector_grade', 'bookCeiling: row.book_ceiling', 'diaryReserve: row.diary_reserve']) {
  ok(`the profile mapper carries ${f.split(':')[0]}`, auth.includes(f))
}

/* ---------- the reserve constrains SELF-BOOKING only ---------- */

check('a clerk on 50 with 10 held back books 40', selfBookingLimit(50, 10), 40)
check('no reserve gives the whole day', selfBookingLimit(50, 0), 50)
check('a reserve cannot close the day', selfBookingLimit(10, 50), 1)

/*
 * The diary must warn at the SELF-BOOKING limit, not the working day. Warning at the full
 * capacity lets an agent's own bookings eat the room a hand-out needs, and the first anybody
 * knows of it is a plan that runs a week past the window it was asked for.
 */
ok('the diary warns at the self-booking limit', /const capacity = selfBookingLimit\(fullDay, reserve\)/.test(modal))
ok('...and knows the whole day separately', /const fullDay = owner\?\.diaryCapacity/.test(modal))

/*
 * AND THE SENTENCE HAS TO STAY TRUE. Telling somebody who works 50 that they "work 40 a day" is
 * a small lie that makes the whole warning untrustworthy — and the reserve is exactly the thing
 * they would query.
 */
ok('the warning does not misstate the working day', !/you work \{dayFull\.capacity\} a day/.test(modal))
ok('...it names both numbers when a reserve is set',
  /You book \$\{capacity\} of your \$\{fullDay\} a day yourself/.test(modal))
ok('...and stays simple when there is none', /: `You work \$\{fullDay\} a day\.`/.test(modal))

/*
 * The distributor fills the WHOLE day. If it also held the reserve back, the slots would be
 * reserved from the only thing they were ever reserved for.
 */
const plan = read('../../src/lib/handOut.ts')
ok('the distributor measures a day against the whole capacity',
  /const free = s\.c\.capacity - \(s\.c\.bookedByDay\[day\] \?\? 0\) - \(s\.added\[day\] \?\? 0\)/.test(plan))
ok('...and against nothing smaller', !/capacity - .*reserve|selfBookingLimit/.test(plan))
/*
 * And it cannot even see the reserve. The comment below says why this is deliberate, but a
 * comment is not a guard — the import is. Wire diaryReserveOf into the planner and this fails
 * before anybody has to notice that hand-outs got 10 slots a day smaller.
 */
ok('...because it never looks the reserve up', !/diaryReserveOf|diaryReserve\b|selfBookingLimit/.test(plan))
// Matched on one line of the comment: the reasoning wraps, and a regex spanning the wrap would
// break the next time somebody reflows the paragraph.
ok('...deliberately', /Fills to the FULL capacity, not to capacity minus reserve/.test(plan))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A grade can be set, a ceiling overridden and cleared back to the standard, and a team leader can
be appointed. The diary warns an agent at their own booking limit while the distributor still
fills the whole day.`)
