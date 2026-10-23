/**
 * ALL USERS, DEPARTMENTS, TEAMS -- THE FIRM'S STRUCTURE, AS ROWS.
 *
 * THE FIRM (Stephan, 23 Oct): "We have all users, which is all of our staff. Then we have
 * departments, then we have teams. In the departments. So every department has a head, and then every
 * team has a lead." And: "There should be an option to create a department. To create a team and to
 * set the team lead."
 *
 * NOT departments.ts. That file reads a department off the ROLE and still decides what the role
 * decides -- which dashboard opens, who collects, which kind of team a role may join. This one is the
 * structure the firm DRAWS: departments they name, a head each, teams inside them with a lead each.
 * Two answers to "which department?" exist on purpose; neither grants anything (a department's
 * duties do, narrowly -- see duties.ts).
 *
 * THE FOUR RULES (held in the database too; see the migration of 23 Oct in schema.sql):
 *   1. a team's members are in the team's department -- a person's department follows their team;
 *   2. a team's lead is one of its members;
 *   3. a department's head is in the department;
 *   4. a department or team is removed only when it is empty.
 *
 * Pure, so check-departments-teams can hold every rule without a browser.
 */
import type { DepartmentRow, Team, TeamKind, User } from '../types'
import { guessTeamKind, rankOf } from './departments.ts'
import { DUTY_ORDER, isDuty } from './duties.ts'

type Person = Pick<User, 'id' | 'name' | 'role' | 'status' | 'teamId' | 'departmentId'>
type TeamLike = Pick<Team, 'id' | 'name' | 'kind' | 'departmentId' | 'leadId'>
type DeptLike = Pick<DepartmentRow, 'id' | 'name' | 'headId' | 'duties' | 'sort'>

