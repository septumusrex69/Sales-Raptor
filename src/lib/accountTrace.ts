/**
 * Tracing a debtor through XDS.
 *
 * XDS is a registered credit bureau, so a search there is Annexure B item 4(c) — "necessary
 * registered credit bureau search", R16 excluding VAT. It is not a fee we invented: the gazette
 * names the work. The gazette's four-a-month allowance is not enforced (see
 * ENFORCE_MONTHLY_LIMITS): one account can carry a company and several sureties, and each of them
 * is a separate person to find.
 *
 * The portal has no way to be handed a debtor, so this cannot search on anyone's behalf. What it
 * does is the paperwork either side of the search: it opens the portal, records that a search was
 * done, and charges for it — so a collector stops having to remember to write up a trace they
 * performed twenty minutes ago on another screen.
 *
 * Worth being plain about the trade: the charge is raised when the portal is OPENED, not when a
 * result comes back, because nothing tells us what happened inside XDS. That is why the button
 * asks first. A trace that earns nothing is still recorded, same as every other capped item.
 */
import { addNote } from './accountWorkspace'
import { chargeItem, type ChargeResult } from './accountCharges'

/** Item 4(c). Named once so the reason for the charge is greppable from the button. */
export const TRACE_ITEM = '4c'
export const TRACE_ACTION_CODE = 'TRC'

/**
 * The bureau's own portal.
 *
 * A constant rather than a setting because the firm uses one bureau. When a second one arrives
 * this becomes a row in settings and the button grows a menu; until then a setting nobody ever
 * changes is just somewhere else to look.
 */
export const XDS_PORTAL_URL = 'https://www.online.xds.co.za/Portal/Account/Login?ReturnUrl=%2FPortal%2F'

/**
 * Record a trace against an account: the fee, then the note.
 *
 * In that order deliberately. The note quotes what the charge came to, so a timeline entry can
 * never claim a fee the ledger does not carry.
 */
export async function recordTrace(input: {
  accountId: string
  actor: { id: string | null; name: string | null }
  /** How many searches were actually run. One account can carry a company and its sureties. */
  count?: number
}): Promise<ChargeResult> {
  const count = Math.max(1, Math.floor(input.count ?? 1))
  const charge = await chargeItem({
    accountId: input.accountId,
    itemId: TRACE_ITEM,
    actionCode: TRACE_ACTION_CODE,
    description: TRACE_DESCRIPTION,
    quantity: count,
    createdBy: input.actor.id,
  })
  await addNote({
    accountId: input.accountId,
    body: traceNote(count),
    // Raptor's words, not a person's: hidden when the timeline is set to show only
    // what people wrote. See TimelineEntry.automated.
    source: 'system',
    authorName: input.actor.name,
    createdBy: input.actor.id,
  })
  return charge
}

/**
 * What the charge is for.
 *
 * Only what was done — how MANY is `segments` on the row, and the statement and the timeline both
 * render it from there. Spelling the count out here as well is what produced "Credit bureau
 * search (XDS) x 4 ×4".
 *
 * The bureau's name came off at the firm's request. It told the debtor nothing they needed and
 * named a supplier on a document that goes outside the building.
 */
export const TRACE_DESCRIPTION = 'Credit bureau search'

/**
 * What the timeline says happened.
 *
 * No fee named — it is on the transaction list, and on this timeline as its own entry. The
 * firm's instruction: "don't have to say about the charges in the notes."
 */
export function traceNote(count = 1): string {
  const searches = count > 1 ? `${count} credit bureau searches` : 'credit bureau search'
  return `Trace done — ${searches}.`
}
