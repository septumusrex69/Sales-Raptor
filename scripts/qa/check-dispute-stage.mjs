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

console.log(`\ncheck-dispute-stage: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
