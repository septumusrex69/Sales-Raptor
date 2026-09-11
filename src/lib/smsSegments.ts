/**
 * How many SMS segments a message costs, and therefore what the debtor is charged.
 *
 * Annexure B item 1(c) is "necessary electronic communication, other than facsimile or e-mail
 * (each)" at R3.50. A 161-character message is not one communication that happens to be long — the
 * network splits it into two and the firm is billed for two, which is why the migrated book has
 * SMS rows at R6.90 and R10.35 next to ones at R3.45. Counting this wrong overcharges or
 * undercharges every SMS the system ever sends, so it is worth getting exactly right.
 *
 * The rules are GSM 03.38's, not ours:
 *   - A message using only the GSM 7-bit alphabet fits 160 characters in one segment. Split, each
 *     segment loses 7 characters to the concatenation header, leaving 153.
 *   - Seven characters (^{}[]~| and the euro sign) are not in the base alphabet. They are sent as
 *     an escape plus the character, so each costs TWO of the 160.
 *   - One character outside that alphabet — a curly quote pasted from Word, an emoji, an accented
 *     name — forces the whole message into UCS-2, where a segment holds 70 characters, or 67 when
 *     split. A single smart apostrophe can therefore double the bill.
 *
 * Pure: no imports, no network, no clock.
 */

/** The GSM 7-bit default alphabet. Anything not in here forces UCS-2. */
const GSM_BASE =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?'
  + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'

/** Sent as an escape plus the character, so each of these costs two. */
const GSM_EXTENDED = '^{}\\[~]|€'

export type SmsEncoding = 'GSM-7' | 'UCS-2'

export interface SmsCost {
  encoding: SmsEncoding
  /** Characters as billed: an extended GSM character counts twice. */
  units: number
  /** How many messages the network will actually send. Zero for an empty message. */
  segments: number
  /** What pushed it to UCS-2, for telling somebody why their message got expensive. */
  offending: string[]
}

const SINGLE = { 'GSM-7': 160, 'UCS-2': 70 } as const
const CONCATENATED = { 'GSM-7': 153, 'UCS-2': 67 } as const

/**
 * What a message will cost to send.
 *
 * Counts by code point rather than by `length`, because an emoji is two UTF-16 units and a
 * surrogate pair must not be counted as two characters.
 */
export function smsCost(text: string): SmsCost {
  const chars = [...text]
  const offending = [...new Set(chars.filter((c) => !GSM_BASE.includes(c) && !GSM_EXTENDED.includes(c)))]
  const encoding: SmsEncoding = offending.length > 0 ? 'UCS-2' : 'GSM-7'

  // In UCS-2 a character outside the Basic Multilingual Plane (an emoji) takes two units.
  const units = encoding === 'UCS-2'
    ? chars.reduce((n, c) => n + (c.codePointAt(0)! > 0xffff ? 2 : 1), 0)
    : chars.reduce((n, c) => n + (GSM_EXTENDED.includes(c) ? 2 : 1), 0)

  if (units === 0) return { encoding, units: 0, segments: 0, offending }
  const segments = units <= SINGLE[encoding]
    ? 1
    : Math.ceil(units / CONCATENATED[encoding])
  return { encoding, units, segments, offending }
}

/** How many characters are left before the message costs another segment. */
export function unitsUntilNextSegment(text: string): number {
  const { encoding, units, segments } = smsCost(text)
  const capacity = segments <= 1 ? SINGLE[encoding] : CONCATENATED[encoding] * segments
  return Math.max(0, capacity - units)
}
