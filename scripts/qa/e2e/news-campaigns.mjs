/**
 * NEWS & CAMPAIGNS IN A REAL BROWSER (S10, 21 Oct): the page, the list it counts, the send it drives,
 * the unsubscribe page a newsletter links to, and "Unsubscribed from news" on the record.
 *
 * Every request is a fixture, and /api/email/* is answered here too -- Resend is never reached. What
 * this proves is that the screen says what it should: the set-up steps when the sender is not ready,
 * the count and who was left out before anything goes, and that pressing Send asks the server to
 * queue and then keeps draining until nothing is left.
 *
 * Run: RAPTOR_E2E_PORT=5447 node scripts/qa/e2e/news-campaigns.mjs
 */
process.env.RAPTOR_E2E_PORT ??= '5447'
const { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } = await import('./harness.mjs')
const { PROFILE } = await import('./fixtures.mjs')

const t = makeRunner('news-campaigns')
const ADMIN = { ...PROFILE, role: 'Administrator', grants: [], revokes: [] }
const REP = { ...PROFILE, role: 'Sales Representative', grants: [], revokes: [] }
const CAMPAIGN = {
  id: '11111111-1111-4111-8111-111111111111', name: 'October newsletter', subject: 'News for {{company}}',
  preheader: 'What changed this month', body: 'Dear {{first_name}},\n\nOur new blog: https://bf.example/blog\n\nKind regards',
  image_url: null, audience: { kind: 'all_clients' }, first_approach: false, status: 'draft', recipient_count: null,
  created_by: ADMIN.id, created_at: '2026-10-20T08:00:00Z', updated_at: '2026-10-20T08:00:00Z',
  queued_at: null, queued_by: null, finished_at: null,
}
const LEAD = {
  id: '22222222-2222-4222-8222-222222222222', lead_number: 7, first_name: 'Quinn', last_name: 'Quiet', company_name: 'Quiet Co',
  email: 'quinn@quiet.example', source: 'Website', status: 'Interested', owner_id: ADMIN.id, score: 0, estimated_value: 0,
  created_at: '2026-01-01T08:00:00Z', updated_at: '2026-01-01T08:00:00Z', marketing_consent_at: null,
}

const supabaseHandlers = (campaign) => [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rest\/v1\/marketing_campaigns/.test(u), (u) => ({ body: /id=eq\./.test(u) ? campaign : [campaign] })],
  [(u) => /\/rpc\/marketing_campaign_results/.test(u), () => ({ body: [] })],
  [(u) => /\/rest\/v1\/firm_settings/.test(u), () => ({ body: { id: true, firm_name: 'Bredell Ferreira', email_font: 'Georgia, serif', email_size_pt: 11 } })],
  [(u) => /\/rest\/v1\/leads/.test(u), () => ({ body: [LEAD] })],
  [(u) => /\/rest\/v1\/marketing_preferences/.test(u), () => ({ body: [
    { email: 'quinn@quiet.example', status: 'unsubscribed', how: 'unsubscribe link', reason: null, changed_at: '2026-10-03T09:00:00Z' },
  ] })],
]

const PREVIEW = {
  count: 3, firstApproaches: 0,
  sample: [
    { email: 'accounts@smit.example', firstName: 'Piet', companyName: 'Smit & Seun', via: 'client', firstApproach: false },
    { email: 'anna@smit.example', firstName: 'Anna', companyName: 'Smit & Seun', via: 'contact', firstApproach: false },
    { email: 'ben@karoo.example', firstName: 'Ben', companyName: 'Karoo', via: 'contact', firstApproach: false },
  ],
  excluded: { unsubscribed: 2, 'on the list twice': 1 },
}

