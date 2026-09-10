/**
 * BuzzBox organisation resolution.
 *
 * The one thing a live account taught us that the spec did not: a DomainAdmin login cannot
 * list the organisations it can see, because BuzzBox checks read access on each one and
 * refuses the whole call -- while naming, in the refusal, the organisations the login
 * actually holds. These checks cover reading that back out and turning it into an answer.
 *
 * Run: node --experimental-strip-types scripts/qa/check-buzzbox.mjs
 */
import {
  BuzzBoxError,
  listReadableOrganisations,
  organisationsFromPermissionError,
  normaliseDialNumber,
} from '../../api/_lib/buzzbox.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push(`${name}\n     expected ${e}\n     actual   ${a}`)
}
async function throws(name, fn, expectedMessage) {
  try {
    await fn()
    failures.push(`${name}\n     expected a throw, got a value`)
  } catch (err) {
    check(name, err.message, expectedMessage)
  }
}

/* ---- reading the positions out of a refusal ------------------------------------------- */

// Verbatim from the first live connect attempt, with the identity changed.
const REAL =
  'User at IP 35.181.5.208 with identity camille@example.co.za and user Id 9269 is not allowed '
  + 'READ access to PabxOrganisation with id 2583. Users roles are [DomainAdmin] Users positions '
  + 'are [Administrator in org 2741]'

check('the position is found', organisationsFromPermissionError(REAL), [2741])
check(
  'the REFUSED organisation is not mistaken for a granted one',
  organisationsFromPermissionError(REAL).includes(2583),
  false,
)
check(
  'several positions all come back, in order, deduped',
  organisationsFromPermissionError('Users positions are [Administrator in org 2741, Supervisor in org 90, Administrator in org 2741]'),
  [2741, 90],
)
check('no positions bracket -> nothing', organisationsFromPermissionError('Some other BuzzBox error.'), [])
check('an empty bracket -> nothing', organisationsFromPermissionError('Users positions are []'), [])
check('a position with no org id -> nothing', organisationsFromPermissionError('Users positions are [Administrator]'), [])
check('org 0 is not a position', organisationsFromPermissionError('Users positions are [Administrator in org 0]'), [])
check(
  'roles outside the bracket are not read',
  organisationsFromPermissionError('Users roles are [Admin in org 11] but nothing else'),
  [],
)

/* ---- the fallback fetch --------------------------------------------------------------- */

const JWT = { headerName: 'X-Auth', headerValue: 'token' }
const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const refuse = (description, status = 403) =>
  new Response(JSON.stringify([{ code: 'SEC010', description }]), { status, headers: { 'content-type': 'application/json' } })

const realFetch = globalThis.fetch
let calls = []
function stub(handler) {
  calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    return handler(String(url))
  }
}
const listPath = (u) => /\/pabx-organisations(\?|$)/.test(u)

stub((u) => (listPath(u) ? ok([{ organisationId: 7, name: 'Only One' }]) : refuse('should not be called')))
check('a login that can list is left alone', await listReadableOrganisations(JWT), [{ organisationId: 7, name: 'Only One' }])
check('...and nothing else is fetched', calls.length, 1)

stub((u) => (listPath(u) ? refuse(REAL) : ok({ organisationId: 2741, name: 'Bredell Ferreira' })))
check(
  'a refusal falls back to the organisation it named',
  await listReadableOrganisations(JWT),
  [{ organisationId: 2741, name: 'Bredell Ferreira' }],
)
check('...by fetching that organisation directly', calls[1].endsWith('/pabx-organisations/2741'), true)

// BuzzBox's own docs show organisationId on the object, but a body without it must not
// produce an organisation we cannot address.
stub((u) => (listPath(u) ? refuse(REAL) : ok({ name: 'No Id In Body' })))
check(
  'a body missing its id gets the id we asked for',
  await listReadableOrganisations(JWT),
  [{ name: 'No Id In Body', organisationId: 2741 }],
)

stub((u) =>
  listPath(u)
    ? refuse('Users positions are [Administrator in org 11, Administrator in org 22]')
    : ok({ organisationId: Number(u.split('/').pop()), name: `Org ${u.split('/').pop()}` }),
)
check(
  'two positions become two choices for the admin to pick from',
  await listReadableOrganisations(JWT),
  [{ organisationId: 11, name: 'Org 11' }, { organisationId: 22, name: 'Org 22' }],
)

stub((u) =>
  listPath(u)
    ? refuse('Users positions are [Administrator in org 11, Administrator in org 22]')
    : u.endsWith('/22')
      ? ok({ organisationId: 22, name: 'Org 22' })
      : refuse('nope'),
)
check(
  'a position that turns out to be unreadable is dropped, not offered',
  await listReadableOrganisations(JWT),
  [{ organisationId: 22, name: 'Org 22' }],
)

stub((u) => (listPath(u) ? refuse(REAL) : refuse('cannot read that one either')))
await throws(
  'when nothing named is readable, the original refusal is what surfaces',
  () => listReadableOrganisations(JWT),
  REAL,
)

stub(() => refuse('Something else entirely went wrong.'))
await throws(
  'a refusal naming no positions is passed straight through',
  () => listReadableOrganisations(JWT),
  'Something else entirely went wrong.',
)
check('...without guessing at a second call', calls.length, 1)

stub(() => {
  throw new TypeError('fetch failed')
})
await throws('a network failure is not swallowed', () => listReadableOrganisations(JWT), 'fetch failed')

globalThis.fetch = realFetch

/* ---- dial format (the other thing only a live account settles) ------------------------- */

check('a local number becomes E.164 digits', normaliseDialNumber('082 123 4567'), '27821234567')
check('...and stays local when told to', normaliseDialNumber('082 123 4567', 'local'), '0821234567')
check('an extension is passed through', normaliseDialNumber('204'), '204')

console.log(`${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  !! ${f}`)
process.exit(failures.length ? 1 : 0)
