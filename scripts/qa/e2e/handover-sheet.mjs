/**
 * THE HANDOVER SHEET, HANDED OUT THREE WAYS, in a real browser.
 *
 * The firm, 23 Oct: "Give me a copy of the handover template ... That should go out on the welcome
 * letter as well. And it should go out with the mandate as well ... Make it possible so that we can
 * download from the where we say import handover ... Export the new handover sheet or export the
 * old handover sheet."
 *
 * What only a browser can show: that the two downloads are ON the screen "Upload a batch" lands
 * on and each produces a file with the right name (and a real .xlsx in it -- CompressionStream is a
 * browser API, and the check drives it in Node); that the mandate's composer carries the sheet
 * beside the agreement and the send request has it; and that the welcome shows the sheet, lets it
 * be taken off, and posts it to the welcome route. The sheet's insides are held by
 * check-handover-template.
 *
 * Run: RAPTOR_E2E_PORT=5641 node scripts/qa/e2e/handover-sheet.mjs
 */
import { readFileSync } from 'node:fs'
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, COMPANY_ID, LEAD, LEAD_ID, PROFILE, TEAM, USER_ID } from './fixtures.mjs'

const t = makeRunner('handover-sheet')
const ADMIN = { ...PROFILE, role: 'Administrator', name: 'Stephan' }
const NEW_NAME = 'Bredell Ferreira handover sheet.xlsx'
const OLD_NAME = 'Bredell Ferreira handover sheet (old format).xlsx'

