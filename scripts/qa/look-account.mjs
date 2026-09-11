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
  main_comment: 'Debit order in place since June, R1,500 a month, holding. Thandiwe asked for the total to settle -- quoted, waiting. Do not call at work.',
  main_comment_at: '2026-08-05T09:20:00Z',
  preferred_language: 'English', contact_preference: 'Phone, WhatsApp', consent_status: 'Consented',
  debtor_title: 'Ms', debtor_initials: 'T', debtor_second_name: null,
  account_flags: 'Debtor avoiding contact; Section 129 in process',
  account_rating: 7, last_contact_method: 'Email (Outgoing)', ptp_success_ratio: 7,
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

/*
 * Interest as the migrated book records it: a monthly row on the 1st, plus a part-month stub
 * where the export was taken. The stub deliberately stops a few days short of today, because
 * that gap is what the running "accruing to today" figure is computed across — a fixture whose
 * accruals ran up to this morning would render the one thing this screen now has to show as
 * blank, and pass.
 */
const accruals = []
{
  const amt = Math.round(18500 * 0.24 / 12 * 100) / 100
  const now = new Date()
  const stubStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  for (let i = 29; i >= 1; i--) {
    const d = new Date(Date.UTC(stubStart.getUTCFullYear(), stubStart.getUTCMonth() - i, 1))
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    accruals.push({
      id: `i${i}`, account_id: ACC, accrued_on: d.toISOString().slice(0, 10),
      // Swordfish stores days as an exclusive count, so a full month is one less than its length.
      days: last - 1, amount_accrued: amt, amount_recoverable: amt,
    })
  }
  // Four days short of today, so the page has a real open period to show.
  const stubDays = Math.max(0, now.getUTCDate() - 1 - 4)
  const stub = Math.round(amt * (stubDays + 1) / 30 * 100) / 100
  if (stubDays >= 0) {
    accruals.push({
      id: 'istub', account_id: ACC, accrued_on: stubStart.toISOString().slice(0, 10),
      days: stubDays, amount_accrued: stub, amount_recoverable: stub,
    })
  }
}

const companies = [{
  id: COMPANY, name: 'ABSA Technology Finance Solutions', industry: 'Financial Services',
  status: 'Won', owner_id: USER, account_owner_id: USER, city: 'Johannesburg', province: 'Gauteng', country: 'South Africa',
  // A client code is what makes a company a CLIENT rather than a prospect, and the client-only
  // actions are hidden without it.
  code: 'ABS',
  created_at: '2024-01-11', website: null, size: null, notes: null,
}]
const profiles = [{
  id: USER, email: 'qa@bredellferreira.co.za', name: 'Stephan Bredell',
  role: 'Administrator', team_id: null, avatar_url: null, is_active: true,
}]

const contacts = [
  { id: 'c1', account_id: ACC, kind: 'mobile', value: '+27 82 123 4567', label: null, is_primary: true, verified_at: '2026-08-06T09:00:00Z', retired_at: null, retired_reason: null, notes: null, created_at: '2026-08-06T09:00:00Z' },
  { id: 'c2', account_id: ACC, kind: 'work', value: '+27 11 987 6543', label: 'Build It Construction', is_primary: false, verified_at: null, retired_at: null, retired_reason: null, notes: null, created_at: '2026-08-06T09:05:00Z' },
  { id: 'c3', account_id: ACC, kind: 'email', value: 'thandiwe.m@example.co.za', label: null, is_primary: false, verified_at: null, retired_at: null, retired_reason: null, notes: null, created_at: '2026-08-06T09:06:00Z' },
  { id: 'c4', account_id: ACC, kind: 'address', value: '123 Madiba Street, Diepkloof, Soweto, 1864', label: null, is_primary: false, verified_at: null, retired_at: null, retired_reason: null, notes: null, created_at: '2026-08-06T09:07:00Z' },
  { id: 'c5', account_id: ACC, kind: 'mobile', value: '+27 71 000 1111', label: null, is_primary: false, verified_at: null, retired_at: '2026-07-01T09:00:00Z', retired_reason: 'disconnected', notes: null, created_at: '2025-11-02T09:00:00Z' },
]

const notes = [
  { id: 'n1', account_id: ACC, body: 'Spoke to Thandiwe. She confirmed payment will be made today and asked for the bank details again -- sent via WhatsApp.', pinned: false, author_name: 'Amanda Coertze', created_by: null, created_at: '2026-08-05T09:12:00Z' },
  { id: 'n3', account_id: ACC, body: 'Query raised: Debtor says she paid R3,000 directly to the client in March, at their branch, in cash, and was given a handwritten receipt which she has since lost. She wants the account corrected before she pays anything further and says she has told them twice already.', pinned: false, kind: 'query', query_id: 'q1', author_name: 'Amanda Coertze', created_by: null, created_at: '2026-08-18T09:00:00Z' },
  { id: 'n2', account_id: ACC, body: 'Requested a 7-day extension. Advised of the collection process and the fee position.', pinned: false, author_name: 'Amanda Coertze', created_by: null, created_at: '2026-06-04T11:18:00Z' },
]

