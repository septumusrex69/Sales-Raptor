/**
 * THE WORKFLOW AN ACCOUNT IS IN, AS THE ACCOUNT SCREEN NEEDS TO SEE IT.
 *
 * The runner writes to `workflow_run_steps` every morning and nothing on any screen read it back.
 * A held step carried its reason -- "nothing on the account fills {{listing_reference}}" -- in a
 * column nobody opens, and the notification raised beside it pointed at an account page that
 * said nothing about it. A warning that sends somebody to a screen where the thing is not is
 * worse than no warning, for the same reason CLAUDE.md gives about warnings generally.
 *
 * READ DIRECTLY, NOT THROUGH AppStore. This is the collections side: AppStore holds the few
 * hundred sales rows a person edits, and the book is queried per account with the filters in the
 * database. One account's run is a handful of rows and belongs on that path.
 */
import { supabase } from './supabase'
import type { DayUnit } from './workflowBuilder.ts'
import { firstStepOn } from './workflowStart.ts'
import { todayIso } from './reminderTime.ts'
import type { RunStep, RunStepState } from './runSteps.ts'

/**
 * One time a sequence was stopped and let go again.
 *
 * HELD IS NOT LEFT. A run that LEFT cancelled everything still to come and will never send
 * another notice; a run that is HELD cancelled nothing and carries on where it stopped. The
 * difference is the whole of the firm's pause rule -- a promise broken after six weeks has to
 * find its sequence where it left it.
 */
export interface RunHold {
  id: string
  /** promise | dispute. They behave differently: a promise may hold a run once, ever. */
  cause: string
  reason: string
  startedOn: string
  /** Null while the hold is still on. */
  endedOn: string | null
  endedReason: string | null
}

export interface AccountRun {
  id: string
  workflowName: string
  /** running | held | finished | left -- and `leftReason` says which event took it out. */
  state: string
  leftReason: string | null
  startedOn: string
  dayUnit: DayUnit
  steps: RunStep[]
  /**
   * Every hold this run has had, oldest first.
   *
   * ALL OF THEM, not the live one. The screen's history reads back "paused / payment missed /
   * resumed" from these, and the clock adds them up -- so a run that has been held twice needs
   * both, not the last.
   */
  holds: RunHold[]
}

/**
 * Every run this account has been through, newest first.
 *
 * NOT ONLY THE LIVE ONE. "What did we send this debtor, and when?" is a question an attorney asks
 * eighteen months later, and a run that left on a promise is exactly the one somebody needs to
 * see when the promise breaks. The screen decides what to show; this does not decide it for them.
 */
