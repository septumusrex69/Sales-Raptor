/**
 * The catalogue of billable actions, and what each cost on a given day.
 *
 * Two problems this exists to end, both measured in the Swordfish export of 7 Sep 2026 across
 * 59,158 actions:
 *
 * 1. Action names were free text. Ninety-two distinct names, of which twenty-eight are
 *    misspellings or casings of another — "Acknowledgement of Debt" appears six ways, including
 *    "Aknowledgement" and "Acknowledgment", across 688 actions; "Perusal of documents" five ways
 *    across 695. Any fee report grouped by name was wrong, and so was any mapping to an
 *    Annexure B item.
 *
 * 2. The price was typed per action rather than read from a tariff. With the rate history below
 *    applied, 91.6% of 18,762 billed non-SMS actions were charged the rate in force that day;
 *    the rest were almost entirely under-charges (R10,098 excl VAT foregone, against R274 of
 *    over-charging). Under-charging is lost revenue; over-charging is a compliance problem. A
 *    catalogue with the rate attached removes both.
 *
 * Rates are versioned by effective date and never edited in place. An account worked in 2025
 * must keep being calculated on the 2025 tariff, or a statement reissued later will not match
 * the one the debtor was originally sent.
 */

export type ActionCode =
  | 'phone_call'
  | 'sms'
  | 'email_out'
  | 'email_in'
  | 'letter'
  | 'consultation'
  | 'perusal'
  | 'acknowledgement_of_debt'
  | 'promise_to_pay'
  | 'trace'
  | 'whatsapp'
  /*
   * VERIFYING THAT A DEBTOR PAID THE CLIENT DIRECT.
   *
   * THE FIRM, correcting an earlier judgement of mine that this should be free: "You can charge a
   * perusal fee for a PTC because the debtor has paid into the client's account and it cost us
   * administration to verify this... handle it as other necessary expenses and call it a PTC
   * confirmation."
   *
   * They are right and the reasoning I had was wrong. I read the confirmation as the FIRM's own
   * evidence for invoicing the client, and therefore not the debtor's to pay. But the work is
   * there because the DEBTOR chose to pay somebody else: the firm has to obtain the client's
   * confirmation, read it, and satisfy itself the money is real before it touches a balance.
   * Item 3 is "other necessary expenses not specifically provided for", and that is what this is.
   *
   * ITS OWN CODE RATHER THAN `perusal`, because the two are limited differently. A perusal is
   * capped per period however many documents are read; a PTC confirmation is one verification of
   * one payment, and two PTCs in a month are two pieces of work.
   */
  | 'ptc_confirmation'

export interface ActionDefinition {
  code: ActionCode
  label: string
  /**
   * Billed per message part rather than per action. A message too long for one SMS is delivered
   * as several and is charged as several: in the export every one of 5,779 pre-April charges is
   * an exact multiple of the unit rate, splitting 1,472 / 3,251 / 1,037 across one, two and
   * three parts. Anything that treats an SMS as a flat fee misprices two thirds of them.
   */
  perSegment?: boolean
  /** Whether the action counts toward Annexure B's monthly electronic-communication limit. */
  electronicCommunication?: boolean
}

export const ACTION_DEFINITIONS: ActionDefinition[] = [
  { code: 'ptc_confirmation', label: 'PTC Confirmation' },
  { code: 'phone_call', label: 'Phone Call' },
  { code: 'sms', label: 'SMS', perSegment: true, electronicCommunication: true },
  { code: 'email_out', label: 'Email (Outgoing)', electronicCommunication: true },
  { code: 'email_in', label: 'Email (Incoming)' },
  { code: 'letter', label: 'Letter' },
  { code: 'consultation', label: 'Consultation' },
  { code: 'perusal', label: 'Perusal of Documents' },
  { code: 'acknowledgement_of_debt', label: 'Acknowledgement of Debt' },
  { code: 'promise_to_pay', label: 'Promise to Pay' },
  { code: 'trace', label: 'Trace' },
  { code: 'whatsapp', label: 'WhatsApp Correspondence' },
]

export const ACTION_BY_CODE: Record<ActionCode, ActionDefinition> = Object.fromEntries(
  ACTION_DEFINITIONS.map((d) => [d.code, d]),
) as Record<ActionCode, ActionDefinition>

export interface TariffSchedule {
  /** Inclusive first day this schedule applies. */
  effectiveFrom: string
  note: string
  /** Rands, EXCLUDING VAT. For a per-segment action this is the price of one segment. */
  rates: Partial<Record<ActionCode, number>>
}