const promises = [
  { id: 'pr1', account_id: ACC, amount: 1500, due_on: '2026-09-30', method: 'Debit order', status: 'open', resolved_at: null, notes: null, created_by: null, created_at: '2026-08-05T09:12:00Z', arrangement: 'monthly', day_of_month: null, on_last_day: true, day_of_week: null, instalments_kept: 3, total_promised: null },
  { id: 'pr2', account_id: ACC, amount: 1500, due_on: '2026-06-05', method: 'Debit order', status: 'kept', resolved_at: '2026-06-05T10:00:00Z', notes: null, created_by: null, created_at: '2026-05-20T09:00:00Z' },
  { id: 'pr3', account_id: ACC, amount: 1500, due_on: '2026-04-05', method: 'EFT', status: 'broken', resolved_at: '2026-04-12T10:00:00Z', notes: null, created_by: null, created_at: '2026-03-18T09:00:00Z' },
]

const TABLES = {
  debtor_accounts: [account],
  account_contacts: contacts,
  account_queries: [
    { id: 'q1', account_id: ACC, description: 'Says she already paid R3,000 of this directly to the client in March and it was never credited.', category: 'Already paid', status: 'open', stage: 'client', sent_to_client_at: '2026-08-20T09:00:00Z', owner_id: USER, raised_by_name: 'Amanda Coertze', raised_at: '2026-08-18T09:00:00Z', chase_on: '2026-09-01', outcome: null, outcome_action: null, outcome_amount: null, outcome_done: false, closed_at: null, closed_by_name: null },
    { id: 'q2', account_id: ACC, description: 'Disputed the delivery of two of the items invoiced.', category: 'Goods or service', status: 'closed', stage: 'liaison', owner_id: USER, raised_by_name: 'Amanda Coertze', raised_at: '2026-05-02T09:00:00Z', chase_on: null, outcome: 'partly_valid', outcome_action: 'Reduce the capital by the two items', outcome_amount: 1840, outcome_done: false, closed_at: '2026-06-11T09:00:00Z', closed_by_name: 'Stephan Bredell' },
    // The failure mode this reproduces: one unbroken run with nowhere to wrap. Typed by accident
    // on an iPad, it widened the card until the whole right-hand column left the screen.
    { id: 'q3', account_id: ACC, description: ',gffggnfngngmgmgmgmgmmgmgmgngngnnbgngngngngngnngnnmgngmgmhmmmhmhmmmmmhmhmmmhngmgmgmgmgmmmmmmmhbhbhbhbnmgngngmgm', category: 'Amount disputed', status: 'open', stage: 'agent', owner_id: USER, raised_by_name: 'Stephan Bredell', raised_at: '2026-09-09T09:00:00Z', chase_on: null, outcome: null, outcome_action: null, outcome_amount: null, outcome_done: false, closed_at: null, closed_by_name: null },
  ],
  account_documents: [
    { id: 'd1', account_id: ACC, name: 'Letter of demand - 20 Aug 2024.pdf', storage_path: 'x/1.pdf', mime_type: 'application/pdf', size_bytes: 184320, kind: 'Letter of Demand', uploaded_by_name: 'Amanda Coertze', created_at: '2024-08-20T10:00:00Z' },
    { id: 'd2', account_id: ACC, name: 'Acknowledgement of debt (signed).pdf', storage_path: 'x/2.pdf', mime_type: 'application/pdf', size_bytes: 402000, kind: 'Acknowledgement of Debt', uploaded_by_name: 'Amanda Coertze', created_at: '2024-09-02T10:00:00Z' },
    { id: 'd3', account_id: ACC, name: 'Proof of payment Aug 2026.pdf', storage_path: 'x/3.pdf', mime_type: 'application/pdf', size_bytes: 96000, kind: 'Proof of payment', uploaded_by_name: 'Stephan Bredell', created_at: '2026-08-05T10:00:00Z' },
  ],
  account_notes: notes,
  promises_to_pay: promises,
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

/*
 * A stub that ignores the query is a stub that lies.
 *
 * It reported a closed query in the open-queries queue and an unnamed debtor on every row,
 * neither of which the real database would have done -- which is worse than no screenshot,
 * because it looks like a finding. So it honours the two things the app actually relies on:
 * PostgREST filter params, and a one-level embedded select.
 */
const OPS = {
  eq: (a, b) => String(a) === b,
  neq: (a, b) => String(a) !== b,
  gt: (a, b) => Number(a) > Number(b),
  gte: (a, b) => Number(a) >= Number(b),
  lt: (a, b) => Number(a) < Number(b),
  lte: (a, b) => Number(a) <= Number(b),
  is: (a, b) => (b === 'null' ? a === null || a === undefined : String(a) === b),
  in: (a, b) => b.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, '')).includes(String(a)),
}

