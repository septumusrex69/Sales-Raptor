/**
 * PUT THE TWO ACKNOWLEDGEMENTS OF DEBT INTO A DATABASE.
 *
 * Four rows: a letter and a covering email, for a person and for a company. The documents
 * themselves are built by aod.mjs and live in letters.json, which is the source of truth; this
 * only carries them across.
 *
 * ------------------------------------------------------------------------------------------------
 * WHY THIS IS A SCRIPT AND NOT A MIGRATION
 * ------------------------------------------------------------------------------------------------
 *
 * A letter is 14 kB of JSON and there are two of them. Pasted into schema.sql they would be a
 * third of the file and unreadable, and every later edit to the firm's wording would be a diff
 * nobody can review. The eight notices already in the database arrived the same way.
 *
 * IDEMPOTENT, AND THAT IS NOT A NICETY. It deletes the four rows by name before inserting them, so
 * running it twice leaves four rows rather than eight, and a run that failed half way leaves
 * nothing behind to clean up by hand. It was written after exactly that happened: a chunked insert
 * over a flaky connection left one row holding the first 5 604 characters of a nine-page agreement,
 * which is a template that would merge, draw and send a document ending mid-sentence.
 *
 * IT VERIFIES WHAT IT WROTE. Every row is read back and its body compared to what was sent, because
 * a half-written legal agreement is worse than a missing one: a missing template cannot be chosen
 * from a picker, and a truncated one can.
 *
 * ------------------------------------------------------------------------------------------------
 * TWO WAYS TO RUN IT, BECAUSE A CONNECTION CAN BE ONE-WAY
 * ------------------------------------------------------------------------------------------------
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   node scripts/letters/seed-aod.mjs
 *
 * The service role key is needed because message_templates is not writable by an anonymous
 * client. It is read from the environment and never written anywhere -- not into a file, not into
 * the repository, which is public.
 *
 *   node scripts/letters/seed-aod.mjs --sql > scripts/letters/seed-aod.sql
 *
 * WRITES THE SAME FOUR ROWS AS SQL instead of sending them, for pasting into Supabase's own SQL
 * editor. This exists because it was needed: the session that wrote these documents could READ the
 * database and every write timed out, which is a state no amount of retrying gets out of. The SQL
 * is generated from the same `rows` array below rather than kept by hand, so the two routes cannot
 * come to mean different things -- which is the whole reason it is a flag here and not a file
 * somebody maintains.
 *
 * It is one transaction and it deletes by name first, exactly as the REST path does, so a paste
 * that fails half way leaves the table as it was rather than holding half an agreement.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { covering } from './aod.mjs'

const letters = JSON.parse(readFileSync(new URL('./letters.json', import.meta.url), 'utf8'))

/**
 * The four rows, in the order a reader meets them.
 *
 * `seed_key` IS WHAT MAKES ANY OF THIS WORK TWICE. It is the one identifier the app never lets
 * anybody edit, so it is what re-running this keys on and what the compose box's own list is
 * written against -- BY_HAND_SEED_KEYS names `email-aod-individual` and `email-aod-company`, and
 * a row seeded without them would be a template the firm can see in the Library and cannot pick.
 *
 * `audience` IS NOT COSMETIC EITHER: the workflow and the composer choose between a person's
 * wording and a company's by this column, and null means "suits either", which these do not.
 *
 * AND `format` IS THE ONE THAT WAS WRONG. A letter's body is letterDocument JSON, and
 * `format = 'document'` is how everything that reads the library knows that -- AttachLetter
 * filters on it, the Library's preview parses on it, and the editor opens the page editor on it.
 * The first draft of this file wrote 'text' for the letters, copying the eight notices already in
 * the database, which turns out to be where the mistake came from: all twelve of those carry
 * 'text' too, so the Attach control in a compose box lists NOTHING on staging. The workflow
 * runner never noticed because it parses the body regardless of the column (step.ts lettersFor),
 * which is exactly how a wrong value survives -- the automatic path does not read it and the one
 * a person uses does. seed-aod.sql corrects those twelve as well.
 */
const rows = ['individual', 'company'].flatMap((kind) => {
  const who = kind === 'company' ? 'company' : 'individual'
  return [
    {
      scope: 'collections',
      kind: 'letter',
      name: `Acknowledgement of debt (${who})`,
      subject: null,
      format: 'document',
      body: JSON.stringify(letters[`letter-aod-${kind}`]),
      seed_key: `letter-aod-${kind}`,
      audience: who,
    },
    {
      scope: 'collections',
      kind: 'email',
      name: `Acknowledgement of debt — covering email (${who})`,
      /* NAMES THE ACCOUNT, because this arrives in an inbox beside the firm's other mail and the
         debtor has to be able to tell which account it is about before opening it. */
      subject: 'Acknowledgement of debt for signature — account {{account_number}}',
      format: 'text',
      body: covering(kind),
      seed_key: `email-aod-${kind}`,
      audience: who,
    },
  ]
})

