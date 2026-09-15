/**
 * What a collector is trusted with.
 *
 * THE FIRM ONLY EARNS ON WHAT IT RECOVERS, and it carries its clients' reputation while doing
 * it. That is the whole reason this file exists: a R400 000 defended matter on a junior's desk
 * is not a training opportunity, it is a client relationship and a year's commission.
 *
 * Four grades, and a band on every account derived from what the account already is. Nobody
 * types a difficulty in — a number that has to be maintained by hand is a number that is right
 * on the day it is set and wrong for ever afterwards.
 *
 * GRADE IS ABOUT WHICH ACCOUNTS, NEVER HOW MANY. A junior and an elite collector carry the same
 * book and work the same number of days: the company standard is 500 accounts and 50 a day for
 * everybody. What the grade changes is which of those 500 they may be given. Individual people
 * differ — some carry more, some work more in a day — and that is what the per-person overrides
 * are for, not the grade.
 *
 * GRADE IS SET BY A PERSON, NEVER COMPUTED. The collector's dashboard can show that somebody's
 * numbers look like a Skilled collector's; a team leader decides. One large settlement is not a
 * promotion, and it is an employment matter besides.
 */

export const COLLECTOR_GRADES = ['Junior', 'Skilled', 'Senior', 'Elite'] as const
export type CollectorGrade = (typeof COLLECTOR_GRADES)[number]

/** Higher reaches further. Used only for "may this person take this account". */
export function gradeRank(grade: CollectorGrade): number {
  return COLLECTOR_GRADES.indexOf(grade)
}

export type AccountBandId = 'generic' | 'high_value' | 'major'

export interface AccountBand {
  id: AccountBandId
  label: string
  /** Capital outstanding at or above this figure falls in this band. */
  from: number
  /** The least experienced collector who may be given one. */
  minGrade: CollectorGrade
  hint: string
}

/**
 * The bands, in the firm's own figures.
 *
 * AN ABSOLUTE LINE, not one relative to each client's book. That was considered and is wrong:
 * the firm's real book runs to nearly a billion rand with single accounts reaching R27 million,
 * and it is distributed evenly across collectors on purpose — which is how a junior's ability
 * shows up on the small accounts before anybody trusts them with a large one. A threshold that
 * floated with each client's median would make the top of a gym-membership book "high value" and
 * put R4 000 accounts in front of an elite collector.
 *
 * Ordered low to high. The band is the LAST one whose `from` the balance meets, so adding a
 * fourth rung later is a line in this array and nothing else.
 */
export const ACCOUNT_BANDS: AccountBand[] = [
  {
    id: 'generic',
    label: 'Generic',
    from: 0,
    minGrade: 'Junior',
    hint: 'Ordinary collection work. The bulk of any book, and where a new collector proves themselves.',
  },
  {
    id: 'high_value',
    label: 'High value',
    from: 25000,
    minGrade: 'Skilled',
    hint: 'Worth enough that how the call is handled changes the outcome.',
  },
  {
    id: 'major',
    label: 'Major',
    from: 50000,
    minGrade: 'Senior',
    hint: 'Needs judgement and experience. The firm’s commission and the client’s reputation both ride on these.',
  },
]

export interface BandInput {
  /** Capital still outstanding. What is actually at stake, not what was handed over. */
  capitalOutstanding: number
  /** The account's position, where it is known. Some positions outrank the balance entirely. */
  disputed?: boolean
  inLegal?: boolean
  underAdministration?: boolean
}

/**
 * Which band an account falls in.
 *
 * THE BALANCE IS NOT THE ONLY THING. A defended matter is a legal conversation at R2 000 as much
 * as at R200 000 — the debtor has engaged a position, somebody has to answer it in writing, and
 * getting it wrong is how a dispute becomes a counterclaim. Same for anything in legal or under
 * administration: those are conversations with attorneys, curators and trustees, not with a
 * debtor, and they are not junior work at any value.
 *
 * So a hard position lifts the account at least to High value, and the balance may lift it
 * further. Neither ever lowers it.
 */
export function accountBand(input: BandInput): AccountBand {
  let band = ACCOUNT_BANDS[0]
  for (const b of ACCOUNT_BANDS) {
    if (input.capitalOutstanding >= b.from) band = b
  }

  if (input.disputed || input.inLegal || input.underAdministration) {
    const floor = ACCOUNT_BANDS.find((b) => b.id === 'high_value')
    if (floor && gradeRank(floor.minGrade) > gradeRank(band.minGrade)) band = floor
  }
  return band
}

/** May this collector be given this account? */
export function mayTake(grade: CollectorGrade, band: AccountBand): boolean {
  return gradeRank(grade) >= gradeRank(band.minGrade)
}

/**
 * Roles that work a collections book.
 *
 * A GRADE IS NOT A PREREQUISITE FOR RECEIVING WORK, and treating it as one was a mistake. It
 * meant nobody could be handed an account until an administrator had graded them one by one --
 * so a firm with thirty pre-legal clerks had thirty ungraded people and a hand-out screen that
 * offered nobody. The grade WIDENS what somebody may be given; it does not admit them.
 *
 * Ungraded therefore means Junior: generic accounts, which is the bulk of any book and where a
 * new collector proves themselves anyway. A team leader raises it when they have seen the work.
 */
export const COLLECTING_ROLES = [
  'Pre-legal Agent', 'Pre-legal Team Leader', 'Liaison', 'Liaison Manager',
]

/** What an ungraded collector may be given. The lowest rung, never nothing. */
export const UNGRADED_EQUIVALENT: CollectorGrade = 'Junior'

/* ---------- the company standards ---------- */

/**
 * The most accounts one collector should carry at once, in play.
 *
 * The firm's own figure: "on average, a collector can manage about 500 accounts, but there are
 * exceptions". The exceptions are the per-person override on profiles.book_ceiling; this is what
 * applies until somebody sets one.
 *
 * Flat across every grade, deliberately. A junior does not carry a smaller book than an elite —
 * they carry a different KIND of account out of the same 500.
 */
export const DEFAULT_BOOK_CEILING = 500

/**
 * How many of a day's slots are held for work handed to this person.
 *
 * The firm's rule: a clerk who can work 45 a day may only diarise 35 of them himself, so there
 * is always room for what a team leader sends. It constrains the agent's OWN booking only — the
 * distributor fills to the full capacity — which is what keeps the two sides from having to know
 * about each other.
 */
export const DEFAULT_DIARY_RESERVE = 10

/** A number is a typo when it is not a working rate. Same reasoning as the capacity bounds. */
export const MIN_BOOK_CEILING = 1
export const MAX_BOOK_CEILING = 5000

export const bookCeilingOf = (set: number | null | undefined): number =>
  set && set > 0 ? set : DEFAULT_BOOK_CEILING

export const diaryReserveOf = (set: number | null | undefined): number =>
  set === null || set === undefined || set < 0 ? DEFAULT_DIARY_RESERVE : set

/**
 * How many a person may diarise for THEMSELVES on a given day.
 *
 * Never below one. A reserve larger than the capacity would otherwise say "you may book nothing
 * today", which is not a rule anybody meant and would read as the diary being broken.
 */
export function selfBookingLimit(capacity: number, reserve: number): number {
  return Math.max(1, capacity - reserve)
}
