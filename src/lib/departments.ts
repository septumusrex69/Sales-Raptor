/**
 * WHICH PART OF THE FIRM SOMEBODY WORKS IN.
 *
 * The firm, once the list passed a hundred people: "we need to categorise them ... so we have
 * administrators, we have a reception which is also kind of an administrator ... then we have a
 * sales department, which is a sales manager and sales agents under them. Then we get the
 * communications team. Then we have the call centre, which has a call centre manager, which is
 * the manager of the team leaders. Then we get team leaders and then we get pre-legal agents."
 *
 * ONE PLACE THAT SAYS SO, and the reason is not tidiness. A role list written twice in this
 * codebase has drifted twice: 'Pre-legal Team Leader' was missing from the invite box while the
 * row dropdown had it, and the hand-out permission lived as a bare array inside one screen while
 * another screen needed the same answer. A department is a third such list waiting to happen, so
 * it is derived from the role and derived in exactly one function.
 *
 * DERIVED, NEVER STORED. It is a reading of the role, and a stored copy is only a way for the two
 * to disagree -- the same rule this codebase applies to a client's position and to a diary kind.
 *
 * RECEPTION IS AN ADMINISTRATOR, at the firm's instruction: "she's more admin, you know -- just
 * keep her as an administrator for now." There is no Reception role and this does not invent one.
 *
 * THE READ-ONLY ROLE BELONGS TO NO DEPARTMENT. It is an observer -- an auditor, somebody's
 * accountant -- and filing them under a department would put them in a headcount they are not
 * part of. They get their own heading at the bottom rather than being hidden.
 */
import type { UserRole } from '../types'

export type Department = 'Administration' | 'Sales' | 'Communications' | 'Call centre' | 'Other'

export interface DepartmentMeta {
  id: Department
  /** The firm's own word for it, as it appears above the group. */
  label: string
  /** One line under the heading. Says what the department is, not how many are in it. */
  blurb: string
}

/**
 * In the order the firm listed them, which is also roughly the order somebody looks for a person:
 * the office, then the two client-facing departments, then the floor -- which is the biggest.
 */
export const DEPARTMENTS: DepartmentMeta[] = [
  { id: 'Administration', label: 'Administration', blurb: 'Run the firm and the system. Reception sits here too.' },
  { id: 'Sales', label: 'Sales', blurb: 'Win the work: leads, deals and the clients who send the book.' },
  { id: 'Communications', label: 'Communications', blurb: 'Look after the client relationship — courtesy calls, handovers and meetings.' },
  { id: 'Call centre', label: 'Call centre', blurb: 'Work the book. Everybody here carries accounts and a diary.' },
  { id: 'Other', label: 'Everyone else', blurb: 'People with a login and no department — auditors and observers.' },
]

/**
 * The role's department.
 *
 * WRITTEN AS A MAP RATHER THAN A CHAIN OF IFS so a role added to UserRole and forgotten here is
 * `undefined` and falls to 'Other' visibly, rather than silently landing in whichever branch
 * happened to be last. check-departments holds the map against the union in both directions.
 */
const OF_ROLE: Record<UserRole, Department> = {
  Administrator: 'Administration',
  'Sales Manager': 'Sales',
  'Sales Representative': 'Sales',
  'Liaison Manager': 'Communications',
  Liaison: 'Communications',
  'Call Centre Manager': 'Call centre',
  'Pre-legal Team Leader': 'Call centre',
  'Pre-legal Agent': 'Call centre',
  'Read Only': 'Other',
}

export function departmentOf(role: UserRole | undefined): Department {
  return (role && OF_ROLE[role]) || 'Other'
}

/**
 * Where a role sits INSIDE its department, most senior first.
 *
 * The firm described the call centre as a ladder -- "a call centre manager, which is the manager
 * of the team leaders; then we get team leaders and then we get pre-legal agents" -- and a list
 * of a hundred people sorted by name alone hides that entirely. Lower number is nearer the top.
 *
 * NOT A PERMISSION. Nothing decides what anybody may do from this; it decides what order they are
 * drawn in. Seniority and authority are related in the firm and deliberately unrelated in the
 * code, because a rank that quietly granted something would be a permission nobody could find.
 */
const RANK: Record<UserRole, number> = {
  Administrator: 0,
  'Sales Manager': 0,
  'Liaison Manager': 0,
  'Call Centre Manager': 0,
  'Pre-legal Team Leader': 1,
  'Sales Representative': 2,
  Liaison: 2,
  'Pre-legal Agent': 2,
  'Read Only': 3,
}

export function rankOf(role: UserRole | undefined): number {
  return role && role in RANK ? RANK[role] : 99
}

/**
 * Everybody, grouped and ordered: by department in the order above, then by rank, then by name.
 *
 * PEOPLE WHO HAVE LEFT ARE NOT IN HERE. The firm asked for them kept rather than removed -- "if
 * somebody left the company we archive the user, just to understand if there's a timestamp about
 * someone that did something" -- and kept is not the same as mixed in. They come back from
 * `archived` instead, so a department's count is the number of people actually doing that job.
 */
export interface Grouped<T> { meta: DepartmentMeta; people: T[] }

export function byDepartment<T extends { role: UserRole; name: string; status?: string }>(
  everyone: T[],
): { departments: Grouped<T>[]; archived: T[] } {
  const live = everyone.filter((u) => u.status !== 'Inactive')
  const archived = everyone
    .filter((u) => u.status === 'Inactive')
    .sort((a, b) => a.name.localeCompare(b.name))

  const departments = DEPARTMENTS.map((meta) => ({
    meta,
    people: live
      .filter((u) => departmentOf(u.role) === meta.id)
      .sort((a, b) => rankOf(a.role) - rankOf(b.role) || a.name.localeCompare(b.name)),
  }))
  /* An empty department is not drawn. The firm has no Read Only people today and a heading with
     nothing under it reads as something missing rather than as something absent. */
  return { departments: departments.filter((d) => d.people.length > 0), archived }
}
