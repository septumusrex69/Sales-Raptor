/**
 * RAPTOR · HANDOVER 16 -- RYNO'S LETTER OF DEMAND BUILDER, INSIDE RAPTOR, IN A REAL BROWSER.
 *
 * "+ New letter" on the Clients page; the client found as you type; the debtor found by a reference; the
 * letter filled in from the account (the debtor's name, our case number as the payment reference, one line,
 * today's balance); every field editable and the WORDING editable; a real PDF downloaded, with the copy kept
 * on the account; and sending it from a chosen mailbox, recorded on the account as every email to a debtor is.
 * Every request is a fixture: no database, no mailbox, nothing sent.
 *
 * Run: RAPTOR_E2E_PORT=5454 node scripts/qa/e2e/letter-of-demand.mjs
 */
process.env.RAPTOR_E2E_PORT ??= '5454'
const { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } = await import('./harness.mjs')
const F = await import('./fixtures.mjs')
const { PDFDocument, PDFName } = await import('pdf-lib')

const t = makeRunner('letter-of-demand')
const ADMIN = { ...F.PROFILE, role: 'Administrator', grants: [], revokes: [] }
const CLIENT = { ...F.COMPANY, name: 'Truevisions Enterprises (Pty) Ltd', code: 'TRV', is_client: true, client_code: 'TRV' }
const OTHER = { ...F.COMPANY, id: '99999999-0000-4000-8000-000000000001', name: 'Northbank Properties', code: 'NBP', client_code: 'NBP' }
const ACCOUNT = {
  ...F.accountsPage(1)[0], id: 'acc-esmar', company_id: CLIENT.id, companies: { name: CLIENT.name }, case_number: 'TRV00412',
  account_number: 'INVO000798', client_reference: '2608/1619', debtor_first_name: 'Esmar Transport and Consulting (Pty) Ltd', debtor_surname: '',
  debtor_kind: 'company', capital_handed_over: 106000, capital_outstanding: 106000, handover_date: '2026-08-11', interest_rate_annual: 0, status: 'Active: Unfrozen',
}

function world() {
  const log = { uploads: [], documents: [], emails: [], notes: [], searches: [] }
  const handlers = [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rest\/v1\/companies/.test(u), (u) => ({ body: /id=eq\./.test(u) ? CLIENT : [CLIENT, OTHER] })],
    [(u) => /\/rest\/v1\/debtor_accounts/.test(u), (u) => {
      if (/id=eq\.acc-esmar/.test(u)) return { body: ACCOUNT }
      log.searches.push(decodeURIComponent(u))
      return { body: /412|esmar/i.test(decodeURIComponent(u)) ? [ACCOUNT] : [] }
    }],
    [(u) => /\/rest\/v1\/account_contacts/.test(u), () => ({ body: [{ kind: 'email', value: 'Accounts@Esmar.example', is_primary: true, retired_at: null, created_at: '2026-08-11T08:00:00Z' }] })],
    [(u) => /\/rest\/v1\/(account_payments|account_fees|account_interest_accruals)/.test(u), () => ({ body: [] })],
    [(u) => /\/storage\/v1\/object\//.test(u), (u, req) => { log.uploads.push([u, req.method()]); return { body: { Key: 'account-documents/x.pdf' } } }],
    [(u) => /\/rest\/v1\/account_documents/.test(u), (u, req) => {
      if (req.method() === 'POST') { const b = JSON.parse(req.postData() ?? '{}'); log.documents.push(b); return { body: { id: 'doc1', ...b, created_at: '2026-11-03T08:00:00Z' } } }
      return { body: [] }
    }],
    [(u) => /\/rest\/v1\/account_emails/.test(u), (u, req) => { if (req.method() === 'POST') log.emails.push(JSON.parse(req.postData() ?? '{}')); return { body: [] } }],
    [(u) => /\/rest\/v1\/account_notes/.test(u), (u, req) => { if (req.method() === 'POST') log.notes.push(JSON.parse(req.postData() ?? '{}')); return { body: [{ id: 'n1' }] } }],
  ]
  return { log, handlers }
}

