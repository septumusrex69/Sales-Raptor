/**
 * What is happening on this account, in a sentence a client can read.
 *
 * COMPOSED FROM RECORDS, NEVER FROM AN AGENT'S NOTE. The firm asked whether the main comment
 * could go into client reporting and answered its own question in the same breath — "there's
 * going to be too many spelling mistakes". Spelling is the smaller half of the problem. An
 * agent's note is written for the next agent: "debtor avoiding, chancer, try the work number" is
 * useful internally and is not going to a client however it is spelled.
 *
 * So nothing here paraphrases anything. Every clause is built from a record that already exists
 * — a call, a promise, a payment, the diary — which means no spelling risk, no risk of a rewrite
 * changing what was meant, and the same shape on all four hundred accounts. It is also usually
 * more informative than the note would have been.
 *
 *   "Contacted 14 Sept by phone. Debtor undertook to pay R2 000 by 25 Sept. Next follow-up 26 Sept."
 *   "Called 12 Sept — no answer. Third attempt this month. Next follow-up 18 Sept."
 *   "No contact attempted since 8 June."
 *
 * THAT LAST ONE IS THE POINT. When the firm has not worked an account, the sentence says so. A
 * report that dressed up its own silence as the debtor's would be the one dishonest thing in the
 * whole document, and it is the easiest to write by accident.
 *
 * Pure: every input is passed in, nothing is fetched, and `today` is an argument rather than a
 * clock — a report re-run in June must read exactly as it did in March.
 */
/**
 * "14 Sep 2026", pinned to UTC.
 *
 * Written here rather than imported from the app's formatDate for two reasons. The report module
 * has no business dragging in the mock dataset; and formatDate parses a plain 'YYYY-MM-DD'
 * through the local clock, which puts a South African evening on the wrong day. A figure in a
 * client report has to read the same wherever it is rendered and whenever it is re-run.
 */
function onDate(iso: string): string {
  return new Intl.DateTimeFormat('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`))
}

export type ContactChannel = 'phone' | 'email' | 'sms' | 'letter' | 'whatsapp'

const CHANNEL_WORD: Record<ContactChannel, string> = {
  phone: 'by phone',
  email: 'by email',
  sms: 'by SMS',
  letter: 'by letter',
  whatsapp: 'on WhatsApp',
}

export interface NarrativeInput {
  /** The last time we tried, whatever came of it. 'YYYY-MM-DD'. */
  lastAttemptOn?: string | null
  lastAttemptChannel?: ContactChannel | null
  /**
   * Did the debtor respond to that attempt?
   *
   * THREE STATES, NOT TWO. true is contact made, false is a recorded non-answer, and
   * undefined is "something was logged against this account and nobody recorded what came of
   * it" — which is most of the imported book, where 8 calls are logged across 736 accounts and
   * none of them records an answer. Collapsing undefined into false would put "no reply" in
   * front of a client as a statement of fact about the debtor, when it is really a gap in ours.
   */
  reached?: boolean | null
  /** Attempts made this period, for the "third attempt" clause. */
  attemptsThisPeriod?: number
  /** An open promise: what they undertook to pay, and by when. */
  promise?: { amount: number; dueOn: string } | null
  /** A payment received in the period. */
  paidInPeriod?: { amount: number; on: string } | null
  /** The next date this account is booked to be worked. */
  nextFollowUpOn?: string | null
  /** Why work is stopped, where it is. */
  frozenReason?: string | null
}

const money = (v: number): string =>
  'R' + Math.round(v).toLocaleString('en-ZA').replace(/,/g, ' ')

/**
 * The account's story, as sentences.
 *
 * Returns an empty string rather than a placeholder when there is genuinely nothing to say. A
 * report can then leave the cell blank, which reads as "nothing here" — where "No information
 * available" reads as a system that has lost something.
 */
export function accountNarrative(input: NarrativeInput): string {
  const parts: string[] = []

  if (input.frozenReason) {
    // Said first and on its own: everything else is about work that is not happening.
    parts.push(`Work is on hold — ${trimStop(input.frozenReason)}.`)
  }

  if (input.paidInPeriod) {
    parts.push(`Payment of ${money(input.paidInPeriod.amount)} received ${onDate(input.paidInPeriod.on)}.`)
  }

  if (input.lastAttemptOn) {
    const channel = input.lastAttemptChannel ? ` ${CHANNEL_WORD[input.lastAttemptChannel]}` : ''
    if (input.reached === true) {
      parts.push(`Contacted ${onDate(input.lastAttemptOn)}${channel}.`)
    } else if (input.reached === false) {
      /*
       * The attempt count only earns its place once there is more than one. "First attempt this
       * month" beside a single call reads as an excuse; "Fourth attempt this month" is the
       * firm showing its work.
       */
      const n = input.attemptsThisPeriod ?? 0
      const nth = n > 1 ? ` ${ordinal(n)} attempt this period.` : ''
      parts.push(`Tried ${onDate(input.lastAttemptOn)}${channel} — no reply.${nth}`)
    } else {
      // Something was done; what came of it was never recorded. Say only what is known.
      parts.push(`Last worked ${onDate(input.lastAttemptOn)}${channel}.`)
    }
  } else if (!input.frozenReason && !input.paidInPeriod) {
    parts.push('No contact attempted.')
  }

  if (input.promise) {
    parts.push(`Debtor undertook to pay ${money(input.promise.amount)} by ${onDate(input.promise.dueOn)}.`)
  }

  if (input.nextFollowUpOn) {
    parts.push(`Next follow-up ${onDate(input.nextFollowUpOn)}.`)
  }

  return parts.join(' ')
}

/** "Fourth", up to the point where a numeral reads better than a word. */
function ordinal(n: number): string {
  const words = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth']
  if (n < words.length) return words[n]
  const s = ['th', 'st', 'nd', 'rd'][(n % 100 - n % 10 !== 10 ? n % 10 : 0)] ?? 'th'
  return `${n}${s}`
}

/** A reason somebody typed may or may not end in a full stop. The sentence supplies its own. */
function trimStop(text: string): string {
  return text.trim().replace(/[.!]+$/, '')
}