const posted = []
const serve = (route) => {
  const url = new URL(route.request().url())
  const table = url.pathname.replace('/rest/v1/', '')
  const wantsObject = /vnd.pgrst.object/.test(route.request().headers()['accept'] ?? '')
  const json = (body, status = 200) => route.fulfill({
    status, contentType: 'application/json',
    headers: { 'content-range': '0-0/1', 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  })

  // The fee engine asks Postgres for three numbers rather than pulling the ledger.
  if (table === 'rpc/account_charge_basis') {
    return json({ capital: 18500, spent_on_item: 0, towards_ceiling: 0 })
  }
  if (route.request().method() === 'POST') {
    posted.push({ table, body: route.request().postData() ?? '' })
    const sent = JSON.parse(route.request().postData() || '{}')
    const row = { id: `qa-${posted.length}`, created_at: new Date().toISOString(), ...(Array.isArray(sent) ? sent[0] : sent) }
    // Kept, not just echoed. A stub that forgets what was inserted cannot tell the difference
    // between a page that refetched after a write and one that did not -- which is the whole
    // question when a fee is raised and a statement is sent a minute later.
    if (TABLES[table]) TABLES[table] = [...TABLES[table], row]
    return json(wantsObject ? row : [row], 201)
  }
  let rows = TABLES[table] ?? []

  // Embeds are resolved BEFORE filtering, because PostgREST allows a filter on an embedded
  // table (`debtor_accounts.company_id=eq.…`) and the row has to carry the child to be filtered
  // on it. Getting this order wrong silently returned nothing, which looked exactly like an
  // empty section rather than a broken stub.
  const select = url.searchParams.get('select') ?? '*'
  const embed = /([a-z_]+)!?[a-z]*\(([^)]*)\)/.exec(select)
  if (embed) {
    const [, child, cols] = embed
    const wanted = cols.split(',').map((c) => c.trim()).filter(Boolean)
    rows = rows.map((r) => {
      const parent = (TABLES[child] ?? []).find((p) => p.id === r[`${child.replace(/s$/, '')}_id`] || p.id === r.account_id)
      if (!parent) return r
      return { ...r, [child]: Object.fromEntries(wanted.map((c) => [c, parent[c]])) }
    })
    // !inner drops rows with no match, exactly as the join would.
    if (/!inner/.test(select)) rows = rows.filter((r) => r[child])
  }

  for (const [key, raw] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue
    const [op, ...rest] = raw.split('.')
    const fn = OPS[op]
    if (!fn) continue
    const value = rest.join('.')
    // A dotted key names a column on an embedded table.
    const [head, nested] = key.split('.')
    rows = rows.filter((r) => fn(nested ? r[head]?.[nested] : r[key], value))
  }
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

for (const tab of ['Overview', 'Transactions', 'Documents']) {
  await page.goto(`${ORIGIN}/accounts/${ACC}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  if (tab !== 'Overview') {
    const b = page.getByRole('button', { name: new RegExp('^' + tab) })
    if (await b.count()) { await b.first().click(); await page.waitForTimeout(700) }
    else console.log(`!! tab button not found: ${tab}`)
  }
  await page.screenshot({ path: `${OUT}/account-${tab.toLowerCase()}.png`, fullPage: true })
  if (tab === 'Overview') {
    // The disputes panel sits low in the right-hand column; scroll it into frame on its own.
    await page.evaluate(() => {
      const h = [...document.querySelectorAll('h3')].find((n) => /^Disputes$/.test(n.textContent ?? ''))
      h?.scrollIntoView({ block: 'center' })
    })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/account-disputes-panel.png` })
  }
  // The app scrolls an inner container, not the document, so fullPage stops at the viewport.
  // Anything below the fold -- the statement's settlement footer, for one -- needs this.
  const scrolled = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((n) => n.scrollHeight > n.clientHeight + 40 && getComputedStyle(n).overflowY !== 'visible')
    if (!el) return false
    el.scrollTop = el.scrollHeight
    return true
  })
  if (scrolled) {
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/account-${tab.toLowerCase()}-bottom.png` })
  }
  const text = (await page.textContent('body')).replace(/\s+/g, ' ')
  console.log(`\n== ${tab} ==\n${text.slice(0, 900)}`)
  // The header alone fills the excerpt above, so the things worth asserting are asserted rather
  // than eyeballed: the running interest has to reach the statement, not only the tile.
  /*
   * Overflow, measured against the CARD rather than the page.
   *
   * The page-level check was useless: at a desktop width the grid simply absorbs an over-wide
   * card and documentElement.scrollWidth never moves, so a card whose text visibly runs past its
   * own border reports clean. What matters is whether any text box is wider than the card it
   * sits in — that is the thing you actually see on an iPad.
   */
  const over = await page.evaluate(() => {
    const bad = []
    for (const card of document.querySelectorAll('.card')) {
      const edge = card.getBoundingClientRect().right
      for (const n of card.querySelectorAll('p, span')) {
        const r = n.getBoundingClientRect()
        if (r.width > 0 && r.right > edge + 2) {
          bad.push(`${Math.round(r.right - edge)}px past the card: "${(n.textContent ?? '').slice(0, 28)}"`)
        }
      }
    }
    return bad.slice(0, 3)
  })
  console.log(over.length ? `!! text overflows its card — ${over.join(' | ')}` : '   nothing overflows its card')
  // Measured rather than asserted: this harness's Chromium wraps the fixture string even without
  // the fix, so it cannot prove the iPad bug is gone — it can only show the text now sits inside
  // its card at the width the grid gave it.
  const wrapped = await page.evaluate(() => {
    const el = [...document.querySelectorAll('p, span')].find((n) => (n.textContent ?? '').includes('gffggnfngngm'))
    if (!el) return null
    const r = el.getBoundingClientRect(), c = el.closest('.card').getBoundingClientRect()
    return `unbroken query text: ${Math.round(r.width)}px inside a ${Math.round(c.width)}px card`
  })
  if (wrapped) console.log('   ' + wrapped)
  if (tab === 'Transactions') {
    const line = text.match(/Interest, \d+ to \d+ \w+ — still accruing/)
    console.log(line ? `   statement carries the open period: "${line[0]}"` : '!! no accruing-interest line on the statement')
  }
}

// The Escalate modal — the new front door to the query system.
const esc = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await esc.route(`**://${REF}.supabase.co/**`, serve)
await esc.addInitScript(seed, { ref: REF, user: USER })
await esc.goto(`${ORIGIN}/accounts/${ACC}`, { waitUntil: 'networkidle' })
await esc.waitForTimeout(1400)
const escalate = esc.getByRole('button', { name: /^Dispute$/ })
if (await escalate.count()) { await escalate.first().click(); await esc.waitForTimeout(700) }
else console.log('!! Dispute button not found')
await esc.screenshot({ path: `${OUT}/account-escalate.png` })

// The client's own queries section.
const cq = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await cq.route(`**://${REF}.supabase.co/**`, serve)
await cq.addInitScript(seed, { ref: REF, user: USER })
await cq.goto(`${ORIGIN}/companies/${COMPANY}`, { waitUntil: 'networkidle' })
await cq.waitForTimeout(1500)
await cq.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find((n) => n.scrollHeight > n.clientHeight + 40 && getComputedStyle(n).overflowY !== 'visible')
  const target = [...document.querySelectorAll('h3')].find((h) => /Queries/.test(h.textContent ?? ''))
  if (el && target) el.scrollTop = target.getBoundingClientRect().top + el.scrollTop - 90
})
await cq.waitForTimeout(500)
await cq.screenshot({ path: `${OUT}/client-queries.png` })

