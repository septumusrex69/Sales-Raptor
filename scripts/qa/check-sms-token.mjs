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

console.log(`${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  !! ${f}`)
process.exit(failures.length ? 1 : 0)
