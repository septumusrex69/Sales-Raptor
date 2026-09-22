/**
 * Telling Communications that an account opened on a date nobody supplied.
 *
 * THE FIRM: "still send a notification and make a note for the client, send it to the
 * communications department, and make a note on the system."
 *
 * WHY THEM AND NOT A PERSON. The substituted date is not one desk's problem: every figure on the
 * account is now calculated from a date the firm chose, and it stays that way until the client
 * answers. Communications is the department that talks to clients, so it is the one that can
 * close it -- and a notice to one named person is a notice that waits while they are on leave.
 *
 * PURE, so the wording and the link are something a check can hold without a database. Who is in
 * the department is a query; what they are told is not.
 */

export type CommunicationsNoticeKind = 'handover.default_date_substituted'

export interface CommunicationsNotice {
  userId: string
  type: CommunicationsNoticeKind
  message: string
  link: string
}

/** "3 accounts" / "1 account", because "1 accounts" went out to a client once already. */
const accounts = (n: number) => `${n} ${n === 1 ? 'account' : 'accounts'}`

/**
 * One notice each, for the people who can do something about it.
 *
 * NOTHING GOES TO WHOEVER PRESSED APPROVE. They are looking at the result; a bell for an action
 * you just took is how people learn to ignore bells.
 *
 * THE LINK IS THE BATCH, not the first account. The question is about a sheet a client sent, and
 * the answer will cover all of them at once.
 */
export function communicationsNotices(input: {
  /** profiles.id of everyone on a team whose kind is 'Communications'. */
  department: string[]
  /** The client's own references for the accounts opened on a substituted date. */
  references: string[]
  clientName: string
  handoverId: string | null
  /** Who approved it, so they are not told about their own action. */
  actorId?: string | null
}): CommunicationsNotice[] {
  if (input.references.length === 0) return []

  const link = input.handoverId ? `/accounts?handover=${input.handoverId}` : '/accounts'
  /*
   * NAMED WHILE THERE ARE FEW, COUNTED WHEN THERE ARE MANY. Three references in a notification is
   * the whole answer; forty is a wall nobody reads, and the batch is one click away.
   */
  const which = input.references.length <= 3
    ? ` (${input.references.join(', ')})`
    : ''

  const message = `${accounts(input.references.length)} on ${input.clientName}'s handover had a `
    + `date of default in the future${which}. They were opened three months before handover and `
    + 'the client still has to confirm the real date.'

  const seen = new Set<string>()
  const out: CommunicationsNotice[] = []
  for (const userId of input.department) {
    if (!userId || userId === input.actorId || seen.has(userId)) continue
    seen.add(userId)
    out.push({ userId, type: 'handover.default_date_substituted', message, link })
  }
  return out
}
