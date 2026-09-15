import type { Arrangement } from './arrangements.ts'
import type { DiaryKind } from './diaryPriority.ts'

/**
 * What is happening on this account, in sentences a client can read.
 *
 * TWO SENTENCES, NOT ONE, at the firm's instruction. What HAPPENED and what we will DO next are
 * different facts and a client reads them differently: the first is the firm showing its work,
 * the second is the firm making a commitment. Run together they blur, and the commitment — the
 * half a client actually checks you against — gets lost at the end of a longer sentence.
 *
 * COMPOSED FROM RECORDS, NEVER FROM AN AGENT'S NOTE. The firm asked whether the main comment
 * could go into client reporting and answered its own question — "there's going to be too many
 * spelling mistakes". Spelling is the smaller half: an agent's note is written for the next
 * agent, and "debtor avoiding, chancer, try the work number" is not going to a client however it
 * is spelled.
 *
 * So every clause is built from something already recorded — a promise with its own date and
 * amount, a payment, a dispute, a trace, the diary entry that says what happens next. No
 * spelling risk, no paraphrase risk, the same shape on four hundred accounts, and usually more
 * informative than the note would have been.
 *
 * AND IT SAYS WHEN NOTHING HAS HAPPENED. A report that dressed the firm's own silence up as the
 * debtor's would be the one dishonest thing in the document, and it is the easiest to write by
 * accident.
 *
 * Pure: every input is passed in, nothing is fetched, and there is no clock. A report re-run in
 * June must read exactly as it did in March.
 */

export type ContactChannel = 'phone' | 'email' | 'sms' | 'letter' | 'whatsapp'

const CHANNEL_WORD: Record<ContactChannel, string> = {
  phone: 'by telephone',
  email: 'by email',
  sms: 'by SMS',
  letter: 'by letter',
  whatsapp: 'on WhatsApp',
}

export interface NarrativeInput {
  /** The last time the account was worked, whatever came of it. 'YYYY-MM-DD'. */
  lastAttemptOn?: string | null
  lastAttemptChannel?: ContactChannel | null
  /**
   * Did the debtor respond?
   *
   * THREE STATES. true is contact made, false is a recorded non-answer, and undefined is
   * "something was logged and nobody recorded what came of it" — which is most of the imported
   * book, where 8 calls are logged across 736 accounts and none records an answer. Collapsing
   * undefined into false puts "no reply" in front of a client as a statement about the DEBTOR,
   * when it is really a gap in ours.
   */
  reached?: boolean | null
  /** Attempts made this period, for the "third attempt" clause. */
  attemptsThisPeriod?: number
  /** The promise that matters: the open one, or the one most recently broken. */
  promise?: {
    amount: number
    dueOn: string
    /** When the debtor gave it. What turns "a promise exists" into "they promised on the 15th". */
    takenOn?: string | null
    status?: 'open' | 'broken' | 'kept'
    /** Once-off, weekly or monthly. A recurring promise reads differently. */
    arrangement?: Arrangement
  } | null
  /** A payment received in the period. */
  paidInPeriod?: { amount: number; on: string } | null
  /** When the debtor disputed the account. */
  disputeRaisedOn?: string | null
  /** When a trace went to the bureaus. */
  traceLodgedOn?: string | null
  /**
   * What is booked next, from the diary entry itself.
   *
   * The KIND is what makes this worth saying. "We will follow up on the 22nd" is a date; "We
   * will confirm the promised payment on 30 September" is a commitment a client can hold the
   * firm to, and the diary already knows which of the two it is.
   */
  next?: { kind: DiaryKind; dueOn: string } | null
  /** Why work is stopped, where it is. */
  frozenReason?: string | null
  frozenOn?: string | null
}

export interface ClientLine {
  /** What took place. Empty only when nothing ever has. */
  happened: string
  /** What the firm will do next, and when. Empty when nothing is booked. */
  next: string
}

const money = (v: number): string =>
  'R' + Math.round(v).toLocaleString('en-ZA').replace(/,/g, ' ')

/**
 * "30 September 2026", pinned to UTC.
 *
 * Spelled out rather than "30 Sep": these sentences are prose in a formal document, and the year
 * is carried because a client reading a March report about a promise "due 30 September" should
 * not have to work out which September.
 *
 * Written here rather than imported from the app's formatDate, which parses a plain date through
 * the local clock and puts a South African evening on the wrong day. A figure in a client report
 * must read the same wherever it is rendered and whenever it is re-run.
 */