async function open(page, path) {
  for (let i = 0; i < 60; i += 1) { try { await page.goto(`http://localhost:${PORT}${path}`, { timeout: 2000 }); return } catch { await new Promise((r) => setTimeout(r, 500)) } }
}

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { log, handlers } = world()
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
  const asked = []
  await page.route('**/api/email/letter', async (r) => {
    const b = JSON.parse(r.request().postData() ?? '{}')
    asked.push(b)
    if (b.step === 'senders') return r.fulfill({ json: { senders: [
      { from: 'me', label: 'My mailbox', address: 'test.leader@bredellferreira.co.za', ready: true, why: null },
      { from: 'central', label: 'The firm’s mailbox (Legal)', address: 'legal@bredellferreira.co.za', ready: true, why: null },
    ] } })
    return r.fulfill({ json: { ok: true, messageId: '<m1@bf>', from: 'legal@bredellferreira.co.za' } })
  })
  page.on('pageerror', (e) => t.ok(`no page error (${e.message})`, false))

  /* 1. The button on the Clients page */
  await open(page, '/companies')
  await page.getByTestId('clients-new-letter').waitFor({ timeout: 20000 })
  t.ok('the Clients page has "+ New letter"', /New letter/.test(await page.getByTestId('clients-new-letter').innerText()))
  await page.getByTestId('clients-new-letter').click()
  await page.getByTestId('lod-page').waitFor({ timeout: 15000 })
  await page.locator('[data-testid="lod-preview"] #sheet').waitFor({ timeout: 10000 })
  t.ok('it opens the builder with both sheets', await page.locator('[data-testid="lod-preview"] #ack').count() === 1)
  t.ok('...an empty letter shows what is missing in [brackets]', /\[Debtor\]/.test(await page.locator('[data-testid="lod-preview"] #sheet').innerText()))

  /* 2. The client, as you type */
  await page.getByTestId('lod-client-search').fill('true')
  await page.getByTestId('lod-client-hits').waitFor({ timeout: 5000 })
  t.ok('typing finds the client, like a search', /Truevisions/.test(await page.getByTestId('lod-client-hits').innerText()) && !/Northbank/.test(await page.getByTestId('lod-client-hits').innerText()))
  await page.getByTestId('lod-client-hits').getByText('Truevisions Enterprises (Pty) Ltd').click()
  t.check('...and fills in the client', await page.getByTestId('lod-client').inputValue(), 'Truevisions Enterprises (Pty) Ltd')

  /* 3. The debtor, by our reference */
  await page.getByTestId('lod-debtor-search').fill('TRV00412')
  await page.getByTestId('lod-debtor-hits').waitFor({ timeout: 5000 })
  t.ok('the debtor search is the book\'s own, within that client', log.searches.some((u) => /company_id=eq\./.test(u) && /TRV00412/.test(u)))
  await page.getByTestId('lod-debtor-hits').getByText('Esmar Transport and Consulting (Pty) Ltd').click()
  await page.getByTestId('lod-balance-note').waitFor({ timeout: 10000 })
  t.check('the account fills the debtor', await page.getByTestId('lod-debtor').inputValue(), 'Esmar Transport and Consulting (Pty) Ltd')
  t.check('...our case number is the payment reference', await page.getByTestId('lod-ref').inputValue(), 'TRV00412')
  t.check('...one line: the account number and the amount handed over', JSON.stringify([await page.getByTestId('lod-inv-0').inputValue(), await page.getByTestId('lod-amt-0').inputValue()]), JSON.stringify(['INVO000798', 'R106,000.00']))
  t.check('...the debtor\'s email', await page.getByTestId('lod-email').inputValue(), 'accounts@esmar.example')
  t.ok('...and says where the amount came from, and to check it', /today’s balance on TRV00412: R106,000\.00/.test(await page.getByTestId('lod-balance-note').innerText()))
  const sheetText = async () => page.locator('[data-testid="lod-preview"] #sheet').innerText()
  t.ok('the letter shows it all', /Esmar Transport/.test(await sheetText()) && /R106,000\.00/.test(await sheetText()) && /TRV00412/.test(await sheetText()))

  /* 4. Edited by hand: a field, a second line, and the wording */
  await page.getByTestId('lod-stmt').fill('27 October 2026')
  await page.getByTestId('lod-add-line').click()
  await page.getByTestId('lod-inv-1').fill('INVO000801')
  await page.getByTestId('lod-amt-1').fill('2500')
  await page.getByTestId('lod-amt-1').blur()
  t.check('a second invoice adds up', await page.getByTestId('lod-total').innerText(), 'R108,500.00')
  t.ok('...and the letter demands the new total', /R108,500\.00/.test(await sheetText()))
  await page.getByTestId('lod-edit-wording').click()
  const para = page.locator('[data-testid="lod-preview"] [data-p="p5"]')
  t.check('"Edit the wording" makes the paragraphs editable', await para.getAttribute('contenteditable'), 'true')
  await para.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Our client values your business.')
  t.ok('...typed words are on the letter', /Our client values your business\./.test(await sheetText()))
  await page.getByTestId('lod-amt-1').fill('3500')
  t.ok('...and a figure inside a reworded paragraph still follows the form', /R109,500\.00 within/.test(await sheetText()))
  await page.getByTestId('lod-edit-wording').click()
  await t.shot(page, 'lod-filled')
  await page.setViewportSize({ width: 820, height: 1180 })
  await t.shot(page, 'lod-ipad')
  await page.setViewportSize({ width: 1440, height: 1000 })

  /* 5. The PDF, and the copy on the account */
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByTestId('lod-pdf').click()])
  t.ok('Letter PDF downloads, named for the debtor and the date', /^Letter of Demand - Esmar Transport and Consulting \(Pty\) Ltd - \d+ \w+ \d{4}\.pdf$/.test(download.suggestedFilename()))
  const bytes = await (async () => { const s = await download.createReadStream(); const parts = []; for await (const c of s) parts.push(c); return Buffer.concat(parts) })()
  ;(await import('node:fs')).writeFileSync('.qa-screenshots/lod-letter.pdf', bytes)
  const pdf = await PDFDocument.load(bytes)
  t.ok('...a real PDF, A4', pdf.getPageCount() >= 1 && Math.round(pdf.getPage(0).getWidth()) === 595)
  const faces = pdf.context.enumerateIndirectObjects().map(([, o]) => o?.get?.(PDFName.of('BaseFont'))?.toString?.() ?? '').filter(Boolean).join(' ')
  t.ok('...carrying the letter\'s own fonts', /NotoSerif/.test(faces) && /Inter/.test(faces))
  for (let i = 0; i < 40 && !log.documents.length; i += 1) await page.waitForTimeout(100)
  t.check('...and a copy is kept on the account, as a Letter of Demand', JSON.stringify([log.documents[0]?.account_id, log.documents[0]?.kind]), JSON.stringify(['acc-esmar', 'Letter of Demand']))
  t.ok('...said on the screen', /A copy is on the account/.test(await page.getByTestId('lod-status').innerText()))
  await page.getByTestId('lod-pdf').click()
  await page.waitForTimeout(1500)
  t.check('a second download of the same letter is not a second copy', log.documents.length, 1)

  /* 6. Sending it, from a chosen mailbox */
  await page.getByTestId('lod-send').click()
  await page.getByTestId('lod-send-modal').waitFor({ timeout: 5000 })
  await page.getByTestId('lod-from-central').waitFor({ timeout: 5000 })
  t.check('it goes to the debtor\'s email', await page.getByTestId('lod-send-to').inputValue(), 'accounts@esmar.example')
  t.ok('...and says it is filed and charged as every email to a debtor', /charged R25 under item 1\(a\)/.test(await page.getByTestId('lod-send-note').innerText()))
  await page.getByTestId('lod-from-central').check()
  await t.shot(page, 'lod-send')
  await page.getByTestId('lod-send-confirm').click()
  for (let i = 0; i < 80 && !log.emails.length; i += 1) await page.waitForTimeout(100)
  const sent = asked.find((b) => b.step === 'send')
  t.check('it is sent from the mailbox chosen, about this account', JSON.stringify([sent?.from, sent?.accountId, sent?.to]), JSON.stringify(['central', 'acc-esmar', 'accounts@esmar.example']))
  t.check('...with the letter and the acknowledgement attached', JSON.stringify((sent?.attachments ?? []).map((a) => a.filename.split(' - ')[0])), JSON.stringify(['Letter of Demand', 'Acknowledgement of Receipt']))
  t.check('...and recorded on the account as an email to the debtor', JSON.stringify([log.emails[0]?.account_id, log.emails[0]?.our_address, log.emails[0]?.direction]), JSON.stringify(['acc-esmar', 'legal@bredellferreira.co.za', 'out']))
  for (let i = 0; i < 40 && log.documents.length < 2; i += 1) await page.waitForTimeout(100)
  t.ok('...the acknowledgement kept on the account too', log.documents.some((d) => /^Acknowledgement of Receipt/.test(d.name)))
  await context.close()
} finally {
  if (browser) await browser.close()
  stopServer(server)
}
process.exit(t.finish('New letter on the Clients page: client and debtor found, the letter filled in and edited, the PDF, the copy on the account, and sending it.') ? 0 : 1)
