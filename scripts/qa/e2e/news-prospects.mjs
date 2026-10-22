/**
 * PROSPECT LISTS, THE INTRODUCTION AND DELIVERY RESULTS IN A REAL BROWSER (S10, 22 Oct).
 *
 *   1. a list is uploaded, the server's counts are shown (new / already a lead / already a client /
 *      bad email / in the file twice) BEFORE anything is written, and Add writes it;
 *   2. an introduction campaign: leads only, the From is the marketer on the prospect domain, the
 *      preview carries the "Yes, keep me informed" button, and the counted list says that those who
 *      do not press it will never be sent marketing again;
 *   3. a sent campaign's results: sent, delivered, didn't arrive, opened, clicked, unsubscribed,
 *      spam, opted in -- with the warning that opens are approximate -- and per recipient;
 *   4. the thank-you page the button opens, outside the sign-in.
 * Every request is a fixture; Resend is never reached.
 *
 * Run: RAPTOR_E2E_PORT=5403 node scripts/qa/e2e/news-prospects.mjs
 */
process.env.RAPTOR_E2E_PORT ??= '5403'
const { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } = await import('./harness.mjs')
const { PROFILE } = await import('./fixtures.mjs')

const t = makeRunner('news-prospects')
const ADMIN = { ...PROFILE, role: 'Administrator', name: 'Reino Smit', email: 'reino@bredellferreira.co.za', grants: [], revokes: [] }
const base = {
  name: 'October introduction', subject: 'May we keep you informed?', preheader: '',
  body: 'Dear {{first_name}},\n\nWe collect debts for businesses like yours.\n\nKind regards', image_url: null,
  audience: { kind: 'imported_list', listIds: ['L1'] }, first_approach: true, kind: 'introduction', sender_id: ADMIN.id,
  recipient_count: null, created_by: ADMIN.id, created_at: '2026-10-22T08:00:00Z', updated_at: '2026-10-22T08:00:00Z',
  queued_at: null, queued_by: null, finished_at: null,
}
const DRAFT = { ...base, id: '33333333-3333-4333-8333-333333333333', status: 'draft' }
const SENT = { ...base, id: '44444444-4444-4444-8444-444444444444', status: 'sent', recipient_count: 4 }
const LIST = { id: 'L1', name: 'Expo 2026', file_name: 'expo.csv', uploaded_by: ADMIN.id, uploaded_at: '2026-10-21T09:00:00Z', counts: { new: 3 }, lead_count: 3 }
const RESULTS = {
  campaign_id: SENT.id, total: 4, queued: 0, accepted: 4, failed: 0, skipped: 0, delivered: 3, delayed: 0, bounced: 1,
  complained: 0, opened: 2, clicked: 1, unsubscribed: 0, opted_in: 1,
}
const send = (email, extra) => ({
  id: `id-${email}`, email, first_name: null, company_name: null, state: 'sent', error: null, sent_at: '2026-10-22T08:00:00Z',
  delivered_at: '2026-10-22T08:01:00Z', delayed_at: null, first_opened_at: null, open_count: 0, first_clicked_at: null, click_count: 0,
  unsubscribed_at: null, opted_in_at: null, ...extra,
})
const SENDS = [
  send('ann@one.example', { first_opened_at: '2026-10-22T09:00:00Z', open_count: 3, first_clicked_at: '2026-10-22T09:01:00Z', click_count: 1, opted_in_at: '2026-10-22T09:01:00Z' }),
  send('ben@one.example', { first_opened_at: '2026-10-22T10:00:00Z', open_count: 1 }),
  send('cat@one.example', {}),
  send('dud@one.example', { state: 'bounced', delivered_at: null, error: 'Hard bounce: mailbox does not exist' }),
]

