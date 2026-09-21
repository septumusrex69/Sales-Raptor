/**
 * The firm's own details: that every column reaches the screen, and that the two accounts which
 * both take money IN cannot be confused for one another.
 *
 * WHY THIS FILE EXISTS. CLAUDE.md names the failure precisely: "a column present in the database,
 * in the type and in the select('*') but missing from the mapper reads as `undefined` for ever
 * and nothing fails. `diary_capacity` sat in that state for months." firm_settings went from four
 * fields to eighteen in one sitting at the firm's request, by hand, in five places at once -- the
 * select list, the Row, the interface, the mapper and the update. Five hand-kept lists is five
 * chances to drop a column silently, and a dropped one here is a trust account that reads blank
 * on a section 129.
 *
 * So the schema is the source and everything else is held against it, IN BOTH DIRECTIONS. A
 * column added to the table and forgotten in the mapper fails here; so does a column named in the
 * mapper that the table does not have.
 *
 * COMMENTS ARE STRIPPED FROM EVERYTHING FIRST. schema.sql explains each of these columns by name
 * in the comment above it, and firmSettings.ts names columns in its prose too -- so read as
 * written, a check for "is this column mentioned" is answered by the paragraph explaining it
 * rather than by the code. That trap has caught several checks in this suite.
 */
import { readFileSync } from 'node:fs'
import { bankLine } from '../../src/lib/messageTemplates.ts'

let pass = 0
const failures = []
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
/** SQL and TypeScript comments both, so no assertion is answered by the prose explaining it. */
const code = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/^\s*--.*$/gm, '')

const schema = code(read('../../supabase/schema.sql'))
const lib = read('../../src/lib/firmSettings.ts')
const libCode = code(lib)

/* ---------- 1. what the table actually has ---------- */

/*
 * TWO PLACES, because schema.sql is append-only: the original `create table` and every later
 * `alter table ... add column`. Reading only the create block would have missed all thirteen
 * columns this check was written for, and done it by passing.
 */
const created = schema.match(/create table if not exists public\.firm_settings \(([\s\S]*?)\n\);/)
ok('the firm_settings table is in schema.sql', created !== null)
const columns = new Set()
if (created) {
  for (const line of created[1].split('\n')) {
    const m = line.match(/^\s{2}([a-z_]+)\s+(boolean|text|numeric|timestamptz|uuid)/)
    if (m) columns.add(m[1])
  }
}
for (const [, col] of schema.matchAll(
  /alter table public\.firm_settings\s+add column if not exists ([a-z_]+)/g)) {
  columns.add(col)
}
ok(`the table's columns were found (${columns.size})`, columns.size >= 20)

/*
 * id and updated_by are the two nobody types. `id` is the one-row guard -- a boolean that must be
 * true, so the primary key refuses a second row -- and updated_by is stamped from the session.
 * Everything else is a field on the screen and must survive the round trip.
 */
const NOT_READ = new Set(['id', 'updated_by'])
const wanted = [...columns].filter((c) => !NOT_READ.has(c)).sort()

/* ---------- 2. the select list, in both directions ---------- */

const selectConst = libCode.match(/const COLUMNS = ([\s\S]*?)\n\ninterface Row/)
ok('the select list is a const of string literals', selectConst !== null)
const selected = selectConst
  ? [...selectConst[1].matchAll(/'([^']*)'/g)].flatMap((m) => m[1].split(',')).map((c) => c.trim()).filter(Boolean)
  : []
check('every column the table has is selected', wanted.filter((c) => !selected.includes(c)), [])
check('...and nothing is selected that the table has not',
  selected.filter((c) => !columns.has(c)), [])

/* ---------- 3. the Row, the mapper and the update ---------- */

/*
 * The mapper is the one CLAUDE.md warns about by name, but the UPDATE is the half that loses
 * work rather than a display: a column read and shown and then not written back is a box somebody
 * fills in, saves, and finds empty when they come back.
 */
const row = libCode.match(/interface Row \{([\s\S]*?)\n\}/)
const mapper = libCode.match(/function toSettings\(r: Row\): FirmSettings \{([\s\S]*?)\n\}/)
const update = libCode.match(/\.from\('firm_settings'\)\.update\(\{([\s\S]*?)\n  \}\)/)
ok('the Row is readable', row !== null)
ok('the mapper is readable', mapper !== null)
ok('the update is readable', update !== null)

const named = (block, col) => new RegExp(`\\b${col}\\b`).test(block ?? '')
check('every selected column is in the Row type',
  selected.filter((c) => !named(row?.[1], c)), [])
check('every selected column is read by the mapper',
  selected.filter((c) => !named(mapper?.[1], c)), [])
/* updated_at is the exception and the only one: the update stamps it rather than echoing what
   was read back, so it is written -- just not from the draft. */
check('every selected column is written back by the update',
  selected.filter((c) => !named(update?.[1], c)), [])

/* ---------- 4. the unset defaults ---------- */

/*
 * NULL, NOT ''. renderTemplate leaves an unresolved field STANDING on the page and prints an
 * empty string as a blank line. One of those gets caught before the notice is posted; the other
 * gets posted, on a section 129 with a blank where the trust account should be.
 */
