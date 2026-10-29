/**
 * S13 · CAMPAIGNS, 29 OCT, IN A REAL BROWSER: the Email addresses drop-down and its +, the set-up guide for a
 * new domain, the Outlook-style compose screen, templates, the send pop-up's batches and follow-ups, and the
 * Sent 1 / Sent 2 sheet. Every request is a fixture; Resend and the database are never reached.
 *
 * Run: RAPTOR_E2E_PORT=5453 node scripts/qa/e2e/campaign-compose.mjs
 */
process.env.RAPTOR_E2E_PORT ??= '5453'
const { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } = await import('./harness.mjs')
const { PROFILE } = await import('./fixtures.mjs')

const t = makeRunner('campaign-compose')
const ADMIN = { ...PROFILE, role: 'Administrator', grants: [], revokes: [] }
const MARKER = '<!--raptor:html-->'
const base = {
  preheader: '', image_url: null, first_approach: false, kind: 'news', sender_id: null, created_by: ADMIN.id, queued_by: null,
  sender_address_id: null, results_sent_at: null, batch_size: null, batch_every_minutes: null, next_batch_at: null, template_id: null,
  audience: { kind: 'all_clients' }, recipient_count: null, created_at: '2026-10-29T08:00:00Z', updated_at: '2026-10-29T08:00:00Z',
  queued_at: null, finished_at: null, send_from: 'news', status: 'draft',
}
const SENT = { ...base, id: '33333333-3333-4333-8333-333333333333', name: 'October newsletter', subject: 'October at Bredell Ferreira', body: 'x', status: 'sent', finished_at: '2026-10-01T08:30:00Z' }
const FOLLOW = { ...base, id: '77777777-7777-4777-8777-777777777777', name: 'October · follow-up 1', subject: 'Did you see our news?', body: `${MARKER}<p>Hi</p>`, status: 'sent', finished_at: '2026-10-21T08:30:00Z' }
const TEMPLATE = {
  id: '99999999-9999-4999-8999-999999999999', name: 'Nicole’s client newsletter', kind: 'news', subject: 'News from Nicole', preheader: 'This month', body: `${MARKER}<p>Dear {{first_name}},</p>{{signature}}`,
  image_url: null, send_from: 'liaison', sender_address_id: null, archived_at: null, created_by: ADMIN.id, created_at: '2026-10-29T08:00:00Z', updated_at: '2026-10-29T08:00:00Z',
}
const WORKFLOW = { id: '66666666-6666-4666-8666-666666666666', name: 'October and its reminder', first_campaign_id: SENT.id, status: 'finished', created_by: ADMIN.id, created_at: '2026-10-01T08:00:00Z', updated_at: '2026-10-21T08:00:00Z' }
const STEP = { id: '88888888-8888-4888-8888-888888888888', workflow_id: WORKFLOW.id, position: 1, campaign_id: FOLLOW.id, wait_days: 20, audience: 'not_opened', run_at: '2026-10-21T07:13:00Z' }
const sd = (campaign_id, email, o = {}) => ({ campaign_id, email, first_name: 'Anna', company_name: 'Smit & Seun', state: 'sent', sent_at: '2026-10-01T08:10:00Z',
  delivered_at: '2026-10-01T08:11:00Z', first_opened_at: null, first_clicked_at: null, unsubscribed_at: null, sender: 'news@bfnews.co.za', resend_id: 'r', ...o })
const SENDS = [
  sd(SENT.id, 'anna@smit.example', { first_opened_at: '2026-10-02T09:00:00Z' }), sd(SENT.id, 'ben@karoo.example'), sd(SENT.id, 'cara@solo.example', { state: 'bounced', delivered_at: null }),
  sd(FOLLOW.id, 'ben@karoo.example', { first_clicked_at: '2026-10-22T09:00:00Z', first_opened_at: '2026-10-22T08:59:00Z' }),
]

