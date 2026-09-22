/**
 * What date of default to open an account on when the client's is in the future.
 *
 * THE FIRM: "for the date of default, just say that it can be accepted, but when it's accepted it
 * will be minimum 30 days before handover. Let's make it default three months before handover.
 * However, still send a notification and make a note for the client, send it to the
 * communications department, and make a note on the system."
 *
 * THIS REPLACED A REFUSAL, and the reasoning that refusal rested on has not gone away -- in
 * duplum, prescription and interest are all measured from this date, so an account opened on a
 * guessed one is wrong in three directions from its first day. What changed is who carries that:
 * a refusal put the whole row back on the client and stopped the work, and the firm would rather
 * open the account, work it, and settle the date alongside. So the guess is deliberate, it is
 * conservative, and it is never silent -- it is written on the account, raised with the client,
 * and told to Communications.
 *
 * WHY THREE MONTHS AND NOT THE DAY IT ARRIVED. The guess has to be conservative in the DEBTOR's
 * favour and against the firm's, because every clock it starts runs against the debtor:
 *
 *   - INTEREST runs from it, so a later date charges the debtor less, not more.
 *   - IN DUPLUM is measured from default, and a later date means the ceiling binds sooner.
 *   - PRESCRIPTION runs from it, so a later date is the SAFER end for the firm to be wrong at --
 *     three months back cannot make a live debt look prescribed, where three years back could.
 *
 * A date close to the handover is therefore the cautious end, and thirty days is the floor: a
 * debt handed over the same week it fell due is not one anybody hands over, and a substitute
 * inside a month would read as the handover date wearing another name.
 */

/** Never nearer to the handover than this. The floor the firm named. */
export const MIN_DAYS_BEFORE_HANDOVER = 30

/** What it defaults to, absent anything better. The firm's own figure. */
export const MONTHS_BEFORE_HANDOVER = 3

const parse = (iso: string): Date => new Date(`${iso.slice(0, 10)}T00:00:00Z`)
const out = (d: Date): string => d.toISOString().slice(0, 10)

/**
 * The substitute, from the day the handover came in.
 *
 * MONTH ARITHMETIC, NOT NINETY DAYS, so the answer lands on the same day of the month somebody
 * can recognise. Where that day does not exist -- 31 May back three months is 31 February -- it
 * falls to the last day of the shorter month rather than rolling into the next one, which is what
 * setUTCMonth does on its own and would put a "three months before" date only two months back.
 */
export function substituteDefaultDate(
  handedOverOn: string,
  /*
   * HOW FAR BACK, A PARAMETER RATHER THAN THE CONSTANT READ DIRECTLY -- and that exists so the
   * floor below can be TESTED. Three months always clears thirty days, so with the default the
   * clamp can never fire, and a check over a year of handover dates passed with the clamp
   * deleted. A rule nothing can reach is decoration; this is what lets a check shorten the
   * default and watch the floor hold.
   */
  monthsBack: number = MONTHS_BEFORE_HANDOVER,
): string {
  const from = parse(handedOverOn)
  const day = from.getUTCDate()
  const d = new Date(from)
  /* To the 1st first: setUTCMonth on the 31st silently rolls forward past a shorter month. */
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - monthsBack)
  const lastOfThatMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastOfThatMonth))

  /*
   * AND THE FLOOR, applied afterwards rather than assumed. Three months always clears thirty days
   * today -- but the floor is the rule the firm stated and the three months is the default they
   * chose, and a default somebody later shortens must not quietly cross the rule.
   */
  const floor = new Date(from)
  floor.setUTCDate(floor.getUTCDate() - MIN_DAYS_BEFORE_HANDOVER)
  return out(d > floor ? floor : d)
}

/**
 * What the row says about it, for the screen, the client's email and the account's own note.
 *
 * ONE SENTENCE CARRYING BOTH DATES. The one the client sent is what they have to correct, and the
 * one we opened on is what every figure on the account is now being calculated from -- a message
 * naming only one of them leaves somebody unable to check the other.
 */
export function substitutionMessage(sheetSaid: string, openedOn: string): string {
  return `The date of default is in the future. Opened at ${openedOn} instead — `
    + `${MONTHS_BEFORE_HANDOVER} months before handover — and the client must confirm the real `
    + `one. Their sheet says ${sheetSaid}.`
}

/**
 * The same substitute, where the sheet gave no date at all or gave one nobody can read.
 *
 * THE FIRM: "it should also show you in a rejection state, but I have an option to accept it --
 * kind of like a warning -- and then make it three months before the handover. Not having the
 * date of default is not a deal breaker for starting to work the account, but it would be good to
 * confirm it. Make it three months, because most of the clients hand over on 90 days."
 *
 * SO THE 90 DAYS ARE NOT A GUESS DRESSED UP. They are the firm's own observation about how its
 * clients behave, which is a better estimate than any date the row carries -- and it is the same
 * three months the future-date case already substitutes, because it is the same question asked
 * from the other end.
 *
 * THE DIAGNOSIS IS KEPT, not replaced. "There is no 31 February" is what tells somebody the cell
 * is a typo rather than a missing figure, and it is the sentence the client needs quoted back at
 * them. What is added is what we opened on in the meantime.
 */
export function missingDateMessage(why: string, openedOn: string): string {
  return `${why} Opened at ${openedOn} instead — ${MONTHS_BEFORE_HANDOVER} months before `
    + 'handover, which is when most clients hand over — and the client must confirm the real one.'
}
