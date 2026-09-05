import type { Activity, ActivityType } from '../types'

/** Prefix used by /api/email/attachment when it records who pulled a client's file. */
export const ATTACHMENT_DOWNLOAD_PREFIX = 'Attachment downloaded: '

/**
 * Activity types the app writes by itself as a side effect of something else — a deal moving
 * stage, a task being created. Nobody sat down and typed these, so they shouldn't compete
 * with the notes that someone did.
 */
const AUTOMATIC_TYPES: ActivityType[] = ['Status change', 'Deal update', 'Deal Stage Change', 'Deal Won', 'Deal Lost', 'Task']

/**
 * Did a person write this, or did the system record it?
 *
 * The distinction drives how prominently a row is rendered, and whether the "system activity"
 * toggle hides it. Attachment downloads are stored as Notes (they belong on the client's
 * file) but are audit records rather than anything anyone wrote, so they count as automatic.
 */
export function isAutomaticActivity(activity: Activity): boolean {
  if (activity.subject.startsWith(ATTACHMENT_DOWNLOAD_PREFIX)) return true
  return AUTOMATIC_TYPES.includes(activity.type)
}

/** The file name from an attachment-download record, or null if this isn't one. */
export function downloadedFilename(activity: Activity): string | null {
  return activity.subject.startsWith(ATTACHMENT_DOWNLOAD_PREFIX) ? activity.subject.slice(ATTACHMENT_DOWNLOAD_PREFIX.length) : null
}

export interface GroupedActivity {
  activity: Activity
  /** How many identical entries in a row this stands for — 1 unless a repeat was collapsed. */
  count: number
}

/** Two identical actions further apart than this are worth showing separately. */
const REPEAT_WINDOW_MS = 10 * 60 * 1000

/**
 * Collapses a run of identical automatic entries into one row with a count — clicking a
 * download twice shouldn't produce two indistinguishable lines on a client's file. Only
 * consecutive same-subject, same-person entries within a few minutes collapse, and only
 * automatic ones: two notes that happen to say the same thing are two deliberate notes.
 */
export function collapseRepeats(activities: Activity[]): GroupedActivity[] {
  const out: GroupedActivity[] = []
  for (const activity of activities) {
    const previous = out[out.length - 1]
    const isRepeat =
      previous &&
      isAutomaticActivity(activity) &&
      previous.activity.subject === activity.subject &&
      previous.activity.userId === activity.userId &&
      Math.abs(new Date(previous.activity.activityDate).getTime() - new Date(activity.activityDate).getTime()) < REPEAT_WINDOW_MS
    if (isRepeat) previous.count += 1
    else out.push({ activity, count: 1 })
  }
  return out
}