const server = await startServer()
let browser
try {
  browser = await chromium.launch()

  /* ------------------------- 1. not set up: the screen says what to do ------------------------- */
  {
    const { context, page } = await signedInPage(browser, ADMIN, supabaseHandlers(CAMPAIGN), [])
    const asked = []
    await page.route('**/api/email/marketing', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}')
      asked.push(body.step)
      if (body.step === 'config') return route.fulfill({ json: { ready: false, missing: ['RESEND_API_KEY', 'MARKETING_FROM'], from: null, replyTo: 'info@bf.example', webhook: false, keyProblem: null } })
      if (body.step === 'preview') return route.fulfill({ json: PREVIEW })
      return route.fulfill({ status: 412, json: { error: 'not set up' } })
    })
    for (let i = 0; i < 60; i += 1) {
      try { await page.goto(`http://localhost:${PORT}/news`, { timeout: 2000 }); break } catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    await page.getByTestId('news-list').waitFor({ timeout: 15000 })
    t.ok('the sidebar has News & campaigns for an Administrator', await page.locator('nav a[href="/news"]').isVisible())
    await page.getByTestId('sender-setup').waitFor({ timeout: 5000 })
    const setup = await page.getByTestId('sender-setup').innerText()
    t.ok('not set up: the screen says so and names both variables', /RESEND_API_KEY and MARKETING_FROM/.test(setup))
    t.ok('...and the DNS step the firm must do', /DNS records/.test(setup) && /Verified/.test(setup))
    t.ok('the campaign is listed with its list', /October newsletter[\s\S]*All clients and their contacts/.test(await page.getByTestId('news-list').innerText()))

    await page.getByText('October newsletter').click()
    await page.getByTestId('news-editor').waitFor({ timeout: 10000 })
    const frame = page.frameLocator('[data-testid="news-preview"]')
    await frame.locator('body').waitFor({ timeout: 5000 })
    const previewText = await frame.locator('body').innerText()
    t.ok('the preview is the email, merged, with no name on file read as Sir/Madam', /Dear Test,|Dear Sir\/Madam,/.test(previewText))
    t.ok('...and carries the unsubscribe link', await frame.locator('a', { hasText: 'Unsubscribe from our news' }).count() === 1)
    t.ok('...the link in the body is a link', await frame.locator('a[href="https://bf.example/blog"]').count() === 1)
    t.ok('the subject is merged in the preview', /News for your business/.test(await page.getByTestId('news-preview-subject').innerText()))
    t.ok('nothing can be sent before the list is counted', await page.getByTestId('news-send').isDisabled())
    t.ok('...and no test either while the sender is not set up', await page.getByTestId('news-test').isDisabled())

    await page.getByTestId('news-check').click()
    await page.getByTestId('news-preview-list').waitFor({ timeout: 5000 })
    t.check('the count is shown', await page.getByTestId('news-count').innerText(), '3')
    t.ok('...with who was left out and why', /2 unsubscribed · 1 on the list twice/.test(await page.getByTestId('news-excluded').innerText()))
    t.ok('...and a sample of the addresses', /anna@smit\.example/.test(await page.getByTestId('news-preview-list').innerText()))
    t.ok('counted, but still no Send while the sender is not set up', await page.getByTestId('news-send').isDisabled())
    t.ok('the server was asked, and only for the config and the count', JSON.stringify([...new Set(asked)]) === '["config","preview"]')

    /* The lead audience offers the first approach, and says what it means. */
    await page.getByTestId('news-audience-dormant_leads').click()
    await page.mouse.move(0, 0)
    const chip = (k) => page.getByTestId(`news-audience-${k}`).evaluate((el) => [el.getAttribute('aria-checked'), getComputedStyle(el).backgroundColor, getComputedStyle(el).color, getComputedStyle(el).opacity])
    const [was, now] = [await chip('all_clients'), await chip('dormant_leads')]
    t.ok('the chosen list is the one drawn as chosen', was[0] === 'false' && now[0] === 'true' && now[1] !== was[1])
    t.check('dormant leads default to 90 days', await page.getByTestId('news-dormant-days').inputValue(), '90')
    t.ok('news to a lead list reaches only leads who said yes (the introduction is the only first approach)',
      /leads who have said yes/.test(await page.getByTestId('news-kind-explained').innerText()) && await page.getByTestId('news-first-approach').count() === 0)
    t.check('...and changing the list clears the old count', await page.getByTestId('news-preview-list').count(), 0)
    await t.shot(page, 'news-editor-not-set-up')
    await context.close()
  }

  /* ------------------------- 2. set up: Send queues, then drains to the end ------------------------- */
  {
    const { context, page } = await signedInPage(browser, ADMIN, supabaseHandlers(CAMPAIGN), [])
    const steps = []
    let drains = 0
    await page.route('**/api/email/marketing', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}')
      steps.push(body.step)
      if (body.step === 'config') return route.fulfill({ json: { ready: true, missing: [], from: 'Bredell Ferreira <news@bf.example>', replyTo: 'info@bf.example', webhook: true, keyProblem: null } })
      if (body.step === 'preview') return route.fulfill({ json: PREVIEW })
      if (body.step === 'test') return route.fulfill({ json: { sentTo: ADMIN.email } })
      if (body.step === 'queue') return route.fulfill({ json: { queued: 3, sent: 1, failed: 0, skipped: 0, remaining: 2, stoppedFor: null } })
      if (body.step === 'drain') { drains += 1; return route.fulfill({ json: { sent: drains === 1 ? 1 : 1, failed: 0, skipped: 0, remaining: drains === 1 ? 1 : 0, stoppedFor: null } }) }
      return route.fulfill({ status: 400, json: { error: 'unknown' } })
    })
    await page.goto(`http://localhost:${PORT}/news/${CAMPAIGN.id}`)
    await page.getByTestId('news-editor').waitFor({ timeout: 15000 })
    t.check('set up: no set-up panel', await page.getByTestId('sender-setup').count(), 0)
    await page.getByTestId('news-test').click()
    await page.getByTestId('news-message').waitFor({ timeout: 5000 })
    t.ok('send a test to me: it says where it went', new RegExp(ADMIN.email.replace('.', '\\.')).test(await page.getByTestId('news-message').innerText()))
    await page.getByTestId('news-check').click()
    await page.getByTestId('news-preview-list').waitFor({ timeout: 5000 })
    t.check('the Send button names the count', await page.getByTestId('news-send').innerText(), 'Send to 3 people')
    let confirmText = ''
    page.once('dialog', async (d) => { confirmText = d.message(); await d.accept() })
    await page.getByTestId('news-send').click()
    for (let i = 0; i < 40 && drains < 2; i += 1) await page.waitForTimeout(150)
    t.ok('it asks first, with the count', /to 3 people\? This cannot be called back/.test(confirmText))
    t.ok('pressing Send queues, then drains until nothing is left', JSON.stringify(steps.filter((s) => ['queue', 'drain'].includes(s))) === '["queue","drain","drain"]')
    await context.close()
  }

  /* ------------------------- 3. the unsubscribe page, outside the sign-in ------------------------- */
  {
    const context = await browser.newContext()
    const page = await context.newPage()
    const calls = []
    await page.route('**/api/email/unsubscribe', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}')
      calls.push([body.token, body.step])
      return route.fulfill({ json: { email: 'an••••@smit.example', status: body.step === 'resubscribe' ? 'subscribed' : 'unsubscribed', changedAt: '2026-10-21T08:00:00Z' } })
    })
    await page.goto(`http://localhost:${PORT}/unsubscribe/abc.0123456789abcdef0123456789abcdef`)
    await page.getByTestId('unsubscribe-heading').waitFor({ timeout: 15000 })
    t.check('opening the link unsubscribes, no login', await page.getByTestId('unsubscribe-heading').innerText(), 'You will not receive our news any more')
    t.ok('...and it says reports are not affected', /Statements and reports about your own matters are not affected/.test(await page.getByTestId('unsubscribe-page').innerText()))
    t.check('...the token was sent as it was in the link', JSON.stringify(calls[0]), JSON.stringify(['abc.0123456789abcdef0123456789abcdef', 'unsubscribe']))
    await page.getByTestId('unsubscribe-resubscribe').click()
    await page.getByText('You will receive our news again').waitFor({ timeout: 5000 })
    t.check('the re-subscribe button puts them back', calls[1]?.[1], 'resubscribe')
    t.check('no sign-in page on the way', page.url().includes('/login'), false)
    await t.shot(page, 'news-unsubscribed')
    await context.close()
  }

  /* ------------------------- 4. the record says so ------------------------- */
  {
    const { context, page } = await signedInPage(browser, ADMIN, supabaseHandlers(CAMPAIGN), [])
    await page.goto(`http://localhost:${PORT}/leads/${LEAD.id}`)
    await page.getByTestId('news-preference').waitFor({ timeout: 15000 })
    await page.getByTestId('news-unsubscribed').waitFor({ timeout: 5000 })
    t.ok('the lead shows "Unsubscribed from news on" the date', /Unsubscribed from news on/.test(await page.getByTestId('news-unsubscribed').innerText()))
    t.ok('...and that no consent is recorded', /No consent to news recorded/.test(await page.getByTestId('news-consent').innerText()))
    await page.getByTestId('news-resubscribe').click()
    t.ok('a re-subscription cannot be recorded without a reason', await page.getByTestId('news-record').isDisabled())
    await page.getByTestId('news-reason').fill('Asked on a call, 21 Oct')
    t.ok('...and can with one', await page.getByTestId('news-record').isEnabled())
    await context.close()
  }

  /* ------------------------- 5. a sales rep has no such menu item ------------------------- */
  {
    const handlers = supabaseHandlers(CAMPAIGN)
    handlers[0] = [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [REP] })]
    const { context, page } = await signedInPage(browser, REP, handlers, [])
    await page.goto(`http://localhost:${PORT}/news`)
    await page.locator('main').waitFor({ timeout: 15000 })
    await page.getByText('not one of your permissions').waitFor({ timeout: 10000 })
    t.check('a sales rep sees no News & campaigns in the menu', await page.locator('nav a[href="/news"]').count(), 0)
    t.ok('...and the address says why rather than drawing the page', await page.getByText('not one of your permissions').isVisible())
    await context.close()
  }
} finally {
  if (browser) await browser.close()
  stopServer(server)
}
process.exit(t.finish() ? 0 : 1)