/*
 * The two doors into the book, on the client page.
 *
 * "Import Handover" takes a batch; "Add Debtor" takes the single account a client phones in. The
 * second is the one worth exercising here — it is the only place in the app that opens a ledger
 * without a Swordfish file behind it, and the modal has to propose the next reference in this
 * client's own series rather than leave it to whoever is typing.
 */
{
  const labels = await cq.evaluate(() =>
    [...document.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()).filter(Boolean))
  console.log(`   client actions: ${labels.includes('Import Handover') ? 'Import Handover ✓' : '!! no Import Handover'} · ${labels.includes('Add Debtor') ? 'Add Debtor ✓' : '!! no Add Debtor'}`)

  const add = cq.getByRole('button', { name: 'Add Debtor' })
  if (await add.count()) {
    await add.first().click()
    await cq.waitForTimeout(900)
    await cq.screenshot({ path: `${OUT}/add-debtor.png` })
    const ref = await cq.evaluate(() => {
      const labelled = [...document.querySelectorAll('label')].find((l) => /Our reference/i.test(l.textContent ?? ''))
      return labelled?.querySelector('input')?.value ?? null
    })
    console.log(`   reference proposed: ${ref === null ? '!! field not found' : JSON.stringify(ref)}`)

    // Saving an empty form must report every problem at once, not one per attempt.
    const submit = cq.getByRole('button', { name: /Add debtor$/ })
    await cq.evaluate(() => {
      for (const i of document.querySelectorAll('input')) {
        if (i.type !== 'date') { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })) }
      }
    })
    await submit.first().click()
    await cq.waitForTimeout(400)
    const errs = await cq.evaluate(() =>
      [...document.querySelectorAll('p')].map((p) => (p.textContent ?? '').trim())
        .filter((t) => /required|surname|more than nothing/i.test(t)))
    // The date input is left alone (a date field cannot hold an empty string here), so two of
    // the three required fields are being tested.
    console.log(`   cleared form reports ${errs.length} problem(s) at once`)
    await cq.screenshot({ path: `${OUT}/add-debtor-errors.png` })
  }
}

// The disputes board -- same shape as the Deals board, which is what the firm asked for.
const queue = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await queue.route(`**://${REF}.supabase.co/**`, serve)
await queue.addInitScript(seed, { ref: REF, user: USER })
await queue.goto(`${ORIGIN}/queries`, { waitUntil: 'networkidle' })
await queue.waitForTimeout(1400)
const boardText = (await queue.textContent('body')).replace(/\s+/g, ' ')
for (const col of ['With the agent', 'Awaiting team leader', 'Awaiting liaison', 'Awaiting client', 'Resolved']) {
  if (!boardText.includes(col)) console.log(`!! disputes board is missing the "${col}" column`)
}
for (const kpi of ['Total Disputes', 'Open', 'Chase overdue', 'Oldest open']) {
  if (!boardText.includes(kpi)) console.log(`!! disputes board is missing the "${kpi}" figure`)
}
// A placeholder is not in textContent, so ask the input itself.
if (await queue.locator('input[placeholder^="Search disputes"]').count() === 0) {
  console.log('!! no search box on the disputes board')
}
if (!/Disputes/.test(await queue.textContent('h1, header') ?? '')) console.log('!! the page is not headed "Disputes"')
await queue.screenshot({ path: `${OUT}/disputes-board.png` })
// And the list view the firm asked for beside the board.
const listBtn = queue.getByTitle('List')
if (await listBtn.count() === 0) console.log('!! no list/board switch on the disputes board')
else {
  await listBtn.first().click()
  await queue.waitForTimeout(600)
  const listText = (await queue.textContent('body')).replace(/\s+/g, ' ')
  const headers = await queue.locator('table thead th').allTextContents()
  const wanted = ['Debtor', 'Dispute', 'Owner', 'Sitting with', 'Chase', 'Age']
  const missing = wanted.filter((w) => !headers.some((h) => h.trim() === w))
  if (missing.length) console.log(`!! the list view is missing columns: ${missing.join(', ')}`)
  else if (!/With the (agent|client)/.test(listText)) console.log('!! the list view shows no stage chips')
  else console.log('   disputes board and list both render')
  await queue.screenshot({ path: `${OUT}/disputes-list.png` })
}

