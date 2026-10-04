/**
 * WHAT A COLLECTOR MAY SAY, TO WHOM, AND WHEN THE FIRM MAY RING AT ALL.
 *
 * From the firm's own brief, BF-Collector-CALL-SCRIPTS: 31 scripts and the rules around them.
 * This file is the RULES half -- which script the account calls for, who may be told anything,
 * what every call must end with, and the hours. The words themselves are templates in the library,
 * because the firm edits those and does not edit this.
 *
 * WHY THE RULES ARE SEPARATE FROM THE WORDS. A script is read off a screen by a person while a
 * debtor is on the line, so the thing that decides WHICH script appears has to be right before
 * anybody speaks. The firm: "a collector reading {{balance}} aloud off the screen is the failure
 * this is meant to prevent." Getting the choice wrong is the same class of failure one step
 * earlier -- the right words to the wrong person.
 *
 * AND THE PENALTY IS NOT A BAD SCREEN. Every line here traces to the Debt Collectors Act code of
 * conduct or to POPIA. The firm's own list of what founds a complaint to the Council for Debt
 * Collectors runs to nine items, and three of them are disclosure to somebody who was never
 * verified. That is why the capability matrix below is a closed table rather than a convention.
 *
 * Pure: no database, no clock. The account's state and the moment are passed in.
 */
import { isWeekend, publicHolidays } from './workingDays.ts'
/* A DISPOSITION RESOLVES TO ONE OF THESE. Type-only, so nothing of the outcome box's own machinery
   is dragged in here -- see OUTCOME_FOR_DISPOSITION for why the two vocabularies meet at all. */
import type { CallOutcome } from './callOutcome.ts'

/* =================================================================================================
 * WHAT EVERY CALL ENDS WITH
 * ============================================================================================== */

/**
 * The disposition codes, from the firm's own table.
 *
 * SIXTEEN, AND THE BRIEF SAYS FOURTEEN. The covering note counts "the 14 codes are listed in the
 * document"; the document lists sixteen. The document is the firm's own content and the one a
 * collector works from, so sixteen is what is built -- and the discrepancy is written down here
 * rather than quietly resolved, because the two that would have been dropped (EXEC and MAND) are
 * exactly the two that stop a disclosure to somebody who has not proved who they are.
 *
 * `stops` IS NOT A COMMENT. It is the four codes after which nothing automated may fire on the
 * account at all -- the firm: "stop everything, route to the manager". A workflow that keeps
 * sending on a deceased estate is the failure that reaches a family.
 */
export interface Disposition {
  code: string
  /** What it means, in the collector's own words. */
  meaning: string
  /** What Raptor does with it. */
  then: string
  /** Everything automated stops on the account and a manager picks it up. */
  stops: boolean
}

export const DISPOSITIONS: Disposition[] = [
  { code: 'PIF', meaning: 'Paid in full', then: 'Close the file, fire the paid-up set', stops: false },
  { code: 'PTP', meaning: 'Promise to pay captured', then: 'Start the payment arrangement workflow, pause collections', stops: false },
  { code: 'SETL', meaning: 'Settlement offer to be put to the client', then: 'Open a settlement ticket', stops: false },
  /* NOTHING IS PAUSED ON A VERBAL DISPUTE, which is the firm's own rule elsewhere in Raptor too:
     the written one starts the sequence, the spoken one starts the ticket. */
  { code: 'DISP', meaning: 'Dispute alleged on the call', then: 'Start the dispute workflow at stage A, nothing is paused', stops: false },
  { code: 'RTP', meaning: 'Refuses to pay', then: 'Leave the workflow running, note the reason', stops: false },
  { code: 'NAN', meaning: 'No answer, no voicemail', then: 'Retry per the contact rules', stops: false },
  { code: 'VM', meaning: 'Voicemail left', then: 'Retry per the contact rules', stops: false },
  { code: 'TPC', meaning: 'Third party reached, message left', then: 'No disclosure made, retry', stops: false },
  { code: 'WN', meaning: 'Wrong number', then: 'Remove the number from the account, trace', stops: false },
  { code: 'RPC', meaning: 'Right party contacted, no outcome yet', then: 'Diarise the call back', stops: false },
  { code: 'DRV', meaning: 'Under debt review', then: 'Stop everything, route to the manager', stops: true },
  { code: 'DEC', meaning: 'Debtor deceased', then: 'Stop everything, route to the manager', stops: true },
  { code: 'INS', meaning: 'Insolvent, sequestrated or in business rescue', then: 'Stop everything, route to the manager', stops: true },
  { code: 'EXEC', meaning: "Executor or Master's Representative confirmed", then: 'Deal with the estate only, stop all contact with the family', stops: true },
  { code: 'MAND', meaning: 'A third party has claimed authority, proof requested', then: 'Nothing disclosed, diarise 3 days for the mandate', stops: false },
  { code: 'DNC', meaning: 'Asked not to be called at this number', then: 'Honour it, use the other channels', stops: false },
]

