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
import { DEPARTMENTS, byDepartment, departmentOf, matchesPerson, rankOf, teamKindForRole, teamsForRole } from '../../src/lib/departments.ts'
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

/* ------------------------------------------------ a team belongs to a department */

/*
 * THE STEFNOVA GLITCH, AS A RULE. The firm: "a pre-legal agent can't be in a team that is for
 * communications -- they should be in the pre-legal division. And a liaison cannot be in a
 * pre-legal team." It was possible because TeamKind had no 'Call centre' at all, so the firm's
 * five pre-legal teams were recorded as SALES for want of anywhere else to put them.
 */
check('the call centre roles need a call centre team', teamKindForRole('Pre-legal Agent'), 'Call centre')
check('...their leader too', teamKindForRole('Pre-legal Team Leader'), 'Call centre')
check('...and their manager', teamKindForRole('Call Centre Manager'), 'Call centre')
check('a liaison needs a communications team', teamKindForRole('Liaison'), 'Communications')
check('a sales rep needs a sales team', teamKindForRole('Sales Representative'), 'Sales')
/*
 * AN ADMINISTRATOR IS NOT CONSTRAINED, and that is a decision rather than an omission: they
 * oversee every department instead of working in one, and the firm's rule named the three that do
 * the work. The trigger reads it the same way.
 */
check('an administrator may be in any team, or none', teamKindForRole('Administrator'), null)

const TEAMS = [
  { id: 's', name: 'Team Raptor', kind: 'Sales' },
  { id: 'c', name: 'Team Ballflick', kind: 'Communications' },
  { id: 'p1', name: 'Pre-legal Alpha', kind: 'Call centre' },
  { id: 'p2', name: 'Pre-legal Bravo', kind: 'Call centre' },
]
check('a pre-legal agent is offered only the pre-legal teams',
  teamsForRole('Pre-legal Agent', TEAMS).map((t) => t.name), ['Pre-legal Alpha', 'Pre-legal Bravo'])
/* The glitch, stated as the thing that must not be offered. */
ok('...and never a communications team',
  !teamsForRole('Pre-legal Agent', TEAMS).some((t) => t.kind === 'Communications'))
check('a liaison is offered only the communications team',
  teamsForRole('Liaison', TEAMS).map((t) => t.name), ['Team Ballflick'])
ok('...and never a pre-legal team',
  !teamsForRole('Liaison', TEAMS).some((t) => t.kind === 'Call centre'))
check('an administrator is offered all of them', teamsForRole('Administrator', TEAMS).length, TEAMS.length)

/*
 * AND THE DATABASE IS WHAT ACTUALLY REFUSES IT. Narrowing the picker is a courtesy -- team_id is
 * reachable by anything holding a session, and the pairing decides which dashboard somebody opens
 * on. CLAUDE.md's rule: hiding a control is not a permission.
 */
/*
 * SLICED FROM THE DECLARATION, not from the last mention of the name. `lastIndexOf` finds the
 * CREATE TRIGGER line, which names the function and contains none of it -- so the four assertions
 * below read an empty body and reported red on correct SQL. The same bounded-slice trap this
 * suite has hit before.
 */
const fnAt = schema.indexOf('create or replace function public.refuse_team_outside_department')
const body = fnAt < 0 ? '' : schema.slice(fnAt, schema.indexOf('end $fn$;', fnAt))
ok('the database refuses a mismatch at all', body.length > 0)
ok('...knowing which kind each department needs', /then 'Call centre'/.test(body) && /then 'Communications'/.test(body))
ok('...and says why, in the firm’s terms', /cannot be in a % team/.test(body))
/* Somebody with no team is not a violation -- it is the ordinary state of a new person. */
ok('no team is not a mismatch', /if new\.team_id is null then return new/.test(body))
/* An administrator falls through rather than being refused, matching teamKindForRole. */
ok('...and neither is a role the rule does not cover', /if v_want is null then return new/.test(body))
/*
 * NARROWED TO THE TWO COLUMNS. Left on every update this would run on a signature change, a
 * phone number, a diary capacity -- a lookup per write on a table every screen touches.
 */
ok('it watches the two columns rather than every write',
  /before insert or update of role, team_id\s*\n?\s*on public\.profiles/.test(schema))
/* And the kind the whole thing turns on must exist in the database. */
ok('the database knows about a call centre team',
  /teams_kind_check[\s\S]{0,200}?'Call centre'/.test(schema))

/* ------------------------------------------------ the screen draws the groups */