const handlers = (campaign) => [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rest\/v1\/marketing_campaigns/.test(u), (u) => ({ body: /id=eq\./.test(u) ? campaign : [DRAFT, SENT] })],
  [(u) => /\/rpc\/marketing_campaign_results/.test(u), () => ({ body: [RESULTS] })],
  [(u) => /\/rest\/v1\/marketing_lists/.test(u), () => ({ body: [LIST] })],
  [(u) => /\/rest\/v1\/marketing_sends/.test(u), () => ({ body: SENDS })],
  [(u) => /\/rest\/v1\/firm_settings/.test(u), () => ({ body: { id: true, firm_name: 'Bredell Ferreira', email_font: 'Georgia, serif', email_size_pt: 11 } })],
]
const CONFIG = {
  ready: true, missing: [], problem: null, from: 'Bredell Ferreira <news@news.example>', replyTo: 'info@bf.example', webhook: true, keyProblem: null,
  prospect: { ready: true, missing: [], problem: null, domain: 'prospects.example' }, warmupCeiling: 500,
}

const server = await startServer()
let browser
try {
  browser = await chromium.launch()

  /* ------------------------- 1. a prospect list: counted, then written ------------------------- */
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers(DRAFT), [])
    const asked = []
    await page.route('**/api/email/marketing', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}')
      asked.push(body)
      if (body.step === 'config') return route.fulfill({ json: CONFIG })
      if (body.step === 'import-preview') {
        return route.fulfill({ json: {
          counts: { new: 2, 'already a lead': 1, 'already a client': 1, 'bad email': 1, 'duplicate in file': 1 },
          examples: { new: [], 'already a lead': ['old@lead.example'], 'already a client': ['acc@client.example'], 'bad email': ['nope (row 5)'], 'duplicate in file': ['a@x.example (row 6)'] },
          sample: [],
        } })
      }
      if (body.step === 'import') return route.fulfill({ json: { listId: 'L2', written: 2, preview: {} } })
      return route.fulfill({ status: 400, json: { error: 'unexpected' } })
    })
    for (let i = 0; i < 60; i += 1) {
      try { await page.goto(`http://localhost:${PORT}/news`, { timeout: 2000 }); break } catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    await page.getByTestId('news-list').waitFor({ timeout: 15000 })
    t.ok('the list says which campaigns are introductions', /October introduction[\s\S]*Introduction to prospects/.test(await page.getByTestId('news-list').innerText()))
    t.ok('...and shows delivered and opened with their rates', /3 \(75%\)/.test(await page.getByTestId('news-list').innerText()) && /2 \(66\.7%\)/.test(await page.getByTestId('news-list').innerText()))
    await page.getByTestId('news-import-open').click()
    await page.getByTestId('news-import').waitFor({ timeout: 5000 })
    const csv = 'Name,Email,Company,Industry\nAnn One,ann@one.example,One (Pty) Ltd,Retail\nBen,ben@one.example,,\n'
    await page.getByTestId('news-import-file').setInputFiles({ name: 'expo-2026.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await page.getByTestId('news-import-preview').waitFor({ timeout: 5000 })
    const sent = asked.find((b) => b.step === 'import-preview')
    t.check('the rows are read in the browser and sent to be counted, nothing written yet', JSON.stringify(asked.map((b) => b.step).filter((s) => s !== 'config')), '["import-preview"]')
    t.check('...read by heading, the extra column kept as a note', JSON.stringify(sent?.rows?.[0] && [sent.rows[0].firstName, sent.rows[0].email, sent.rows[0].company, sent.rows[0].note]),
      JSON.stringify(['Ann', 'ann@one.example', 'One (Pty) Ltd', 'Industry: Retail']))
    const preview = await page.getByTestId('news-import-preview').innerText()
    t.ok('the counts: new, already a lead, already a client, bad email, in the file twice',
      /2 new/.test(preview) && /1 already a lead/.test(preview) && /1 already a client/.test(preview) && /1 address does not look right/.test(preview) && /1 in the file twice/.test(preview))
    t.ok('...and it says what happens next: one introduction, then nothing without a yes', /ONE introduction email[\s\S]*never sent marketing again/.test(preview))
    t.check('the list is named after the file until somebody renames it', await page.getByTestId('news-import-name').inputValue(), 'expo-2026')
    await page.getByTestId('news-import-name').fill('Expo 2026')
    await page.getByTestId('news-import-write').click()
    await page.getByTestId('news-import-done').waitFor({ timeout: 5000 })
    const wrote = asked.find((b) => b.step === 'import')
    t.ok('Add writes it with the list\'s name and the file\'s', wrote?.name === 'Expo 2026' && wrote?.fileName === 'expo-2026.csv')
    t.ok('...and says how many leads came in', /2 new leads added from “Expo 2026”/.test(await page.getByTestId('news-import-done').innerText()))
    t.ok('the lists imported so far are listed', /Expo 2026[\s\S]*expo\.csv/.test(await page.getByTestId('news-import-lists').innerText()))
    await t.shot(page, 'news-prospect-import')
    await context.close()
  }

  /* ------------------------- 2. the introduction ------------------------- */
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers(DRAFT), [])
    const asked = []
    await page.route('**/api/email/marketing', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}')
      asked.push(body)
      if (body.step === 'config') return route.fulfill({ json: CONFIG })
      if (body.step === 'preview') {
        return route.fulfill({ json: {
          kind: 'introduction', count: 3, firstApproaches: 3,
          sample: [{ email: 'ann@one.example', firstName: 'Ann', companyName: null, via: 'lead', firstApproach: true }],
          excluded: { 'already approached once': 4, 'already said yes': 2, 'already a client': 1 },
        } })
      }
      return route.fulfill({ status: 400, json: { error: 'unexpected' } })
    })
    await page.goto(`http://localhost:${PORT}/news/${DRAFT.id}`)
    await page.getByTestId('news-editor').waitFor({ timeout: 15000 })
    t.ok('an introduction says what it is', /once, ever[\s\S]*never sent marketing again/.test(await page.getByTestId('news-kind-explained').innerText()))
    await page.getByTestId('news-from').waitFor({ timeout: 5000 })
    t.check('it goes from the marketer, on the prospect domain, replies to their own inbox',
      await page.getByTestId('news-from').innerText(), '"Reino Smit" <reino@prospects.example> · replies to reino@bredellferreira.co.za')
    t.check('only lead lists are offered', await page.getByTestId('news-audience-all_clients').count(), 0)
    t.ok('...the imported list is', await page.getByTestId('news-list-picker').getByText('Expo 2026').isVisible())
    const frame = page.frameLocator('[data-testid="news-preview"]')
    await frame.locator('body').waitFor({ timeout: 5000 })
    t.check('the preview carries the "Yes, keep me informed" button', await frame.locator('a', { hasText: 'Yes, keep me informed' }).count(), 1)
    t.ok('...and the footer says it is the only one without a yes', /this is the only marketing email we will send you/.test(await frame.locator('body').innerText()))
    await page.getByTestId('news-check').click()
    await page.getByTestId('news-preview-list').waitFor({ timeout: 5000 })
    t.check('the count asked for is the introduction\'s', asked.find((b) => b.step === 'preview')?.kind, 'introduction')
    t.ok('the counted list says the rest will never be sent marketing again',
      /each of these 3[\s\S]*never be sent another marketing email/.test(await page.getByTestId('news-never-again').innerText()))
    t.ok('...and who was left out and why', /4 already approached once · 2 already said yes · 1 already a client/.test(await page.getByTestId('news-excluded').innerText()))
    t.check('Send names the count', await page.getByTestId('news-send').innerText(), 'Send to 3 people')
    await t.shot(page, 'news-introduction')
    await context.close()
  }

  /* ------------------------- 2b. prospect domain not set: the screen says which setting ------------------------- */
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers(DRAFT), [])
    await page.route('**/api/email/marketing', (route) => route.fulfill({ json: {
      ...CONFIG, prospect: { ready: false, missing: ['MARKETING_PROSPECT_DOMAIN'], problem: null, domain: null },
    } }))
    await page.goto(`http://localhost:${PORT}/news/${DRAFT.id}`)
    await page.getByTestId('prospect-setup').waitFor({ timeout: 15000 })
    t.ok('no prospect domain: the introduction says MARKETING_PROSPECT_DOMAIN is missing', /MARKETING_PROSPECT_DOMAIN is set/.test(await page.getByTestId('prospect-setup').innerText()))
    t.check('...the news set-up panel is not shown for it', await page.getByTestId('sender-setup').count(), 0)
    t.ok('...and nothing can be tested', await page.getByTestId('news-test').isDisabled())
    await context.close()
  }

  /* ------------------------- 3. a sent campaign's results ------------------------- */
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers(SENT), [])
    await page.route('**/api/email/marketing', (route) => route.fulfill({ json: CONFIG }))
    await page.goto(`http://localhost:${PORT}/news/${SENT.id}`)
    await page.getByTestId('news-results').waitFor({ timeout: 15000 })
    const tile = async (k) => (await page.getByTestId(`news-result-${k}`).innerText()).replace(/\s+/g, ' ')
    t.ok('sent', /Sent 4/.test(await tile('sent')))
    t.ok('delivered, as a rate of sent', /Delivered 3 75% of sent/.test(await tile('delivered')))
    t.ok('didn\'t arrive', /Didn’t arrive 1 25% of sent/.test(await tile('bounced')))
    t.ok('opened, as a rate of delivered', /Opened 2 66\.7% of delivered/.test(await tile('opened')))
    t.ok('clicked', /Clicked 1 33\.3% of delivered/.test(await tile('clicked')))
    t.ok('unsubscribed and spam are shown even at nought', /Unsubscribed 0/.test(await tile('unsubscribed')) && /Marked as spam 0/.test(await tile('complained')))
    t.ok('an introduction shows who opted in', /Opted in 1 33\.3% of delivered/.test(await tile('opted-in')))
    t.ok('opens are said to be approximate, and why', /approximate[\s\S]*Apple Mail/.test(await page.getByTestId('news-opens-note').innerText()))
    const table = await page.getByTestId('news-recipients').innerText()
    t.ok('per recipient: who said yes, and what did not arrive, with why', /ann@one\.example[\s\S]*said yes/.test(table) && /dud@one\.example[\s\S]*Didn’t arrive[\s\S]*mailbox does not exist/.test(table))
    await page.getByTestId('news-recipients-unopened').click()
    t.ok('...filtered to the unopened', /cat@one\.example/.test(await page.getByTestId('news-recipients').innerText()) && !/ann@one\.example/.test(await page.getByTestId('news-recipients').innerText()))
    await page.getByTestId('news-recipients-undelivered').click()
    t.ok('...and to what was not delivered', /dud@one\.example/.test(await page.getByTestId('news-recipients').innerText()) && !/cat@one\.example/.test(await page.getByTestId('news-recipients').innerText()))
    await t.shot(page, 'news-results')
    await context.close()
  }

  /* ------------------------- 4. the thank-you page, outside the sign-in ------------------------- */
  {
    const context = await browser.newContext()
    const page = await context.newPage()
    const calls = []
    await page.route('**/api/email/opt-in', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}')
      calls.push([body.token, body.step])
      return route.fulfill({ json: { email: 'an••••@one.example', optedIn: body.step === 'yes', status: body.step === 'yes' ? 'subscribed' : 'unsubscribed' } })
    })
    await page.goto(`http://localhost:${PORT}/opt-in/abc.0123456789abcdef0123456789abcdef`)
    await page.getByTestId('opt-in-confirm').waitFor({ timeout: 15000 })
    /* OPENING RECORDS NOTHING (22 Oct): a mail scanner that runs the page must not leave a yes. */
    t.check('opening the page only asks, never records', JSON.stringify(calls), JSON.stringify([['abc.0123456789abcdef0123456789abcdef', 'status']]))
    t.check('...no sidebar, no sign-in page', [await page.locator('nav').count(), page.url().includes('/login')].join(), '0,false')
    await page.getByTestId('opt-in-confirm').click()
    await page.getByText('Thank you — you’ll hear from us').waitFor({ timeout: 5000 })
    t.check('the confirm press records the yes, with the token as it was in the link', JSON.stringify(calls[1]), JSON.stringify(['abc.0123456789abcdef0123456789abcdef', 'yes']))
    await page.getByTestId('opt-in-withdraw').click()
    await page.getByText('You will not hear from us').waitFor({ timeout: 5000 })
    t.check('"That wasn\'t me" withdraws it', calls[2]?.[1], 'withdraw')
    await t.shot(page, 'news-opt-in')
    await context.close()
  }
} finally {
  if (browser) await browser.close()
  stopServer(server)
}
process.exit(t.finish() ? 0 : 1)