export async function fetchAccountRuns(accountId: string): Promise<AccountRun[]> {
  const { data, error } = await supabase
    .from('workflow_runs')
    .select(`
      id, state, left_reason, started_on,
      workflow_versions!inner(day_unit, workflows!inner(name)),
      workflow_run_holds(id, cause, reason, started_on, ended_on, ended_reason),
      workflow_run_steps(id, due_on, state, note, sent_at, instalment_no,
        workflow_nodes!inner(label, channel, day, ordinal, needs_release, after_minutes))
    `)
    .eq('account_id', accountId)
    .order('started_on', { ascending: false })
  if (error) throw new Error(error.message)

  /* eslint-disable @typescript-eslint/no-explicit-any -- rows arrive as untyped JSON. */
  return (data ?? []).map((r: any) => ({
    id: r.id,
    workflowName: r.workflow_versions?.workflows?.name ?? 'Workflow',
    state: r.state,
    leftReason: r.left_reason ?? null,
    startedOn: r.started_on,
    dayUnit: (r.workflow_versions?.day_unit ?? 'calendar') as DayUnit,
    /*
     * ORDERED BY THE DATE IT LANDS ON, THEN BY THE DAY NUMBER, THEN BY THE NODE'S OWN ORDINAL.
     *
     * THE THIRD KEY IS THE ONE THAT MATTERS AND IT WAS MISSING. Not by the order PostgREST handed
     * them over, said the comment here -- but the two steps of a PAIR share a due date AND a day
     * number, so on exactly those two the comparison returned nought and the order was whatever
     * PostgREST felt like. The firm found all three ways that shows:
     *
     *   - the section 129's SMS drawn to the LEFT of the section 129 on the track;
     *   - the pair not collapsing into one dot at all, because noticesOf reads a follower before
     *     its lead as a step with nothing to follow -- so every step of the sequence drew twice;
     *   - and the panel opening on the follower, whose Send it now button cannot work while the
     *     message it refers to has not gone. They pressed it and were told nothing had changed.
     *
     * `ordinal` is the node column that has said which is which since the workflow was built.
     */
    steps: (r.workflow_run_steps ?? [])
      .map((s: any): RunStep => ({
        id: s.id,
        label: s.workflow_nodes?.label ?? 'Step',
        channel: s.workflow_nodes?.channel ?? null,
        day: s.workflow_nodes?.day ?? 0,
        ordinal: s.workflow_nodes?.ordinal ?? 0,
        /* Which instalment of the arrangement this one is about, or 0 on a step dated off the
           run. What tells four identical reminders apart -- see stepName in runSteps.ts. */
        instalmentNo: s.instalment_no ?? 0,
        needsRelease: Boolean(s.workflow_nodes?.needs_release),
        /* Null on a notice, a number on the SMS that goes out behind it. What pairs the two --
           see stepPairs.ts, and the runner's own use of it in step.ts. */
        afterMinutes: s.workflow_nodes?.after_minutes ?? null,
        dueOn: s.due_on,
        state: s.state as RunStepState,
        note: s.note ?? null,
        sentAt: s.sent_at ?? null,
      }))
      /* AND THE DAY NUMBER IS NO LONGER A TIE-BREAK WORTH HAVING ON AN INSTALMENT STEP, where it
         is a position on the chart rather than a date -- so the date leads, then the node's own
         ordinal, then the instalment. Two steps of one pair still share a date and are still
         separated by the ordinal, which is the fix this sort was written for. */
      .sort((a: RunStep, b: RunStep) => (
        a.dueOn.localeCompare(b.dueOn) || a.ordinal - b.ordinal || a.instalmentNo - b.instalmentNo
      )),
    /* OLDEST FIRST, which is the order the history reads in and the order the clock adds them
       up in. PostgREST hands an embed over in no order at all. */
    holds: (r.workflow_run_holds ?? [])
      .map((h: any): RunHold => ({
        id: h.id,
        cause: h.cause,
        reason: h.reason,
        startedOn: h.started_on,
        endedOn: h.ended_on ?? null,
        endedReason: h.ended_reason ?? null,
      }))
      .sort((a: RunHold, b: RunHold) => a.startedOn.localeCompare(b.startedOn)),
  }))
}

/**
 * SEND A HELD STEP NOW, because a person has looked at it and says it may go.
 *
 * THROUGH THE ENDPOINT, NOT BY WRITING THE ROW. Marking a step 'sent' from the browser would
 * mark it sent and send nothing -- the wording, the PDF, the fee and the Sent copy all happen on
 * the server, on the same path the morning run takes. The step's own state is the record of
 * something that reached a debtor, and the only thing entitled to write it is the thing that
 * reached them.
 */
export async function releaseStep(accessToken: string, stepId: string): Promise<{
  result: 'sent' | 'held' | 'stillHeld' | 'failed'
  note: string | null
}> {
  const res = await fetch('/api/workflow/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ stepId }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean; error?: string; result?: string; note?: string | null
  }
  if (!res.ok || !body.ok) throw new Error(body.error ?? 'The notice could not be sent.')
  return {
    result: (body.result ?? 'held') as 'sent' | 'held' | 'stillHeld' | 'failed',
    note: body.note ?? null,
  }
}

/**
 * ASK THE SERVER TO GET ON WITH THIS ACCOUNT'S WORKFLOW NOW.
 *
 * The allocation trigger creates the run the moment somebody is given an account, but the run has
 * no dates on it yet and nothing has been sent. Left to the daily sweep, an account allocated at
 * ten in the morning is introduced to the firm the following dawn -- and the handover is an email
 * followed by an SMS five to ten minutes later, which a once-a-day timer cannot express at all.
 *
 * FIRE AND FORGET, AND IT NEVER FAILS THE ALLOCATION. The account HAS been allocated; the
 * workflow will be picked up by the sweep regardless. Surfacing a network error here would tell
 * a team leader their allocation went wrong when it did not.
 *
 * ONE ACCOUNT. The endpoint refuses anything wider from a session -- only the timer sweeps the
 * book -- so a bulk allocation of five thousand is left to the sweep rather than setting off five
 * thousand calls from somebody's browser.
 */
