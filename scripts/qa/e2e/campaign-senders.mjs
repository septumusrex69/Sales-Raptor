/**
 * S13 · CAMPAIGNS IN A REAL BROWSER: who a News campaign comes from, the split before Send, the "not set
 * up yet" state, history by sender, results per sender, follow-up workflows and extra addresses.
 *
 * Every request is a fixture and /api/email/marketing is answered here -- Resend is never reached. What
 * this proves is that the screen says what it should: the liaisons and reports@ are not offered until
 * the firm's key is set; the count asks the server with the chosen sender and shows the split it
 * answers; Send says the split before anything goes; the list filters by sender; a liaison campaign's
 * results are split per sender; and an address on a domain that cannot send is refused before it is added.
 *
 * Run: RAPTOR_E2E_PORT=5452 node scripts/qa/e2e/campaign-senders.mjs
 */
process.env.RAPTOR_E2E_PORT ??= '5452'
const { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } = await import('./harness.mjs')
const { PROFILE } = await import('./fixtures.mjs')

const t = makeRunner('campaign-senders')
const ADMIN = { ...PROFILE, role: 'Administrator', grants: [], revokes: [] }
const base = {
  preheader: 'What changed this month', image_url: null, first_approach: false, kind: 'news', sender_id: null, created_by: ADMIN.id,
  queued_by: null, sender_address_id: null, results_sent_at: null,
}
const DRAFT = {
  ...base, id: '11111111-1111-4111-8111-111111111111', name: 'November newsletter', subject: 'News for {{company}}',
  body: 'Dear {{first_name}},\n\nOur new client portal is live.\n\nKind regards', audience: { kind: 'all_clients' }, status: 'draft',
  send_from: 'news', recipient_count: null, created_at: '2026-10-27T08:00:00Z', updated_at: '2026-10-27T08:00:00Z', queued_at: null, finished_at: null,
}
const LIAISON_SENT = {
  ...base, id: '33333333-3333-4333-8333-333333333333', name: 'October newsletter', subject: 'October at Bredell Ferreira', body: 'x',
  audience: { kind: 'all_clients' }, status: 'sent', send_from: 'liaison', recipient_count: 5,
  created_at: '2026-10-20T08:00:00Z', updated_at: '2026-10-21T08:00:00Z', queued_at: '2026-10-21T08:00:00Z', finished_at: '2026-10-21T08:30:00Z',
}
const REPORTS_SENT = { ...LIAISON_SENT, id: '44444444-4444-4444-8444-444444444444', name: 'September newsletter', subject: 'September', send_from: 'reports' }
const CAMPAIGNS = [DRAFT, LIAISON_SENT, REPORTS_SENT]
const RESULTS = [
  { campaign_id: LIAISON_SENT.id, total: 5, queued: 0, accepted: 5, failed: 0, skipped: 0, delivered: 4, delayed: 0, bounced: 1, complained: 0, opened: 2, clicked: 0, unsubscribed: 1, opted_in: 0 },
  { campaign_id: REPORTS_SENT.id, total: 3, queued: 0, accepted: 3, failed: 0, skipped: 0, delivered: 3, delayed: 0, bounced: 0, complained: 0, opened: 1, clicked: 0, unsubscribed: 0, opted_in: 0 },
]
const send = (i, email, sender, o = {}) => ({
  id: `s${i}`, email, first_name: 'Anna', company_name: 'Smit & Seun', state: 'sent', error: null, sent_at: '2026-10-21T08:10:00Z', resend_id: `r${i}`,
  delivered_at: '2026-10-21T08:11:00Z', delayed_at: null, first_opened_at: null, open_count: 0, first_clicked_at: null, click_count: 0,
  unsubscribed_at: null, opted_in_at: null, sender, ...o,
})
const SENDS = [
  send(1, 'anna@smit.example', 'nicole@bredellferreira.co.za', { first_opened_at: '2026-10-21T09:00:00Z', open_count: 1 }),
  send(2, 'piet@smit.example', 'nicole@bredellferreira.co.za', { state: 'bounced', delivered_at: null }),
  send(3, 'ben@karoo.example', 'ryno@bredellferreira.co.za', { first_opened_at: '2026-10-21T10:00:00Z', open_count: 2 }),
  send(4, 'cara@solo.example', 'reports@bredellferreira.co.za', { unsubscribed_at: '2026-10-22T08:00:00Z' }),
  send(5, 'lead@quiet.example', 'news@bfnews.co.za'),
]
const EXTRA = { id: '55555555-5555-4555-8555-555555555555', address: 'marketing@bfnews.co.za', display_name: 'BF Marketing', active: true, created_at: '2026-10-28T08:00:00Z' }
const WORKFLOW = { id: '66666666-6666-4666-8666-666666666666', name: 'October and its reminder', first_campaign_id: LIAISON_SENT.id, status: 'active', created_by: ADMIN.id, created_at: '2026-10-21T08:00:00Z', updated_at: '2026-10-21T08:00:00Z' }
const FOLLOW = { ...DRAFT, id: '77777777-7777-4777-8777-777777777777', name: 'October and its reminder · follow-up 1', subject: 'Did you see our news?' }
const STEP = { id: '88888888-8888-4888-8888-888888888888', workflow_id: WORKFLOW.id, position: 1, campaign_id: FOLLOW.id, wait_days: 20, audience: 'not_opened', run_at: null }

