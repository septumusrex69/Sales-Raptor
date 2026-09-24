/**
 * EVERY ROLE CAN BE GIVEN TO SOMEBODY, AND A TABLE THAT FAILS TO LOAD SAYS SO.
 *
 * Two findings from one report. The firm: "when I load a user, I can't add it to a team."
 *
 * THE TEAM PICKER WAS EMPTY BECAUSE THE TABLE HAD NOT LOADED, AND NOTHING SAID SO. `fetchTable`
 * logged the error to a console nobody has open -- least of all on the iPad the firm works on --
 * and handed the screen an empty array. Seven teams sat in the database while every team picker
 * in Settings showed its one hard-coded "No team" option. An empty list and a failed list looked
 * identical, and the app read as though it had been built without teams.
 *
 * AND THE ROLE LIST WAS WRITTEN THREE TIMES, differing by one entry. The row dropdown had
 * 'Pre-legal Team Leader'; the invite box and the "someone who has left" box did not -- so the
 * role that leads the collections floor was the one role nobody could be invited as, or recorded
 * as having had. CLAUDE.md's rule, met again: written twice they drift.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-settings-roles.mjs
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
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

const settings = read('src/pages/settings/SettingsPage.tsx')
const types = read('src/types.ts')
const store = read('src/store/AppStore.tsx')

ok('the settings screen is readable at all', settings.length > 0)

/* ------------------------------------------------ one role list, and it is complete */

/*
 * READ OFF THE TYPE. Hard-coding the eight role names here would make this check a second copy of
 * the very list it exists to keep singular -- a ninth role added to the union would then be
 * missing from the screen AND from the check, and both would agree.
 */
const union = types.slice(types.indexOf('export type UserRole ='), types.indexOf('export interface User'))
const roles = [...union.matchAll(/\|\s*'([^']+)'/g)].map((m) => m[1])
ok('the role union is where this check thinks it is', roles.length >= 7)

/*
 * SLICED FROM THE `= [`, not from the declaration. `UserRole[]` carries a `]` of its own, so
 * cutting at the first one ended the slice inside the TYPE and read no roles at all -- which
 * reported red on correct code the first time this ran.
 */
const listBlock = settings.slice(settings.indexOf('export const ASSIGNABLE_ROLES'))
const arrayAt = listBlock.indexOf('= [')
const offered = [...listBlock.slice(arrayAt, listBlock.indexOf(']', arrayAt)).matchAll(/'([^']+)'/g)].map((m) => m[1])
ok('there is one list of roles somebody can be given', offered.length > 0)
check('...and it offers every role the type has', roles.filter((r) => !offered.includes(r)), [])
check('...and offers nothing the type does not', offered.filter((r) => !roles.includes(r)), [])
/*
 * THE ONE THAT WAS MISSING, named so this cannot pass by the list being empty on both sides.
 */
ok('...including the role that leads the collections floor',
  offered.includes('Pre-legal Team Leader'))

/* Three screens, one list. Asserted as "no second literal list of roles anywhere in the file",
   which is the rule -- pinning the three call sites would pass the moment somebody adds a
   fourth, which is exactly how the third one came to differ. */
const literalLists = [...settings.matchAll(/\['Administrator',\s*'Sales Manager'/g)].length
check('no screen keeps its own copy of the role list', literalLists, 0)
const uses = [...settings.matchAll(/ASSIGNABLE_ROLES\.map/g)].length
ok('and every role picker reads the shared one', uses >= 3)

/* ------------------------------------------------ a table that did not load says so */

ok('a failed table is recorded rather than only logged', /failed\?\.push\(table\)/.test(store))
/*
 * STILL AN EMPTY ARRAY, NOT A THROW. One table failing must not take the other eleven with it --
 * that is why the error was swallowed in the first place, and it was right. What was wrong was
 * swallowing it in silence.
 */
ok('...and the other tables still load', /failed\?\.push\(table\)\s*\n\s*return \[\]/.test(store))
ok('every table in the first load is watched', [...store.matchAll(/fetchTable<[^(]*\('[a-z_]+', '[a-z_]+', failed\)/g)].length >= 12)
ok('the person is told, not the console', /showError\(\s*`Some of your data did not load/.test(store))
/*
 * BY NAME. "Something went wrong" cannot be acted on: the whole failure is that a screen shows an
 * empty list and looks correct, so the person has to know WHICH list is lying to them.
 */
ok('...and told which tables', /\$\{failed\.join\(', '\)\}/.test(store))

/* ------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-settings-roles: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
