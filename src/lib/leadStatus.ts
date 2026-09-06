import type { Lead, LeadStatus } from '../types'

/** Every status a lead can hold, in the order it moves through them. */
export const LEAD_STATUSES: LeadStatus[] = ['No Contact Yet', 'Interested', 'Hot Lead', 'Converted', 'Rejected']

/** The stages a lead is still being worked in — everything before it ends one way or the other. */
export const ACTIVE_LEAD_STATUSES: LeadStatus[] = ['No Contact Yet', 'Interested', 'Hot Lead']

/**
 * Still on someone's plate. A lead stays active until it either becomes a client or is
 * rejected — those are the only two ways out.
 */
export function isActiveLead(lead: Lead): boolean {
  return lead.status !== 'Converted' && lead.status !== 'Rejected'
}

/** Someone has actually spoken to them. */
export function isContactedLead(lead: Lead): boolean {
  return lead.status !== 'No Contact Yet'
}

/**
 * Showing real intent — the leads worth forecasting from. Converted counts because it got
 * there; a lead that closed obviously qualified on the way through.
 */
export function isEngagedLead(lead: Lead): boolean {
  return lead.status === 'Interested' || lead.status === 'Hot Lead' || lead.status === 'Converted'
}
