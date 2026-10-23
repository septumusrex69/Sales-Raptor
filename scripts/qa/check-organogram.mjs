/**
 * THE ORGANOGRAM HANGS EVERYBODY ONCE, IN THE RIGHT PLACE.
 *
 * THE FIRM (Stephan, 23 Oct): "it should show ... an organogram, like of the departments, maybe of the
 * company ... and then you can go to the specific organograms ... if you go to the call center and
 * you say view organogram."
 *
 * WHAT THIS GUARDS (src/lib/organogram.ts):
 *   - THE HEAD IS DRAWN ONCE: at the top of the department, never again among a team's people or in
 *     "Without a team" -- but still as a team's lead when they hold that post.
 *   - THE LEAD IS FIRST: their own node, never one of the members under it.
 *   - VACANT POSTS ARE PRESENT: a department with no head, a team with no lead -- and a post held by
 *     somebody who has LEFT -- come back as null (drawn "No head yet" / "No lead yet"), not dropped.
 *   - NOBODY FALLS OFF: in no department, or a department that is not loaded, is its own group.
 *   - PEOPLE WHO HAVE LEFT ARE NOT ON IT.
 *   - ONE DEPARTMENT is that department only, and a focus nobody recognises draws nothing.
 *   - THE FOLD: "+N more" past eight, taking the eighth place, never "+1 more".
 *   - THE SCREEN: a third tab, read-only, reached from a department's and a team's pane.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-organogram.mjs
 */
import { readFileSync } from 'node:fs'
import { FOLD_AT, buildOrganogram, departmentOfTeam, foldPeople } from '../../src/lib/organogram.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, cond) => check(name, !!cond, true)

/* ---------------------------------------------------------------- the firm, near enough */
const DEPTS = [
  { id: 'cc', name: 'Call centre', headId: 'mandla', duties: [], sort: 3 },
  { id: 'adm', name: 'Administration', headId: 'stephan', duties: [], sort: 0 },
  { id: 'sal', name: 'Sales', headId: 'felicia', duties: [], sort: 1 },
  /* No head at all. */
  { id: 'rec', name: 'Reception', headId: undefined, duties: [], sort: 2 },
  /* A head who has LEFT: the post is vacant. */
  { id: 'com', name: 'Communications', headId: 'gone-head', duties: [], sort: 4 },
]
const TEAMS = [
  /* No lead. Listed first so the order on the drawing is the name's, not the table's. */
  { id: 'bravo', name: 'Pre-legal Bravo', kind: 'Call centre', departmentId: 'cc', leadId: undefined },
  { id: 'alpha', name: 'Pre-legal Alpha', kind: 'Call centre', departmentId: 'cc', leadId: 'yolanda' },
  /* Led by the department's own head. */
  { id: 'mkt', name: 'Marketing', kind: 'Sales', departmentId: 'sal', leadId: 'felicia' },
  /* Led by somebody who has left. */
  { id: 'cs', name: 'Client Services', kind: 'Sales', departmentId: 'sal', leadId: 'gone-lead' },
]
const P = (id, name, role, departmentId, teamId, status = 'Active') => ({ id, name, role, status, departmentId, teamId })
const PEOPLE = [
  P('stephan', 'Stephan', 'Administrator', 'adm', undefined),
  P('camille', 'Camille', 'Administrator', 'adm', undefined),
  /* The head sits in a team as well -- the database puts a manager in one. */
  P('mandla', 'Mandla Manager', 'Call Centre Manager', 'cc', 'alpha'),
  P('zed', 'Zed Agent', 'Pre-legal Agent', 'cc', 'alpha'),
  P('yolanda', 'Yolanda Leader', 'Pre-legal Team Leader', 'cc', 'alpha'),
  P('abe', 'Abe Agent', 'Pre-legal Agent', 'cc', 'alpha'),
  P('bea', 'Bea Agent', 'Pre-legal Agent', 'cc', 'bravo'),
  P('loose', 'Loose Agent', 'Pre-legal Agent', 'cc', undefined),
  P('left-agent', 'Left Agent', 'Pre-legal Agent', 'cc', 'alpha', 'Inactive'),
  P('felicia', 'Felicia Head', 'Sales Manager', 'sal', 'mkt'),
  P('ryno', 'Ryno Rep', 'Sales Representative', 'sal', 'mkt'),
  P('gone-lead', 'Gone Lead', 'Sales Manager', 'sal', 'cs', 'Inactive'),
  P('cara', 'Cara Rep', 'Sales Representative', 'sal', 'cs'),
  P('gone-head', 'Gone Head', 'Communications Manager', 'com', undefined, 'Inactive'),
  /* In no department, and in one nobody loaded. */
  P('nomad', 'Nomad', 'Sales Representative', undefined, undefined),
  P('orphan', 'Orphan', 'Pre-legal Agent', 'deleted-dept', undefined),
  P('left-nomad', 'Left Nomad', 'Sales Representative', undefined, undefined, 'Inactive'),
]