const BY_CODE = new Map(DISPOSITIONS.map((d) => [d.code, d]))

export function disposition(code: string): Disposition | null {
  return BY_CODE.get(code) ?? null
}

/** Does this outcome stop everything automated on the account? */
export function stopsEverything(code: string): boolean {
  return BY_CODE.get(code)?.stops ?? false
}

/* =================================================================================================
 * WHO MAY BE TOLD WHAT
 * ============================================================================================== */

/**
 * WHAT A PERSON ON THE LINE MAY BE TOLD, BY WHAT THEY ARE.
 *
 * THE FIRM: "this is the part that cannot live in a collector's head."
 *
 * THREE RULES THEY ASKED RAPTOR TO ENFORCE RATHER THAN SUGGEST, and each is a row below:
 *
 *   1. A SPOUSE IS NOT AN AUTHORISED CONTACT BY MARRIAGE. Marriage in community of property
 *      changes who is liable and what the attorneys do at the legal stage; it entitles a spouse to
 *      be told nothing. They become authorised as a party, a surety or a mandate holder, like
 *      anybody else.
 *   2. AN EMPLOYER IS NEVER AN AUTHORISED CONTACT. The only thing an employer is ever asked is to
 *      confirm employment, in writing, on the firm's own letter.
 *   3. CONFIRMING THE ACCOUNT EXISTS IS ITSELF A DISCLOSURE. `nothing` below means nothing: not
 *      the balance, not the creditor, not whether there is an account at all.
 *
 * PROOF IS A FACT ABOUT THE ROW, NOT ABOUT HOW LONG IT HAS BEEN THERE. The firm: "a row with no
 * proof on file is not an authorised contact, however long it has been there."
 */
export type TellLevel =
  /** Everything on the account. */
  | 'everything'
  /** The principal debt and their own liability, and nothing else about the debtor. */
  | 'own_liability'
  /** Nothing at all -- including whether the account exists. */
  | 'nothing'

export interface Capacity {
  id: string
  label: string
  /** What must be on file before a word is said. Empty where the proof is the call itself. */
  proof: string
  tell: TellLevel
  /**
   * The call stops and a manager takes it, whatever else is true.
   *
   * A DEBT COUNSELLOR IS THE ONE WHO IS BOTH AUTHORISED AND SILENCED: Form 17.1 or 17.2 is real
   * proof, and the correct response to it is to stop collecting rather than to discuss anything.
   */
  stopsCollection?: boolean
}

export const CAPACITIES: Capacity[] = [
  { id: 'debtor', label: 'The debtor', proof: 'Verified on the call, per the opening script', tell: 'everything' },
  { id: 'co_debtor', label: 'A co-debtor named on the account', proof: 'Verified as a debtor', tell: 'everything' },
  { id: 'surety', label: 'A surety', proof: 'The signed deed of suretyship, on file', tell: 'own_liability' },
  { id: 'executor', label: "An executor or Master's Representative", proof: 'Letters of Executorship, or the section 18(3) appointment', tell: 'everything' },
  { id: 'attorney', label: 'An attorney', proof: "A letter on the firm's letterhead confirming they act", tell: 'everything' },
  { id: 'curator', label: 'A curator', proof: 'The court order appointing them', tell: 'everything' },
  { id: 'power_of_attorney', label: 'Holder of a power of attorney', proof: 'The signed power of attorney plus both identity documents', tell: 'everything' },
  {
    id: 'mandated',
    label: 'A mandated relative, friend or bookkeeper',
    proof: "An email from the debtor's own address naming them, or a signed letter plus the debtor's identity document",
    tell: 'everything',
  },
  {
    id: 'debt_counsellor',
    label: 'A debt counsellor',
    proof: 'Form 17.1 or 17.2 and the NCRDC number',
    tell: 'nothing',
    stopsCollection: true,
  },
  /*
   * THE CATCH-ALL, AND IT INCLUDES A SPOUSE BY NAME. Written as a row rather than left as the
   * absence of a row: a collector looking for "spouse" has to find the answer, not fail to find
   * the question.
   */
  { id: 'anyone_else', label: 'Anyone else, including a spouse', proof: '', tell: 'nothing' },
]

