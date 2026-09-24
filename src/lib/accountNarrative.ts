import type { Arrangement } from './arrangements.ts'
import type { ClientPosition } from './clientPosition.ts'
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
  /**
   * The rung the account is on, where it is known.
   *
   * WHAT THE DEBTOR SAID IS A FACT ABOUT THE DEBTOR, and it is the most informative thing a
   * client can be told — more than any attempt we made. "The debtor advised that they are unable
   * to pay" is the answer to the question a client is really asking; "we worked the account" is
   * the firm talking about itself, which the firm's own verdict on was that it is stupid.
   *
   * Optional, because a monthly report is assembled from records rather than from a call that has
   * just happened. Where it is absent the sentences below fall back to what was recorded.
   */
  position?: ClientPosition | null
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
    /*
     * NO FIGURE ON A PROMISE, at the firm's instruction and for a good reason: "it could create
     * confusion because of the NCA fees". What a debtor undertakes to pay is not what settles the
     * account — interest and recoverable costs move between the promise and the payment — so a
     * client shown "R2 000" reads it as the balance and asks why the account is not R2 000 lighter
     * next month.
     *
     * The DATE stays, because that is what a client checks us against, and it comes off the
     * promise record rather than out of anybody's typing.
     *
     * Money RECEIVED keeps its figure. That one is not an undertaking, it is a fact about what
     * arrived, and it is the number a client most wants.
     */
    if (p.status === 'broken') {
      return `The debtor did not make the payment arranged for ${onDate(p.dueOn)}.`
    }
    const when = p.takenOn ? `On ${onDate(p.takenOn)}, the` : 'The'
    /*
     * A recurring arrangement still gets its own sentence shape. "An arrangement beginning on the
     * 30th" reads as one payment; naming the rhythm is what tells a client to expect more.
     */
    if (p.arrangement && p.arrangement !== 'once_off') {
      const every = p.arrangement === 'weekly' ? 'weekly' : 'monthly'
      return `${when} debtor made an arrangement to pay ${every} instalments, beginning on ${onDate(p.dueOn)}.`
    }
    return `${when} debtor made an arrangement to pay on ${onDate(p.dueOn)}.`
  }

  if (input.disputeRaisedOn) {
    return `The debtor disputed the account on ${onDate(input.disputeRaisedOn)}.`
  }

  /*
   * WHAT THE DEBTOR SAID, where somebody recorded it. Above the attempt clauses because it is a
   * fact about the DEBTOR and those are facts about us — and the firm's verdict on the latter was
   * that telling a client "we worked the account" is stupid. It is: it says nothing happened
   * while sounding like something did.
   *
   * Only the rungs that come from a conversation are here. Arranged, disputed, tracing and under
   * administration all have their own record above and read from it, which is more precise than
   * anything this could say.
   */
  if (input.lastAttemptOn && (input.position === 'negotiating' || input.position === 'cannot_pay'
      || input.position === 'refusing')) {
    const on = onDate(input.lastAttemptOn)
    if (input.position === 'negotiating') return `We negotiated with the debtor on ${on}.`
    if (input.position === 'cannot_pay') {
      return `The debtor advised on ${on} that they are not in a position to pay the account.`
    }
    return `The debtor advised on ${on} that they are not willing to pay the account.`
  }
  if (input.position === 'under_administration') {
    return 'The debtor is under a formal process and the matter is being dealt with through the appointed practitioner.'
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
    /*
     * AN ACTION WAS RECORDED AND ITS OUTCOME WAS NOT. Say the action, and nothing about how it
     * went -- claiming contact would be inventing the outcome.
     *
     * THE FIRM ON THE OLD WORDING: "we don't say that an account was worked. It is a very vague
     * and stupid way to say it. We worked on a construction site -- that's what we did. We didn't
     * work on a debtor's account. We had actions. We got in touch, we negotiated, we made an
     * arrangement, we attempted contact, the debtor was avoiding."
     *
     * So the channel becomes the verb rather than a trailing qualifier: "We telephoned the debtor
     * on 16 September" says what was done. Where even the channel is unknown there is nothing
     * descriptive left to say, so it names the fact it has -- an action, on a date -- rather than
     * dressing it up as contact.
     */
    const ACTION_VERB: Record<ContactChannel, string> = {
      phone: 'telephoned the debtor',
      email: 'emailed the debtor',
      sms: 'sent the debtor an SMS',
      letter: 'wrote to the debtor',
      whatsapp: 'messaged the debtor on WhatsApp',
    }
    const did = input.lastAttemptChannel ? ACTION_VERB[input.lastAttemptChannel] : null
    return did
      ? `We ${did} on ${onDate(input.lastAttemptOn)}.`
      : `We logged an action on this account on ${onDate(input.lastAttemptOn)}.`
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
  promise_due: (on) => `We will confirm the arranged payment on ${on}.`,
  callback: (on) => `We will call the debtor again on ${on}, as arranged.`,
  dispute_chase: (on) => `We will follow up the written dispute on ${on}.`,
  no_contact: (on) => `We will try to reach the debtor again on ${on}.`,
  trace: (on) => `We will follow up the trace on ${on}.`,
  review: (on) => `We will follow the account up on ${on}.`,
}

/*
 * A FOLLOW-UP IS NOT ONE THING. Four different rungs all book a plain follow-up and a client
 * reading "we will follow the account up" learns nothing from any of them — the firm spelled out
 * what each one is actually going to do, and it is different work in each case. Keyed on the rung
 * as well as the kind for that reason, and only where the plain sentence is too weak to be worth
 * printing.
 */
const NEXT_BY_POSITION: Partial<Record<ClientPosition, (on: string) => string>> = {
  negotiating: (on) => `We will continue negotiations with the debtor on ${on}.`,
  cannot_pay: (on) => `We will follow up on ${on} to establish whether an arrangement can be made.`,
  refusing: (on) => `We will follow up on ${on} to press for an arrangement.`,
  under_administration: (on) => `We will take the matter up with the appointed practitioner on ${on}.`,
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
  const on = onDate(input.next.dueOn)
  /*
   * The rung only speaks where the diary has nothing more specific to say. A dispute chase or a
   * promise due already names the work exactly; it is the plain follow-up that needs telling
   * apart, so the override is read only there.
   */
  if (input.next.kind === 'review' && input.position) {
    const better = NEXT_BY_POSITION[input.position]
    if (better) return better(on)
  }
  return NEXT_BY_KIND[input.next.kind](on)
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
