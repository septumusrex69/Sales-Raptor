/**
 * RAPTOR'S OWN OPENING, AFTER A SIGN-IN, AND ON DEMAND (S16, 30 Oct).
 *
 * Stephan: "for the Raptor login, let's also try and make three type of ones when it's loading and opening ... with
 * the Raptor theme." Two things are proved in the real app: that pressing Sign In with a good password actually plays
 * an opening over the app (a component nothing mounts is invisible to every source check), and that each of the three
 * on /opening finishes with the wing and the name drawn -- a base rule hiding one of them looks fine in the code.
 *
 * Run: node scripts/qa/e2e/raptor-openings.mjs
 */
import { PORT, chromium, fakeSession, makeRunner, startServer, stopServer, stubSupabase } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('raptor-openings')
const server = await startServer()
const browser = await chromium.launch()
try {
  /* ---------------- the sign-in plays it ---------------- */
  {
    const context = await browser.newContext({ viewport: { width: 1180, height: 820 } })
    const page = await context.newPage()
    const tokens = []
    await stubSupabase(page, [
      [(u) => /\/auth\/v1\/token/.test(u), () => { tokens.push(1); return { body: fakeSession(PROFILE.id, PROFILE.email) } }],
      [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [PROFILE] })],
    ])
    await page.goto(`http://localhost:${PORT}/login`)
    await page.getByRole('button', { name: 'Sign In' }).waitFor()
    t.check('no opening before anybody signs in', await page.getByTestId('raptor-opening').count(), 0)
    await page.getByPlaceholder('Enter your email address').fill(PROFILE.email)
    await page.getByPlaceholder('Enter your password').fill('a password')
    await page.getByRole('button', { name: 'Sign In' }).click()
    await page.getByTestId('raptor-opening').waitFor({ timeout: 5000 })
    t.ok('a good password plays the opening -- lock-on, the one Stephan liked', tokens.length === 1
      && (await page.getByTestId('raptor-opening').getAttribute('data-variant')) === 'lock')
    await page.waitForTimeout(1500)
    await t.shot(page, 'raptor-opening-signin')
    t.ok('...and it still covers the app at 1.5 s', await page.getByTestId('raptor-opening').isVisible())
    await page.getByTestId('raptor-opening').waitFor({ state: 'detached', timeout: 6000 })
    t.ok('...then gives the app back, signed in', !/\/login/.test(page.url()))
    await page.reload()
    await page.waitForTimeout(800)
    t.check('a reload, already signed in, plays nothing', await page.getByTestId('raptor-opening').count(), 0)
    await context.close()
  }

  /* ---------------- /opening plays each of the three ---------------- */
  {
    const context = await browser.newContext({ viewport: { width: 1180, height: 820 } })
    const page = await context.newPage()
    await stubSupabase(page, [])
    await page.goto(`http://localhost:${PORT}/opening`)
    await page.getByTestId('raptor-openings').waitFor()
    t.ok('no sign-in: the replay page opens straight onto the three', await page.getByTestId('raptor-opening-lock').isVisible())
    for (const v of ['lock', 'dive', 'summit']) {
      await page.getByTestId(`raptor-opening-${v}`).click()
      const op = page.locator(`[data-testid="raptor-opening"][data-variant="${v}"]`)
      await op.waitFor()
      await page.waitForTimeout(1300)
      await t.shot(page, `raptor-opening-${v}-early`)
      await page.waitForTimeout(1500)
      await t.shot(page, `raptor-opening-${v}`)
      const drawn = await page.evaluate(() => {
        const vis = (sel) => {
          const e = document.querySelector(sel); if (!e) return false
          const r = e.getBoundingClientRect(); const s = getComputedStyle(e)
          return Number(s.opacity) > 0.9 && r.width > 40 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
            && (s.clipPath === 'none' || /^inset\((0(px|%)?\s*)+\)$/.test(s.clipPath))
        }
        return { wing: vis('.raptor-opening .ro-wing'), words: vis('.raptor-opening .ro-words-img') }
      })
      t.ok(`${v}: the wing is drawn, in view, by the end`, drawn.wing)
      t.ok(`${v}: the name is drawn by the end`, drawn.words)
      await op.waitFor({ state: 'detached', timeout: 4000 })
    }
    /* Summit over another skin's photograph (Stephan, 31 Oct: "examples with the other pictures like africa"). */
    await page.locator('[data-testid="raptor-opening-photos"] [data-photo="africa"]').click()
    await page.locator('[data-testid="raptor-opening"][data-variant="summit"]').waitFor()
    await page.waitForTimeout(2600)
    await t.shot(page, 'raptor-opening-summit-africa')
    t.ok('summit plays over the Africa photograph when asked', /africa-hero/.test(await page.locator('.ro-photo').evaluate((e) => e.style.backgroundImage)))
    await context.close()
  }
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).slice(0, 200)})`, false)
} finally {
  await browser.close()
  stopServer(server)
}
t.finish()
