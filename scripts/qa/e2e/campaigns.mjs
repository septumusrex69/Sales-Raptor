/**
 * DEBTOR CAMPAIGNS, IN A REAL BROWSER (S10, 21 Oct).
 *
 * check-campaigns holds the rules; this holds the screen that reaches them -- the failure CLAUDE.md
 * names for this layer is a panel provably in the bundle and invisible on the page.
 *
 * WHAT THIS HOLDS:
 *   1. Ticking a row on the Accounts list offers Campaign; the box takes a library SMS, and the
 *      preview it asks the server for names exactly the ticked account.
 *   2. The preview draws the server's answer: will send, skipped and why, one real message, the fee.
 *   3. The confirm step reads the numbers back in words, and Start sends the name and the selection,
 *      then lands on Campaigns, where the page pushes the campaign on and Stop stops it.
 *   4. A preview with accounts outside the leader's team refuses to continue, saying why.
 *   5. A collector -- no tick -- is never offered it.
 *
 * Every request is answered here: Supabase by the harness's stub, /api/workflow/campaign by a
 * route below. Nothing is sent anywhere.
 *
 * Run: node scripts/qa/e2e/campaigns.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, accountsPage } from './fixtures.mjs'

const t = makeRunner('campaigns')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }
const AGENT = { ...PROFILE, name: 'Itumeleng', role: 'Pre-legal Agent' }
const ROWS = accountsPage(3).map((r) => ({ ...r, status: 'Active: Activated', book: 'active' }))
const TEMPLATE = {
  id: 'tpl-sms-1', scope: 'collections', kind: 'sms', name: 'October reminder', subject: null,
  body: 'Dear {{debtor_name}}, your account {{case_number}} is in arrears. Please call us.',
  position: null, language: 'en', active: true, attachment_id: null, audience: null, format: 'text',
  seed_key: null, updated_at: '2026-10-01T00:00:00Z',
}

const PREVIEW = {
  ok: true, selected: 1, found: 1, outOfScope: 0, sending: 1, skipped: 0,
  skips: [],
  sample: {
    accountId: ROWS[0].id, caseNumber: 'RAP-100001', debtor: 'A Mokoena',
    text: 'Dear A Mokoena, your account RAP-100001 is in arrears. Please call us.',
    subject: null, html: null, segments: 1, encoding: 'GSM-7', missing: [],
  },
  estimate: { item: '1c', perMessage: 3.5, total: 3.5, citation: 'GN R.7207, GG 54273, 6 March 2026', monthlyLimit: null },
  estimateWords: 'R 3,50', atMonthlyLimit: 0, mailbox: null, hoursProblem: null, wordingProblem: null,
  sendFrom: 'me', target: 'live', fromSplit: [], central: null, writtenOffUncharged: false,
}

const CAMPAIGN = {
  id: 'camp-1', name: 'October reminder', channel: 'sms', status: 'sending', created_at: '2026-10-21T08:00:00Z',
  created_by: ADMIN.id, created_by_name: 'Stephan', team_id: null, selected: 1, to_send: 1, fee_estimate: '3.50', note: null,
}

function handlers(profile) {
  return [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [profile] })],
    [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [COMPANY] })],
    [(u) => /\/rest\/v1\/debtor_accounts/.test(u), () => ({
      body: ROWS, headers: { 'content-range': `0-${ROWS.length - 1}/${ROWS.length}` },
    })],
    [(u) => /\/rest\/v1\/message_templates/.test(u), () => ({ body: [TEMPLATE] })],
    [(u) => /\/rest\/v1\/campaigns/.test(u), () => ({ body: [CAMPAIGN] })],
    [(u) => /\/rpc\/recovery_reasons/.test(u), () => ({
      body: [{ reason_key: 'raptor:uncontactable', source: 'raptor', label: 'Uncontactable', accounts: 1 }],
    })],
    [(u) => /\/rpc\/campaign_counts/.test(u), () => ({
      body: [{ campaign_id: 'camp-1', pending: 1, sending: 0, sent: 0, skipped: 0, failed: 0, cancelled: 0, fees: 0 }],
    })],
  ]
}

/** The campaign route, answered here and recorded. `preview` is replaceable per test. */
const calls = []
async function stubApi(page, preview = PREVIEW) {
  await page.route('**/api/workflow/campaign', async (route) => {
    const body = route.request().postDataJSON() ?? {}
    calls.push(body)
    const reply = body.op === 'preview' ? preview
      : body.op === 'create' ? { ok: true, campaignId: 'camp-1', sending: 1, skipped: 0 }
        : body.op === 'send' ? { ok: true, outsideHours: null, sent: 1, skipped: 0, failed: 0, returned: 0, campaigns: [] }
          : { ok: true, cancelled: 1 }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) })
  })
}

