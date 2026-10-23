/**
 * A LIAISON LOADS THEIR DEPARTMENT'S CLIENTS, OUTSIDE SETTINGS, IN A REAL BROWSER (23 Oct).
 *
 * THE FIRM (Stephan): "any person in the client liaison department can upload a handover sheet" --
 * the sheet and the single account. check-handover-upload holds the rule and the database's twin;
 * this holds what only a browser shows -- that the buttons are drawn for exactly the right people,
 * and that pressing one lands on the importer itself, not on Settings and not on a refusal.
 *
 *   1. A Liaison, own client: Upload a batch and Add debtor are there; the button lands on
 *      /companies/:id/upload with the importer drawn and the client already chosen; the picker
 *      offers their own and a department colleague's client and not one owned by Administration.
 *   2. A department colleague's client: both buttons.
 *   3. A client whose liaison is outside the department: neither button; the address typed by hand
 *      says why rather than drawing the importer.
 *   4. Settings -> Data Import is still the Administrator's: the liaison is told so there.
 *   5. A Pre-legal Agent sees no client page at all, so no button, and the upload address sends
 *      them back to the book.
 *
 * Run: RAPTOR_E2E_PORT=5521 node scripts/qa/e2e/liaison-upload.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('liaison-upload')

const COMMS = 'dddddddd-0000-4000-8000-000000000001'
const ADMIN_D = 'dddddddd-0000-4000-8000-000000000002'
const CALL = 'dddddddd-0000-4000-8000-000000000003'
const DEPARTMENTS = [
  { id: COMMS, name: 'Communications', head_id: null, duties: ['load_handovers'], sort: 2 },
  { id: ADMIN_D, name: 'Administration', head_id: null, duties: [], sort: 0 },
  { id: CALL, name: 'Call centre', head_id: null, duties: [], sort: 3 },
]
const base = { ...PROFILE, team_id: null, grants: [], revokes: [] }
const LIAISON = { ...base, id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Bonnitta Prins', email: 'b@raptor.test', role: 'Liaison', department_id: COMMS }
const COLLEAGUE = { ...base, id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Nicole Loder', email: 'n@raptor.test', role: 'Liaison Manager', department_id: COMMS }
const ADMIN = { ...base, id: 'aaaaaaaa-0000-4000-8000-000000000003', name: 'Stephan', email: 's@raptor.test', role: 'Administrator', department_id: ADMIN_D }
const AGENT = { ...base, id: 'aaaaaaaa-0000-4000-8000-000000000004', name: 'Nathi Kibido', email: 'k@raptor.test', role: 'Pre-legal Agent', department_id: CALL }
const PEOPLE = [LIAISON, COLLEAGUE, ADMIN, AGENT]

const client = (id, name, code, owner) => ({
  id, name, code, status: 'Won', owner_id: owner, account_owner_id: owner,
  mandate_signed_at: '2026-02-01', commission_rate: 0.25, created_at: '2026-01-01T00:00:00Z',
})
const OWN = client('cccccccc-0000-4000-8000-000000000001', 'Own Client Holdings', 'OWN', LIAISON.id)
const THEIRS = client('cccccccc-0000-4000-8000-000000000002', 'Colleague Client Trust', 'COL', COLLEAGUE.id)
const OUTSIDE = client('cccccccc-0000-4000-8000-000000000003', 'Outside Admin Estates', 'OUT', ADMIN.id)
const CLIENTS = [OWN, THEIRS, OUTSIDE]

const handlers = (me) => [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: me.id, email: me.email } })],
  [(u) => u.includes('/rest/v1/profiles'), (u) => {
    const one = /id=eq\.([0-9a-z-]+)/.exec(u)?.[1]
    return { body: one ? PEOPLE.filter((p) => p.id === one) : PEOPLE }
  }],
  [(u) => u.includes('/rest/v1/departments'), (u) => {
    const one = /id=eq\.([0-9a-z-]+)/.exec(u)?.[1]
    return { body: one ? DEPARTMENTS.filter((d) => d.id === one) : DEPARTMENTS }
  }],
  [(u) => u.includes('/rest/v1/companies'), (u) => {
    const one = /id=eq\.([0-9a-z-]+)/.exec(u)?.[1]
    return { body: one ? CLIENTS.filter((c) => c.id === one) : CLIENTS }
  }],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
]

async function open(page, path) {
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}${path}`, { timeout: 2000 }); return true }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  return false
}
const button = (page, name) => page.getByRole('button', { name, exact: true })
/* The client page is drawn once its name is; only then is "no button" an answer. */
async function clientPage(page, c) {
  await open(page, `/companies/${c.id}`)
  await page.getByText(c.name).first().waitFor({ timeout: 20000 })
    .catch(async (e) => { console.log((await page.locator('body').innerText()).slice(0, 600)); throw e })
  await page.waitForTimeout(600)
}

