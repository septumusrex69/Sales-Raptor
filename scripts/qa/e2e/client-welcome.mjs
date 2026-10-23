/**
 * ASSIGN A NEW CLIENT'S LIAISON, ON THE CLIENT PAGE (S8, 18 Oct: "Here it told me to assign it, but I
 * don't know how to assign it"). The notification opens the client; the Assign box is there; pressing
 * it asks the welcome route for that client and that liaison, and the steps tick.
 *
 * Run: node scripts/qa/e2e/client-welcome.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE, COMPANY_ID } from './fixtures.mjs'

const t = makeRunner('client-welcome')
const ADMIN = { ...PROFILE, role: 'Administrator', name: 'Stephan' }
const BONITA = { ...PROFILE, id: 'u-bonita', name: 'Bonita Mahlangu', email: 'b@x.co.za', role: 'Liaison Manager' }
const RUAN = { ...PROFILE, id: 'u-ruan', name: 'Ruan Venter', email: 'r@x.co.za', role: 'Liaison' }
const DEAN = { ...PROFILE, id: 'u-dean', name: 'Dean Fourie', email: 'd@x.co.za', role: 'Sales Manager' }
const COMPANY = { id: COMPANY_ID, name: 'Abc Cricket', account_owner_id: ADMIN.id, created_at: '2026-10-11T07:00:00Z',
  commission_rate: 0.25, mandate_signed_at: '2026-10-11T08:00:00Z', liaison_needed: true }
const posted = []

const server = await startServer()
const browser = await chromium.launch()
try {
  const { page } = await signedInPage(browser, ADMIN, [
    [(u) => /\/rest\/v1\/profiles.*id=eq\./.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN, BONITA, RUAN, DEAN] })],
    [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [COMPANY] })],
  ], [], { now: '2026-10-18T10:00:00+02:00' })
  await page.route('**/api/email/welcome', async (route) => {
    posted.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assigned: true, sent: true, fromLiaison: true }) })
  })
  await page.setViewportSize({ width: 1180, height: 900 })
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/companies/${COMPANY_ID}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  const card = page.getByTestId('welcome-card')
  await card.waitFor({ timeout: 20000 })
  t.ok('a client signed online shows the Assign a liaison box', /Assign a liaison/.test(await card.innerText()))
  const offered = await card.locator('select option').allTextContents()
  t.check('...offering liaisons only, the manager marked', JSON.stringify(offered), JSON.stringify(['Choose a liaison…', 'Bonita Mahlangu (manager)', 'Ruan Venter']))
  t.ok('...and nothing is pressed until one is chosen', await page.getByTestId('welcome-assign').isDisabled())
  await card.locator('select').selectOption('u-bonita')
  await page.getByTestId('welcome-assign').click()
  await card.getByRole('status').waitFor({ timeout: 10000 })
  /* The handover sheet rides along too (23 Oct); e2e/handover-sheet holds that half. */
  t.check('it asks the welcome route for this client and this liaison', JSON.stringify([posted[0]?.companyId, posted[0]?.liaisonId]), JSON.stringify([COMPANY_ID, 'u-bonita']))
  t.ok('...says what happened, in words', /Bonita Mahlangu now looks after Abc Cricket. The welcome email went from her mailbox/.test(await card.innerText()))
  const ticks = await page.getByTestId('welcome-steps').locator('li').evaluateAll((lis) => lis.map((li) => li.querySelector('span')?.className.includes('bg-emerald') ?? false))
  t.check('...and the steps tick: signed, assigned, emailed, not yet called', JSON.stringify(ticks), '[true,true,true,false]')
  await card.scrollIntoViewIfNeeded()
  await t.shot(page, 'client-welcome')
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish('The client page assigns a new client\'s liaison and welcomes them in one press, and shows the welcome steps.')
process.exit(good ? 0 : 1)
