/**
 * CAMPAIGN RESULTS, FOR EVERYBODY (S10, 22 Oct).
 *
 * THE FIRM: "Collector sees the campaign results, also the administrators ... anybody can see the
 * campaign results ... we can just have a place about like campaign results. PTPs made." And of a
 * trace campaign: "if there's new details ... did we make contact? ... then we can manage the
 * success of the campaign."
 *
 * The figures come from the database already summed (campaign_results, trace_campaign_funnel --
 * security definer, so a collector sees how every campaign went without reading another team's
 * rows). This file only says what they mean and how a page draws them. Pure, so a check can hold it.
 *
 * NO MONEY THE FIRM EARNS, on a page everybody sees (CLAUDE.md): no fees, no estimate. The rand
 * figures are what debtors promised and paid -- the client's money to recover.
 *
 * A PTP MADE FROM A CALL CAMPAIGN (campaign_call_promises): a promise on an account in the campaign,
 * recorded by the collector whose diary the call was on, from the moment the call landed there until
 * the end of the day they worked it -- or the campaign's end where it was not worked, or the
 * hand-over where the account moved desks. Counted once per promise.
 */

export interface FunnelInput {
  searchedAt: string | null
  detailsAt: string | null
  contactAt: string | null
  promisedAt: string | null
  promised: number
  paid: number
}

export interface TraceFunnel {
  referred: number
  searched: number
  details: number
  contact: number
  promised: number
  promisedAmount: number
  paid: number
  paidAmount: number
}

/**
 * THE TRACE FUNNEL, IN TOTAL. Each stage after NEW DETAILS is already conditional on the one before
 * it in the database (a contact counts only after the new details, a promise and a payment only after
 * the contact), so here they are simply counted. SEARCHED stands beside the funnel rather than in it:
 * new details can arrive without a search -- the debtor rings in -- and that is still the campaign's
 * success.
 */
export function traceFunnel(rows: readonly FunnelInput[]): TraceFunnel {
  const money = (n: number) => Math.round(n * 100) / 100
  return {
    referred: rows.length,
    searched: rows.filter((r) => r.searchedAt).length,
    details: rows.filter((r) => r.detailsAt).length,
    contact: rows.filter((r) => r.detailsAt && r.contactAt).length,
    promised: rows.filter((r) => r.contactAt && r.promisedAt).length,
    promisedAmount: money(rows.reduce((s, r) => s + (r.contactAt && r.promisedAt ? r.promised : 0), 0)),
    paid: rows.filter((r) => r.contactAt && r.paid > 0).length,
    paidAmount: money(rows.reduce((s, r) => s + (r.contactAt ? r.paid : 0), 0)),
  }
}

/** The kind a results row is filed under, in the firm's words. */
export function resultKind(r: { channel: string; callKind: string | null }): string {
  if (r.channel === 'sms') return 'SMS'
  if (r.channel === 'email') return 'Email'
  if (r.callKind === 'recovery') return 'Recovery calls'
  if (r.callKind === 'trace') return 'Trace'
  return 'Calls'
}