async function go(page, path) {
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}${path}`, { timeout: 2000 }); return }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
}

async function openCampaignBox(page) {
  await go(page, '/accounts?book=active')
  const box = page.locator('table tbody input[type="checkbox"]').first()
  await box.waitFor({ timeout: 20000 })
    .catch(async (e) => { await page.screenshot({ path: `${OUT}/campaigns-fail.png`, fullPage: true }); throw e })
  await box.check()
  await page.getByTestId('bulk-campaign').click()
  await page.getByTestId('campaign-compose').waitFor({ timeout: 5000 })
}

const server = await startServer()
const browser = await chromium.launch()
try {
  /* -------------------------------------------- 1-3. an Administrator runs one end to end */
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers(ADMIN), [])
    await stubApi(page)
    await openCampaignBox(page)
    t.ok('the Campaigns link is on the list', await page.getByTestId('campaigns-link').count() === 1)

    await page.getByTestId('campaign-template').selectOption(TEMPLATE.id)
    t.check('choosing library wording fills the message', await page.getByTestId('campaign-body').inputValue(), TEMPLATE.body)
    t.check('...and names the campaign after it', await page.getByTestId('campaign-name').inputValue(), 'October reminder')
    await page.getByTestId('campaign-preview-go').click()
    await page.getByTestId('campaign-preview').waitFor({ timeout: 5000 })
    const preview = calls.find((c) => c.op === 'preview')
    t.ok('the preview asks about exactly the ticked account', JSON.stringify(preview?.accountIds) === JSON.stringify([ROWS[0].id]))
    t.ok('...with the channel, the wording and where it came from',
      preview?.channel === 'sms' && preview?.body === TEMPLATE.body && preview?.templateId === TEMPLATE.id)

    t.check('the preview says how many will go', (await page.getByTestId('campaign-will-send').innerText()).trim(), '1')
    t.ok('...shows one real account’s message', /Dear A Mokoena, your account RAP-100001/.test(await page.getByTestId('campaign-sample').innerText()))
    t.ok('...with its segments', /1 segment · GSM-7/.test(await page.getByTestId('campaign-sample').innerText()))
    const fee = (await page.getByTestId('campaign-fee').innerText()).replace(/\s/g, ' ')
    t.ok('...and the fee: count x tariff under item 1(c)', /About R[\s,]?3[.,]50.*1 × R[\s,]?3[.,]50 under Annexure B item 1\(c\)/.test(fee))
    await t.shot(page, 'campaigns-preview')

    await page.getByTestId('campaign-continue').click()
    const words = await page.getByTestId('campaign-confirm-words').innerText()
    t.ok('the confirm step reads it back in words',
      /Campaign “October reminder” will send one SMS to 1 debtor\./.test(words) && /item 1\(c\)/.test(words))
    await page.getByTestId('campaign-start').click()
    await page.waitForURL(/\/accounts\/campaigns\?c=camp-1/, { timeout: 5000 })
    const create = calls.find((c) => c.op === 'create')
    t.ok('Start sends the name, the accounts and what was selected',
      create?.name === 'October reminder' && JSON.stringify(create?.accountIds) === JSON.stringify([ROWS[0].id])
      && create?.selection?.kind === 'ids')

    await page.getByTestId('campaign-row').first().waitFor({ timeout: 10000 })
    t.ok('the campaign is listed with its progress', /0 sent · 0 skipped · 0 failed · 1 still to go/.test(
      (await page.getByTestId('campaign-counts').first().innerText()).replace(/\s+/g, ' ')))
    await page.waitForTimeout(800)
    t.ok('the open page pushes it on', calls.some((c) => c.op === 'send' && c.campaignId === 'camp-1'))
    await page.getByTestId('campaign-stop').click()
    await page.waitForTimeout(400)
    t.ok('Stop stops it', calls.some((c) => c.op === 'stop' && c.campaignId === 'camp-1'))
    await t.shot(page, 'campaigns-page')
    await context.close()
  }

  /* ------------------- 3b. Raptor H12: an email to written-off accounts, from the central mailbox */
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers(ADMIN), [])
    await stubApi(page, { ...PREVIEW, sendFrom: 'central', target: 'written_off', writtenOffUncharged: true,
      sample: { ...PREVIEW.sample, subject: 'Your account', html: '<p>Dear A Mokoena</p>', segments: null, encoding: null },
      estimate: { ...PREVIEW.estimate, item: '1a', perMessage: 25, total: 25 },
      central: { name: 'Bredell Ferreira Legal', address: 'legal@bredellferreira.co.za' },
      fromSplit: [{ name: 'Bredell Ferreira Legal', address: 'legal@bredellferreira.co.za', count: 1, central: true }] })
    await openCampaignBox(page)
    t.ok('the box asks which accounts: live or written off', (await page.getByTestId('campaign-target').count()) === 1)
    t.check('...and "who it comes from" is for an email only', await page.getByTestId('campaign-send-from').count(), 0)
    await page.getByTestId('campaign-channel-email').click()
    await page.getByTestId('campaign-target-written_off').click()
    await page.locator('[data-testid="recovery-reason"][data-key="raptor:uncontactable"]').waitFor({ timeout: 5000 })
    t.ok('written off asks for the write-off reasons first', await page.getByTestId('campaign-preview-go').isDisabled()
      || !(await page.getByTestId('campaign-name').inputValue()))
    await page.locator('[data-testid="recovery-reason"][data-key="raptor:uncontactable"]').check()
    await page.getByTestId('campaign-from-central').click()
    await page.getByTestId('campaign-subject').fill('Your account')
    await page.getByTestId('campaign-body').fill('Dear {{debtor_name}}, please contact us.')
    await page.getByTestId('campaign-name').fill('Written-off October')
    calls.length = 0
    await page.getByTestId('campaign-preview-go').click()
    await page.getByTestId('campaign-preview').waitFor({ timeout: 5000 })
    const asked = calls.find((c) => c.op === 'preview')
    t.check('the preview asks for written-off accounts, by reason, from the central mailbox',
      JSON.stringify([asked?.target, asked?.reasons, asked?.sendFrom]), JSON.stringify(['written_off', ['raptor:uncontactable'], 'central']))
    t.ok('...shows who it goes out from', /1 from Bredell Ferreira Legal <legal@bredellferreira\.co\.za> — the central mailbox/.test(await page.getByTestId('campaign-from-split').innerText()))
    t.ok('...and says a written-off account is charged nothing today', /No fee today/.test(await page.getByTestId('campaign-fee').innerText()))
    await t.shot(page, 'campaigns-written-off')
    await page.getByTestId('campaign-continue').click()
    t.ok('the confirm step names the mailbox and says nothing is charged',
      /from legal@bredellferreira\.co\.za\./.test(await page.getByTestId('campaign-confirm-words').innerText())
      && /Nothing is charged/.test(await page.getByTestId('campaign-confirm-words').innerText()))
    await context.close()
  }

  /* -------------------------------------------- 4. outside the leader's team: refused */
  {
    const LEADER = { ...PROFILE, name: 'Thabo', role: 'Pre-legal Team Leader' }
    const { context, page } = await signedInPage(browser, LEADER, handlers(LEADER), [])
    await stubApi(page, { ...PREVIEW, outOfScope: 1, sending: 0 })
    await openCampaignBox(page)
    await page.getByTestId('campaign-body').fill('Dear {{debtor_name}}, please call us.')
    await page.getByTestId('campaign-name').fill('Thabo’s test')
    await page.getByTestId('campaign-preview-go').click()
    await page.getByTestId('campaign-blocker').waitFor({ timeout: 5000 })
    t.ok('an account on another team’s desk is named as the reason',
      /not on your team’s desks/.test(await page.getByTestId('campaign-blocker').innerText()))
    t.ok('...and the campaign cannot go on', await page.getByTestId('campaign-continue').isDisabled())
    await context.close()
  }

  /* -------------------------------------------- 5. a collector is never offered it */
  {
    const { context, page } = await signedInPage(browser, AGENT, handlers(AGENT), [])
    await go(page, '/accounts?book=active')
    await page.locator('table tbody tr').first().waitFor({ timeout: 20000 })
    /* As a string: the runner compares with Object.is, which two arrays never pass. */
    t.check('no tick boxes, no Campaign, no link for a collector',
      JSON.stringify([await page.locator('table tbody input[type="checkbox"]').count(), await page.getByTestId('campaigns-link').count()]), '[0,0]')
    await context.close()
  }
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish(
  `Debtor campaigns (S10): from a ticked row on the Accounts list the box takes library wording, previews
exactly the ticked account through the server, draws the count, one real message and the fee, reads it
back in words, starts it, and the Campaigns page pushes it on and stops it. A team leader whose selection
reaches another team's desk is refused; a collector is never offered it.`)
process.exit(good ? 0 : 1)
