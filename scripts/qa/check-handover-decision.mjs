/**
 * A handover with a problem waits for a person, and what the person says lands on the account.
 *
 * THE FIRM: "currently you need to go down and read that, but then you have to go back up and
 * remove the account if there is a problem ... it should be in a pending state, and the approving
 * cannot happen if all of the bottom things have not been sorted out. For example an ID number is
 * not correct -- then you could say accept it, or reject it. You can also put in a note to the
 * person working the account: the ID number is wrong and needs to be confirmed. So that goes on
 * the notes or the main comment."
 *
 * WHAT CHANGED IS WHO DECIDES. Approve used to take whatever was importable and leave the rest,
 * so a warning was advice somebody could scroll past -- and forty-five identical warnings under a
 * table is advice everybody scrolls past. The gate is the part worth being sure of: a bug that
 * lets an undecided row through is invisible until a collector rings the wrong person.
 */
import { readFileSync } from 'node:fs'
import {
  canAccept, needsDecision, noteForAccount, readiness, undecided,
} from '../../src/lib/handoverDecision.ts'

let pass = 0
const failures = []
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)

/** A row, with only what the gate reads. */
const row = (over = {}) => ({
  id: over.id ?? 'r1',
  line: over.line ?? 2,
  excluded: over.excluded ?? false,
  decision: over.decision ?? null,
  note: over.note ?? null,
  planned: over.planned === undefined
    ? { problems: [], refused: false }
    : over.planned,
})
const warned = (over = {}) => row({
  ...over, planned: { problems: [{ level: 'warn', message: 'The ID number is not an ID number.' }], refused: false },
})
const refusedRow = (over = {}) => row({
  ...over, planned: { problems: [{ level: 'refuse', message: 'No handover amount.' }], refused: true },
})

/* ---------- 1. what needs deciding ---------- */

check('a clean row needs nothing', needsDecision(row()), false)
check('a warned row needs a decision', needsDecision(warned()), true)
check('a refused row needs one too', needsDecision(refusedRow()), true)
/* A row already rejected is decided, whatever else is wrong with it — otherwise rejecting a
   refused row would leave it still blocking the approval, which is a screen you cannot get out of. */
check('a rejected row is decided', needsDecision(refusedRow({ decision: 'rejected' })), false)
check('an accepted row is decided', needsDecision(warned({ decision: 'accepted' })), false)

/* ---------- 2. the gate ---------- */

check('a clean handover is ready', readiness([row(), row({ id: 'r2', line: 3 })]).ready, true)
check('...and says how many would go in', readiness([row(), row({ id: 'r2', line: 3 })]).importing, 2)

const held = readiness([row(), warned({ id: 'r2', line: 7 })])
check('one undecided warning holds the whole handover', held.ready, false)
ok('...and names the row', /Row 7/.test(held.why ?? ''))
/*
 * THE COUNT COMES OFF THE GATE, NOT OFF `ready`. A button reading "Approve 44 handovers" on a
 * handover the gate is holding is the screen disagreeing with itself, which is the state the firm
 * was looking at when they asked for this.
 */
check('...while still saying what it would import', held.importing, 1)

const decided = readiness([row(), warned({ id: 'r2', line: 7, decision: 'accepted' })])
check('accepting it releases the handover', decided.ready, true)
check('...and the accepted row is imported', decided.importing, 2)

const rejected = readiness([row(), warned({ id: 'r2', line: 7, decision: 'rejected', excluded: true })])
check('rejecting it releases the handover too', rejected.ready, true)
check('...and the rejected row is not imported', rejected.importing, 1)

/* A rejected row whose `excluded` was not set would be rejected on the screen and imported
   anyway. The gate refuses to count it either way, which is the belt to that braces. */
check('a rejected row is never counted in, even unexcluded',
  readiness([warned({ decision: 'rejected', excluded: false })]).importing, 0)

/* Nothing to import is its own refusal, and it has to be: an empty approval creates a batch
   describing no accounts. */
const empty = readiness([refusedRow({ decision: 'rejected', excluded: true })])
check('a handover with everything rejected cannot be approved', empty.ready, false)
ok('...and says why', /Nothing on this handover/.test(empty.why ?? ''))