// Settings -> Data Import, where the new "Update debtor details" card lives.
const settings = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await settings.route(`**://${REF}.supabase.co/**`, serve)
await settings.addInitScript(seed, { ref: REF, user: USER })
await settings.goto(`${ORIGIN}/settings`, { waitUntil: 'networkidle' })
await settings.waitForTimeout(1200)
const importTab = settings.getByRole('button', { name: /Data Import/ })
if (await importTab.count()) { await importTab.first().click(); await settings.waitForTimeout(900) }
else console.log('!! Data Import tab not found')
await settings.screenshot({ path: `${OUT}/settings-import.png` })

// The collectors work on iPads, so the narrow width is the real one, not the desk check.
const ipad = await browser.newPage({ viewport: { width: 1024, height: 768 } })
await ipad.route(`**://${REF}.supabase.co/**`, serve)
await ipad.addInitScript(seed, { ref: REF, user: USER })
await ipad.goto(`${ORIGIN}/accounts/${ACC}`, { waitUntil: 'networkidle' })
await ipad.waitForTimeout(1500)
await ipad.screenshot({ path: `${OUT}/account-ipad.png`, fullPage: true })

/*
 * Click to dial, with BuzzBox stubbed as connected.
 *
 * The collector's report was that the number in Debtor details dialled but the Call button at the
 * top of the page did nothing -- it was written as a placeholder before BuzzBox existed. Both are
 * now the same PhoneLink, so this checks that they ring the SAME number, and that it is not the
 * retired one.
 */
const dial = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await dial.route(`**://${REF}.supabase.co/**`, serve)
await dial.addInitScript(seed, { ref: REF, user: USER })
let dialled = null
await dial.route('**/api/buzzbox/status', (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    connected: true, identity: 'qa@bredellferreira.co.za', organisationId: 2741,
    organisationName: 'QA', connectedAt: '2026-09-10T10:00:00Z', extension: '141',
  }) }))
await dial.route('**/api/buzzbox/call', (r) => {
  dialled = JSON.parse(r.request().postData() ?? '{}').to
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, from: '141', to: dialled }) })
})
await dial.goto(`${ORIGIN}/accounts/${ACC}`, { waitUntil: 'networkidle' })
await dial.waitForTimeout(1500)

const callBtn = dial.getByRole('button', { name: /^Call$/ })
if (await callBtn.count() === 0) console.log('!! no Call button in the action bar')
else if (await callBtn.first().isDisabled()) console.log('!! the Call button is still disabled with BuzzBox connected')
else {
  await callBtn.first().click()
  await dial.waitForTimeout(600)
  console.log(`   Call button dialled: ${dialled ?? '(nothing)'}`)
  if (dialled !== '+27 82 123 4567') console.log(`!! expected the primary mobile, got ${dialled}`)
  if (!(await dial.getByText(/Ringing extension 141/).count())) console.log('!! no "pick up to connect" feedback after dialling')
}
await dial.screenshot({ path: `${OUT}/account-dialling.png` })

// The same number in Debtor details must reach the same place.
dialled = null
const numberBtn = dial.getByRole('button', { name: /\+27 82 123 4567/ })
if (await numberBtn.count() === 0) console.log('!! the primary number is not a dial button')
else {
  await numberBtn.first().click()
  await dial.waitForTimeout(600)
  if (dialled !== '+27 82 123 4567') console.log(`!! Debtor details dialled ${dialled}, not the primary mobile`)
  else console.log('   Debtor details dialled the same number')
}

// Retired numbers are never what the action bar rings.
if (await dial.getByRole('button', { name: /^Call$/ }).count() && dialled === '+27 71 000 1111') {
  console.log('!! the action bar rang a RETIRED number')
}

/*
 * The two new action-bar buttons: Dispute (which used to say Escalate) and Trace.
 *
 * Trace charges the debtor, so what is checked here is that it ASKS first -- the modal has to
 * appear, and the fee it is about to raise has to be named in it.
 */
const act = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await act.route(`**://${REF}.supabase.co/**`, serve)
await act.addInitScript(seed, { ref: REF, user: USER })
await act.goto(`${ORIGIN}/accounts/${ACC}`, { waitUntil: 'networkidle' })
await act.waitForTimeout(1500)

const bar = (await act.textContent('body')).replace(/\s+/g, ' ')
console.log(`   action bar says "Dispute": ${/Dispute/.test(bar)}`)
if (/Escalate/.test(bar)) console.log('!! the old "Escalate" wording is still on the page')
if (!/Trace/.test(bar)) console.log('!! no Trace button in the action bar')

