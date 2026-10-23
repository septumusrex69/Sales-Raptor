/**
 * THE WORKSPACE MENU STAYS PUT AND SCROLLS BY ITSELF (S10, 23 Oct).
 *
 * The firm, on a laptop in Trust: scrolling sideways "moves the trust money held in the other
 * people to the left. That should stay", and "I can't go down to narrow the pane, it's hidden there
 * at the bottom". On a short window, with something wider than the page in the content column:
 * the page never scrolls sideways, the content column does, the rail never moves, and the rail's
 * foot ("Narrow this menu") can be reached inside the rail itself.
 *
 * Run: node scripts/qa/e2e/workspace-rail-scroll.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('workspace-rail-scroll')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null }
const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  ], [])
  await page.setViewportSize({ width: 1280, height: 520 })
  await page.goto(`http://127.0.0.1:${PORT}/trust/payments`, { waitUntil: 'domcontentloaded' })
  const rail = page.getByRole('navigation', { name: /Trust menu/ })
  await rail.waitFor()
  await page.waitForTimeout(800)

  /* Something wider than the page, where a wide table would be. */
  await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Trust menu"]')
    const wide = document.createElement('div')
    wide.style.width = '3000px'; wide.style.height = '20px'; wide.dataset.testid = 'wide'
    nav.nextElementSibling.appendChild(wide)
  })
  const m = await page.evaluate(() => {
    const main = document.querySelector('main')
    const nav = document.querySelector('nav[aria-label="Trust menu"]')
    const col = nav.nextElementSibling
    const railLeft = nav.getBoundingClientRect().left
    main.scrollLeft = 500
    col.scrollLeft = 500
    const r = nav.getBoundingClientRect()
    const mb = main.getBoundingClientRect()
    nav.scrollTop = nav.scrollHeight
    const narrow = [...nav.querySelectorAll('button')].pop().getBoundingClientRect()
    return {
      pageSideways: main.scrollWidth - main.clientWidth,
      colScrolled: col.scrollLeft,
      railMoved: Math.abs(r.left - railLeft),
      railInsideMain: r.bottom <= mb.bottom + 1,
      narrowVisible: narrow.bottom <= mb.bottom + 1 && narrow.top >= mb.top - 1,
    }
  })
  t.check('the page itself never scrolls sideways', m.pageSideways <= 0, true)
  t.ok('the content column scrolls instead', m.colScrolled > 0)
  t.check('the rail does not move', m.railMoved, 0)
  t.ok('the rail ends inside main on a short window', m.railInsideMain)
  t.ok("...and its foot can be scrolled to inside the rail", m.narrowVisible)
  await t.shot(page, 'workspace-rail-short-window')
  await context.close()
} finally {
  await browser.close()
  stopServer(server)
}
t.finish()