function world() {
  const state = { campaigns: [SENT, FOLLOW], senders: [], inserts: [], patches: [] }
  const handlers = [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rest\/v1\/marketing_campaigns/.test(u), (u, req) => {
      if (req.method() === 'POST') {
        const b = JSON.parse(req.postData() ?? '{}')
        const row = { ...base, subject: '', body: '', ...b, id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(state.campaigns.length).padStart(12, '0')}` }
        state.campaigns.unshift(row); state.inserts.push(['campaign', b])
        return { body: row }
      }
      if (req.method() === 'PATCH') { const b = JSON.parse(req.postData() ?? '{}'); state.patches.push(b); const m = /id=eq\.([0-9a-f-]+)/.exec(u); const c = state.campaigns.find((x) => x.id === m?.[1]); if (c) Object.assign(c, b); return { body: { id: m?.[1] } } }
      const m = /id=eq\.([0-9a-f-]+)/.exec(u)
      return { body: m ? state.campaigns.find((c) => c.id === m[1]) ?? null : state.campaigns }
    }],
    [(u) => /\/rpc\/marketing_campaign_results/.test(u), () => ({ body: [] })],
    [(u) => /\/rest\/v1\/marketing_sends/.test(u), (u) => { const m = /campaign_id=eq\.([0-9a-f-]+)/.exec(u); return { body: m ? SENDS.filter((s) => s.campaign_id === m[1]) : SENDS } }],
    [(u) => /\/rest\/v1\/marketing_senders/.test(u), (u, req) => {
      if (req.method() === 'POST') {
        const b = JSON.parse(req.postData() ?? '{}')
        const row = { id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(state.senders.length).padStart(12, '0')}`, active: true, created_at: '2026-10-29T08:00:00Z', domain_ready_at: null, signature_html: null, ...b }
        state.senders.push(row); state.inserts.push(['sender', b])
        return { body: row }
      }
      return { body: state.senders }
    }],
    [(u) => /\/rest\/v1\/marketing_templates/.test(u), () => ({ body: [TEMPLATE] })],
    [(u) => /\/rest\/v1\/marketing_workflows/.test(u), (u, req) => {
      if (req.method() === 'POST') { const b = JSON.parse(req.postData() ?? '{}'); state.inserts.push(['workflow', b]); return { body: { ...WORKFLOW, ...b, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'draft' } } }
      if (req.method() === 'PATCH') { state.patches.push(JSON.parse(req.postData() ?? '{}')); return { body: [] } }
      return { body: /id=eq\./.test(u) ? WORKFLOW : [WORKFLOW] }
    }],
    [(u) => /\/rest\/v1\/marketing_workflow_steps/.test(u), (u, req) => {
      if (req.method() === 'POST') { const b = JSON.parse(req.postData() ?? '{}'); state.inserts.push(['step', b]); return { body: { ...STEP, ...b, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', run_at: null } } }
      if (req.method() === 'PATCH') { state.patches.push(JSON.parse(req.postData() ?? '{}')); return { body: [] } }
      return { body: /campaign_id=eq\./.test(u) ? null : [STEP] }
    }],
    [(u) => /\/rest\/v1\/marketing_results_settings/.test(u), () => ({ body: { enabled: true, recipients: [], after_hours: 24 } })],
    [(u) => /\/rest\/v1\/(marketing_lists|marketing_preferences)/.test(u), () => ({ body: [] })],
    [(u) => /\/rest\/v1\/firm_settings/.test(u), () => ({ body: { id: true, firm_name: 'Bredell Ferreira', email_font: 'Georgia, serif', email_size_pt: 11 } })],
  ]
  return { state, handlers }
}

const CONFIG = {
  ready: true, missing: [], problem: null, from: 'Bredell Ferreira News <news@bfnews.co.za>', replyTo: 'reports@bredellferreira.co.za', webhook: true, keyProblem: null,
  prospect: { ready: false, missing: ['MARKETING_PROSPECT_DOMAIN'], problem: null, domain: null }, warmupCeiling: 500,
  firm: { ready: true, missing: [] }, schemaReady: true, readyDomains: [],
}
const PREVIEW = { kind: 'news', count: 94, firstApproaches: 0, excluded: {}, senders: [{ label: 'news@', address: 'news@bfnews.co.za', kind: 'news', count: 94 }],
  sample: [{ email: 'anna@smit.example', firstName: 'Anna', companyName: 'Smit & Seun', via: 'contact', firstApproach: false }] }

async function route(page, asked, state = null) {
  await page.route('**/api/email/marketing', async (r) => {
    const body = JSON.parse(r.request().postData() ?? '{}')
    asked.push(body)
    if (body.step === 'config') return r.fulfill({ json: CONFIG })
    if (body.step === 'preview') return r.fulfill({ json: PREVIEW })
    /* As the server does: queued is sending, and the first batch's clock is written. */
    if (body.step === 'queue' && state) {
      const c = state.campaigns.find((x) => x.id === body.campaignId)
      if (c) Object.assign(c, { status: 'sending', recipient_count: 94, next_batch_at: '2026-10-29T10:00:00Z' })
    }
    if (body.step === 'queue') return r.fulfill({ json: { queued: 94, sent: 30, failed: 0, skipped: 0, remaining: 64, stoppedFor: null, nextBatchAt: '2026-10-29T10:00:00Z' } })
    if (body.step === 'drain') return r.fulfill({ json: { sent: 0, failed: 0, skipped: 0, remaining: 64, stoppedFor: null, nextBatchAt: '2026-10-29T10:00:00Z' } })
    return r.fulfill({ status: 400, json: { error: 'fixture' } })
  })
}
async function open(page, path) {
  for (let i = 0; i < 60; i += 1) { try { await page.goto(`http://localhost:${PORT}${path}`, { timeout: 2000 }); return } catch { await new Promise((r) => setTimeout(r, 500)) } }
}

const server = await startServer()
let browser
try {
  browser = await chromium.launch()

  /* ------------------------- 1. Email addresses: the drop-down, the +, the guide ------------------------- */
  let newId = null
  {
    const { state, handlers } = world()
    const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
    await route(page, [])
    await open(page, '/news')
    await page.getByTestId('news-addresses').waitFor({ timeout: 20000 })
    await page.getByTestId('news-addresses').click()
    const menu = await page.getByTestId('news-addresses-menu').innerText()
    t.ok('the drop-down lists BF News, each liaison and reports@', /BF News[\s\S]*Each client’s liaison[\s\S]*Reports/.test(menu))
    await page.getByTestId('news-address-plus').click()
    await page.getByTestId('news-address-input').fill('me@gmail.com')
    t.ok('the + refuses a public mail service, and says why', /public mail service/.test(await page.getByTestId('news-address-problem').innerText()) && await page.getByTestId('news-address-save').isDisabled())
    await page.getByTestId('news-address-input').fill('ryno@bfmarketing.co.za')
    await page.getByTestId('news-address-name').fill('Ryno Buitendag')
    t.ok('...takes any address on a domain the firm owns, and says when its domain needs setting up',
      /bfmarketing\.co\.za is not set up for sending yet/.test(await page.getByTestId('news-address-needs-setup').innerText()))
    await t.shot(page, 'compose-addresses-add')
    await page.getByTestId('news-address-save').click()
    await page.getByTestId('news-address-panel').waitFor({ timeout: 5000 })
    t.check('...and saves it', JSON.stringify(state.inserts.find((x) => x[0] === 'sender')?.[1]), JSON.stringify({ address: 'ryno@bfmarketing.co.za', display_name: 'Ryno Buitendag' }))
    t.ok('the new address says its domain needs setting up', /Domain needs setting up/.test(await page.getByTestId('news-address-panel').innerText()))
    const guide = await page.getByTestId('news-domain-guide').innerText()
    t.ok('...with the steps: Resend, the DNS records, verify, and the key under its own name',
      /Add domain/.test(guide) && /DKIM/.test(guide) && /Verify/.test(guide) && /RESEND_KEY_BFMARKETING_CO_ZA/.test(guide))
    t.ok('...and the button to say it is done', await page.getByTestId('news-domain-verified').isEnabled())
    await t.shot(page, 'compose-domain-guide')

    await page.getByTestId('news-addresses').click()
    await page.getByTestId('news-address-option').filter({ hasText: 'BF News' }).click()
    await page.getByTestId('news-address-new').click()
    await page.getByTestId('news-editor').waitFor({ timeout: 10000 })
    const made = state.inserts.find((x) => x[0] === 'campaign')?.[1]
    t.check('"New email from this address" starts a draft from it', made?.send_from, 'news')
    newId = new URL(page.url()).pathname.split('/').pop()
    await context.close()
  }

  /* ------------------------- 2. the Outlook-style compose screen ------------------------- */
  {
    const { state, handlers } = world()
    const draft = { ...base, id: '11111111-1111-4111-8111-111111111111', name: 'November newsletter', subject: '', body: '' }
    state.campaigns.unshift(draft)
    const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
    const asked = []
    await route(page, asked, state)
    await open(page, `/news/${draft.id}`)
    await page.getByTestId('news-step-write').waitFor({ timeout: 20000 })
    await page.getByTestId('news-step-write').click()
    await page.getByTestId('news-rich').waitFor({ timeout: 5000 })
    t.ok('a new email is written in the full editor, under a ribbon', await page.getByTestId('news-rich-ribbon').isVisible())
    t.ok('...with Outlook\'s three tabs', await page.getByTestId('news-rich-tab-message').isVisible() && await page.getByTestId('news-rich-tab-insert').isVisible() && await page.getByTestId('news-rich-tab-format').isVisible())
    t.check('...From shown above the words, as Outlook does', await page.getByTestId('news-compose-from').innerText(), 'Bredell Ferreira News <news@bfnews.co.za>')
    await page.getByTestId('news-subject').fill('Our client portal is live')
    const body = page.getByTestId('news-rich-body')
    await body.click()
    await page.keyboard.type('Dear ')
    await page.getByTestId('news-rich-tab-insert').click()
    await page.getByTestId('news-rich-field-first_name').click()
    await page.keyboard.type(', the portal is here.')
    await page.keyboard.press('Enter')
    await page.getByTestId('news-rich-field-signature').click()
    await page.getByTestId('news-rich-tab-message').click()
    await body.evaluate((el) => { el.focus(); const r = document.createRange(); r.selectNodeContents(el.firstChild ?? el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r) })
    await page.getByRole('button', { name: 'Bold' }).click()
    /* Something hostile, as a paste from somewhere would bring it. */
    await body.evaluate((el) => { el.insertAdjacentHTML('beforeend', '<p onclick="alert(1)">Click<script>alert(2)</script></p>'); el.dispatchEvent(new Event('input', { bubbles: true })) })
    await t.shot(page, 'compose-outlook')
    await page.setViewportSize({ width: 820, height: 1180 })
    await t.shot(page, 'compose-outlook-ipad')
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByTestId('news-save').click()
    for (let i = 0; i < 30 && !state.patches.some((p) => typeof p.body === 'string' && p.body.includes('portal')); i += 1) await page.waitForTimeout(100)
    const saved = state.patches.filter((p) => typeof p.body === 'string').at(-1)?.body ?? ''
    t.ok('what is saved is HTML, marked as such', saved.startsWith(MARKER))
    t.ok('...with the fields and the bold kept', /\{\{first_name\}\}/.test(saved) && /\{\{signature\}\}/.test(saved) && /<b>|font-weight/.test(saved))
    t.ok('...and nothing outside the closed set', !/onclick|<script|alert/.test(saved) && /Click/.test(saved))
    await page.getByTestId('news-step-check').click()
    const frame = page.frameLocator('[data-testid="news-preview"]')
    await frame.locator('body').waitFor({ timeout: 5000 })
    t.ok('the preview merges the name', /Dear Anna|Dear Test/.test(await frame.locator('body').innerText()))

    /* ------------------------- 3. the pop-up: batches and a follow-up ------------------------- */
    await page.getByTestId('news-check').click()
    await page.getByTestId('news-preview-list').waitFor({ timeout: 5000 })
    await page.getByTestId('news-step-send').click()
    await page.getByTestId('news-send').click()
    await page.getByTestId('news-send-modal').waitFor({ timeout: 5000 })
    await page.getByTestId('news-send-batches').check()
    await page.getByTestId('news-batch-size').fill('30')
    await page.getByTestId('news-batch-every').selectOption('60')
    t.ok('batches of 30 every hour: four, the last about three hours after the first',
      /4 batches\. The last goes about 3 hours after the first/.test(await page.getByTestId('news-batch-estimate').innerText()))
    await page.getByTestId('news-followup-add').click()
    await page.getByTestId('news-followup-wait').fill('20')
    await page.getByTestId('news-followup-template').selectOption(TEMPLATE.id)
    await t.shot(page, 'compose-send-popup')
    await page.getByTestId('news-send-confirm').click()
    for (let i = 0; i < 50 && !state.inserts.some((x) => x[0] === 'step'); i += 1) await page.waitForTimeout(100)
    const batchPatch = state.patches.findLast((p) => 'batch_size' in p)
    t.check('the batches are saved on the campaign before it goes', JSON.stringify([batchPatch?.batch_size, batchPatch?.batch_every_minutes]), JSON.stringify([30, 60]))
    t.ok('...then it is queued', asked.some((b) => b.step === 'queue'))
    t.check('the follow-up becomes a workflow starting with this campaign', state.inserts.find((x) => x[0] === 'workflow')?.[1]?.first_campaign_id, draft.id)
    t.ok('...with its step, 20 days, to those who did not open', state.patches.some((p) => p.wait_days === 20 && p.audience === 'not_opened'))
    t.ok('...filled from the template', state.patches.some((p) => p.template_id === TEMPLATE.id && p.subject === 'News from Nicole'))
    t.ok('...and started, every follow-up having its words', state.patches.some((p) => p.status === 'active'))
    await page.getByTestId('news-next-batch').waitFor({ timeout: 5000 })
    t.ok('the results say when the next batch goes', /Sending in batches of 30, every hour\. The next batch goes at/.test(await page.getByTestId('news-next-batch').innerText()))
    await context.close()
  }

  /* ------------------------- 4. templates, and the sheet ------------------------- */
  {
    const { state, handlers } = world()
    const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
    await route(page, [])
    await open(page, '/news?tab=templates')
    await page.getByTestId('news-template').waitFor({ timeout: 20000 })
    t.ok('a template says who it is sent from', /Nicole’s client newsletter[\s\S]*from Each client’s liaison/.test(await page.getByTestId('news-template').innerText()))
    await t.shot(page, 'compose-templates')
    await page.getByTestId('news-template-use').click()
    await page.getByTestId('news-editor').waitFor({ timeout: 10000 })
    const made = state.inserts.find((x) => x[0] === 'campaign')?.[1]
    t.check('"Use it" starts a campaign with its words, its sender, and which template', JSON.stringify([made?.subject, made?.send_from, made?.template_id]),
      JSON.stringify(['News from Nicole', 'liaison', TEMPLATE.id]))

    await open(page, '/news?tab=workflows')
    await page.getByTestId('news-workflow-sheet').waitFor({ timeout: 20000 })
    await page.getByTestId('news-workflow-sheet').click()
    await page.getByTestId('news-sheet').waitFor({ timeout: 10000 })
    const sheet = await page.getByTestId('news-sheet').innerText()
    t.ok('the sheet: email, then Sent 1 and Sent 2', /Email\s+Sent 1\s+Sent 2/.test(sheet))
    t.ok('...Anna opened the first and was not followed up; Ben clicked the second; Cara\'s did not arrive',
      /anna@smit\.example[\s\S]*Opened/.test(sheet) && /ben@karoo\.example[\s\S]*Delivered[\s\S]*Clicked/.test(sheet) && /cara@solo\.example[\s\S]*Didn’t arrive/.test(sheet))
    t.ok('...and it downloads as Excel', await page.getByTestId('news-sheet-download').isEnabled())
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.getByTestId('news-sheet-download').click()])
    t.ok('...a real .xlsx', download.suggestedFilename().endsWith('.xlsx'))
    await t.shot(page, 'compose-sheet')
    await context.close()
  }
  t.ok('(the new-email draft opened at its own address)', !!newId)
} finally {
  if (browser) await browser.close()
  stopServer(server)
}
process.exit(t.finish('Email addresses and the +, the domain guide, the Outlook-style compose, templates, batches and follow-ups, the Sent sheet.') ? 0 : 1)