const BY_CAPACITY = new Map(CAPACITIES.map((c) => [c.id, c]))

/**
 * What this person may be told, given what they are and whether their proof is on file.
 *
 * NO PROOF IS NOT A DEGRADED ANSWER, IT IS `nothing`. A surety whose deed is not on file is a
 * stranger who says they are a surety, and the account's existence is itself a disclosure.
 */
export function mayBeTold(capacityId: string, proofOnFile: boolean): TellLevel {
  const capacity = BY_CAPACITY.get(capacityId)
  if (!capacity) return 'nothing'
  if (capacity.proof && !proofOnFile) return 'nothing'
  return capacity.tell
}

/** Whether reaching this person means the account stops and a manager picks it up. */
export function stopsOnContact(capacityId: string): boolean {
  return BY_CAPACITY.get(capacityId)?.stopsCollection ?? false
}

/* =================================================================================================
 * WHICH SCRIPT POPS
 * ============================================================================================== */

/**
 * What Raptor knows about the account at the moment the call connects.
 *
 * EVERY FIELD IS A FACT RATHER THAN A JUDGEMENT, so this can be filled from the row without
 * anybody deciding anything on the way.
 */
export interface CallState {
  debtorKind: 'individual' | 'company'
  deceased?: boolean
  underDebtReview?: boolean
  insolvent?: boolean
  /** A dispute received IN WRITING and not yet resolved. A verbal one does not suspend anything. */
  writtenDisputeOpen?: boolean
  /** An arrangement in default, inside the 48 hours the firm gives to put it right. */
  arrangementInDefault?: boolean
  /** An instalment due today and unpaid. */
  instalmentDueToday?: boolean
  settlementLive?: boolean
  /** Where the collections workflow has got to, as the node's own key. */
  workflowNode?: 'intended_summons' | 'listed' | 'listing_prep' | 'final_notice' | 'reminder'
    | 'section_129' | 'handover' | null
}

/**
 * THE TWO HARD STOPS, and the firm wrote them as such: "the first two rows are hard stops, not
 * preferences. The account must not appear in a dialler campaign at all while it is in one of
 * those states."
 *
 * Returns the reason, or null where the firm may ring.
 */
export function doNotDial(state: CallState): string | null {
  if (state.deceased) return 'The debtor is deceased — the account is a claim against the estate.'
  if (state.underDebtReview) return 'The account is under debt review.'
  if (state.insolvent) return 'The debtor is insolvent, sequestrated or in business rescue.'
  if (state.writtenDisputeOpen) return 'A written dispute is open — collection is suspended.'
  return null
}

/**
 * The script this account calls for, resolved in the firm's own order. The first match wins.
 *
 * ORDER IS THE WHOLE BEHAVIOUR. A broken arrangement outranks the workflow node because that is
 * the conversation to have; the workflow node outranks nothing-else-matches because the debtor has
 * had a letter and the collector has to know which one.
 *
 * THE OPENING SCRIPT IS NOT IN HERE. It pops first on every call, always, and the workflow script
 * under it is locked until the collector ticks "verified" -- which is the control that stops an
 * account being disclosed to the wrong person. See openingScript.
 */
export function scriptFor(state: CallState): string | null {
  if (doNotDial(state)) return null
  if (state.arrangementInDefault) return 'script-ptp-default-call'
  if (state.instalmentDueToday) return 'script-ptp-due-call'
  if (state.settlementLive) return 'script-settlement-call'
  switch (state.workflowNode) {
    case 'intended_summons': return 'script-intended-summons-call'
    case 'listed': return 'script-listed-call'
    case 'listing_prep': return 'script-listing-prep-call'
    case 'final_notice': return 'script-final-notice-call'
    case 'reminder': return 'script-reminder-call'
    case 'section_129':
      /* A COMPANY GETS A LETTER OF DEMAND, NOT A SECTION 129. The NCA's notice is a credit
         agreement's; a company is written to under the common law, and the script says so. */
      return state.debtorKind === 'company' ? 'script-demand-call-company' : 'script-s129-call'
    default:
      return 'script-handover-call'
  }
}

