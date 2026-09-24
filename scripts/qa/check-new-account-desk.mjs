/**
 * AN ACCOUNT OPENED BY HAND GETS A CLERK AND A DATE, LIKE EVERY OTHER ACCOUNT.
 *
 * The firm: "once you've added an account manually in a client, it should do the same thing --
 * it should take you to the assign and refer page to diarise, and it should be allocated to a
 * person. A new account needs to be allocated to a person, needs to be diarised... Any account
 * that's with a clerk or on the book and active should be in a diary."
 *
 * Adding a debtor by hand wrote the row and navigated to the account screen. So an account a
 * client telephoned in arrived on nobody's desk and in nobody's diary -- which is the state the
 * hand-out screen exists to end, reached through the one door that went round it. Every other
 * way into the book (a Swordfish batch, a bulk shuffle) goes through commitHandOut, where the
 * firm's rule is already law: there is no allocate-only mode, so allocating always diarises.
 *
 * WHAT THIS GUARDS:
 *
 *   - THE BY-HAND DOOR ENDS AT ASSIGN AND REFER, not at the account screen.
 *   - IT IS THE SAME SCREEN, not a second allocation form written beside the first. Two forms
 *     drift, and the one nobody looks at is the one that forgets the diary entry.
 *   - CLOSING IT IS NOT SILENT. The row exists before anybody can be given it, so dismissing the
 *     screen cannot roll it back -- and an account left on nobody's desk has to SAY so.
 *   - AND CREATING STILL DOES NOT ALLOCATE. toAccountRow must not invent a clerk: who gets the
 *     account is a decision, and a default would make it silently.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-new-account-desk.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { toAccountRow } from '../../src/lib/newDebtor.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

const client = read('src/pages/companies/CompanyDetail.tsx')
const writer = read('src/lib/handOutWrite.ts')
const modal = read('src/pages/accounts/HandOutModal.tsx')

ok('the client screen is readable at all', client.length > 0)
ok('the hand-out writer is readable at all', writer.length > 0)

/* ------------------------------------------------ creating does not decide who gets it */

/*
 * ASSERTED ON THE ROW THE FUNCTION ACTUALLY BUILDS, not on a search of the file. A default
 * written as `assigned_to: someId` and a default written as a spread both read as source that
 * mentions nothing; running it is what shows the column is absent.
 */
const row = toAccountRow({
  accountNumber: 'X1', clientReference: 'C1', firstName: 'A', surname: 'B',
  idNumber: '', capital: '1000', handoverDate: '2026-09-24', interestRateAnnual: '24',
  mobile: '', workPhone: '', altNumber: '', email: '', address: '', employer: '',
  kin1Name: '', kin1Phone: '', kin2Name: '', kin2Phone: '',
}, 'company-1', null, null)
ok('opening an account does not hand it to anybody', !('assigned_to' in row))
/* It is still a live account, which is what makes the rule bite: active means a clerk and a date. */
check('...and it opens active', row.status, 'Active: Activated')

/* ------------------------------------------------ the by-hand door ends at assign and refer */

/*
 * THE RULE, NOT THE LINE. Asserted as "the create handler hands off to the hand-out state", so
 * moving the navigate or renaming the variable does not matter -- what matters is that the path
 * out of creating an account is the screen that gives it a person.
 */
/*
 * ANCHORED ON THE SAVE HANDLER, not on the first `setDebtorOpen(false)` in the file -- that one
 * is the modal's own onClose, several lines ABOVE the handler, so the slice started too early and
 * reported red on correct code. Anchor on something only the save path has.
 */
const created = client.indexOf('onSave={async (input: NewDebtorInput')
ok('the create handler is where this check thinks it is', created > 0)
const afterCreate = client.slice(created, client.indexOf('{ownerOpen && (', created))
ok('opening an account by hand goes on to assign and refer',
  /setHandOutNew\(account\.id\)/.test(afterCreate))
/*
 * AND NOT STRAIGHT TO THE ACCOUNT, which is what it did. Asserted inside the create handler
 * rather than over the file: CompanyDetail navigates to plenty of other places legitimately.
 */
ok('...and not straight to the account screen, which skipped both',
  !/navigate\(`\/accounts\/\$\{account\.id\}`\)/.test(afterCreate))

/* ------------------------------------------------ the same screen, not a second one */

ok('the client screen opens the hand-out screen itself', /<HandOutModal/.test(client))
ok('...imported from the accounts page, rather than copied',
  /import \{ HandOutModal \} from '\.\.\/accounts\/HandOutModal'/.test(client))
/*
 * ON EXACTLY THE ONE ACCOUNT. A selection built from a filter would be whatever the filter
 * matched at that moment, which on a client's book is every account they have.
 */
ok('...on a selection of exactly the account just opened',
  /kind: 'ids', ids: \[handOutNew\]/.test(client))
/*
 * AND THERE IS NO SECOND ALLOCATION FORM. The firm's rule -- allocating always diaries -- lives
 * in commitHandOut, so anything that writes assigned_to elsewhere is a way round it.
 */
ok('the client screen never writes an allocation itself',
  !/assigned_to/.test(client))

/* ------------------------------------------------ closing it is not silent */

/*
 * THE ACCOUNT IS ALREADY REAL by the time the hand-out screen opens -- it has to be, before
 * anybody can be given it -- so dismissing cannot undo it. What it must not do is say nothing.
 */
ok('dismissing the screen is recorded rather than swallowed',
  /setHandOutNote\(handOutNew\)/.test(client))
ok('...and the person is told the account has no clerk and no date',
  /on nobody&rsquo;s desk and in nobody&rsquo;s/.test(client))
ok('...with the way to finish it, not just a complaint',
  /Assign and refer\s*<\/button>/.test(client))

/* ------------------------------------------------ and the rule underneath is still the rule */

/*
 * THE REASON THIS IS ENOUGH. Routing to the hand-out screen only allocates AND diarises because
 * commitHandOut has no allocate-only mode. If that ever gains one, this door quietly becomes
 * another way to put an account on a desk with nobody booked to ring it.
 */
ok('allocating still cannot happen without referring',
  /export type HandOutMode = 'refer' \| 'allocate_and_refer'/.test(writer))
ok('...and the writer still says why there is no allocate-only',
  /no "allocate only"/i.test(writer))
/*
 * AND A BRAND-NEW ACCOUNT CANNOT BE REFERRED ONLY. It is on nobody's desk, so there is no owner
 * for a referral to leave in place -- the modal disables the choice, which is what makes
 * "allocated to a person" the only way out of this screen for a new account.
 */
ok('refer-only is refused when everything selected is on nobody’s desk',
  /const referOnlyPossible = unowned === null \|\| unowned < selectedCount/.test(modal))

/* ------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-new-account-desk: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
