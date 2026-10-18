/**
 * SENDING THE MANDATE FROM A LEAD, in a real browser (the firm, 18 Oct: "Have you built in the part
 * about sending the mandate and having the client sign via link?").
 *
 * What only a browser can show: that the button is ON the lead, that the terms chosen are the terms
 * frozen into the signing request, and that the email the closer reads carries the agreement as a
 * PDF with the Sign online button under it. What signing then does lives in the database
 * (mandate_on_signed) and is held by check-mandate.
 *
 * Run: node scripts/qa/e2e/send-mandate.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, COMPANY_ID, LEAD, LEAD_ID, PROFILE, TEAM, USER_ID } from './fixtures.mjs'

const t = makeRunner('send-mandate')
const ADMIN = { ...PROFILE, role: 'Administrator' }
const writes = []

const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: ADMIN.email } })],
  [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [ADMIN] })],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [{ ...COMPANY, id: COMPANY_ID }] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  [(u) => u.includes('/rest/v1/leads'), () => ({ body: [{ ...LEAD, status: 'Interested', party: 'individual' }] })],
  [(u, req) => u.includes('/rest/v1/signing_requests') && req.method() !== 'GET', (u, req) => {
    writes.push({ method: req.method(), body: req.postDataJSON() })
    return { status: 201, body: [] }
  }],
]

let browser
const server = startServer()
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, ADMIN, handlers, [])
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/leads/${LEAD_ID}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByText('Vaal Fire Services').first().waitFor({ timeout: 20000 })

  const button = page.getByRole('button', { name: /Send mandate/ })
  t.ok('the lead offers Send mandate', await button.first().isVisible())
  await button.first().click()
  await page.getByTestId('send-mandate').waitFor({ timeout: 10000 })
  /* FLAT FIRST, the scale the option; the party as the lead was added (the firm, 18 Oct). */
  t.check('...opening on a flat rate', await page.getByRole('radio', { name: 'Flat rate' }).getAttribute('aria-checked'), 'true')
  t.check('...as the individual the lead was added as', await page.getByRole('radio', { name: 'An individual' }).getAttribute('aria-checked'), 'true')
  await page.getByRole('radio', { name: 'Sliding scale' }).click()
  t.check('...the firm\'s standard sliding scale behind it', JSON.stringify(await page.getByTestId('mandate-scale').locator('input[aria-label$="rate"]').evaluateAll((xs) => xs.map((x) => x.value))), '["25","20","15","10"]')
  const scaleText = (await page.getByTestId('mandate-scale').innerText()).replace(/\u00a0/g, ' ')
  t.check('...amounts grouped in thousands', await page.getByLabel('Band 3 up to').inputValue(), '1 000 000')
  t.ok('...and every band says where it starts', /Up to/.test(scaleText) && /From R 100 000\.01 up to/.test(scaleText) && /Above R 1 000 000/.test(scaleText))
  await page.getByLabel('Band 3 up to').fill('2,000,000')
  t.check('...typed with commas, kept as the number, shown grouped', await page.getByLabel('Band 3 up to').inputValue(), '2 000 000')

  /* A flat rate this time, edited: the terms chosen must be the terms frozen. */
  await page.getByRole('radio', { name: 'Flat rate' }).click()
  await page.getByLabel('Commission rate').fill('30')
  await page.getByRole('button', { name: /Prepare the email/ }).click()

  const subject = page.locator('input[value^="Debt collection agreement"]')
  await subject.first().waitFor({ timeout: 20000 })
  t.check('the email opens on the agreement', await subject.first().inputValue(), 'Debt collection agreement - Vaal Fire Services')
  const modal = await page.locator('body').innerText()
  t.ok('...titled as what it is, not a reply', /Send the mandate/.test(modal) && !/Reply to/.test(modal))
  t.ok('...with the agreement attached as a PDF', /Debt-collection-agreement-Vaal-Fire-Services\.pdf/.test(modal))
  t.ok('...the commission said in the email', /Commission: 30% of the capital collected/.test(await page.locator('textarea').first().inputValue()))
  t.ok('...and the Sign online button under it', /Sign online button goes under your message/.test(modal))

  const insert = writes.find((w) => w.method === 'POST')?.body
  const update = writes.find((w) => w.method === 'PATCH')?.body
  t.ok('a signing request is made, titled for the agreement', insert?.title === 'Debt collection agreement')
  t.ok('...asking the client for their details and banking', Array.isArray(insert?.blanks) && insert.blanks.some((b) => b.key === 'mandate_bank_account'))
  t.check('...and the terms frozen on it are the ones chosen', JSON.stringify([update?.mandate?.party, update?.mandate?.commission]), JSON.stringify(['individual', { kind: 'rate', rate: 0.3 }]))
  t.check('...filed against the lead', update?.lead_id, LEAD_ID)
  t.check('...with the name and email filled in for the client', JSON.stringify(update?.filled), JSON.stringify({ mandate_client_name: 'Vaal Fire Services', mandate_email: LEAD.email }))
  await t.shot(page, 'send-mandate-email')
} finally {
  await browser?.close()
  await stopServer(server)
}
const good = t.finish('A lead sends the debt collection agreement: terms chosen, frozen on the signing request, PDF attached, Sign online button under the message.')
process.exit(good ? 0 : 1)