const PREVIEW = {
  kind: 'news', count: 94, firstApproaches: 0, excluded: { unsubscribed: 2 },
  sample: [{ email: 'anna@smit.example', firstName: 'Anna', companyName: 'Smit & Seun', via: 'contact', firstApproach: false }],
  senders: [
    { label: 'Nicole Loder', address: 'nicole@bredellferreira.co.za', kind: 'liaison', count: 42 },
    { label: 'Ryno', address: 'ryno@bredellferreira.co.za', kind: 'liaison', count: 31 },
    { label: 'reports@', address: 'reports@bredellferreira.co.za', kind: 'reports', count: 9 },
    { label: 'news@ (leads)', address: 'news@bfnews.co.za', kind: 'news', count: 12 },
  ],
}
const config = (firm) => ({
  ready: true, missing: [], problem: null, from: 'Bredell Ferreira News <news@bfnews.co.za>', replyTo: 'reports@bredellferreira.co.za', webhook: true, keyProblem: null,
  prospect: { ready: false, missing: ['MARKETING_PROSPECT_DOMAIN'], problem: null, domain: null }, warmupCeiling: 500,
  firm: firm ? { ready: true, missing: [] } : { ready: false, missing: ['RESEND_FIRM_API_KEY'] },
})

function handlers(saved) {
  return [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rest\/v1\/marketing_campaigns/.test(u), (u, req) => {
      if (req.method() === 'PATCH') { saved.push(JSON.parse(req.postData() ?? '{}')); return { body: { id: DRAFT.id } } }
      const m = /id=eq\.([0-9a-f-]+)/.exec(u)
      return { body: m ? [...CAMPAIGNS, FOLLOW].find((c) => c.id === m[1]) ?? null : [...CAMPAIGNS, FOLLOW] }
    }],
    [(u) => /\/rpc\/marketing_campaign_results/.test(u), () => ({ body: RESULTS })],
    [(u) => /\/rest\/v1\/marketing_sends/.test(u), () => ({ body: SENDS })],
    [(u) => /\/rest\/v1\/marketing_senders/.test(u), () => ({ body: [EXTRA] })],
    [(u) => /\/rest\/v1\/marketing_workflows/.test(u), (u) => ({ body: /id=eq\./.test(u) ? WORKFLOW : [WORKFLOW] })],
    [(u) => /\/rest\/v1\/marketing_workflow_steps/.test(u), (u) => ({ body: /campaign_id=eq\.7777/.test(u) ? STEP : /campaign_id=eq\./.test(u) ? null : [STEP] })],
    [(u) => /\/rest\/v1\/marketing_results_settings/.test(u), () => ({ body: { enabled: true, recipients: ['ryno@bredellferreira.co.za'], after_hours: 24 } })],
    [(u) => /\/rest\/v1\/marketing_lists/.test(u), () => ({ body: [] })],
    [(u) => /\/rest\/v1\/marketing_preferences/.test(u), () => ({ body: [] })],
    [(u) => /\/rest\/v1\/firm_settings/.test(u), () => ({ body: { id: true, firm_name: 'Bredell Ferreira', email_font: 'Georgia, serif', email_size_pt: 11 } })],
  ]
}

