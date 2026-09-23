/**
 * WHETHER A DUE STEP MAY GO OUT, AND WHAT LEAVING A WORKFLOW DOES TO ONE IN FLIGHT.
 *
 * Two halves of the same thing, and both are silent when wrong:
 *
 *   - A SCHEDULER THAT SENDS WHATEVER IT FINDS ON THE DATE. The listing notice tells a debtor
 *     their default HAS been reported and quotes the reference to query it with. On the morning
 *     day 39 comes round, the submission may not have gone. `renderTemplate` leaves an unresolved
 *     placeholder STANDING rather than blanking it -- which is right, and which means the
 *     unattended path posts a four-page notice reading "reported on {{listing_date}} under
 *     reference {{listing_reference}}" unless something stops it.
 *   - A WORKFLOW THAT DOES NOT STOP. The firm: "if there is a dispute raised or a PTP put in
 *     place, then a new workflow starts. And then that one ceases." A section 129 that goes out
 *     three weeks after the debtor agreed to pay is the firm suing somebody who is paying them.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-workflow-send.mjs
 */
import { readFileSync } from 'node:fs'
import { planSend } from '../../src/lib/workflowSend.ts'
import { smsSafeValues } from '../../src/lib/smsSegments.ts'
import { sampleValues } from '../../src/lib/messageTemplates.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const letters = JSON.parse(readFileSync('scripts/letters/letters.json', 'utf8'))

/* A step of the shape the builder produces, with only what planSend reads set. */
function node(over = {}) {
  return {
    id: 'n1', phaseId: null, key: 'k', kind: 'communication', label: 'Step', description: null,
    day: 1, deadlineDays: null, deadlineUnit: null, channel: 'email',
    templateId: 't', templateCompanyId: 'tc', afterMinutes: null,
    needsRelease: false, statutory: false, assignTo: null, ordinal: 0,
    ...over,
  }
}
const email = (over = {}) => ({
  id: 't', kind: 'email', subject: 'Notice — {{case_number}}',
  body: 'Dear {{debtor_name}}, your balance is {{balance}}.',
  audience: null, attachment: null, ...over,
})
const person = { kind: 'individual', email: 'd@example.com', mobile: '0821234567' }
const values = sampleValues()

/* ------------------------------------------------ the ordinary case goes, and is priced */

{
  const plan = planSend({ node: node(), individual: email(), company: null, debtor: person, values, dueOn: '2026-09-23' })
  ok('an ordinary email step goes out', plan.can)
  check('...with nothing unfilled', plan.unfilled, [])
  /* Item 1(a), R25: a necessary ordinary letter, registered letter, facsimile or e-mail. */
  check('...charged as one email under item 1(a)', [plan.charge.item, plan.charge.rand], ['1a', 25])
  check('...and not as a number of segments', plan.charge.segments, null)
}

/*
 * PRICED ON THE STEP'S OWN DAY, NEVER ON TODAY'S SCHEDULE. CLAUDE.md's rule is that scheduleFor
 * takes the ACTION's date, and a run that sat held across a tariff substitution is exactly where
 * it bites: the same step quoted twice, months apart, must not change price because it was read
 * on a different afternoon.
 */
{
  const now = planSend({ node: node(), individual: email(), company: null, debtor: person, values, dueOn: '2026-09-23' })
  const then = planSend({ node: node(), individual: email(), company: null, debtor: person, values, dueOn: '2019-06-01' })
  ok('a step due in 2026 is priced on the 2026 schedule', /2026/.test(now.charge.citation))
  ok('...and one due in 2019 is still priced on the schedule that was in force then',
    then.charge.citation !== now.charge.citation)
}

/* ------------------------------------------------ an SMS is priced per segment, on the merged text */