const server = await startServer()
const browser = await chromium.launch()
try {
  /* ------------------------------------------------ 1-4. a Liaison */
  {
    const { context, page } = await signedInPage(browser, LIAISON, handlers(LIAISON), [])

    await clientPage(page, OWN)
    /* PRESENCE FIRST: everything after passes vacuously on a page with no such button. */
    t.ok('own client: Upload a batch is there', await button(page, 'Upload a batch').first().isVisible().catch(() => false))
    t.ok('...and Add debtor', await button(page, 'Add debtor').first().isVisible().catch(() => false))
    await button(page, 'Upload a batch').first().click()
    await page.waitForURL(/\/upload$/, { timeout: 10000 }).catch(() => {})
    t.check('...it lands outside Settings', new URL(page.url()).pathname, `/companies/${OWN.id}/upload`)
    const heading = page.getByRole('heading', { name: 'Import a handover' }).first()
    await heading.waitFor({ timeout: 15000 }).catch(() => {})
    t.ok('...on the importer itself', await heading.isVisible().catch(() => false))
    t.check('...with no Swordfish import beside it', await page.getByText('Bring the book across from Swordfish').count(), 0)
    const box = page.getByPlaceholder(/Search for a client/).first()
    await box.waitFor({ timeout: 10000 }).catch(() => {})
    t.check('...and the client already chosen', await box.inputValue().catch(() => null), 'Own Client Holdings (OWN)')
    await t.shot(page, 'liaison-upload-landed')

    /* The picker: their own and the colleague's, never Administration's. */
    await box.click()
    await box.fill('')
    await page.getByRole('option').first().waitFor({ timeout: 5000 }).catch(() => {})
    const offered = (await page.getByRole('option').allInnerTexts().catch(() => [])).join(' | ')
    t.ok('the picker offers their own client', /Own Client Holdings/.test(offered))
    t.ok('...and a department colleague’s', /Colleague Client Trust/.test(offered))
    t.ok('...and not one whose liaison sits outside the department', !/Outside Admin Estates/.test(offered))
    await page.keyboard.press('Escape')

    await clientPage(page, THEIRS)
    t.ok('a colleague’s client: Upload a batch is there', await button(page, 'Upload a batch').first().isVisible().catch(() => false))
    t.ok('...and Add debtor', await button(page, 'Add debtor').first().isVisible().catch(() => false))

    await clientPage(page, OUTSIDE)
    t.check('a client outside the department: no Upload a batch', await button(page, 'Upload a batch').count(), 0)
    t.check('...and no Add debtor', await button(page, 'Add debtor').count(), 0)

    await open(page, `/companies/${OUTSIDE.id}/upload`)
    await page.getByTestId('upload-refused').waitFor({ timeout: 15000 }).catch(() => {})
    t.ok('the address typed by hand says why', /department of the client’s liaison/.test(await page.getByTestId('upload-refused').innerText().catch(() => '')))
    t.check('...and draws no importer', await page.getByRole('heading', { name: 'Import a handover' }).count(), 0)

    await open(page, '/settings?tab=Data+Import')
    await page.getByText('Only an Administrator can import the book').first().waitFor({ timeout: 15000 }).catch(() => {})
    t.ok('Settings -> Data Import is still the Administrator’s', await page.getByText('Only an Administrator can import the book').first().isVisible().catch(() => false))
    t.check('...with no importer there', await page.getByRole('heading', { name: 'Import a handover' }).count(), 0)
    await context.close()
  }

  /* ------------------------------------------------ 5. a Pre-legal Agent */
  {
    const { context, page } = await signedInPage(browser, AGENT, handlers(AGENT), [])
    await open(page, `/companies/${OWN.id}`)
    await page.waitForURL(/\/accounts/, { timeout: 15000 }).catch(() => {})
    t.check('a pre-legal agent has no client page to press it on', new URL(page.url()).pathname, '/accounts')
    t.check('...so no Upload a batch', await button(page, 'Upload a batch').count(), 0)
    await open(page, `/companies/${OWN.id}/upload`)
    await page.waitForURL(/\/accounts/, { timeout: 15000 }).catch(() => {})
    t.check('...and the upload address sends them back to the book', new URL(page.url()).pathname, '/accounts')
    t.check('...with no importer drawn', await page.getByRole('heading', { name: 'Import a handover' }).count(), 0)
    await context.close()
  }

  /* ------------------------------------------------ the Administrator, for contrast */
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers(ADMIN), [])
    await clientPage(page, OUTSIDE)
    t.ok('an Administrator: Upload a batch on any client', await button(page, 'Upload a batch').first().isVisible().catch(() => false))
    await open(page, `/settings?tab=Data+Import&client=${OUTSIDE.id}`)
    const heading = page.getByRole('heading', { name: 'Import a handover' }).first()
    await heading.waitFor({ timeout: 15000 }).catch(() => {})
    t.ok('...and Settings -> Data Import still works for them', await heading.isVisible().catch(() => false))
    await context.close()
  }
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish(
  `A liaison loads their own and their department colleagues' clients from the client page, on the
importer itself and outside Settings; a client whose liaison is elsewhere shows neither button and
refuses the typed address; Settings -> Data Import stays the Administrator's; a pre-legal agent
never reaches it.`)
process.exit(good ? 0 : 1)
