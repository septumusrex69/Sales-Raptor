/**
 * A CAMPAIGN: ONE SMS OR ONE EMAIL TO A SELECTION OF DEBTOR ACCOUNTS (S10, 21 Oct).
 *
 * THE FIRM: "an option to run a campaign ... on something that you've selected ... send a specific
 * SMS, or ... a specific thing to all of the ... or a selection of the debtors ... it sends it to
 * their email addresses, or SMS".
 *
 * THIS FILE DECIDES; api/_lib/campaign SENDS. Everything here is pure -- who an account is skipped
 * for, what the message says, what it is estimated to cost, who may run one on which desks -- so
 * the box that previews a campaign, the server that creates it and the sender that works through it
 * ask the SAME functions. Written twice, the preview would promise a count the sender did not keep.
 *
 * NOTHING HERE IS A SECOND SET OF RULES. The words come out of renderTemplate (optional fields
 * included), an SMS's values through smsSafeValues before anything is measured, its segments from
 * smsCost, an email's paragraphs from emailBodyHtml, the price from itemAmountFor on the schedule in
 * force on the day. The FEE is never raised here: the sender charges each message through the
 * charge engine at the moment it goes, which is where in duplum and every cap live.
 *
 * `.js` specifiers, because the serverless sender imports this file.
 */
import { renderTemplate, unknownFields } from './messageTemplates.js'
import { smsCost, smsSafeValues, type SmsEncoding } from './smsSegments.js'
import { emailBodyHtml } from './emailStyle.js'
import { itemAmountFor, monthlyLimit, scheduleFor } from './annexureB.js'
import { holdLabel } from './accountBooks.js'
import { can } from './capabilities.js'
import type { UserRole } from '../types'

export type CampaignChannel = 'sms' | 'email'

/** Annexure B item per channel: 1(a) for an email, 1(c) per segment for an SMS. */
export const CAMPAIGN_ITEM: Record<CampaignChannel, '1a' | '1c'> = { email: '1a', sms: '1c' }
/** The action catalogue's codes, the ones the workflow sender writes -- an icon on the timeline. */
export const CAMPAIGN_ACTION: Record<CampaignChannel, 'email_out' | 'sms'> = { email: 'email_out', sms: 'sms' }

/** The most accounts one campaign may reach -- the hand-out's ceiling, for the hand-out's reason. */
export const CAMPAIGN_CEILING = 5000

/* ------------------------------------------------------------------------------------------
 * WHO IS SKIPPED, AND WHY
 * ------------------------------------------------------------------------------------------ */

/**
 * Why an account in the selection is not sent the message. Named by the FACT, because the person
 * reading the count acts on the fact ("eleven have no mobile number") and not on a code.
 */
export type SkipReason =
  | 'closed'
  | 'prescribed'
  | 'on_hold'
  | 'dispute'
  | 'wrong_audience'
  | 'no_mobile'
  | 'no_email'
  | 'bad_number'
  | 'workflow_today'
  /* Only at the moment of sending -- each needs the account in hand. */
  | 'unfilled'
  | 'out_of_scope'
  /* A call campaign's own. */
  | 'no_desk'
  | 'no_phone'
  | 'on_call_campaign'
  /* A recovery or trace campaign's own (22 Oct). */
  | 'not_closed'
  | 'paid'
  | 'withdrawn'
  | 'reason_not_chosen'
  /* Raptor H12: the client asked us not to work its written-off accounts. */
  | 'client_no_writeoff'
  /* Raptor H12: who an email comes from could not be decided (no mailbox anywhere to send it from). */
  | 'no_sender'

/** What one account looks like to the skip rule. Gathered in bulk by the server. */
export interface CampaignFacts {
  /** debtor_accounts.book -- 'active' | 'on_hold' | 'closed', the database's own rule. */
  book: string | null
  holdReason: string | null
  prescribed: boolean
  debtorKind: 'individual' | 'company'
  mobile: string | null
  email: string | null
  /** An open dispute (account_queries kind 'dispute', not closed). */
  openDispute: boolean
  /** A workflow step went to this account today, or a pending one is due by today. */
  workflowToday: boolean
  /** The client asked us not to work its written-off accounts (companies.no_writeoff_work_at). */
  clientNoWriteoff?: boolean
}

