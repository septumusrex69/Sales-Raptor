/**
 * THE MAILBOX FOR ACCOUNTS NOBODY HOLDS (Stephan, 4 Nov: "why did the email go out from Camille ... we should have
 * email address like for people that are not assigned ... I think legal").
 *
 * Raptor sends as a person's connected mailbox, and an account with no collector had no person: the debtor's sign-in
 * code went out from the first Administrator with a mailbox (Camille), and a workflow email held. This is the address
 * that stands in. It is used the moment a mailbox with this address is connected in Raptor (Settings > Email, under
 * whichever login owns it) and not before -- nothing pretends to send from it.
 *
 * A constant, not a firm setting: it is one address the firm chose, and a setting is a screen, a column and five lists
 * in firmSettings.ts for a value that changes once. Promote it if it ever needs to change without a deploy.
 */
export const UNASSIGNED_MAILBOX = 'legal@bredellferreira.co.za'

/**
 * THE ORDER A DEBTOR'S CODE IS SENT IN, WITH legal@ IN IT: the account's own collector (where they can send), then
 * legal@, then whoever else was in line (the Administrators). Without a connected legal@ the order is unchanged.
 */
export function withLegal(order: string[], assignedTo: string | null, legalId: string | null): string[] {
  if (!legalId) return order
  const head = assignedTo && order.includes(assignedTo) && assignedTo !== legalId ? [assignedTo] : []
  return [...head, legalId, ...order.filter((id) => id !== assignedTo && id !== legalId)]
}
