/**
 * THE ADDRESS WAS WRONG, SO THE DEMAND NEVER LANDED. OFFER TO ISSUE IT AGAIN.
 *
 * THE FIRM: "when you've changed the primary email address, it should ask you, do you want to
 * restart the Section 129 process? And if you say yes, it restarts the Section 129 process in the
 * workflow. It still shows that the previous workflow went out to the wrong email address. Then the
 * email address was changed and now the new workflow is going out."
 *
 * ------------------------------------------------------------------------------------------------
 * EVERY PIECE OF THIS ALREADY EXISTED EXCEPT THE QUESTION
 * ------------------------------------------------------------------------------------------------
 *
 * `workflow_step_not_served` marks a notice as never delivered and unlocks `reissue_allowed`;
 * `api/workflow/start` honours that flag against the once-per-account-and-version rule; the step
 * stays `sent` so the file reads "went to the wrong address on the 1st, re-issued on the 8th". What
 * was missing is that somebody had to KNOW to do all three, in that order, on a panel they were not
 * looking at. The moment they do know is the moment they correct the address -- so that is where
 * the question belongs.
 *
 * ------------------------------------------------------------------------------------------------
 * ASKED, NEVER DONE
 * ------------------------------------------------------------------------------------------------
 *
 * `markStepNotServed` says, in as many words, that it must never be a side effect of correcting an
 * address: "a debtor can have three email addresses and a collector tidying a contact record is not
 * a finding that service failed; if editing the address did this, the firm would be re-serving
 * debtors every time somebody fixed a typo." That still holds and this does not break it. A typo
 * corrected gets a question and one press of "No"; what changes is that the person who knows the
 * answer is asked at the one moment they have it.
 *
 * ------------------------------------------------------------------------------------------------
 * IT IS OFFERED ONLY ON A NOTICE THAT WENT TO THE ADDRESS BEING REPLACED
 * ------------------------------------------------------------------------------------------------
 *
 * Which is the whole of the test, and it is narrower than "this account has a workflow". Changing
 * an address the section 129 did not go to says nothing about whether the section 129 was served --
 * and on a real account the sequence can have run partly to one address and partly to another (the
 * book has one: the demand to promise@..., the final notice to stephan@...). So the comparison is
 * against what the step actually went to, which `account_emails.workflow_step_id` records.
 *
 * PURE: no database, no clock, no network. Its shapes are structural so AccountRun satisfies them
 * without this file importing the Supabase client -- the same split as runSteps.ts beside
 * accountRun.ts.
 */

/** What this rule needs of a step. A RunStep satisfies it. */
export interface ReissuableStep {
  id: string
  label: string
  /** 'email', 'sms', 'letter'. Only an email carries an address this can match on. */
  channel: string | null
  state: string
  sentAt: string | null
  /** The address it actually went to, off account_emails. Null on anything not emailed. */
  sentTo: string | null
  notServedAt: string | null
}

/** What this rule needs of a run. An AccountRun satisfies it. */
export interface ReissuableRun {
  id: string
  /** The version to start again. Null where the run predates this being carried. */
  versionId: string | null
  workflowName: string
  /** `by_hand`, `allocated`, `dispute`. Only the first can be started again -- see below. */
  triggerKind: string | null
  steps: readonly ReissuableStep[]
}

export interface Reissue {
  runId: string
  versionId: string
  workflowName: string
  stepId: string
  stepLabel: string
  /** The address it went to, as it was sent. */
  sentTo: string
  sentAt: string | null
}

/**
 * ONE ADDRESS IS THE SAME AS ANOTHER WHEN IT REACHES THE SAME MAILBOX.
 *
 * Compared case-insensitively and trimmed, because a collector retyping an address in capitals has
 * not changed where it goes -- and asking whether to re-serve a statutory demand because somebody
 * capitalised a surname is the "warning that fires when nothing is wrong" this codebase refuses to
 * ship. The domain is case-insensitive by the RFC and every mail host treats the local part that
 * way too.
 */
export const sameAddress = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

/**
 * WHICH NOTICE TO OFFER ISSUING AGAIN, OR NULL.
 *
 * NULL IS THE ORDINARY ANSWER and it has to stay that way: most address edits are typos on
 * accounts with no sequence running, and a box that opens on every one of them is a box people
 * learn to dismiss without reading -- at which point it is worse than not having it, because the
 * one time it matters it is dismissed too.
 */
export function noticeToReissue(input: {
  /** The address as it was before the edit. */
  before: string | null
  /** The address as it is now. */
  after: string | null
  runs: readonly ReissuableRun[]
}): Reissue | null {
  const before = (input.before ?? '').trim()
  const after = (input.after ?? '').trim()
  /* NOTHING CHANGED, so nothing is asked. A label edit, a re-save, a change of capitalisation. */
  if (!before || !after) return null
  if (sameAddress(before, after)) return null

  const offers: Reissue[] = []
  for (const run of input.runs) {
    /*
     * ONLY A SEQUENCE A PERSON STARTS.
     *
     * `api/workflow/start` refuses anything else outright -- a workflow that starts on an event
     * starts itself -- so offering to re-issue a handover run would be a question whose Yes the
     * server then declines. It is also the right line on the merits: the clock this protects is a
     * statutory one, and the handover notices are the firm introducing itself.
     */
    if (run.triggerKind !== 'by_hand') continue
    if (!run.versionId) continue
    for (const step of run.steps) {
      if (step.channel !== 'email') continue
      if (step.state !== 'sent') continue
      /* ALREADY SAID TO HAVE FAILED. The run is unlocked and the panel says so; asking again
         would offer a second re-issue of a sequence already waiting to be re-issued. */
      if (step.notServedAt) continue
      /* AND IT MUST HAVE GONE TO THE ADDRESS BEING REPLACED. See the header: a sequence can run
         partly to one address and partly to another, and only the notices that went to the old
         one are in doubt. */
      if (!sameAddress(step.sentTo, before)) continue
      offers.push({
        runId: run.id,
        versionId: run.versionId,
        workflowName: run.workflowName,
        stepId: step.id,
        stepLabel: step.label,
        sentTo: (step.sentTo ?? '').trim(),
        sentAt: step.sentAt,
      })
    }
  }
  if (offers.length === 0) return null
  /*
   * THE EARLIEST ONE, WHICH IS THE ONE THAT STARTED THE CLOCK.
   *
   * A sequence that ran to a wrong address sent several things to it, and the one that matters is
   * the FIRST -- the demand every interval after it is counted from. Marking that one is what
   * makes the whole run re-issuable, and marking a later one would say the sequence was good up to
   * day 12 when the debtor never saw day 1.
   *
   * A step with no sent_at sorts last rather than first: it is a row we know less about, not an
   * older one, and it must not outrank a notice with a real date on it.
   */
  offers.sort((a, b) => {
    if (a.sentAt === b.sentAt) return 0
    if (!a.sentAt) return 1
    if (!b.sentAt) return -1
    return a.sentAt < b.sentAt ? -1 : 1
  })
  return offers[0]
}

/**
 * WHAT GOES ON THE RECORD AS THE REASON, in the firm's words rather than a code.
 *
 * IT NAMES THE ADDRESS. "The address belongs to somebody else" is one of the four reasons the
 * panel offers by hand, and it is true here but thin: eighteen months later the question is which
 * address, and the run only knows what it sent to, not what it was replaced with. Both are in the
 * sentence, so the file answers it without anybody cross-reading two screens.
 */
export function reissueReason(from: string, to: string): string {
  return `The address was corrected from ${from.trim()} to ${to.trim()}, so this did not reach them.`
}
