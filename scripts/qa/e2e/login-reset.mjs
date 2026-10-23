/**
 * A PASSWORD RESET, IN A REAL BROWSER (S10, 23 Oct).
 *
 * check-login-reset reads the source; this proves the page. An expired link lands on /login with the
 * reason in the hash and the page says so; "Forgot password?" sends once and then holds.
 *
 * Run: node scripts/qa/e2e/login-reset.mjs
 */
import { PORT, chromium, makeRunner, startServer, stopServer, stubSupabase } from './harness.mjs'

const t = makeRunner('login-reset')
const server = await startServer()
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 } })
  const page = await context.newPage()
  const recovers = []
  await stubSupabase(page, [
    [(u) => /\/auth\/v1\/recover/.test(u), (u, req) => { recovers.push(req.postDataJSON()); return { body: {} } }],
  ])
  await page.goto(`http://localhost:${PORT}/login#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`)
  await page.getByRole('button', { name: 'Sign In' }).waitFor()
  t.ok('an expired link is explained', await page.getByText(/expired or was replaced by a newer one/).isVisible())
  await t.shot(page, 'login-reset-expired')

  await page.getByPlaceholder('Enter your email address').fill('someone@example.co.za')
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await page.getByTestId('reset-sent').waitFor()
  t.check('one reset asked for', recovers.length, 1)
  const held = page.getByRole('button', { name: /Send another link in \d+s/ })
  t.ok('the button then waits', await held.isVisible())
  t.ok('...and cannot be pressed', await held.isDisabled())
  t.ok('the message says to open only the newest', await page.getByText(/Open only the\s+newest one/).isVisible())
  await t.shot(page, 'login-reset-sent')
  await context.close()

  /* THE DOOR IS ALWAYS RAPTOR'S: a browser that remembers somebody else's skin still shows the
     firm's photograph at sign-in. */
  for (const skin of ['glass-mountain', 'desert', 'ocean', 'original']) {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await c.addInitScript((s) => { try { localStorage.setItem('crm.theme', s) } catch { /* ignore */ } }, skin)
    const p = await c.newPage()
    await stubSupabase(p, [])
    await p.goto(`http://localhost:${PORT}/login`)
    await p.getByRole('button', { name: 'Sign In' }).waitFor()
    t.check(`a browser on ${skin}: sign-in wears raptor`, await p.evaluate(() => document.documentElement.getAttribute('data-theme')), 'raptor')
    t.ok(`a browser on ${skin}: the Raptor photograph`, /raptor-login/.test(await p.evaluate(() =>
      getComputedStyle(document.querySelector('.login-photo')).backgroundImage)))
    /* AND NOTHING DRAWN OVER IT: a fixed backdrop paints above an unpositioned page, so the shell
       has to make its own stacking layer above z-index auto. */
    t.ok(`a browser on ${skin}: the page sits above any skin backdrop`, await p.evaluate(() => {
      const shell = getComputedStyle(document.querySelector('[data-testid="auth-shell"]'))
      return shell.position !== 'static' && Number(shell.zIndex) >= 1
    }))
    if (skin === 'glass-mountain') await t.shot(p, 'login-on-glass-mountain')
    await c.close()
  }
} finally {
  await browser.close()
  stopServer(server)
}
t.finish()