/*
 * Trace is one click and no confirmation, so what matters is that the click actually does all
 * three things -- opens XDS, raises the fee, writes the note -- and says which.
 */
let opened = null
// The container cannot reach xds.co.za, and a popup that fails to load reports its URL as
// chrome-error -- which would hide whether the right address was ever asked for. Stubbing the
// portal makes the popup's own URL the thing under test.
await act.context().route('**xds.co.za/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/html', body: '<title>XDS (stub)</title>' }))
act.on('popup', async (p) => { await p.waitForLoadState().catch(() => {}); opened = p.url(); void p.close() })
const trace = act.getByRole('button', { name: /^Trace$/ })
if (await trace.count() === 0) console.log('!! Trace button not found')
else {
  await trace.first().click()
  await act.waitForTimeout(1000)

  console.log(`   opened: ${opened ?? '(no new tab)'}`)
  if (!opened || !/xds\.co\.za/.test(opened)) console.log('!! Trace did not open the XDS portal')

  // The count is asked AFTER the portal opens, and nothing may be charged until it is answered.
  const ask = act.locator('[data-modal-open="true"]')
  if (await ask.count() === 0) console.log('!! Trace did not ask how many searches were run')
  else console.log('   asked how many traces, with XDS already open')
  if (posted.some((p) => p.table === 'account_fees')) console.log('!! a fee was raised before the count was given')
  else console.log('   nothing charged before answering')

  await act.screenshot({ path: `${OUT}/account-trace-count.png` })
  const four = ask.getByRole('button', { name: /^4$/ })
  if (await four.count() === 0) console.log('!! no count buttons in the trace prompt')
  else await four.first().click()
  await act.waitForTimeout(1000)

  const fee = posted.find((p) => p.table === 'account_fees')
  const note = posted.find((p) => p.table === 'account_notes')
  // Four searches are ONE row at four times the rate, not four rows.
  const feeRows = posted.filter((p) => p.table === 'account_fees')
  if (feeRows.length !== 1) console.log(`!! ${feeRows.length} fee rows written for one trace sitting, expected 1`)
  if (!fee) console.log('!! no fee was raised')
  else {
    const body = JSON.parse(fee.body)
    console.log(`   fee: "${body.description}" — item ${body.annexure_item}, R${body.amount_excl_vat} excl VAT, ${body.segments} units, code ${body.action_code}`)
    if (body.annexure_item !== '4c' || body.action_code !== 'TRC') console.log('!! the trace fee is not item 4(c) under TRC')
    if (Number(body.amount_excl_vat) !== 64) console.log('!! four searches did not come to 4 x R16')
    if (Number(body.segments) !== 4) console.log('!! the row does not record how many searches it covers')
    // The count lives in `segments`, not in the description -- the renderers add it, once.
    if (/x ?4|×4/.test(body.description)) console.log('!! the count is written into the description as well as segments')
  }
  if (!note) console.log('!! nothing was written to the timeline')
  else if (!/Trace done — 4 credit bureau searches/.test(JSON.parse(note.body).body)) console.log('!! the timeline note does not say how many searches were done')
  else console.log(`   note: ${JSON.parse(note.body).body}`)

  const after = (await act.textContent('body')).replace(/\s+/g, ' ')
  if (!/4 searches . charged R64\.00/.test(after)) console.log('!! the button does not report what it charged')
  else console.log('   the button reports the charge next to itself')

  /*
   * And the money must be ON the page, without a reload.
   *
   * A collector traces a debtor and then emails them a statement. If the fee is only in Postgres
   * until somebody presses refresh, the statement that goes out is missing a charge that was
   * raised a minute earlier. So this navigates to Transactions the way a person would -- by
   * clicking the tab, never by reloading.
   */
  await act.getByRole('button', { name: /^Transactions/ }).first().click()
  await act.waitForTimeout(900)
  const txns = (await act.textContent('body')).replace(/\s+/g, ' ')
  if (!/Credit bureau search \(XDS\) ×4/.test(txns)) {
    console.log('!! the trace is not on the transaction list without a page reload')
  } else console.log('   the trace is on the transaction list without a reload, labelled ×4')
  if (/×4 ?×4|x 4 ×4/.test(txns)) console.log('!! the count is rendered twice')
  await act.screenshot({ path: `${OUT}/account-trace.png` })
}