/**
 * WHICH WORKFLOW NODE A STEP IS, off the label the firm gave it.
 *
 * THERE IS NO KEY ON A NODE. `workflow_nodes` carries a label, a day, an ordinal and a channel,
 * and the label is what the firm writes on their own chart -- "Section 129 / letter of demand",
 * "Notice of intention to list", "Listed". So the node a call script belongs to has to be read off
 * that, and it is read off a CLOSED MAP rather than by matching words: a `includes('listing')`
 * would read "Notice of intention to list" and "Listed" as the same stage, which are the call
 * before the default is reported and the call after it. Those are opposite conversations -- one
 * says it can still be stopped, the other says it cannot be undone.
 *
 * THE " SMS" SUFFIX IS DROPPED FIRST, because every step in the firm's sequence is written twice,
 * as an email and as the SMS beside it, and they are one stage.
 *
 * NULL FOR ANYTHING ELSE -- the arrangement and dispute sequences have their own nodes, and
 * scriptFor already decides those from the account's state rather than from a node. A label this
 * does not know falls through to the handover script, which is the firm's own "nothing else
 * matches" row and is the safest of the eight: it says least.
 */
const NODE_BY_LABEL: Record<string, NonNullable<CallState['workflowNode']>> = {
  'section 129 / letter of demand': 'section_129',
  reminder: 'reminder',
  'final notice': 'final_notice',
  'notice of intention to list': 'listing_prep',
  listed: 'listed',
  'intended summons': 'intended_summons',
  'handover email': 'handover',
}

export function nodeFromLabel(label: string | null | undefined): CallState['workflowNode'] {
  if (!label) return null
  const key = label.trim().replace(/\s+SMS$/i, '').toLowerCase()
  return NODE_BY_LABEL[key] ?? null
}

/**
 * WHERE THE ACCOUNT HAS GOT TO, off the steps that have actually GONE.
 *
 * THE LAST SENT STEP AND NOT THE NEXT ONE DUE, and that is the whole of it: a call script is about
 * the notice the debtor is holding. The firm's own table says "workflow at final notice ->
 * script-final-notice-call", and the debtor is at the final notice from the moment it lands, not
 * from the moment the next step falls due. Driven off what is coming, every call would describe a
 * letter nobody had read yet.
 *
 * THE LATEST BY DATE, so a sequence whose steps were sent out of order still resolves to the last
 * thing the debtor received.
 */
export function nodeReached(
  steps: { label: string; sentAt: string | null }[],
): CallState['workflowNode'] {
  let best: { on: string; node: CallState['workflowNode'] } | null = null
  for (const s of steps) {
    if (!s.sentAt) continue
    const node = nodeFromLabel(s.label)
    if (!node) continue
    if (best === null || s.sentAt > best.on) best = { on: s.sentAt, node }
  }
  return best?.node ?? null
}

/** The script that pops before any other, by what the debtor is. */
export function openingScript(debtorKind: 'individual' | 'company'): string {
  return debtorKind === 'company' ? 'script-open-company' : 'script-open-individual'
}

/**
 * The seven scripts a collector reaches themselves, the moment they discover who is on the line.
 *
 * NOT DRIVEN BY ACCOUNT STATE and available at all times, which is the firm's own instruction:
 * "they are reached by the collector, one tap from any open script... All seven must be available
 * at all times." The account does not know that the person who answered is the debtor's daughter.
 */
export const ALWAYS_AT_HAND = [
  'script-next-of-kin-living',
  'script-third-party-paying',
  'script-mandate-check',
  'script-estate-next-of-kin',
  'script-estate-executor',
  'script-surety',
  'script-spouse',
]

/* =================================================================================================
 * WHEN THE FIRM MAY RING
 * ============================================================================================== */

/**
 * The firm's own calling hours. Their policy rather than a statutory limit, and the brief says so:
 * "confirm these hours with the firm before the scripts go live."
 *
 * Minutes from midnight, so a comparison is arithmetic rather than string juggling.
 */
export const CALL_HOURS = {
  weekday: { from: 8 * 60, to: 17 * 60 },
  saturday: { from: 9 * 60, to: 13 * 60 },
  /** Sunday and public holidays: none at all. */
  sunday: null,
} as const

/**
 * May the firm dial at this moment?
 *
 * TAKES THE DAY AND THE MINUTE RATHER THAN A Date, so it can be checked without a clock and so the
 * caller is the one that reads the firm's own timezone -- the hours are Johannesburg's, and a
 * collector working from a laptop still set to London must not dial at seven in the morning.
 *
 * A PUBLIC HOLIDAY IS A SUNDAY HERE. The calendar is the same one the workflow's business days are
 * counted on, so a day that is not a working day for a statutory notice is not a day for a call.
 */
