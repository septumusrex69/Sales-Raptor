/**
 * A NOTICE THAT NEVER REACHED THE DEBTOR WAS NEVER SERVED.
 *
 * THE FIRM: "if someone had the wrong email address and a workflow already started, then we need
 * to get the right email address and send the workflow again — they've basically only been served
 * a new notice. How are we going to do this?" And: "the notifications that would come in, for
 * example, if it was sent to an email address that does not exist."
 *
 * THE ANSWER WAS HALF BUILT ALREADY. `reissue_allowed` exists because the once-per-account rule
 * assumes the first clock was valid — "the first demand was defective and the clock it started
 * was never good, so a fresh sequence is one clock, not two". An undelivered notice is the same
 * class of defect; all that was missing was a second reason to set the flag.
 *
 * THE ASSERTION THIS FILE IS REALLY FOR IS THE HARD/SOFT LINE. A full mailbox, a greylisted first
 * attempt, a server down for an hour — the address is real and the retry will probably deliver.
 * Treating one of those as "never served" voids a notice that DID arrive and restarts a statutory
 * clock that was already running, which is the expensive direction. So `unknown` must never act,
 * and a check that only tested the hard case would pass on code that acted on everything.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-not-served.mjs
 */
import { readFileSync } from 'node:fs'
import { actsOnItsOwn, bounceSeverity } from '../../src/lib/bounceSeverity.ts'
import { NOT_SERVED_REASONS, words } from '../../src/lib/runSteps.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')

/* ---------------- hard, soft, and the one that must do nothing ---------------- */

/** A real Postfix bounce, trimmed to the part that matters. */
const HARD = `This is the mail system at host mail.bredellferreira.co.za.

<nosuchperson@example.co.za>: host example.co.za said: 550 5.1.1 User unknown

Reporting-MTA: dns; mail.bredellferreira.co.za
Final-Recipient: rfc822; nosuchperson@example.co.za
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550 5.1.1 User unknown`

const SOFT = `This is the mail system at host mail.bredellferreira.co.za.

<real.person@example.co.za>: host example.co.za said: 452 4.2.2 Mailbox full

Reporting-MTA: dns; mail.bredellferreira.co.za
Final-Recipient: rfc822; real.person@example.co.za
Action: failed
Status: 4.2.2`

const DELAYED = `Your message has not yet been delivered.

Final-Recipient: rfc822; real.person@example.co.za
Action: delayed`

check('a 5.x.x is a hard bounce', bounceSeverity(HARD), 'hard')
check('a 4.x.x is a soft one', bounceSeverity(SOFT), 'soft')
/*
 * AND "Action: failed" BESIDE A 4.x.x IS STILL SOFT. Plenty of servers write `failed` on a
 * temporary refusal, so the class digit outranks the action -- which SOFT above proves, since it
 * carries both.
 */
ok('...even where the action says failed', SOFT.includes('Action: failed'))
check('a delay with no status is soft', bounceSeverity(DELAYED), 'soft')

/*
 * THE DEFAULT, AND THE WHOLE POINT. Anything unreadable comes back `unknown` and must not act:
 * being slow is a nuisance, voiding a notice that arrived is a defective demand.
 */
check('an unreadable bounce is unknown', bounceSeverity('Delivery failed, sorry.'), 'unknown')
check('...and so is an empty one', bounceSeverity(''), 'unknown')
check('...and nothing at all', bounceSeverity(null), 'unknown')
check('only a hard bounce acts on its own', actsOnItsOwn('hard'), true)
check('...never a soft one', actsOnItsOwn('soft'), false)
check('...and never an unknown one', actsOnItsOwn('unknown'), false)

/*
 * A SUCCESS REPORT IS NOT A BOUNCE. A 2.x.x delivery receipt reaching this by mistake must not be
 * read as a failure -- it is the one class where "nothing here says it failed" is the only honest
 * answer, and calling it hard would mark a notice that demonstrably arrived as never served.
 */
check('a delivery receipt does not act', bounceSeverity('Action: relayed\nStatus: 2.0.0'), 'soft')

/*
 * AND THE STATUS HAS TO BE A STATUS LINE. "Status: 5.1.1" quoted inside a sentence of English --
 * a colleague forwarding a bounce and describing it -- is not a machine-readable report.
 */
check('a status mentioned in prose is not read',
  bounceSeverity('He said the server gave Status: 5.1.1 but I think it is fine'), 'unknown')
/* THE FIRST STATUS WINS on a multi-recipient report: our notice went to one address, and a later
   4.x.x about somebody else's must not downgrade the 5.x.x about ours. */
check('the first status wins on a multi-recipient report',
  bounceSeverity('Status: 5.1.1\nFinal-Recipient: rfc822; b@x.co\nStatus: 4.2.2'), 'hard')

/* ---------------- the step records it and unlocks the re-issue ---------------- */

const schema = read('supabase/schema.sql')
for (const col of ['not_served_at', 'not_served_reason', 'not_served_by']) {
  ok(`${col} is on the step`, new RegExp(`add column if not exists ${col}`).test(schema))
}
/*
 * THE FUNCTION DOES BOTH THINGS OR NEITHER. Marking the step without setting reissue_allowed is a
 * notice everybody can see failed and a workflow nobody can run again; setting the flag without
 * marking the step is a sequence that may run twice with nothing on the file saying why.
 */