const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex')

/* ------------------------------------------------------------------------------------------------
 * THE SQL ROUTE
 *
 * DOLLAR-QUOTED, never '' escaped. A nine-page agreement is JSON full of double quotes and
 * backslashes and the covering emails carry apostrophes; doubling quotes through 14 kB of that by
 * hand is how a letter ends up with a stray character in the middle of a clause. $q$ is checked
 * against every value below rather than assumed -- if the firm's wording ever contains it the
 * script stops instead of writing SQL that ends early.
 * ---------------------------------------------------------------------------------------------- */

const TAG = '$q$'

function quoted(value) {
  if (value === null) return 'null'
  if (String(value).includes(TAG)) {
    throw new Error(`A value contains ${TAG}, which is the quote tag. Change the tag.`)
  }
  return `${TAG}${value}${TAG}`
}

function asSql() {
  const values = rows
    .map((r) => '  (' + [
      quoted(r.scope), quoted(r.kind), quoted(r.name), quoted(r.subject),
      quoted(r.format), quoted(r.body), quoted(r.seed_key), quoted(r.audience), 'true',
    ].join(', ') + ')')
    .join(',\n')
  return [
    '-- The two acknowledgements of debt, and their covering emails.',
    '-- Generated by scripts/letters/seed-aod.mjs --sql. Do not edit by hand; edit aod.mjs and',
    '-- regenerate, or the document in the database stops matching the one in the repository.',
    '-- Safe to run more than once, and it REMOVES NOTHING. See the note on adoption below.',
    'begin;',
    '-- ADOPTED, NOT DELETED, AND THE REASON IS A TOOL RATHER THAN A PREFERENCE.',
    '--',
    '-- This used to delete by seed key and by name before inserting, which is the ordinary way to',
    '-- make a seed re-runnable. It could not be run: every DELETE sent through the session that',
    '-- wrote it hung and rolled back -- proven against a temporary table created in the same',
    '-- statement, so neither locks nor permissions -- and the file sat waiting for somebody to',
    '-- paste it by hand for a week.',
    '--',
    '-- SO THE ONE ROW A DELETE WAS THERE TO CLEAR IS CLAIMED INSTEAD. The first attempt left an',
    '-- "Acknowledgement of debt (individual)" with no seed key and format text; on the next line it',
    '-- is given its key, which makes it the row the upsert below then overwrites in place. Without',
    '-- this the insert would not collide on anything -- name is not unique -- and the Library would',
    '-- show the firm two agreements with one name, one of them unusable.',
    '--',
    '-- NARROW ON PURPOSE: a letter, with that exact name, carrying no key. A row the firm has since',
    '-- renamed is not adopted, because then the name is no longer evidence of where it came from.',
    ...rows.filter((r) => r.kind === 'letter').map((r) =>
      `update public.message_templates set seed_key = '${r.seed_key}'\n`
      + ` where seed_key is null and kind = 'letter' and name = ${quoted(r.name)};`),
    '',
    '-- AND THE SEED ITSELF IS AN UPSERT. seed_key is unique, so a second run overwrites the four',
    '-- rows rather than making four more -- which is the whole of what the delete was buying.',
    'insert into public.message_templates',
    '  (scope, kind, name, subject, format, body, seed_key, audience, active)',
    'values',
    values,
    'on conflict (seed_key) do update set',
    '  scope = excluded.scope, kind = excluded.kind, name = excluded.name,',
    '  subject = excluded.subject, format = excluded.format, body = excluded.body,',
    '  audience = excluded.audience, active = excluded.active, updated_at = now();',
    '',
    '-- AND THE COVERING EMAIL POSTS THE AGREEMENT. Set here rather than in the insert because a',
    '-- row cannot point at an id it does not yet know. The pairing is NOT in attachments.json:',
    '-- that file is the record of which email a WORKFLOW STEP posts a notice with, and no step',
    '-- sends these -- a debtor asks for terms on the telephone, which no sequence can know.',
    'update public.message_templates e',
    "   set attachment_id = l.id",
    '  from public.message_templates l',
    " where e.seed_key = 'email-aod-individual' and l.seed_key = 'letter-aod-individual';",
    'update public.message_templates e',
    "   set attachment_id = l.id",
    '  from public.message_templates l',
    " where e.seed_key = 'email-aod-company' and l.seed_key = 'letter-aod-company';",
    '',
    '-- THE TWELVE NOTICES ALREADY THERE, CORRECTED.',
    '--',
    "-- Every one of them carries format = 'text' with a letterDocument JSON body, which is the",
    '-- same mistake this script made on its first draft. The consequence is not cosmetic: the',
    '-- Attach control in a compose box lists only letters whose format says document, so on this',
    '-- database it lists none of them, and a collector cannot attach a section 129 by hand. The',
    '-- workflow runner parses the body whatever the column says, which is why nobody saw it.',
    '--',
    '-- NARROW ON PURPOSE: only a letter, and only one whose body actually begins as a document.',
    '-- A letter somebody typed as plain words is left alone.',
    'update public.message_templates',
    "   set format = 'document', updated_at = now()",
    ` where kind = 'letter' and format = 'text' and body like '{"defaults":%';`,
    'commit;',
    '',
    '-- Read back what landed. A truncated agreement is worse than a missing one: a missing template',
    '-- cannot be chosen from a picker, and a truncated one can. Expect four rows, at these lengths:',
    ...rows.map((r) => `--   ${r.body.length} chars  ${r.name}`),
    'select name, length(body) as chars from public.message_templates',
    " where name like 'Acknowledgement of debt%' order by name;",
    '',
  ].join('\n')
}