export function nudgeWorkflows(accessToken: string, accountId: string): void {
  void fetch('/api/workflow/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ accountId }),
  }).catch(() => {
    /* Ignored on purpose -- see above. The sweep is the backstop. */
  })
}

/**
 * THE SAME NUDGE, FOR A RUN THAT NOBODY HANDED A TOKEN TO.
 *
 * `nudgeWorkflows` takes one because both its callers already have a session open in front of
 * them: the promise modal and the allocation screen. THE DISPUTE PATHS DO NOT. They are called
 * from a panel several components down that has never needed a session, and a rule that depends on
 * every future call site remembering to thread a token through is the rule that gets forgotten.
 *
 * IT ALREADY WAS. `workflow_start_on_dispute` creates the run in the database and nothing dated
 * it, so the firm marked a dispute received in writing and got a sequence with no steps in it:
 * "it also doesn't show me the steps for the dispute". Five nodes, nought steps, and the day-1
 * acknowledgement that should have gone to the debtor waiting for the six o'clock sweep the next
 * morning -- on a clock the firm gives the client ten business days on.
 *
 * SO THIS ONE ASKS FOR THE SESSION ITSELF. Same endpoint, same single account, same fire and
 * forget: the sweep is still the backstop, and a debtor's dispute must not fail to save because
 * the browser could not reach the API a moment later.
 */
export async function nudgeWorkflowsForAccount(accountId: string): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  /* No session is not an error here. Signed out, there is nothing to nudge WITH and nothing the
     caller could do about it; the sweep picks the run up either way. */
  if (token) nudgeWorkflows(token, accountId)
}

/**
 * THE WORKFLOWS A PERSON MAY START ON THIS ACCOUNT.
 *
 * Only the published ones that wait for a person -- `by_hand`. Everything else starts itself in
 * the database the moment its event happens, and offering to start one by hand would give an
 * account two runs of the same sequence.
 *
 * AND ONLY THE ONES IT HAS NOT BEEN THROUGH. The rule the allocation trigger states in SQL and
 * the start route enforces again: once per account and version, EVER, not merely once at a time.
 * A section 129 sequence begun twice on one account is two statutory clocks on one debt. Filtered
 * here as well so the button is not offered and then refused -- a button that appears to work and
 * does not is worse than one that is not there.
 *
 * WITH ONE NARROWING, AND IT IS NOT A HOLE IN THE RULE. A run whose DEMAND WAS DEFECTIVE may be
 * issued again: the firm upheld a dispute, the amount was corrected, and a section 129 that
 * stated a figure the firm has since conceded was wrong never started a good clock. So a fresh
 * sequence there is ONE clock, not two. `reissue_allowed` is set by the dispute trigger and by
 * nothing else; every other ending is final.
 *
 * ALL OF THEM, NOT ANY. A version is offered again only if EVERY run of it on this account allows
 * re-issue -- one good run among them means the account has had a valid demand, and that is the
 * clock the rule is protecting.
 */
export interface StartableWorkflow {
  versionId: string
  name: string
  /** The firm's own sentence about when it should be started. Shown, never interpreted. */
  note: string | null
  /** How this version's day numbers count, which is what decides whether "now" means today. */
  dayUnit: DayUnit
  /**
   * THE DAY THE FIRST NOTICE WOULD GO IF IT WERE STARTED TODAY.
   *
   * CARRIED ON THE OFFER, so the button can say it BEFORE the press rather than the screen
   * explaining it afterwards. The firm pressed start on a Sunday and read "the first step goes out
   * now"; the run was dated correctly and the sentence was a lie. A date on the offer is the only
   * version of this that is true on a weekend.
   */
  firstStepOn: string
  /**
   * WHETHER THE FIRST STEP WAITS FOR A PERSON, which decides whether starting it out of hours sends
   * anything at all or merely queues a press.
   *
   * THE PRESS THAT STARTS A RUN LIFTS `needsRelease` FOR WHAT IS DUE THAT DAY -- the person looked,
   * and they pressed a button that said what it sends. Started on a Sunday there is nothing due
   * that day, so nothing is lifted: the sweep on the Monday morning finds a statutory demand that
   * waits for a person and holds it, and somebody presses Send on the day. That is right, and it is
   * not what "it starts on Monday" leads anybody to expect, so the button says it.
   */
  firstStepNeedsRelease: boolean
}

