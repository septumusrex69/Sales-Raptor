/**
 * UNDOING A HANDOVER, AND THE FOUR THINGS THAT MAKE IT TOO LATE.
 *
 * THE FIRM, after a test import went in twice with no way back inside the app: "make sure that
 * everything is being deleted." The general case behind it is the one worth building for — a
 * client sends the wrong file, or the same file twice, and two hundred accounts open that nobody
 * should be collecting on.
 *
 * THIS IS THE MOST DESTRUCTIVE BUTTON IN RAPTOR and the only one that removes a debtor's account,
 * so what it REFUSES is the whole of its design. The moment money, a remittance, an arrangement
 * or a filed document exists, those accounts have stopped being a mistake and become a record the
 * firm may be asked about; deleting them is destroying evidence rather than undoing an import.
 *
 * AND TWO THINGS DELIBERATELY DO NOT REFUSE IT, which is just as load-bearing:
 *
 *   NOTICES ALREADY SENT. A wrongly imported batch is exactly the case where the handover email
 *   and SMS have gone out, so refusing over them would refuse every batch the firm actually wants
 *   back. They are counted and shown instead — somebody pressing this must know debtors have been
 *   written to, and that is a different thing from being stopped.
 *
 *   FEES RAISED. CLAUDE.md: a fee is raised on the action and only becomes billable once money is
 *   recovered. An unrecovered fee on an account that should never have existed goes with it. A
 *   PAYMENT is the other thing entirely, and it refuses.
 *
 * Run: node scripts/qa/check-handover-discard.mjs
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
/* Comments stripped: most of what follows is about what is ABSENT, and both files explain at
   length what they do not do. The trap this codebase has walked into three times. */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')

const lib = code('src/lib/handoverDiscard.ts')
const card = code('src/components/settings/HandoverImportCard.tsx')
const perms = code('src/lib/permissions.ts')
const schema = read('supabase/schema.sql')

ok('the library is readable at all', lib.length > 1500)

/* ---------------- the four refusals ---------------- */

/*
 * EACH ONE NAMED, because "it refuses when something has happened" is not a rule anybody can
 * check. These are the four, and a fifth kind of evidence appearing later should be added here
 * rather than discovered when a client asks where their account went.
 */
for (const [table, why] of [
  ['account_payments', 'a payment has been received'],
  ['payover_run_lines', 'a remittance has gone to the client'],
  ['promises_to_pay', 'the debtor has made an arrangement'],
  ['account_documents', 'a document is filed on the account'],
]) {
  ok(`it refuses where ${why}`, new RegExp(`count\\('${table}'`).test(lib))
}
/* AND THE SENTENCES SAY WHICH, because "this cannot be undone" with no reason is a dead end. */
for (const word of ['payment', 'remittance run', 'arrangement', 'document']) {
  ok(`...and the blocker says so: ${word}`, lib.includes(word))
}

/*
 * ASKED AGAIN INSIDE THE WRITE, not only before the button is drawn. A screen is not a rule: a
 * tab left open while somebody takes a payment would otherwise discard an account that had become
 * real in the meantime.
 */
ok('the blockers are re-read at the moment of writing',
  /const blockers = await discardBlockers\(ids\)[\s\S]{0,200}throw new Error/.test(lib))
ok('...and the refusal is a throw, not a quiet skip',
  /This handover can no longer be undone/.test(lib))

/* ---------------- and the two that must NOT refuse ---------------- */

/*
 * THE ASSERTION MOST LIKELY TO BE "FIXED" INTO A BUG. Adding sent notices or raised fees to the
 * blocker list reads like extra safety and would make the feature refuse the exact case the firm
 * asked for it. Held as an absence, and the reasons are in the file above.
 */
/* READ OUT OF discardBlockers ITSELF, not the whole file: `fetchDiscardableBatches` counts sent
   notices a few lines away to SHOW them, so a file-wide search finds that and passes while the
   blocker list has quietly grown. Found by adding the count to the blockers and watching this
   assertion stay green. */
