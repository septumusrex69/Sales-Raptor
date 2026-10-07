/**
 * WHAT ONE ACCOUNT ANSWERS THE MERGE FIELDS WITH.
 *
 * `mergeValuesFor` turns already-resolved facts into values. This is the layer above it: the
 * assembly -- which balance, which of the three people, which address, what "respond by" means --
 * and it was written inside a `useMemo` on the account screen.
 *
 * MOVED OUT BECAUSE THE WORKFLOW RUNNER NEEDS THE SAME ANSWER. The runner merges the same
 * templates against the same accounts with nobody watching, and a second assembly would drift
 * from the one a collector can see on screen. The drift would be invisible in exactly the
 * direction that matters: the screen would look right and the unattended notice would not.
 *
 * PURE, and no React. It takes plain rows and returns a map, so a check can run it and the server
 * can call it.
 *
 * NULLS ARE DROPPED RATHER THAN BLANKED, which is the half that makes the guard work.
 * `renderTemplate` treats a missing key and an empty string differently, and only the first
 * leaves "{{respond_by}}" standing where somebody -- or `planSend` -- can see it. An empty string
 * would make an unanswerable notice sendable.
 */
import { mergeValuesFor, type Person, type TemplateAccount } from './messageTemplates.js'
import type { Arrangement } from './arrangements.js'
import { addWorkingDays } from './workingDays.js'
import type { FirmSettings } from './firmSettings.js'
import { isQuotable, type Settlement } from './settlement.js'

/** Only what the address is picked on. The account screen's AccountContact satisfies it. */
export interface ContactLike {
  kind: string
  value: string | null
  isPrimary?: boolean | null
  retiredAt?: string | null
}

/**
 * The address a notice is posted to.
 *
 * THE PRIMARY ONE, AND NEVER A RETIRED ONE. `retiredAt` is set when somebody established the
 * debtor no longer lives there -- posting a statutory demand to an address known to be wrong is
 * worse than posting none, because it looks served. Where nothing is marked primary the first
 * live address is used, which is the order they were captured in.
 *
 * Returned as typed, on its own lines, because that is how {{debtor_address}} is merged and how
 * an address is written on a page.
 */
export function addressOf(contacts: ContactLike[]): string | null {
  return contactOf(contacts, 'address')
}

/**
 * ANY ONE KIND OF CONTACT, on the same rule the address is chosen by.
 *
 * WRITTEN OUT ONCE RATHER THAN FIVE TIMES. The acknowledgement of debt now asks the debtor to
 * confirm a cellphone, a work number, a home number and an email address -- the firm: "just kind
 * of to confirm that stuff" -- and every one of them wants the primary, never a retired one, for
 * exactly the reason an address does: a number somebody established is wrong is worse than no
 * number, because the file then reads as contactable.
 *
 * NULL RATHER THAN AN EMPTY STRING, so an unanswerable line LEAVES the document instead of
 * printing its label with nothing after it. See MergeField.optional.
 */
export function contactOf(contacts: ContactLike[], kind: string): string | null {
  const live = contacts.filter((c) => c.kind === kind && !c.retiredAt)
  const pick = live.find((c) => c.isPrimary) ?? live[0]
  return (pick?.value ?? '').trim() || null
}

/**
 * How long the debtor is given to answer, from the day the notice goes out.
 *
 * TEN WORKING DAYS, not ten calendar days, and not counted by hand -- `addWorkingDays` knows the
 * public holidays, including the Easter dates and the Monday a holiday moves to when it falls on
 * a Sunday. A demand that gives a debtor less time than the Act does is a demand that can be set
 * aside.
 */
export function respondBy(today: string): string {
  return addWorkingDays(today, 10)
}