{
  const sms = { id: 't', kind: 'sms', subject: null, audience: null, body: 'Good day {{debtor_name}}. {{case_number}}: {{balance}} is overdue.', attachment: null }
  const plan = planSend({ node: node({ channel: 'sms' }), individual: sms, company: null, debtor: person, values, dueOn: '2026-09-23' })
  ok('an SMS step goes out', plan.can)
  check('...charged under item 1(c)', plan.charge.item, '1c')
  ok('...per segment, at R3.50 each', plan.charge.rand === plan.charge.segments * 3.5)

  /*
   * AND THE NON-BREAKING SPACE IS GONE BEFORE THE SEGMENTS ARE COUNTED. en-ZA groups thousands
   * with U+00A0, which is not in the GSM alphabet: one of them drops the whole message to UCS-2
   * and cuts every segment from 160 characters to 70, doubling what the debtor is charged under
   * item 1(c) for words nobody changed. SmsModal strips it on the screen; an unattended runner
   * that did not would bill double on every workflow SMS carrying a balance, with nobody looking.
   */
  const nbsp = { ...values, balance: 'R\u00a0180\u00a0000.00' }
  const dirty = planSend({ node: node({ channel: 'sms' }), individual: sms, company: null, debtor: person, values: nbsp, dueOn: '2026-09-23' })
  ok('a merged balance carrying a non-breaking space does not force UCS-2',
    !/\u00a0/.test(dirty.body))
  check('...so it is still one segment, not two', dirty.charge.segments, 1)
}

/* ------------------------------------------------ the wording is chosen by the debtor */

{
  const ind = email({ id: 'ti', audience: 'individual', body: 'Dear {{debtor_name}}' })
  const co = { id: 'tc', kind: 'email', subject: 'S', audience: 'company', body: 'To the directors of {{debtor_name}}', attachment: null }
  const forCompany = planSend({ node: node(), individual: ind, company: co, debtor: { ...person, kind: 'company' }, values, dueOn: '2026-09-23' })
  check('a company gets the company wording', forCompany.template.id, 'tc')
  const forPerson = planSend({ node: node(), individual: ind, company: co, debtor: person, values, dueOn: '2026-09-23' })
  check('a person gets the individual wording', forPerson.template.id, 'ti')

  /* AND A COMPANY IS NEVER QUIETLY SENT THE INDIVIDUAL ONE. The notices differ by more than a
     salutation: the company half tells its reader the company may be wound up and its directors
     held personally liable. Held, so somebody writes it, rather than substituted. */
  const nothingWritten = planSend({ node: node(), individual: ind, company: null, debtor: { ...person, kind: 'company' }, values, dueOn: '2026-09-23' })
  check('a company with nothing written for it holds', nothingWritten.refusal, 'no_wording')
  ok('...and is never given the wording stamped for a person', !nothingWritten.can)

  /*
   * BUT A WORDING THAT SERVES BOTH STILL SERVES BOTH. `templateCompanyId` is allowed to be null
   * "where one version serves both", which is most of the firm's non-statutory wording, and a
   * guard that held every such step would stop workflows for no reason. The library's audience
   * column is what tells the two cases apart: null serves either, a stamp does not.
   */
  const servesBoth = planSend({ node: node(), individual: email({ audience: null }), company: null, debtor: { ...person, kind: 'company' }, values, dueOn: '2026-09-23' })
  ok('a wording the library says suits either is used for a company too', servesBoth.can)
}

/* ------------------------------------------------ what holds it */

