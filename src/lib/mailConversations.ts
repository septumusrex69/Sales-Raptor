/**
 * CONVERSATION MODE: THE EMAILS OF ONE TRAIL, TOGETHER (R-13's second half, S19 · Raptor H18).
 *
 * Rinda: "can we have conversation mode on the email tab to have all the emails together that is in a trail."
 * Stephan, 8 Nov: "You can build in the conversation mode."
 *
 * HOW A TRAIL IS RECOGNISED. Raptor does not keep a message's In-Reply-To / References headers, so the mail server's
 * own thread is not available -- and a rule that needed them would only ever work on mail arriving from today. So it
 * is what Outlook's conversation view does: the SUBJECT with its reply and forward prefixes taken off ("Re:", "Fw:",
 * "Fwd:", "AW:", "Antw:", "[EXT]" ... however many deep). Alone that is wrong for a debt collector: two debtors who
 * each write "Proof of payment" are not one conversation. So a trail is the same subject AMONG PEOPLE IN COMMON --
 * messages join when they share a sender or a recipient, the person's own addresses left out (every message they
 * receive names them; counting that would join everything). Joined transitively: A writes, B is copied on the reply,
 * B answers -- one trail.
 *
 * NOTHING IS STORED. A grouping is worked out from the rows in hand, so there is no column to fall out of step and
 * turning the mode off puts the mailbox back exactly as it was.
 */

export interface ConversationMail {
  id: string
  subject: string | null
  fromAddress: string | null
  toAddress?: string | null
  toRecipients?: { address: string | null }[]
  ccRecipients?: { address: string | null }[]
  occurredAt: string
  readAt: string | null
}

/* Reply and forward markers in the languages the firm's mail arrives in, and the tags gateways put in front. */
const PREFIX = /^\s*(?:(?:re|fw|fwd|aw|wg|antw|sv|vs|tr|rv)\s*(?:\[\d+\])?\s*:|\[(?:ext|external)\]|\((?:ext|external)\))\s*/i

/** "RE: Fw: re:  Statement for October " -> "statement for october". Empty for no subject. */
export function conversationSubject(subject: string | null | undefined): string {
  let s = (subject ?? '').trim()
  for (let i = 0; i < 20; i += 1) {
    const next = s.replace(PREFIX, '')
    if (next === s) break
    s = next
  }
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Everybody on a message bar the mailbox's owner, lower-cased. */
export function participants(m: ConversationMail, mine: (string | null | undefined)[]): Set<string> {
  const own = new Set(mine.filter(Boolean).map((a) => (a as string).trim().toLowerCase()))
  const out = new Set<string>()
  const add = (a: string | null | undefined) => {
    const x = (a ?? '').trim().toLowerCase()
    if (x && !own.has(x)) out.add(x)
  }
  add(m.fromAddress)
  add(m.toAddress)
  for (const r of m.toRecipients ?? []) add(r.address)
  for (const r of m.ccRecipients ?? []) add(r.address)
  return out
}

export interface Conversation<T extends ConversationMail> {
  /** Stable for as long as its newest message is: the newest message's id. */
  key: string
  /** Newest first. */
  members: T[]
  latest: T
  unread: number
}

/**
 * The rows in hand, grouped into trails, in the order the newest message of each arrived (newest first). A message
 * with no subject is a trail of its own: an empty subject is not a topic two messages can share.
 */
export function groupConversations<T extends ConversationMail>(items: T[], mine: (string | null | undefined)[]): Conversation<T>[] {
  const parent = items.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const people = items.map((m) => participants(m, mine))
  const bySubject = new Map<string, number[]>()
  items.forEach((m, i) => {
    const s = conversationSubject(m.subject)
    if (!s) return
    bySubject.set(s, [...(bySubject.get(s) ?? []), i])
  })
  for (const idx of bySubject.values()) {
    /* Same subject: join any two that share a person. Small groups, so pairwise is fine. */
    for (let a = 0; a < idx.length; a += 1) {
      for (let b = a + 1; b < idx.length; b += 1) {
        const pa = people[idx[a]]
        if ([...people[idx[b]]].some((p) => pa.has(p))) parent[find(idx[a])] = find(idx[b])
      }
    }
  }
  const groups = new Map<number, T[]>()
  items.forEach((m, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), m]))
  const newest = (a: T, b: T) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)
  return [...groups.values()]
    .map((members) => {
      const sorted = [...members].sort(newest)
      return { key: sorted[0].id, members: sorted, latest: sorted[0], unread: sorted.filter((m) => !m.readAt).length }
    })
    .sort((a, b) => newest(a.latest, b.latest))
}

/** Whether `candidate` belongs in the trail `trail` is: the same subject and somebody in common with one of them. */
export function inConversation(candidate: ConversationMail, trail: ConversationMail[], mine: (string | null | undefined)[]): boolean {
  const s = conversationSubject(candidate.subject)
  if (!s) return trail.some((t) => t.id === candidate.id)
  const theirs = participants(candidate, mine)
  return trail.some((t) => conversationSubject(t.subject) === s
    && [...participants(t, mine)].some((p) => theirs.has(p)))
}