export function accountMergeValues(input: {
  account: TemplateAccount
  /**
   * Passed in rather than computed: it is capital plus interest plus fees less payments, subject
   * to in duplum, and accountBalance.ts is the one place that arithmetic lives.
   */
  balance: number | null
  clientName: string | null
  /**
   * THE THREE PEOPLE A LETTER CAN NAME, and they are not the same person.
   *
   * `agent` is whoever is SENDING. `collector` is whoever the ACCOUNT is assigned to -- the
   * answer to "who is handling my account", and it follows the account when it is handed on.
   * `liaison` is whoever looks after the CLIENT whose book it is. On a quiet day they are the
   * same person and the distinction looks like pedantry; the day an account is reassigned it is
   * the difference between a debtor reaching somebody and reaching nobody.
   *
   * ON THE UNATTENDED PATH THERE IS NO AGENT, and the runner passes the COLLECTOR as both. That
   * is not a fudge: the message leaves by the collector's mailbox, names them, and invites a
   * reply to them, so they are in every sense the person sending it. Passing null instead would
   * leave {{agent_name}} standing and hold every step -- the firm's own handover email asks for
   * it.
   */
  agent: Person | null
  collector: Person | null
  liaison: Person | null
  /**
   * The debtor's identity number, UNMASKED. `mergeValuesFor` masks it -- the firm asked for the
   * spaces out of the mask because they cost an SMS three characters it does not have -- so what
   * is passed here is the raw number and what comes back is "850312XXXX08X".
   *
   * Beside the account rather than on it: TemplateAccount deliberately carries no identity
   * number, so nothing that only needs to address a debtor is handed one.
   */
  debtorIdNumber: string | null
  contacts: ContactLike[]
  firm: FirmSettings
  /** The day the notice goes out, as a yyyy-mm-dd key. Taken, never read off a clock. */
  today: string
  money: (amount: number) => string
  /**
   * THE ACCOUNT'S LIVE ARRANGEMENT, where it has one, and the arrangement notices are the only
   * templates that quote it.
   *
   * WHICH INSTALMENT IS DECIDED BY ptpSchedule.nextUnpaid AND NOWHERE ELSE -- the earliest one not
   * yet paid, which is the confirmation's first, a reminder's upcoming one, a receipt's following
   * one and a default letter's MISSED one, all from the same rule. This layer only carries the
   * answer down, exactly as it carries the balance rather than computing it.
   *
   * OMITTED OR NULL ON AN ACCOUNT WITH NO ARRANGEMENT, which is nearly all of them, and both
   * placeholders then stand: an arrangement notice cannot be merged against an account that has no
   * arrangement to quote, which is what holds the step instead of sending a blank amount.
   */
  /**
   * THE LEDGER'S WORKING, for a document that has to show it.
   *
   * An acknowledgement of debt prints the sum its capital amount is made of, because the clause
   * above it has the debtor confirm they have CHECKED it -- a figure they cannot see is one they
   * cannot have checked. Carried down rather than computed here, exactly as the balance is.
   */
  breakdown?: { interest: number; fees: number; receiptFees: number; vat: number } | null
  /** What interest is doing on this account, for the same documents. */
  interestRateAnnual?: number | null
  interestFrom?: string | null
  nextInstalment?: { amount: number; dueOn: string } | null
  /**
   * HOW OFTEN THAT INSTALMENT FALLS, off the same promise row. See `ptp_frequency`.
   *
   * CARRIED DOWN RATHER THAN DERIVED, like the instalment above it. Both callers gate it on the
   * instalment being there, so an account with no arrangement answers null to both and the notice
   * holds -- rather than describing "a single payment", which is what the arrangement fallback's
   * own shape would have said.
   */
  arrangement?: Arrangement | null
  /** What a receipt confirms: the newest unreversed payment. See `ptp_paid` in messageTemplates. */
  paymentReceived?: number | null
  /** The dispute this message is about, where it is about one. */
  dispute?: {
    daysLeft: string | null
    allegedOn: string | null
    receivedOn: string | null
    summary: string | null
  } | null
  /**
   * THE ACCOUNT'S SETTLEMENT, whatever state it is in. Only an approved, unlapsed one answers the
   * three settlement fields -- decided here, by isQuotable, so neither caller can pass a proposal
   * through by mistake.
   */
  settlement?: Settlement | null
  /**
   * THE DATE THE MESSAGE'S OWN PERIOD RUNS TO, where it is not the ordinary one.
   *
   * `respondBy` below is ten working days from today, which is what a section 129 gives. A DISPUTE
   * message is not that: while a demand is running the debtor has what is LEFT of ITS period, and
   * the date quoted must be the notice's own -- two dates days apart, each headed "respond by", is
   * an ambiguity a debtor is entitled to resolve in their own favour. disputeWindow decides it and
   * this is how it reaches the merge.
   */
  respondByOverride?: string | null
}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(mergeValuesFor({
      account: input.account,
      balance: input.balance,
      clientName: input.clientName,
      agentName: input.agent?.name ?? null,
      agentPhone: input.agent?.phone ?? null,
      agentEmail: input.agent?.email ?? null,
      agentWhatsapp: input.agent?.whatsapp ?? null,
      collector: input.collector,
      liaison: input.liaison,
      today: input.today,
      money: input.money,
      debtorIdMasked: input.debtorIdNumber,
      positionAsAt: input.today,
      debtorAddress: addressOf(input.contacts),
      /*
       * WHAT THE FIRM HOLDS, so the signer is CONFIRMING rather than filling in from nothing.
       * The firm's word for this was "confirm", and a form that shows a blank box has not asked
       * anybody to confirm anything -- it has asked them to remember. Anything the book cannot
       * answer stays null and the whole line leaves the document until the signer supplies it.
       *
       * 'phone' IS THE HOME LINE. The contact kinds are mobile / phone / work / email, and the
       * firm's own words for them are cellphone, home and work -- see DebtorDetails, where the
       * same mapping is drawn.
       */
      debtorMobile: contactOf(input.contacts, 'mobile'),
      debtorWorkPhone: contactOf(input.contacts, 'work'),
      debtorHomePhone: contactOf(input.contacts, 'phone'),
      debtorEmail: contactOf(input.contacts, 'email'),
      debtorEmployer: contactOf(input.contacts, 'employer'),
      respondBy: input.respondByOverride ?? respondBy(input.today),
      nextInstalment: input.nextInstalment ?? null,
      arrangement: input.arrangement ?? null,
      paymentReceived: input.paymentReceived ?? null,
      dispute: input.dispute ?? null,
      settlement: isQuotable(input.settlement)
        ? { amount: input.settlement.amount, expiresOn: input.settlement.expiresOn, saving: input.settlement.saving }
        : null,
      breakdown: input.breakdown ?? null,
      interestRateAnnual: input.interestRateAnnual ?? null,
      interestFrom: input.interestFrom ?? null,
      /* Passed whole. There is no list of the firm's fields here to fall behind the ones the
         library grew -- see mergeValuesFor, which takes FirmSettings' own shape. */
      firm: input.firm,
    })).filter((entry): entry is [string, string] => entry[1] !== null),
  )
}
