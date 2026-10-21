/**
 * A client's commission can be set as a sliding scale from Trust settings, in a real browser.
 *
 * THE FIRM, on the commission dialog: "Here I can't choose a sliding scale." It took one number;
 * a client already on a scale had no button at all; and the note under the table sent people to
 * the client record, whose card only shows a scale. A mandate signed on a scale after the client
 * was loaded had nowhere in the app to go.
 *
 * What this drives, end to end:
 *   1. a flat-rate client switched to a sliding scale -- the choice, the tiers, the reason, the
 *      terms read back in words, and what is actually WRITTEN: the bands, and the rate cleared,
 *      because the engine prices from the bands whenever there are any;
 *   2. a client already on a scale has a Change button, and the dialog opens on its own tiers.
 *
 * Run: node scripts/qa/e2e/commission-scale.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('commission-scale')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }
const FLAT = { id: 'c0000001-0000-4000-8000-000000000001', name: 'Kestrel Industrial Supplies (Pty) Ltd', code: 'KIS',
  commission_rate: 0.3, commission_bands: null, commission_bands_source: null }
const BANDED = { id: 'c0000002-0000-4000-8000-000000000002', name: 'Meridian Student Housing (RF) Ltd', code: 'MSH',
  commission_rate: null, commission_bands: [{ upTo: 25000, rate: 0.25 }, { upTo: null, rate: 0.225 }],
  commission_bands_source: 'Signed mandate, 1 March 2026' }
/* ON THE REGISTER'S TIERS WITH NO BOUNDARIES, and a leftover flat rate -- which is how Kestrel came
   out of the import: its last tier, 10%, sitting where the scale should be (prompt 9). */
const TIERED = { id: 'c0000003-0000-4000-8000-000000000003', name: 'Osprey Hardware (Pty) Ltd', code: 'OSP',
  commission_rate: 0.1, commission_bands: null, commission_bands_source: null,
  commission_tiers: [{ prefix: 'OSP', rate: 0.21 }, { prefix: 'OSP2', rate: 0.15 }, { prefix: 'OSP3', rate: 0.12 }, { prefix: 'OSP4', rate: 0.1 }] }