const fnAt = Math.max(
  schema.lastIndexOf('create or replace function public.workflow_step_not_served('),
  schema.lastIndexOf('create function public.workflow_step_not_served('),
)
ok('the function is in the schema', fnAt > 0)
const fn = fnAt > 0 ? schema.slice(fnAt, schema.indexOf('$$;', fnAt)) : ''
ok('...and stamps the step', /set not_served_at = public\.raptor_now\(\)/.test(fn))
ok('...and unlocks the re-issue', /update public\.workflow_runs set reissue_allowed = true/.test(fn))
/*
 * ONLY A NOTICE THAT WENT OUT. A pending or held step has been served on nobody, so there is
 * nothing to say was never served -- and marking one would unlock a re-issue of a sequence that
 * has not run.
 */
ok('...refusing a step that was never sent', /v_state <> 'sent'/.test(fn))
/* IDEMPOTENT, because the sweep can meet the same bounce twice and a second marking must not
   overwrite the first person's reason or announce it again. */
ok('...and saying so rather than marking twice', /if v_already then/.test(fn))
/* THE STEP STAYS SENT. A send cannot be un-sent, and the file has to show both attempts. */
ok('the step is never moved out of sent', !/set state = /.test(fn))
/* NOT REACHABLE BY ANON. Supabase grants EXECUTE to anon by default and `revoke from public`
   does not touch role grants -- the same hole check-finance-is-administrator-only exists for. */
ok('anon cannot call it',
  /revoke all on function public\.workflow_step_not_served\(uuid, text, uuid\) from public, anon/.test(schema))

/* ---------------- the bounce can find the notice it is about ---------------- */

const stepSrc = code('api/_lib/workflow/step.ts')
ok('an emailed notice records which step sent it', /workflow_step_id: step\.id/.test(stepSrc))
ok('...and so does an SMS', (stepSrc.match(/workflow_step_id: step\.id/g) ?? []).length >= 2)
for (const t of ['account_emails', 'sms_messages']) {
  ok(`${t} carries the step`,
    new RegExp(`alter table public\\.${t}[\\s\\S]{0,120}add column if not exists workflow_step_id`).test(schema))
}

const sync = code('api/_lib/emailSync.ts')
ok('the sync acts on a bounce', /bounceHitAWorkflowStep/.test(sync))
ok('...only a hard one', /actsOnItsOwn\(severity\)/.test(sync))
/* THE CHAIN: the bounce quotes the Message-ID, the Message-ID finds the send, the send names the
   step. Asserted because a lookup on anything looser would mark the wrong notice. */
ok('...found by the message it is reporting on', /\.in\('message_id', candidates\)/.test(sync))
ok('...and only a send a workflow made', /\.not\('workflow_step_id', 'is', null\)/.test(sync))
/* AND SOMEBODY IS TOLD, which is the half the firm asked about by name. */
ok('...and the collector is told', /notifyHeld\(admin, \{/.test(sync))
/*
 * NEVER FATAL. This runs inside the mail sync for the whole firm; a bounce that cannot be traced
 * must not stop a mailbox from syncing.
 */
ok('...and a failure here does not stop the sync', /catch \(e\) \{[\s\S]{0,200}bounce-to-workflow failed/.test(sync))

/* ---------------- and the hand-worked half, which matters more ---------------- */

/*
 * THE DANGEROUS WRONG ADDRESS DOES NOT BOUNCE. A real, working mailbox belonging to somebody who
 * is not the debtor is never reported by any mail system — somebody finds out, and there has to
 * be a way to say so.
 */
const panel = code('src/components/collections/WorkflowRunPanel.tsx')
ok('a person can say it never arrived', /markStepNotServed\(\{ stepId: step\.id/.test(panel))
ok('...only on a step that was sent', /step\.state === 'sent' && !step\.notServedAt/.test(panel))
ok('...and the reasons are the closed list', /NOT_SERVED_REASONS\.map/.test(panel))
check('the reasons cover the ways it happens', NOT_SERVED_REASONS.length, 4)
ok('...including the one no mail system reports',
  NOT_SERVED_REASONS.some((r) => /belongs to somebody else/i.test(r)))
/* NO FREE TEXT. The sentence is read months later by somebody asking why a statutory sequence ran
   twice; "wrong addy" typed in a hurry is not an answer to that. */
ok('...and none of them is an open-ended "other"',
  !NOT_SERVED_REASONS.some((r) => /other|something else/i.test(r)))

/*
 * AND IT IS NOT A SIDE EFFECT OF CORRECTING THE ADDRESS. A debtor can have three addresses and a
 * collector tidying a contact record is not a finding that service failed. Asserted as an absence
 * over the contact-editing library: if saving a contact ever called this, the firm would re-serve
 * debtors every time somebody fixed a typo.
 */
ok('editing a contact does not mark anything unserved',
  !/markStepNotServed|workflow_step_not_served/.test(code('src/lib/accountWorkspace.ts')))

/* ---------------- and the screen stops calling it sent ---------------- */

/*
 * THE SENTENCE THE FIRM WOULD OTHERWISE READ. A bounced step says `sent` on every screen, which
 * is the firm believing a debtor has been served when they have not.
 */
const sentStep = {
  id: 's', label: 'Handover email', channel: 'email', dueOn: '2026-10-01', state: 'sent',
  note: null, sentAt: '2026-10-01T09:00:00Z', notServedAt: null, notServedReason: null,
  day: 1, ordinal: 0, instalmentNo: 0, needsRelease: false, afterMinutes: null,
}
ok('an ordinary sent step reads as sent', /sent/.test(words(sentStep)))
check('...and one that never arrived says so instead',
  words({ ...sentStep, notServedAt: '2026-10-02T08:00:00Z' }),
  'Handover email — never reached them, sent 1 Oct 2026')
ok('the detail panel says the workflow can go again',
  /can be issued again/.test(panel))

console.log(`\ncheck-not-served: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
