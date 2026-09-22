/**
 * The ping, decided away from the screen that shows it.
 *
 * THE FIRM: "then it should go to the clerk dashboard and ping, or there should be some sort of
 * notification that's being shown to the clerk that, oh, you've received seven new handovers and
 * referrals ... perhaps a pop-up ... and then it should give you an option to go to your diary to
 * look at them, or just to see them, the list of them. Or you should be able to close it."
 *
 * A POP-UP IS A THING THAT INTERRUPTS SOMEBODY MID-CALL, so what makes it appear is worth being
 * able to test without a browser. Three rules live here and all three are about NOT showing it:
 *
 *   - only hand-out notices. The bell carries eleven other kinds and none of them is worth
 *     covering the screen for; a proposal somebody viewed can wait for the bell.
 *   - only unread ones. Read is the firm's record that the person has been told.
 *   - never on the page it would send you to. Somebody already looking at the list does not need
 *     a box over it offering to show them the list.
 *
 * `types.ts` widened NotificationType for these two, so the filter below is a type, not a string
 * somebody has to keep in step by hand.
 */
import type { AppNotification } from '../types'

/** The two kinds a hand-out raises. See handOutNotice.ts, which writes them. */
export const HAND_OUT_NOTICE_TYPES = ['handover.allocated', 'handover.referred'] as const

export interface NewWork {
  /** The rows this box is standing for. Marked read by whichever way out is taken. */
  notices: AppNotification[]
  /** What it says. Built from the notices' own messages where there is one, so the count is the
   *  count that was written at the time rather than a second guess at it here. */
  lines: string[]
  /** "See them": the batch, when every notice points at the same one; the desk otherwise. */
  seeLink: string
}

/**
 * What to interrupt somebody with, if anything.
 *
 * Returns null far more often than not, which is the point. `path` is the route the person is
 * already on — passed in rather than read off the router so this can be run in a check.
 */
export function newWorkPopup(notifications: AppNotification[], path: string): NewWork | null {
  const kinds = new Set<string>(HAND_OUT_NOTICE_TYPES)
  const notices = notifications.filter((n) => !n.read && kinds.has(n.type))
  if (notices.length === 0) return null

  /*
   * One link only when they all agree. Two batches allocated in the same morning have no single
   * list, and picking the first one would quietly show half the work under a button that says
   * "see them" — so it falls back to the whole desk, which is true of both.
   */
  const links = new Set(notices.map((n) => n.link ?? ''))
  const seeLink = links.size === 1 ? ([...links][0] || '/accounts?who=me') : '/accounts?who=me'

  /* Not over the thing it is offering. `path` carries the query string, so a person filtered to
     one batch is left alone while a person on the unfiltered book still gets the box. */
  if (path === seeLink || path === '/diary') return null

  return { notices, lines: notices.map((n) => n.message), seeLink }
}