/**
 * Is this account skipped, and for what -- or null where the message goes.
 *
 * IN THE ORDER A PERSON WOULD FIX THEM, and only the first is reported, like planSend's holds: a
 * closed account with no mobile number is closed, and "no mobile" would send somebody looking for
 * a number on a file nobody may chase.
 *
 *   closed           paid up, settled, written off or withdrawn. Nobody may chase it.
 *   prescribed       NCA s126B: a prescribed debt may not be collected, and a campaign is collecting.
 *   on_hold          frozen, debt review (s86), deceased, insolvent, business rescue, a written
 *                    dispute, waiting on the client -- the book says stop, so a campaign stops.
 *   dispute          an open dispute without a hold on the file is still a dispute; the firm's own
 *                    workflows stop for one (EXIT_EVENTS), and a bulk message must not walk past it.
 *   wrong_audience   the wording is stamped for a person and this is a company, or the other way:
 *                    the collections library is written twice for exactly this reason.
 *   no_mobile/email  nowhere to send it.
 *   workflow_today   a workflow notice reaches this account today. Two messages from the firm in a
 *                    day, one of them a statutory notice, is how a campaign contradicts a demand.
 *
 * NOT A REASON: A PROMISE TO PAY OR A RUNNING WORKFLOW. The selection is the firm's; a campaign
 * reminding arrangement-holders of their instalment is exactly what somebody filters for. And not
 * the item 1(c) monthly allowance either -- an SMS past it still goes and earns nothing, which is
 * the charge engine's decision at the moment of sending.
 */
export function campaignSkip(
  facts: CampaignFacts, channel: CampaignChannel,
  audience: 'individual' | 'company' | null = null,
): SkipReason | null {
  if (facts.book === 'closed') return 'closed'
  if (facts.prescribed) return 'prescribed'
  if (facts.book === 'on_hold') return 'on_hold'
  if (facts.openDispute) return 'dispute'
  if (audience && audience !== facts.debtorKind) return 'wrong_audience'
  if (channel === 'sms' && !facts.mobile?.trim()) return 'no_mobile'
  if (channel === 'email' && !facts.email?.trim()) return 'no_email'
  if (channel === 'sms' && facts.mobile && !looksLikeMobile(facts.mobile)) return 'bad_number'
  if (facts.workflowToday) return 'workflow_today'
  return null
}

/**
 * THE SAME QUESTION FOR A CALL CAMPAIGN, and mostly the same answers: nobody rings a closed,
 * prescribed, frozen or disputed account on a push either. Then the call's own -- a call lands on
 * the diary of whoever holds the account, so one on nobody's desk has nowhere to go; it needs a
 * number to ring; and one account carries one campaign call at a time (an index says so).
 *
 * NOT A REASON: a workflow notice today. A call is not a second message from the firm, and ringing
 * the day the section 129 goes is often exactly what the person wants.
 */
export function callSkip(
  facts: CampaignFacts & { assignedTo: string | null; onCallCampaign: boolean },
): SkipReason | null {
  if (facts.book === 'closed') return 'closed'
  if (facts.prescribed) return 'prescribed'
  if (facts.book === 'on_hold') return 'on_hold'
  if (facts.openDispute) return 'dispute'
  if (!facts.assignedTo) return 'no_desk'
  if (!facts.mobile?.trim()) return 'no_phone'
  if (facts.onCallCampaign) return 'on_call_campaign'
  return null
}

/* ------------------------------------------------------------------------------------------
 * THE CLOSED BOOK: A RECOVERY CALL, AND A TRACE ON WRITTEN-OFF ACCOUNTS (S10, 22 Oct)
 * ------------------------------------------------------------------------------------------ */

