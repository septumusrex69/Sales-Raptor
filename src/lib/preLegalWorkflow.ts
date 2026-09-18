/**
 * THE FIRM'S PRE-LEGAL WORKFLOW, as data.
 *
 * Transcribed from "BF · PRE-LEGAL COLLECTIONS — 160 DAY WORKFLOW", with two changes the firm
 * asked for and one consequence of them. Everything else is their chart, in their words.
 *
 * WHAT CHANGED, AND WHY IT IS WORTH READING BEFORE THE STEPS:
 *
 *   1. THE ROTATIONS ARE GONE FROM THE SPINE. The chart has "Day 40 · Rotate to Clerk 2", day 80
 *      and day 120. Rotation is now a calendar rule — the 5th, two months on — and lives in
 *      workflowSchedule.ts, because a clerk should be measured on the month-ends they were given
 *      rather than handed the file eight days before the debit orders they arranged run. A notice
 *      stays anchored to the FILE and goes out on its day whoever is holding it, so that no
 *      allocation decision can move the date of a section 129.
 *
 *   2. THE STATUTORY WAITS ARE BUSINESS DAYS. The chart says "20 business days" under Intention
 *      to List and then dates the confirmation at day 42. Twenty business days from day 10 is
 *      about day 38 calendar, so 42 was right — but it was right by arithmetic somebody did once.
 *      It is expressed as the twenty business days it actually is, which also means it moves
 *      correctly over Easter and the December holidays rather than needing redoing.
 *
 *   3. SO IT IS NO LONGER A 160-DAY WORKFLOW. The notice spine still closes around day 160; the
 *      four clerks now take about 230 days to get through their two month-ends each. The name is
 *      the firm's to keep or change, but the two numbers no longer agree and that is on purpose.
 *
 * MOST OF THE WORDING IS NOT WRITTEN YET, which is the point of listing it. Every notice names
 * the template it will send, or null where nobody has written it — and the check beside this file
 * reports the nulls as a to-do list rather than as a failure.
 */
import type { WorkflowDefinition } from './workflowDefinition.ts'

