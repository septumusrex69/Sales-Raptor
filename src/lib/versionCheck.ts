/**
 * What a tab should do when the server is serving a different bundle than the one it is running.
 *
 * THIS IS A PURE FUNCTION IN ITS OWN FILE BECAUSE THE LOOP IT PREVENTS CANNOT BE SEEN BY READING
 * THE COMPONENT. Reload, come back, find the served bundle still different, reload again: each
 * step is individually reasonable and the whole is an app that never opens. A check can drive
 * this through the second pass, which is the only pass where the bug exists.
 */

export type VersionAction =
  /** Running the current bundle, or nothing is known. Say nothing. */
  | 'none'
  /** Reload silently. Only ever returned once for a given deployed bundle. */
  | 'reload'
  /** Offer the banner: either the person is mid-task, or a silent reload has already failed. */
  | 'banner'

export function nextVersionAction(input: {
  /** The bundle this tab is running, off its own <script src>. */
  own: string | null
  /** The bundle the server is offering now. */
  deployed: string | null
  /** The bundle this tab has already reloaded itself for, if any. */
  reloadedFor: string | null
  /** False when a modal is open or somebody is typing — a reload would lose their work. */
  safeToReload: boolean
}): VersionAction {
  const { own, deployed, reloadedFor, safeToReload } = input
  if (!own || !deployed) return 'none'
  if (deployed === own) return 'none'
  /*
   * THE GUARD. We reloaded for exactly this bundle and are still not running it, so reloading
   * again does the same thing again. It does not take a bug of ours to reach here: a deployment
   * rolling out, a CDN node still holding the previous index.html, or two builds alternating
   * behind one alias each produce it. The banner is the outcome somebody can act on; a loop is
   * one nobody can even see, because the page never lives long enough to draw anything.
   */
  if (reloadedFor === deployed) return 'banner'
  if (!safeToReload) return 'banner'
  return 'reload'
}
