/**
 * RYNO'S LETTER OF DEMAND BUILDER, IN RAPTOR -- IN A REAL BROWSER (S13 · Raptor · Handover 16, 3 Nov).
 *
 * Every request is a fixture: no database, no mailbox, no network. What it holds:
 *   1. "New letter" is on the Clients list and on a client's page, and the client's page opens it with the
 *      client filled in and linked;
 *   2. the client is found as you type; the debtor is found on that client's book and fills the letter --
 *      the debtor, the reference, the amount and one invoice line from the handover;
 *   3. everything stays editable: an invoice is changed and one added and the total follows; a paragraph
 *      clicked on the letter opens its wording, and the reworded words are on the letter;
 *   4. the PDF is a real PDF, read back here with pdf.js: the debtor, the amount, the reworded words;
 *      and a copy is filed on the client and the account;
 *   5. Send waits until nothing is missing, sends both PDFs from the chosen mailbox, records the email on
 *      the account, and a liaison is offered the firm's central mailbox where an agent is not;
 *   6. the reference box finds an account with no client chosen, and fills in the client too;
 *   7. typed by hand with nothing linked, it still downloads, and nothing is filed anywhere.
 *
 * Run: RAPTOR_E2E_PORT=5461 node scripts/qa/e2e/letter-demand.mjs
 */
process.env.RAPTOR_E2E_PORT ??= '5461'
const { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } = await import('./harness.mjs')
const { PROFILE } = await import('./fixtures.mjs')
const { readFileSync } = await import('node:fs')
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

const t = makeRunner('letter-demand')
const LIAISON = { ...PROFILE, role: 'Liaison', name: 'Nicole Loder', email: 'nicole@bredellferreira.co.za' }
const AGENT = { ...PROFILE, role: 'Sales Representative', name: 'Ryno Buitendag', email: 'ryno@bredellferreira.co.za' }
const CLIENT = { id: 'c0000000-0000-4000-8000-000000000001', name: 'Sample Client (Pty) Ltd', code: 'SCL', created_at: '2026-01-01T00:00:00Z', account_owner_id: PROFILE.id }
const OTHER = { id: 'c0000000-0000-4000-8000-000000000002', name: 'Northbank Properties', code: 'NBP', created_at: '2026-01-01T00:00:00Z', account_owner_id: PROFILE.id }
const ACCOUNT = {
  id: 'a0000000-0000-4000-8000-000000000001', company_id: CLIENT.id, account_number: 'SCL/00042', client_reference: 'INV-7781',
  debtor_first_name: null, debtor_surname: 'Karoo Haulage (Pty) Ltd', debtor_kind: 'company', capital_handed_over: '106000.00',
  account_balances: { balance: '112450.50' },
}

function world(profile) {
  const w = { docs: [], storage: [], emails: [], accountQueries: [] }
  w.handlers = [
    [(u) => /\/rest\/v1\/profiles.*id=eq\./.test(u), () => ({ body: [profile] })],
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [profile] })],
    [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [CLIENT, OTHER] })],
    [(u) => /\/rest\/v1\/debtor_accounts/.test(u), (u) => {
      w.accountQueries.push(decodeURIComponent(u))
      const d = decodeURIComponent(u)
      /* The reference box asks for exact matches; the debtor box searches by name on the client's book. */
      if (/account_number\.eq\.SCL\/00042|client_reference\.eq\.SCL\/00042/.test(d) || /id=eq\./.test(d)) return { body: /id=eq\./.test(d) ? ACCOUNT : [ACCOUNT] }
      if (/ilike\.%kar%/i.test(d) && d.includes(CLIENT.id)) return { body: [ACCOUNT] }
      return { body: [] }
    }],
    [(u) => /\/rest\/v1\/account_contacts/.test(u), () => ({ body: [{ value: 'accounts@karoo.example', is_primary: true }, { value: 'ceo@karoo.example', is_primary: false }] })],
    [(u, req) => req.method() === 'POST' && /\/rest\/v1\/(client_documents|account_documents)/.test(u), (u, req) => {
      const table = /client_documents/.test(u) ? 'client' : 'account'
      const body = req.postDataJSON()
      w.docs.push({ table, ...body })
      return { status: 201, body: { id: `d-${w.docs.length}`, ...body, created_at: '2026-11-03T08:00:00Z' } }
    }],
    [(u, req) => /\/storage\/v1\/object\//.test(u) && req.method() === 'POST', (u) => {
      w.storage.push(decodeURIComponent(u).replace(/^.*\/storage\/v1\/object\//, ''))
      return { body: { Key: 'x' } }
    }],
    [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  ]
  return w
}

