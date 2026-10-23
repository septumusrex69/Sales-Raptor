/**
 * ADD LEAD IN THE FIRM'S ORDER, AND CONVERT ON THE RATE THAT WAS QUOTED (23 Oct), in a real browser.
 *
 * Stephan: "the first thing it should ask is it a company or an individual? And then what is the
 * client name and who is the contact persons?" -- and of Convert to Client: the handover figures are
 * "actual data ... seen when we hand over in the first 3 months", and "the commission percentage ...
 * should go as default in about what it was sent out originally ... We should basically just confirm
 * it."
 *
 * What only a browser shows: that nothing but the question is on the screen until it is answered,
 * that the client name and the contact person are drawn in that order beneath it, that a second
 * contact person is saved as a contact ON THE LEAD (after the lead, not beside it), and that the
 * conversion opens with the quoted rate already in the box and no handover figures asked for.
 *
 * Run: RAPTOR_E2E_PORT=5461 node scripts/qa/e2e/lead-form-order.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, COMPANY_ID, LEAD, LEAD_ID, PROFILE, TEAM, USER_ID } from './fixtures.mjs'

const t = makeRunner('lead-form-order')
const ADMIN = { ...PROFILE, role: 'Administrator' }
const LIAISON = { ...PROFILE, id: '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a', name: 'Lindi Liaison', email: 'lindi@raptor.test', role: 'Liaison' }
const NEW_LEAD_ID = '5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e'
const writes = []

const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: ADMIN.email } })],
  /* Every write is recorded, FIRST, so no read handler below answers one; the lead insert and an
     update answer as PostgREST's .single() does. */
  [(u, req) => req.method() !== 'GET' && u.includes('/rest/v1/') && !u.includes('/rpc/'), (u, req) => {
    const table = u.replace(/^.*\/rest\/v1\//, '').replace(/\?.*$/, '')
    writes.push({ table, method: req.method(), body: req.postDataJSON(), at: writes.length })
    if (table === 'leads' && req.method() === 'POST') return { status: 201, body: { id: NEW_LEAD_ID, lead_number: 42 } }
    if (req.method() === 'PATCH') return { status: 200, body: { id: 'x' } }
    return { status: 201, body: [] }
  }],
  /* The signed-in profile is read by id; the people list (where the liaison comes from) is not. */
  [(u) => u.includes('/rest/v1/profiles') && u.includes(`id=eq.${USER_ID}`), () => ({ body: [ADMIN] })],
  [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [ADMIN, LIAISON] })],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [{ ...COMPANY, id: COMPANY_ID, account_count: 21 }] })],
  /* THE CLIENT'S HANDOVERS BY DAY: 12 then 5 inside its first three months, 4 after them. */
  [(u) => u.includes('/rpc/client_intake_by_day'), () => ({
    body: [
      { day: '2026-01-31', accounts: 12, capital: 400000 },
      { day: '2026-04-29', accounts: 5, capital: 50000 },
      { day: '2026-04-30', accounts: 4, capital: 99999 },
    ],
  })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  [(u) => u.includes('/rest/v1/leads'), () => ({
    body: [{
      ...LEAD, status: 'Interested', party: 'company',
      services: ['Debt Collection'], estimated_handover_amount: 850000, estimated_accounts_count: 120,
    }],
  })],
  /* THE MANDATE THAT WENT OUT: an older 30% offer, then the 27.5% that stood, then a withdrawn 20%. */
  [(u) => u.includes('/rest/v1/signing_requests'), () => ({
    body: [
      { created_at: '2026-10-01T09:00:00Z', state: 'sent', mandate: { party: 'company', clientName: 'Vaal Fire Services', commission: { kind: 'rate', rate: 0.3 } } },
      { created_at: '2026-10-10T09:00:00Z', state: 'sent', mandate: { party: 'company', clientName: 'Vaal Fire Services', commission: { kind: 'rate', rate: 0.275 } } },
      { created_at: '2026-10-12T09:00:00Z', state: 'cancelled', mandate: { party: 'company', clientName: 'Vaal Fire Services', commission: { kind: 'rate', rate: 0.2 } } },
    ],
  })],
]

/** Top of an element on the page, or NaN where it is not drawn -- so an order check cannot pass on a missing field. */
const topOf = async (loc) => ((await loc.count()) ? (await loc.first().boundingBox())?.y ?? NaN : NaN)

