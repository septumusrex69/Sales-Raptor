/**
 * THE CLIENTS WAITING FOR A LIAISON, IN BULK -- ASSIGNED OR MARKED DORMANT (S11).
 *
 * THE FIRM: "With a swordfish import for them, you should be able to do something with them in bulk
 * ... assign them in bulk, or leave us dormant." In a real browser, as a Liaison Manager on Clients:
 *   1. the panel lists the clients needing a liaison (not the dormant one), tick all, choose a
 *      liaison, Assign: ONE request naming every client, and the screen says no welcome went;
 *   2. tick some, Mark dormant: one write naming them, with when, why and who;
 *   3. the dormant client lives on its own shelf, and its page says so and offers Make active.
 *
 * Run: RAPTOR_E2E_PORT=5702 node scripts/qa/e2e/client-dormant.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE, TEAM } from './fixtures.mjs'

const t = makeRunner('client-dormant')
const NICOLE = { ...PROFILE, id: 'u-nicole', name: 'Nicole Loder', email: 'n@x.co.za', role: 'Liaison Manager' }
const RUAN = { ...PROFILE, id: 'u-ruan', name: 'Ruan Venter', email: 'r@x.co.za', role: 'Liaison' }
const STEPHAN = { ...PROFILE, id: 'u-stephan', name: 'Stephan', email: 's@x.co.za', role: 'Administrator' }
const PEOPLE = [NICOLE, RUAN, STEPHAN]
const client = (id, name, code, extra = {}) => ({ id, name, code, account_owner_id: STEPHAN.id, created_at: '2026-10-01T07:00:00Z',
  import_batch_id: 'run-1', liaison_needed: true, ...extra })
const COMPANIES = [
  client('c-a', 'Agri Saad', 'AGS'), client('c-b', 'Bonnitta Pharmacy', 'BOP'), client('c-k', 'Kestrel', 'KIS'),
  client('c-d', 'Dusty Holdings', 'DUH', { liaison_needed: false, dormant_at: '2026-10-24T08:00:00Z', dormant_reason: 'Dormant in Swordfish' }),
]

const open = async (page, path) => {
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}${path}`, { timeout: 2000 }); return }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
}

const server = await startServer()
const browser = await chromium.launch()
try {
  const writes = []
  const { page } = await signedInPage(browser, NICOLE, [
    [(u, req) => req.method() === 'PATCH' && u.includes('/rest/v1/companies'), (u, req) => {
      writes.push({ url: decodeURIComponent(u), body: req.postDataJSON() })
      return { status: 200, body: [] }
    }],
    [(u) => /\/rest\/v1\/profiles.*id=eq\./.test(u), () => ({ body: [NICOLE] })],
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: PEOPLE })],
    [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: COMPANIES })],
    [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
    [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  ], [], { now: '2026-10-25T10:00:00+02:00' })
  const asked = []
  await page.route('**/api/email/**', async (route) => {
    const action = new URL(route.request().url()).pathname.replace(/^.*\/api\/email\//, '')
    if (action === 'assign-liaison') asked.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assigned: 2, imported: false, tasks: false, error: null }) })
  })
  await page.setViewportSize({ width: 1180, height: 900 })
  await open(page, '/companies')
  const panel = page.getByTestId('needs-liaison-panel')
  await panel.waitFor({ timeout: 20000 })

  /* 1. Assign in bulk. */
  t.ok('the panel counts the clients needing a liaison, not the dormant one', /3 clients need a liaison/.test(await panel.innerText()))
  t.ok('...and does not list the dormant one', !/Dusty Holdings/.test(await panel.innerText()))
  t.ok('...nothing is pressable until something is ticked and a liaison chosen', await page.getByTestId('needs-liaison-assign').isDisabled())
  await panel.getByLabel('Choose Agri Saad').check()
  await panel.getByLabel('Choose Kestrel').check()
  await panel.locator('select').selectOption(RUAN.id)
  await page.getByTestId('needs-liaison-assign').click()
  await page.getByTestId('needs-liaison-done').waitFor({ timeout: 10000 })
  t.check('ONE request, naming the ticked clients and her', JSON.stringify(asked), JSON.stringify([{ companyIds: ['c-a', 'c-k'], liaisonId: RUAN.id }]))
  t.ok('...and it says she was told and no welcome went', /Ruan Venter now looks after 2 clients and has been told\. No welcome: existing clients from Swordfish\./
    .test(await page.getByTestId('needs-liaison-done').innerText()))
  t.ok('...and they leave the list', /1 client needs a liaison/.test(await panel.innerText()) && !/Agri Saad/.test(await panel.innerText()))
  await t.shot(page, 'client-dormant-1-assigned')

  /* 2. Mark dormant. */
  await panel.getByLabel('Choose Bonnitta Pharmacy').check()
  await panel.getByPlaceholder('Why dormant? (optional)').fill('Not using us any more')
  await page.getByTestId('needs-liaison-dormant').click()
  await page.waitForTimeout(800)
  const mark = writes.find((w) => w.body && 'dormant_at' in w.body)
  t.ok('one write marks it dormant', !!mark && /id=in\.\(c-b\)/.test(mark.url))
  t.check('...with why and who, and no liaison asked for', JSON.stringify(mark ? [mark.body.dormant_reason, mark.body.dormant_by, mark.body.liaison_needed] : null),
    JSON.stringify(['Not using us any more', NICOLE.id, false]))

  /* 3. The dormant shelf, and a dormant client's page. */
  const shelf = page.getByTestId('client-shelf')
  t.ok('the list offers a Dormant shelf with its count', /Dormant \(2\)/.test(await shelf.innerText()))
  await shelf.getByRole('radio', { name: /Dormant/ }).click()
  const table = page.locator('table.list-table')
  t.ok('...the shelf holds the dormant clients', /Dusty Holdings/.test(await table.innerText()) && /Bonnitta Pharmacy/.test(await table.innerText())
    && !/Kestrel/.test(await table.innerText()))
  await open(page, '/companies/c-d')
  const banner = page.getByTestId('client-dormant')
  await banner.waitFor({ timeout: 20000 })
  t.ok('a dormant client\'s page says so, and why', /Dormant since .*Dormant in Swordfish/.test(await banner.innerText()))
  t.ok('...and offers Make active', await page.getByTestId('client-make-active').isVisible())
  await t.shot(page, 'client-dormant-2-page')
  await page.context().close()
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish('Clients waiting for a liaison are assigned in bulk with one request, or marked dormant in one write; dormant clients have their own shelf and say so on their page.')
process.exit(good ? 0 : 1)