const blockerBody = lib.slice(
  lib.indexOf('export async function discardBlockers'),
  lib.indexOf('export async function fetchDiscardableBatches'),
)
ok('the blocker list was actually found', blockerBody.length > 300)
ok('notices already sent do not refuse it', !/workflow_run_steps/.test(blockerBody))
ok('...nor do fees already raised', !/account_fees/.test(blockerBody))
/* FOUR AND ONLY FOUR. A fifth count appearing in here is a refusal nobody decided on. */
check('exactly four things stop it', (blockerBody.match(/count\('/g) ?? []).length, 4)
/* THEY ARE SHOWN INSTEAD, which is the other half: the person pressing it must know. */
ok('notices sent are counted', /noticesSent/.test(lib))
ok('...and said on the screen before it is pressed',
  /already sent to debtors/.test(card))
ok('...and again in the confirmation',
  /already gone to debtors/.test(card))

/* ---------------- what it removes, and what it keeps ---------------- */

ok('it removes the accounts', /from\('debtor_accounts'\)\.delete\(\)\.in\('id', ids\)/.test(lib))
/*
 * AND THE BATCH ROW IS KEPT AND MARKED, not removed. A reversal nobody can see afterwards is
 * indistinguishable from data loss, and "this arrived on the 1st and was discarded on the 2nd by
 * Stephan" is the question asked six months later by somebody holding a client's query.
 */
ok('...and marks the handover rather than removing it',
  /from\('handovers'\)[\s\S]{0,120}\.update\(\{[\s\S]{0,200}discarded_at/.test(lib))
ok('...recording who did it', /discarded_by: input\.by/.test(lib))
ok('...and never deletes the handover row', !/from\('handovers'\)\.delete/.test(lib))
for (const col of ['discarded_at', 'discarded_by', 'discarded_reason']) {
  ok(`${col} exists in the schema`, new RegExp(`add column if not exists ${col}`).test(schema))
}

/*
 * THE ORDER IS THE SAFE ONE: accounts, then the draft, then the mark. A failure halfway leaves a
 * batch that still says it is live rather than one claiming to be discarded with accounts still
 * on the book — which is the direction that can be noticed and retried.
 */
const accountsAt = lib.indexOf("from('debtor_accounts').delete()")
const markAt = lib.indexOf('discarded_at')
ok('the accounts go before the batch is marked', accountsAt > 0 && markAt > accountsAt)

/* ---------------- who may ---------------- */

/*
 * A CAPABILITY, NOT A ROLE READ. check-capabilities excuses exactly four role reads in
 * permissions.ts and each answers something other than "may you"; this answers precisely that.
 * Written as a role first and refused, which is the check doing its job.
 */
ok('the permission goes through can()',
  /canDiscardHandover[\s\S]{0,200}return can\(user, 'handover\.discard'\)/.test(perms))
ok('...and the screen asks it', /canDiscardHandover\(currentUser\)/.test(card))
ok('...before offering the button', /canDiscard \?/.test(card))
/* THE COUNTS ARE NOT THE PRIVILEGE. Everybody who can see the import screen sees what a batch
   holds; only an administrator is offered the button. Hiding the figures as well would make a
   refused discard impossible to understand. */
ok('the batch and its figures are drawn for everybody',
  /batches\.length > 0 && \(/.test(card))

/* ---------------- and it is hard to press by accident ---------------- */

ok('the word has to be typed', /DISCARD/.test(card))
ok('...and nothing happens until it is',
  /typed\.trim\(\)\.toUpperCase\(\) !== 'DISCARD'/.test(card))
/* WHAT IS ABOUT TO GO, IN FIGURES. A confirmation that does not say how many accounts or how much
   capital is one somebody confirms without knowing what they are destroying. */
ok('the confirmation says how many accounts', /discarding\.accounts/.test(card))
ok('...and what they are worth', /formatCurrency\(discarding\.capital\)/.test(card))

/* ---------------- a batch with nothing left is not offered ---------------- */

/*
 * A Discard button beside nothing is a button somebody presses to find out what it does, and on
 * an already-discarded batch it would be the second press that teaches them it is harmless.
 */
ok('a batch whose accounts are gone is left out', /if \(ids\.length === 0\) continue/.test(lib))

console.log(`\ncheck-handover-discard: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
