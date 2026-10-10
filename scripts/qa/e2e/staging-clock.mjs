/**
 * THE STAGING CLOCK'S BANNER AND CONTROLS, IN A REAL BROWSER (prompt 10).
 *
 * What only a browser can say: that the banner is ON every screen and readable, that the page
 * still draws once the clock has been read (the layout holds every page until it has), that only
 * an Administrator gets the buttons, that a button asks the server to jump to the right day, and
 * that production -- where the database says it is not staging -- draws nothing at all.
 *
 * The money side of the clock (three cycles, the 11th closing them, the trust reconciling) cannot
 * be seen through stubs and is proved against staging by scripts/qa/live/staging-clock-sim.sql.
 *
 * Run: node scripts/qa/e2e/staging-clock.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('staging-clock')

const ADMIN = { ...PROFILE, role: 'Administrator', name: 'Test Admin' }
const NOW = '2026-10-10T10:00:00+02:00'
const STAGING = {
  business_now: '2026-07-11T08:00:00Z', business_today: '2026-07-11',
  real_now: '2026-10-10T08:00:00Z', real_today: '2026-10-10', staging: true, moved: true,
}
const PRODUCTION = { ...STAGING, business_now: '2026-10-10T08:00:00Z', business_today: '2026-10-10', staging: false, moved: false }

const handlers = (profile, clock) => [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [profile] })],
  [(u) => u.includes('/rpc/raptor_clock'), () => ({ body: [clock] })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
]

const open = async (page, path) => {
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}${path}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.waitForTimeout(2000)
}

const server = await startServer()
let browser
try {
  browser = await chromium.launch()

  /* ---------------------------------------------------------------- staging, an Administrator */
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers(ADMIN, STAGING), [], { now: NOW })
    const posted = []
    await page.route('**/api/workflow/clock', async (route) => {
      posted.push(JSON.parse(route.request().postData() ?? '{}'))
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, reached: posted.at(-1).to, to: posted.at(-1).to, done: true, days: [] }) })
    })
    await open(page, '/tasks')

    const line = page.getByTestId('staging-clock-line')
    t.check('the banner is drawn', await line.count(), 1)
    /* Read only if drawn: a missing banner should fail the line above, not time out here. */
    t.check('...in the firm\'s words', (await line.count()) ? (await line.innerText()).trim() : null, 'Staging date 11 Jul 2026 (real date 10 Oct 2026)')
    const box = await page.getByTestId('staging-clock').boundingBox()
    t.ok('...at the top of the screen, above the page', box !== null && box.y < 60 && box.height > 10)
    /* The layout holds the page until the clock is read; it must not hold it for ever. */
    t.ok('the page under it still draws', (await page.locator('main').innerText()).trim().length > 0)

    const controls = page.getByTestId('staging-clock-controls')
    t.check('an Administrator gets the controls', await controls.count(), 1)
    t.check('...+1 day', await page.getByRole('button', { name: '+1 day', exact: true }).count(), 1)
    t.check('...to the 11th, which from the 11th is next month', await page.getByRole('button', { name: /To the 11th · 11 Aug 2026/ }).count(), 1)
    t.check('...to the 10th', await page.getByRole('button', { name: /To the 10th · 10 Aug 2026/ }).count(), 1)
    t.check('...a picked date', await page.getByRole('button', { name: 'Pick a date', exact: true }).count(), 1)
    t.check('...and Clear staging', await page.getByRole('button', { name: /Clear staging/ }).count(), 1)

    await page.getByRole('button', { name: /To the 11th/ }).click()
    await page.waitForTimeout(1500)
    /* As JSON: this runner compares with Object.is, which no two arrays pass (HANDOFF.md). */
    t.check('a jump asks the server for the day the button named', JSON.stringify(posted.map((p) => p.to)), '["2026-08-11"]')
    t.ok('...as a fresh jump, not a resume', posted[0]?.resume === false)

    /* Clear staging asks for the words before it will go. */
    await page.getByRole('button', { name: /Clear staging/ }).click()
    const go = page.getByRole('button', { name: 'Clear and start the clock', exact: true })
    t.check('Clear staging opens its form', await go.count(), 1)
    t.ok('...and will not go until the words are typed', await go.isDisabled())
    await context.close()
  }

  /* ---------------------------------------------------------------- staging, not an Administrator */
  {
    const { context, page } = await signedInPage(browser, PROFILE, handlers(PROFILE, STAGING), [], { now: NOW })
    await open(page, '/tasks')
    t.check('everybody on staging sees the banner', await page.getByTestId('staging-clock-line').count(), 1)
    t.check('...but only an Administrator gets the buttons', await page.getByTestId('staging-clock-controls').count(), 0)
    await context.close()
  }

  /* ---------------------------------------------------------------- production */
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers(ADMIN, PRODUCTION), [], { now: NOW })
    await open(page, '/tasks')
    t.check('production draws no banner', await page.getByTestId('staging-clock').count(), 0)
    t.ok('...and the page draws', (await page.locator('main').innerText()).trim().length > 0)
    await context.close()
  }
} finally {
  await browser?.close()
  stopServer(server)
}
t.finish()