/**
 * Rate history, newest first — transcribed from the gazettes, not inferred from what was charged.
 *
 * An earlier version of this list was built from the export: each figure was the median charge
 * actually raised in its period, and the schedules were dated from where those medians changed.
 * That gave 1 April 2026, and it was wrong by three and a half weeks — GN R.7207 took effect on
 * **6 March 2026**. The business simply did not reconfigure Swordfish until April.
 *
 * The distinction matters and is not pedantic. What was charged is a fact about the past that a
 * reissued statement must reproduce exactly; what the gazette says is the law, and the gap
 * between them is a finding rather than a definition. Dating this table from behaviour made the
 * gap invisible by construction — the tariff would always agree with itself. Dating it from the
 * gazettes makes 156 actions between 6 and 31 March 2026 visibly under-charged, by R475.00 excl
 * VAT. Under-charging is lawful, so nothing needs fixing; it just needs to be seeable.
 *
 * Two mappings worth stating, because a rate alone does not say which item it is:
 *
 *   perusal        item 3, "other necessary expenses not specifically provided for" — the same
 *                  amount as a letter or a call in every schedule, which is why they move
 *                  together and why "Necessary Costs" at exactly R21 was resolvable.
 *   promise_to_pay item 5, the settlement account drawn at the debtor's request.
 *
 * acknowledgement_of_debt is the exception, and the one line here that is still evidenced rather
 * than transcribed. Annexure B has two items an AoD can fall under and the export does not say
 * which occurred:
 *
 *   4(a)  the acknowledgement itself, including the necessary consultation — banded by debt
 *         size, prescribed by the Magistrates' Courts Rules rather than by this Annexure, and
 *         held in annexureB.ts as ACKNOWLEDGEMENT_OF_DEBT_BANDS.
 *   4(b)  the original documents signed at the debtor's residence or place of work — a flat
 *         gazetted figure: R250 / R210 / R198 / R178 across the four schedules.
 *
 * These are different acts, both lawful, and the business changed which one it charges: R210
 * (the 4(b) figure) before 2026, R161 (the 4(a) band for a debt under R50,000) after. So the
 * line goes DOWN in 2026, which is a change of item and not a rate cut.
 *
 * What is recorded here is the charge as actually raised, because that is what a reissued
 * statement has to reproduce. Writing the gazetted 4(b) figure into the 2026 row instead — which
 * I tried — makes every real acknowledgement look R89 under-charged and invents R12,000 of
 * shortfall that does not exist. The earlier schedules carry 4(b) because we hold that gazette
 * and not the Magistrates' Courts tariff for those years; no action in the book is old enough
 * for the difference to bite.
 */
/**
 * HOW OFTEN AN ACTION MAY BE CHARGED IN ONE DAY, or absent where nothing limits it.
 *
 * ONE ENTRY, AND IT IS THE FIRM'S OWN RULE: "we should add a fee perusal of documents. This is any
 * time anybody saves a document or opens a document, but limited to one a day. So one charge a
 * day. Can't be more than one perusal of documents in a day. This includes a trace and everything
 * else."
 *
 * A NARROWING, NOT A NEW FEE. `perusal` has been item 3 with four schedules of rates since the
 * import, and raising a dispute has charged it all along. What it never had was a limit -- item 3
 * is gazetted as "a total amount of R25,00" for the whole account and the firm instructed on 9
 * September that it is charged per occurrence instead (ENFORCE_ITEM_TOTALS), which left nothing at
 * all between a collector and a fee every time they opened a PDF. One a day is the firm putting
 * that boundary back where they want it.
 *
 * COUNTED ON THE ACTION, NOT ON THE ITEM, and that is the whole of "this includes a trace and
 * everything else": a document opened, a document saved, a trace report read and a dispute handed
 * to a liaison are one kind of work to the gazette and one kind of work to the firm, so they share
 * the day's allowance rather than each having their own.
 *
 * PER ACCOUNT, NOT PER PERSON -- the firm, asked directly which it was: "one charge per account per
 * day". It is the DEBTOR who pays it, so the day belongs to the file rather than to whoever opened
 * it. A collector, their team leader and the client liaison all reading the same trace report on
 * the same afternoon read ONE set of documents; three charges for it would be the firm billing a
 * debtor for its own internal handover. `created_by` sits on every fee row, so counting the day
 * there was one filter away, and it would have read "one each".
 *
 * PER CALENDAR DAY IN THE FIRM'S OWN TIMEZONE. An action at one in the morning in Johannesburg is
 * eleven the previous night in UTC, and a day boundary read in the wrong zone is a second charge
 * on a debtor who was only ever perused once.
 */
export const DAILY_LIMIT: Partial<Record<ActionCode, number>> = {
  perusal: 1,
}

