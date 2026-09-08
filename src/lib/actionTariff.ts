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
