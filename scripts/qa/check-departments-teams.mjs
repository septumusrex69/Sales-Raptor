/**
 * ALL USERS, DEPARTMENTS, TEAMS -- THE FIRM'S STRUCTURE, AND THE ONE WAY IT TOUCHES PERMISSIONS.
 *
 * THE FIRM (Stephan, 23 Oct): "We have all users, which is all of our staff. Then we have departments,
 * then we have teams. In the departments. So every department has a head, and then every team has a
 * lead. ... a department, for example, like reception, which is just one person. But they have other
 * certain functionalities ... the transferring the call and transferring an account."
 *
 * WHAT THIS GUARDS:
 *   - THE FOUR RULES (orgStructure.ts, and the triggers in schema.sql): a team's lead is a member; a
 *     department's head is in it; a team's members are in the team's department; removed only empty.
 *   - DUTIES ARE A CLOSED LIST, the same in the browser and in the database, both directions.
 *   - A DUTY CANNOT REACH MONEY, PAY OR SETTINGS: what a duty may grant is book work only, the second
 *     fence holds even if the first is widened by mistake, and a revoke still beats a duty.
 *   - reassign_accounts PASSES THE SAME GATE THE HAND-OUT USES (canHandOutAccounts / book.hand_out),
 *     in TS and in has_capability().
 *   - A PERSON CANNOT MOVE THEMSELVES INTO A DEPARTMENT (it carries duties).
 *   - ONE SETTINGS ITEM: the Teams tab is gone and its links land on Departments & teams.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-departments-teams.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import {
  countOf, departmentFor, departmentHeadOf, dutiesFor, groupByStoredDepartment, placeInDepartment,
  placeInTeam, structureProblems, suggestedKind, teamLeadOf, whyNotRemoveDepartment, whyNotRemoveTeam,
  withoutDepartment, withoutTeam,
} from '../../src/lib/orgStructure.ts'
import { DUTIES, DUTY_CAPABILITIES, DUTY_MAY_GRANT, DUTY_ORDER, dutyCapabilities } from '../../src/lib/duties.ts'
import { CAPABILITIES, can, capabilitiesOf } from '../../src/lib/capabilities.ts'
import { canHandOutAccounts, canReassign, canViewFinance, canViewPay } from '../../src/lib/permissions.ts'
import { ROLE_DEPARTMENTS } from '../../src/lib/departments.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

/* ------------------------------------------------ the four rules, as a pure function */

const SALES = { id: 'd-sales', name: 'Sales', headId: 'felicia', duties: [], sort: 1 }
const RECEPTION = { id: 'd-rec', name: 'Reception', headId: 'nomsa', duties: ['transfer_calls', 'reassign_accounts'], sort: 4 }
const MARKETING = { id: 't-mkt', name: 'Marketing', kind: 'Sales', departmentId: 'd-sales', leadId: 'felicia' }
const person = (id, name, role, teamId, departmentId, status = 'Active') => ({ id, name, role, teamId, departmentId, status })
const PEOPLE = [
  person('felicia', 'Felicia', 'Sales Manager', 't-mkt', 'd-sales'),
  person('ryno', 'Ryno', 'Sales Representative', 't-mkt', 'd-sales'),
  person('nomsa', 'Nomsa', 'Administrator', undefined, 'd-rec'),
  person('loose', 'Loose', 'Pre-legal Agent', undefined, undefined),
  person('gone', 'Gone', 'Pre-legal Agent', undefined, undefined, 'Inactive'),
]
const DEPTS = [SALES, RECEPTION]
const TEAMS = [MARKETING]

check('a correct structure has no problems', structureProblems(DEPTS, TEAMS, PEOPLE), [])

