/**
 * One bug, one email.
 *
 * The alert is only useful while people read it, and they stop reading it the day it sends forty
 * copies of the same thing. So the fingerprint must call two reports of the same bug the same --
 * across deploys, record ids and amounts -- and still tell two different bugs apart.
 *
 *   node --experimental-strip-types --import ./scripts/qa/tsresolve.mjs scripts/qa/check-error-alert.mjs
 */
import { fingerprint, recordError } from '../../api/_lib/errorAlert.ts'

let pass = 0
const failures = []
const check = (name, ok) => { if (ok) pass++; else failures.push(name) }

const stack = (hash, line) =>
  `TypeError: x is undefined\n    at AccountDetail (https://sales-raptor.vercel.app/assets/AccountDetail-${hash}.js:${line}:17)`
const base = { source: 'render', message: "TypeError: Cannot read properties of undefined (reading 'balance')" }

check('same bug, next deploy (new chunk hash, moved line)',
  fingerprint({ ...base, stack: stack('D8EMq2SC', 120) }) === fingerprint({ ...base, stack: stack('Zx91KkQa', 131) }))
check('same bug, different record id in the message',
  fingerprint({ source: 'promise', message: 'Account 3f2a1c9e-1111-2222-3333-444455556666 not found' })
    === fingerprint({ source: 'promise', message: 'Account 9b8c7d6e-aaaa-bbbb-cccc-ddddeeeeffff not found' }))
check('same bug, different amount', fingerprint({ source: 'window', message: 'Bad total 1200' }) === fingerprint({ source: 'window', message: 'Bad total 37' }))
check('different message is a different bug', fingerprint(base) !== fingerprint({ ...base, message: 'TypeError: other' }))
check('same message from a different component is a different bug',
  fingerprint({ ...base, stack: stack('a', 1) }) !== fingerprint({ ...base, stack: stack('a', 1).replace('AccountDetail', 'LeadDetail') }))
check('render vs promise are kept apart', fingerprint(base) !== fingerprint({ ...base, source: 'promise' }))

// Unconfigured (no database, no Resend key) must not throw: a broken reporter would hide bugs.
delete process.env.ERROR_ALERT_RESEND_KEY
const origError = console.error
console.error = () => {}
const r = await recordError(null, { ...base })
console.error = origError
check('unconfigured: records nothing, emails nothing, does not throw', r.emailed === false)

console.log(`${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  !! ${f}`)
process.exit(failures.length ? 1 : 0)
