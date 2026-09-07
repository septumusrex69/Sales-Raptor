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
 * Rate history, newest first.
 *
 * Both schedules are evidenced from the export rather than transcribed from a gazette: every
 * one of these figures is the median charge actually raised in its period, and each changed on
 * the same date. That date — 1 April 2026 — sits just after Government Notice R.7207 of
 * 6 March 2026, which is consistent, but the mapping of each line to an Annexure B item is not
 * yet confirmed. Treat the amounts as reliable and the item numbering as provisional.
 *
 * The Acknowledgement of Debt line is worth noting: it went DOWN, R210 to R161. R161 is the
 * gazetted item 4(a) figure for a debt under R50,000, so from April 2026 the charge matches the
 * gazette and R210 was the earlier rate — not, as first suspected, the other way round.
 */
export const TARIFF_HISTORY: TariffSchedule[] = [
  {
    effectiveFrom: '2026-04-01',
    note: 'Following GN R.7207, GG 54273, 6 March 2026. Acknowledgement of Debt falls to the gazetted R161.',
    rates: {
      phone_call: 25,
      sms: 3.5,
      email_out: 25,
      letter: 25,
      consultation: 60,
      perusal: 25,
      acknowledgement_of_debt: 161,
      promise_to_pay: 50,
    },
  },
  {
    effectiveFrom: '1900-01-01',
    note: 'The schedule in force before April 2026, as charged.',
    rates: {
      phone_call: 21,
      sms: 3,
      email_out: 21,
      letter: 21,
      consultation: 52,
      perusal: 21,
      acknowledgement_of_debt: 210,
      promise_to_pay: 41,
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
export function codeForLegacyName(name: string): ActionCode | undefined {
  const x = name.toLowerCase().replace(/[^a-z]/g, '')
  if (x.includes('aknowledg') || x.includes('acknowledg')) return 'acknowledgement_of_debt'
  if (x.includes('perusal')) return 'perusal'
  if (x.includes('consultation')) return 'consultation'
  if (x.includes('promisetopay')) return 'promise_to_pay'
  if (x.includes('whatsapp')) return 'whatsapp'
  if (x.includes('trace')) return 'trace'
  if (x === 'sms') return 'sms'
  if (x.includes('incomingemail') || x === 'emailincoming') return 'email_in'
  if (x.includes('outgoingemail') || x === 'emailoutgoing' || x === 'email') return 'email_out'
  if (x.includes('letter')) return 'letter'
  if (x.includes('phone') || x.includes('call')) return 'phone_call'
  return undefined
}