/**
 * HOW A CLOSED ACCOUNT ENDED, AS A RECOVERY READS IT. The firm's own word (`ended_as`) where it
 * gave one; else Swordfish's, read the way accountBooks.closureKind reads it ("Paid in Full" is paid
 * up, "Settled by way of..." settled), with WITHDRAWN taken from the status or the imported reason
 * as well -- Swordfish has no ended_as, and a withdrawal it recorded must never be read as a
 * write-off and rung. The database's recovery_closure() is the same reading; check-campaign-recovery
 * holds the two together.
 */
export function recoveryClosure(a: {
  endedAs: string | null; status: string | null; writeOffReason: string | null
}): 'paid_up' | 'settled' | 'written_off' | 'withdrawn' {
  if (a.endedAs) return a.endedAs as 'paid_up' | 'settled' | 'written_off' | 'withdrawn'
  if (/withdr/i.test(a.status ?? '') || /withdr/i.test(a.writeOffReason ?? '')) return 'withdrawn'
  if (/paid\s*in\s*full/i.test(a.writeOffReason ?? '')) return 'paid_up'
  if (/^\s*settled/i.test(a.writeOffReason ?? '')) return 'settled'
  return 'written_off'
}

/**
 * THE WRITE-OFF REASON, AS A KEY TO CHOOSE BY. The firm: "we should be able to choose which type of
 * accounts ... this one was written off because of uncontactability. Or this one ... because of
 * refusal to pay or recommended write-off from us."
 *
 * TWO SOURCES, KEPT APART. Raptor's own write-off writes one of accountEnding.ts WRITE_OFF_REASONS
 * into `ended_reason` (settle_account); an imported one carries whatever Swordfish's user typed in
 * `write_off_reason`. Trimmed and case-folded FOR GROUPING ONLY -- the box shows the words as
 * stored. 'none' is "No reason recorded". The database's write_off_reason_key() is the same.
 */
export function writeOffReasonKey(a: {
  endedAs: string | null; endedReason: string | null; writeOffReason: string | null
}): string {
  const fold = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase()
  if (a.endedAs === 'written_off' && a.endedReason?.trim()) return `raptor:${fold(a.endedReason)}`
  if (!a.endedAs && a.writeOffReason?.trim()) return `imported:${fold(a.writeOffReason)}`
  return 'none'
}

/** What one account looks like to the closed-book rules. */
export interface ClosedFacts extends CampaignFacts {
  endedAs: string | null
  endedReason: string | null
  writeOffReason: string | null
  status: string | null
  onCallCampaign: boolean
}

/**
 * IS THIS ACCOUNT SKIPPED BY A RECOVERY CALL CAMPAIGN, and for what.
 *
 * THE FIRM: "on archived ... accounts that have already been closed, or written off, not paid up
 * stuff ... just like unrecoverable ... to try to get them back" -- and then, plainly: withdrawn and
 * paid-up accounts are NEVER in one. Not behind a tick.
 *
 *   not_closed         a live account is the ordinary call campaign's, not this one's.
 *   paid               paid up or settled: there is nothing to recover.
 *   withdrawn          the client took it back; the firm may have no right to collect it at all.
 *   prescribed         NCA s126B -- a prescribed debt may not be collected, written off or not.
 *   reason_not_chosen  written off for a reason the person did not pick.
 *   dispute            an open dispute stops a call on any book.
 *   no_phone           a call needs a number.
 *   on_call_campaign   one campaign item per account (the index's rule).
 *
 * NOT A REASON: nobody's desk. A closed account usually sits on nobody's desk, or on the desk of
 * somebody who has left -- which is exactly why the recovery box asks who works it.
 */