const chart = buildOrganogram(DEPTS, TEAMS, PEOPLE)
const dept = (name) => chart.departments.find((d) => d.name === name)
const team = (d, name) => dept(d)?.teams.find((t) => t.name === name)
const ids = (list) => (list ?? []).map((p) => p.id)
const everyoneDrawn = () => {
  const out = []
  for (const d of chart.departments) {
    if (d.head) out.push(d.head.id)
    for (const t of d.teams) { if (t.lead) out.push(t.lead.id); out.push(...ids(t.members)) }
    out.push(...ids(d.withoutTeam))
  }
  out.push(...ids(chart.unplaced))
  return out
}

/* ---------------------------------------------------------------- order */
check('departments in the firm’s order', chart.departments.map((d) => d.name),
  ['Administration', 'Sales', 'Reception', 'Call centre', 'Communications'])
check('teams by name inside a department', dept('Call centre')?.teams.map((t) => t.name), ['Pre-legal Alpha', 'Pre-legal Bravo'])

/* ---------------------------------------------------------------- the head, once */
check('the call centre’s head is drawn at its top', dept('Call centre')?.head?.id, 'mandla')
ok('...and NOT again among their team’s people', !ids(team('Call centre', 'Pre-legal Alpha')?.members).includes('mandla'))
ok('...nor in "Without a team"', !ids(dept('Administration')?.withoutTeam).includes('stephan'))
check('Administration’s head is not among those without a team', ids(dept('Administration')?.withoutTeam), ['camille'])
check('a head who leads a team is still that team’s lead', team('Sales', 'Marketing')?.lead?.id, 'felicia')
check('...and not one of its members as well', ids(team('Sales', 'Marketing')?.members), ['ryno'])

/* ---------------------------------------------------------------- the lead, first */
check('a team’s lead is its own node', team('Call centre', 'Pre-legal Alpha')?.lead?.id, 'yolanda')
ok('...never one of the members under it', !ids(team('Call centre', 'Pre-legal Alpha')?.members).includes('yolanda'))
check('the members under the lead, by name within the ladder', ids(team('Call centre', 'Pre-legal Alpha')?.members), ['abe', 'zed'])

/* ---------------------------------------------------------------- vacant posts */
ok('a department with no head is still drawn', !!dept('Reception'))
check('...with its head post empty (drawn "No head yet")', dept('Reception')?.head, null)
check('a head who has left leaves the post vacant', dept('Communications')?.head, null)
ok('a team with no lead is still drawn', !!team('Call centre', 'Pre-legal Bravo'))
check('...with its lead post empty (drawn "No lead yet")', team('Call centre', 'Pre-legal Bravo')?.lead, null)
check('...and its people under the empty post', ids(team('Call centre', 'Pre-legal Bravo')?.members), ['bea'])
check('a lead who has left leaves the post vacant', team('Sales', 'Client Services')?.lead, null)
check('...and the team keeps the people still in it', ids(team('Sales', 'Client Services')?.members), ['cara'])

