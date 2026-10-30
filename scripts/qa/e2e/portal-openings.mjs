/**
 * THE PORTAL'S OPENINGS, REPLAYABLE (S16, 30 Oct).
 *
 * Stephan: "give me a link where I can replay it ... and just make two different ones as well." /portal/opening
 * needs no sign-in and plays each of the three on a press. This proves each one actually draws (a base rule hiding
 * the monogram is invisible to every source check -- it hid the coast's logo once while it was being written), and
 * that each can be played again.
 *
 * Run: node scripts/qa/e2e/portal-openings.mjs
 */
import { PORT, chromium, makeRunner, startServer, stopServer, stubSupabase } from './harness.mjs'

const t = makeRunner('portal-openings')
const server = await startServer()
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 } })
  const page = await context.newPage()
  await stubSupabase(page, [])
  await page.goto(`http://localhost:${PORT}/portal/opening`)
  await page.getByTestId('portal-openings').waitFor()
  t.ok('no sign-in: the page opens straight onto the three', await page.getByTestId('opening-circle').isVisible())
  await t.shot(page, 'portal-openings')

  for (const v of ['circle', 'coast', 'towers']) {
    await page.getByTestId(`opening-${v}`).click()
    const splash = page.locator(`.portal-splash[data-variant="${v}"]`)
    await splash.waitFor()
    t.ok(`${v}: the full opening plays`, (await splash.getAttribute('data-splash')) === 'full')
    await page.waitForTimeout(1200)
    await t.shot(page, `portal-opening-${v}-early`)
    await page.waitForTimeout(1600)
    await t.shot(page, `portal-opening-${v}`)
    const mono = await page.locator('.portal-splash .portal-splash-monogram').first().evaluate((e) => {
      const r = e.getBoundingClientRect(); const s = getComputedStyle(e)
      return { op: Number(s.opacity), w: r.width, inView: r.top >= 0 && r.bottom <= innerHeight }
    })
    t.ok(`${v}: the monogram is drawn by the end`, mono.op > 0.9 && mono.w > 60 && mono.inView)
    const word = await page.locator('.portal-splash-word img').evaluate((e) => {
      const s = getComputedStyle(e); return Number(s.opacity) > 0.9 && s.clipPath !== 'inset(0px 50%)'
    })
    t.ok(`${v}: the wordmark is drawn by the end`, word)
    await page.locator('.portal-splash').waitFor({ state: 'detached', timeout: 4000 })
    t.ok(`${v}: then it gives the page back, with the replay mark on it`, await page.getByTestId(`opening-${v}`).isVisible())
  }

  await page.getByTestId('opening-coast').click()
  await page.locator('.portal-splash[data-variant="coast"]').waitFor()
  t.ok('a second play of the same one plays it in full again', (await page.locator('.portal-splash').getAttribute('data-splash')) === 'full')
  await context.close()
} finally {
  await browser.close()
  stopServer(server)
}
t.finish()
