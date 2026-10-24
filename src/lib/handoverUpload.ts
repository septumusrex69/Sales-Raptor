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

/**
 * WHO MAY PUT ONE OF THIS CLIENT'S ACCOUNTS ON SOMEBODY'S DESK (S11).
 *
 * THE FIRM: "the person that loads a specific batch of accounts should hand them out" -- and of
 * the floor, "the team leaders can do that as well, or the call center manager, but they can't
 * load accounts ... clerks, like, they can't reassign anyone". So two roads, either is enough:
 *
 *   1. THE BOOK-WIDE TICK `book.hand_out` -- team leaders, the Call Centre Manager, the Liaison
 *      Manager, the Administrator, and anybody whose department carries `reassign_accounts`.
 *   2. MAY LOAD THIS CLIENT'S ACCOUNTS (mayLoadAccountsFor). A liaison hands out her department's
 *      clients' batches, which is what ends the batch loaded by somebody who could not hand it out
 *      -- the commonest way, by far, that a batch sat on nobody's desk. It does NOT give her the
 *      rest of the book: road 1 is not widened to the Liaison role on purpose.
 *
 * THE DATABASE ASKS THE SAME (may_hand_out, and the trigger debtor_accounts_desk_guard on every
 * change of assigned_to made as a signed-in person), so a console cannot walk round a hidden button.
 */
export function mayHandOutFor(
  user: Loader | null | undefined,
  client: ClientLike | null | undefined,
  people: readonly Person[],
): boolean {
  return can(user, 'book.hand_out') || mayLoadAccountsFor(user, client, people)
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
