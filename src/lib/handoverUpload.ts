import type { User } from '../types'
import { can, type CapabilityHolder } from './capabilities.ts'

/**
 * WHO MAY LOAD A CLIENT'S ACCOUNTS, AND FOR WHICH CLIENTS.
 *
 * THE FIRM (Stephan, 23 Oct): "Please make it so that client liaisons can upload their own clients'
 * import sheets. Also possibly other people in the department's import sheets. Okay, any person in
 * the client liaison department can upload a handover sheet." And, asked "Bulk or upload a single
 * handover?" -- both: the sheet (a BATCH, which is what the `handovers` table holds) and the single
 * account a client phones in (Add debtor). A handover is one account; both roads load accounts, so
 * one rule decides both.
 *
 * TWO QUESTIONS, AND BOTH HAVE TO BE YES:
 *
 *   1. MAY THIS PERSON LOAD ACCOUNTS AT ALL? The tick `handover.upload`. Born with it: both liaison
 *      roles and the Administrator; and anybody whose DEPARTMENT carries the `load_handovers` duty,
 *      which is how "any person in the client liaison department" is said without naming a role.
 *
 *   2. FOR THIS CLIENT? An Administrator: any client. Anybody else: a client whose liaison
 *      (`companies.account_owner_id`) is THEM, or sits in THEIR department -- their own clients and
 *      their colleagues'. A client with no liaison is the Administrator's alone: nobody's colleague
 *      looks after it, and loading a book nobody owns is how a client ends up with accounts and no
 *      one to send the corrections to.
 *
 * THE DEPARTMENT IS THE STORED ONE (`profiles.department_id`, orgStructure.ts), not the role's
 * reading in departments.ts. The firm draws its departments now, and "the department" in the
 * sentence above is the one they drew. Two people with no department are NOT in the same one:
 * null is nobody's department, never a shared one.
 *
 * THE DATABASE ASKS THE SAME, in may_load_accounts(), and the INSERT policies on `handovers`,
 * `handover_drafts` and `debtor_accounts` ask that function -- so a button drawn here and refused
 * there cannot happen, and a button hidden here cannot be walked round from a console.
 * check-handover-upload holds the two against each other.
 */
export type Loader = CapabilityHolder & Pick<User, 'id'> & { departmentId?: string | null }
type Person = { id: string; departmentId?: string | null }
type ClientLike = { accountOwnerId?: string | null }

export function mayLoadAccounts(user: Loader | null | undefined): boolean {
  return can(user, 'handover.upload')
}

export function mayLoadAccountsFor(
  user: Loader | null | undefined,
  client: ClientLike | null | undefined,
  people: readonly Person[],
): boolean {
  if (!user || !client || !mayLoadAccounts(user)) return false
  if (user.role === 'Administrator') return true
  const liaisonId = client.accountOwnerId
  if (!liaisonId) return false
  if (liaisonId === user.id) return true
  const mine = user.departmentId ?? null
  if (!mine) return false
  const liaison = people.find((p) => p.id === liaisonId)
  return !!liaison && (liaison.departmentId ?? null) === mine
}

/** The clients this person may load for, out of the ones offered. What the import's picker lists. */
export function loadableClients<C extends ClientLike>(
  user: Loader | null | undefined,
  clients: readonly C[],
  people: readonly Person[],
): C[] {
  return clients.filter((c) => mayLoadAccountsFor(user, c, people))
}

/** Where a client's batch is uploaded from, outside Settings. */
export function uploadPathFor(clientId: string): string {
  return `/companies/${clientId}/upload`
}