export function recoverySkip(facts: ClosedFacts, chosenReasons: readonly string[]): SkipReason | null {
  if (facts.book !== 'closed') return 'not_closed'
  const closed = recoveryClosure(facts)
  if (closed === 'paid_up' || closed === 'settled') return 'paid'
  if (closed === 'withdrawn') return 'withdrawn'
  if (facts.prescribed) return 'prescribed'
  /* THE CLIENT'S OWN INSTRUCTION (Raptor H12): "unless the client asks us not to work on their
     accounts, even after ... we've already been withdrawing it." Before the reasons: no reason a
     person ticks reaches an account its client has taken off the table. */
  if (facts.clientNoWriteoff) return 'client_no_writeoff'
  if (!chosenReasons.includes(writeOffReasonKey(facts))) return 'reason_not_chosen'
  if (facts.openDispute) return 'dispute'
  if (!facts.mobile?.trim()) return 'no_phone'
  if (facts.onCallCampaign) return 'on_call_campaign'
  return null
}

/**
 * AN SMS OR EMAIL TO WRITTEN-OFF ACCOUNTS (Raptor H12). The firm: "a centralized email ... to send
 * out to debtors as well that have been written off", and "written off ... or withdrawn ... that's
 * two different things". The recovery call's rules exactly -- closed, written off (never paid up,
 * settled or withdrawn), not prescribed, not a client that said no, a reason chosen, no open dispute
 * -- and then the message's own: the wording's audience, somewhere to send it, a number an SMS can
 * reach. Not the workflow rule: a written-off account is in no workflow.
 */
export function writtenOffMessageSkip(
  facts: ClosedFacts, channel: CampaignChannel, chosenReasons: readonly string[],
  audience: 'individual' | 'company' | null = null,
): SkipReason | null {
  const recovery = recoverySkip({ ...facts, mobile: facts.mobile || 'not needed', onCallCampaign: false }, chosenReasons)
  if (recovery) return recovery
  if (audience && audience !== facts.debtorKind) return 'wrong_audience'
  if (channel === 'sms' && !facts.mobile?.trim()) return 'no_mobile'
  if (channel === 'email' && !facts.email?.trim()) return 'no_email'
  if (channel === 'sms' && facts.mobile && !looksLikeMobile(facts.mobile)) return 'bad_number'
  return null
}

/* ------------------------------------------------------------------------------------------
 * WHO AN EMAIL CAMPAIGN COMES FROM (Raptor H12)
 * ------------------------------------------------------------------------------------------ */

/**
 * The firm: it "should ... ask if it goes out from ... a centralized email, or ... the person who
 * sends it, or ... the person who owns the account." legal@bredellferreira.co.za is the central
 * one (firm_mailboxes). An SMS has no sender to choose: it always goes under the firm's name.
 */
export type SendFrom = 'me' | 'owner' | 'central'
export const SEND_FROM_LABEL: Record<SendFrom, string> = {
  me: 'Me', owner: 'Each account\u2019s collector', central: 'The central mailbox',
}

/**
 * THE LOGIN AN ACCOUNT'S EMAIL GOES OUT AS, or null where there is none. The account's owner is
 * its collector; where the desk is empty, its holder has left, or has no mailbox connected, the
 * central mailbox takes it -- a written-off book is mostly exactly that, and "nobody's desk" must
 * not mean "nobody hears from us". Without a central mailbox the person running it takes it.
 */
export function senderFor(input: {
  sendFrom: SendFrom
  callerId: string
  callerHasMailbox: boolean
  centralId: string | null
  holder: { id: string; active: boolean; hasMailbox: boolean } | null
}): string | null {
  const central = input.centralId
  const me = input.callerHasMailbox ? input.callerId : null
  if (input.sendFrom === 'me') return me
  if (input.sendFrom === 'central') return central
  const h = input.holder
  if (h && h.active && h.hasMailbox) return h.id
  return central ?? me
}

/**
 * IS THIS ACCOUNT SKIPPED BY A TRACE CAMPAIGN. The firm: "we can also run a trace campaign. So it
 * refers them to trace." On the LIVE book -- the ordinary rules, without needing a number, since no
 * working number is the commonest reason to trace -- or on the CLOSED book chosen by write-off
 * reason: the recovery rules, again without the number.
 */