/**
 * THE ACTION CODE TRACING ACTUALLY WRITES.
 *
 * NOT `trace`, WHICH IS IN THE UNION ABOVE AND NOTHING WRITES. accountTrace has stored 'TRC' since
 * the Trace button was built, and every tracing fee on the book carries it. Named here rather than
 * quietly repeated, because the cap below has to match what is in the COLUMN and not what the type
 * says ought to be there -- a cap keyed on the tidier spelling would count nothing for ever and
 * refuse nobody, which is the kind of guard that looks right in a diff and does not exist.
 *
 * The discrepancy is left alone deliberately: renaming it means rewriting history on 59 215 fee
 * rows, and CLAUDE.md says imported figures are not swept.
 */
export const TRACING_ACTION_CODE = 'TRC'

/**
 * HOW MANY TIMES AN ACTION MAY BE CHARGED IN A CALENDAR MONTH.
 *
 * THE FIRM, settling how the wider trace sources are to be billed: "I don't think you have to
 * charge the other necessary expenses for every single one. It's just if you're starting to
 * conduct those traces... Cap all the tracing activities at four a month. Whether or not it's a
 * trace or the other necessary expense. Just detail them."
 *
 * ONE ALLOWANCE ACROSS BOTH ITEMS, WHICH IS WHY IT IS KEYED ON THE ACTION. A bureau search is item
 * 4(c) and a SASSA or deeds search is item 3, and the firm's instruction is that four is the total
 * of BOTH -- "whether or not it's a trace or the other necessary expense". Keyed on the item it
 * would be two separate fours, which is twice what they asked for; and item 3 also carries the
 * perusal of documents and the PTC confirmation, so an item-3 cap would stop a collector opening a
 * PDF because somebody had searched the deeds office.
 *
 * SEPARATE FROM ENFORCE_MONTHLY_LIMITS, which stays off. That flag is the GAZETTE's per-item
 * allowances, which the firm switched off on 10 September for a reason that is still true -- the
 * gazette counts per account while the work happens per person. This is the firm's own cap on
 * their own activity, so it is their number rather than the gazette's and it binds whatever that
 * flag is doing. The two agree at four by coincidence, not by construction.
 *
 * PER ACCOUNT AND PER CALENDAR MONTH, like the gazette's own wording and like DAILY_LIMIT above:
 * it is the DEBTOR who pays, so the allowance belongs to the file rather than to whoever spent it.
 */
export const MONTHLY_LIMIT: Record<string, number> = {
  [TRACING_ACTION_CODE]: 4,
}

export const TARIFF_HISTORY: TariffSchedule[] = [
  {
    effectiveFrom: '2026-03-06',
    note: 'GN R.7207, GG 54273. Charging changed over in April, three and a half weeks late.',
    rates: {
      phone_call: 25,
      sms: 3.5,
      email_out: 25,
      letter: 25,
      consultation: 60,
      perusal: 25,
      // The 4(a) band for a debt under R50,000, which is what has been charged since April 2026.
      acknowledgement_of_debt: 161,
      promise_to_pay: 50,
    },
  },
  {
    effectiveFrom: '2020-05-22',
    note: 'GN R.580, GG 43343. Covers all but the last six months of the migrated book.',
    rates: {
      phone_call: 21,
      sms: 3,
      email_out: 21,
      letter: 21,
      consultation: 52,
      perusal: 21,
      // The 4(b) figure, which is what was charged under this schedule.
      acknowledgement_of_debt: 210,
      promise_to_pay: 41,
    },
  },
  {
    effectiveFrom: '2017-10-27',
    note: 'GN R.1141, GG 41205. Earlier than any action in the export; here so the ledger is complete.',
    rates: {
      phone_call: 20,
      sms: 2.8,
      email_out: 20,
      letter: 20,
      consultation: 49,
      perusal: 20,
      acknowledgement_of_debt: 198,
      promise_to_pay: 39,
    },
  },
  {
    effectiveFrom: '2015-12-23',
    note: 'GN R.1272, GG 39552. The oldest schedule we hold.',
    rates: {
      phone_call: 18,
      sms: 2.5,
      email_out: 18,
      letter: 18,
      consultation: 44,
      perusal: 18,
      acknowledgement_of_debt: 178,
      promise_to_pay: 35,
    },
  },
]

/** The schedule in force on a given day. */
export function scheduleOn(date: Date | string): TariffSchedule {
  const iso = typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10)
  return TARIFF_HISTORY.find((s) => s.effectiveFrom <= iso) ?? TARIFF_HISTORY[TARIFF_HISTORY.length - 1]
}

/**
 * What to charge for one action, excluding VAT.
 *
 * `segments` applies only where the action is billed per part; it is ignored elsewhere rather
 * than silently multiplying a flat fee. Returns undefined where the schedule names no price,
 * so a caller has to decide rather than being handed a zero that looks like a free action.
 */
export function rateFor(code: ActionCode, date: Date | string, segments = 1): number | undefined {
  const unit = scheduleOn(date).rates[code]
  if (unit === undefined) return undefined
  return ACTION_BY_CODE[code].perSegment ? unit * Math.max(1, Math.round(segments)) : unit
}