{
  const held = planSend({ node: node({ needsRelease: true, statutory: true }), individual: email(), company: null, debtor: person, values, dueOn: '2026-09-23' })
  check('a statutory demand waits for a person', held.refusal, 'waits_for_person')
  ok('...and the note says what they have to do, not what state it is in',
    /check the address/i.test(held.note) && !/needs_release|needsRelease/.test(held.note))

  const noAddress = planSend({ node: node(), individual: email(), company: null, debtor: { ...person, email: null }, values, dueOn: '2026-09-23' })
  check('an email step with no address holds', noAddress.refusal, 'no_address')

  const noMobile = planSend({ node: node({ channel: 'sms' }), individual: { id: 't', kind: 'sms', subject: null, audience: null, body: 'hi', attachment: null }, company: null, debtor: { ...person, mobile: null }, values, dueOn: '2026-09-23' })
  check('an SMS step with no number holds', noMobile.refusal, 'no_address')

  /* The firm's rule, and the reason afterMinutes exists: the handover SMS says "we emailed you". */
  const orphan = planSend({ node: node({ afterMinutes: 7 }), individual: email(), company: null, debtor: person, values, dueOn: '2026-09-23', afterStepSent: false })
  check('a step whose predecessor did not go holds', orphan.refusal, 'out_of_order')
  const followed = planSend({ node: node({ afterMinutes: 7 }), individual: email(), company: null, debtor: person, values, dueOn: '2026-09-23', afterStepSent: true })
  ok('...and goes once it did', followed.can)
  /* Undefined means "follows nothing". A guard that fired then would hold every first step. */
  const first = planSend({ node: node(), individual: email(), company: null, debtor: person, values, dueOn: '2026-09-23' })
  ok('a step that follows nothing is not held for ordering', first.can)
}

/* ------------------------------------------------ the field nothing can fill */

{
  const asksForListing = email({ body: 'Reported on {{listing_date}} under {{listing_reference}}.' })
  const blank = { ...values, listing_date: '', listing_reference: '' }
  const plan = planSend({ node: node(), individual: asksForListing, company: null, debtor: person, values: blank, dueOn: '2026-09-23' })
  check('a step quoting a fact the account does not have holds', plan.refusal, 'unfilled')
  check('...and names every field, so somebody can go and fill them',
    plan.unfilled.sort(), ['listing_date', 'listing_reference'])
  ok('...in the note, in the brackets they appear in', /\{\{listing_reference\}\}/.test(plan.note))
}

