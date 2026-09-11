/**
 * The dispute classification.
 *
 * Its own module because it is pure data with two rules attached, and because accountQueries
 * talks to Postgres — which would mean the taxonomy could only be exercised in a browser. The
 * thing a collector picks from on every call is worth being able to test in a second.
 */

/**
 * What a debtor is actually disputing, as the firm classifies it.
 *
 * The first list was a guess — seven labels invented from what disputes tend to be about. This
 * one is the firm's own, and it is a better instrument for the same reason any real taxonomy
 * beats an improvised one: the categories divide on WHY the debtor is objecting rather than on
 * what they happened to say. "Already paid" and "amount disputed" were two names for arguments
 * that need entirely different answers; "payment query" and "amount dispute" are not.
 *
 * The examples are not decoration. A collector on a call has seconds to classify, and the second
 * column is what makes the difference between the right box and the nearest one — so they are
 * shown beside the choice rather than kept in a manual nobody opens.
 *
 * Ordered as the firm wrote it, not alphabetically: the common ones are near the top, which is
 * where a list that gets used every day should put them.
 */
export interface QueryCategory {
  /** Stored on the dispute, and what every report groups by. Never change one without migrating. */
  value: string
  /** The kinds of thing that belong here, in the collector's words. */
  examples: string
}

export const QUERY_CATEGORIES: QueryCategory[] = [
  { value: 'Amount dispute', examples: 'Incorrect balance, fees, interest, missing payment' },
  { value: 'Product/service dispute', examples: 'Defective, not delivered, incomplete service' },
  { value: 'Liability dispute', examples: 'Wrong debtor, no contract, fraud, no surety' },
  { value: 'Payment query', examples: 'Paid, partially paid, proof submitted' },
  { value: 'Contract/cancellation', examples: 'Cancelled, renewal, notice period' },
  { value: 'Information request', examples: 'Invoice, statement, contract, breakdown' },
  { value: 'Legal/status issue', examples: 'Prescription, debt review, liquidation' },
  { value: 'Third-party payment', examples: 'Insurance, medical aid, employer' },
  { value: 'Administrative query', examples: 'Wrong contact details, communication preference' },
  { value: 'Other', examples: 'Anything the list above does not cover — say what it is' },
]

/** The one category that will not carry itself: "Other" says nothing without the words. */
export const CATEGORY_NEEDING_EXPLANATION = 'Other'

/**
 * How much explanation "Other" has to come with.
 *
 * Long enough that "n/a", "see notes" and a stray keystroke do not pass, short enough that a
 * real sentence always does. A category that means "not one of the nine" is worthless to anyone
 * reading it later unless the words say what it actually was.
 */
export const EXPLANATION_MIN_LENGTH = 15

export function explanationMissing(category: string | null | undefined, description: string): boolean {
  return category === CATEGORY_NEEDING_EXPLANATION && description.trim().length < EXPLANATION_MIN_LENGTH
}

export function categoryExamples(value: string | null | undefined): string | null {
  return QUERY_CATEGORIES.find((c) => c.value === value)?.examples ?? null
}