export function withinCallHours(day: string, minuteOfDay: number): boolean {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return false
  if (publicHolidays(date.getUTCFullYear()).has(day)) return false
  const weekday = date.getUTCDay()
  if (weekday === 0) return false
  const window = weekday === 6 ? CALL_HOURS.saturday : CALL_HOURS.weekday
  return minuteOfDay >= window.from && minuteOfDay < window.to
}

/** Why the firm may not ring now, in the collector's own words, or null. */
export function callHoursProblem(day: string, minuteOfDay: number): string | null {
  if (withinCallHours(day, minuteOfDay)) return null
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return 'That is not a day.'
  if (publicHolidays(date.getUTCFullYear()).has(day)) return 'The firm does not call on a public holiday.'
  if (date.getUTCDay() === 0) return 'The firm does not call on a Sunday.'
  if (date.getUTCDay() === 6) return 'On a Saturday the firm calls between 09:00 and 13:00.'
  return 'The firm calls between 08:00 and 17:00 on a weekday.'
}

/* =================================================================================================
 * THE SCRIPTS THEMSELVES, AND WHAT A DISPOSITION WRITES
 * ============================================================================================== */

/**
 * THE THIRTY-ONE SCRIPTS, BY THE GROUP THE FIRM WROTE THEM IN.
 *
 * NAMED HERE SO A CHECK CAN HOLD THE LIBRARY AGAINST THEM. The scripts live in
 * `message_templates` where the firm can edit the words; what cannot be edited away is the SET --
 * a missing script is a call where somebody improvises, and the scripts that stop a call are the
 * ones most likely never to have been written.
 *
 * THE KEYS ARE THE SEED KEYS, so a script the firm rewrites keeps its place in the panel.
 */
export const SCRIPT_GROUPS: { title: string; keys: string[] }[] = [
  {
    title: 'Every call starts here',
    keys: ['script-open-individual', 'script-open-company', 'script-verify-failed',
      'script-third-party', 'script-voicemail'],
  },
  {
    title: 'The collection workflow',
    keys: ['script-handover-call', 'script-s129-call', 'script-demand-call-company',
      'script-reminder-call', 'script-final-notice-call', 'script-listing-prep-call',
      'script-listed-call', 'script-intended-summons-call'],
  },
  {
    title: 'Getting the money',
    keys: ['script-ptp-setup', 'script-settlement-call', 'script-ptp-due-call',
      'script-ptp-default-call'],
  },
  {
    title: 'Stop the call and route it',
    keys: ['script-dispute-raised', 'script-debt-review', 'script-deceased', 'script-insolvency',
      'script-not-my-account'],
  },
  {
    title: 'People who are not the debtor',
    keys: ['script-next-of-kin-living', 'script-third-party-paying', 'script-mandate-check',
      'script-estate-next-of-kin', 'script-estate-executor', 'script-surety', 'script-spouse'],
  },
  {
    title: 'Closing the call',
    keys: ['script-close-agreed', 'script-close-no-agreement'],
  },
]

export const ALL_SCRIPTS = SCRIPT_GROUPS.flatMap((g) => g.keys)

/**
 * THE SCRIPTS A COLLECTOR CAN JUMP TO MID-CALL, ONE TAP, WITHOUT LOSING THE PANEL.
 *
 * THE FIRM: "branch scripts are one tap away at all times: dispute, debt review, deceased,
 * insolvency, not-my-account, PTP setup, settlement. A collector must be able to jump to any of
 * them mid-call without losing the panel."
 *
 * SEPARATE FROM ALWAYS_AT_HAND, WHICH IS THE SEVEN SECTION E SCRIPTS -- those are about WHO is on
 * the line and these are about what the debtor just said. Both are one tap away; the panel draws
 * them under their own headings because a collector hunting for "he passed away" should not be
 * reading past "settlement" to find it.
 */
export const BRANCHES_AT_HAND = [
  'script-dispute-raised',
  'script-debt-review',
  'script-deceased',
  'script-insolvency',
  'script-not-my-account',
  'script-ptp-setup',
  'script-settlement-call',
]

/** How a call ends, whatever else happened on it. */
export const CLOSING_SCRIPTS = ['script-close-agreed', 'script-close-no-agreement']

