/**
 * A VERBAL DISPUTE AND A WRITTEN ONE ARE DIFFERENT EVENTS.
 *
 * THE FIRM, HAVING RAISED ONE ON THEIR OWN ACCOUNT: "I also raised a dispute on this account now.
 * It didn't start the workflow... it should have an option to say that this query was a verbal
 * query by the debtor. And we should send an email... you stated that you have a dispute, please
 * put your dispute in writing, you have until this time. It also should have an option to say that
 * we've received a dispute. And that's when the real workflow starts. So creating a dispute from
 * what a debtor said doesn't do anything. It shouldn't have a workflow. But receiving an email
 * with a written dispute, that."
 *
 * BOTH SEQUENCES EXISTED AND NEITHER COULD BE REACHED. `Dispute alleged` carries the firm's own
 * "put it in writing by {{respond_by}}" wording and the deemed-undisputed notice that follows if
 * nothing comes; `Dispute` is the real one. No trigger started either, and the Escalate box never
 * asked how the dispute had arrived -- so alleged_on, received_on and in_writing stayed null on
 * every dispute anybody raised.
 *
 * WHAT IS GUARDED HERE:
 *
 *   - THE BOX ASKS, and the two answers say what each will do before it is pressed.
 *   - THE WRITE SETS ALL THREE COLUMNS, in one insert, because the trigger reads NEW.
 *   - THE TRIGGER PICKS THE SEQUENCE OFF THEM, and starts nothing on an unrelated edit.
 *   - WHEN THE WRITTEN ONE ARRIVES THE INVITATION IS ENDED. Its deemed-undisputed notice must
 *     never reach a debtor whose dispute is on the firm's desk.
 *   - AND THERE IS A BUTTON FOR THAT MOMENT, which is what the firm asked for by name.
 *
 * schema.sql IS APPEND-ONLY, SO THE LAST DEFINITION IS THE LIVE ONE -- read with lastIndexOf on
 * the full `create or replace function public.<name>(`, never on the bare name.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-dispute-stage.mjs
 */
import { readFileSync } from 'node:fs'
import { DAILY_LIMIT } from '../../src/lib/actionTariff.ts'
import { ENFORCE_ITEM_TOTALS } from '../../src/lib/annexureB.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const sql = read('supabase/schema.sql')
const lib = read('src/lib/accountQueries.ts')
const modal = read('src/pages/accounts/EscalateModal.tsx')
const panel = read('src/pages/accounts/QueryPanel.tsx')

/* ---------------- the box asks ---------------- */

ok('the escalate box asks how the dispute reached us', /How did it reach us\?/.test(modal))
ok('...with the debtor having told us as one answer', /The debtor told us/.test(modal))
ok('...and having it in writing as the other', /We have it in writing/.test(modal))
/*
 * VERBAL IS THE DEFAULT, and it is the answer that claims less: a dispute marked written that is
 * not stops a statutory sequence on a document nobody has.
 */
ok('...starting on the one that claims least',
  /useState<'verbal' \| 'written'>\('verbal'\)/.test(modal))
/*
 * EACH SAYS WHAT WILL HAPPEN. One of these stops the collection sequences and the other does not,
 * which is not something to find out afterwards.
 */
ok('...and each says what it will do', /Collection carries on until it arrives/.test(modal)
  && /the collection sequences stop/.test(modal))
/* ONLY ON A DISPUTE. Nobody alleges an agent asking a team leader for a decision, and the database
   refuses the dates on the other two escalations. */
