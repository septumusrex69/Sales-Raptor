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
} finally {
  await browser.close()
  stopServer(server)
}
t.finish()
