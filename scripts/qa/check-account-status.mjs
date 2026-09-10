/**
 * What counts as written off.
 *
 * The statement drops fees dated after a write-off, and the fee engine must refuse to raise
 * them, or the app charges money it will never show. Both ask this one function.
 *
 * Run: node --experimental-strip-types scripts/qa/check-account-status.mjs
 */
import { isWrittenOff } from '../../src/lib/accountStatus.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (actual === expected) pass++
  else failures.push(`${name}\n     expected ${expected}, got ${actual}`)
}

// The statuses the migrated book actually carries.
check('Written-off', isWrittenOff('Written-off'), true)
check('written off, spaced', isWrittenOff('written off'), true)
check('Written-Off, cased', isWrittenOff('Written-Off'), true)
check('a status that only mentions it', isWrittenOff('Written-off: Paid in Full'), true)
check('Active: Activated', isWrittenOff('Active: Activated'), false)
check('Active', isWrittenOff('Active'), false)
check('Delinquent Payer', isWrittenOff('Delinquent Payer'), false)
check('Legal', isWrittenOff('Legal'), false)
check('null', isWrittenOff(null), false)
check('undefined', isWrittenOff(undefined), false)
check('empty', isWrittenOff(''), false)

console.log(`${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  !! ${f}`)
process.exit(failures.length ? 1 : 0)