const disputeBtn = act.getByRole('button', { name: /^Dispute$/ })
if (await disputeBtn.count() === 0) console.log('!! Dispute button not found')
else {
  await disputeBtn.first().click()
  await act.waitForTimeout(600)
  const m = (await act.textContent('body')).replace(/\s+/g, ' ')
  if (!/Raise a dispute/.test(m)) console.log('!! the dispute modal is not titled "Raise a dispute"')
  else console.log('   dispute modal opens with the right title')

  // The firm's classification, with its examples under the choice.
  const opts = await act.locator('[data-modal-open="true"] select').last().locator('option').allTextContents()
  const wanted = ['Amount dispute', 'Liability dispute', 'Third-party payment', 'Other']
  const missing = wanted.filter((w) => !opts.includes(w))
  if (missing.length) console.log(`!! classifications missing from the form: ${missing.join(', ')}`)
  else console.log(`   ${opts.length - 1} classifications offered`)

  const selects = act.locator('[data-modal-open="true"] select')
  await selects.last().selectOption('Amount dispute')
  await act.waitForTimeout(300)
  if (!/Incorrect balance, fees, interest, missing payment/.test((await act.textContent('body')))) {
    console.log('!! the examples for the chosen classification are not shown')
  } else console.log('   examples shown under the classification')

  // "Other" is refused without the words.
  await selects.last().selectOption('Other')
  await act.locator('[data-modal-open="true"] textarea').fill('n/a')
  await act.waitForTimeout(300)
  const raise = act.locator('[data-modal-open="true"]').getByRole('button', { name: /^Raise dispute$/ })
  if (!(await raise.isDisabled())) console.log('!! "Other" was accepted with no real explanation')
  else console.log('   "Other" refused without an explanation')
  await act.locator('[data-modal-open="true"] textarea').fill('Debtor says the account belongs to their late father')
  await act.waitForTimeout(300)
  if (await raise.isDisabled()) console.log('!! a real explanation was still refused')
  else console.log('   ...and accepted once explained')
  await act.screenshot({ path: `${OUT}/account-dispute.png` })
}

/*
 * A written-off account earns nothing more.
 *
 * This is the case that reached the firm: a trace on a "Written-off / Paid in Full" account
 * charged R48, said so, and then never appeared on the statement -- which drops fees dated after
 * the write-off. The work must still be recorded; the money must not.
 */
TABLES.debtor_accounts = TABLES.debtor_accounts.map((a) => ({ ...a, status: 'Written-off', write_off_reason: 'Paid in Full' }))
const before = posted.length
const closed = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await closed.route(`**://${REF}.supabase.co/**`, serve)
await closed.addInitScript(seed, { ref: REF, user: USER })
await closed.context().route('**xds.co.za/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>XDS</title>' }))
closed.on('popup', (p) => void p.close())
await closed.goto(`${ORIGIN}/accounts/${ACC}`, { waitUntil: 'networkidle' })
await closed.waitForTimeout(1500)
const closedTrace = closed.getByRole('button', { name: /^Trace$/ })
if (await closedTrace.count() === 0) console.log('!! no Trace button on the written-off account')
else {
  await closedTrace.first().click()
  await closed.waitForTimeout(700)
  const two = closed.locator('[data-modal-open="true"]').getByRole('button', { name: /^2$/ })
  if (await two.count()) await two.first().click()
  await closed.waitForTimeout(1000)
  const wroteFee = posted.slice(before).find((p) => p.table === 'account_fees')
  if (!wroteFee) console.log('!! the trace was not recorded at all on a written-off account')
  else {
    const body = JSON.parse(wroteFee.body)
    console.log(`   written-off: recorded at R${body.amount_excl_vat}, billed=${body.billed}`)
    if (Number(body.amount_excl_vat) !== 0 || body.billed !== false) {
      console.log('!! a written-off account was charged for a trace')
    }
  }
  const said = (await closed.textContent('body')).replace(/\s+/g, ' ')
  if (!/no charge \(account written off\)/.test(said)) console.log('!! the button did not say why nothing was charged')
  else console.log('   the button said the account is written off')
}

/*
 * A pre-legal agent may not look at a client.
 *
 * Three surfaces, because hiding a link is not a permission: the sidebar entry, the client name
 * in the account hero, and the /companies URL typed directly.
 */
TABLES.profiles = TABLES.profiles.map((p) => (p.id === USER ? { ...p, role: 'Pre-legal Agent' } : p))
const prelegal = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await prelegal.route(`**://${REF}.supabase.co/**`, serve)
await prelegal.addInitScript(seed, { ref: REF, user: USER })
await prelegal.goto(`${ORIGIN}/accounts/${ACC}`, { waitUntil: 'networkidle' })
await prelegal.waitForTimeout(1500)
if (await prelegal.getByRole('link', { name: /^Clients$/ }).count()) console.log('!! a pre-legal agent still has Clients in the sidebar')
if (await prelegal.locator(`a[href="/companies/${COMPANY}"]`).count()) console.log('!! the account still links a pre-legal agent to the client')
await prelegal.goto(`${ORIGIN}/companies/${COMPANY}`, { waitUntil: 'networkidle' })
await prelegal.waitForTimeout(1200)
if (/\/companies/.test(new URL(prelegal.url()).pathname)) console.log('!! a pre-legal agent reached the client page by URL')
else console.log(`   pre-legal agent is kept out of clients (sent to ${new URL(prelegal.url()).pathname})`)
await prelegal.screenshot({ path: `${OUT}/account-prelegal.png` })

// And an ordinary role still gets there.
TABLES.profiles = TABLES.profiles.map((p) => (p.id === USER ? { ...p, role: 'Administrator' } : p))
const admin = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await admin.route(`**://${REF}.supabase.co/**`, serve)
await admin.addInitScript(seed, { ref: REF, user: USER })
await admin.goto(`${ORIGIN}/companies/${COMPANY}`, { waitUntil: 'networkidle' })
await admin.waitForTimeout(1200)
if (!/\/companies/.test(new URL(admin.url()).pathname)) console.log('!! an administrator was locked out of the client page')
else console.log('   an administrator still opens the client')
const clientText = (await admin.textContent('body')).replace(/\s+/g, ' ')
if (/Disputes on this client/.test(clientText)) console.log('   client page shows its disputes section')
await admin.screenshot({ path: `${OUT}/client-disputes.png` })

