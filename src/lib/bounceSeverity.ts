/**
 * IS THIS BOUNCE "THERE IS NO SUCH ADDRESS", OR "TRY AGAIN LATER"?
 *
 * THE FIRM, on a handover notice that went to an address the debtor never had: "if someone had
 * the wrong email address and a workflow already started, then we need to get the right email
 * address and send the workflow again — they've basically only been served a new notice."
 *
 * THAT IS A HARD BOUNCE'S JOB TO TELL US. A notice that was never delivered was never served, and
 * `reissue_allowed` already exists for exactly that reasoning: "the first demand was defective and
 * the clock it started was never good — so a fresh sequence is one clock, not two."
 *
 * AND A SOFT BOUNCE MUST NOT TRIGGER ANY OF IT. A full mailbox, a greylisted first attempt, a
 * server down for an hour — the address is real and the notice may well arrive on the retry.
 * Treating those as "never served" would void a perfectly good statutory demand and restart a
 * clock that was already running, which is the expensive direction to be wrong in.
 *
 * SO THE DEFAULT IS SOFT, ALWAYS. Anything this cannot read confidently comes back `unknown`, the
 * caller does nothing automatic, and a person decides. Being slow is a nuisance; voiding a notice
 * that did arrive is a defective demand.
 *
 * ------------------------------------------------------------------------------------------
 * WHAT IT READS
 * ------------------------------------------------------------------------------------------
 *
 * RFC 3464 puts a machine-readable part in every proper bounce, and RFC 3463 gives it a status
 * code whose FIRST DIGIT is the whole answer:
 *
 *     Status: 5.1.1     permanent — no such user           hard
 *     Status: 4.2.2     persistent transient — mailbox full soft
 *
 * `Action: failed` beside a 4.x.x still means failed FOR NOW; the class digit outranks it, which
 * is why the action is read second and only where there is no status at all.
 *
 * Pure, and it takes TEXT rather than a parsed message: the status lives in a message/
 * delivery-status part of a multipart report, and which part that is depends on the sending
 * server. Searching the whole body is both simpler and more tolerant than walking the parts, and
 * the pattern is specific enough that a status line in ordinary prose would be a remarkable
 * coincidence.
 */

export type BounceSeverity = 'hard' | 'soft' | 'unknown'

/**
 * THE STATUS LINE, ANYWHERE IN THE REPORT.
 *
 * Anchored to the start of a line so that "Status: 5.1.1" quoted inside a sentence of English
 * does not count, and tolerant of the spacing servers actually use.
 */
const STATUS = /^\s*status\s*:\s*([245])\.\d{1,3}\.\d{1,3}\s*$/im

/** The other half of RFC 3464, read only where there is no status code to read. */
const ACTION = /^\s*action\s*:\s*(failed|delayed|delivered|relayed|expanded)\s*$/im

export function bounceSeverity(body: string | null | undefined): BounceSeverity {
  const text = body ?? ''
  if (!text.trim()) return 'unknown'

  /*
   * THE FIRST STATUS WINS, and that is deliberate: a report about several recipients lists one
   * per recipient, and our notice went to exactly one address. A later 4.x.x about some other
   * address on a multi-recipient relay must not downgrade a 5.x.x about ours.
   */
  const status = STATUS.exec(text)
  if (status) {
    if (status[1] === '5') return 'hard'
    if (status[1] === '4') return 'soft'
    /* 2.x.x is a SUCCESS report -- a delivery receipt, not a bounce at all. Whoever called this
       thought it was one, so say the one honest thing: nothing here says it failed. */
    return 'soft'
  }

  /*
   * NO STATUS CODE, SO THE ACTION, and only `delayed` is worth acting on: it is unambiguous and
   * it is soft. A bare `failed` with no class digit does NOT become hard -- plenty of servers
   * write `Action: failed` on a temporary refusal, and the whole point of this file is that
   * guessing hard is the expensive mistake.
   */
  const action = ACTION.exec(text)
  if (action && action[1].toLowerCase() === 'delayed') return 'soft'

  return 'unknown'
}

/**
 * Should this bounce, on its own, mark the notice as never served?
 *
 * ONE FUNCTION RATHER THAN EVERY CALLER COMPARING TO 'hard', because the rule is "only a hard
 * bounce acts by itself" and a caller writing `!== 'soft'` would make `unknown` act too. The
 * difference is a notice voided on a bounce nobody could read.
 */
export const actsOnItsOwn = (severity: BounceSeverity): boolean => severity === 'hard'
