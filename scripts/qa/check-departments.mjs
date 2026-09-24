/**
 * A HUNDRED PEOPLE, ORGANISED THE WAY THE FIRM IS ORGANISED.
 *
 * The firm: "there are more than 100 users ... we need to categorise them. So we have
 * administrators — we have a reception which is also kind of an administrator, but just keep her
 * as an administrator for now. Then we have a sales department, which is a sales manager and
 * sales agents under them. Then we get the communications team. Then we have the call centre,
 * which has a call centre manager, which is the manager of the team leaders. Then we get team
 * leaders and then we get pre-legal agents. Now the call centre manager is also a pre-legal agent
 * and the team leaders are also pre-legal agents — they just have reduced books. And then we
 * should look at archived users: if somebody left the company we archive the user, just to
 * understand if there's a timestamp about someone that did something."
 *
 * WHAT THIS GUARDS:
 *
 *   - EVERY ROLE HAS A DEPARTMENT, held against the UserRole union in BOTH directions. A role
 *     added to the type and forgotten in the map would otherwise fall quietly into "Everyone
 *     else" — and this codebase has shipped a half-written role list twice this week.
 *   - THE CALL CENTRE IS A LADDER: manager, then team leaders, then agents. A list of a hundred
 *     sorted by name hides the structure the firm asked to see.
 *   - THE NEW ROLE COLLECTS, and is in every place that decides what a collections person may do.
 *     A role that exists in the type and in none of the gates is a person who cannot do their job
 *     and no error anywhere.
 *   - REDUCED BOOKS ARE PER PERSON, NOT PER ROLE. CLAUDE.md: the standard is 500 for everybody
 *     and overrides live on profiles.book_ceiling. A role that decided how many would contradict
 *     the rule the firm stated.
 *   - PEOPLE WHO HAVE LEFT ARE KEPT AND SET APART, so a department's count is the people doing
 *     that job.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-departments.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { DEPARTMENTS, byDepartment, departmentOf, rankOf } from '../../src/lib/departments.ts'
import { canHandOutAccounts, canLeadCollections, mayPoolDisputes, visibleDisputeOwners } from '../../src/lib/permissions.ts'
import { COLLECTING_ROLES } from '../../src/lib/collectorGrade.ts'

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

const types = read('src/types.ts')
const union = types.slice(types.indexOf('export type UserRole ='), types.indexOf('export interface User'))
const ROLES = [...union.matchAll(/\|\s*'([^']+)'/g)].map((m) => m[1])
ok('the role union is where this check thinks it is', ROLES.length >= 9)

/* ------------------------------------------------ every role has a department */

/*
 * BOTH DIRECTIONS. Only checking that each role maps somewhere would pass with the map holding
 * three roles nobody has; only checking the map would miss a new role falling into "Other".
 */
const unmapped = ROLES.filter((r) => departmentOf(r) === 'Other' && r !== 'Read Only')
check('every role belongs to a department', unmapped, [])
check('...and Read Only deliberately does not', departmentOf('Read Only'), 'Other')
check('an unknown role does not crash, it falls to Other', departmentOf(undefined), 'Other')

check('the administrator is administration', departmentOf('Administrator'), 'Administration')
check('sales is sales', departmentOf('Sales Manager'), 'Sales')
check('...both of them', departmentOf('Sales Representative'), 'Sales')
check('a liaison is communications', departmentOf('Liaison'), 'Communications')
check('...and so is their manager', departmentOf('Liaison Manager'), 'Communications')
/* The three that work the book. */
for (const r of ['Call Centre Manager', 'Pre-legal Team Leader', 'Pre-legal Agent']) {
  check(`${r} is the call centre`, departmentOf(r), 'Call centre')
}

/* The firm's own order: the office, the two client-facing departments, then the floor. */
check('the departments are in the firm’s order',
  DEPARTMENTS.map((d) => d.id),
  ['Administration', 'Sales', 'Communications', 'Call centre', 'Other'])
ok('...and each says what it is', DEPARTMENTS.every((d) => d.blurb.length > 20))

/* ------------------------------------------------ the call centre is a ladder */

ok('the manager outranks a team leader', rankOf('Call Centre Manager') < rankOf('Pre-legal Team Leader'))
ok('...and a team leader outranks an agent', rankOf('Pre-legal Team Leader') < rankOf('Pre-legal Agent'))

const mk = (name, role, status = 'Active') => ({ name, role, status })
const floor = [
  mk('Zed Agent', 'Pre-legal Agent'), mk('Alpha Agent', 'Pre-legal Agent'),
  mk('Yolanda Leader', 'Pre-legal Team Leader'), mk('Manager Person', 'Call Centre Manager'),
  mk('Sales Person', 'Sales Representative'), mk('Gone Person', 'Pre-legal Agent', 'Inactive'),
]
const { departments, archived } = byDepartment(floor)
const callCentre = departments.find((d) => d.meta.id === 'Call centre')
ok('the call centre group exists', !!callCentre)
/*
 * RANK FIRST, THEN NAME. Run rather than read: the manager sorts above the leader above the
 * agents, and "Alpha" before "Zed" inside the agents -- a name-only sort would put Alpha first
 * overall and hide the ladder entirely.
 */
