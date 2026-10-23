/**
 * THE ORGANOGRAM -- THE FIRM'S STRUCTURE AS A TREE, READ-ONLY.
 *
 * THE FIRM (Stephan, 23 Oct): "it should show ... an organogram, like of the departments, maybe of
 * the company ... like you see all users, departments and team, and then organogram. And then you can
 * go to the specific organograms, or ... if you go to the call center and you say view organogram."
 *
 * The rows are orgStructure.ts's; this file only decides how they HANG. Company -> department (its
 * head) -> team (its lead) -> the team's people, then whoever in the department has no team, then
 * whoever is in no department at all. Pure, so check-organogram holds the grouping without a browser.
 *
 * FIVE DECISIONS, each one a thing a drawing could quietly get wrong:
 *   1. THE HEAD IS DRAWN ONCE, at the top of the department. They are also a member of a team, often
 *      (the database puts a head IN the department, and a manager usually sits in one of its teams),
 *      and drawing them again in that team's people reads as two people. They stay as a team's LEAD
 *      when they hold that post -- that is a post, not a membership, and hiding it would draw the
 *      team as leaderless.
 *   2. THE LEAD IS FIRST: their own node above the team's people, never one of them.
 *   3. A VACANT POST IS DRAWN, not dropped. "No head yet" / "No lead yet" is a thing to go and fix;
 *      a department with no head node reads as a drawing that forgot one. A head or lead who has
 *      LEFT (Inactive) is a vacant post too -- the post is empty in every way that matters.
 *   4. PEOPLE WHO HAVE LEFT ARE NOT ON IT. An organogram is who works here.
 *   5. NOBODY FALLS OFF. In no department, or in one that did not load, is its own group -- the same
 *      rule groupByStoredDepartment keeps on All users.
 */
import type { DepartmentRow, Team, User } from '../types'
import { membersOfDepartment, membersOfTeam, sortDepartments, teamsIn, withoutTeam } from './orgStructure.ts'
import { rankOf } from './departments.ts'

type Person = Pick<User, 'id' | 'name' | 'role' | 'status' | 'teamId' | 'departmentId'>
type TeamLike = Pick<Team, 'id' | 'name' | 'kind' | 'departmentId' | 'leadId'>
type DeptLike = Pick<DepartmentRow, 'id' | 'name' | 'headId' | 'duties' | 'sort'>

export interface OrgTeamNode<P> {
  id: string
  name: string
  /** Null is a vacant post, drawn as "No lead yet". */
  lead: P | null
  /** The team's people under the lead: never the lead, never the department's head. */
  members: P[]
}

export interface OrgDepartmentNode<P> {
  id: string
  name: string
  /** Null is a vacant post, drawn as "No head yet". */
  head: P | null
  teams: OrgTeamNode<P>[]
  /** In the department, in none of its teams, and not its head. */
  withoutTeam: P[]
  /** Everybody still here in the department, head included -- the number on its node. */
  headcount: number
}

export interface Organogram<P> {
  departments: OrgDepartmentNode<P>[]
  /** In no department (or one that is not loaded). Empty when the drawing is one department's. */
  unplaced: P[]
  /** Everybody still here who is on this drawing. */
  headcount: number
}

const live = (p: Pick<User, 'status'>) => p.status !== 'Inactive'

/**
 * A post's holder, looked up among the people STILL HERE -- so somebody who has left holds nothing
 * and the post is drawn vacant (decision 3). Handed everybody, it would draw a leaver as head.
 */
function holder<P extends Person>(id: string | undefined, here: P[]): P | null {
  return (id && here.find((x) => x.id === id)) || null
}

/**
 * THE TREE. `focus` draws one department's organogram (the "View organogram" from its pane); a
 * department id that does not exist draws nothing rather than the whole company, because a link
 * that silently answers a different question is worse than an empty one -- the caller offers the
 * picker back.
 */
export function buildOrganogram<P extends Person>(
  departments: DeptLike[],
  teams: TeamLike[],
  people: P[],
  focus?: string,
): Organogram<P> {
  const here = people.filter(live)
  const chosen = sortDepartments(departments).filter((d) => !focus || d.id === focus)
  const nodes = chosen.map((d): OrgDepartmentNode<P> => {
    const head = holder(d.headId, here)
    const inDept = membersOfDepartment(d.id, here)
    const notHead = (p: P) => p.id !== head?.id
    return {
      id: d.id,
      name: d.name,
      head,
      teams: teamsIn(d.id, teams).map((t) => {
        const lead = holder(t.leadId, here)
        return {
          id: t.id,
          name: t.name,
          lead,
          members: membersOfTeam(t.id, inDept).filter((p) => p.id !== lead?.id && notHead(p)),
        }
      }),
      withoutTeam: withoutTeam(d.id, inDept).filter(notHead),
      headcount: inDept.length,
    }
  })
  const known = new Set(departments.map((d) => d.id))
  const unplaced = focus ? [] : here
    .filter((p) => !p.departmentId || !known.has(p.departmentId))
    .sort((a, b) => rankOf(a.role) - rankOf(b.role) || a.name.localeCompare(b.name))
  return {
    departments: nodes,
    unplaced,
    headcount: nodes.reduce((n, d) => n + d.headcount, 0) + unplaced.length,
  }
}

/**
 * THE PEOPLE UNDER A LEAD, FOLDED PAST EIGHT -- the call centre's biggest team is a column of names
 * longer than the screen. Folded, the "+N more" takes the eighth place rather than adding a ninth,
 * so a folded group is never taller than an unfolded group of eight -- and it never says "+1 more",
 * which costs the same room as the one name it hides.
 */
export const FOLD_AT = 8
export function foldPeople<P>(people: P[], open: boolean, at = FOLD_AT): { shown: P[]; hidden: number } {
  if (open || people.length <= at) return { shown: people, hidden: 0 }
  return { shown: people.slice(0, at - 1), hidden: people.length - (at - 1) }
}

/** Which department a team is in, for "View organogram" on a team's pane. */
export function departmentOfTeam(teamId: string, teams: TeamLike[]): string | undefined {
  return teams.find((t) => t.id === teamId)?.departmentId
}
