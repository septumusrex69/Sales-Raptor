/**
 * Look at the account page.
 *
 * Supabase is unreachable from this container (the egress policy 403s the CONNECT), so this
 * serves canned rows in the shape PostgREST returns and seeds a session into localStorage.
 * It proves the page RENDERS -- layout, tabs, tables, the statement. It does NOT prove the
 * queries are right, because no query leaves the browser.
 */
import { execSync, spawn } from 'node:child_process'

const OUT = process.env.QA_OUT ?? '/tmp'
const REF = 'kvkajxpremantdkhmjvb'
const ACC = '11111111-1111-4111-8111-111111111111'
const COMPANY = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'

const { chromium } = await import(
  `${execSync('npm root -g', { encoding: 'utf8' }).trim()}/playwright/index.mjs`
)

const server = spawn('npm', ['run', 'dev', '--', '--port', '5199'], { stdio: ['ignore', 'pipe', 'pipe'] })
const stop = () => { if (!server.killed) server.kill('SIGTERM') }
process.on('exit', stop)
const ORIGIN = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('dev server did not start')), 60_000)
  let buf = ''
  server.stdout.on('data', (d) => {
    buf += String(d)
    const m = /http:\/\/localhost:(\d+)/.exec(buf)
    if (m) { clearTimeout(t); resolve(`http://localhost:${m[1]}`) }
  })
  server.on('exit', (c) => { clearTimeout(t); reject(new Error(`dev server exited (${c})`)) })
})

/* A real-shaped account: R18,500 capital, a year of interest, actions past the ceiling,
 * three payments, one of them reversed. */
const account = {
  id: ACC, company_id: COMPANY, handover_id: null,
  account_number: 'ABS-004182', swordfish_reference: '4182', client_reference: '80031947711',
  debtor_first_name: 'Thandiwe', debtor_surname: 'Mokoena', debtor_id_number: '8703125...',
  capital_handed_over: 18500, capital_outstanding: 18500,
  in_duplum: true, in_duplum_ceiling: 18500,
  commission_rate: 0.12, commission_rate_expected: 0.10, commission_rate_source: 'ABSTO mandate',
  interest_rate_annual: 24, prescribed: false, prescription_date: '2027-04-18',
  status: 'Active', sub_status: 'Arrangement', bucket: '90+',
  write_off_reason: null, handover_date: '2024-04-18',
  payments_to_date: 4300, swordfish_balance_at_import: 21114.62, swordfish_fees_at_import: 1225,
  swordfish_assigned_to: 'Amanda Coertze',
  diary_date: '2026-09-22', last_action_at: '2026-09-02', last_payment_at: '2026-08-05',
}

const payments = [
  { id: 'p1', account_id: ACC, received_at: '2026-08-05', amount: 1500, method: 'Direct', reference: 'EFT 88213', details: 'Debit order', paid_to_client: true, reversed_at: null },
  { id: 'p2', account_id: ACC, received_at: '2026-06-05', amount: 1500, method: 'Direct', reference: 'EFT 84771', details: 'Debit order', paid_to_client: true, reversed_at: null },
  { id: 'p3', account_id: ACC, received_at: '2026-05-05', amount: 1300, method: 'Client Direct', reference: 'CD 221', details: 'Paid to client', paid_to_client: false, reversed_at: null },
  { id: 'p4', account_id: ACC, received_at: '2026-04-05', amount: 1500, method: 'Direct', reference: 'EFT 80112', details: 'Returned unpaid', paid_to_client: false, reversed_at: '2026-04-12' },
]