/** "1 member", "3 members" -- the screen said "1 members". */
export function countOf(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

const live = <P extends Pick<User, 'status'>>(p: P) => p.status !== 'Inactive'

/** Departments in the firm's order: their own sort, then name. */
export function sortDepartments<D extends DeptLike>(departments: D[]): D[] {
  return [...departments].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
}

export function teamsIn<T extends TeamLike>(departmentId: string, teams: T[]): T[] {
  return teams.filter((t) => t.departmentId === departmentId).sort((a, b) => a.name.localeCompare(b.name))
}

/** The people still here, ladder first then name -- the order the Users list has always drawn. */
function ordered<P extends Person>(people: P[]): P[] {
  return people.filter(live).sort((a, b) => rankOf(a.role) - rankOf(b.role) || a.name.localeCompare(b.name))
}

export function membersOfDepartment<P extends Person>(departmentId: string, people: P[]): P[] {
  return ordered(people.filter((p) => p.departmentId === departmentId))
}

export function membersOfTeam<P extends Person>(teamId: string, people: P[]): P[] {
  return ordered(people.filter((p) => p.teamId === teamId))
}

/** "Without a team": in this department, in none of its teams. */
export function withoutTeam<P extends Person>(departmentId: string, people: P[]): P[] {
  return ordered(people.filter((p) => p.departmentId === departmentId && !p.teamId))
}

/** Still here and in no department at all -- drawn as its own bucket rather than hidden. */
export function withoutDepartment<P extends Person>(people: P[]): P[] {
  return ordered(people.filter((p) => !p.departmentId))
}

/**
 * The department a person is in, AS THE DATABASE WILL HAVE IT: their team's when they have one
 * (rule 1 -- profile_team_department sets it from the team), else what they were put in.
 */
export function departmentFor(person: Pick<User, 'teamId' | 'departmentId'>, teams: TeamLike[]): string | undefined {
  if (person.teamId) return teams.find((t) => t.id === person.teamId)?.departmentId ?? person.departmentId
  return person.departmentId
}

/**
 * The patch that puts somebody in a department, or a team -- both fields, always, so the screen
 * shows what the database will do rather than what was asked. A new department drops the team
 * (it was in the old one); a team brings its department with it.
 */
export function placeInDepartment(departmentId: string | undefined): Pick<User, 'departmentId' | 'teamId'> {
  return { departmentId, teamId: undefined }
}
export function placeInTeam(team: TeamLike | undefined, current: Pick<User, 'departmentId'>): Pick<User, 'departmentId' | 'teamId'> {
  if (!team) return { teamId: undefined, departmentId: current.departmentId }
  return { teamId: team.id, departmentId: team.departmentId }
}

/**
 * WHO THIS PERSON'S TEAM LEAD IS, and their department's head -- the TS twin of team_lead_of() and
 * department_head_of() in the database. Leave reads a leader off the ROLE today (a parallel session);
 * these are what it should read at merge (HANDOFF §4).
 */
export function teamLeadOf(userId: string, people: Person[], teams: TeamLike[]): string | undefined {
  const me = people.find((p) => p.id === userId)
  return me?.teamId ? teams.find((t) => t.id === me.teamId)?.leadId : undefined
}
export function departmentHeadOf(userId: string, people: Person[], departments: DeptLike[]): string | undefined {
  const me = people.find((p) => p.id === userId)
  return me?.departmentId ? departments.find((d) => d.id === me.departmentId)?.headId : undefined
}

/** The duties this person carries, from their department. What AuthContext puts on currentUser. */
export function dutiesFor(person: Pick<User, 'departmentId'> | null | undefined, departments: DeptLike[]): string[] {
  if (!person?.departmentId) return []
  return (departments.find((d) => d.id === person.departmentId)?.duties ?? []).filter(isDuty)
}

/** Rule 4. Said as a sentence, because the button that cannot act says why. */
export function whyNotRemoveDepartment(d: DeptLike, teams: TeamLike[], people: Person[]): string | null {
  const t = teams.filter((x) => x.departmentId === d.id).length
  const p = people.filter((x) => x.departmentId === d.id).length
  if (t === 0 && p === 0) return null
  const parts = [t > 0 ? countOf(t, 'team') : null, p > 0 ? countOf(p, 'person', 'people') : null].filter(Boolean)
  return `${d.name} still has ${parts.join(' and ')} in it. Move them first.`
}
export function whyNotRemoveTeam(t: TeamLike, people: Person[]): string | null {
  const p = people.filter((x) => x.teamId === t.id).length
  return p === 0 ? null : `${t.name} still has ${countOf(p, 'person', 'people')} in it. Move them first.`
}

/**
 * THE KIND A NEW TEAM IN THIS DEPARTMENT SHOULD BE, offered rather than decided. The kind is who may
 * JOIN (a call-centre team takes call-centre roles, the database's profiles_team_matches_role), and a
 * department's teams are almost always one kind -- so: what its other teams agree on, else what the
 * department's name sounds like, else what the team's name does, else ask.
 */
export function suggestedKind(departmentId: string, deptName: string, teamName: string, teams: TeamLike[]): TeamKind | null {
  const kinds = new Set(teams.filter((t) => t.departmentId === departmentId).map((t) => t.kind))
  if (kinds.size === 1) return [...kinds][0]
  return guessTeamKind(deptName) ?? guessTeamKind(teamName)
}

/**
 * EVERY WAY THE STRUCTURE CAN BE WRONG, as sentences. Empty is right. The database refuses each of
 * these on write; this is what check-departments-teams holds the rules with, and what the screen
 * could show if a row arrived broken from somewhere that is not this screen.
 */
export function structureProblems(departments: DeptLike[], teams: TeamLike[], people: Person[]): string[] {
  const out: string[] = []
  const dept = new Map(departments.map((d) => [d.id, d]))
  for (const t of teams) {
    if (!t.departmentId || !dept.has(t.departmentId)) out.push(`${t.name} is in no department.`)
    if (t.leadId) {
      const lead = people.find((p) => p.id === t.leadId)
      if (!lead || lead.teamId !== t.id) out.push(`${t.name}'s lead is not one of its members.`)
    }
  }
  for (const p of people) {
    if (!p.teamId) continue
    const t = teams.find((x) => x.id === p.teamId)
    if (t && p.departmentId !== t.departmentId) out.push(`${p.name} is in ${t.name} but not in its department.`)
  }
  for (const d of departments) {
    if (d.headId) {
      const head = people.find((p) => p.id === d.headId)
      if (!head || head.departmentId !== d.id) out.push(`${d.name}'s head is not in it.`)
    }
    const unknown = d.duties.filter((x) => !isDuty(x))
    if (unknown.length) out.push(`${d.name} carries a duty nobody built: ${unknown.join(', ')}.`)
    if (new Set(d.duties).size !== d.duties.length) out.push(`${d.name} carries a duty twice.`)
  }
  return out
}

/**
 * ALL USERS, GROUPED BY THE DEPARTMENT THEY SIT IN -- the stored one, in the firm's order, with the
 * call-centre ladder inside each (rankOf) and "Not in a department" last. People who have left are
 * set apart exactly as byDepartment sets them apart.
 *
 * NULL WHEN THERE ARE NO DEPARTMENTS AT ALL, so the caller falls back to the role's reading
 * (byDepartment) rather than drawing a hundred people under "Not in a department" because a table
 * did not load.
 */
export function groupByStoredDepartment<P extends Person>(
  everyone: P[],
  departments: DeptLike[],
  headName: (id: string | undefined) => string | undefined,
): { departments: { meta: { id: string; label: string; blurb: string }; people: P[] }[]; archived: P[] } | null {
  if (departments.length === 0) return null
  const archived = everyone.filter((u) => u.status === 'Inactive').sort((a, b) => a.name.localeCompare(b.name))
  const groups = sortDepartments(departments).map((d) => ({
    meta: {
      id: d.id,
      label: d.name,
      blurb: headName(d.headId) ? `Head: ${headName(d.headId)}` : 'No head yet',
    },
    people: membersOfDepartment(d.id, everyone),
  }))
  const known = new Set(departments.map((d) => d.id))
  const nowhere = ordered(everyone.filter((p) => !p.departmentId || !known.has(p.departmentId)))
  if (nowhere.length > 0) {
    groups.push({
      meta: { id: 'none', label: 'Not in a department', blurb: 'Choose a department on their row.' },
      people: nowhere,
    })
  }
  return { departments: groups.filter((g) => g.people.length > 0), archived }
}

/** The duties, ticked or not, in the order the screen draws them. */
export function dutyTicks(d: DeptLike): { duty: (typeof DUTY_ORDER)[number]; on: boolean }[] {
  return DUTY_ORDER.map((duty) => ({ duty, on: d.duties.includes(duty) }))
}
