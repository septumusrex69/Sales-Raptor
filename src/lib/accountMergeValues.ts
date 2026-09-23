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
import { addWorkingDays } from './workingDays.js'
import type { FirmSettings } from './firmSettings.js'

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
  const live = contacts.filter((c) => c.kind === 'address' && !c.retiredAt)
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
      respondBy: respondBy(input.today),
      /* Passed whole. There is no list of the firm's fields here to fall behind the ones the
         library grew -- see mergeValuesFor, which takes FirmSettings' own shape. */
      firm: input.firm,
    })).filter((entry): entry is [string, string] => entry[1] !== null),
  )
}