/* Several waiting rows are listed, not counted at somebody. */
const many = readiness([2, 3, 4, 5, 6, 7].map((line) => warned({ id: `r${line}`, line })))
ok('several waiting rows name the first few', /2, 3, 4, 5/.test(many.why ?? ''))
ok('...and say how many more', /2 more/.test(many.why ?? ''))

/* ---------- 3. what may be accepted ---------- */

check('a warned row may be accepted', canAccept(warned()), true)
/*
 * A REFUSED ROW MAY NOT. There is nothing to accept: no capital, or no date of default, or no
 * name to address a letter from. An Accept on it would be offering to open a ledger that cannot
 * be right, and the firm's own instruction is about an ID number — a warning, not a refusal.
 */
check('a refused row may not be accepted', canAccept(refusedRow()), false)
check('a clean row is not offered a decision at all', canAccept(row()), false)

check('the rows waiting are in file order',
  undecided([warned({ id: 'c', line: 9 }), warned({ id: 'a', line: 3 })]).map((r) => r.id),
  ['a', 'c'])

/* ---------- 4. the note that reaches the account ---------- */

/*
 * THE PROBLEMS GO IN WITH IT. THE FIRM: "a note from admin -- the handover was accepted, but the
 * ID number is incorrect. That's overwritten the flag the account gave. Show it to them."
 *
 * The person accepting knows what they overrode; the collector who picks the account up three
 * weeks later does not, and a note reading only "confirm this" is one nobody can act on.
 */
const note = noteForAccount(warned({ note: 'Confirm the ID with the client.' }))
ok('the typed note leads', note.startsWith('Confirm the ID with the client.'))
ok('...and the problem it overrode is under it', /The ID number is not an ID number\./.test(note))

const noTyped = noteForAccount(warned())
ok('accepted with no note still records what was overridden',
  /Accepted on import/.test(noTyped) && /is not an ID number/.test(noTyped))
check('a clean row with no note writes nothing at all', noteForAccount(row()), null)

/* ---------- 5. the gate is not only on the button ---------- */

const draft = readFileSync(new URL('../../src/lib/handoverDraft.ts', import.meta.url), 'utf8')
const code = draft.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/*
 * A SCREEN IS NOT A RULE. A stale tab whose draft somebody else has since edited would post an
 * approval the firm's condition says must not happen, so approveDraft checks the same gate. Same
 * function, so the two cannot come to different answers.
 */
ok('approveDraft refuses a handover the gate is holding', /gate\.ready/.test(code))
ok('...using the same readiness() the screen uses', /readiness\(/.test(code))
/* And the rejection has to set BOTH, or a row is rejected on screen and imported anyway. */
ok('rejecting a row also excludes it',
  /rejectDraftRow[\s\S]{0,220}decision: 'rejected'[\s\S]{0,80}excluded: true/.test(code))
ok('the note is written onto the account', /from\('account_notes'\)/.test(code))
ok('...built by noteForAccount rather than assembled again', /noteForAccount\(row\)/.test(code))

/* ---------- 6. our reference is generated ---------- */

/*
 * THE FIRM: "it didn't generate reference numbers for Raptor. I see the client ref, but I don't
 * see the Raptor reference." Nothing asked it to — toDebtorInput reads an account_number column
 * off the sheet, and a client's sheet has no reason to carry ours. So 45 accounts opened with
 * none, and the next read of the same file reported 45 duplicates "of an account with no
 * reference", which is what the firm was looking at.
 */
ok('the approval generates our reference', /nextReferences\(/.test(code))
ok('...off the book as it stands', /fetchAccountReferences\(/.test(code))
ok('...and off the client code', /select\('code'\)/.test(code))
/* A reference the client already carries wins: generating over it would open a second account
   for a debt already on the book. */
ok('a reference already on the sheet is left alone',
  /if \(!debtor\.accountNumber\.trim\(\)\)/.test(code))

/* ---------------------------------------------------------------- report */

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A warning is now a question rather than a sentence under a table: every row carrying one is
answered before anything is imported, the answer is recorded against the row, and what somebody
typed reaches the account together with the problem it overrode. The gate is checked on the button
and again on the approval, by one function.`)