/* BREAK EACH RULE, one at a time, and the problem must name it. */
const p1 = structureProblems(DEPTS, [{ ...MARKETING, leadId: 'nomsa' }], PEOPLE)
ok('rule 2: a lead who is not a member is a problem', p1.some((x) => /lead is not one of its members/.test(x)))
const p2 = structureProblems([{ ...SALES, headId: 'nomsa' }, RECEPTION], TEAMS, PEOPLE)
ok('rule 3: a head outside the department is a problem', p2.some((x) => /head is not in it/.test(x)))
const p3 = structureProblems(DEPTS, TEAMS, PEOPLE.map((p) => (p.id === 'ryno' ? { ...p, departmentId: 'd-rec' } : p)))
ok('rule 1: a member outside the team’s department is a problem', p3.some((x) => /Ryno is in Marketing but not in its department/.test(x)))
const p4 = structureProblems(DEPTS, [{ ...MARKETING, departmentId: undefined }], PEOPLE)
ok('...and a team in no department is one too', p4.some((x) => /Marketing is in no department/.test(x)))
const p5 = structureProblems([{ ...RECEPTION, duties: ['finance.view'] }, SALES], TEAMS, PEOPLE)
ok('a duty outside the closed list is a problem', p5.some((x) => /duty nobody built: finance\.view/.test(x)))
const p6 = structureProblems([{ ...RECEPTION, duties: ['transfer_calls', 'transfer_calls'] }, SALES], TEAMS, PEOPLE)
ok('...and so is the same duty twice', p6.some((x) => /twice/.test(x)))

/* Rule 4, said as a sentence. */
check('a department with people cannot go', whyNotRemoveDepartment(SALES, TEAMS, PEOPLE),
  'Sales still has 1 team and 2 people in it. Move them first.')
check('an empty department can', whyNotRemoveDepartment({ ...SALES, id: 'd-empty' }, TEAMS, PEOPLE), null)
check('a team with people cannot go', whyNotRemoveTeam(MARKETING, PEOPLE), 'Marketing still has 2 people in it. Move them first.')
check('an empty team can', whyNotRemoveTeam({ ...MARKETING, id: 't-empty' }, PEOPLE), null)

/* "1 members", the plural the firm saw. */
check('one member', countOf(1, 'member'), '1 member')
check('two members', countOf(2, 'member'), '2 members')
check('one person', countOf(1, 'person', 'people'), '1 person')

/* A department follows the team; a new department drops the team. */
check('a team brings its department', placeInTeam(MARKETING, { departmentId: 'd-rec' }), { teamId: 't-mkt', departmentId: 'd-sales' })
check('no team keeps the department', placeInTeam(undefined, { departmentId: 'd-rec' }), { teamId: undefined, departmentId: 'd-rec' })
check('a new department drops the team', placeInDepartment('d-rec'), { departmentId: 'd-rec', teamId: undefined })
check('the department a person is in is their team’s', departmentFor({ teamId: 't-mkt', departmentId: 'd-rec' }, TEAMS), 'd-sales')

/* Without a team / not in a department, never hiding people who have left inside either. */
check('reception’s one person is "without a team"', withoutTeam('d-rec', PEOPLE).map((p) => p.id), ['nomsa'])
check('not in a department: the live ones only', withoutDepartment(PEOPLE).map((p) => p.id), ['loose'])

/* The leave helpers' TS twin. */
check('Ryno’s lead is Felicia', teamLeadOf('ryno', PEOPLE, TEAMS), 'felicia')
check('somebody without a team has no lead', teamLeadOf('nomsa', PEOPLE, TEAMS), undefined)
check('Nomsa’s head is herself (reception, one person)', departmentHeadOf('nomsa', PEOPLE, DEPTS), 'nomsa')

/* A new team's kind: the department's other teams, else the names, else asked. */
check('a team in Sales is a sales team', suggestedKind('d-sales', 'Sales', 'Anything', TEAMS), 'Sales')
check('a department named for the floor', suggestedKind('d-x', 'Call centre', 'Alpha', TEAMS), 'Call centre')
check('...and nothing to go on is asked', suggestedKind('d-x', 'Reception', 'Front desk', TEAMS), null)

/* The users list groups by the stored department; with none at all it says so (null -> fallback). */
check('no departments loaded: the caller falls back to the role', groupByStoredDepartment(PEOPLE, [], () => undefined), null)
const g = groupByStoredDepartment(PEOPLE, DEPTS, (id) => PEOPLE.find((p) => p.id === id)?.name)
check('grouped in the firm’s order, the homeless last', g.departments.map((x) => x.meta.label), ['Sales', 'Reception', 'Not in a department'])
check('...with the ladder inside', g.departments[0].people.map((p) => p.id), ['felicia', 'ryno'])
check('...the head on the heading', g.departments[1].meta.blurb, 'Head: Nomsa')
check('...and the people who left set apart', g.archived.map((p) => p.id), ['gone'])

