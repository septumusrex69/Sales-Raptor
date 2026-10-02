/**
 * A TRACE IS AN ATTEMPT, AND AN ATTEMPT CAN BE SPENT.
 *
 * THE FIRM, on what should happen when a debtor cannot be found: "if we've worked through an
 * entire trace, it should mention that the entire trace has been worked through. There should be
 * an option to upload a new trace or to rework the trace... you've worked once through the entire
 * trace, now trying again." And on the limit: "if an individual has worked through a trace twice,
 * it could go to the next person."
 *
 * WHAT WAS THERE WAS A COUNT THAT WENT QUIET. The account showed "12 findings nobody has tried
 * yet", and when the last one was answered the line simply DISAPPEARED. Silence reads as nothing
 * happened, not as finished -- which is the opposite of the fact it was hiding, and the fact a
 * team leader most needs.
 *
 * ------------------------------------------------------------------------------------------------
 * THREE STATES, AND THE THIRD IS THE ONE THAT MATTERS
 * ------------------------------------------------------------------------------------------------
 *
 *   working         somebody is going down the list. "4 of 11 tried."
 *   worked_through  every number, email and linked person on it has an outcome.
 *   spent           worked through, and NOTHING ON IT REACHED THE DEBTOR.
 *
 * Worked through and spent are not the same claim and must not be collapsed. A trace that was
 * worked through and produced a live number is a trace that did its job; one that was worked
 * through and produced nothing is the firm's money gone and a debtor still missing, which is what
 * a second search, a re-work, or somebody else's desk is for.
 *
 * ------------------------------------------------------------------------------------------------
 * DERIVED, NEVER STORED
 * ------------------------------------------------------------------------------------------------
 *
 * Every one of these is a reading of the findings as they stand. A stored flag would need a job to
 * maintain it, and a night the job does not run is a night the account lies about whether anybody
 * has tried -- the same reasoning `isMissed` and the diary's carry-over already carry.
 *
 * PURE: no database, no clock. It takes the findings and answers questions about them.
 */
import { PHONE_KINDS_FOR_ROUND, type TraceItem } from './traceStore.ts'

/** What state a round is in. */
export type RoundState = 'working' | 'worked_through' | 'spent'

export interface TraceRound {
  state: RoundState
  /** Findings somebody could try: numbers, emails, linked people. */
  workable: number
  /** How many of those carry an outcome. */
  tried: number
  /** True where any number or email reached the DEBTOR. */
  reachedDebtor: boolean
  /**
   * True where somebody answered who was not the debtor.
   *
   * REPORTED SEPARATELY, because it is neither success nor nothing. A spouse who takes a message
   * is a live line and a person who knows them -- worth saying out loud on a round that otherwise
   * reads as wasted, and not worth calling a result.
   */
  reachedSomeone: boolean
  /**
   * Numbers that rang out and nobody answered.
   *
   * THE FIRM'S OWN DISTINCTION, and the reason re-working a trace is a real option rather than a
   * euphemism for doing it again: "you couldn't make contact, but it was ringing or the phone was
   * off." A line that rings is alive and worth another hour of the day; a dead one is not.
   */
  liveUntried: number
}

/**
 * WHICH FINDINGS COUNT AS WORK.
 *
 * Numbers, emails and linked people -- the three a person can go down a list and TRY in an
 * afternoon. Addresses and employers are deliberately out: an address is confirmed by a letter
 * coming back or by somebody going there, and a trace that could never read as finished until
 * something had been posted would read as unfinished for ever. Same list traceSummary counts for
 * `untried`, and it has to stay the same list or the two would disagree about whether a trace is
 * done.
 */
const workableItem = (i: TraceItem): boolean =>
  PHONE_KINDS_FOR_ROUND.includes(i.kind) || i.kind === 'email' || i.kind === 'link'

export function traceRound(items: readonly TraceItem[]): TraceRound {
  const workable = items.filter(workableItem)
  const tried = workable.filter((i) => i.outcome !== null)
  /*
   * REACHING THE DEBTOR IS `verified` ON SOMETHING THAT CARRIES THEM, and a linked person cannot.
   * OUTCOMES_FOR does not even offer `verified` on that list -- the firm asked for it to be left
   * off, because reaching the debtor on a relative's number almost never happens. Tested here as
   * well rather than trusted, because this decides whether a round is spent.
   */
  const reachedDebtor = workable.some(
    (i) => i.outcome === 'verified' && i.kind !== 'link',
  )
  const reachedSomeone = workable.some((i) => i.outcome === 'reached_other')
  const liveUntried = workable.filter((i) => i.outcome === 'no_answer').length

  /* NOTHING TO WORK IS NOT A FINISHED ROUND. A bureau profile that came back with no numbers at
     all has not been worked through -- there was nothing to work -- and calling it spent would
     start the clock towards somebody else's desk on a search nobody could act on. */
  const state: RoundState = workable.length === 0 ? 'working'
    : tried.length < workable.length ? 'working'
      : reachedDebtor ? 'worked_through' : 'spent'

  return {
    state,
    workable: workable.length,
    tried: tried.length,
    reachedDebtor,
    reachedSomeone,
    liveUntried,
  }
}

/**
 * WHETHER THERE IS ANYTHING LEFT TO RE-WORK.
 *
 * Only a number that RANG. The firm: "there should be an option to upload a new trace or to rework
 * the trace." Those are two different jobs and only one of them costs the debtor anything -- a new
 * trace is a fresh bureau search under item 4(c), while ringing a number that rang out before is
 * not a search at all and the calls are already charged under item 2.
 *
 * SO IT IS OFFERED ONLY WHERE IT WOULD DO SOMETHING. A spent round of disconnected lines and wrong
 * numbers has nothing to try again, and a button that re-opens a list of dead numbers is a button
 * that teaches people the feature is pointless.
 */
export function canRework(items: readonly TraceItem[]): boolean {
  return traceRound(items).liveUntried > 0
}

/**
 * HOW A ROUND READS, IN ONE LINE.
 *
 * THE SENTENCE THE FIRM ASKED FOR -- "it should mention that the entire trace has been worked
 * through" -- and the three states say three genuinely different things rather than one sentence
 * with a number swapped in.
 *
 * SPENT SAYS SO PLAINLY. This is the firm's money gone and a debtor still missing; a gentle phrase
 * here would be the screen declining to report the thing it was built to report.
 */
export function roundLine(r: TraceRound): string {
  if (r.state === 'working') {
    if (r.workable === 0) return 'Nothing on this report to ring.'
    return `${r.tried} of ${r.workable} tried.`
  }
  if (r.state === 'worked_through') {
    return `Worked through — all ${r.workable} tried, and the debtor was reached.`
  }
  /* SPENT. What was tried, and what it came to. */
  const got = r.reachedSomeone
    ? ' Somebody answered, but not the debtor.'
    : ''
  const left = r.liveUntried > 0
    ? ` ${r.liveUntried} ${r.liveUntried === 1 ? 'number rang' : 'numbers rang'} and could be tried again.`
    : ''
  return `Worked through — all ${r.workable} tried, and none of it reached the debtor.${got}${left}`
}
