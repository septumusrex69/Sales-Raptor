/**
 * ADD LEAD ASKS IN THE FIRM'S ORDER (23 Oct). Stephan: "the first thing it should ask is it a
 * company or an individual? And then what is the client name and who is the contact persons? That
 * is how it should work."
 *
 * The form used to open on First Name / Last Name and ask "company or individual" underneath, which
 * is the database's order (the lead row is a person with a company name on it), not the way anybody
 * thinks about a new client. So the choice comes first, and what it decides is what the next two
 * questions MEAN:
 *
 *  - A COMPANY: the client name is the company's, and the contact persons are people at it -- one
 *    or more. The first is the lead's own name, phone and email (the stored shape is unchanged); the
 *    rest become contacts on the lead (`contacts.lead_id`), which the lead page already lists and the
 *    conversion already carries across to the client.
 *  - AN INDIVIDUAL: the person IS the client, so their full name is the client name and their phone
 *    and email are the contact details. Asking for a "contact person" as well would ask for the
 *    same person twice.
 *
 * Pure, so a check can hold it.
 */
import type { MandateParty } from './mandate.ts'

export interface ContactPersonDraft { firstName: string; lastName: string; jobTitle: string; phone: string; email: string }

export const emptyContactPerson = (): ContactPersonDraft => ({ firstName: '', lastName: '', jobTitle: '', phone: '', email: '' })

/**
 * The name the client goes by: the company's for a company, the person's own for an individual.
 * Stored in `leads.company_name` either way, which is what the mandate and the conversion read.
 */
export function clientNameFor(party: MandateParty, v: { companyName: string; firstName: string; lastName: string }): string {
  return party === 'individual'
    ? `${v.firstName.trim()} ${v.lastName.trim()}`.trim()
    : v.companyName.trim()
}

/**
 * The further contact people worth saving. A row left wholly blank is the "add another" nobody
 * filled in and is dropped; a row with anything in it but no first name is a problem, said rather
 * than dropped, because what was typed into it would otherwise vanish.
 */
export function furtherContacts(rows: ContactPersonDraft[]): { save: { firstName: string; lastName: string; jobTitle?: string; phone?: string; email?: string }[]; problem: string | null } {
  const filled = rows.filter((r) => Object.values(r).some((x) => x.trim() !== ''))
  const unnamed = filled.find((r) => r.firstName.trim() === '')
  return {
    save: filled.filter((r) => r.firstName.trim() !== '').map((r) => ({
      firstName: r.firstName.trim(),
      lastName: r.lastName.trim(),
      jobTitle: r.jobTitle.trim() || undefined,
      phone: r.phone.trim() || undefined,
      email: r.email.trim() || undefined,
    })),
    problem: unnamed ? 'Give each contact person a first name, or remove the row.' : null,
  }
}