export const PRE_LEGAL_160: WorkflowDefinition = {
  id: 'pre-legal-160',
  name: 'Pre-legal collections',
  domain: 'collections',
  summary: 'Handover to a recommendation, with five ways a file can leave the sequence and come back.',

  /* ---------------------------------------------------------------- the spine */
  spine: [
    {
      /*
       * DAY 0 IS A NOTICE TO THE DEBTOR, NOT A FILE REVIEW.
       *
       * The chart opened with "Handover Received — Validate File — Prescription · NCA · Mandate ·
       * POPIA" and then a "Collectable?" decision with a No branch back to the client. The firm
       * took both out: "I don't think that's really necessary because we don't upload files that
       * are not collectible." The check happens before an account reaches Raptor at all, so a
       * step asking it again is a step every file passes, which is a step nobody reads.
       *
       * WHAT THAT MOVES UPSTREAM, worth knowing rather than discovering: prescription. Collecting
       * a prescribed debt is prohibited by section 126B and the call scripts stop on it, so the
       * flag has to be right at import. Raptor carries `prescribed` on the account; nothing in
       * this workflow re-checks it.
       */
      id: 'handover-notice',
      label: 'Handover notice',
      after: 'start',
      when: { kind: 'calendar_days', days: 0 },
      action: { kind: 'notice', template: null, channel: 'post', statutory: false },
      note: 'Tells the debtor the account has been handed to us, and by whom',
      phase: 'Notice',
    },
    {
      id: 'demand-129',
      label: 'Demand and section 129',
      after: 'handover-notice',
      when: { kind: 'calendar_days', days: 1 },
      action: { kind: 'notice', template: null, channel: 'registered_post', statutory: true },
      note: 'Registered post. Section 129 is the statutory demand BEFORE court — this file is in progress, not legal',
      phase: 'Notice',
    },
    {
      id: 'intention-to-list',
      label: 'Intention to list',
      after: 'demand-129',
      when: { kind: 'calendar_days', days: 9 },
      action: { kind: 'notice', template: null, channel: 'registered_post', statutory: true },
      /* The statutory clock, and it is the debtor's: it does not stop for a weekend. */
      deadline: { kind: 'business_days', days: 20 },
      note: 'Gives the debtor 20 business days to respond before the listing is confirmed',
      phase: 'Notice',
    },
    {
      id: 'follow-up-offer',
      label: 'Follow-up and offer',
      after: 'intention-to-list',
      when: { kind: 'calendar_days', days: 11 },
      action: { kind: 'notice', template: null, channel: 'email' },
      phase: 'Notice',
    },
    {
      id: 'final-notice',
      label: 'Final notice',
      after: 'follow-up-offer',
      when: { kind: 'calendar_days', days: 14 },
      action: { kind: 'notice', template: null, channel: 'registered_post', statutory: true },
      deadline: { kind: 'calendar_days', days: 7 },
      note: 'Seven days to settle',
      phase: 'Notice',
    },
    {
      /*
       * TWENTY BUSINESS DAYS FROM THE INTENTION, not a fixed day 42. The chart's 42 was the right
       * answer to that sum in an ordinary month; over Easter or the December holidays it is not,
       * and a listing confirmed before its statutory period has run is a listing to be removed.
       */
      id: 'listing-confirmed',
      label: 'Listing confirmed',
      after: 'intention-to-list',
      when: { kind: 'business_days', days: 20 },
      onNonWorkingDay: 'forward',
      action: { kind: 'flag', flag: 'Listed with the bureau' },
      note: 'Twenty business days after the intention to list',
      phase: 'Legal',
    },
    {
      id: 'intended-legal-action',
      label: 'Intended legal action',
      after: 'final-notice',
      when: { kind: 'calendar_days', days: 15 },
      action: { kind: 'notice', template: null, channel: 'registered_post', statutory: true },
      note: 'Debtor placed in mora',
      phase: 'Legal',
    },
    {
      id: 'court-process-explained',
      label: 'Court process explained',
      after: 'intended-legal-action',
      when: { kind: 'calendar_days', days: 10 },
      action: { kind: 'notice', template: null, channel: 'email' },
      phase: 'Legal',
    },
    {
      id: 'final-settlement-window',
      label: 'Final settlement window',
      after: 'court-process-explained',
      when: { kind: 'calendar_days', days: 10 },
      action: { kind: 'notice', template: null, channel: 'email' },
      phase: 'Legal',
    },
    {
      id: 'draft-summons',
      label: 'Draft summons',
      after: 'final-settlement-window',
      when: { kind: 'calendar_days', days: 5 },
      onNonWorkingDay: 'forward',
      action: { kind: 'task', title: 'Draft the summons and put it up for attorney sign-off' },
      note: 'Attorney sign-off',
      phase: 'Legal',
    },
    {
      id: 'open-strategy',
      label: 'Open strategy',
      after: 'draft-summons',
      when: { kind: 'calendar_days', days: 5 },
      onNonWorkingDay: 'forward',
      action: { kind: 'task', title: 'Set the open strategy for this file' },
      phase: 'Open',
    },
    {
      id: 'viability-review',
      label: 'Viability review',
      after: 'open-strategy',
      when: { kind: 'calendar_days', days: 30 },
      onNonWorkingDay: 'forward',
      action: { kind: 'task', title: 'Review whether this file is still worth working' },
      phase: 'Open',
    },
    {
      id: 'closure-report',
      label: 'Closure report',
      after: 'viability-review',
      when: { kind: 'calendar_days', days: 45 },
      onNonWorkingDay: 'forward',
      action: { kind: 'task', title: 'Write the closure report for the client' },
      phase: 'Open',
    },
    {
      id: 'recommendation',
      label: 'Recommendation',
      after: 'closure-report',
      when: { kind: 'calendar_days', days: 5 },
      onNonWorkingDay: 'forward',
      action: { kind: 'decision', question: 'Litigate, trace and hold, or write off?' },
      note: 'Returned to the client with a recommendation: litigate · trace and hold · write off',
      phase: 'Open',
    },
  ],

  /* ---------------------------------------------------------------- the five exits */
  branches: [
    {
      id: 'arrangement',
      name: 'Payment arrangement',
      entry: 'Any file · any day · any phase',
      steps: [
        {
          id: 'assess-affordability',
          label: 'Assess affordability',
          after: 'start',
          when: { kind: 'calendar_days', days: 0 },
          action: { kind: 'task', title: 'Assess affordability against the client mandate' },
          note: 'Terms within mandate',
        },
        {
          /*
           * AN AOD INTERRUPTS PRESCRIPTION, which is the one fact on this branch that changes the
           * legal position of the file rather than its diary. It is a flag, not a notice, because
           * what matters afterwards is that the file carries it.
           */
          id: 'aod-signed',
          label: 'AOD signed',
          after: 'assess-affordability',
          when: { kind: 'calendar_days', days: 0 },
          action: { kind: 'flag', flag: 'Acknowledgement of debt signed — prescription interrupted' },
          note: 'Interrupts prescription',
        },
        {
          id: 'load-debit-order',
          label: 'Load debit order',
          after: 'aod-signed',
          when: { kind: 'calendar_days', days: 0 },
          action: { kind: 'task', title: 'Load the debit order' },
          note: 'The notice sequence pauses from here',
        },
      ],
      outcomes: [
        {
          id: 'kept',
          label: 'KEPT',
          detail: 'Settled · paid-up letter · bureau updated · closed',
          effect: { kind: 'close', reason: 'Settled in full under an arrangement' },
        },
        {
          /*
           * STRAIGHT TO BRANCH B, AND THE CHART SAYS WHY: "no renegotiation first". A missed
           * instalment that is renegotiated on the spot is an arrangement that never ends and a
           * file that never moves.
           */
          id: 'missed',
          label: 'MISSED',
          detail: 'Goes to the default branch — no renegotiation first',
          effect: { kind: 'goto_branch', branch: 'default' },
        },
      ],
    },
    {
      id: 'default',
      name: 'Default on the arrangement',
      entry: 'An instalment is missed',
      steps: [
        {
          id: 'day-one-contact',
          label: 'Contact the debtor',
          after: 'start',
          when: { kind: 'calendar_days', days: 1 },
          onNonWorkingDay: 'forward',
          action: { kind: 'task', title: 'Ring the debtor — five-day cure window' },
          note: 'Five-day cure window',
        },
        {
          id: 'broken-arrangement-notice',
          label: 'Broken arrangement notice',
          after: 'day-one-contact',
          when: { kind: 'calendar_days', days: 4 },
          action: { kind: 'notice', template: 'sms-broken-arrangement', channel: 'sms' },
          note: 'Day five of the cure window',
        },
      ],
      outcomes: [
        {
          id: 'first-cured',
          label: 'FIRST DEFAULT CURED',
          detail: 'The arrangement continues and the term is not extended',
          effect: { kind: 'continue' },
        },
        {
          id: 'second-default',
          label: 'SECOND DEFAULT',
          detail: 'Cancelled · rejoins the spine at the same day',
          effect: { kind: 'rejoin' },
        },
      ],
    },
    {
      id: 'dispute',
      name: 'Dispute',
      entry: 'Any file · any day · any phase',
      steps: [
        {
          id: 'dispute-logged',
          label: 'Dispute logged',
          after: 'start',
          when: { kind: 'calendar_days', days: 0 },
          action: { kind: 'flag', flag: 'Disputed' },
          note: 'Within 24 hours of being raised',
        },
        {
          /*
           * THE DISPUTED PORTION IS SUSPENDED, NOT THE FILE, and prescription still runs. Both
           * halves matter: collecting on a disputed amount is what turns a dispute into a
           * complaint, and treating the dispute as a freeze is how a claim prescribes while
           * everybody waits for the client.
           */
          id: 'suspend-disputed-portion',
          label: 'Suspend the disputed portion',
          after: 'dispute-logged',
          when: { kind: 'calendar_days', days: 0 },
          action: { kind: 'stop_collection', reason: 'Disputed portion suspended — prescription still runs' },
        },
        {
          id: 'acknowledge-dispute',
          label: 'Acknowledge the dispute',
          after: 'suspend-disputed-portion',
          when: { kind: 'business_days', days: 5 },
          action: { kind: 'notice', template: null, channel: 'email' },
          /* The wording for this one already exists, in queryLetters.ts, which says in its own
             header that it belongs in the template library once there is one. There is now. */
          note: 'Wording exists in queryLetters.ts and needs moving into the library',
        },
        {
          id: 'investigate-dispute',
          label: 'Investigate',
          after: 'dispute-logged',
          when: { kind: 'business_days', days: 20 },
          onNonWorkingDay: 'forward',
          action: { kind: 'task', title: 'Put the dispute to the client and reach a finding' },
          note: 'Within twenty business days',
        },
      ],
      outcomes: [
        {
          id: 'upheld-in-full',
          label: 'UPHELD IN FULL',
          detail: 'Claim withdrawn · listing removed · file closed',
          effect: { kind: 'close', reason: 'Dispute upheld in full — claim withdrawn' },
        },
        {
          id: 'upheld-in-part',
          label: 'UPHELD IN PART',
          detail: 'Balance adjusted · rejoins at the same day',
          effect: { kind: 'rejoin' },
        },
        {
          id: 'rejected',
          label: 'REJECTED',
          detail: 'Written finding · rejoins at the same day',
          effect: { kind: 'rejoin' },
        },
      ],
    },
    {
      id: 'sequestration',
      name: 'Sequestration — natural person',
      entry: 'The debtor is sequestrated',
      steps: [
        {
          id: 'sequestration-verified',
          label: 'Sequestration verified',
          after: 'start',
          when: { kind: 'calendar_days', days: 0 },
          action: { kind: 'flag', flag: 'Sequestrated' },
          note: "Master's reference · Gazette",
        },
        {
          id: 'stop-collection-sequestration',
          label: 'Stop all collection',
          after: 'sequestration-verified',
          when: { kind: 'calendar_days', days: 0 },
          action: { kind: 'stop_collection', reason: 'Sequestrated — the account is suppressed' },
        },
        {
          id: 'notify-client-sequestration',
          label: 'Notify the client',
          after: 'stop-collection-sequestration',
          when: { kind: 'calendar_days', days: 2 },
          action: { kind: 'notice', template: null, channel: 'email' },
          note: 'Within 48 hours',
        },
        {
          id: 'prove-claim',
          label: 'Prove the claim',
          after: 'notify-client-sequestration',
          when: { kind: 'calendar_days', days: 0 },
          action: { kind: 'task', title: 'Prove the claim — weigh the contribution risk first' },
          note: 'Weigh contribution risk',
        },
      ],
      outcomes: [
        {
          /* A surety is a different person and therefore a different file. Rejoining this one
             would collect against an estate the firm has just stopped collecting against. */
          id: 'surety-exists',
          label: 'SURETY EXISTS',
          detail: 'A new file is opened and runs the spine from day 0',
          effect: { kind: 'new_file', of: 'the surety' },
        },
        {
          id: 'no-surety',
          label: 'NO SURETY',
          detail: 'Terminal · written off against the estate',
          effect: { kind: 'write_off', reason: 'Sequestrated, no surety' },
        },
      ],
    },
    {
      id: 'liquidation',
      name: 'Liquidation and business rescue — juristic person',
      entry: 'The debtor is liquidated or placed in business rescue',
      steps: [
        {
          id: 'liquidation-verified',
          label: 'Liquidation or rescue verified',
          after: 'start',
          when: { kind: 'calendar_days', days: 0 },
          action: { kind: 'flag', flag: 'Liquidation or business rescue' },
          note: 'CIPC · Gazette · order',
        },
        {
          id: 'stop-collection-liquidation',
          label: 'Stop all collection',
          after: 'liquidation-verified',
          when: { kind: 'calendar_days', days: 0 },
          action: { kind: 'stop_collection', reason: 'Moratorium applies' },
        },
        {
          id: 'which-process',
          label: 'Which process?',
          after: 'stop-collection-liquidation',
          when: { kind: 'calendar_days', days: 0 },
          action: { kind: 'decision', question: 'Liquidation or business rescue?' },
        },
        {
          id: 'register-claim',
          label: 'Register the claim',
          after: 'which-process',
          when: { kind: 'calendar_days', days: 0 },
          action: { kind: 'task', title: 'Register the claim with the practitioner or liquidator' },
          note: 'Practitioner or liquidator',
        },
      ],
      outcomes: [
        {
          id: 'business-rescue',
          label: 'BUSINESS RESCUE',
          detail: 'Vote on the plan · an adopted plan binds all creditors',
          effect: { kind: 'hold', reason: 'Business rescue — the plan binds all creditors once adopted' },
        },
        {
          id: 'surety-on-the-credit-application',
          label: 'SURETY EXISTS',
          detail: 'A new file is opened and runs the spine from day 0',
          effect: { kind: 'new_file', of: 'the surety on the credit application' },
        },
        {
          id: 'liquidation-nil',
          label: 'LIQUIDATION · NIL',
          detail: 'Terminal · written off against the entity',
          effect: { kind: 'write_off', reason: 'Liquidated, no dividend' },
        },
      ],
    },
  ],

  /* The firm's own rules, at the foot of their chart, kept as written. */
  rules: [
    'A file that leaves the spine on day 52 returns to it on day 52 — never at day 1.',
    'Statutory notices are never re-issued when a file rejoins the spine.',
    'Prescription runs throughout — through arrangements, disputes and silence.',
    'Tracing sits inside the phases; it is not a separate exit from the spine.',
    'Sequestration and liquidation are terminal for the debtor, but a surety is a new file.',
    'Proof of dispatch is captured against every notice the spine generates.',
  ],
}
