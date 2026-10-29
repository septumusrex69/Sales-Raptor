/**
 * A PORTAL LOGIN SIGNS IN WITH A PASSWORD; THE EMAILED CODE IS THE FIRST VISIT AND THE RESET (S16, Raptor ·
 * Handover 15). Stephan: "I want ... a password. So I'm still receiving emails. With codes. Shouldn't be like
 * that." Holds the rules, the hashing (salted, keyed, never the password itself) and the server's wiring:
 * one answer for every wrong sign-in, a lock after five, and a password set only by a signed-in browser.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-portal-password.mjs
 */
import fs from 'node:fs'
import crypto from 'node:crypto'

process.env.EMAIL_CREDENTIALS_KEY = crypto.randomBytes(32).toString('base64')
const { portalPasswordProblem, PORTAL_PASSWORD_FAILURES, PORTAL_PASSWORD_WRONG } = await import('../../src/lib/clientPortal.ts')
const { hashPassword, passwordMatches } = await import('../../api/_lib/crypto.ts')

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`)
}
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

/* The rules. */
check('a short password is refused', portalPasswordProblem('abc1234', 'a@b.co.za') !== null, true)
check('a long phrase will do', portalPasswordProblem('tafelberg sunrise', 'a@b.co.za'), null)
check('one character over and over is refused', portalPasswordProblem('aaaaaaaaaa', 'a@b.co.za') !== null, true)
check('the address itself is refused', portalPasswordProblem('Jan@Alianna.co.za', 'jan@alianna.co.za') !== null, true)
check('nothing at all is refused', portalPasswordProblem(undefined, null) !== null, true)
check('five wrong before the lock', PORTAL_PASSWORD_FAILURES, 5)
check('the wrong answer offers the code, not which half was wrong', /code/i.test(PORTAL_PASSWORD_WRONG) && !/unknown|no such|not found/i.test(PORTAL_PASSWORD_WRONG), true)

/* The hashing. */
const h1 = hashPassword('tafelberg sunrise')
const h2 = hashPassword('tafelberg sunrise')
check('the stored form is scrypt with its parameters', /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/.test(h1), true)
check('the password itself is not in it', h1.includes('tafelberg'), false)
check('salted: the same password hashes differently twice', h1 === h2, false)
check('the right password matches', passwordMatches('tafelberg sunrise', h1), true)
check('a wrong one does not', passwordMatches('tafelberg sunset', h1), false)
check('no stored password matches nothing', passwordMatches('tafelberg sunrise', null), false)
check('a malformed stored value matches nothing', passwordMatches('x', 'plain-text'), false)
process.env.EMAIL_CREDENTIALS_KEY = crypto.randomBytes(32).toString('base64')
check('keyed: under another server key the same hash no longer matches', passwordMatches('tafelberg sunrise', h1), false)

/* The server. */
const api = strip(fs.readFileSync('api/_lib/portal.ts', 'utf8'))
const fn = (name) => { const i = api.indexOf(`const ${name}: Handler`); return i < 0 ? '' : api.slice(i, api.indexOf('\n}\n', i)) }
const signIn = fn('signIn')
check('there is a password sign-in route', /'sign-in': signIn/.test(api) && signIn.length > 0, true)
check('...which compares with passwordMatches, never the typed text', /passwordMatches\(password, user\.password_hash/.test(signIn) && !/password_hash\s*===|===\s*password/.test(signIn), true)
check('...answers every wrong sign-in the same way', (signIn.match(/PORTAL_PASSWORD_WRONG/g) ?? []).length, 1)
check('...refuses a locked login before comparing', signIn.indexOf('password_locked_until') > 0 && signIn.indexOf('password_locked_until') < signIn.indexOf('passwordMatches('), true)
check('...and locks after the fifth', /failures >= PORTAL_PASSWORD_FAILURES/.test(signIn), true)
const setPw = fn('setPassword')
check('a password is set only by a signed-in browser', setPw.indexOf('requirePortalUser') > 0 && setPw.indexOf('requirePortalUser') < setPw.indexOf('hashPassword'), true)
check('...checked against the rules, and stored hashed', /portalPasswordProblem\(password, who\.email\)/.test(setPw) && /password_hash: hashPassword\(/.test(setPw), true)
check('the code sign-in asks for a password when there is none', /needsPassword: !user!\.password_hash/.test(fn('verify')), true)
check('the browser never reads the hash back', /password_hash/.test(strip(fs.readFileSync('src/lib/portalApi.ts', 'utf8'))), false)
const schema = fs.readFileSync('supabase/schema.sql', 'utf8')
check('the columns are in schema.sql', ['password_hash text', 'password_set_at timestamptz', 'password_failures integer', 'password_locked_until timestamptz'].every((c) => schema.includes(c)), true)

/* The screen: the password is the door, the code the way to set it. */
const page = strip(fs.readFileSync('src/pages/portal/PortalPage.tsx', 'utf8'))
check('the sign-in opens on the password', /useState<Step>\('password'\)/.test(page), true)
check('...and a code always ends by choosing a password', /verifyPortalCode\(email, code, true[,)]/.test(page), true)

if (failures.length) {
  console.log(`${failures.length} failed:\n  ${failures.join('\n  ')}`)
  console.log(`${pass} passed, ${failures.length} failed`)
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