/**
 * Maps a name as Swordfish recorded it onto a code.
 *
 * Needed only for the migration: once actions are raised from the catalogue they carry a code
 * and this becomes dead weight. Deliberately forgiving about spelling and casing, because the
 * historical data is, and deliberately returns undefined rather than guessing — an action that
 * cannot be identified must be reported and looked at, not quietly filed under the nearest match.
 */

/**
 * Legacy names resolved by evidence rather than by pattern.
 *
 * Kept as an explicit list, with the evidence written down, because these are judgements about
 * historical money and someone will eventually need to know why a 2024 fee is filed where it
 * is. A fuzzy rule that quietly absorbed them would be unreviewable; this can be argued with.
 */
export const LEGACY_NAME_OVERRIDES: { legacy: string; code: ActionCode; evidence: string }[] = [
  {
    legacy: 'correspondence',
    code: 'email_out',
    evidence:
      'All 25 charged instances carry the comment "Emailed debtor", and 24 of them are priced at ' +
      'R21 — the outgoing-email rate in force at the time. The name is vague; what was done is not. ' +
      'Note it is NOT Annexure B item 6 ("Correspondence received and attended to", R11 in 2020): ' +
      'item 6 is inbound, these are outbound, and the price says so.',
  },
  {
    legacy: 'necessarycosts',
    code: 'perusal',
    evidence:
      'Eight charges of exactly R21, all on 2024-05-07. The 22 May 2020 gazette prices item 3, ' +
      '"Other necessary expenses not specifically provided for", at exactly R21 — the name, the ' +
      'amount and the schedule in force all agree. Previously quarantined only because we had not ' +
      'read the 2020 Annexure B.',
  },
  {
    legacy: 'teamleaderassistance',
    code: 'phone_call',
    evidence:
      'A single charge of R25 in Aug 2026 commented "WhatsApp Call - No Contact". R25 is the ' +
      'item 2 phone-call rate under the 2026 schedule, and the comment says a call was attempted. ' +
      'The name describes who helped, not what was done; the comment and the price describe the act.',
  },
]

/**
 * Names that must come across as history but must not bring a fee with them.
 *
 * The action happened and the audit trail should say so, but nobody can identify what was being
 * charged for, and a fee filed under a guessed Annexure B item is a wrong statement waiting to be
 * reissued. These import with their money held back for classification rather than being silently
 * dropped or silently accepted.
 *
 * Currently empty, and worth saying why. Both former entries — "Necessary Costs" and "Team Leader
 * Assistance" — were released once we read the 22 May 2020 gazette: each turned out to sit exactly
 * on a gazetted amount for the schedule in force on its own date. They are in
 * LEGACY_NAME_OVERRIDES above with that evidence. The mechanism stays because the next export will
 * bring names nobody recognises, and holding their money back is the right default.
 */
export const QUARANTINED_LEGACY_NAMES: { legacy: string; reason: string }[] = []

/** Whether a legacy name is one whose fee is held back pending classification. */
export function isQuarantinedLegacyName(name: string): boolean {
  const x = name.toLowerCase().replace(/[^a-z]/g, '')
  return QUARANTINED_LEGACY_NAMES.some((q) => q.legacy === x)
}

export function codeForLegacyName(name: string): ActionCode | undefined {
  const x = name.toLowerCase().replace(/[^a-z]/g, '')
  // An evidenced override beats a pattern, and a quarantined name resolves to nothing at all.
  const override = LEGACY_NAME_OVERRIDES.find((o) => o.legacy === x)
  if (override) return override.code
  if (QUARANTINED_LEGACY_NAMES.some((q) => q.legacy === x)) return undefined
  if (x.includes('aknowledg') || x.includes('acknowledg')) return 'acknowledgement_of_debt'
  if (x.includes('perusal')) return 'perusal'
  if (x.includes('consultation')) return 'consultation'
  if (x.includes('promisetopay')) return 'promise_to_pay'
  if (x.includes('whatsapp') || x.includes('whatapp')) return 'whatsapp'
  // 'trac', not 'trace' — "Tracing" does not contain "trace". XDS is the credit bureau these
  // searches are run against, so an action named for the bureau is a trace by another name.
  if (x.includes('trac') || x.includes('xds')) return 'trace'
  if (x === 'sms') return 'sms'
  if (x.includes('incomingemail') || x === 'emailincoming') return 'email_in'
  if (x.includes('outgoingemail') || x === 'emailoutgoing' || x === 'email') return 'email_out'
  if (x.includes('correspondence') && x.includes('email')) return 'email_out'
  if (x.includes('letter')) return 'letter'
  if (x.includes('phone') || x.includes('call')) return 'phone_call'
  return undefined
}
