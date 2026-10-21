/**
 * THE ALLEGED-DISPUTE SEQUENCE IS RETIRED, AND THE SECTION 129 CARRIES IT.
 *
 * THE FIRM: "let's just leave that out for now, because all of these things are stipulated in the
 * section 129. The matter is seen as undisputed, and that's the way that it stands, and it reminds
 * them already about these things. So for the alleged dispute workflow, I think we can actually
 * delete that... We keep the option to show that there's an alleged dispute, but what we would
 * report to the client is the debtor disputes it, but we've never received anything in writing.
 * Because an alleged dispute should be matched with a dispute."
 *
 * WHAT THIS FILE USED TO BE. It held a three-day schedule -- ask in writing, remind at 48 hours,
 * deemed undisputed at day 4 -- which was itself a correction of a fourteen-day one. Both were
 * answers to the wrong question: the section 129 already gives the debtor ten business days and
 * already tells them what happens if nothing comes, so ANY second sequence is a second clock on
 * the same window, in the firm's own letters, pausing a statutory demand while it runs.
 *
 * SO WHAT IS ASSERTED NOW IS THE ABSENCE, and the two things that make an absence safe: nothing
 * can start it again, and nothing it already started is still going.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-alleged-dispute.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { clientLine } from '../../src/lib/accountNarrative.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const at = (p) => new URL(`../../${p}`, import.meta.url)
const sql = readFileSync(at('supabase/schema.sql'), 'utf8')

/* ---------------------------------------------------------------------------------------------
 * NOTHING CAN START IT AGAIN
 * ------------------------------------------------------------------------------------------- */

/* BOTH VERSIONS, not just the active one. A draft left behind is one press from being published,
   and the press is in the workflow builder where it looks like ordinary work. */
ok('both versions of the sequence are archived',
  /update public\.workflow_versions\s*\n\s*set state = 'archived'[\s\S]{0,260}state in \('active', 'draft'\)/.test(sql))

/*
 * ARCHIVED RATHER THAN DELETED, and the reason is the record rather than the tooling. A run exists
 * against the active version with notices already posted to a real debtor, and the version is what
 * says what those notices WERE. Deleting it leaves a debtor's file pointing at nothing.
 */
ok('...and the versions themselves are kept',
  !/delete\s+from\s+public\.workflow_versions/i.test(sql))
ok('...as are the workflows', !/delete\s+from\s+public\.workflows\b/i.test(sql))

/*
 * AND THE OBSOLETE SCRIPT IS GONE. It published a three-day version of this sequence; run now it
 * would take a workflow the firm has retired and make it live again. A file that undoes a decision
 * is worse than no file, because it looks like maintenance.
 */
ok('the script that would republish it is removed',
  !existsSync(at('scripts/sql/alleged-dispute-three-days.sql')))

/* ---------------------------------------------------------------------------------------------
 * AND NOTHING IT ALREADY STARTED IS STILL GOING
 * ------------------------------------------------------------------------------------------- */

/*
 * ARCHIVING A VERSION DOES NOT STOP A RUN. The run holds its own steps and keeps posting them, so
 * retiring the sequence without this would have left six more notices to go out on an account the
 * firm had just decided should not receive any.
 */
