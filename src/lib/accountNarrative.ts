import type { Arrangement } from './arrangements.ts'
import type { TraceRound } from './traceRound.ts'
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
   * WHAT THE TRACE CAME TO, which is the part a client has never been told.
   *
   * THE FIRM, looking at a worked-through trace on the account screen: "this information regarding
   * the trace is very valuable information that we can possibly give to the client as well."
   *
   * They are right, and what the client got was one flat sentence -- "we lodged a trace on the
   * 2nd" -- which says the firm spent the client's money and nothing about what it bought. The
   * account screen beside it said twelve contact points worked, none of them reaching the debtor,
   * three lines still ringing. That is the answer to the question a client is actually asking,
   * which is "why has nothing happened on this account?"
   *
   * ------------------------------------------------------------------------------------------
   * THE RESULT, NEVER THE FINDINGS
   * ------------------------------------------------------------------------------------------
   *
   * THIS IS THE LINE AND IT IS NOT A STYLE CHOICE. The client is told HOW MUCH WORK the trace
   * produced and WHAT CAME OF IT. They are never told the numbers, the addresses, the employer,
   * or the names of relatives the bureau linked.
   *
   * Three reasons, and any one of them is enough. The data is a THIRD PARTY'S: a sister's mobile
   * number is her information, not the debtor's and not the client's. It is also data the firm
   * BOUGHT -- item 4(c) or item 3 against this debtor -- and a client handed the bureau's profile
   * has no reason to instruct anybody for the next one. And it would be a list of raw findings
   * with no outcome against them, which is the worst of both: it looks like the firm sharing
   * everything while answering nothing.
   *
   * ------------------------------------------------------------------------------------------
   * THE SAME READING THE COLLECTOR SEES
   * ------------------------------------------------------------------------------------------
   *
   * A TraceRound, from the function the account screen draws its own line with -- not a count
   * computed here. Written twice, the report and the screen would eventually disagree about
   * whether a trace had been worked through, and the client's copy is the one nobody in the firm
   * reads before it goes out.
   */
  trace?: { lodgedOn: string | null; round: TraceRound } | null
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
  /**
   * THE DAY THE CLIENT HANDED THIS ACCOUNT TO THE FIRM.
   *
   * The first true thing there is to say about an account nobody has worked yet, and better than
   * the absence it replaces: "No contact attempt has been made yet" is the firm reporting its own
   * silence, and on an account that arrived this morning it is both unflattering and the least
   * informative sentence available.
   */
  handedOverOn?: string | null
  /**
   * THE DAY THE HANDOVER NOTICES WENT OUT, where they have.
   *
   * THE FIRM, rejecting what this said on a fresh handover: "the account has been handed over,
   * the notifications of handover have gone out, we have initiated the negotiations, something
   * like that."
   *
   * NOT "WE HAVE INITIATED NEGOTIATIONS", which is the one part of that this does not do. Nobody
   * has spoken to the debtor; claiming a negotiation that has not happened is the single
   * dishonest thing this file exists to avoid, and it is the sentence that becomes a problem the
   * day a client asks for the call log behind it. What the notices going out buys is that there
   * IS something true and recent to say instead.
   */
  noticesSentOn?: string | null
  /**
   * THE DAY THIS LINE IS BEING READ AS AT. Today on a screen; the report's own date in a report.
   *
   * THE FIRM: "not 'we will make the first contact today', because the reports go out on the
   * 11th to the client." A monthly report is read a fortnight after the facts in it, and a
   * commitment to do something on a date that has already passed is not a commitment -- it is
   * the firm quoting a plan the client can see it missed.
   *
   * PASSED IN, NEVER READ OFF A CLOCK, like every other input here: a report re-run in June must
   * read exactly as it did in March, and a function that asked `new Date()` could not promise
   * that. Optional, and left out nothing is suppressed -- which is the old behaviour.
   */
  asAt?: string | null
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
  /*
   * THE TRACE, AND WHAT IT CAME TO.
   *
   * ABOVE THE PLAIN "we lodged a trace" SENTENCE, which is what is left when nobody has recorded a
   * result yet. The firm's complaint was that the lodging sentence was all a client ever got.
   */
  if (input.trace) {
    const line = traceSentence(input.trace.lodgedOn, input.trace.round)
    if (line) return line
  }
  if (input.traceLodgedOn) {
    return `We lodged a trace with the credit and information bureaus on ${onDate(input.traceLodgedOn)}.`
  }

  /*
   * THE HANDOVER NOTICES, ABOVE THE ATTEMPT CLAUSES, because they say more. The attempt sentence
   * below can manage "We emailed the debtor on 1 October"; this says WHAT the email was, which on
   * the first contact a debtor has ever had from this firm is the whole of the information.
   */
  if (input.noticesSentOn) {
    return `We wrote to the debtor on ${onDate(input.noticesSentOn)}, introducing the matter and `
      + 'asking them to settle the account.'
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

  /*
   * NOTHING DONE YET, SO SAY WHAT DID HAPPEN. The account arriving IS an event, it is dated, and
   * it is the client's own act -- so a client reading it learns where the file stands rather than
   * being told the firm has been quiet.
   *
   * IT STILL DOES NOT CLAIM CONTACT. "Handed over to us on the 17th" is the one fact available
   * and the sentence stops there; the moment a notice goes out, the clause above takes over and
   * says so.
   */
  if (input.handedOverOn) {
    return `The account was handed over to us on ${onDate(input.handedOverOn)}.`
  }

  /*
   * AND WHERE THERE IS NOT EVEN THAT, the silence is reported. This is the sentence the firm
   * objected to and it is kept for the case it was written for: an account with no handover date,
   * no notice sent and nothing recorded has genuinely had nothing done to it, and dressing that
   * up would be the one dishonest line in the document.
   */
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
  /*
   * A DATE THAT HAS PASSED IS NOT A COMMITMENT.
   *
   * THE FIRM: "not 'we will make the first contact today', because the reports go out on the 11th
   * to the client." A monthly report is read a fortnight after the month it covers, so "We will
   * follow the account up on 5 October" reaches a client in November as the firm quoting a plan
   * the client can see it missed -- and on a live screen it is simply wrong.
   *
   * EMPTY RATHER THAN REWORDED. `ClientLine.next` is already allowed to be empty and every reader
   * of it already guards on that, so the half that has nothing true to say says nothing -- while
   * `happened` carries on reporting what actually took place. Inventing a replacement commitment
   * here would be inventing a plan nobody made.
   *
   * ON the day itself still counts: a report dated the 5th about a follow-up booked for the 5th
   * is a promise about today, not about yesterday.
   */
  if (input.asAt && input.next.dueOn < input.asAt.slice(0, 10)) return ''
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

/**
 * WHAT A TRACE CAME TO, IN A SENTENCE A CLIENT READS.
 *
 * FOUR STATES, BECAUSE A TRACE HAS FOUR, and they are four genuinely different pieces of news:
 * the search returned nothing workable, it is part way through, it found the debtor, or it was
 * worked through and found nobody. The last is the one the firm was looking at and the one a
 * client most needs: it is the difference between an account nobody has got to and an account
 * nobody can find.
 *
 * COUNTS, NEVER CONTENTS. "Twelve numbers, email addresses and linked people" says the size of
 * the job; which twelve is the bureau's data about third parties and is not the client's -- see
 * NarrativeInput.trace.
 *
 * SPELLED OUT RATHER THAN CALLED "CONTACT POINTS". A creditor reading a monthly report should not
 * have to learn a word this firm uses internally, and "leads" -- the obvious short one -- already
 * means something else entirely in this app.
 *
 * AND IT NEVER SAYS "UNTRACEABLE". That is a decision a team leader makes about an account, not
 * something arithmetic may conclude on their behalf: three lines still ringing are three lines
 * somebody may yet answer, and a report that wrote the debtor off before the firm had would be
 * telling a client to stop expecting a recovery the firm has not stopped pursuing.
 */
export function traceSentence(lodgedOn: string | null, round: TraceRound): string | null {
  const when = lodgedOn ? ` on ${onDate(lodgedOn)}` : ''
  const found = `${round.workable} numbers, email addresses and linked people`

  /* NOTHING TO WORK IS A RESULT, and an expensive one: the search ran, the account was charged,
     and it produced nothing anybody could ring. A client paying for the next one should know. */
  if (round.workable === 0) {
    return `We traced the debtor${when}. The search returned no contact details we were able to work.`
  }

  if (round.state === 'working') {
    return `We traced the debtor${when}, and ${round.tried} of the ${found} it produced have been worked so far.`
  }

  if (round.state === 'worked_through') {
    /*
     * REACHED. The only outcome here that is good news, and it is said as plainly as the bad one.
     *
     * AND IT DOES NOT COUNT ANYTHING. "One of the twelve numbers, email addresses and linked
     * people it produced" is the size of a job nobody needs told about once the job has worked;
     * what the client wants from this sentence is that the debtor has been reached.
     */
    return `We traced the debtor${when} and made contact with them on one of the numbers it produced.`
  }

  /*
   * SPENT. Every one tried and none of it reached the debtor.
   *
   * THE SECOND SENTENCE IS WHAT STOPS THIS READING AS A DEAD END. Somebody answering who is not
   * the debtor is a live line and a person who knows them; a number that rang is an hour of
   * somebody's day still worth spending. Both are reasons the firm has not finished, and a client
   * told only "we worked twelve and found nothing" would reasonably ask why anybody is still on
   * the account.
   */
  const bits: string[] = [
    `We traced the debtor${when} and have worked all ${found} it produced without reaching them.`,
  ]
  if (round.reachedSomeone) {
    bits.push('Somebody else answered on one of the numbers, but we were not able to speak to the debtor.')
  }
  if (round.liveUntried > 0) {
    bits.push(round.liveUntried === 1
      ? 'One line is still ringing and will be tried again.'
      : `${round.liveUntried} lines are still ringing and will be tried again.`)
  }
  return bits.join(' ')
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