/*
 * AND THE NOTICE IT POSTS IS CHECKED AT ITS OWN LEVEL.
 *
 * This is the one a glance would miss. The covering email for a confirmed listing merges
 * perfectly -- it names the debtor and the case number and nothing else -- while the four-page
 * notice attached to it is the thing that quotes the listing date, the reference and the bureaus.
 * Checked only at the level of the message, the email is fit to send and the PDF goes out with
 * the brackets in it.
 */
{
  const listing = letters['letter-listing-individual']
  const cover = email({ body: 'Dear {{debtor_name}}, the attached is the record.', attachment: { key: 'letter-listing-individual', doc: listing } })
  const blank = { ...values, listing_date: '', listing_reference: '', bureaus_listed: '' }

  const withFacts = planSend({ node: node(), individual: cover, company: null, debtor: person, values, dueOn: '2026-09-23' })
  ok('a covering email whose notice is complete goes out', withFacts.can)
  check('...and says which notice it posts', withFacts.attachmentKey, 'letter-listing-individual')

  const without = planSend({ node: node(), individual: cover, company: null, debtor: person, values: blank, dueOn: '2026-09-23' })
  check('a covering email whose NOTICE has an unfilled field holds', without.refusal, 'unfilled')
  ok('...although the email itself merged perfectly',
    without.unfilled.length > 0 && !/\{\{/.test('Dear x, the attached is the record.'))
  ok('...and the note says it is the notice that is short',
    /notice it posts/i.test(without.note))

  /* ONE EMAIL IS ONE ACTION. Item 1(a) is charged on the message; a notice attached to it is not
     a second chargeable item, and quoting two would be billing a debtor twice for one send. */
  check('a covering email is charged once, not once per attachment', withFacts.charge.rand, 25)
}

/* ------------------------------------------------ leaving, in the database */

/*
 * THE EXIT IS SQL, so what can be held here is the rule it was written to: sent steps are never
 * touched, held steps are cancelled with the pending ones, and the two escalations that are not
 * disputes do not stop anything. Probed against staging inside a transaction that rolled back --
 * a help query cancelled 0, a litigation recommendation cancelled 0, a promise cancelled 3 of 4
 * and left the sent one alone.
 */
const schema = readFileSync('supabase/schema.sql', 'utf8')

/**
 * ONE FUNCTION'S TEXT, BOUNDED AT ITS OWN `end $$;`.
 *
 * Sliced to the end of the file instead, this check passed on broken code: "the exit is security
 * definer" was written as a lazy match from the function's name, and with the function changed to
 * `security invoker` the regex simply ran on and matched the DEFINER on one of the trigger
 * functions three declarations below. It reported green on precisely the break it exists to
 * catch. Bounded, and every assertion below reads one function.
 */
function fnText(name) {
  const at = schema.indexOf(`function public.${name}(`)
  if (at < 0) return ''
  const end = schema.indexOf('end $$;', at)
  return end < 0 ? schema.slice(at) : schema.slice(at, end)
}

const exitFn = fnText('workflow_exit_account')
ok('the exit function is in the schema at all', exitFn.length > 0)

ok('leaving cancels only what has not been sent',
  /state in \('pending', 'held'\)/.test(exitFn))
ok('...so a sent step is never rewritten', !/state in \([^)]*'sent'/.test(exitFn))
ok('the run itself is marked as having left, with the reason on it',
  /state = 'left'/.test(exitFn) && /left_reason = v_reason/.test(exitFn))
ok('an unknown exit event raises rather than passing silently',
  /raise exception 'Unknown workflow exit event/.test(exitFn))

/*
 * SECURITY DEFINER, AND THE REASON MATTERS. promises_to_pay is writable by anyone who can read
 * it, because taking a promise IS the job; workflow_run_steps is not. Under invoker rights a
 * liaison who takes a promise over the telephone would update ZERO steps -- and RLS filters
 * silently rather than raising, so the promise saves, the screen says so, and the section 129
 * goes out a fortnight later anyway.
 */
ok('the exit does not depend on who answered the telephone', /security definer/.test(exitFn))
ok('...which is to say it does not run with the caller\u2019s rights',
  !/security invoker/.test(exitFn))
ok('...and is still pinned to the public schema',
  /set search_path to 'public'/.test(exitFn))

/* A PROMISE AND A DISPUTE ARE ROWS APPEARING, so they are triggers rather than something a caller
   has to remember. Asserted present BEFORE anything about them, or an order-only test passes
   vacuously once the trigger it orders is deleted. */
ok('a promise to pay stops the workflow', /create trigger workflow_exit_on_promise/.test(schema))
ok('a dispute stops the workflow', /create trigger workflow_exit_on_dispute/.test(schema))

/*
 * AND THE TWO ESCALATIONS THAT ARE NOT DISPUTES DO NOT. account_queries carries all three because
 * they need the same queue -- but 'help' is an agent asking a team leader what to do, and
 * 'litigation' is the firm deciding to sue. Stopping the pre-legal sequence because somebody
 * recommended suing is precisely backwards.
 */
const disputeFn = fnText('workflow_exit_on_dispute')
ok('only a dispute exits, never a help or a litigation query',
  /new\.kind = 'dispute'/.test(disputeFn))

/* A promise captured as already broken is history, not an undertaking. */
const promiseFn = fnText('workflow_exit_on_promise')
ok('only a live promise exits, not one recorded as already broken',
  /new\.status = 'open'/.test(promiseFn))

/* ------------------------------------------------ the shared cleaner */

check('smsSafeValues replaces the app’s non-breaking spaces',
  smsSafeValues({ balance: 'R\u00a01\u00a0000' }).balance, 'R 1 000')
/* AND NOTHING ELSE. The box warns a writer about a curly apostrophe rather than rewriting their
   words; the firm's words are the firm's. Only what Raptor itself inserted is substituted. */
check('...and leaves what somebody typed alone',
  smsSafeValues({ note: 'don’t' }).note, 'don’t')

/* ------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-workflow-send: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