export async function fetchStartableWorkflows(accountId: string): Promise<StartableWorkflow[]> {
  const [versions, runs] = await Promise.all([
    supabase.from('workflow_versions')
      /* day_unit and the nodes' day numbers, because when the first notice goes is arithmetic on
         both and the answer belongs on the button rather than in a surprise afterwards. */
      .select('id, trigger_note, day_unit, workflows!inner(name), workflow_nodes(day, needs_release)')
      .eq('state', 'active')
      .eq('trigger_kind', 'by_hand'),
    supabase.from('workflow_runs').select('version_id, reissue_allowed').eq('account_id', accountId),
  ])
  if (versions.error) throw new Error(versions.error.message)
  if (runs.error) throw new Error(runs.error.message)

  /* A version is closed to this account unless every run of it was a defective demand. */
  const been = new Set<string>()
  for (const r of (runs.data ?? []) as { version_id: string; reissue_allowed: boolean }[]) {
    if (!r.reissue_allowed) been.add(r.version_id)
  }
  const today = todayIso()
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows arrive as untyped JSON. */
  return (versions.data ?? [] as any[])
    .filter((v: any) => !been.has(v.id))
    .map((v: any) => {
      const unit = ((v.day_unit as DayUnit) ?? 'calendar')
      /*
       * THE LOWEST DAY ON THE CHART, READ RATHER THAN ASSUMED. It is 1 on every business-day
       * sequence the firm has drawn and 0 on the calendar ones -- but a version whose first step
       * is day 3 must not have a button under it saying the demand goes out today, and the
       * difference between "assumed 1" and "read off the nodes" is exactly that case.
       *
       * A version with no nodes at all cannot send anything; it is dated as day 1 so the sentence
       * falls back to the ordinary one rather than to NaN.
       */
      const nodes = (v.workflow_nodes as { day: number; needs_release: boolean }[] | null) ?? []
      const days = nodes.map((n) => n.day)
      const first = days.length > 0 ? Math.min(...days) : (unit === 'business' ? 1 : 0)
      return {
        versionId: v.id as string,
        name: (v.workflows?.name as string) ?? 'Workflow',
        note: (v.trigger_note as string) ?? null,
        dayUnit: unit,
        firstStepOn: firstStepOn(today, first, unit),
        /* ANY NODE ON THE FIRST DAY, not all of them: the section 129's day 1 is the letter and the
           SMS together and both carry it, but a day where one of two needs a press is still a day
           that ends in a press. */
        firstStepNeedsRelease: nodes.some((n) => n.day === first && n.needs_release),
      }
    })
}

/**
 * START ONE, WHICH SENDS ITS FIRST STEP.
 *
 * THE FIRM: "the moment the section 129 is sent out via email, that is when the workflow is
 * triggered." So the press that starts the sequence is the press that issues the demand, and the
 * clock runs from that day -- ten business days to answer, the final notice after it, the bureau
 * twenty business days later.
 *
 * THROUGH THE ENDPOINT, for the same reason releaseStep is: the wording, the PDF, the fee and the
 * Sent copy all happen on the server. A run inserted from the browser would be a clock started
 * against a notice nobody sent.
 */
export async function startWorkflow(accessToken: string, accountId: string, versionId: string): Promise<{
  workflow: string
  startedOn: string
  sent: number
  held: number
  notes: string[]
  /**
   * THE DAY THE FIRST STEP IS DATED, AS THE PLANNER DATED IT.
   *
   * The offer carried a prediction of this; the server sends back the fact. They agree unless the
   * press crossed midnight in Johannesburg, and where they differ it is this one that is true --
   * so the screen reports the run's own date rather than what the button guessed.
   */
  firstStepOn: string | null
}> {
  const res = await fetch('/api/workflow/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ accountId, versionId }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean; error?: string; workflow?: string; startedOn?: string
    sent?: number; held?: number; stillHeld?: number; notes?: string[]; firstStepOn?: string | null
  }
  if (!res.ok || !body.ok) throw new Error(body.error ?? 'The workflow could not be started.')
  return {
    workflow: body.workflow ?? 'Workflow',
    startedOn: body.startedOn ?? '',
    sent: body.sent ?? 0,
    held: (body.held ?? 0) + (body.stillHeld ?? 0),
    notes: body.notes ?? [],
    firstStepOn: body.firstStepOn ?? null,
  }
}
