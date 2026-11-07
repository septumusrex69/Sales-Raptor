/**
 * THE STATUS PILL SAYS THE STATE, NOT SWORDFISH'S PROVENANCE (S19; Stephan, 7 Nov: "Active: Activated, what does that
 * mean? ... it's a live account?"). The three Active statuses differ only in how the account became live, so all
 * three read "Active" and the history goes on the hover. See statusWord in src/lib/accountStatus.ts.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-status-word.mjs
 */
import { statusWord } from '../../src/lib/accountStatus.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
for (const s of ['Active: Activated', 'Active: Re-opened', 'Active: Unfrozen', 'Active']) check(`${s} reads Active`, statusWord(s).word, 'Active')
check('Activated: live since it was loaded', statusWord('Active: Activated').meaning, 'A live account, being worked (live since it was loaded).')
check('Re-opened says so on the hover', /closed once, then opened again/.test(statusWord('Active: Re-opened').meaning), true)
check('Unfrozen says so on the hover', /frozen once, then restarted/.test(statusWord('Active: Unfrozen').meaning), true)
check('Frozen stays Frozen', statusWord('Frozen').word, 'Frozen')
check('Written-off reads Written off', statusWord('Written-off').word, 'Written off')
check('nothing recorded is a dash', statusWord(null).word, '—')
check('an unknown status is shown as it is', statusWord('Legal').word, 'Legal')

console.log(`check-status-word: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
if (failures.length) process.exit(1)