/**
 * WHAT A DISPOSITION WRITES ON THE ACCOUNT -- in the vocabulary Raptor already has.
 *
 * THE SIXTEEN CODES ARE THE FIRM'S CALL-CENTRE SHORTHAND; `CallOutcome` is the eight rungs an
 * account is REPORTED on, and the diary's outcome box has written those since it was built. Two
 * vocabularies writing two different records on one call is how an account comes to say
 * "Negotiating" on the floor's screen and "In progress" on the client's report, so a disposition
 * resolves to an outcome and the outcome does the writing. One note, not two.
 *
 * NULL IS NOT "NOTHING HAPPENED". It is a code whose consequence is not a position on the ladder:
 *
 *   PIF  -- paid in full. Money is recorded as MONEY, off a receipt, and a call cannot be the
 *           evidence for it. The panel says so rather than moving the account on a collector's
 *           word, which is the exact shape of the imported book's "58 accounts say Promise To Pay
 *           and 43 have a promise".
 *   SETL -- a settlement is an offer put to the CLIENT, and the ticket is what carries it. The
 *           account has not moved until the client answers.
 *   MAND -- somebody claimed authority and was told nothing. There is no new fact about the debt.
 *   DNC  -- a flag on a NUMBER, not a position on the account.
 *   TPC / WN -- see below.
 */
export const OUTCOME_FOR_DISPOSITION: Record<string, CallOutcome | null> = {
  PIF: null,
  PTP: 'promised',
  SETL: null,
  DISP: 'disputed',
  RTP: 'refused',
  NAN: 'no_answer',
  VM: 'no_answer',
  /* A THIRD PARTY REACHED IS NOT THE DEBTOR REACHED. Nothing was disclosed and nothing was
     agreed; the account has had a contact ATTEMPT, which is what no_answer means on the ladder. */
  TPC: 'no_answer',
  /* AND A WRONG NUMBER RAISES A TRACE, which is what `wrong_number` does -- see its own note in
     callOutcome.ts about why the firm would not have it called "the number is wrong". */
  WN: 'wrong_number',
  RPC: 'negotiating',
  DRV: 'under_administration',
  DEC: 'under_administration',
  INS: 'under_administration',
  EXEC: 'under_administration',
  MAND: null,
  DNC: null,
}

/** The outcome a disposition records, or null where the code is not a position on the ladder. */
export function outcomeFor(code: string): CallOutcome | null {
  return OUTCOME_FOR_DISPOSITION[code] ?? null
}

/**
 * WHY A CODE RECORDS NO POSITION, said to the collector who just chose it.
 *
 * A code that writes nothing has to SAY that it writes nothing, or somebody picks PIF and walks
 * away believing the file is closed. Each sentence names the thing that does carry it.
 */
export const RECORDS_NOTHING: Record<string, string> = {
  PIF: 'A payment is recorded off the money, not off a call. Capture the receipt on the account '
    + 'and the file closes itself.',
  SETL: 'A settlement is an offer to the client. Raise the settlement ticket — the account does '
    + 'not move until the client answers.',
  MAND: 'Nothing was disclosed and nothing has changed on the account. The mandate is diarised '
    + 'for three days.',
  DNC: 'This takes the number off the calling list. The account itself has not moved, and the '
    + 'written notices still go out.',
}

/**
 * WHAT THE ACCOUNT'S OWN TIMELINE SAYS ABOUT A CALL THAT HAS JUST ENDED.
 *
 * THE FIRM'S EIGHTH RULE FOR EVERY CALL: "record the outcome on the account the same day, in the
 * debtor's own words where it matters. An uncaptured call did not happen."
 *
 * THE CODE AND THE CONSEQUENCE, BOTH. A note reading "PTP" is a note only somebody who already
 * knows the shorthand can read, and the person reading it eighteen months later is an attorney or
 * a team leader. The sentence after it is the firm's own words for what Raptor does with the code,
 * which is also what makes a wrong code visible: "RTP -- refuses to pay. Leave the workflow
 * running" on an account where the debtor made an arrangement reads wrong to anybody.
 *
 * WRITTEN HERE SO IT IS WRITTEN ONCE. The panel, the dialler and anything that captures a call
 * later all put the same sentence on the timeline, which is what lets somebody search for one.
 */
export function dispositionNote(code: string, extra?: string | null): string {
  const d = disposition(code)
  const head = d ? `Call ended ${code} — ${d.meaning}. ${d.then}.` : `Call ended ${code}.`
  const tail = (extra ?? '').trim()
  return tail ? `${head} ${tail}` : head
}

