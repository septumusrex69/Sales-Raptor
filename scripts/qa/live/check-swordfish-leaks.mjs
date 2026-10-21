/**
 * NOTHING SWORDFISH ALREADY PAID OVER HAS BEEN SPLIT, FEE'D, PUT IN TRUST OR GIVEN INTEREST.
 *
 * Against a REAL database, because the failure this guards against lived in its triggers (prompt 8:
 * 90 imported receipts became 90 allocations, 90 extra receipt fees, 185 trust creditor entries and
 * 62 engine interest postings). It asks `swordfish_remitted_leaks()` for four counts and fails on
 * any that is not nil.
 *
 * NOT PART OF `npm run qa`, which runs with no network and no credentials. Run it after an import,
 * with the service key of the database you imported into:
 *
 *   SUPABASE_URL=https://<project>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/qa/live/check-swordfish-leaks.mjs
 *
 * WITHOUT CREDENTIALS IT SAYS IT DID NOT RUN, and exits 2 -- never 0. A check that passes because
 * it never looked is the failure this repository keeps meeting.
 */
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.log('check-swordfish-leaks: NOT RUN -- set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(2)
}

const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/swordfish_remitted_leaks`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: '{}',
})
if (!res.ok) {
  console.log(`check-swordfish-leaks: FAILED TO ASK (${res.status}) -- ${await res.text()}`)
  process.exit(1)
}
const [row] = await res.json()
const labels = {
  allocations: 'allocations (splits)',
  receipt_fees: 'Raptor receipt fees',
  trust_entries: 'trust creditor entries',
  engine_interest: 'engine interest postings',
}
let leaked = 0
for (const [k, label] of Object.entries(labels)) {
  const n = Number(row?.[k] ?? NaN)
  /* A count that did not come back is not a nil. */
  const bad = !(n === 0)
  if (bad) leaked += 1
  console.log(`  ${bad ? '✗' : 'ok'}  ${label}: ${Number.isNaN(n) ? 'not returned' : n}`)
}
console.log(leaked
  ? `\ncheck-swordfish-leaks: FAIL -- ${leaked} kind(s) of posting on receipts Swordfish already paid over.`
  : '\ncheck-swordfish-leaks: PASS -- nothing Swordfish paid over has been split, fee\'d, put in trust or given interest.')
process.exit(leaked ? 1 : 0)
