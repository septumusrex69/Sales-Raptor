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

/* `isWeekend` is imported for the calendar it shares with the workflow, and re-exported so a
   caller asking "is this a calling day" has one place to ask. */
export { isWeekend }
