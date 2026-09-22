/**
 * What a clerk is told when a stack of accounts lands on their desk.
 *
 * THE FIRM: "then it should go to the clerk dashboard and ping, or there should be some sort of
 * notification that's being shown to the clerk that, oh, you've received seven new handovers and
 * referrals. They should be notified of that ... and then it should give you an option to go to
 * your diary to look at them, or just to see them, the list of them."
 *
 * PURE, so the wording and the link are something a check can hold. Allocating is the one action
 * in this app that moves a billion rand of work between people, and the message about it should
 * not be assembled inside a loop that is also writing to four tables.
 */

export type HandOutNoticeKind = 'handover.allocated' | 'handover.referred'

export interface HandOutNotice {
  userId: string
  type: HandOutNoticeKind
  message: string
  /** Where "see them" goes. The diary is the other door and the dashboard offers both. */
  link: string
}

/** "7 accounts" / "1 account", because "1 accounts" went out to a client once already. */
const accounts = (n: number) => `${n} ${n === 1 ? 'account' : 'accounts'}`

/**
 * One notice per person, for what they were actually given.
 *
 * ALLOCATED AND REFERRED ARE TOLD APART, because they mean different things to the person
 * reading. Allocated is "this is your book now"; referred is "you are booked to ring these, they
 * belong to somebody else". handOutWrite.ts already keeps the two separate and the firm's own
 * rule is that an allocation never happens without a referral — so the allocated message names
 * the diary too, and the referred one does not claim ownership.
 *
 * NOTHING IS SENT TO THE PERSON WHO PRESSED THE BUTTON. A team leader handing work to themselves
 * gets a bell for something they are looking at, which is how people learn to ignore a bell.
 */
export function handOutNotices(input: {
  /** userId -> how many accounts they were given. */
  allocated: Map<string, number>
  /** userId -> how many they were booked to work. */
  referred: Map<string, number>
  /** The batch, where the whole hand-out came from one. Makes "see them" a real list. */
  handoverId?: string | null
  /** Who did it, so they are not told about their own action. */
  actorId?: string | null
  /** The day the diary entries were booked for, for "in your diary for …". */
  firstDay?: string | null
}): HandOutNotice[] {
  const out: HandOutNotice[] = []
  const seeThem = input.handoverId
    ? `/accounts?handover=${input.handoverId}`
    : '/accounts?who=me'

  for (const [userId, n] of input.allocated) {
    if (n <= 0 || userId === input.actorId) continue
    out.push({
      userId,
      type: 'handover.allocated',
      message: `${accounts(n)} allocated to you and booked into your diary.`,
      link: seeThem,
    })
  }

  for (const [userId, n] of input.referred) {
    /* Somebody who was allocated accounts has already been told, and the allocation message
       already says they are in the diary. Two bells for one action is one bell too many. */
    if (n <= 0 || userId === input.actorId || input.allocated.has(userId)) continue
    out.push({
      userId,
      type: 'handover.referred',
      message: `${accounts(n)} referred to you to work.`,
      link: seeThem,
    })
  }

  return out
}