const iface = libCode.match(/export interface FirmSettings \{([\s\S]*?)\n\}/)
const unset = libCode.match(/export const FIRM_UNSET: FirmSettings = \{([\s\S]*?)\n\}/)
ok('the interface and the unset defaults are readable', iface !== null && unset !== null)
const keys = iface ? [...iface[1].matchAll(/^\s{2}([a-zA-Z]+)[?]?:/gm)].map((m) => m[1]) : []
ok(`the interface's fields were found (${keys.length})`, keys.length >= 20)
check('every field has an unset default', keys.filter((k) => !named(unset?.[1], k)), [])
ok('and the defaults that are not set are null, never an empty string',
  !/: ''/.test((unset?.[1] ?? '').replace(/updatedAt: ''/, '')))

/* ---------- 5. three directions of money ---------- */

/*
 * THE EXPENSIVE MISTAKE THIS WHOLE TABLE IS SHAPED AROUND. A debtor pays IN to the trust account.
 * A client pays the firm IN to the business account, for commission still outstanding -- the
 * firm's words, "there's also an account that is still outstanding with our client". And a client
 * is remitted OUT from companies.banking_details, which is a different table entirely.
 *
 * Crossing any two of them is money in the wrong account, discovered at month end rather than on
 * the day. So: the firm's settings never read the client's banking details, and the two accounts
 * that both take money in are separate columns rather than one field somebody switches.
 */
ok('the firm’s details never read the client’s banking details',
  !/banking_details/.test(libCode))
for (const col of ['trust_bank', 'trust_branch_code', 'trust_account_name', 'trust_account_number',
  'business_bank', 'business_branch_code', 'business_account_name', 'business_account_number']) {
  check(`${col} is its own column`, columns.has(col), true)
}

/* ---------- 6. what the screen says is missing ---------- */

/*
 * A WARNING THAT NAMES WHAT IS MISSING. CLAUDE.md: a warning that fires when nothing is wrong is
 * worse than none. The corollary, learned on this screen: one that fires without saying what to
 * do is read once and skipped. missingTrust returns the gaps in the firm's own words and the card
 * renders nothing at all when there are none.
 */
const screen = code(read('../../src/pages/library/FirmSettings.tsx'))
const missing = screen.match(/function missingTrust\(s: FirmSettings\): string\[\] \{([\s\S]*?)\n\}/)
ok('the screen works out what is missing rather than saying "something"', missing !== null)
for (const field of ['trustBank', 'trustBranchCode', 'trustAccountName', 'trustAccountNumber']) {
  ok(`...naming ${field} when it is not filled in`, named(missing?.[1], field))
}
ok('...and says nothing when nothing is missing', /return gaps/.test(missing?.[1] ?? ''))
ok('the warning is only rendered when there is one',
  /\{trustGaps\.length > 0 && \(/.test(screen))
/*
 * READ OFF WHAT IS SAVED, NOT WHAT IS BEING TYPED. Against the draft, the warning appears and
 * disappears letter by letter while somebody fills the box in -- which is a warning that fires
 * when nothing is wrong, several times a second.
 */
ok('...and against the saved row, not the half-typed draft', /missingTrust\(row\)/.test(screen))

/*
 * THE SECOND OFFICE LINE IS THE FIRM'S, NOT A PERSON'S.
 *
 * The firm: "each clerk will have their own dedicated number ... we'll put that in when we load
 * the clerk as a user." firm_settings is ONE ROW, so a clerk's direct number typed into this box
 * would print on every notice the firm sends regardless of who actually holds the account -- and
 * it would look right to the person who typed it. Nothing can stop that at the database; the only
 * thing that can is the box saying what it is for, so the box has to keep saying it.
 *
 * A clerk's own number already has a home: profiles.phone, which fills {{agent_phone}} and
 * follows the account when it is handed out.
 */
const secondLine = screen.match(/text\('phoneAlt',([\s\S]*?)\)\}/)
ok('the second number is labelled as the office\u2019s', /Second office line/.test(secondLine?.[1] ?? ''))
ok('...and says where a person\u2019s own number goes instead',
  /user profile/.test(secondLine?.[1] ?? '') && /agent_phone/.test(secondLine?.[1] ?? ''))

/* ---------- 7. the business account cannot reach a debtor ---------- */

/*
 * The protection is the vocabulary, not a warning: there is no collections merge field that names
 * the business account, and templateProblems refuses a field outside the template's scope, so a
 * section 129 asking for it does not save. Asserted in full in check-message-templates; asserted
 * here too because THIS is the file somebody reads when they add the next bank account.
 */
const templates = code(read('../../src/lib/messageTemplates.ts'))
const collections = templates.match(/collections: \[([\s\S]*?)\n  \],/)
ok('the collections vocabulary is readable', collections !== null)
ok('no collections field names the business account',
  !/firm_business/.test(collections?.[1] ?? 'firm_business'))

/* ---------- 8. the join, from the library's side ---------- */

check('the bank and the branch code print as one line where a template asks for one',
  bankLine('Standard Bank', '051001'), 'Standard Bank · 051001')

/* ---------------------------------------------------------------- report */

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The firm's own details held against the table they live in, in both directions, so a column added
to firm_settings and forgotten in one of the five hand-written lists fails here rather than
reading blank on a section 129 -- and the two accounts that both take money IN kept apart, in the
columns and in the vocabulary, because a debtor paying into the business account is trust money in
the wrong place found at month end.`)