async function route(page, w, { central = true } = {}) {
  await page.route('**/api/email/**', async (r) => {
    const url = new URL(r.request().url())
    const action = url.pathname.replace(/^.*\/api\/email\//, '')
    if (action === 'status') {
      const isCentral = url.searchParams.get('mailbox') === 'central'
      return r.fulfill({ json: isCentral ? (central ? { connected: true, email: 'legal@bredellferreira.co.za' } : { error: 'no' }) : { connected: true, email: 'me@bredellferreira.co.za' }, status: isCentral && !central ? 403 : 200 })
    }
    if (action === 'send') {
      w.emails.push(r.request().postDataJSON())
      return r.fulfill({ json: { ok: true, messageId: '<m1@raptor>', from: 'legal@bredellferreira.co.za', filedInSent: true } })
    }
    return r.fulfill({ json: {} })
  })
}
const open = async (page, path) => {
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}${path}`, { timeout: 2000 }); return } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
}
async function pdfText(path) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: false, isEvalSupported: false }).promise
  let text = ''
  for (let p = 1; p <= doc.numPages; p += 1) text += ` ${(await (await doc.getPage(p)).getTextContent()).items.map((i) => i.str).join(' ')}`
  return { pages: doc.numPages, text: text.replace(/\s+/g, ' ') }
}

const server = await startServer()
let browser
try {
  browser = await chromium.launch()

  /* ------------------------- 1-5: from the client's page, as a liaison ------------------------- */
  {
    const w = world(LIAISON)
    const { context, page } = await signedInPage(browser, LIAISON, w.handlers, [], { now: '2026-11-03T10:00:00+02:00' })
    await route(page, w)
    await open(page, '/companies')
    await page.getByTestId('clients-new-letter').waitFor({ timeout: 20000 })
    t.ok('"New letter" is on the Clients list', await page.getByTestId('clients-new-letter').isVisible())
    await open(page, `/companies/${CLIENT.id}`)
    await page.getByRole('button', { name: 'New letter' }).first().waitFor({ timeout: 20000 })
    await page.getByRole('button', { name: 'New letter' }).first().click()
    await page.getByTestId('lod-page').waitFor({ timeout: 20000 })
    t.check('...and the client\'s page opens it with the client filled in', await page.getByTestId('lod-client').inputValue(), CLIENT.name)
    t.ok('...and linked to their book', await page.getByTestId('lod-client-linked').isVisible())
    t.ok('the date is today\'s, the firm\'s day', /3 November 2026/.test(await page.getByTestId('lod-sheet').innerText()))
    await t.shot(page, 'letter-demand-1-blank')

    /* 2. The debtor, found on the book. */
    await page.getByTestId('lod-debtor').fill('Kar')
    await page.getByTestId('lod-debtor-option').first().waitFor({ timeout: 5000 })
    t.ok('the debtor search looks on this client\'s book only', w.accountQueries.some((q) => q.includes(`company_id=in.(${CLIENT.id})`)))
    await page.getByTestId('lod-debtor-option').first().click()
    const sheet = () => page.getByTestId('lod-sheet').innerText()
    t.ok('picking the debtor fills the letter: the debtor', /Karoo Haulage \(Pty\) Ltd/.test(await sheet()))
    t.check('...the amount from the balance Raptor worked out', await page.getByTestId('lod-sheet-total').innerText(), 'R112,450.50')
    t.check('...the reference to pay with, Raptor\'s account number', await page.getByTestId('lod-ref').inputValue(), 'SCL/00042')
    t.check('...and one invoice line, from the handover', await page.getByTestId('lod-invoice').count(), 1)
    t.check('...under the client\'s own reference', await page.getByTestId('lod-inv-no').first().inputValue(), 'INV-7781')
    t.ok('...saying where it came from', /As handed over, check against the client’s statement/.test(await sheet()))

    /* 3. Micro edits. */
    await page.getByTestId('lod-inv-amt').first().fill('R60,000')
    await page.getByTestId('lod-add-invoice').click()
    await page.getByTestId('lod-inv-no').nth(1).fill('INV-0002')
    await page.getByTestId('lod-inv-amt').nth(1).fill('46000')
    await page.getByTestId('lod-inv-amt').nth(1).blur()
    t.check('changing an invoice and adding one: the total follows', await page.getByTestId('lod-sheet-total').innerText(), 'R106,000.00')
    t.ok('...and the second invoice is on the letter', /INV-0002/.test(await sheet()))
    await page.getByTestId('lod-para-reserve').click()
    await page.getByTestId('lod-wording-reserve').waitFor({ timeout: 3000 })
    t.ok('clicking a paragraph on the letter opens its wording', await page.getByTestId('lod-wording-reserve').evaluate((el) => el === document.activeElement))
    await page.getByTestId('lod-wording-reserve').fill('If {total} is not paid in {days} days, our client will hand the matter to its attorneys.')
    t.ok('...and the reworded words are on the letter, fields filled', /If R106,000\.00 is not paid in 7 days, our client will hand the matter to its attorneys\./.test(await sheet()))
    await t.shot(page, 'letter-demand-2-filled')
    await page.setViewportSize({ width: 820, height: 1180 })
    await t.shot(page, 'letter-demand-2-filled-ipad')
    await page.setViewportSize({ width: 1440, height: 1000 })

    /* 5 (first half). Send waits until nothing is missing. */
    await page.getByTestId('lod-send').click()
    await page.getByTestId('lod-send-modal').waitFor({ timeout: 5000 })
    t.ok('Send waits for what is missing, and says what', /Statement date/.test(await page.getByTestId('lod-send-blockers').innerText())
      && await page.getByTestId('lod-send-confirm').isDisabled())
    t.check('...the debtor\'s address is offered from the account', await page.getByTestId('lod-send-to').inputValue(), 'accounts@karoo.example')
    t.ok('...and it says it is charged as an email on the account', /R25 under item 1\(a\)/.test(await page.getByTestId('lod-send-note').innerText()))
    await page.getByRole('button', { name: 'Cancel' }).click()

    /* 4. The PDF, read back. */
    await page.getByTestId('lod-stmt').fill('27 October 2026')
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByTestId('lod-download').click()])
    const file = await dl.path()
    t.ok('the PDF is named for the debtor and the date', dl.suggestedFilename() === 'Letter of Demand - Karoo Haulage (Pty) Ltd - 3 November 2026.pdf')
    const pdf = await pdfText(file)
    t.ok('it is a real PDF, with the debtor on it', /Karoo Haulage \(Pty\) Ltd/.test(pdf.text))
    t.ok('...the amount', /R106,000\.00/.test(pdf.text))
    t.ok('...the statement date and the reworded paragraph', /27 October 2026/.test(pdf.text) && /hand the matter to its attorneys/.test(pdf.text))
    t.ok('...and nothing printed in [brackets]', !/\[(Amount|Debtor|Client|statement date)\]/.test(pdf.text))
    for (let i = 0; i < 30 && w.docs.length < 2; i += 1) await page.waitForTimeout(100)
    t.check('a copy is filed on the account and on the client', JSON.stringify(w.docs.map((d) => [d.table, d.kind]).sort()),
      JSON.stringify([['account', 'Letter of Demand'], ['client', 'Letter of Demand']]))
    t.ok('...in their own buckets', w.storage.some((p) => p.startsWith(`account-documents/${ACCOUNT.id}/`)) && w.storage.some((p) => p.startsWith(`client-documents/${CLIENT.id}/`)))
    const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByTestId('lod-download').click()])
    await dl2.path()
    await page.waitForTimeout(500)
    t.check('downloading the same letter again files nothing more', w.docs.length, 2)

    /* 5. Send, from the central mailbox. */
    await page.getByTestId('lod-send').click()
    await page.getByTestId('lod-send-modal').waitFor({ timeout: 5000 })
    const options = await page.getByTestId('lod-send-from').locator('option').allInnerTexts()
    t.ok('a liaison is offered her own mailbox and the firm\'s central one', options.some((o) => /me@bredellferreira/.test(o)) && options.some((o) => /legal@bredellferreira/.test(o)))
    await page.getByTestId('lod-send-from').selectOption('central')
    await page.getByRole('button', { name: 'ceo@karoo.example' }).click()
    await t.shot(page, 'letter-demand-3-send')
    await page.getByTestId('lod-send-confirm').click()
    for (let i = 0; i < 100 && !w.emails.length; i += 1) await page.waitForTimeout(100)
    const sent = w.emails[0] ?? {}
    t.check('it goes to the chosen address, from the central mailbox', JSON.stringify([sent.to, sent.mailbox]), JSON.stringify(['ceo@karoo.example', 'central']))
    t.check('...with the letter and the acknowledgement attached', JSON.stringify((sent.attachments ?? []).map((a) => a.filename)),
      JSON.stringify(['Letter of Demand - Karoo Haulage (Pty) Ltd - 3 November 2026.pdf', 'Acknowledgement of Receipt - Karoo Haulage (Pty) Ltd - 3 November 2026.pdf']))
    t.ok('...each a PDF', (sent.attachments ?? []).every((a) => Buffer.from(a.content, 'base64').subarray(0, 5).toString() === '%PDF-'))
    await page.getByTestId('lod-status').filter({ hasText: /Sent to ceo@karoo\.example/ }).waitFor({ timeout: 10000 })
    t.ok('the screen says it went, and from where', /Sent to ceo@karoo\.example/.test(await page.getByTestId('lod-status').innerText()))
    t.ok('the acknowledgement is filed too, the letter once', w.docs.filter((d) => d.kind === 'Correspondence').length === 2 && w.docs.filter((d) => d.kind === 'Letter of Demand').length === 2)
    await context.close()
  }

  /* ------------------------- 5 (sales), 6: a sales representative, by reference, no client chosen ------------------------- */
  {
    const w = world(AGENT)
    const { context, page } = await signedInPage(browser, AGENT, w.handlers, [], { now: '2026-11-03T10:00:00+02:00' })
    await route(page, w, { central: false })
    await open(page, '/letters/demand')
    await page.getByTestId('lod-page').waitFor({ timeout: 20000 })
    await page.getByTestId('lod-client').fill('north')
    await page.getByTestId('lod-client-option').first().waitFor({ timeout: 5000 })
    t.check('the client is found as you type, by any word of the name', await page.getByTestId('lod-client-option').first().innerText().then((x) => x.split('\n')[0]), 'Northbank Properties')
    await page.getByTestId('lod-client').fill('')
    await page.getByTestId('lod-reference').fill('SCL/00042')
    await page.getByTestId('lod-reference-find').click()
    await page.getByTestId('lod-client-linked').waitFor({ timeout: 5000 })
    t.check('the reference finds the account, and fills in its client', await page.getByTestId('lod-client').inputValue(), CLIENT.name)
    t.ok('...and the debtor', /Karoo Haulage/.test(await page.getByTestId('lod-debtor').inputValue()))
    await page.getByTestId('lod-send').click()
    await page.getByTestId('lod-send-modal').waitFor({ timeout: 5000 })
    await page.waitForTimeout(300)
    const options = await page.getByTestId('lod-send-from').locator('option').allInnerTexts()
    t.ok('a sales representative is offered only their own mailbox', options.length === 1 && /me@bredellferreira/.test(options[0]))
    await context.close()
  }

  /* ------------------------- 7: typed by hand, nothing linked ------------------------- */
  {
    const w = world(AGENT)
    const { context, page } = await signedInPage(browser, AGENT, w.handlers, [], { now: '2026-11-03T10:00:00+02:00' })
    await route(page, w)
    await open(page, '/letters/demand')
    await page.getByTestId('lod-page').waitFor({ timeout: 20000 })
    await page.getByTestId('lod-client').fill('A client Raptor does not know')
    await page.getByTestId('lod-debtor').fill('Somebody (Pty) Ltd')
    await page.getByTestId('lod-inv-no').first().fill('A-1')
    await page.getByTestId('lod-inv-amt').first().fill('1234.5')
    t.check('typed by hand, the letter still adds up', await page.getByTestId('lod-sheet-total').innerText(), 'R1,234.50')
    await page.getByTestId('lod-download').click()
    await page.getByTestId('lod-notice').waitFor({ timeout: 5000 })
    t.ok('downloading with gaps says what is missing, and offers to download anyway', /Still to fill in: Statement date, Payment reference/.test(await page.getByTestId('lod-notice').innerText()))
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: 'Download anyway' }).click()])
    const pdf = await pdfText(await dl.path())
    t.ok('...and the gaps print in [brackets], as Ryno\'s page did', /\[statement date\]/.test(pdf.text) && /\[Reference\]/.test(pdf.text))
    await page.waitForTimeout(500)
    t.check('nothing linked, so nothing is filed', w.docs.length, 0)

    /* A long statement: the table runs onto a second page with its heading repeated, on screen and in the PDF. */
    for (let i = 1; i < 26; i += 1) {
      await page.getByTestId('lod-add-invoice').click()
      await page.getByTestId('lod-inv-no').nth(i).fill(`A-${i + 1}`)
      await page.getByTestId('lod-inv-amt').nth(i).fill('100')
    }
    await page.getByTestId('lod-stmt').fill('27 October 2026')
    await page.getByTestId('lod-ref').fill('SOMEBODY')
    await page.waitForTimeout(300)
    t.ok('twenty-six invoices run onto a second page, the heading repeated there', await page.locator('[data-testid="lod-sheet"] .threp').count() === 1
      && /PAGE 2/.test(await page.getByTestId('lod-sheet').innerText()))
    await t.shot(page, 'letter-demand-4-two-pages')
    const [dl3] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByTestId('lod-download').click()])
    const long = await pdfText(await dl3.path())
    t.check('...and the PDF has the same two pages', long.pages, 2)
    t.ok('...with every invoice and the total on them', /A-26/.test(long.text) && /R3,734\.50/.test(long.text))
    await context.close()
  }
} finally {
  if (browser) await browser.close()
  stopServer(server)
}
process.exit(t.finish('New letter on Clients, client and debtor found and filled, every line editable, a real PDF filed, sent from the chosen mailbox.') ? 0 : 1)