/* ------------------------------------------------ duties: closed, and never money */

const schema = read('supabase/schema.sql')
const lastFn = (name) => {
  const at = schema.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  /* The body is the first $$ ... $$ after the header -- every function here is written that way. */
  const open = schema.indexOf('$$', at)
  const close = schema.indexOf('$$', open + 2)
  return open < 0 || close < 0 ? '' : schema.slice(at, close + 2)
}

/* load_handovers (23 Oct): "any person in the client liaison department can upload a handover sheet". */
check('the duties are the three the firm named', [...DUTY_ORDER].sort(), ['load_handovers', 'reassign_accounts', 'transfer_calls'])
ok('...each with a label and a sentence', DUTY_ORDER.every((d) => DUTIES[d].label && DUTIES[d].blurb.length > 30))

/* THE LAST ONE: the constraint is replaced each time a duty arrives, and schema.sql is append-only. */
const known = [...schema.matchAll(/departments_duties_known\s+check \(duties <@ array\[([^\]]+)\]/g)].at(-1)
ok('the database holds the duties closed', !!known)
check('...to exactly the same list, both directions',
  [...(known?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort(), [...DUTY_ORDER].sort())

const grantableSql = lastFn('duty_grantable')
ok('duty_grantable() is there', grantableSql.length > 0)
check('...and allows what DUTY_MAY_GRANT allows',
  [...grantableSql.matchAll(/'([a-z]+\.[a-z_]+)'/g)].map((m) => m[1]).sort(), [...DUTY_MAY_GRANT].sort())

const mapSql = lastFn('duty_capabilities')
ok('duty_capabilities() is there', mapSql.length > 0)
for (const d of DUTY_ORDER) {
  const arm = new RegExp(`when '${d}' then array\\[([^\\]]*)\\]`).exec(mapSql)
  ok(`the database maps ${d}`, !!arm)
  check(`...to what the browser maps it to`, [...(arm?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort(), [...DUTY_CAPABILITIES[d]].sort())
}
ok('...and filters by duty_grantable() as a second fence', /where c = any\(public\.duty_grantable\(\)\)/.test(mapSql))

/* NEVER MONEY. Judged by the capability's own group, so a new money tick is caught without this
   file being edited, and by name for the prefixes that are money or people whatever group says. */
const forbidden = (c) => CAPABILITIES[c]?.group === 'Money' || /^(finance|business|people|payment)\./.test(c)
check('a duty may grant nothing in the Money group', DUTY_MAY_GRANT.filter(forbidden), [])
check('...nor does any duty try to', DUTY_ORDER.flatMap((d) => DUTY_CAPABILITIES[d]).filter(forbidden), [])
check('...and what it grants is a real capability', DUTY_MAY_GRANT.filter((c) => !(c in CAPABILITIES)), [])

/* THE SECOND FENCE, BROKEN ON PURPOSE: widen a duty to the trust account and it still does not get it. */
DUTY_CAPABILITIES.reassign_accounts.push('finance.view')
check('a duty widened by mistake still cannot reach the trust account',
  dutyCapabilities(['reassign_accounts']).includes('finance.view'), false)
DUTY_CAPABILITIES.reassign_accounts.pop()

/* ------------------------------------------------ reassign_accounts = the hand-out gate */

const agent = { role: 'Pre-legal Agent', grants: [], revokes: [] }
check('an agent cannot hand out by role', canHandOutAccounts(agent), false)
check('...an agent in a department that moves accounts can', canHandOutAccounts({ ...agent, duties: ['reassign_accounts'] }), true)
check('...through the same capability', can({ ...agent, duties: ['reassign_accounts'] }, 'book.hand_out'), true)
check('...which is not the sales side’s reassign (RLS decides that by role)', canReassign({ ...agent, duties: ['reassign_accounts'] }), false)
check('transferring calls grants nothing yet', [...capabilitiesOf({ ...agent, duties: ['transfer_calls'] })].sort(), [...capabilitiesOf(agent)].sort())
check('a revoke beats a duty', canHandOutAccounts({ ...agent, duties: ['reassign_accounts'], revokes: ['book.hand_out'] }), false)
check('an unknown duty grants nothing', [...capabilitiesOf({ ...agent, duties: ['finance.view', 'people.pay'] })].sort(), [...capabilitiesOf(agent)].sort())
check('every duty at once still sees no trust account', canViewFinance({ ...agent, duties: DUTY_ORDER }), false)
check('...and no pay', canViewPay({ ...agent, duties: DUTY_ORDER }), false)
check('dutiesFor reads the department', dutiesFor({ departmentId: 'd-rec' }, DEPTS), ['transfer_calls', 'reassign_accounts'])
check('...and drops a duty nobody built', dutiesFor({ departmentId: 'd-rec' }, [{ ...RECEPTION, duties: ['finance.view'] }]), [])

/* has_capability() reads the duty, and the revoke stays last. Presence before order. */
const hc = lastFn('has_capability')
const dutyAt = hc.indexOf('public.duty_capabilities(u.duty)')
const revokeAt = hc.indexOf('p.revokes')
ok('has_capability reads the department’s duties', dutyAt > 0)
/* The whole branch, OR'd in as written -- "or false and exists (...)" would keep every word above. */
ok('...through the closed map, as a branch that can actually pass',
  /\n\s+or exists \(\s*select 1 from public\.departments d, unnest\(d\.duties\) as u\(duty\)\s*where d\.id = p\.department_id\s*and p_capability = any\(public\.duty_capabilities\(u\.duty\)\)\)/.test(hc))
ok('...and the revoke is there', revokeAt > 0)
ok('...after the duty, so it wins', dutyAt > 0 && revokeAt > dutyAt)
ok('...still answering only about auth.uid()', /where p\.id = auth\.uid\(\)/.test(hc) && /has_capability\(p_capability text\)/.test(hc))

/* ------------------------------------------------ the database side of the rules */

const ptd = lastFn('profile_team_department')
ok('a person’s department is set from their team', /select t\.department_id into new\.department_id from public\.teams t where t\.id = new\.team_id/.test(ptd))
ok('...a lead cannot leave their team', /t\.lead_id = new\.id/.test(ptd) && /choose another lead/.test(ptd))
ok('...a head cannot leave their department', /d\.head_id = new\.id/.test(ptd) && /choose another head/.test(ptd))
/* Before-triggers fire in NAME order; read both names off the schema rather than trusting a literal. */
const beforeProfiles = [...schema.matchAll(/create trigger (\w+)\s+before (?:insert or )?update[^;]*?on public\.profiles/g)].map((m) => m[1])
const guardName = beforeProfiles.find((n) => n === 'protect_profile_privileged_fields')
const followName = beforeProfiles.find((n) => n === 'protect_profile_team_department')
ok('both before-triggers on profiles are there', !!guardName && !!followName)
ok('...and the department one fires after the privileged-fields guard (name order)',
  !!guardName && !!followName && followName.localeCompare(guardName) > 0)
ok('a lead must be a member', /p\.id = new\.lead_id and p\.team_id = new\.id/.test(lastFn('team_lead_is_member')))
ok('a head must be in the department', /p\.id = new\.head_id and p\.department_id = new\.id/.test(lastFn('department_head_is_member')))
ok('moving a team moves its people', /set department_id = new\.department_id\s+where team_id = new\.id/.test(lastFn('team_department_moves_members')))
const occ = lastFn('refuse_removing_occupied')
ok('an occupied team is not removed', /tg_table_name = 'teams' and exists \(select 1 from public\.profiles p where p\.team_id = old\.id\)/.test(occ))
ok('...nor an occupied department', /tg_table_name = 'departments'/.test(occ) && /t\.department_id = old\.id/.test(occ))
ok('...wired to both tables', /teams_removed_only_when_empty before de' \|\| 'lete on public\.teams/.test(schema)
  && /departments_removed_only_when_empty before de' \|\| 'lete on public\.departments/.test(schema))

/* RLS: read by anybody signed in, written by an Administrator. */
ok('departments are read by anybody signed in',
  /create policy "departments_select" on public\.departments for select using \(auth\.uid\(\) is not null\)/.test(schema))
ok('...and written by an Administrator only',
  /create policy "departments_write" on public\.departments for all\s+using \(public\.current_user_role\(\) = 'Administrator'\)\s+with check \(public\.current_user_role\(\) = 'Administrator'\)/.test(schema))
ok('...with RLS switched on', /alter table public\.departments enable row level security/.test(schema))
/* A person cannot move themselves into a department that carries a duty. */
const guard = lastFn('protect_profile_privileged_fields')
ok('a person cannot change their own department', /new\.department_id := old\.department_id/.test(guard))
ok('...inside the not-an-Administrator branch',
  guard.indexOf("is distinct from 'Administrator'") > 0 && guard.indexOf('new.department_id := old.department_id') > guard.indexOf("is distinct from 'Administrator'"))

/* The seed's role map is the browser's. */
const rd = lastFn('role_department')
for (const [role, dept] of Object.entries(ROLE_DEPARTMENTS)) {
  if (dept === 'Other') ok(`${role} has no department in SQL either`, !new RegExp(`when '${role}' then`).test(rd))
  else ok(`${role} -> ${dept} in SQL too`, new RegExp(`when '${role}' then '${dept}'`).test(rd))
}

/* The leave helpers exist, for the merge. */
ok('team_lead_of() exists', lastFn('team_lead_of').includes('t.lead_id'))
ok('department_head_of() exists', lastFn('department_head_of').includes('d.head_id'))

/* ------------------------------------------------ the browser carries it */

const auth = read('src/store/AuthContext.tsx')
ok('the signed-in person’s department is mapped', /departmentId: row\.department_id \?\? undefined/.test(auth))
ok('...and their department’s duties', /duties: departmentDuties/.test(auth) && /from\('departments'\)\.select\('duties'\)/.test(auth))
const store = read('src/store/AppStore.tsx')
ok('the store loads departments', /fetchTable<DepartmentRow>\('departments'/.test(store))
ok('...and refreshPeople re-reads them', /const refreshPeople[\s\S]{0,400}?fetchTable<DepartmentRow>\('departments'/.test(store))
/* The people list carries NO duties: CapabilitiesModal saves capabilitiesOf(user) back as grants. */
ok('the people list is never given duties', !/dutiesFor\(/.test(store) && !/duties: /.test(store.slice(store.indexOf('const teams = useMemo'), store.indexOf('const teams = useMemo') + 400)))

/* ------------------------------------------------ one Settings item */

const settings = read('src/pages/settings/SettingsPage.tsx')
const tabs = /const TABS = \[([^\]]+)\]/.exec(settings)?.[1] ?? ''
ok('the TABS list is readable', tabs.includes("'Users'"))
ok('there is no Teams tab any more', !tabs.includes("'Teams'"))
ok('...and its old links land on Departments & teams', /fromUrl === 'Teams'/.test(settings) && /keep\.set\('users', 'departments'\)/.test(settings))
ok('Users has two tabs: All users and Departments & teams',
  /label: 'All users'/.test(settings) && /label: 'Departments & teams'/.test(settings))
ok('...the second is the structure screen', /<DepartmentsTeamsTab \/>/.test(settings))
ok('All users shows a Department column', /<th className="font-medium px-2 py-2">Department<\/th>/.test(settings))
const org = read('src/components/settings/DepartmentsTeams.tsx')
ok('a department is created there', /data-testid="add-department"/.test(org))
ok('...and a team, asked which department', /data-testid="add-team"/.test(org) && /data-testid="new-team-department"/.test(org))
ok('the plurals are counted, not glued', !/memberIds\.length\} members/.test(org) && !/memberIds\.length\} members/.test(settings))
ok('the words are the firm’s', /'No head yet'/.test(org) && /'No lead yet'/.test(org) && /Without a team/.test(org))
ok('the tree and the pane stack on a narrow screen', /grid gap-4 lg:grid-cols-/.test(org))

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-departments-teams: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