check('drawn manager, then leader, then agents by name',
  callCentre.people.map((u) => u.name),
  ['Manager Person', 'Yolanda Leader', 'Alpha Agent', 'Zed Agent'])

/* ------------------------------------------------ people who have left */

check('somebody who left is not in a department', callCentre.people.some((u) => u.name === 'Gone Person'), false)
check('...they are archived instead', archived.map((u) => u.name), ['Gone Person'])
/* Kept, which is the firm's reason for archiving rather than deleting. */
ok('...and still carry their role, so an old action still has a name on it',
  archived[0]?.role === 'Pre-legal Agent')
/* A heading with nothing under it reads as something missing. */
check('an empty department is not drawn',
  departments.some((d) => d.people.length === 0), false)
check('...so a firm with only agents shows one department',
  byDepartment([mk('Only Agent', 'Pre-legal Agent')]).departments.map((d) => d.meta.id),
  ['Call centre'])

/* ------------------------------------------------ the new role can do its job */

/*
 * THE FAILURE THIS PREVENTS: a role in the type and in none of the gates. Nothing errors — the
 * person simply cannot do the thing, and nobody can see why. It has happened twice this week.
 */
ok('the call centre manager collects', COLLECTING_ROLES.includes('Call Centre Manager'))
ok('...leads the floor', canLeadCollections('Call Centre Manager'))
ok('...may hand accounts out', canHandOutAccounts('Call Centre Manager'))
/* A leader still cannot look at the whole board at once — the firm ruled that out. */
check('...but still not a bird’s-eye view of disputes', mayPoolDisputes('Call Centre Manager'), false)

const FLOOR = [
  { id: 'ccm', role: 'Call Centre Manager', teamId: 'a' },
  { id: 'lead-a', role: 'Pre-legal Team Leader', teamId: 'a' },
  { id: 'lead-b', role: 'Pre-legal Team Leader', teamId: 'b' },
  { id: 'agent-b', role: 'Pre-legal Agent', teamId: 'b' },
  { id: 'sales', role: 'Sales Representative', teamId: 'a' },
]
const ccmSees = visibleDisputeOwners(FLOOR[0], FLOOR).map((u) => u.id)
/* "The manager of the team leaders" -- every team, not one. */
check('the manager sees the whole floor, themselves first', ccmSees, ['ccm', 'lead-a', 'lead-b', 'agent-b'])
ok('...and not the sales side, which is not their floor', !ccmSees.includes('sales'))
/* While a team leader is unchanged: their own team only. */
check('a team leader still sees only their team',
  visibleDisputeOwners(FLOOR[2], FLOOR).map((u) => u.id), ['lead-b', 'agent-b'])

const router = read('src/pages/DashboardRouter.tsx')
ok('they open Raptor on the collections floor', /'Call Centre Manager'/.test(router))
const settings = read('src/pages/settings/SettingsPage.tsx')
ok('they can be given the role on the screen', /'Call Centre Manager'/.test(settings))
const api = read('api/invite-user.ts')
ok('...and invited as one', /'Call Centre Manager'/.test(api))
const schema = read('supabase/schema.sql')
ok('and the database accepts the value at all',
  /profiles_role_check[\s\S]{0,400}?'Call Centre Manager'/.test(schema))

/*
 * REDUCED BOOKS ARE A PER-PERSON CEILING. CLAUDE.md: "Company standard is 500 on the book and 50
 * a day for everybody... Per-person overrides live on profiles.book_ceiling." The firm said the
 * manager and the leaders work about 300 -- that is three overrides, not a property of a role.
 */
const grade = read('src/lib/collectorGrade.ts')
ok('no role decides how many accounts somebody carries',
  !/Call Centre Manager[^\n]*\b(300|book_ceiling|bookCeiling)\b/.test(grade))

/*
 * AND THE API'S OWN COPY OF canLeadCollections AGREES WITH IT.
 *
 * release.ts cannot import permissions.ts -- that is browser code and would drag React into a
 * serverless function -- so it names the roles itself. A copy is a thing that drifts, and this
 * one did: the manager could lead the floor everywhere except when releasing a held notice, which
 * would have refused them silently. Held against the real function rather than against a literal.
 */
const release = read('api/_lib/workflow/release.ts')
const namedInApi = [...release.matchAll(/profile\.role === '([^']+)'/g)].map((m) => m[1])
ok('the api names some roles for this', namedInApi.length > 0)
check('...and exactly the ones canLeadCollections allows',
  namedInApi.filter((r) => !canLeadCollections(r)), [])
check('...with none of them missing',
  ROLES.filter((r) => canLeadCollections(r) && !namedInApi.includes(r)), [])

/* ------------------------------------------------ the screen draws the groups */

ok('the users screen groups people', /byDepartment\(users\)/.test(settings))
ok('...and folds away the ones who have left', /grouped\.archived\.length > 0/.test(settings))
ok('...shown only when asked for', /showArchived && grouped\.archived\.map/.test(settings))
ok('...under the firm’s own words for it', /No longer here/.test(settings))

/* ------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-departments: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
