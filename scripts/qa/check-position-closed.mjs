/**
 * EVERY POSITION IS TOLD WHETHER THE ACCOUNT HAS ENDED (S7).
 *
 * The firm, 13 Oct, on Accounts -> Closed: "it shows that these are still new accounts, but it's in the
 * closed thing." Ending an account sets ended_as and moves it to the closed book; it leaves `status`
 * as it was ('Active' on all 24 of staging's). clientPosition() reads `closed` first and `status`
 * second, and the account page passed `closed` while the list, the diary, the finish box, the planner
 * and the import's linked-account summary did not -- so a closed account nobody worked read "New".
 *
 * Held here: every call to clientPosition / deskPosition / positionReport outside the file that
 * defines them passes `closed:`; and the rung itself says Closed for an ended account whose status
 * still reads Active, never New or In progress.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-position-closed.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { clientPosition, deskPosition } from '../../src/lib/clientPosition.ts'
import { accountEnded } from '../../src/lib/accountStatus.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}

/* Staging's five: status Active, ended, never worked. */
const ended = { status: 'Active', subStatus: null, endedAs: 'closed' }
check('an ended account whose status still reads Active is Closed on our screens',
  deskPosition({ closed: accountEnded(ended), status: ended.status, everWorked: false }), 'closed')
check('...and on the client\'s', clientPosition({ closed: accountEnded(ended), status: ended.status }), 'closed')
check('...where reading status alone said New (the firm\'s screenshot)', deskPosition({ status: 'Active', everWorked: false }), 'new')
check('an account not ended is unaffected', deskPosition({ closed: accountEnded({ status: 'Active', endedAs: null }), status: 'Active', everWorked: false }), 'new')

/* Every caller passes `closed:`. */
const root = new URL('../../src/', import.meta.url).pathname
const files = []
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p) } }
walk(root)
let calls = 0
for (const f of files) {
  if (f.endsWith('lib/clientPosition.ts')) continue
  const src = readFileSync(f, 'utf8')
  const re = /\b(clientPosition|deskPosition|positionReport)\(\{/g
  let m
  while ((m = re.exec(src))) {
    calls += 1
    const body = src.slice(m.index, src.indexOf('})', m.index))
    check(`${f.slice(root.length)}: ${m[1]}() is told whether the account ended`, /\bclosed:/.test(body), true)
  }
}
check('the callers were found (a walk that finds none passes everything)', calls >= 7, true)

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-position-closed: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