if (process.argv.includes('--sql')) {
  process.stdout.write(asSql())
  process.exit(0)
}

/* EVERYTHING BELOW TALKS TO A DATABASE, so the key is wanted only from here down -- --sql needs no
   credentials at all, which is the point of it. */
const URL_BASE = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_BASE || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --sql to write the SQL.')
  console.error('See the header of this file.')
  process.exit(1)
}

async function rest(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

const names = rows.map((r) => r.name)
const inList = `(${names.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(',')})`

/*
 * OUT FIRST, so a re-run replaces rather than duplicates -- and so a half-written row from an
 * earlier attempt cannot survive.
 *
 * BY KEY AND BY NAME, in that order, for the reason the SQL route says: seed_key is the
 * identifier, a row the firm renamed in the Library would survive a delete by name and then
 * collide on the unique key -- and the row left by the attempt that failed has no key at all, so
 * only the name reaches it.
 */
await rest(
  `message_templates?seed_key=in.(${rows.map((r) => r.seed_key).join(',')})`,
  { method: 'DELETE' },
)
await rest(`message_templates?name=in.${encodeURIComponent(inList)}`, { method: 'DELETE' })
await rest('message_templates', {
  method: 'POST',
  headers: { prefer: 'return=minimal' },
  body: JSON.stringify(rows),
})

/*
 * AND THE COVERING EMAIL POSTS THE AGREEMENT.
 *
 * A second pass, because the email cannot be written with an id the letter does not have yet. Read
 * the four back, then point each email at the letter for the same kind of debtor -- the pairing
 * that matters is the AUDIENCE: a covering note written to a person that posts the company
 * agreement would hand a pensioner a document signed by a duly authorised representative.
 */
const ids = Object.fromEntries(
  (await rest(`message_templates?seed_key=in.(${
    rows.map((r) => r.seed_key).join(',')})&select=id,seed_key`))
    .map((r) => [r.seed_key, r.id]),
)
for (const kind of ['individual', 'company']) {
  const letter = ids[`letter-aod-${kind}`]
  const email = ids[`email-aod-${kind}`]
  if (!letter || !email) continue
  await rest(`message_templates?seed_key=eq.email-aod-${kind}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ attachment_id: letter }),
  })
}

/* AND READ BACK WHAT LANDED. A truncated agreement is worse than a missing one: a missing template
   cannot be chosen from a picker, and a truncated one can. */
const back = await rest(
  `message_templates?name=in.${encodeURIComponent(inList)}&select=name,body`,
)
let bad = 0
for (const want of rows) {
  const got = back.find((r) => r.name === want.name)
  const ok = got && md5(got.body) === md5(want.body)
  if (!ok) bad += 1
  console.log(
    ok ? 'ok  ' : 'FAIL',
    want.name.padEnd(52),
    `${want.body.length} chars`,
    ok ? '' : `(stored ${got ? got.body.length : 'nothing'})`,
  )
}
console.log(bad === 0 ? '\nAll four rows verified.' : `\n${bad} row(s) did not match.`)
process.exit(bad === 0 ? 0 : 1)
