/**
 * Getting the token out of whatever was pasted into the environment variable.
 *
 * Run: node --experimental-strip-types scripts/qa/check-sms-token.mjs
 */
import { readToken } from '../../api/_lib/sms/connectMobile.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (actual === expected) pass++
  else failures.push(`${name}\n     expected "${expected}"\n     actual   "${actual}"`)
}

const TOKEN = 'AbC123xyzAbC123xyzAbC123xyz'

/* ---- the normal case ---- */
check('a bare token is the token', readToken(TOKEN), TOKEN)
check('a trailing newline is dropped', readToken(`${TOKEN}\n`), TOKEN)
check('a leading space is dropped', readToken(`   ${TOKEN}`), TOKEN)
check('surrounding whitespace is dropped', readToken(`\n  ${TOKEN}  \n`), TOKEN)

/* ---- the block a vault actually hands over ---- */
check(
  'a labelled block gives up its token',
  readToken(`Username: raptor\nAPI_Token: ${TOKEN}`),
  TOKEN,
)
check('...however it is spelled', readToken(`api token = ${TOKEN}`), TOKEN)
check('...with a hyphen', readToken(`API-Token: ${TOKEN}`), TOKEN)
check('...called a key', readToken(`API_KEY: ${TOKEN}`), TOKEN)
check('...on its own line after other text', readToken(`Account: raptor\nPassword: hunter2\nToken: ${TOKEN}`), TOKEN)
check('...with Windows line endings', readToken(`Username: raptor\r\nAPI_Token: ${TOKEN}\r\n`), TOKEN)

/* ---- an unlabelled block: the last line is the likelier secret ---- */
check('two bare lines take the second', readToken(`raptor\n${TOKEN}`), TOKEN)
check('...ignoring blank lines', readToken(`raptor\n\n${TOKEN}\n\n`), TOKEN)

/* ---- nothing to read ---- */
check('empty is empty', readToken(''), '')
check('whitespace is empty', readToken('   \n  '), '')
check('undefined is empty', readToken(undefined), '')
check('null is empty', readToken(null), '')

/* ---- a token that merely contains the word is not mangled ---- */
check('a token is not cut at an inner colon', readToken('abc:def:ghi'), 'abc:def:ghi')


/* ---- the shape Connect Mobile actually sends ---- */

/*
 * Their credential sheet, as it arrives: a title, two lines of prose, then labelled fields with
 * the token on the line AFTER its label. Somebody pasting the whole thing into an environment
 * variable is the likely accident, and pulling the token out of it beats failing to send with a
 * message about a missing variable that is plainly there.
 *
 * The token below is invented. The real one never appears in this repository.
 */
const SHEET = [
  'Raptor API Credentials',
  '',
  'Hi Stephan',
  '',
  'Please see integration details for Raptor service below.',
  'As a security precaution it is advisable to use an API token to conclude HTTP integration.',
  '',
  'Host: sms.connect-mobile.co.za',
  'Username/AccountID: raptor',
  'API Token:',
  TOKEN,
  '',
  'Kind regards,',
  'Connect Mobile',
].join('\n')

check('the token is found in a whole credential sheet', readToken(SHEET), TOKEN)
// The two fields above it must not be mistaken for the secret.
check('the host is not mistaken for the token', readToken(SHEET) === 'sms.connect-mobile.co.za', false)
check('the account id is not mistaken for the token', readToken(SHEET) === 'raptor', false)
check('nor is the sign-off', readToken(SHEET) === 'Mobile', false)

console.log(`${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  !! ${f}`)
process.exit(failures.length ? 1 : 0)