let patches = []
let logged = []
const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: ADMIN.id, email: ADMIN.email } })],
  [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [ADMIN] })],
  [(u, req) => req.method() === 'PATCH' && u.includes('/rest/v1/companies'), (u, req) => {
    patches.push({ url: decodeURIComponent(u), body: req.postDataJSON() })
    return { status: 204, body: null }
  }],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [FLAT, BANDED, TIERED] })],
  [(u, req) => req.method() === 'POST' && u.includes('/rest/v1/finance_setting_changes'), (u, req) => {
    logged.push(req.postDataJSON()); return { status: 201, body: [] }
  }],
  [(u) => u.includes('/rest/v1/firm_settings'), () => ({ body: { vat_rate: 0.15, finance_cutover_at: '2026-01-01T00:00:00Z', payover_lag_months: 1 } })],
  [(u) => u.includes('/rpc/money_position'), () => ({ body: [
    { company_id: FLAT.id }, { company_id: FLAT.id }, { company_id: FLAT.id }, { company_id: BANDED.id }, { company_id: TIERED.id },
  ] })],
  /* No accounts handed back, so the replay after saving is not what is under test here. */
  [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [] })],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
  await page.goto(`http://127.0.0.1:${PORT}/trust/settings`, { waitUntil: 'domcontentloaded' })
  const flatRow = page.locator('tr', { hasText: 'Kestrel Industrial' })
  await flatRow.waitFor({ timeout: 20000 })

  /* ---------- 3: the states the table shows ---------- */
  const bandedRow = page.locator('tr', { hasText: 'Meridian Student' })
  const tieredRow = page.locator('tr', { hasText: 'Osprey Hardware' })
  t.ok('a client with bands reads "Sliding scale", with its bands', await bandedRow.getByText('Sliding scale').isVisible()
    && await bandedRow.getByText(/R25[\s,]000\+ · 22\.5%/).isVisible())
  /* AMBER, AND NOT "No rate" -- and not 10% either, which is the leftover the scale was lost to. */
  t.ok('a client on tiers with no bands reads "Scale, boundaries missing"', await tieredRow.getByText('Scale, boundaries missing').isVisible())
  t.ok('...with the register\'s tiers', await tieredRow.getByText('OSP 21% · OSP2 15% · OSP3 12% · OSP4 10%').isVisible())
  await tieredRow.getByRole('button', { name: 'Change' }).click()
  const tdialog = page.getByRole('dialog')
  await tdialog.waitFor({ timeout: 5000 })
  t.check('...whose dialog opens as a scale', await tdialog.getByRole('button', { name: 'A sliding scale' }).getAttribute('aria-pressed'), 'true')
  t.check('...with the tiers\' rates filled in', await tdialog.getByLabel('Tier 2 rate').inputValue(), '15')
  t.check('...and the boundaries left to type, from the mandate', await tdialog.getByLabel('Tier 1 up to').inputValue(), '')
  /* A FLAT RATE OVER A SCALE IS CONFIRMED, not merely saved. */
  await tdialog.getByRole('button', { name: 'One rate' }).click()
  await tdialog.getByPlaceholder('A new mandate, a gazette, a correction…').fill('Testing')
  t.ok('a flat rate over a scale names what it replaces', await tdialog.getByText(/This replaces a 4-tier scale with a flat rate/).isVisible())
  t.check('...and will not go on until that is ticked', await tdialog.getByRole('button', { name: 'Continue' }).isDisabled(), true)
  await tdialog.getByRole('checkbox').check()
  t.check('...and will once it is', await tdialog.getByRole('button', { name: 'Continue' }).isDisabled(), false)
  await tdialog.getByRole('button', { name: 'Cancel' }).click()
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), null, { timeout: 5000 })

  /* ---------- 2: a scale client can be changed, and opens on its own tiers ---------- */
  t.ok('a client on a sliding scale has a Change button', await bandedRow.getByRole('button', { name: 'Change' }).isVisible())
  await bandedRow.getByRole('button', { name: 'Change' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ timeout: 5000 })
  t.check('...which opens on the scale, not a blank rate',
    await dialog.getByRole('button', { name: 'A sliding scale' }).getAttribute('aria-pressed'), 'true')
  t.check('...with its own tiers filled in', await dialog.getByLabel('Tier 1 up to').inputValue(), '25000')
  /* 0.225 is 22.5, not 22.500000000000004 -- the round trip the firm would see. */
  t.check('...and its rates as the firm wrote them', await dialog.getByLabel('Tier 2 rate').inputValue(), '22.5')
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  /* ---------- 1: a flat-rate client moved onto a sliding scale ---------- */
  await flatRow.getByRole('button', { name: 'Change' }).click()
  await dialog.waitFor({ timeout: 5000 })
  t.ok('the dialog offers a sliding scale', await dialog.getByRole('button', { name: 'A sliding scale' }).isVisible())
  await dialog.getByRole('button', { name: 'A sliding scale' }).click()
  await dialog.getByLabel('Tier 1 up to').fill('100000')
  await dialog.getByLabel('Tier 1 rate').fill('30')
  await dialog.getByRole('button', { name: /Another tier/ }).click()
  await dialog.getByLabel('Tier 2 up to').fill('250000')
  await dialog.getByLabel('Tier 2 rate').fill('25')
  await dialog.getByLabel('Tier 3 rate').fill('20')
  /* THE START OF EACH TIER IS SHOWN, NOT TYPED: a cent above the one before. The grouping separator
     is whatever this browser's en-ZA gives -- a space on one, a comma on another -- so both. */
  t.ok('each tier says where it starts', await dialog.getByText(/From R\s?100[\s,]000[.,]01/).first().isVisible())
  const go = dialog.getByRole('button', { name: 'Continue' })
  t.check('nothing goes without a reason', await go.isDisabled(), true)
  await dialog.getByPlaceholder('A new mandate, a gazette, a correction…').fill('New mandate signed 1 October')
  await dialog.getByPlaceholder('Signed mandate, 30 April 2024').fill('Signed mandate, 1 October 2026')
  t.check('...and with one it may go on', await go.isDisabled(), false)
  await go.click()
  /* READ BACK IN WORDS before anything is written, as Add client does. */
  t.ok('the terms are read back before saving', await dialog.getByText(/up to R\s?100[\s,]000[.,]00 — 30%/).isVisible()
    && await dialog.getByText(/and above — 20%/).isVisible())
  await t.shot(page, 'commission-scale-confirm')
  t.check('...and nothing has been written yet', patches.length, 0)
  await dialog.getByRole('button', { name: 'Confirm and save' }).click()
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), null, { timeout: 10000 })

  const written = patches.find((p) => p.url.includes(FLAT.id))?.body
  t.ok('the client is written', !!written)
  t.check('...on the scale, as fractions, in the order typed', JSON.stringify(written?.commission_bands),
    JSON.stringify([{ upTo: 100000, rate: 0.3 }, { upTo: 250000, rate: 0.25 }, { upTo: null, rate: 0.2 }]))
  t.check('...with where it came from', written?.commission_bands_source, 'Signed mandate, 1 October 2026')
  /* ONE OR THE OTHER: the engine prices from the bands whenever there are any, so an old rate left
     behind would be a screen saying 30% over a scale doing the pricing. */
  t.check('...and the flat rate cleared', written?.commission_rate, null)
  t.check('the change is in the audit trail', logged[0]?.setting, 'commission_bands')
  t.check('...with the reason given', logged[0]?.reason, 'New mandate signed 1 October')
  await context.close()
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).split('\n').slice(0, 4).join(' | ').slice(0, 300)})`, false)
  try {
    const pages = browser.contexts().flatMap((c) => c.pages())
    if (pages[0]) await t.shot(pages[0], 'commission-scale-where-it-stopped')
  } catch { /* nothing more to learn */ }
} finally {
  await browser.close()
  stopServer(server)
}

const good = t.finish(`A client's commission can be set as a sliding scale from Trust settings, a scale client
can be changed and opens on its own tiers, and saving writes the bands and clears the rate. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)