export function traceSkip(
  facts: ClosedFacts, target: 'live' | 'closed', chosenReasons: readonly string[],
): SkipReason | null {
  if (target === 'closed') {
    /* The number is not asked for: tracing is how an account without one gets one. */
    return recoverySkip({ ...facts, mobile: facts.mobile || 'not needed' }, chosenReasons)
  }
  if (facts.book === 'closed') return 'closed'
  if (facts.prescribed) return 'prescribed'
  if (facts.book === 'on_hold') return 'on_hold'
  if (facts.openDispute) return 'dispute'
  if (facts.onCallCampaign) return 'on_call_campaign'
  return null
}

/**
 * MAY THIS PERSON PUT THIS CLOSED ACCOUNT ON A RECOVERY OR TRACE CAMPAIGN?
 *
 * mayCampaignOn first -- an Administrator any, a liaison their own clients, a leader their team's
 * desks. Then the one widening the closed book needs: an account on NOBODY'S desk, or on the desk of
 * somebody no longer here, may be taken by a leader (anybody with campaign.run who is not a liaison)
 * -- otherwise the written-off book, which is mostly exactly that, could be recovered by nobody but
 * an Administrator. A liaison stays inside their own clients.
 */
export function mayRecoverOn(
  caller: CampaignCaller, holder: (DeskHolder & { active?: boolean }) | null, liaison: DeskHolder | null = null,
): boolean {
  if (mayCampaignOn(caller, holder, liaison)) return true
  if (!can(caller, 'campaign.run')) return false
  if (caller.role === 'Liaison' || caller.role === 'Liaison Manager') return false
  return !holder || holder.active === false
}

/** A person a campaign's work can be given to, as the box and the server read them. */
export interface Collector { id: string; role: UserRole; teamId: string | null; active: boolean }

/**
 * MAY THIS PERSON GIVE A RECOVERY OR TRACE CAMPAIGN'S WORK TO THIS COLLECTOR?
 *
 * Only active people on the collections floor (FLOOR_ROLES). An Administrator, a liaison or a
 * Liaison Manager to any of them -- a liaison runs it over their own clients' accounts and has no
 * floor of their own, so "choosing collectors any". A team leader to their own team; a leader with
 * no team but floor.lead (the Call Centre Manager) to the whole floor -- the same desks mayCampaignOn
 * lets them campaign on.
 */
export function mayGiveCampaignTo(caller: CampaignCaller, collector: Collector): boolean {
  if (!can(caller, 'campaign.run')) return false
  if (!collector.active || !FLOOR_ROLES.includes(collector.role)) return false
  if (caller.role === 'Administrator' || caller.role === 'Liaison' || caller.role === 'Liaison Manager') return true
  if (collector.id === caller.id) return true
  if (caller.teamId) return collector.teamId === caller.teamId
  return can(caller, 'floor.lead')
}

/**
 * A number an SMS can go to -- the same test as toMsisdn on the server (connectMobile.ts), written
 * here as a yes/no because this file cannot import a serverless module. Ten digits starting 0, or
 * 10-15 international digits not starting 0.
 */
export function looksLikeMobile(raw: string): boolean {
  const digits = raw.replace(/[^\d+]/g, '')
  let n = digits.startsWith('+') ? digits.slice(1) : digits
  if (n.startsWith('00')) n = n.slice(2)
  if (n.startsWith('0') && n.length === 10) n = `27${n.slice(1)}`
  return /^\d{10,15}$/.test(n) && !n.startsWith('0')
}

