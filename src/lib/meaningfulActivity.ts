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
export const MEANINGFUL_ACTIVITY_TYPES: ActivityType[] = [
  'Call',
  'Email',
  'WhatsApp',
  'SMS',
  'Meeting',
  'Note',
  'Proposal',
  'Task',
  'Courtesy Call',
  'Handover Received',
]

/**
 * A NEWSLETTER IS LOGGED ON EVERY TIMELINE IT REACHED, AND IS NOBODY'S WORK. News & campaigns writes
 * one Email line per recipient ("Newsletter: <subject>") so a client's or lead's history shows what
 * they were sent -- and five hundred of those under the name of whoever pressed Send would make that
 * person the busiest rep in the firm for a morning. So a newsletter line counts as neither a
 * meaningful activity nor an attempt to reach somebody. The prefix is the marker, and it lives here
 * so the sender (src/lib/marketing.ts) and the counters read one constant.
 */
export const NEWSLETTER_SUBJECT_PREFIX = 'Newsletter: '

function isNewsletter(activity: Pick<Activity, 'type' | 'subject'>): boolean {
  return activity.type === 'Email' && (activity.subject ?? '').startsWith(NEWSLETTER_SUBJECT_PREFIX)
}

export function isMeaningfulActivity(activity: Activity): boolean {
  return MEANINGFUL_ACTIVITY_TYPES.includes(activity.type) && !isNewsletter(activity)
}

/** Activity types that count as an attempt to reach a lead — used for response-time / contact metrics. */
export const CONTACT_ACTIVITY_TYPES: ActivityType[] = ['Call', 'Email', 'WhatsApp', 'SMS', 'Meeting']

export function isContactActivity(activity: Activity): boolean {
  return CONTACT_ACTIVITY_TYPES.includes(activity.type) && !isNewsletter(activity)
}