async function route(page, firm, asked) {
  await page.route('**/api/email/marketing', async (r) => {
    const body = JSON.parse(r.request().postData() ?? '{}')
    asked.push(body)
    if (body.step === 'config') return r.fulfill({ json: config(firm) })
    if (body.step === 'preview') return r.fulfill({ json: body.sendFrom === 'liaison' ? PREVIEW : { ...PREVIEW, senders: [{ label: 'news@', address: 'news@bfnews.co.za', kind: 'news', count: 94 }] } })
    if (body.step === 'queue') return r.fulfill({ json: { queued: 94, sent: 94, failed: 0, skipped: 0, remaining: 0, stoppedFor: null } })
    if (body.step === 'drain') return r.fulfill({ json: { sent: 0, failed: 0, skipped: 0, remaining: 0, stoppedFor: null } })
    return r.fulfill({ status: 400, json: { error: 'fixture' } })
  })
}

async function open(page, path) {
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}${path}`, { timeout: 2000 }); return } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
}

const server = await startServer()
let browser
try {
  browser = await chromium.launch()

  /* ------------------------- 1. the firm's key is not set: only BF News ------------------------- */
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers([]), [])
    await route(page, false, [])
    await open(page, `/news/${DRAFT.id}`)
    await page.getByTestId('news-send-from').waitFor({ timeout: 20000 })
    t.ok('a News campaign offers Send from', await page.getByTestId('news-send-from-news').isVisible())
    t.ok('without the firm\'s key the liaisons cannot be chosen', await page.getByTestId('news-send-from-liaison').isDisabled())
    t.ok('...nor reports@', await page.getByTestId('news-send-from-reports').isDisabled())
    t.check('...and the screen says what must be set, in the firm\'s words',
      (await page.getByTestId('firm-setup').innerText()).startsWith('Sending from the liaisons is not set up yet: RESEND_FIRM_API_KEY must be set in Vercel.'), true)
    t.ok('...BF News is chosen', (await page.getByTestId('news-send-from-news').getAttribute('aria-checked')) === 'true')
    await t.shot(page, 'campaign-who-not-set-up')
    await context.close()
  }

  /* ------------------------- 2. set up: from each liaison, the split before Send ------------------------- */
  {
    const saved = []
    const asked = []
    const { context, page } = await signedInPage(browser, ADMIN, handlers(saved), [])
    await route(page, true, asked)
    await open(page, `/news/${DRAFT.id}`)
    await page.getByTestId('news-send-from').waitFor({ timeout: 20000 })
    t.check('with the key there is no "not set up" line', await page.getByTestId('firm-setup').count(), 0)
    await page.getByTestId('news-send-from-liaison').click()
    t.ok('choosing the liaisons says what it means', /Nicole’s clients from Nicole[\s\S]*without a liaison gets it from reports@/.test(await page.getByTestId('news-send-from-explained').innerText()))
    await page.getByTestId('news-next').click()
    await page.getByTestId('news-next').click()
    t.check('Next, Next is Check', await page.getByTestId('news-step-check').getAttribute('aria-current'), 'step')
    t.check('moving on saves the choice', saved.at(-1)?.send_from, 'liaison')
    await page.getByTestId('news-check').click()
    await page.getByTestId('news-split').waitFor({ timeout: 5000 })
    t.check('the count asks the server with the chosen sender', asked.find((b) => b.step === 'preview')?.sendFrom, 'liaison')
    t.check('...and shows the split it answers, people first',
      (await page.getByTestId('news-split').innerText()).replace(/\s+/g, ' ').trim(), 'Who it comes from Nicole Loder 42 Ryno 31 reports@ 9 news@ (leads) 12')
    t.ok('the inbox shows the From as the first liaison, and says it differs per client',
      /Nicole Loder/.test(await page.getByTestId('news-inbox-from').innerText()) && /each client’s own liaison/.test(await page.getByTestId('news-inbox-from-note').innerText()))
    await page.getByTestId('news-width-phone').click()
    await t.shot(page, 'campaign-check-liaison-phone')
    await page.getByTestId('news-width-tablet').click()
    await t.shot(page, 'campaign-check-liaison')
    /* The firm works on an iPad: the same step at its width. */
    await page.setViewportSize({ width: 820, height: 1180 })
    await t.shot(page, 'campaign-check-ipad')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByTestId('news-step-send').click()
    t.check('Send says the split before anything goes', await page.getByTestId('news-send-split').innerText(), 'From Nicole Loder 42 · Ryno 31 · reports@ 9 · news@ (leads) 12')
    await t.shot(page, 'campaign-send')
    await page.getByTestId('news-send').click()
    await page.getByTestId('news-send-modal').waitFor({ timeout: 5000 })
    t.check('...and the pop-up asks first, with the split', await page.getByTestId('news-send-modal-from').innerText(), 'From Nicole Loder 42 · Ryno 31 · reports@ 9 · news@ (leads) 12')
    await page.getByTestId('news-send-confirm').click()
    for (let i = 0; i < 40 && !asked.some((b) => b.step === 'queue'); i += 1) await page.waitForTimeout(100)
    t.ok('...then queues', asked.some((b) => b.step === 'queue'))
    await context.close()
  }

  /* ------------------------- 3. the list: history by sender ------------------------- */
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers([]), [])
    await route(page, true, [])
    await open(page, '/news')
    await page.getByTestId('news-list').waitFor({ timeout: 20000 })
    const froms = async () => page.getByTestId('news-row-from').allInnerTexts()
    t.check('every campaign says who it went from', JSON.stringify(await froms()), JSON.stringify(['BF News', 'Each liaison', 'reports@', 'BF News']))
    t.ok('...and how it did: the open rate at a glance', /50%/.test(await page.getByTestId('news-list').innerText()))
    await t.shot(page, 'campaign-list')
    await page.setViewportSize({ width: 820, height: 1180 })
    await t.shot(page, 'campaign-list-ipad')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByTestId('news-addresses').click()
    await page.getByTestId('news-address-option').filter({ hasText: 'Each client’s liaison' }).click()
    t.check('filtered to the liaisons, only their campaign', JSON.stringify(await froms()), JSON.stringify(['Each liaison']))
    t.ok('...with what went from them summed', /Campaigns sent\s*1[\s\S]*Emails sent\s*5/.test(await page.getByTestId('news-history-summary').innerText()))
    await page.getByTestId('news-addresses').click()
    await page.getByTestId('news-address-option').filter({ hasText: 'reports@bredellferreira.co.za' }).click()
    t.check('...and to reports@', JSON.stringify(await froms()), JSON.stringify(['reports@']))
    await context.close()
  }

  /* ------------------------- 4. results, split by sender ------------------------- */
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers([]), [])
    await route(page, true, [])
    await open(page, `/news/${LIAISON_SENT.id}`)
    await page.getByTestId('news-results').waitFor({ timeout: 20000 })
    t.check('a campaign that has gone opens on its results', await page.getByTestId('news-step-results').getAttribute('aria-current'), 'step')
    const tile = async (k) => (await page.getByTestId(`news-result-${k}`).innerText()).replace(/\s+/g, ' ')
    t.ok('the summary: delivered, didn’t arrive, opened, not opened', /Delivered 4/.test(await tile('delivered')) && /Didn’t arrive 1/.test(await tile('bounced'))
      && /Opened 2/.test(await tile('opened')) && /Not opened 2/.test(await tile('unopened')))
    const split = await page.getByTestId('news-results-by-sender').innerText()
    t.ok('...and per sender: Nicole, Ryno, reports@ and news@', /nicole@bredellferreira\.co\.za/.test(split) && /ryno@bredellferreira\.co\.za/.test(split)
      && /reports@bredellferreira\.co\.za/.test(split) && /news@bfnews\.co\.za/.test(split))
    t.ok('...clicks from the firm\'s domain are "not counted", not a zero', /not counted/.test(split))
    t.ok('...and the note says why', /click tracking is off on that domain/.test(await page.getByTestId('news-opens-note').innerText()))
    t.check('nothing claims to know what was deleted unread', /deleted/i.test(await page.getByTestId('news-results').innerText()), false)
    await t.shot(page, 'campaign-results')
    await context.close()
  }

  /* ------------------------- 5. workflows and extra addresses ------------------------- */
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers([]), [])
    await route(page, true, [])
    await open(page, '/news?tab=workflows')
    await page.getByTestId('news-workflow').waitFor({ timeout: 20000 })
    const card = await page.getByTestId('news-workflow').innerText()
    t.ok('a workflow shows its first email and its follow-up', /October at Bredell Ferreira/.test(card) && /Did you see our news\?/.test(card))
    t.ok('...the follow-up\'s day, 20 days after the first went', /Goes Tue, 10 Nov/.test(card))
    t.check('...to those who did not open it', await page.getByTestId('news-step-audience').inputValue(), 'not_opened')
    t.check('...and that it is running', await page.getByTestId('news-workflow-status').innerText(), 'Running')
    await t.shot(page, 'campaign-workflows')

    await open(page, `/news/${FOLLOW.id}`)
    await page.getByTestId('news-followup').waitFor({ timeout: 20000 })
    t.ok('a follow-up\'s email says it is one, and when it goes', /follow-up 1 of the workflow[\s\S]*20 days after/.test(await page.getByTestId('news-followup').innerText()))
    await page.getByTestId('news-step-send').click()
    t.check('...and offers no Send of its own', await page.getByTestId('news-send').count(), 0)

    await open(page, '/news?tab=senders')
    await page.getByTestId('news-senders').waitFor({ timeout: 20000 })
    t.ok('the extra addresses are listed', /marketing@bfnews\.co\.za/.test(await page.getByTestId('news-senders').innerText()))
    await page.getByTestId('news-sender-address-input').fill('me@gmail.com')
    t.ok('an address on a public mail service nobody can verify is refused before it is added',
      /public mail service/.test(await page.getByTestId('news-sender-problem').innerText()) && await page.getByTestId('news-sender-add').isDisabled())
    await page.getByTestId('news-sender-address-input').fill('marketing@bredellferreira.co.za')
    t.ok('...one on the firm\'s domain can be', await page.getByTestId('news-sender-add').isEnabled())
    t.check('the results email says who gets it', await page.getByTestId('news-results-to').inputValue(), 'ryno@bredellferreira.co.za')
    await t.shot(page, 'campaign-senders')
    await context.close()
  }
} finally {
  if (browser) await browser.close()
  stopServer(server)
}
process.exit(t.finish('Send from BF News, each liaison or reports@, the split before Send, history and results by sender, follow-ups and extra addresses.') ? 0 : 1)