/* ---------------------------------------------------------------- nobody falls off */
check('somebody in the department and no team is "Without a team"', ids(dept('Call centre')?.withoutTeam), ['loose'])
check('people in no department, or one not loaded, are their own group', ids(chart.unplaced).sort(), ['nomad', 'orphan'])
const drawn = everyoneDrawn()
const here = PEOPLE.filter((p) => p.status !== 'Inactive').map((p) => p.id)
check('everybody still here is drawn', [...new Set(drawn)].sort(), [...here].sort())
/* Felicia is drawn twice on purpose: head of Sales and lead of Marketing are two posts. */
check('...and only the head-who-leads twice', drawn.filter((id, i) => drawn.indexOf(id) !== i), ['felicia'])

/* ---------------------------------------------------------------- inactive excluded */
for (const gone of ['left-agent', 'gone-lead', 'gone-head', 'left-nomad']) {
  ok(`${gone} (left) is nowhere on it`, !drawn.includes(gone))
}
check('the headcount is who is still here', chart.headcount, here.length)
check('a department’s headcount includes its head and leaves out who left', dept('Call centre')?.headcount, 6)

/* ---------------------------------------------------------------- one department */
const cc = buildOrganogram(DEPTS, TEAMS, PEOPLE, 'cc')
check('one department draws that department only', cc.departments.map((d) => d.name), ['Call centre'])
check('...without the people in no department', cc.unplaced, [])
check('...and counts its own people', cc.headcount, 6)
check('a department nobody recognises draws nothing, not the company', buildOrganogram(DEPTS, TEAMS, PEOPLE, 'nope').departments, [])
check('a team’s department, for "View organogram" on its pane', departmentOfTeam('mkt', TEAMS), 'sal')
check('...and nothing for a team that is not there', departmentOfTeam('nope', TEAMS), undefined)

/* ---------------------------------------------------------------- the fold */
const n = (k) => Array.from({ length: k }, (_, i) => i)
check('eight is the fold', FOLD_AT, 8)
check('eight people are all shown', foldPeople(n(8), false), { shown: n(8), hidden: 0 })
check('nine fold to seven and "+2 more" -- never "+1 more"', foldPeople(n(9), false), { shown: n(7), hidden: 2 })
check('twenty fold to seven and "+13 more"', foldPeople(n(20), false).hidden, 13)
check('opened, everybody', foldPeople(n(20), true).shown.length, 20)

/* ---------------------------------------------------------------- the screen */
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
const settings = read('src/pages/settings/SettingsPage.tsx')
const screen = read('src/components/settings/Organogram.tsx')
const panes = read('src/components/settings/DepartmentsTeams.tsx')
ok('Users has a third tab, Organogram, in the URL', /\{ id: 'organogram', label: 'Organogram' \}/.test(settings))
ok('...drawing the organogram', /section === 'organogram' && <OrganogramTab \/>/.test(settings))
ok('the drawing is built by buildOrganogram, not by hand', /buildOrganogram\(departments, teams, users, focus\)/.test(screen))
/* READ-ONLY: nothing on it writes. A store write or a Supabase call here is a second place to edit. */
ok('the organogram writes nothing', !/update(User|Team|Department)|add(Team|Department)|delete(Team|Department)|supabase/.test(screen))
ok('the company view scrolls in its own box, not the page', /overflow-x-auto/.test(screen) && /w-max min-w-full/.test(screen))
ok('a vacant post is drawn in the firm’s words', /"No head yet"/.test(screen) && /"No lead yet"/.test(screen))
ok('a department pane offers "View organogram"', /testid="department-view-organogram"/.test(panes))
ok('...and a team pane, with that team lit', /testid="team-view-organogram"/.test(panes) && /keep\.set\('team', teamId\)/.test(panes))
ok('...both opening the tab on that department', /keep\.set\('users', 'organogram'\)/.test(panes) && /keep\.set\('dept', deptId\)/.test(panes))

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-organogram: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