ok('...asked only about a dispute', /\{kind === 'dispute' && \(/.test(modal))
ok('...and carried through as such', /reached: kind === 'dispute' \? reached : undefined/.test(modal))

/* ---------------- the write ---------------- */

const raise = lib.slice(lib.indexOf('export async function raiseQuery('), lib.indexOf('export async function markDisputeReceived('))
ok('raiseQuery takes how it reached us', /reached\?: 'verbal' \| 'written'/.test(raise))
/*
 * ALLEGED IS SET ON EVERY DISPUTE, WRITTEN OR NOT. The deemed-undisputed notice quotes it -- "On 5
 * October 2026 you told us that this account was disputed" -- so a null there is a {{brace}} on a
 * notice going to a debtor.
 */
ok('...and always records the day it was alleged',
  /const alleged = isDispute \? \(input\.allegedOn \|\| todayIso\(\)\) : null/.test(raise))
ok('...writing it to the column', /alleged_on: alleged,/.test(raise))
/* BOTH, OR NEITHER: a row carrying one of them says the dispute both has and has not arrived. */
ok('a written dispute records the day it was received', /received_on: written \? todayIso\(\) : null/.test(raise))
ok('...and says so in the flag the trigger reads', /in_writing: written,/.test(raise))
/*
 * AND THE MAPPER CARRIES THEM BACK. CLAUDE.md's own warning: a column in the table, in the type
 * and in the select but missing from the hand-written mapper reads as undefined for ever and
 * nothing fails.
 */
ok('the mapper reads the day it was alleged', /allegedOn: r\.alleged_on \?\? null/.test(lib))
ok('...the day it was received', /receivedOn: r\.received_on \?\? null/.test(lib))
ok('...and whether it is in writing', /inWriting: !!r\.in_writing/.test(lib))

/* ---------------- and the trigger picks the sequence ---------------- */

const at = sql.lastIndexOf('create or replace function public.workflow_start_on_dispute(')
ok('there is a trigger function for it', at > 0)
const fn = sql.slice(at, sql.indexOf('$$;', at) + 3)
const body = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')
/* A dispute and nothing else: an agent asking for help starts no sequence. */
ok('it answers a dispute only', /new\.kind <> 'dispute'/.test(body))
/* THE TWO SEQUENCES, PICKED OFF THE ONE FACT THAT SEPARATES THEM. */
ok('a dispute only alleged starts the sequence that asks for it in writing',
  /'dispute_alleged'/.test(body))
ok('...and one in writing starts the real one', /'dispute_logged'/.test(body))
ok('...decided by whether we have it',
  /when new\.in_writing or new\.received_on is not null/.test(body))
/*
 * ONCE PER LIVE RUN, NOT ONCE PER ACCOUNT EVER. A debtor who objects a second time is entitled to
 * a second answer -- the same rule workflow_start_on_promise states.
 */
ok('...and not a second time while one is already running',
  /r\.state in \('running', 'held'\)/.test(body))
/*
 * AN UNRELATED EDIT STARTS NOTHING. A dispute is edited for a dozen reasons -- an owner, a chase
 * date, a category -- and a sequence started on each of them is a second acknowledgement to the
 * debtor for a field nobody changed.
 */
ok('an edit that changes nothing about this starts nothing',
  /coalesce\(old\.in_writing, false\) or old\.received_on is not null/.test(body))
/*
 * AND WHEN THE WRITTEN ONE ARRIVES, THE INVITATION IS OVER. The alleged sequence ends in a
 * deemed-undisputed notice, and left running that notice reaches a debtor whose written dispute is
 * on the firm's desk.
 */
ok('the invitation ends when the dispute arrives',
  /The dispute was received in writing/.test(body))
ok('...cancelling only what has not gone', /s\.state in \('pending', 'held'\)/.test(body))
/* THE TRIGGER IS HUNG ON THE TABLE, and on the two columns that decide it. */
const trg = sql.slice(sql.lastIndexOf('create trigger workflow_start_on_dispute'))
ok('the trigger is on account_queries',
  /after insert or update of in_writing, received_on on public\.account_queries/.test(trg))
ok('...running that function', /execute function public\.workflow_start_on_dispute\(\)/.test(trg))

/* ---------------- the moment it arrives ---------------- */

ok('there is a function for the dispute arriving', /export async function markDisputeReceived\(/.test(lib))
const mark = lib.slice(lib.indexOf('export async function markDisputeReceived('))
/* ONE UPDATE. The trigger reads NEW; written in two, it fires against a row that still says the
   dispute has not arrived. */
ok('...setting both columns in one update',
  /\.update\(\{ received_on: todayIso\(\), in_writing: true \}\)/.test(mark))
/* ON THE ACCOUNT'S TIMELINE, because this is the event that stops the collection sequences. */
ok('...and saying so on the account', /The dispute was received in writing\./.test(mark))
/* AND A BUTTON FOR IT, which is what the firm asked for by name. */
ok('the dispute card offers it', /The dispute has arrived in writing/.test(panel))
ok('...calling that one function', /markDisputeReceived\(q\.id/.test(panel))
/* ONLY WHERE IT IS STILL BEING WAITED FOR: one already in writing has nothing to record, and a
   closed one is over. */
ok('...only while it is still being waited for',
  /q\.kind === 'dispute' && q\.status !== 'closed' && !q\.inWriting/.test(panel))

/* ---------------- the rest of what the firm asked of this box ---------------- */

/*
 * "IF WE RAISE A DISPUTE, FIRST OF ALL, THERE SHOULD BE A DICTATE SO YOU CAN SPEAK TO THE DISPUTE."
 * It is written with the debtor still on the telephone, and what they are objecting to is the
 * whole of what a liaison has to answer.
 */
ok('what the debtor says can be dictated', /<DictateButton size="small" value=\{description\}/.test(modal))
ok('...through the one dictate control', /from '\.\.\/\.\.\/components\/ui\/Dictate'/.test(modal))
/*
 * "EACH PERSON CAN ONLY ESCALATE IT TO THEIR TEAM LEADER OR TO THE CLIENT LIAISON WHO IS WORKING
 * ON THE FILE, OR TO THE CLIENT LIAISON MANAGER." It offered every pre-legal team leader in the
 * firm, which is how a dispute ends up parked with somebody who has no standing over the person
 * who raised it.
 */
ok('the list offers this person’s own team leader',
  /u\.teamId === actor\.teamId/.test(modal) && /Your team leader/.test(modal))
ok('...not every team leader in the firm', !/Pre-legal team leaders/.test(modal))
ok('...the liaison who looks after this client', /looks after this client/.test(modal))
ok('...and the liaison manager', /u\.role === 'Liaison Manager'/.test(modal)
  && /Liaison manager/.test(modal))
/* AND THE SHORT LIST SAYS IT IS SHORT, or somebody hunts for a name and concludes it is broken. */
ok('...saying so, so a missing name is not read as a fault',
  /Your team leader, the liaison who looks after this client, or the liaison manager\./.test(modal))
/*
 * "I DON'T KNOW WHAT THE CHASE THE CLIENT MEANS." It is not about the client: it is the day this
 * comes back to whoever raised it if nobody has answered it.
 */
ok('the follow-up date says what it is', /Follow it up on/.test(modal))
ok('...and no longer reads as chasing somebody', !/>Chase on</.test(modal))

/* ---------------- and the sequence it starts is dated the moment it starts ---------------- */

/*
 * THE RUN IS CREATED IN SQL AND DATED IN THE APP, so somebody has to ASK.
 *
 * THE FIRM, HAVING MARKED A DISPUTE RECEIVED IN WRITING: "it also doesn't show me the steps for the
 * dispute." The trigger had created the run; nothing called the planner; the run sat at five nodes
 * and nought steps, and the day-1 acknowledgement to the debtor waited for the six o'clock sweep
 * the following morning -- a day of a period the firm answers in ten business days.
 *
 * THIS IS THE SAME FAULT THE HANDOVER HAD AND THE PROMISE HAD. Each was fixed where it happened and
 * the next path to create a run in SQL forgot again, which is why the nudge these call does not
 * take a token: see nudgeWorkflowsForAccount.
 */
const run = read('src/lib/accountRun.ts')
ok('there is a nudge that does not need a token passed to it',
  /export async function nudgeWorkflowsForAccount\(accountId: string\)/.test(run))
/* IT ASKS FOR THE SESSION ITSELF, which is the whole point of it existing beside the other one. */
ok('...which asks for the session itself', /supabase\.auth\.getSession\(\)/.test(run))
/* AND IT GOES THROUGH THE ONE NUDGE, so the fire-and-forget and the one-account rule are stated
   once. Written twice they drift, and the second copy is the one that sweeps the book. */
ok('...and through the one nudge', /if \(token\) nudgeWorkflows\(token, accountId\)/.test(run))

/* RAISING ONE. A verbal dispute starts the sequence asking for it in writing; a written one starts
   the real answer. Both arrive from the trigger with no steps. */
ok('raising a dispute dates the sequence it starts',
  /if \(isDispute && input\.accountId\) void nudgeWorkflowsForAccount\(input\.accountId\)/.test(lib))
/*
 * DISPUTES ONLY. An agent asking a team leader for help and a query about a client's own sheet
 * start no sequence at all; nudging there would fire the account's due steps early for nothing.
 */
ok('...and only a dispute does', /isDispute && input\.accountId/.test(lib))
/* RECEIVING ONE IN WRITING -- the moment the firm named, and the one they watched do nothing. */
ok('the dispute arriving in writing dates the real sequence',
  /if \(context\.accountId\) void nudgeWorkflowsForAccount\(context\.accountId\)/.test(lib))
/*
 * AND BOTH AFTER THE WRITE, never before it: everything above each of them is the firm's own record
 * of what the debtor said, and a sequence started against a dispute whose row then failed to save
 * is a notice the account cannot account for.
 */
const received = lib.slice(lib.indexOf('export async function markDisputeReceived('))
const atUpdate = received.indexOf(".update({ received_on:")
const atNudge = received.indexOf('nudgeWorkflowsForAccount')
ok('...and the sequence is asked for after the dispute is saved', atUpdate > 0 && atNudge > atUpdate)

/* ---------------- a resume does not revive what has nothing left to be about ---------------- */

/*
 * THE FIRM: "there's no active PTP on here, but the workflow is running a PTP." The arrangement had
 * been cancelled, a written dispute held every sequence on the account, and answering the dispute
 * let them all go -- including the one whose every step is about an arrangement that no longer
 * exists. Its next step read "Reminder before the payment".
 *
 * READ AS THE LAST DEFINITION, because schema.sql is append-only and this function is replaced
 * three times in it. The bare name also appears in its own grant, revoke and comment, so the
 * anchor is the whole `create or replace function public.<name>(` -- CLAUDE.md's own trap.
 */
const resumeAt = sql.lastIndexOf('create or replace function public.workflow_resume_account(')
ok('workflow_resume_account is in the schema', resumeAt > 0)
const resume = resumeAt > 0 ? sql.slice(resumeAt, sql.indexOf('$$;', resumeAt)) : ''
/* ENDED, NOT LEFT HELD: a held run is one somebody is expected to let go later, and this one must
   never go again. */
ok('a promise sequence with no live arrangement is ended', /left_reason = 'The arrangement is no longer live'/.test(resume))
/* MATCHED ON THE VERSION'S TRIGGER, the same way the cancel and the hold decide which run they mean
   -- "this version exists to answer exactly this event" is a fact, where "started recently" is a
   guess about clocks. */
ok('...matched on what the sequence is for', /v\.trigger_kind = 'promise_due'/.test(resume))
/* LIVE IS open OR defaulted, which is the rule ptpSchedule applies to every notice merged on this
   account. Cancelled, kept and broken are one answer: there is no undertaking left. */
ok('...where no arrangement is open or defaulted',
  /p\.status in \('open', 'defaulted'\)/.test(resume))
/*
 * AND BEFORE ANYTHING IS LET GO. Written after the resume it would end a run this same call had
 * just set running -- the account would show the sequence starting and stopping, and whatever the
 * app did in between it would have done against a dead arrangement.
 */
const atDead = resume.indexOf("v.trigger_kind = 'promise_due'")
const atResume = resume.indexOf("set state = 'running'")
ok('...and it happens before the resume', atDead > 0 && atResume > 0 && atDead < atResume)
/* A SENT STEP STAYS SENT. It is the record of a message that reached a debtor; only what was still
   to come is cancelled. */
ok('...cancelling only what had not gone', /where s\.run_id = dead\.id and s\.state in \('pending', 'held'\)/.test(resume))

/* ---------------- one open dispute at a time ---------------- */

/*
 * THE FIRM: "there can only be one dispute at a time. A debtor can't have multiple disputes. He can
 * dispute multiple things in one dispute. But there should only be one dispute allowed to be open
 * at a specific time."
 *
 * IT IS A CLOCK, NOT A NOTE, which is why this is a rule. Each dispute holds the collection
 * sequences the moment it is in writing, runs its own ten business days, and ends with a finding
 * that decides whether a statutory sequence resumes, ends or must be issued again. The firm's own
 * test account carried four, and answering one released sequences another was still holding.
 */
const guardAt = sql.lastIndexOf('create or replace function public.one_open_dispute_per_account(')
ok('the database refuses a second open dispute', guardAt > 0)
const guard = guardAt > 0 ? sql.slice(guardAt, sql.indexOf('$$;', guardAt)) : ''
ok('...only on a dispute', /new\.kind <> 'dispute'/.test(guard))
ok('...only on an open one', /new\.status = 'closed'/.test(guard))
/*
 * AND AN ORDINARY EDIT OF THE ONE ALREADY OPEN IS NOT A SECOND. Moving it to a liaison, marking it
 * received in writing, changing its category -- every one of those is an UPDATE on a row that is
 * already open, and refusing them would make the one open dispute unworkable.
 */
ok('...and an edit of the open one is not a second',
  /tg_op = 'UPDATE'[\s\S]{0,200}?coalesce\(old\.status, ''\) <> 'closed'/.test(guard))
/* THE MESSAGE IS THE POINT: it reaches the collector as it stands, so it says what to do. */
ok('...telling the collector what to do instead',
  /a debtor may dispute several things, but only in one dispute at a time/.test(guard))
/* BEFORE, so nothing is written and then undone. */
const trigAt = sql.lastIndexOf('create trigger one_open_dispute_per_account')
ok('...on a trigger that runs before the write', trigAt > 0
  && /before insert or update of status, kind, account_id/.test(sql.slice(trigAt, trigAt + 300)))

/*
 * AND THE SCREENS NEVER OFFER ONE. The refusal is good and it arrives too late: a collector has
 * chosen a classification and typed out what the debtor said, with the debtor on the telephone.
 * CLAUDE.md's rule about a button that appears to work and does not, on the one screen where the
 * cost of it is somebody's words.
 */
ok('there is one function for what is already open',
  /export function openDisputeOn\(queries: AccountQuery\[\]\): AccountQuery \| null/.test(lib))
/* WRITTEN ONCE BECAUSE TWO SCREENS RAISE A DISPUTE, and the half that drifts is the one that
   offers a second the database then refuses. */
ok('...used by the panel', /openDisputeOn\(queries\)/.test(panel))
const detail = read('src/pages/accounts/AccountDetail.tsx')
ok('...and by the escalate box', /alreadyDisputed=\{openDisputeOn\(queries\) !== null\}/.test(detail))
/* THE PANEL: no control at all, and a line where it was saying why. */
ok('the panel does not offer a second', /\{!alreadyDisputed && \(/.test(panel))
ok('...saying several things go in one dispute',
  /A debtor may dispute several things, but in one/.test(panel))
/* THE BOX: shown and unselectable rather than removed -- a missing option reads as a screen that is
   broken or a permission somebody lacks. */
ok('the escalate box bars the dispute option', /const barred = k === 'dispute' && alreadyDisputed/.test(modal))
ok('...visibly rather than by removing it', /disabled=\{barred\}/.test(modal))
ok('...with the reason in place of the blurb',
  /barred\s*\?\s*'There is already an open dispute on this account\./.test(modal))
/* AND IT DOES NOT OPEN ON AN OPTION THAT CANNOT BE CHOSEN. */
ok('...and opens on one that can be',
  /useState<EscalationKind>\(alreadyDisputed \? 'help' : 'dispute'\)/.test(modal))
/*
 * THE OTHER TWO KINDS ARE UNTOUCHED. Asking a team leader for help and recommending litigation
 * start no clock and hold nothing; an open dispute is no reason to refuse either, and barring them
 * would leave a collector with an open dispute unable to ask anybody anything.
 */
ok('...while the other escalations still go', /k === 'dispute' && alreadyDisputed/.test(modal)
  && !/alreadyDisputed \? true/.test(modal))

/* ---------------- one box raises a dispute, and it is this one ---------------- */

/*
 * THE FIRM: "I really like the way that the dispute is captured in the escalate. But if you raise a
 * dispute in that little box down there, it doesn't do the same."
 *
 * IT DID NOT, AND NONE OF IT WAS COSMETIC. The panel's own form never asked how the dispute reached
 * us, so every dispute raised from the account page was verbal and the written sequence was
 * unreachable from that screen; it could not be dictated; it offered every user in the firm as the
 * assignee instead of the three people the firm named; it still said "Chase the client on", which
 * the firm asked about by name; and its fee sentence was a year out of date.
 *
 * SO THE SECOND BOX IS GONE, not brought up to date. Two screens raising the same thing is
 * CLAUDE.md's one-clause-builder rule in different clothes -- written twice they drift, and what
 * drifts here is which statutory sequence a dispute starts.
 */
ok('the account panel has no form of its own', !/function RaiseForm\(/.test(panel))
/* AND NOTHING THERE RAISES ONE DIRECTLY, which is the assertion that survives somebody rebuilding
   the form under another name. */
ok('...and nothing in it raises a dispute directly', !/raiseQuery\(/.test(panel))
ok('the panel asks for the escalate box instead', /onRaise: \(\) => void/.test(panel)
  && /<button onClick=\{onRaise\}/.test(panel))
/* THE SAME BOX THE ESCALATE BUTTON OPENS -- one modal, one state, so the two entrances cannot get
   different props. */
ok('...and it is the one the Escalate button opens', /onRaise=\{\(\) => setDisputing\(true\)\}/.test(detail))

/* ---------------- and it says what the fee actually costs ---------------- */

/*
 * THE SENTENCE WAS THE GAZETTE'S, NOT THE FIRM'S. It read "it is a total for the account, so it
 * charges nothing if this account has already had it" -- which is how item 3 is worded and not what
 * the firm does. They instructed on 9 September that it is charged PER OCCURRENCE, and a collector
 * reading the old sentence would have expected a free second escalation and charged the debtor R25.
 */
check('item 3 is charged per occurrence, not as a total', ENFORCE_ITEM_TOTALS, false)
ok('...so the box no longer calls it a total for the account',
  !/total for the account/.test(modal))
ok('...and says it is charged each time', /each time the work is done/.test(modal))
/*
 * WHAT STOPS A SECOND ONE IS THE FIRM'S DAILY LIMIT, a different rule with a different answer.
 * HELD AGAINST THE NUMBER ITSELF: raising the limit without rewriting this sentence fails here
 * rather than leaving the screen quietly wrong for another year.
 */
check('a perusal may be charged once a day', DAILY_LIMIT.perusal, 1)
ok('...which is what the box tells the collector', /only once a day on an account/.test(modal))

console.log(`\ncheck-dispute-stage: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
