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
 * RUNNING IT
 * ------------------------------------------------------------------------------------------------
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   node scripts/letters/seed-aod.mjs
 *
 * The service role key is needed because message_templates is not writable by an anonymous
 * client. It is read from the environment and never written anywhere -- not into a file, not into
 * the repository, which is public.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { covering } from './aod.mjs'

const URL_BASE = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_BASE || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. See the header of this file.')
  process.exit(1)
}

const letters = JSON.parse(readFileSync(new URL('./letters.json', import.meta.url), 'utf8'))

/** The four rows, in the order a reader meets them. */
const rows = ['individual', 'company'].flatMap((kind) => {
  const who = kind === 'company' ? 'company' : 'individual'
  return [
    {
      scope: 'collections',
      kind: 'letter',
      name: `Acknowledgement of debt (${who})`,
      subject: null,
      format: 'text',
      body: JSON.stringify(letters[`letter-aod-${kind}`]),
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
    },
  ]
})

const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex')

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

/* OUT FIRST, so a re-run replaces rather than duplicates -- and so a half-written row from an
   earlier attempt cannot survive. */
await rest(`message_templates?name=in.${encodeURIComponent(inList)}`, { method: 'DELETE' })
await rest('message_templates', {
  method: 'POST',
  headers: { prefer: 'return=minimal' },
  body: JSON.stringify(rows),
})

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