async function open(page, path) {
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}${path}`, { timeout: 2000 }); return }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
}

/** A download's name, and whether what arrived is a zip (an .xlsx starts PK\x03\x04). */
async function take(page, testId) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByTestId(testId).click()])
  const path = await download.path()
  const head = path ? readFileSync(path).subarray(0, 4) : Buffer.alloc(0)
  return { name: download.suggestedFilename(), zip: head.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), size: path ? readFileSync(path).length : 0 }
}

const CLIENT = {
  id: COMPANY_ID, name: 'Northbank Properties', code: 'NBP', status: 'Won', owner_id: PROFILE.id,
  account_owner_id: PROFILE.id, mandate_signed_at: '2026-02-01', commission_rate: 0.25,
  created_at: '2026-01-01T00:00:00Z',
}

let browser
const server = startServer()
try {
  browser = await chromium.launch()

  /* ---------------------------------------------------------------- 1. where the import is */
  {
    const { page } = await signedInPage(browser, ADMIN, [
      [(u) => /\/rest\/v1\/companies/.test(u) && /account_owner_id/.test(u), () => ({ body: CLIENT })],
      [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [CLIENT] })],
      [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
      [(u) => /\/rest\/v1\/teams/.test(u), () => ({ body: [TEAM] })],
    ], [])
    /* THROUGH THE CLIENT'S OWN BUTTON, wherever it lands: the firm's way in is "Upload a batch". */
    await open(page, `/companies/${COMPANY_ID}`)
    const upload = page.getByRole('button', { name: /Upload a batch/ })
    await upload.first().waitFor({ timeout: 20000 })
    await upload.first().click()
    const box = page.getByTestId('handover-sheet-download')
    await box.waitFor({ timeout: 20000 })
    t.ok('"Upload a batch" lands where the handover sheet can be downloaded', await box.isVisible())
    t.ok('...offering the new sheet as the one to send', /New handover sheet \(recommended\)/.test(await box.innerText()))
    t.ok('...and the old one beside it', /Old handover sheet/.test(await box.innerText()))
    const fresh = await take(page, 'handover-sheet-new')
    t.check('the new sheet downloads under the firm’s name', fresh.name, NEW_NAME)
    t.ok('...and is a real .xlsx, deflated small enough to email', fresh.zip && fresh.size > 5000 && fresh.size < 200 * 1024)
    const old = await take(page, 'handover-sheet-old')
    t.check('the old sheet downloads, named as the old format', old.name, OLD_NAME)
    t.ok('...and is a real .xlsx', old.zip)
    await box.scrollIntoViewIfNeeded()
    await t.shot(page, 'handover-sheet-download')
    await page.context().close()
  }

  /* ---------------------------------------------------------------- 2. with the mandate */
  {
    const sent = []
    const { page } = await signedInPage(browser, ADMIN, [
      [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: ADMIN.email } })],
      [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [ADMIN] })],
      [(u) => u.includes('/rest/v1/companies'), () => ({ body: [{ ...COMPANY, id: COMPANY_ID }] })],
      [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
      [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
      [(u) => u.includes('/rest/v1/leads'), () => ({ body: [{ ...LEAD, status: 'Interested', party: 'company' }] })],
      [(u, req) => u.includes('/rest/v1/signing_requests') && req.method() !== 'GET', () => ({ status: 201, body: [] })],
    ], [])
    await page.route('**/api/email/send*', async (route) => {
      sent.push(route.request().postDataJSON())
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, messageId: 'm1', from: ADMIN.email }) })
    })
    await open(page, `/leads/${LEAD_ID}`)
    await page.getByText('Vaal Fire Services').first().waitFor({ timeout: 20000 })
    await page.getByRole('button', { name: /Send mandate/ }).first().click()
    await page.getByRole('button', { name: /Prepare the email/ }).click()
    /* Wait on the AGREEMENT, not the sheet: waiting on the thing under test turns its absence into
       a timeout instead of a failed line saying what is missing. */
    await page.getByText(/Debt-collection-agreement-Vaal-Fire-Services\.pdf/).first().waitFor({ timeout: 30000 })
    const modal = await page.locator('body').innerText()
    t.ok('the mandate’s email carries the agreement', /Debt-collection-agreement-Vaal-Fire-Services\.pdf/.test(modal))
    t.ok('...and the handover sheet beside it, by name, before Send', modal.includes(NEW_NAME))
    t.ok('...and says so in the message', /Also attached is our handover sheet/.test(await page.locator('textarea').first().inputValue()))
    await t.shot(page, 'handover-sheet-mandate')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    for (let i = 0; i < 40 && !sent.length; i += 1) await new Promise((r) => setTimeout(r, 250))
    const files = (sent[0]?.attachments ?? []).map((a) => a.filename)
    t.ok('the send request goes', sent.length === 1)
    t.ok('...with the agreement and the handover sheet', files.includes(NEW_NAME) && files.some((f) => /\.pdf$/.test(f)))
    const sheet = (sent[0]?.attachments ?? []).find((a) => a.filename === NEW_NAME)
    t.ok('...the sheet as a spreadsheet, in base64', sheet?.contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      && Buffer.from(sheet?.content ?? '', 'base64').subarray(0, 2).toString('latin1') === 'PK')
    await page.context().close()
  }

  /* ---------------------------------------------------------------- 3. with the welcome */
  {
    const posted = []
    const BONITA = { ...PROFILE, id: 'u-bonita', name: 'Bonita Mahlangu', email: 'b@x.co.za', role: 'Liaison Manager' }
    const NEWCLIENT = { id: COMPANY_ID, name: 'Abc Cricket', account_owner_id: ADMIN.id, created_at: '2026-10-11T07:00:00Z',
      commission_rate: 0.25, mandate_signed_at: '2026-10-11T08:00:00Z', liaison_needed: true }
    const { page } = await signedInPage(browser, ADMIN, [
      [(u) => /\/rest\/v1\/profiles.*id=eq\./.test(u), () => ({ body: [ADMIN] })],
      [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN, BONITA] })],
      [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [NEWCLIENT] })],
    ], [], { now: '2026-10-18T10:00:00+02:00' })
    await page.route('**/api/email/welcome', async (route) => {
      posted.push(route.request().postDataJSON())
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assigned: true, sent: true, fromLiaison: true }) })
    })
    await open(page, `/companies/${COMPANY_ID}`)
    const card = page.getByTestId('welcome-card')
    await card.waitFor({ timeout: 20000 })
    const chip = page.getByTestId('welcome-attachment')
    t.ok('the welcome says the handover sheet goes with it, by name', (await chip.innerText()).includes(NEW_NAME))
    const remove = chip.getByRole('button', { name: `Remove ${NEW_NAME}` })
    if (await remove.count()) await remove.click()
    t.ok('...it can be taken off for this send', /No handover sheet with this welcome/.test(await chip.innerText()))
    const back = chip.getByRole('button', { name: 'Attach it again' })
    if (await back.count()) await back.click()
    t.ok('...and put back', (await chip.innerText()).includes(NEW_NAME))
    await card.locator('select').selectOption('u-bonita')
    await page.getByTestId('welcome-assign').click()
    await card.getByRole('status').waitFor({ timeout: 15000 })
    const att = posted[0]?.attachments ?? []
    t.check('the welcome route is asked for this client and liaison', JSON.stringify([posted[0]?.companyId, posted[0]?.liaisonId]), JSON.stringify([COMPANY_ID, 'u-bonita']))
    t.check('...with the handover sheet attached', JSON.stringify(att.map((a) => a.filename)), JSON.stringify([NEW_NAME]))
    t.ok('...as a real .xlsx', Buffer.from(att[0]?.content ?? '', 'base64').subarray(0, 2).toString('latin1') === 'PK')
    await page.context().close()
  }
} finally {
  await browser?.close()
  await stopServer(server)
}
const good = t.finish('The handover sheet downloads (new and old) where a batch is uploaded, and goes out with the mandate and the welcome.')
process.exit(good ? 0 : 1)
