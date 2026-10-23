/**
 * A TAB THAT OUTLIVED A DEPLOY, IN A REAL BROWSER (S10, 23 Oct).
 *
 * The firm photographed "Failed to fetch dynamically imported module .../CalendarPage-….js" on the
 * router's developer page, mid-call, on every tab she clicked. Here the calendar's file is made to
 * vanish the way a deploy makes it vanish: once -> the page reloads itself and the calendar opens;
 * for good -> one reload, then Raptor's own "has been updated" screen, never a loop and never the
 * developer notice.
 *
 * Run: node scripts/qa/e2e/stale-chunk.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('stale-chunk')
const server = await startServer()
const browser = await chromium.launch()
const handlers = [[(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [PROFILE] })]]

async function run(failures) {
  const { context, page } = await signedInPage(browser, PROFILE, handlers, [])
  let left = failures
  let loads = 0
  page.on('load', () => { loads += 1 })
  await page.route(/CalendarPage/, (route) => (left-- > 0 ? route.abort() : route.continue()))
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForLoadState('networkidle')
  const before = loads
  await page.evaluate(() => { window.history.pushState({}, '', '/calendar'); window.dispatchEvent(new PopStateEvent('popstate')) })
  await page.waitForTimeout(4000)
  const reloads = loads - before
  const text = await page.locator('body').innerText()
  await context.close()
  return { reloads, text }
}

try {
  const once = await run(1)
  t.check('a missing screen file reloads the page once', once.reloads, 1)
  t.ok('...and then the screen opens, not an error', !/Unexpected Application Error|has been updated|Failed to fetch/i.test(once.text))

  const always = await run(99)
  t.check('a file that stays missing reloads only once', always.reloads, 1)
  t.ok("...then says Raptor was updated", /Raptor has been updated/.test(always.text))
  t.ok('...and never the router\'s developer notice', !/Unexpected Application Error|Hey developer/.test(always.text))
} finally {
  await browser.close()
  stopServer(server)
}
t.finish()
