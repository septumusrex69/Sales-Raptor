/**
 * AN ADMINISTRATOR ON A NEW DEVICE TYPES AN EMAILED CODE BEFORE ANYTHING DRAWS (S10, 21 Oct).
 *
 * The rule checks (check-login-code) read the gate's source; they cannot say what an
 * Administrator on an unknown iPad actually sees, nor that a collector sees nothing different.
 * Asked here of the running app, with the database and the code route answered by the test:
 *   1. unknown device, Administrator: the code screen and nothing of the app; a code is sent by
 *      itself; a wrong code says so; the right one opens the app, on the same device id;
 *   2. unknown device, a collector: straight in, and no code is ever asked for;
 *   3. Settings: the Administrator's own trusted devices on Profile, the device button only on
 *      an Administrator's row in Users, and "Let in without a code" only for somebody else.
 *
 * Run: node scripts/qa/e2e/device-code.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('device-code')
const ADMIN = { ...PROFILE, role: 'Administrator', name: 'Stephan', email: 'stephan@raptor.test' }
const CAMILLE = { ...PROFILE, id: 'u-camille', role: 'Administrator', name: 'Camille', email: 'camille@raptor.test' }
const AGENT = { ...PROFILE, id: 'u-agent', role: 'Pre-legal Agent', name: 'A Collector', email: 'agent@raptor.test' }
const DEVICES = [{ id: 'd-1', device_hash: 'f'.repeat(64), label: 'Safari on iPad', created_at: '2026-10-20T08:00:00Z', last_seen_at: '2026-10-21T07:00:00Z' }]

async function open(browser, who, { trusted, people = [who] }) {
  const rpcs = []
  const { context, page } = await signedInPage(browser, who, [
    [(u) => /\/rest\/v1\/profiles.*id=eq\./.test(u), () => ({ body: [who] })],
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: people })],
    [(u) => /\/rest\/v1\/trusted_devices/.test(u), () => ({ body: DEVICES })],
    [(u) => /\/rpc\/trusted_device_seen/.test(u), () => ({ body: trusted })],
    [(u) => /\/rpc\/login_code_waive/.test(u), (u, req) => { rpcs.push(req.postDataJSON()); return { body: '2026-10-21T08:30:00Z' } }],
  ], [])
  const posted = []
  await page.route('**/api/email/login-code', async (route) => {
    const body = route.request().postDataJSON()
    posted.push(body)
    const reply = body.step === 'send' ? [200, { sent: true, to: 'st••••@raptor.test' }]
      : body.code === '123456' ? [200, { trusted: true }]
      : [400, { error: 'That code is not right. 4 tries left.' }]
    await route.fulfill({ status: reply[0], contentType: 'application/json', body: JSON.stringify(reply[1]) })
  })
  return { context, page, posted, rpcs }
}

async function go(page, path) {
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}${path}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
}

const server = await startServer()
let browser
try {
  browser = await chromium.launch()

  /* ---------- 1. an Administrator on an unknown device ---------- */
  {
    const { context, page, posted } = await open(browser, ADMIN, { trusted: false })
    await go(page, '/settings?tab=Profile')
    const form = page.getByTestId('device-code')
    await form.waitFor({ timeout: 20000 })
    await page.getByText(/We emailed a code to st••••@raptor\.test/).waitFor({ timeout: 10000 })
    t.ok('the code screen is all there is', (await page.getByRole('button', { name: 'Save Changes' }).count()) === 0)
    t.check('a code was sent by itself, once', posted.filter((p) => p.step === 'send').length, 1)
    t.ok('...naming this browser by a 64-hex device id', /^[0-9a-f]{64}$/.test(posted[0]?.deviceId ?? ''))
    t.ok('...and the screen says what to do if it never comes', /ask another Administrator to let you in from Settings → Users/.test(await form.innerText()))
    await t.shot(page, 'device-code')

    await page.getByLabel('Six-digit code').fill('111111')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('alert').waitFor({ timeout: 10000 })
    t.ok('a wrong code says so, and how many tries are left', /not right\. 4 tries left/.test(await page.getByRole('alert').innerText()))
    t.ok('...and the app is still not there', (await page.getByRole('button', { name: 'Save Changes' }).count()) === 0)

    await page.getByLabel('Six-digit code').fill('123 456')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Save Changes' }).waitFor({ timeout: 20000 })
    const checks = posted.filter((p) => p.step === 'check')
    t.check('the right code is sent as six digits', checks[1]?.code, '123456')
    t.ok('...from the same device the code was sent for', checks[1]?.deviceId === posted[0]?.deviceId)
    t.ok('...and opens the app', await page.getByRole('button', { name: 'Save Changes' }).isVisible())

    /* ---------- 3a. their own devices, on Profile ---------- */
    const own = page.getByTestId('trusted-devices')
    await own.waitFor({ timeout: 10000 })
    t.ok('Profile lists the Administrator\'s trusted devices', /Safari on iPad/.test(await own.innerText()))
    t.ok('...with no way to waive their own code', !/Let in without a code/.test(await own.innerText()))
    await context.close()
  }

  /* ---------- 2. a collector on an unknown device ---------- */
  {
    const { context, page, posted } = await open(browser, AGENT, { trusted: false })
    await go(page, '/settings?tab=Profile')
    await page.getByRole('button', { name: 'Save Changes' }).waitFor({ timeout: 20000 })
    t.ok('a collector goes straight in', await page.getByRole('button', { name: 'Save Changes' }).isVisible())
    t.check('...and is never sent a code', posted.length, 0)
    t.check('...nor shown the trusted devices', await page.getByTestId('trusted-devices').count(), 0)
    await context.close()
  }

  /* ---------- 3b. Settings -> Users, on a known device ---------- */
  {
    const { context, page, posted, rpcs } = await open(browser, ADMIN, { trusted: true, people: [ADMIN, CAMILLE, AGENT] })
    await go(page, '/settings?tab=Users')
    await page.getByRole('button', { name: 'Add User' }).waitFor({ timeout: 20000 })
    t.check('a known device is never sent a code', posted.length, 0)
    t.check('the devices button is on each Administrator\'s row', await page.getByRole('button', { name: /Camille's trusted devices|Stephan's trusted devices/ }).count(), 2)
    t.check('...and not on a collector\'s', await page.getByRole('button', { name: "A Collector's trusted devices" }).count(), 0)
    await page.getByRole('button', { name: "Camille's trusted devices" }).click()
    const list = page.getByTestId('trusted-devices')
    await list.getByText('Safari on iPad').waitFor({ timeout: 10000 })
    await list.getByRole('button', { name: /Let in without a code/ }).click()
    await list.getByRole('status').waitFor({ timeout: 10000 })
    t.check('another Administrator can let Camille in once', JSON.stringify(rpcs[0]), JSON.stringify({ p_user_id: CAMILLE.id }))
    t.ok('...and is told what to tell her', /Camille can sign in once without a code in the next 30 minutes/.test(await list.innerText()))
    await t.shot(page, 'device-code-users')
    await context.close()
  }
} finally {
  await browser?.close()
  await stopServer(server)
}
const good = t.finish('An Administrator on a new device types an emailed code; nobody else is asked; Settings shows and clears the devices.')
process.exit(good ? 0 : 1)