/**
 * WHAT A DISPOSITION STILL NEEDS FROM A PERSON BEFORE IT CAN MOVE THE ACCOUNT.
 *
 * THREE OF THE OUTCOMES CANNOT BE WRITTEN OFF A BUTTON. A promise needs an amount and a date, a
 * dispute needs a classification, and "cannot pay" and "under administration" need the reason in
 * the debtor's own words -- those are recordOutcome's own requirements and they exist because a
 * status with nothing behind it cannot be followed up, cannot break and cannot be reported on.
 * The imported book is the evidence: 58 accounts say Promise To Pay and 43 have a promise.
 *
 * SO THE CODE IS RECORDED AND THE ACCOUNT IS NOT MOVED, and the collector is told which thing is
 * still outstanding. Returns null where the code can be written in full off the button alone.
 */
export const NEEDS_MORE: Record<string, string> = {
  PTP: 'Capture the arrangement — the amount, the date and how often — or the account does not '
    + 'move to Arranged and nothing follows it up.',
  DISP: 'Raise the dispute with its classification and the debtor’s own words, or nothing starts '
    + 'the dispute sequence.',
  DRV: 'Record the debt counsellor’s name, number and NCRDC reference, and route it to the '
    + 'manager.',
  DEC: 'Record the date of death and whatever is known of the executor, and route it to the '
    + 'manager.',
  INS: 'Record the case number, the court, the date of the order and the practitioner, and route '
    + 'it to the manager.',
  EXEC: 'Record the estate number, the Master’s office and the executor’s details, and diarise '
    + 'the claim lodgement deadline.',
}

export function needsMore(code: string): string | null {
  return NEEDS_MORE[code] ?? null
}

/* =================================================================================================
 * WHAT THEY ACTUALLY SAY
 * ============================================================================================== */

/**
 * THE SIXTEEN ANSWERS, SHOWN BESIDE WHICHEVER SCRIPT IS OPEN.
 *
 * THE FIRM: "these are not a script to be read in order. They are the lines that work, for the
 * objections that come up on nearly every call. Raptor should show this panel alongside whichever
 * script is open."
 *
 * NOT TEMPLATES, DELIBERATELY. Every other piece of wording in Raptor is a row in the library the
 * firm can edit; these are sixteen one-liners that have to be on the screen at the same time as a
 * script, and a library row each would mean sixteen fetches to draw a sidebar. They carry merge
 * fields all the same, and the panel fills them from the same values the script was filled from.
 */
export const OBJECTIONS: { said: string; answer: string }[] = [
  {
    said: 'I do not have the money.',
    answer: 'I understand, and most people who get this call are in the same position. I am not '
      + 'asking for the full amount today. What can you realistically do this month?',
  },
  {
    said: 'I already paid this.',
    answer: 'Then I want to get it corrected. When did you pay it, how much, and to whom? Send me '
      + 'the proof at {{collector_email}} and I will stop the account while I check it.',
  },
  {
    said: 'This is not my account.',
    answer: 'Let me check the details with you properly. [Go to script-not-my-account.]',
  },
  {
    said: 'I will pay next month.',
    answer: 'Let us put that down as an arrangement with a date on it, so it holds. Which day '
      + 'next month, and how much?',
  },
  {
    said: 'I lost my job.',
    answer: 'I am sorry to hear that. It changes what is realistic rather than making it go away. '
      + 'Is there anything coming in at all? Even a small amount on a date keeps this out of the '
      + 'next stage.',
  },
  {
    said: 'Send me proof that I owe this.',
    answer: 'That is fair. I will send you a summary of the account showing how the balance is '
      + 'made up. When can I call you back once you have had a look?',
  },
  {
    said: 'Your interest and fees are a rip-off.',
    answer: 'The interest and the fees are limited by law, and the summary I will send shows each '
      + 'one separately so you can see exactly what has been added.',
  },
  {
    said: 'I am under debt review.',
    answer: '[Stop. Go to script-debt-review.]',
  },
  {
    said: 'Stop calling me.',
    answer: 'I will take this number off today. I am still required to send you the written '
      + 'notices by email and SMS, and those will come. [Capture DNC.]',
  },
  {
    said: 'I will see you in court.',
    answer: 'That is your right and I will note it. For what it is worth, the costs of that land '
      + 'on top of what is already owing. My number is {{collector_phone}} if you change your '
      + 'mind before {{respond_by}}.',
  },
  {
    said: 'How do I know this is not a scam?',
    answer: 'Put the phone down and call our office on {{firm_phone}}. That number is on our '
      + 'website. Ask for {{collector_name}} and quote {{reference}}. I would rather you checked.',
  },
  {
    said: 'Can you take it off my credit record if I pay?',
    answer: 'No, and I am not going to tell you otherwise. Paying updates the record to show the '
      + 'account was paid up or settled. The listing itself stays. Anyone who tells you different '
      + 'is selling you something.',
  },
  {
    said: 'I only owe part of it.',
    answer: 'Then tell me which part and why, in writing, and collection stops while we check it. '
      + 'If you are right, the balance gets corrected.',
  },
  {
    said: 'I am his wife / her son, just tell me.',
    answer: 'I am not allowed to, and I would say the same to anyone who phoned about you. Get '
      + 'them to send us one email from their own address naming you, and then I can go through '
      + 'all of it with you.',
  },
  {
    said: 'He passed away.',
    answer: '[Stop. Go to script-estate-next-of-kin. Say nothing further about the account, '
      + 'including whether it exists.]',
  },
  {
    said: 'Talk to my attorney.',
    answer: 'Gladly. Ask them to email {{collector_email}} confirming that they act for you, and '
      + 'I will deal with them from there. Until that arrives I have to keep dealing with you '
      + 'directly.',
  },
]

