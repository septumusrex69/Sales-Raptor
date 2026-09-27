/**
 * WHAT A PRESS THAT STARTS A WORKFLOW ACTUALLY DOES, IN WORDS, AND WHEN.
 *
 * THE FIRM STARTED THE SECTION 129 AND NOTHING WENT OUT: "it said it started, but when is it
 * going to send out the SMS and the letter? I thought it does that immediately." They were reading
 * a button that had told them, in so many words, "the first step goes out now" -- and it did not,
 * because they pressed it on a Sunday.
 *
 * THE SEQUENCE WAS RIGHT AND THE SENTENCE WAS WRONG, which is worth being precise about, because
 * the fix is not to make it send. The section 129 sequence counts in BUSINESS days, `landsOn`
 * normalises a start that lands on a weekend forward to the Monday, and day 1 of that chart IS the
 * demand -- so a run started on Sunday has its first step dated Monday and the release guard
 * refuses a step before its `due_on` on purpose: "sent early" on a statutory interval is a
 * misrepresentation. Sending on the Sunday to satisfy the sentence would break the one rule the
 * dates exist to keep.
 *
 * SO THE PRESS SAYS WHEN. This is the arithmetic and the wording, in one place, because the button
 * in the account's action row and the card on the Workflow tab both make the same promise and a
 * promise written twice is a promise that drifts.
 */
import { landsOn, type DayUnit } from './workflowBuilder.ts'
import { shortDate } from './dateLabels.ts'

/** Mon-Sat-Sun, for a sentence that names a date somebody has to recognise as a working day. */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function weekdayName(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? ''
}

/**
 * THE DAY THE FIRST NOTICE WOULD ACTUALLY GO, if the run were started today.
 *
 * `firstDay` is the lowest day number on the version's chart -- normally 1 on a business-day
 * sequence and 0 on a calendar one, but read off the nodes rather than assumed, because a version
 * whose first step is day 3 must not be described as going out today.
 *
 * THE SAME `landsOn` THE PLANNER USES. Written out again here it would be a second opinion about
 * the same date, and the failure would be a button that promises Monday for a notice the planner
 * dates Tuesday.
 */
export function firstStepOn(today: string, firstDay: number, unit: DayUnit): string {
  return landsOn(today, firstDay, unit)
}

/**
 * THE SENTENCE UNDER "START THIS?", WHICH HAS TO BE TRUE ON A SUNDAY AS WELL.
 *
 * THREE READINGS, AND EACH ONE IS A DIFFERENT FACT rather than a softer wording of the same one:
 *
 *   - IT GOES NOW. The press is the issuing, which is what the firm asked for -- "the moment the
 *     section 129 is sent out via email, that is when the workflow is triggered."
 *   - THE OFFICE IS SHUT. Today is a weekend or a public holiday, so day 1 of a business-day
 *     chart is the next working day and that is when the demand goes. Said with the DATE in it:
 *     "not today" is the complaint the firm already made, and a date is the answer to it.
 *   - THE CHART STARTS LATER. A version whose first step is not its first day. Rare, and it must
 *     not be described as either of the two above.
 */
export function startSentence(
  today: string, goesOn: string, unit: DayUnit, needsRelease = false,
): string {
  if (goesOn <= today) {
    return 'The first step goes out now, and everything after it is dated from today. '
      + 'Later steps that say something has already happened still wait for you.'
  }
  const when = `${weekdayName(goesOn)} ${shortDate(goesOn)}`
  /*
   * AND WHAT HAPPENS ON THAT DAY, WHERE THE FIRST STEP WAITS FOR A PERSON.
   *
   * THIS PRESS LIFTS `needsRelease` FOR WHAT IS DUE TODAY, and on a day the office is shut nothing
   * is due -- so the sweep on the working day finds a statutory demand that waits for a person and
   * holds it for a press. Left unsaid, "it starts on Monday" reads as "it sends on Monday", which is
   * the same misreading this whole sentence exists to stop, moved three days along.
   */
  const then = needsRelease
    ? ' The demand itself waits for a person, so it will be on the account that morning to send.'
    : ''
  if (unit === 'business') {
    return `Nothing goes out today — the office is shut, and this sequence counts in business `
      + `days. It starts on ${when}, the first working day, and every step after it is counted `
      + `from there.${then}`
  }
  return `The first step of this sequence is dated ${when}, so nothing goes out today. `
    + `Everything after it is counted from today.${then}`
}

/**
 * THE WORKFLOW'S NAME, SHORT ENOUGH FOR THE ACTION ROW.
 *
 * THE FIRM PUT IT THERE: "I think 129, promise to pay and escalate is kind of like -- it's three
 * workflows actually, so they should be together." The row's buttons are two words at most and
 * the workflow is called "Section 129 / letter of demand", which would wrap the row onto a third
 * line on the iPad they work on.
 *
 * SPLIT ON THE SLASH, WHICH IS THE FIRM'S OWN "OR". Their names carry the alternative after it --
 * "Section 129 / letter of demand" is one notice with two names, not two things -- so the half
 * before it is the whole subject and dropping the other half loses nothing. Nothing else is
 * trimmed: a name with no slash in it is used as it stands, because guessing which words of
 * somebody else's title are surplus is how a button ends up saying something the Library does not.
 */
export function startShortLabel(name: string): string {
  const head = name.split('/')[0]?.trim() ?? ''
  return head.length > 0 ? head : name
}
