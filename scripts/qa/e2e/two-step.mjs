/**
 * TWO-STEP SIGN-IN FOR ADMINISTRATORS, IN A REAL BROWSER (S8, 18 Oct; security audit B-02).
 *
 * The firm: "Can you turn on the two-step factor login?" What only a browser can say: an
 * Administrator who has not confirmed this sign-in sees the code box and NOT the app; one with no
 * authenticator is walked through setting one up (the QR code is drawn); a confirmed session, and
 * anybody who is not an Administrator, goes straight through. The code itself is checked by
 * Supabase; what is held here is that Raptor asks, and sends what it was given.
 *
 * Run: node scripts/qa/e2e/two-step.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('two-step')
const ADMIN = { ...PROFILE, role: 'Administrator' }
const AGENT = { ...PROFILE, role: 'Pre-legal Agent' }
/* RAW SVG, as Supabase sends it: supabase-js itself prefixes the data: scheme. */
const QR = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'

async function open(browser, who, opts, extra = []) {
  const sent = []
  const handlers = [
    [(u) => /\/auth\/v1\/factors\/[^/]+\/challenge/.test(u), () => ({ body: { id: 'challenge-1', type: 'totp', expires_at: 9999999999 } })],
    [(u, r) => /\/auth\/v1\/factors\/[^/]+\/verify/.test(u), (u, r) => {
      sent.push({ url: u, body: r.postDataJSON() })
      return { status: 422, body: { code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' } }
    }],
    [(u, r) => /\/auth\/v1\/factors$/.test(u.split('?')[0]) && r.method() === 'POST', () => ({ body: {
      id: 'factor-new', type: 'totp', friendly_name: 'Raptor', totp: { qr_code: QR, secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x' } } })],
    [(u) => /\/auth\/v1\/user/.test(u), () => ({ body: { id: who.id, email: who.email, factors: opts.factors ?? [] } })],
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [who] })],
    ...extra,
  ]
  const { context, page } = await signedInPage(browser, who, handlers, [], opts)
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.waitForTimeout(2500)
  return { context, page, sent }
}

const VERIFIED = [{ id: 'factor-1', friendly_name: 'Raptor', factor_type: 'totp', status: 'verified', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()

  /* An Administrator with an authenticator, not yet confirmed: the code box, not the app. */
  {
    const { context, page, sent } = await open(browser, ADMIN, { aal: 'aal1', factors: VERIFIED })
    t.ok('an unconfirmed Administrator is asked for the code', await page.getByTestId('two-step').isVisible().catch(() => false))
    const text = await page.locator('body').innerText()
    t.ok('...and does not see the app behind it', !/the beginning/i.test(text))
    t.ok('...the code box takes the cursor', await page.evaluate(() => document.activeElement?.id === 'two-step-code'))
    await page.locator('#two-step-code').fill('12 34 56')
    t.check('...a pasted code with spaces is read as six digits', await page.locator('#two-step-code').inputValue(), '123456')
    await page.getByRole('button', { name: 'Confirm' }).click()
    await page.getByRole('alert').waitFor({ timeout: 5000 }).catch(() => {})
    t.ok('...the code goes to Supabase to be checked', sent.length === 1 && sent[0].body?.code === '123456')
    t.ok('...and a wrong one is said plainly', /did not match/.test(await page.getByRole('alert').innerText().catch(() => '')))
    await t.shot(page, 'two-step-code')
    await context.close()
  }

  /* An Administrator with none: set it up now. */
  {
    const { context, page } = await open(browser, ADMIN, { aal: 'aal1', factors: [] })
    await page.getByTestId('two-step-qr').locator('img').waitFor({ timeout: 8000 }).catch(() => {})
    t.ok('an Administrator with no authenticator is shown the QR code to set one up',
      await page.getByTestId('two-step-qr').locator('img').evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false))
    t.ok('...and the key to type if the camera will not scan', /JBSWY3DPEHPK3PXP/.test(await page.getByTestId('two-step').innerText()))
    t.ok('...with no way past it but signing out', !(await page.locator('body').innerText()).match(/the beginning/i))
    await t.shot(page, 'two-step-enrol')
    await context.close()
  }

  /* Confirmed: straight through. */
  {
    const { context, page } = await open(browser, ADMIN, { aal: 'aal2', factors: VERIFIED })
    t.ok('a confirmed Administrator goes straight to the app', !(await page.getByTestId('two-step').isVisible().catch(() => false))
      && /the beginning/i.test(await page.locator('body').innerText()))
    await context.close()
  }

  /* Not an Administrator: never asked. */
  {
    const { context, page } = await open(browser, AGENT, { aal: 'aal1', factors: [] })
    t.ok('anybody who is not an Administrator is not asked', !(await page.getByTestId('two-step').isVisible().catch(() => false))
      && /the beginning/i.test(await page.locator('body').innerText()))
    await context.close()
  }
} finally {
  if (browser) await browser.close()
  stopServer(server)
}

process.exit(t.finish() ? 0 : 1)