let browser
const server = startServer()
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, ADMIN, handlers, [])
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/leads`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByRole('button', { name: /^Add/ }).first().waitFor({ timeout: 20000 })

  /* ---------- Add Lead: the question first, and nothing else until it is answered ---------- */
  await page.getByRole('button', { name: /^Add/ }).first().click()
  await page.getByRole('button', { name: 'Add Lead' }).first().click()
  const box = page.locator('[data-modal-open]')
  await box.getByTestId('lead-party').waitFor({ timeout: 10000 })
  t.ok('the form opens on "company or individual?"', await box.getByText('Is the client a company or an individual?').isVisible())
  t.check('...with neither chosen', await box.getByRole('radio', { checked: true }).count(), 0)
  t.check('...and no client name asked for yet', await box.getByLabel(/^Client name/).count(), 0)
  t.check('...nor a first name', await box.getByLabel(/^First Name/).count(), 0)
  await t.shot(page, 'lead-form-order-1-question')

  /* ---------- a company: client name, then contact person(s) ---------- */
  await box.getByTestId('lead-party-company').click()
  const partyTop = await topOf(box.getByTestId('lead-party'))
  const nameTop = await topOf(box.getByLabel(/^Client name/))
  const contactTop = await topOf(box.getByTestId('lead-contact-heading'))
  t.ok('a company: the client name is asked under the question', Number.isFinite(partyTop) && Number.isFinite(nameTop) && nameTop > partyTop)
  t.ok('...and the contact person under the client name', Number.isFinite(contactTop) && contactTop > nameTop)
  t.ok('...the person’s name inside the contact person', (await topOf(box.getByTestId('lead-contact-0').getByLabel(/^First Name/))) > contactTop)
  t.ok('...with their role asked', await box.getByTestId('lead-contact-0').getByLabel('Role', { exact: true }).isVisible())

  await box.getByLabel(/^Client name/).fill('Highveld Plumbing (Pty) Ltd')
  await box.getByTestId('lead-contact-0').getByLabel(/^First Name/).fill('Thandi')
  await box.getByTestId('lead-contact-0').getByLabel('Last Name', { exact: true }).fill('Mokoena')
  await box.getByTestId('lead-contact-0').getByLabel('Phone', { exact: true }).fill('011 555 0101')
  await box.getByTestId('lead-contact-0').getByLabel('Role', { exact: true }).fill('Financial manager')
  await box.getByTestId('lead-add-contact').click()
  t.check('another contact person can be added', await box.getByTestId('lead-contact-heading').innerText(), 'CONTACT PERSONS')
  await box.getByTestId('lead-contact-1').getByLabel(/^First Name/).fill('Pieter')
  await box.getByTestId('lead-contact-1').getByLabel('Last Name', { exact: true }).fill('Botha')
  await box.getByTestId('lead-contact-1').getByLabel('Email', { exact: true }).fill('pieter@highveld.example')
  await t.shot(page, 'lead-form-order-2-company')
  await box.getByRole('button', { name: 'Add Lead' }).click()
  await page.waitForTimeout(1200)

  const leadWrite = writes.find((w) => w.table === 'leads' && w.method === 'POST')
  t.check('the lead is saved under the client name', leadWrite?.body?.company_name, 'Highveld Plumbing (Pty) Ltd')
  t.check('...as a company', leadWrite?.body?.party, 'company')
  t.check('...the first contact person as the lead’s own name, as before', `${leadWrite?.body?.first_name} ${leadWrite?.body?.last_name}`, 'Thandi Mokoena')
  t.check('...with their role', leadWrite?.body?.job_title, 'Financial manager')
  const contactWrite = writes.find((w) => w.table === 'contacts' && w.method === 'POST')
  t.ok('the second contact person is a contact on the lead', !!leadWrite?.body?.id && contactWrite?.body?.lead_id === leadWrite.body.id)
  t.check('...by name', `${contactWrite?.body?.first_name} ${contactWrite?.body?.last_name}`, 'Pieter Botha')
  t.ok('...written after the lead, which it points at', !!leadWrite && !!contactWrite && contactWrite.at > leadWrite.at)

  /* ---------- an individual: the person IS the client ---------- */
  await page.goto(`http://localhost:${PORT}/leads`)
  await page.getByRole('button', { name: /^Add/ }).first().waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: /^Add/ }).first().click()
  await page.getByRole('button', { name: 'Add Lead' }).first().click()
  await box.getByTestId('lead-party-individual').click()
  t.ok('an individual: their name is the client name', await box.getByTestId('lead-individual-name').isVisible()
    && (await topOf(box.getByLabel(/^First Name/))) > (await topOf(box.getByTestId('lead-individual-name'))))
  t.check('...asked once, with no contact person beside it', await box.getByTestId('lead-add-contact').count(), 0)
  t.check('...and no company name box', await box.getByLabel(/^Client name/).count(), 0)
  await box.getByLabel(/^First Name/).fill('Johanna')
  await box.getByLabel('Last Name', { exact: true }).fill('van Wyk')
  await box.getByLabel('Email', { exact: true }).fill('johanna@example.co.za')
  await t.shot(page, 'lead-form-order-3-individual')
  const before = writes.length
  await box.getByRole('button', { name: 'Add Lead' }).click()
  await page.waitForTimeout(1200)
  const individual = writes.slice(before).find((w) => w.table === 'leads' && w.method === 'POST')
  t.check('...saved with the person’s full name as the client name', individual?.body?.company_name, 'Johanna van Wyk')
  t.check('...as an individual', individual?.body?.party, 'individual')

  /* ---------- Convert to Client: the quoted rate in the box, the handover not asked for ---------- */
  await page.goto(`http://localhost:${PORT}/leads/${LEAD_ID}`)
  await page.getByText('Vaal Fire Services').first().waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: 'Convert to Client' }).first().click()
  await box.getByTestId('convert-commission').waitFor({ timeout: 10000 })
  await page.waitForTimeout(600)
  t.check('the commission says what was quoted -- the offer that stood, not the withdrawn one',
    await box.getByTestId('convert-commission-label').innerText(), 'COMMISSION (AS QUOTED: 27.5%)')
  t.check('...and the rate is already in the box', await box.getByLabel('Commission rate').inputValue(), '27.5')
  t.check('the handover amount is not asked for', await box.getByLabel(/Handover Amount/).count(), 0)
  t.check('...nor the number of accounts', await box.getByLabel(/Number of Accounts/).count(), 0)
  const expected = await box.getByTestId('convert-expected').innerText()
  t.ok('the lead’s estimate is shown as the estimate it is', /Expected \(the lead.s estimate\): 120 accounts/.test(expected))
  t.ok('...with the real figures said to be the first three months', /first three months/.test(expected))
  t.ok('a liaison is still required', await box.getByTestId('convert-liaison').isVisible()
    && await box.getByRole('button', { name: 'Convert to Client' }).isDisabled())
  await box.getByTestId('convert-liaison').selectOption(LIAISON.id)
  t.ok('...and with her chosen, confirming is one press', await box.getByRole('button', { name: 'Convert to Client' }).isEnabled())
  await box.getByLabel('Commission rate').fill('25')
  t.check('the rate can still be changed', await box.getByLabel('Commission rate').inputValue(), '25')
  await t.shot(page, 'lead-form-order-4-convert')
  const atConvert = writes.length
  await box.getByRole('button', { name: 'Convert to Client' }).click()
  await page.waitForTimeout(1200)
  const terms = writes.slice(atConvert).find((w) => w.table.startsWith('companies') && w.method === 'PATCH' && w.body && 'commission_rate' in w.body)
  t.check('...and what is saved is what is in the box', terms?.body?.commission_rate, 0.25)

  /* ---------- the client record: what they ACTUALLY handed over at the start ---------- */
  await page.getByTestId('first-three-months').waitFor({ timeout: 15000 }).catch(() => {})
  const first = (await page.getByTestId('first-three-months').count())
    ? (await page.getByTestId('first-three-months').innerText()).replace(/\u00a0/g, ' ') : ''
  t.ok('the client record says what came in over the first three months', /First three months: 17 accounts, R ?450[ ,]000 handed over/.test(first))
  t.ok('...counted from the first account, the window closed', /from /.test(first) && !/still counting/.test(first))
  await t.shot(page, 'lead-form-order-5-client')
} finally {
  await browser?.close()
  await stopServer(server)
}
const good = t.finish('Add Lead asks company-or-individual first, then the client name, then the contact person(s); Convert opens on the quoted rate and asks for no handover figures.')
process.exit(good ? 0 : 1)