const feeRows = []
const kinds = [
  ['Letter of Demand', 'LOD', 96, 14.4],
  ['Telephone Call', 'TEL', 16.1, 2.42],
  ['SMS', 'SMS', 3.5, 0.53],
  ['Trace', 'TRC', 161, 24.15],
]
let charged = 0
for (let i = 0; i < 64; i++) {
  const [description, action_code, excl, vat] = kinds[i % kinds.length]
  const billed = charged + excl <= 1225
  if (billed) charged += excl
  const d = new Date(Date.UTC(2024, 4 + Math.floor(i / 3), 3 + (i % 3) * 9))
  feeRows.push({
    id: `f${i}`, account_id: ACC, incurred_at: d.toISOString().slice(0, 10),
    description, action_code,
    amount_excl_vat: billed ? excl : 0, vat_amount: billed ? vat : 0,
    billed, segments: 1, cancelled_at: null, performed_by: 'Amanda Coertze',
  })
}

const accruals = []
for (let i = 0; i < 29; i++) {
  const d = new Date(Date.UTC(2024, 4 + i, 18))
  const amt = Math.round(18500 * 0.24 / 12 * 100) / 100
  accruals.push({ id: `i${i}`, account_id: ACC, accrued_on: d.toISOString().slice(0, 10), days: 30, amount_accrued: amt, amount_recoverable: amt })
}

const companies = [{
  id: COMPANY, name: 'ABSA Technology Finance Solutions', industry: 'Financial Services',
  status: 'Won', owner_id: USER, city: 'Johannesburg', province: 'Gauteng', country: 'South Africa',
  created_at: '2024-01-11', website: null, size: null, notes: null,
}]
const profiles = [{
  id: USER, email: 'qa@bredellferreira.co.za', name: 'Stephan Bredell',
  role: 'Administrator', team_id: null, avatar_url: null, is_active: true,
}]

const TABLES = {
  debtor_accounts: [account],
  account_payments: payments,
  account_fees: feeRows,
  account_interest_accruals: accruals,
  companies, profiles,
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)))

const serve = (route) => {
  const url = new URL(route.request().url())
  const table = url.pathname.replace('/rest/v1/', '')
  let rows = TABLES[table] ?? []
  // maybeSingle() asks for a single object back via the Accept header.
  const single = /vnd.pgrst.object/.test(route.request().headers()['accept'] ?? '')
  const body = single ? JSON.stringify(rows[0] ?? null) : JSON.stringify(rows)
  route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}`, 'access-control-allow-origin': '*' },
    body,
  })
}
await page.route(`**://${REF}.supabase.co/**`, serve)

const seed = ({ ref, user }) => {
  const session = {
    access_token: 'fake', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'fake',
    user: { id: user, aud: 'authenticated', role: 'authenticated', email: 'qa@bredellferreira.co.za', app_metadata: {}, user_metadata: {}, created_at: '2025-01-01T00:00:00Z' },
  }
  localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session))
}
await page.addInitScript(seed, { ref: REF, user: USER })

for (const tab of ['Overview', 'Statement', 'Activity']) {
  await page.goto(`${ORIGIN}/accounts/${ACC}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  if (tab !== 'Overview') {
    const b = page.getByRole('button', { name: new RegExp('^' + tab) })
    if (await b.count()) { await b.first().click(); await page.waitForTimeout(700) }
    else console.log(`!! tab button not found: ${tab}`)
  }
  await page.screenshot({ path: `${OUT}/account-${tab.toLowerCase()}.png`, fullPage: true })
  const text = (await page.textContent('body')).replace(/\s+/g, ' ')
  console.log(`\n== ${tab} ==\n${text.slice(0, 900)}`)
}

// The collectors work on iPads, so the narrow width is the real one, not the desk check.
const ipad = await browser.newPage({ viewport: { width: 1024, height: 768 } })
await ipad.route(`**://${REF}.supabase.co/**`, serve)
await ipad.addInitScript(seed, { ref: REF, user: USER })
await ipad.goto(`${ORIGIN}/accounts/${ACC}`, { waitUntil: 'networkidle' })
await ipad.waitForTimeout(1500)
await ipad.screenshot({ path: `${OUT}/account-ipad.png`, fullPage: true })

console.log('\nerrors:', errors.length ? JSON.stringify([...new Set(errors)].slice(0, 8), null, 2) : 'none')
await browser.close()
stop()

// The dev-server child keeps the loop alive otherwise.
process.exit(0)