/* =================================================================================================
 * THE ESTATE ROUTE
 * ============================================================================================== */

/**
 * WHAT A DEATH DOES TO AN ACCOUNT, AND THE TWO THINGS THAT ARE ROUTINELY MISSED.
 *
 * THE FIRM: "when a debtor dies the account does not end, it changes form. It becomes a claim
 * against the deceased estate, and the family is not liable for it."
 *
 * THE CLAIM LODGEMENT DEADLINE IS A HARD TASK AND NOT A NOTE, and the brief says exactly why:
 * "the executor advertises a notice to creditors, and a claim lodged after the period in that
 * notice is lost. This is the one date on an estate file that actually costs the client money if
 * it is missed." A note is something somebody reads if they open the account; the diary is what
 * puts a date in front of a person whether or not they do.
 *
 * AND THE CREDIT LIFE QUESTION IS ASKED EVERY TIME. "Where it exists, the balance may be met by
 * the insurer and the estate pays nothing. It is the single fastest resolution available on a
 * deceased account and it is routinely missed."
 *
 * THIRTY DAYS IS THE STATUTORY MINIMUM for a notice to creditors under section 29 of the
 * Administration of Estates Act, and it is the shortest period the executor may advertise -- so a
 * deadline computed from it is never later than the real one. It is a PLACEHOLDER until the
 * advertisement date is on file, which is why `estateClaimDeadline` takes that date and the
 * fallback is loud about being a guess.
 */
export const NOTICE_TO_CREDITORS_DAYS = 30

export const ESTATE_PROMPTS = [
  'Ask whether there was credit life or funeral cover on the agreement. Where there is, the '
    + 'insurer may meet the balance and the estate pays nothing.',
  'Take the death certificate and the estate number, and the Letters of Executorship or the '
    + 'section 18(3) appointment where it is a smaller estate.',
  'Diarise the claim lodgement deadline off the notice to creditors. A claim lodged after that '
    + 'period is lost.',
  'Once the appointment is on file, everything goes to the executor. Contact with the family '
    + 'stops entirely.',
]

/**
 * THE DAY THE CLAIM HAS TO BE IN BY, off the date the notice to creditors was advertised.
 *
 * CALENDAR DAYS, NOT WORKING DAYS. The Act's period is in days and the Master counts them that
 * way; the business-day calendar in this codebase is the firm's own clock for its own sequences.
 *
 * NULL WHERE NOBODY HAS TOLD US THE ADVERTISEMENT DATE -- which is most of the time, and is the
 * thing the executor is asked for on the call. A computed guess here would put a date on a diary
 * entry that the Master's notice may contradict, and the firm would work to ours.
 */
export function estateClaimDeadline(advertisedOn: string | null, days = NOTICE_TO_CREDITORS_DAYS): string | null {
  if (!advertisedOn) return null
  const d = new Date(`${advertisedOn}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/* `isWeekend` is imported for the calendar it shares with the workflow, and re-exported so a
   caller asking "is this a calling day" has one place to ask. */
export { isWeekend }
