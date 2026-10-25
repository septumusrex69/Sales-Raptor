import type { Company, User } from '../types'

/**
 * A DORMANT CLIENT (S11).
 *
 * THE FIRM (24 Oct): "There are also clients that are dormant. For example, that are not using our
 * services or not interested in using our services anymore." And of the Swordfish clients that came
 * in with no liaison: "you should be able to do something with them in bulk ... assign them in bulk,
 * or leave us dormant."
 *
 * Swordfish already said it: its client register carries "Active / Dormant" on every client
 * (`companies.register_status`), imported and shown nowhere until now. So dormant is a FACT ABOUT
 * THE RELATIONSHIP, stored with when, why and by whom (`dormant_at`, `dormant_reason`, `dormant_by`)
 * -- not derived from the book, because a client with no accounts this month is not the same thing
 * as a client who has told us they are done.
 *
 * WHAT IT DOES: a dormant client needs no liaison (nobody is asked to assign one), and the clients
 * list shows it under Dormant rather than among the clients being worked. WHAT UNDOES IT: a person
 * pressing Make active, or a new batch arriving for it -- the database does that one
 * (`client_wakes_on_handover`), because a client who sends accounts is plainly not dormant, and a
 * rule that lived only in the import screen would miss Add debtor.
 */

/** Who may mark a client dormant or active: the companies_update policy, said in the browser. */
export function mayChangeDormancy(
  user: Pick<User, 'id' | 'role'> | null | undefined,
  client: Pick<Company, 'accountOwnerId'> | null | undefined,
): boolean {
  if (!user || !client) return false
  return ['Administrator', 'Sales Manager', 'Liaison Manager'].includes(user.role) || client.accountOwnerId === user.id
}

export function isDormant(c: Pick<Company, 'dormantAt'> | null | undefined): boolean {
  return !!c?.dormantAt
}

/** Swordfish's word, read case- and space-blind: the register writes "Dormant" and "dormant ". */
export function dormantInRegister(registerStatus: string | null | undefined): boolean {
  return (registerStatus ?? '').trim().toLowerCase() === 'dormant'
}

export const SWORDFISH_DORMANT_REASON = 'Dormant in Swordfish'

/** The columns a mark writes. Marking also clears liaison_needed: nobody is asked to look after it. */
export function dormantPatch(reason: string, byId: string | null, at: string) {
  return { dormant_at: at, dormant_reason: reason.trim() || null, dormant_by: byId, liaison_needed: false }
}

/** And waking it. A client whose owner is not a liaison needs one again -- the caller says which. */
export function activePatch(needsLiaison: boolean) {
  return { dormant_at: null, dormant_reason: null, dormant_by: null, liaison_needed: needsLiaison }
}

/** The line a list or a client page shows. */
export function dormantLine(c: Pick<Company, 'dormantAt' | 'dormantReason'>, byName: string | null): string {
  if (!c.dormantAt) return ''
  const day = new Date(c.dormantAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
  return `Dormant since ${day}${byName ? `, marked by ${byName}` : ''}${c.dormantReason ? ` -- ${c.dormantReason}` : ''}.`
}