function onDate(iso: string): string {
  return new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`))
}

/* ---------- what happened ---------- */

function whatHappened(input: NarrativeInput): string {
  /*
   * ONE SENTENCE, THE MOST MEANINGFUL ONE, in a deliberate order. A client reading four hundred
   * of these wants the single thing that most describes where the account stands, not a diary
   * transcript — and money outranks words, a broken promise outranks an intact one, and anything
   * the debtor did outranks anything we merely attempted.
   */
  if (input.frozenReason) {
    const when = input.frozenOn ? ` on ${onDate(input.frozenOn)}` : ''
    return `Work was paused${when} — ${trimStop(input.frozenReason)}.`
  }

  if (input.paidInPeriod) {
    return `We received a payment of ${money(input.paidInPeriod.amount)} on ${onDate(input.paidInPeriod.on)}.`
  }

  const p = input.promise
  if (p) {
    if (p.status === 'broken') {
      return `The debtor did not make the promised payment of ${money(p.amount)} due on ${onDate(p.dueOn)}.`
    }
    const when = p.takenOn ? `On ${onDate(p.takenOn)}, the` : 'The'
    /*
     * A recurring arrangement gets its own sentence shape rather than a parenthesis. "R750
     * (monthly instalment) by 30 September" reads as a single payment with a note stapled to it;
     * "monthly instalments of R750, beginning on 30 September" is what was actually agreed.
     */
    if (p.arrangement && p.arrangement !== 'once_off') {
      const every = p.arrangement === 'weekly' ? 'weekly' : 'monthly'
      return `${when} debtor agreed to pay ${every} instalments of ${money(p.amount)}, beginning on ${onDate(p.dueOn)}.`
    }
    return `${when} debtor promised to pay ${money(p.amount)} by ${onDate(p.dueOn)}.`
  }

  if (input.disputeRaisedOn) {
    return `The debtor disputed the account on ${onDate(input.disputeRaisedOn)}.`
  }
  if (input.traceLodgedOn) {
    return `We lodged a trace with the credit and information bureaus on ${onDate(input.traceLodgedOn)}.`
  }

  if (input.lastAttemptOn) {
    const channel = input.lastAttemptChannel ? ` ${CHANNEL_WORD[input.lastAttemptChannel]}` : ''
    if (input.reached === true) {
      return `We contacted the debtor${channel} on ${onDate(input.lastAttemptOn)}.`
    }
    if (input.reached === false) {
      /*
       * The attempt count earns its place only past the first. "First attempt this period" beside
       * a single call reads as an excuse; "Fourth attempt this period" is the firm showing work.
       */
      const n = input.attemptsThisPeriod ?? 0
      const nth = n > 1 ? ` This was the ${ordinal(n).toLowerCase()} attempt during the reporting period.` : ''
      return `We attempted to contact the debtor${channel} on ${onDate(input.lastAttemptOn)} but received no reply.${nth}`
    }
    // Worked, and what came of it was never recorded. Say only what is known.
    return `We worked the account on ${onDate(input.lastAttemptOn)}${channel}.`
  }

  return 'No contact attempt has been made yet.'
}

/* ---------- what happens next ---------- */

/**
 * What the diary says will happen, in the client's terms.
 *
 * Keyed on the diary kind, which is the whole reason this is worth saying: the firm already
 * records WHY an account is coming back, so the client can be told "we will confirm the promised
 * payment" rather than the far weaker "we will follow up".
 */
const NEXT_BY_KIND: Record<DiaryKind, (on: string) => string> = {
  promise_broken: (on) => `We will follow up the missed payment on ${on}.`,
  new_account: (on) => `We will make first contact with the debtor on ${on}.`,
  promise_due: (on) => `We will confirm the promised payment on ${on}.`,
  callback: (on) => `We will call the debtor again on ${on}, as arranged.`,
  dispute_chase: (on) => `We will follow up the written dispute on ${on}.`,
  no_contact: (on) => `We will try to reach the debtor again on ${on}.`,
  trace: (on) => `We will review the trace results on ${on}.`,
  review: (on) => `We will follow the account up on ${on}.`,
}

function whatNext(input: NarrativeInput): string {
  /*
   * A paused account has no next action and must not pretend to. What it has instead is a
   * statement of who the ball is with, which is the more useful thing to put in front of a
   * client looking at an account that has not moved in four months.
   */
  if (input.frozenReason) return 'Collection will remain paused until we receive further instruction.'
  /*
   * NO DIARY DATE IS ITS OWN STATEMENT, and an honest one. An active account with nothing booked
   * is adrift — the firm has stopped working it without deciding to — and a client is entitled
   * to see that rather than a blank space.
   */
  if (!input.next) return 'No further action has been scheduled.'
  return NEXT_BY_KIND[input.next.kind](onDate(input.next.dueOn))
}

export function clientLine(input: NarrativeInput): ClientLine {
  return { happened: whatHappened(input), next: whatNext(input) }
}

/** Both sentences, joined. For anywhere that has room for one line and not two. */
export function accountNarrative(input: NarrativeInput): string {
  const { happened, next } = clientLine(input)
  return [happened, next].filter(Boolean).join(' ')
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