/** The reason in the firm's words, for the count and for the row. */
export function skipWords(reason: SkipReason, facts?: Pick<CampaignFacts, 'holdReason'>): string {
  switch (reason) {
    case 'closed': return 'Closed: paid up, settled, written off or withdrawn'
    case 'prescribed': return 'Prescribed: the debt may not be collected'
    case 'on_hold': return facts?.holdReason ? `On hold: ${holdLabel(facts.holdReason)}` : 'On hold'
    case 'dispute': return 'An open dispute'
    case 'wrong_audience': return 'The wording is written for the other kind of debtor'
    case 'no_mobile': return 'No mobile number'
    case 'no_email': return 'No email address'
    case 'bad_number': return 'The mobile number is not one an SMS can go to'
    case 'workflow_today': return 'A workflow notice goes to this account today'
    case 'unfilled': return 'Nothing on the account fills a field the message needs'
    case 'out_of_scope': return 'Not on your team’s desks'
    case 'no_desk': return 'On nobody’s desk, so on nobody’s diary'
    case 'no_phone': return 'No phone number'
    case 'on_call_campaign': return 'Already on another call campaign'
    case 'not_closed': return 'Not closed: a recovery campaign rings the closed book only'
    case 'paid': return 'Paid up or settled: there is nothing to recover'
    case 'withdrawn': return 'Withdrawn by the client: never in a recovery campaign'
    case 'reason_not_chosen': return 'Written off for a reason not chosen for this campaign'
    case 'client_no_writeoff': return 'The client asked us not to work its written-off accounts'
    case 'no_sender': return 'No mailbox to send it from'
  }
}

/** Counted by reason, in the order campaignSkip asks them, for the preview and the confirm. */
export interface SkipTally { reason: SkipReason; words: string; count: number }

export function tallySkips(
  reasons: { reason: SkipReason; holdReason?: string | null }[],
): SkipTally[] {
  const by = new Map<string, SkipTally>()
  for (const r of reasons) {
    const words = skipWords(r.reason, { holdReason: r.holdReason ?? null })
    const t = by.get(words) ?? { reason: r.reason, words, count: 0 }
    t.count += 1
    by.set(words, t)
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.words.localeCompare(b.words))
}

/* ------------------------------------------------------------------------------------------
 * WHAT THE MESSAGE SAYS
 * ------------------------------------------------------------------------------------------ */

export interface CampaignMessage {
  /** The words as they leave: the SMS text, or the email's plain text (what is filed). */
  text: string
  subject: string | null
  /** The email's body as HTML -- emailBodyHtml's paragraphing and escaping. Null on an SMS. */
  html: string | null
  segments: number | null
  encoding: SmsEncoding | null
  /** Fields nothing on the account fills. Non-empty means the message must not go. */
  missing: string[]
}

/**
 * One account's message, merged exactly as a workflow step's would be.
 *
 * THE SMS'S VALUES ARE MADE SAFE BEFORE ANYTHING IS MEASURED -- a non-breaking space out of en-ZA's
 * money formatting drops the whole message to UCS-2 and doubles the segments the debtor pays for
 * under item 1(c). Only the values the app merged in; the firm's own typed words are untouched.
 *
 * OPTIONAL FIELDS LEAVE WITH THEIR LINE (renderTemplate), before the segments are counted.
 */
export function renderCampaignMessage(input: {
  channel: CampaignChannel
  subject: string | null
  body: string
  values: Record<string, string>
}): CampaignMessage {
  const values = input.channel === 'sms' ? smsSafeValues(input.values) : input.values
  const body = renderTemplate(input.body, values)
  const subject = input.channel === 'email' && input.subject ? renderTemplate(input.subject, values) : null
  const missing = [...new Set([...body.missing, ...(subject?.missing ?? [])])]
  if (input.channel === 'sms') {
    const cost = smsCost(body.text)
    return { text: body.text, subject: null, html: null, segments: cost.segments, encoding: cost.encoding, missing }
  }
  return {
    text: body.text, subject: subject?.text ?? null, html: emailBodyHtml(body.text),
    segments: null, encoding: null, missing,
  }
}

/**
 * Why this wording cannot be a campaign, or null. Asked of typed text and of a library row alike,
 * in the browser before anything is previewed and on the server before anything is created.
 */