ok('a run already going is stopped', /set state = 'left',\s*\n\s*left_reason = 'The alleged-dispute sequence was retired/.test(sql))
ok('...and its outstanding steps are cancelled',
  /set state = 'cancelled',[\s\S]{0,320}state in \('pending', 'held'\)/.test(sql))
/* HELD STEPS TOO. A held step has not gone either, and one left on a collector's list is how a
   retired sequence posts a letter next month. */
ok('...held ones included', /s\.state in \('pending', 'held'\)/.test(sql))
/* AND ANY HOLD IS ENDED, or the account carries a reason it is paused for a sequence that no
   longer exists. */
ok('...and any hold it placed is ended', /ended_reason = coalesce\(h\.ended_reason, 'The sequence was retired'\)/.test(sql))

/*
 * A SENT STEP STAYS SENT. It is the record of a notice that reached a debtor, and rewriting it
 * would be rewriting the file an attorney reads eighteen months later.
 */
ok('...but what was already sent is untouched',
  !/set state = 'cancelled'[\s\S]{0,320}'sent'/.test(sql))

/*
 * SCOPED TO THIS WORKFLOW, NOT TO THE ACCOUNT, and this is the one that would be catastrophic to
 * get wrong. workflow_exit_account stops EVERY live run on an account; used here it would have
 * stopped the section 129 as well -- the very sequence the firm's decision exists to let continue.
 */
/*
 * COUNTED, NOT MERELY PRESENT, and the first draft of this assertion got it wrong. There are THREE
 * statements -- the steps, the holds, the runs -- and each needs the name on it. A regex asking
 * only whether the name appears anywhere passes while two of the three are unscoped, which is the
 * vacuous assertion CLAUDE.md warns about: it survived deleting the scope from all three, because
 * the name also appears in the `with live as (...)` subquery above them.
 *
 * THREE, AND WHICH THREE MATTERS: the `with live as` subquery the steps statement reads through,
 * the holds statement, and the runs statement. The archive at the top is scoped by its own
 * subselect on `workflows.name` and does not use the alias, so it is asserted separately above.
 */
const scoped = (sql.match(/w\.name = 'Dispute alleged'/g) ?? []).length
check('every statement is scoped to this workflow', scoped, 3)
ok('...rather than to the whole account', !/workflow_exit_account\([\s\S]{0,80}Dispute alleged/.test(sql))

/* ---------------------------------------------------------------------------------------------
 * THE ALLEGATION IS STILL RECORDED, AND THE CLIENT IS TOLD THE DIFFERENCE
 *
 * "We keep the option to show that there's an alleged dispute, but what we would report to the
 * client is the debtor disputes it, but we've never received anything in writing."
 * ------------------------------------------------------------------------------------------- */

const alleged = clientLine({
  position: 'disputed', disputeRaisedOn: '2026-09-21', disputeInWriting: false,
}).happened
const written = clientLine({
  position: 'disputed', disputeRaisedOn: '2026-09-21', disputeInWriting: true,
}).happened

ok('an allegation says nothing has arrived', /nothing in writing/.test(alleged))
/* AND SAYS WHAT THAT MEANS, which is the half a client acts on: the account has not stopped. */
ok('...and that the account stands as undisputed', /stands as undisputed/.test(alleged))
ok('...and that collection continues', /collection continues/.test(alleged))
/* A WRITTEN ONE MUST NOT SAY ANY OF THAT, or a client with a real dispute on their desk is told
   there is nothing to answer. */
ok('a written dispute does not', !/nothing in writing/.test(written))
check('...and reads as it always did', written,
  'The debtor disputed the account on 21 September 2026.')

/*
 * UNDEFINED READS AS IN WRITING. Every caller that ever set disputeRaisedOn was reporting a logged
 * dispute, and a field added today must not silently rewrite what those accounts have already told
 * their clients. Only a caller that KNOWS it is unanswered says so.
 */
check('an unstated one is treated as written',
  clientLine({ position: 'disputed', disputeRaisedOn: '2026-09-21' }).happened, written)

/* AND THE ACCOUNT PAGE PASSES THE UNANSWERED DISPUTE RATHER THAN THE NEWEST. A dispute the firm
   has already decided is not what the account is doing now, and a client told about it would go
   looking for a live file that is finished. */
const page = readFileSync(at('src/pages/accounts/AccountDetail.tsx'), 'utf8')
ok('the page reports the dispute still open',
  /queries\.find\(\(q\) => q\.allegedOn && q\.outcome === null\)/.test(page))
ok('...with whether it arrived in writing', /disputeInWriting: open\.inWriting/.test(page))

console.log(`\ncheck-alleged-dispute: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