/*
 * GROUPS WHAT IT SHOWS. Pinned to `byDepartment(users)`, this broke the moment a search was added
 * and the screen began grouping the FILTERED list -- a correct change reported as a fault. What
 * must be true is that the grouping is fed the set being displayed, whatever it is called.
 */
ok('the users screen groups people', /byDepartment\(\w+\)/.test(settings))
ok('...grouping what the search left, not the whole firm', /const grouped = useMemo\(\(\) => byDepartment\(found\)/.test(settings))
/* The pickers offer only what the database will accept, in both places a team is chosen. */
ok('the row picker offers only this role’s teams', /teamsForRole\(u\.role, teams\)/.test(settings))
ok('the invite box follows the role chosen above it', /teamsForRole\(role, teams\)/.test(settings))
ok('...and drops a team the new role cannot have', /setTeamId\(''\)/.test(settings))
/* One list of team kinds, for the reason two lists of roles already taught this file. */
ok('there is one list of team kinds', /const TEAM_KINDS: TeamKind\[\]/.test(settings))
ok('...including the call centre', /'Call centre'/.test(settings))
check('no screen keeps its own pair of kind options',
  [...settings.matchAll(/<option value="Communications">/g)].length, 0)
ok('...and folds away the ones who have left', /grouped\.archived\.length > 0/.test(settings))
ok('...shown only when asked for', /showArchived && grouped\.archived\.map/.test(settings))
ok('...under the firm’s own words for it', /No longer here/.test(settings))

/* ------------------------------------------------ folding, and the rank beside the team */

/*
 * THE FIRM: "now it's just one long big list. It's nice that it's organised, but drop downs would
 * be nice." Thirty-eight people in the call centre is most of the screen.
 */
ok('a department can be folded away', /function DepartmentGroup/.test(settings))
ok('...and its rows are not drawn when it is', /\{!folded && group\.people\.map/.test(settings))
/* The count stays on the heading, so a folded department still says how many are in it. */
ok('...while the heading still says how many', /\{group\.people\.length\}/.test(settings))
/*
 * REMEMBERED, through the hook the two nav panes already use. A fold that resets on every page
 * load is not a preference, and this is about the screen somebody is sitting at.
 */
ok('...and the fold is remembered per department', /useCollapsed\(`users:\$\{group\.meta\.id\}`\)/.test(settings))
/*
 * Open unless somebody folded it: a screen that hides everything on arrival answers nothing.
 *
 * Asserted on the HOOK rather than on the name it destructures into. Pinned to
 * `const [folded, toggle]`, this broke when a search made the fold conditional and the variable
 * became `collapsed` -- again, a correct change reported as a fault.
 */
ok('...starting open, since useCollapsed is false until set', /= useCollapsed\(`users:/.test(settings))

/*
 * THE RANK, BESIDE THE TEAM: "you can put their rank, their grade -- rather call it a rank --
 * next to the team that they're in."
 */
ok('the rank is drawn beside the team', /COLLECTING_ROLES\.includes\(u\.role\) && \(/.test(settings))
ok('...only for somebody who collects', /COLLECTING_ROLES/.test(settings))
/* An unranked collector is offered NO accounts at all, so a blank is a thing to go and fix. */
ok('...and an unranked collector says so rather than showing nothing',
  /\{u\.collectorGrade \?\? 'no rank'\}/.test(settings))

/*
 * AND IT IS CALLED A RANK WHERE IT IS SET. CLAUDE.md: user-facing words are the firm's. The
 * column is still collector_grade and the type is still CollectorGrade -- only what a person
 * reads changed.
 */
const panel = read('src/components/settings/CollectorsPanel.tsx')
ok('the collectors panel is readable at all', panel.length > 0)
ok('the column is called Rank', /^\s*Rank$/m.test(panel))
ok('...and the explanation underneath agrees', /Rank decides <span/.test(panel))
ok('...with no "Grade" left for somebody to read', !/>\s*Grade\b/.test(panel) && !/\bGrade decides/.test(panel))
/* The model is untouched: this was a wording change, not a rename of the data. */
ok('the stored field is still the grade', /collectorGrade/.test(panel))

/*
 * AND THE PERSON WHO RUNS THE FLOOR CAN SET THEM. Written as a hand-made pair of roles, this was
 * left behind when Call Centre Manager was added -- they could hand accounts out and lead the
 * floor everywhere except the screen where ranks are actually set.
 */
ok('the collectors panel asks the shared permission', /canEdit=\{canLeadCollections\(currentUser\?\.role\)\}/.test(settings))
ok('...so the call centre manager may set a rank', canLeadCollections('Call Centre Manager'))

/* ------------------------------------------------ finding one person among a hundred */

/*
 * The firm, standing on the Users screen: "here we are in the user section, but we're searching
 * only for other stuff -- it should be for users."
 */
const KAMINI = { name: 'Kamini Reddy', email: 'kamini.reddy@raptor.test', role: 'Sales Representative' }
const YOLANDA = { name: 'Yolanda Leader', email: 'yolanda@raptor.test', role: 'Pre-legal Team Leader' }

check('an empty search matches everybody', matchesPerson(KAMINI, 'Team Raptor', '   '), true)
check('by name', matchesPerson(KAMINI, 'Team Raptor', 'kamini'), true)
check('by email', matchesPerson(KAMINI, 'Team Raptor', 'kamini.reddy@'), true)
/* "Who is the team leader on Bravo" is a real question whose answer is not a name. */
check('by role', matchesPerson(YOLANDA, 'Pre-legal Bravo', 'team leader'), true)
check('by team', matchesPerson(YOLANDA, 'Pre-legal Bravo', 'bravo'), true)
/*
 * EVERY WORD MUST MATCH SOMETHING. A search that ORs its words gets LONGER as you type, which is
 * backwards -- and "bravo leader" would then return every leader in the firm.
 */
check('...and the words are ANDed, across fields', matchesPerson(YOLANDA, 'Pre-legal Bravo', 'bravo leader'), true)
check('...so a word that matches nothing rules the person out',
  matchesPerson(YOLANDA, 'Pre-legal Bravo', 'bravo alpha'), false)
check('somebody else’s team does not match', matchesPerson(KAMINI, 'Team Raptor', 'bravo'), false)
check('case does not matter', matchesPerson(KAMINI, 'Team Raptor', 'KAMINI'), true)
/* Somebody with no team is still findable by everything else. */
check('no team is not a reason to be unfindable', matchesPerson(KAMINI, null, 'kamini'), true)

const settingsSrc = read('src/pages/settings/SettingsPage.tsx')
ok('the users screen has a search of its own', /placeholder="Search people, email, role or team"/.test(settingsSrc))
ok('...matched by the same rule, not a second one', /matchesPerson\(u, teamName\(u\.teamId\), search\)/.test(settingsSrc))
/*
 * A SEARCH IGNORES THE FOLDS. Somebody who folded the call centre away and then typed a name
 * would be told there is nobody by that name -- wrong, and it looks authoritative.
 */
ok('a search ignores a folded department', /const folded = collapsed && !forceOpen/.test(settingsSrc))
ok('...which is what the search turns on', /forceOpen=\{searching\}/.test(settingsSrc))
/*
 * The header must describe the table under it, not the firm.
 *
 * ASSERTED ON THE CONDITION, not just on the sentence. Written as a search for the wording
 * alone, this passed with the condition hard-coded to false -- the sentence sat in the file,
 * complete and unreachable, while the header went back to claiming fifty-seven over four rows.
 */
ok('the count says what is on screen while searching',
  /subtitle=\{searching[\s\S]{0,200}?team members match/.test(settingsSrc))
/* Reading the list is not an administrator's privilege. */
const boxAt = settingsSrc.indexOf('Search people, email, role or team')
ok('the search box is offered before the admin-only buttons',
  boxAt > 0 && boxAt < settingsSrc.indexOf('Add someone who has left'))

/*
 * AND THE GLOBAL SEARCH FINDS PEOPLE, which is what the firm was actually looking at.
 */
const global = read('src/components/layout/GlobalSearch.tsx')
ok('the global search is readable at all', global.length > 0)
ok('it searches people too', /for \(const u of users\)/.test(global))
ok('...by the same rule as the Users screen', /matchesPerson\(u, team, q\)/.test(global))
ok('...and says so in the box', /companies, deals, people/.test(global))
/*
 * IT LANDS ON THE LIST ALREADY NARROWED. There is no page for one person, and sending somebody to
 * a screen of a hundred rows having just picked one of them is worse than no result.
 */
ok('a person result opens the users list filtered to them',
  /\/settings\?tab=Users&q=\$\{encodeURIComponent\(u\.name\)\}/.test(global))
ok('...and the users screen reads that back', /new URLSearchParams\(window\.location\.search\)\.get\('q'\)/.test(settingsSrc))
/* Somebody who has left is a record, not a colleague you are trying to reach. */
ok('people who have left are not offered', /if \(u\.status === 'Inactive'\) continue/.test(global))

/* ------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-departments: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