export function campaignWordingProblem(input: {
  channel: CampaignChannel
  subject: string | null
  body: string
  /** Set where the wording came from the library. */
  template?: { kind: string; scope: string; active: boolean; attachmentId: string | null } | null
}): string | null {
  if (input.template) {
    if (input.template.scope !== 'collections') return 'That wording is from the sales library. A campaign goes to debtors.'
    if (input.template.kind !== input.channel) return `That wording is ${input.template.kind === 'sms' ? 'an SMS' : `a ${input.template.kind}`}, not ${input.channel === 'sms' ? 'an SMS' : 'an email'}.`
    if (!input.template.active) return 'That wording has been retired in the library.'
    /* A NOTICE IS A WORKFLOW STEP, NOT A CAMPAIGN. An email that posts a section 129 carries a
       statutory clock; sent in bulk from a list it would start one on every account at once with
       nothing recording that it had. */
    if (input.template.attachmentId) return 'That email posts a notice. Statutory notices go through the workflow, not a campaign.'
  }
  if (!input.body.trim()) return 'Write the message, or choose one from the library.'
  if (input.channel === 'email' && !input.subject?.trim()) return 'An email needs a subject.'
  const unknown = unknownFields('collections', input.body, input.channel === 'email' ? input.subject : null)
  if (unknown.length > 0) {
    return `${unknown.map((f) => `{{${f}}}`).join(', ')} ${unknown.length === 1 ? 'is not a field' : 'are not fields'} a debtor’s account can fill.`
  }
  return null
}

/* ------------------------------------------------------------------------------------------
 * WHAT IT IS ESTIMATED TO COST THE DEBTORS
 * ------------------------------------------------------------------------------------------ */

export interface FeeEstimate {
  item: '1a' | '1c'
  /** One message, excluding VAT, on the schedule in force on `on`. */
  perMessage: number
  /** perMessage x how many will go. An estimate: the engine decides each fee at send time. */
  total: number
  citation: string
  /** Item 1(c)'s monthly allowance where it binds; null where it is switched off. */
  monthlyLimit: number | null
}

/**
 * COUNT x TARIFF, and only an estimate -- said on the screen. The charge engine prices each message
 * when it goes: the in duplum ceiling can cut a fee to nothing, a written-off account earns nothing,
 * and item 1(c)'s ten-a-month allowance (where it binds) makes the eleventh free. `segments` is the
 * sample's count; a longer surname elsewhere can make another account's message a segment longer.
 */
export function campaignFeeEstimate(
  channel: CampaignChannel, sending: number, segments: number | null, on: string | Date,
): FeeEstimate {
  const schedule = scheduleFor(on)
  const item = CAMPAIGN_ITEM[channel]
  const perMessage = itemAmountFor(item, channel === 'sms' ? Math.max(1, segments ?? 1) : 1, 0, schedule)
  return {
    item, perMessage, total: Math.round(perMessage * sending * 100) / 100,
    citation: schedule.citation, monthlyLimit: channel === 'sms' ? monthlyLimit('1c', schedule) : null,
  }
}

/* ------------------------------------------------------------------------------------------
 * WHO MAY RUN ONE, ON WHICH DESKS
 * ------------------------------------------------------------------------------------------ */

export interface CampaignCaller {
  id: string
  role: UserRole
  teamId: string | null
  grants?: string[]
  revokes?: string[]
}

/** The person whose desk an account is on, or null where it is on nobody's. */
export interface DeskHolder { id: string; role: UserRole; teamId: string | null }