/*
 * The SMS compose box.
 *
 * What matters here is that the price is right BEFORE the message goes: 161 characters costs twice
 * what 160 does, and one curly apostrophe costs more again. A collector who can see that will
 * shorten the message; one who finds out on the statement will not.
 */
// Earlier sections leave the fixture written off and the user pre-legal; put both back, or the
// SMS is correctly charged nothing and the check fails for the wrong reason.
TABLES.debtor_accounts = TABLES.debtor_accounts.map((a) => ({ ...a, status: 'Active', write_off_reason: null }))
TABLES.profiles = TABLES.profiles.map((p) => (p.id === USER ? { ...p, role: 'Administrator' } : p))
const sms = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
await sms.route(`**://${REF}.supabase.co/**`, serve)
await sms.addInitScript(seed, { ref: REF, user: USER })
let smsSent = null
await sms.route('**/api/sms/send', (r) => {
  smsSent = JSON.parse(r.request().postData() ?? '{}')
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    ok: true, id: 'qa-sms', reference: 'bfqa', segments: 2, encoding: 'GSM-7', to: '27821234567',
  }) })
})
await sms.goto(`${ORIGIN}/accounts/${ACC}`, { waitUntil: 'networkidle' })
await sms.waitForTimeout(1500)

const smsBtn = sms.getByRole('button', { name: /^SMS$/ })
if (await smsBtn.count() === 0) console.log('!! no SMS button in the action bar')
else if (await smsBtn.first().isDisabled()) console.log('!! the SMS button is disabled on an account with a number')
else {
  await smsBtn.first().click()
  await sms.waitForTimeout(600)
  // The account carries a mobile and a work number; the collector chooses which one.
  const picker = sms.locator('[data-modal-open="true"] select')
  if (await picker.count() === 0) console.log('!! no number picker, so only one number can ever be texted')
  else {
    const opts = await picker.first().locator('option').allTextContents()
    console.log(`   numbers offered: ${opts.map((o) => o.split(' — ')[0]).join(', ')}`)
    if (opts.length < 2) console.log('!! the picker offers fewer numbers than the account has')
    if (!/primary/.test(opts[0] ?? '')) console.log('!! the primary number is not offered first')
    // A retired number must never be on the list.
    if (opts.some((o) => o.includes('71 000 1111'))) console.log('!! a retired number is offered for SMS')
  }
  const box = sms.locator('[data-modal-open="true"] textarea')
  if (await box.count() === 0) console.log('!! the SMS compose box did not open')
  else {
    const priced = async () => (await sms.textContent('[data-modal-open="true"]')).replace(/\s+/g, ' ')
    await box.fill('a'.repeat(160))
    await sms.waitForTimeout(250)
    const one = await priced()
    if (!/1 message/.test(one) || !/R3\.50 plus VAT/.test(one)) console.log(`!! 160 characters is not priced as one message: ${one.slice(0, 160)}`)
    else console.log('   160 characters priced as one message at R3.50')

    await box.fill('a'.repeat(161))
    await sms.waitForTimeout(250)
    const two = await priced()
    if (!/2 messages/.test(two) || !/R7\.00 plus VAT/.test(two)) console.log(`!! 161 characters is not priced as two: ${two.slice(0, 160)}`)
    else console.log('   161 characters priced as two at R7.00')

    // The expensive surprise.
    await box.fill('a'.repeat(100) + '\u2019')
    await sms.waitForTimeout(250)
    const curly = await priced()
    if (!/cuts each message to 70/.test(curly)) console.log('!! a curly quote is not flagged as halving the message')
    else console.log('   a curly quote is flagged before sending')

    await box.fill('Bredell Ferreira: your account is in arrears. Please call 010 444 0044.')
    await sms.waitForTimeout(250)
    await sms.locator('[data-modal-open="true"]').getByRole('button', { name: /^Send SMS$/ }).click()
    await sms.waitForTimeout(1200)
    console.log(`   sent to the server: ${smsSent ? `${smsSent.to} — "${String(smsSent.text).slice(0, 40)}…"` : '(nothing)'}`)
    if (!smsSent) console.log('!! the SMS was never handed to the server')

    const fee = posted.filter((p) => p.table === 'account_fees').map((p) => JSON.parse(p.body)).at(-1)
    if (!fee || fee.action_code !== 'SMS') console.log('!! no SMS fee was raised')
    else {
      console.log(`   fee: item ${fee.annexure_item}, R${fee.amount_excl_vat} excl VAT, ${fee.segments} segment(s)`)
      if (fee.annexure_item !== '1c') console.log('!! the SMS fee is not item 1(c)')
      if (Number(fee.amount_excl_vat) !== 7) console.log('!! two segments did not charge 2 x R3.50')
    }
    await sms.screenshot({ path: `${OUT}/account-sms.png` })
  }
}

console.log('\nerrors:', errors.length ? JSON.stringify([...new Set(errors)].slice(0, 8), null, 2) : 'none')
await browser.close()
stop()

// The dev-server child keeps the loop alive otherwise.
process.exit(0)
