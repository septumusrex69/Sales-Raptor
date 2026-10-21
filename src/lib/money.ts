/**
 * MONEY, WRITTEN THE WAY THE FIRM WRITES IT: R 12 345.67.
 *
 * The firm's own instruction for the Finance module -- "space as thousands separator, two
 * decimals" -- and it is worth having in one place rather than as a `toLocaleString` call repeated
 * on every screen, because the separator is not the space anybody would type.
 *
 * IT IS A NON-BREAKING SPACE, U+00A0, IN BOTH POSITIONS. That is what `en-ZA` itself produces, and
 * it is the right character: a Rand amount must not break across two lines, and "R 12" at the end
 * of one line with "345.67" at the start of the next is a figure a client queries.
 *
 * AND IT COSTS MONEY IN AN SMS, WHICH IS WHY THIS IS NOT THE ONLY FORMATTER. U+00A0 is not in the
 * GSM alphabet, so one merged Rand amount drops a whole message to UCS-2 and cuts every segment
 * from 160 characters to 70 -- R3,50 becoming R7,00 on a 94-character message, paid by the debtor
 * under item 1(c). `SmsModal` strips it out of merged values for exactly that reason. Screens and
 * PDFs keep it; anything that goes down a phone network does not.
 *
 * NEGATIVES CARRY A REAL MINUS SIGN AND KEEP THE R IN FRONT: "-R 289.84", not "R -289.84" and not
 * "(R 289.84)". A reversal line and a carried shortfall are both negative and both appear on a
 * client's remittance advice, so the shape has to read as an amount being taken away at a glance.
 */

/** The non-breaking space, named because it is invisible and load-bearing. */
export const NBSP = ' '

/** `12 345.67` -- the number alone, grouped, always two decimals. */
export function amount(n: number | null | undefined): string {
  const v = Number.isFinite(n as number) ? (n as number) : 0
  const [whole, cents] = Math.abs(v).toFixed(2).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
  return `${v < 0 ? '-' : ''}${grouped}.${cents}`
}

/** `R 12 345.67`, or `-R 289.84`. */
export function rand(n: number | null | undefined): string {
  const v = Number.isFinite(n as number) ? (n as number) : 0
  return `${v < 0 ? '-' : ''}R${NBSP}${amount(Math.abs(v))}`
}

/**
 * A figure that may be nothing at all.
 *
 * NULL IS NOT NOUGHT and this is the one place that distinction is cheap to keep: an account with
 * no commission rate on file shows a dash, not R 0.00, because R 0.00 is a rate somebody agreed
 * to. The same reasoning as `payment_allocations.commission_rate` being nullable.
 */
export function randOrDash(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : rand(n)
}

/** `30%` from the fraction 0.30. Rates are fractions everywhere in Raptor; this is the only
 *  place they are shown as percentages, and a null rate is a dash rather than 0%. */
export function ratePercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '—'
  const pct = fraction * 100
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/\.?0+$/, '')}%`
}