/**
 * MAY THIS PERSON CAMPAIGN ON AN ACCOUNT ON THIS DESK?
 *
 * THE FIRM'S RULE: an Administrator on any account; a team leader only on accounts on their own
 * team's desks. "Their team" is profiles.team_id, the same thing the team filter on the book reads.
 *
 *   ADMINISTRATOR      any account, including the unallocated pile.
 *   A LEADER IN A TEAM accounts on the desk of anybody in that team, their own included.
 *   A LEADER IN NONE   the Call Centre Manager's shape -- "leads every team and belongs to none"
 *                      (CLAUDE.md). With floor.lead that is the collections floor: desks held by a
 *                      pre-legal agent or team leader, or by the manager. Without it, only their own.
 *   NOBODY'S DESK      the unallocated pile is the Administrator's alone: it belongs to no team.
 *
 * Asked by the SERVER for every account before anything is created, and again before each message
 * goes -- an account moved to another team's desk mid-campaign is skipped rather than sent.
 */
export function mayCampaignOn(
  caller: CampaignCaller, holder: DeskHolder | null, liaison: DeskHolder | null = null,
): boolean {
  if (!can(caller, 'campaign.run')) return false
  if (caller.role === 'Administrator') return true
  /*
   * A LIAISON OVER THEIR OWN CLIENTS. The firm: "even liaisons can run campaigns over their own
   * clients." Whose desk the account is on does not matter -- the client is theirs. A Liaison
   * Manager also over their team's liaisons' clients, as a team leader over their team's desks.
   */
  if (liaison && liaison.id === caller.id) return true
  if (liaison && caller.role === 'Liaison Manager' && caller.teamId && liaison.teamId === caller.teamId) return true
  if (!holder) return false
  if (holder.id === caller.id) return true
  if (caller.teamId) return holder.teamId === caller.teamId
  if (!can(caller, 'floor.lead')) return false
  return FLOOR_ROLES.includes(holder.role)
}

/**
 * MAY THIS PERSON PUSH ON OR STOP A CAMPAIGN THAT EXISTS? The tick, and then an Administrator any,
 * anybody else their own and their team's -- the same answer campaign_visible gives in the database,
 * so a campaign somebody can see is one they can stop.
 */
export function mayManageCampaign(
  caller: CampaignCaller, campaign: { createdBy: string | null; teamId: string | null },
): boolean {
  if (!can(caller, 'campaign.run')) return false
  if (caller.role === 'Administrator') return true
  if (campaign.createdBy === caller.id) return true
  return !!caller.teamId && campaign.teamId === caller.teamId
}

/** The collections floor, as desks: who a leader with no team of their own leads. */
export const FLOOR_ROLES: UserRole[] = ['Pre-legal Agent', 'Pre-legal Team Leader', 'Call Centre Manager']

/* ------------------------------------------------------------------------------------------
 * THE CONFIRMATION, IN WORDS
 * ------------------------------------------------------------------------------------------ */

/**
 * The sentence the confirm step reads back, like Add client's: the numbers in words a person can
 * check against what they meant, before anything leaves.
 */
export function campaignConfirmation(input: {
  name: string
  channel: CampaignChannel
  sending: number
  skipped: number
  estimate: FeeEstimate
  money: (n: number) => string
  from?: string | null
}): string {
  const what = input.channel === 'sms' ? 'SMS' : 'email'
  const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-ZA')} ${n === 1 ? one : many}`
  const parts = [
    `Campaign “${input.name.trim()}” will send one ${what} to ${plural(input.sending, 'debtor', 'debtors')}`
      + (input.channel === 'email' && input.from ? `, from ${input.from}` : '') + '.',
    input.skipped > 0 ? `${plural(input.skipped, 'account is', 'accounts are')} skipped and will not be contacted.` : null,
    input.estimate.total === 0 && input.sending > 0
      ? 'Nothing is charged for these messages.'
      : `Each message is charged to the debtor’s account under Annexure B item ${input.estimate.item === '1a' ? '1(a)' : '1(c)'}`
        + ` as it goes: about ${input.money(input.estimate.total)} excluding VAT in all.`,
    'It goes out only during the firm’s calling hours, and can be stopped at any time from Campaigns.',
  ]
  return parts.filter(Boolean).join(' ')
}
