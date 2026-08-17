import type { Activity, ActivityType } from '../types'

/**
 * Activity types a rep does on purpose to move a deal forward — the
 * "meaningful" activity the spec asks management metrics to count.
 * Everything else is a system-logged side effect of another action
 * (e.g. moving a deal's stage auto-creates a "Deal Stage Change" activity)
 * and shouldn't inflate a rep's activity count.
 *
 * Centralized here so every KPI/report/chart that counts "activity" agrees
 * on what counts, per the spec's "centrally configurable" requirement.
 */
export const MEANINGFUL_ACTIVITY_TYPES: ActivityType[] = ['Call', 'Email', 'WhatsApp', 'Meeting', 'Note', 'Proposal', 'Task']

export function isMeaningfulActivity(activity: Activity): boolean {
  return MEANINGFUL_ACTIVITY_TYPES.includes(activity.type)
}

/** Activity types that count as an attempt to reach a lead — used for response-time / contact metrics. */
export const CONTACT_ACTIVITY_TYPES: ActivityType[] = ['Call', 'Email', 'WhatsApp', 'Meeting']

export function isContactActivity(activity: Activity): boolean {
  return CONTACT_ACTIVITY_TYPES.includes(activity.type)
}
