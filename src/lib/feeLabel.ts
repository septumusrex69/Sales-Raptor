/**
 * How a fee that covers more than one unit of work is written.
 *
 * Four bureau searches, or a three-segment SMS, are one row carrying a count. The count lives in
 * `segments` and nowhere else — a description that also spells it out produces "Credit bureau
 * search (XDS) x 4 ×4" the moment a second renderer joins in, which is exactly what happened.
 *
 * So: descriptions say WHAT was done, `segments` says HOW MANY, and this is the only place the
 * two are put together. The statement and the timeline both call it.
 *
 * The count is written plainly -- "Credit bureau search 4", not "×4". The firm's own reading:
 * a statement goes to a debtor, and a multiplication sign in the middle of a description invites
 * them to check the arithmetic instead of reading what was done.
 */
export function feeLabel(description: string, segments: number | undefined): string {
  return (segments ?? 1) > 1 ? `${description} ${segments}` : description
}
