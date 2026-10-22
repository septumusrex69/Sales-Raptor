/**
 * RECOVERY, TRACE AND RESULTS, IN A REAL BROWSER (S10, 22 Oct).
 *
 * check-campaign-recovery holds the rules; this holds the screens that reach them.
 *
 *   1. The call box offers Recovery beside Calls and Trace. Recovery asks for write-off reasons --
 *      Raptor's closed list by name with a count each, the imported free text as stored -- and for
 *      the collectors who work it, and offers NO tick to include withdrawn accounts. The preview is
 *      asked for exactly the reasons and people chosen, and says the accounts stay closed.
 *   2. A Trace campaign on live accounts asks who traces, and its preview says what the searches
 *      would cost the debtors.
 *   3. Campaign results are in the menu of a collector (a Pre-legal Agent, who cannot run one): PTPs
 *      made, accounts won back, the trace funnel -- and no fee anywhere.
 *   4. A collector holding a recovery call on a closed account sees "Debtor agreed to pay", is asked
 *      to confirm, and the press calls recovery_reopen for that account. The promise form is not
 *      offered on the closed account before it.
 *
 * Run: node scripts/qa/e2e/campaign-recovery.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, TEAM, TEAM_ID, USER_ID, accountsPage } from './fixtures.mjs'

const t = makeRunner('campaign-recovery')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }
const AGENT = { ...PROFILE, name: 'Itumeleng', role: 'Pre-legal Agent' }
const THABO = { ...PROFILE, id: 'agent-2', name: 'Thabo', email: 'thabo@raptor.test', role: 'Pre-legal Agent', team_id: TEAM_ID }
const CLOSED = accountsPage(3).map((r) => ({
  ...r, status: 'Written-off', book: 'closed', ended_as: 'written_off', ended_reason: 'Uncontactable', assigned_to: null,
}))

const PREVIEW = {
  ok: true, kind: 'recovery', badCollectors: 0, traceEstimate: null,
  selected: 1, found: 1, outOfScope: 0, placing: 1, unplaced: 0, skipped: 0, skips: [],
  collectors: [{ name: 'Thabo', calls: 1, unplaced: 0, over: 0 }], overCollectors: 0,
  today: '2026-11-02', endsOn: '2026-11-06', dateProblem: null,
}

function handlers(profile, extra = []) {
  return [
    ...extra,
    [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: profile.email } })],
    [(u) => /\/rest\/v1\/profiles/.test(u), (u) => {
      const one = /id=eq\.([0-9a-z-]+)/.exec(u)?.[1]
      return { body: one ? [profile, THABO].filter((p) => p.id === one) : [profile, THABO] }
    }],
    [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [COMPANY] })],
    [(u) => /\/rest\/v1\/teams/.test(u), () => ({ body: [TEAM] })],
    [(u) => /\/rpc\/nav_counts/.test(u), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
    [(u) => /\/rpc\/recovery_reasons/.test(u), () => ({
      body: [
        { reason_key: 'imported:refusal to pay', source: 'imported', label: 'Refusal to pay', accounts: 2 },
        { reason_key: 'raptor:uncontactable', source: 'raptor', label: 'Uncontactable', accounts: 1 },
        { reason_key: 'none', source: 'none', label: 'No reason recorded', accounts: 1 },
      ],
    })],
    [(u) => /\/rest\/v1\/message_templates/.test(u), () => ({ body: [] })],
    [(u) => /\/rest\/v1\/debtor_accounts/.test(u), () => ({
      body: CLOSED, headers: { 'content-range': `0-${CLOSED.length - 1}/${CLOSED.length}` },
    })],
  ]
}

const calls = []
async function stubApi(page, preview = PREVIEW) {
  await page.route('**/api/workflow/campaign', async (route) => {
    const body = route.request().postDataJSON() ?? {}
    calls.push(body)
    const reply = body.op === 'call-preview' ? preview
      : body.op === 'call-create' ? { ok: true, campaignId: 'camp-rec', placing: 1, skipped: 0, unplaced: 0 }
        : { ok: true }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) })
  })
}

async function go(page, path) {
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}${path}`, { timeout: 2000 }); return true }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  return false
}

async function openCallBox(page) {
  await go(page, '/accounts?book=closed')
  const box = page.locator('table tbody input[type="checkbox"]').first()
  await box.waitFor({ timeout: 20000 })
    .catch(async (e) => { await page.screenshot({ path: `${OUT}/campaign-recovery-fail.png`, fullPage: true }); throw e })
  await box.check()
  await page.getByTestId('bulk-campaign').click()
  await page.getByTestId('campaign-compose').waitFor({ timeout: 5000 })
  await page.getByTestId('campaign-channel-call').click()
  await page.getByTestId('call-campaign-compose').waitFor({ timeout: 5000 })
}

const server = await startServer()
const browser = await chromium.launch()
try {
  /* -------------------------------------------- 1. recovery in the call box */
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers(ADMIN), [])
    await stubApi(page)
    await openCallBox(page)
    t.ok('the call box offers Recovery', await page.getByTestId('call-kind-recovery').isVisible())
    await page.getByTestId('call-kind-recovery').click()
    await page.getByTestId('recovery-reasons').waitFor({ timeout: 5000 })
    const reasons = (await page.getByTestId('recovery-reasons').innerText()).replace(/\s+/g, ' ')
    t.ok('Raptor\'s own reasons by name, with a count', /Uncontactable 1/.test(reasons) && /Cannot pay 0/.test(reasons))
    t.ok('...the imported text as stored, with its count', /Imported from Swordfish/i.test(reasons) && /Refusal to pay 2/.test(reasons))
    t.ok('...and "No reason recorded"', /No reason recorded 1/.test(reasons))
    t.ok('NO tick to include withdrawn accounts', !/withdrawn/i.test(await page.getByTestId('recovery-reasons').innerText())
      && await page.getByText(/include accounts the client withdrew/i).count() === 0)
    t.ok('...and it says withdrawn and paid-up accounts are never included',
      /Withdrawn, paid-up and settled accounts are never included/.test(await page.getByTestId('recovery-words').innerText()))
    await page.locator('[data-testid="recovery-reason"][data-key="raptor:uncontactable"]').check()
    await page.locator('[data-testid="recovery-reason"][data-key="imported:refusal to pay"]').check()
    t.ok('it asks which collectors work it', await page.getByTestId('campaign-collectors').isVisible())
    await page.getByTestId('campaign-collector').filter({ hasText: 'Thabo' }).click()
    await page.getByTestId('call-ends-on').fill('2026-11-06')
    await page.getByTestId('call-script').fill('Offer 40% to settle.')
    await page.getByTestId('call-name').fill('Written-off push')
    await page.getByTestId('call-preview-go').click()
    await page.getByTestId('call-campaign-preview').waitFor({ timeout: 5000 })
    const pv = calls.find((c) => c.op === 'call-preview')
    t.ok('the preview is asked for a recovery campaign', pv?.kind === 'recovery')
    t.ok('...with exactly the reasons chosen', JSON.stringify([...(pv?.reasons ?? [])].sort()) === JSON.stringify(['imported:refusal to pay', 'raptor:uncontactable']))
    t.ok('...and the collector chosen', JSON.stringify(pv?.collectorIds) === JSON.stringify(['agent-2']))
    t.ok('the confirm words say the accounts stay closed', /stay closed and where they are/.test(await page.getByTestId('call-confirm-words').innerText()))
    await t.shot(page, 'recovery-preview')
    await context.close()
  }

  /* -------------------------------------------- 2. trace */
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers(ADMIN), [])
    await stubApi(page, { ...PREVIEW, kind: 'trace', traceEstimate: { item: '4c', perSearch: 16, total: 16, citation: 'Annexure B 2026' } })
    await openCallBox(page)
    await page.getByTestId('call-kind-trace').click()
    t.ok('a trace asks which accounts', await page.getByTestId('trace-target-live').isVisible())
    t.ok('...and who traces', await page.getByTestId('campaign-collectors').isVisible())
    await page.getByTestId('campaign-collector').filter({ hasText: 'Thabo' }).click()
    await page.getByTestId('call-mode-now').click()
    await page.getByTestId('call-script').fill('A working cell number.')
    await page.getByTestId('call-name').fill('Trace push')
    await page.getByTestId('call-preview-go').click()
    await page.getByTestId('call-campaign-preview').waitFor({ timeout: 5000 })
    t.ok('the trace preview says what the searches would cost', /item 4\(c\)/.test(await page.getByTestId('trace-estimate').innerText()))
    t.ok('...asked for a live trace', calls.filter((c) => c.op === 'call-preview').at(-1)?.traceTarget === 'live')
    await context.close()
  }

  /* -------------------------------------------- 3. results, for a collector */
  {
    const results = [
      { campaign_id: 'c1', name: 'Month-end push', channel: 'call', call_kind: 'work', call_mode: 'spread', status: 'sending', created_by_name: 'Stephan', created_at: '2026-11-02T08:00:00Z', starts_on: '2026-11-02', ends_on: '2026-11-06', selected: 10, skipped: 1, sent: 0, failed: 0, worked: 6, waiting: 3, missed: 1, unplaced: 0, ptps: 2, ptp_amount: '4500.00', reopened: 0 },
      { campaign_id: 'c2', name: 'Written-off push', channel: 'call', call_kind: 'recovery', call_mode: 'now', status: 'finished', created_by_name: 'Stephan', created_at: '2026-11-01T08:00:00Z', starts_on: '2026-11-01', ends_on: '2026-11-01', selected: 5, skipped: 0, sent: 0, failed: 0, worked: 4, waiting: 0, missed: 1, unplaced: 0, ptps: 1, ptp_amount: '1200', reopened: 1 },
      { campaign_id: 'c3', name: 'Trace push', channel: 'call', call_kind: 'trace', call_mode: 'now', status: 'sending', created_by_name: 'Stephan', created_at: '2026-10-30T08:00:00Z', starts_on: '2026-10-30', ends_on: '2026-10-30', selected: 2, skipped: 0, sent: 0, failed: 0, worked: 1, waiting: 1, missed: 0, unplaced: 0, ptps: 0, ptp_amount: '0', reopened: 0 },
      { campaign_id: 'c4', name: 'Reminder SMS', channel: 'sms', call_kind: null, call_mode: null, status: 'finished', created_by_name: 'Stephan', created_at: '2026-10-29T08:00:00Z', starts_on: '2026-10-29', ends_on: null, selected: 20, skipped: 2, sent: 17, failed: 1, worked: 0, waiting: 0, missed: 0, unplaced: 0, ptps: 0, ptp_amount: '0', reopened: 0 },
    ]
    const funnel = [
      { account_id: 'acc-0001', case_number: 'RAP-1', debtor: 'A B', referred_at: '2026-10-30T08:00:00Z', searched_at: '2026-10-30T09:00:00Z', details_at: '2026-10-30T10:00:00Z', contact_at: '2026-10-31T10:00:00Z', promised_at: '2026-10-31T10:05:00Z', promised: '900', paid: '300' },
      { account_id: 'acc-0002', case_number: 'RAP-2', debtor: 'C D', referred_at: '2026-10-30T08:00:00Z', searched_at: null, details_at: null, contact_at: null, promised_at: null, promised: null, paid: null },
    ]
    const { context, page } = await signedInPage(browser, AGENT, handlers(AGENT, [
      [(u) => /\/rpc\/campaign_results_by_collector/.test(u), () => ({ body: [{ owner_id: USER_ID, owner_name: 'Itumeleng', worked: 6, waiting: 3, missed: 1, ptps: 2, ptp_amount: '4500', reopened: 0 }] })],
      [(u) => /\/rpc\/campaign_results/.test(u), () => ({ body: results })],
      [(u) => /\/rpc\/trace_campaign_funnel/.test(u), () => ({ body: funnel })],
    ]), [])
    await go(page, '/')
    const link = page.locator('a[href="/reports"]').first()
    await link.waitFor({ timeout: 20000 }).catch(() => {})
    t.ok('a Pre-legal Agent has Reports in the menu, where campaign results now live', await link.count() > 0)
    /* The old address, which lands on the Reports tab. */
    await go(page, '/campaigns/results')
    await page.getByTestId('result-row').first().waitFor({ timeout: 20000 })
      .catch(async (e) => { await page.screenshot({ path: `${OUT}/campaign-results-fail.png`, fullPage: true }); throw e })
    const text = (await page.getByTestId('campaign-results').innerText()).replace(/\s+/g, ' ')
    t.ok('...and sees PTPs made on a call campaign', /2 PTPs made/.test(text))
    t.ok('...the accounts a recovery won back', /1 won back/.test(text))
    t.ok('...every kind, in the firm\'s words', /Recovery calls/.test(text) && /Trace/.test(text) && /SMS/.test(text))
    t.ok('...an SMS campaign\'s outcome', /17 sent · 2 skipped · 1 failed/.test(text))
    t.ok('...and NO fee anywhere', !/fee/i.test(text))
    const f = (await page.getByTestId('trace-funnel').innerText()).replace(/\s+/g, ' ')
    t.ok('the trace funnel: sent, details, contact, PTP, paid', /Sent to trace 2/i.test(f) && /New details 1/i.test(f) && /Contact made 1/i.test(f) && /PTP made 1/i.test(f) && /Paid 1/i.test(f))
    await page.getByRole('button', { name: 'By collector' }).first().click()
    await page.getByTestId('result-by-collector').waitFor({ timeout: 5000 })
    t.ok('by collector, with their PTPs', /Itumeleng — 6 worked · 3 waiting · 1 missed · 2 PTPs/.test(await page.getByTestId('result-by-collector').innerText()))
    await t.shot(page, 'campaign-results')
    await context.close()
  }

  /* -------------------------------------------- 4. the press that wins it back */
  {
    const account = { ...CLOSED[0], id: 'acc-0000', assigned_to: null }
    const rpc = []
    const { context, page } = await signedInPage(browser, AGENT, [
      [(u, req) => /\/rpc\/recovery_reopen/.test(u), (u, req) => { rpc.push(JSON.parse(req.postData() ?? '{}')); return { body: 'c2' } }],
      [(u) => u.includes('/rest/v1/diary_entries') && u.includes('campaigns%21diary_entries_campaign_id_fkey') && u.includes('owner_id=eq.'), () => ({
        body: { id: 'de-rec', campaigns: { name: 'Written-off push', call_kind: 'recovery', status: 'sending' } },
      })],
      [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [account], headers: { 'content-range': '0-0/1' } })],
      ...handlers(AGENT),
    ], [])
    t.ok('the closed account opens', await go(page, `/accounts/${account.id}`))
    await page.getByTestId('recovery-reopen').waitFor({ timeout: 20000 })
      .catch(async (e) => { await page.screenshot({ path: `${OUT}/recovery-reopen-fail.png`, fullPage: true }); throw e })
    t.ok('a recovery call offers "Debtor agreed to pay"', /Debtor agreed to pay/.test(await page.getByTestId('recovery-reopen-go').innerText()))
    t.ok('no promise form is offered on the closed account', await page.getByTestId('promise-closed').count() > 0)
    await page.getByTestId('recovery-reopen-go').click()
    t.ok('the first press only asks', rpc.length === 0 && await page.getByTestId('recovery-reopen-confirm').isVisible().catch(() => false))
    await t.shot(page, 'recovery-reopen-ask')
    await page.getByTestId('recovery-reopen-confirm').click({ timeout: 3000 }).catch(() => {})
    await page.getByTestId('recovery-reopened').waitFor({ timeout: 5000 }).catch(() => {})
    t.ok('the second calls recovery_reopen for this account', rpc.length === 1 && rpc[0]?.p_account === account.id)
    t.ok('...and says to take the promise now', /Take the promise now/.test(await page.getByTestId('recovery-reopened').innerText().catch(() => '')))
    await context.close()
  }
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish(
  `Recovery, trace and results (S10, 22 Oct): the call box offers Recovery with write-off reasons by name and
count and no withdrawn tick, and asks who works it; a trace preview prices the searches; a Pre-legal Agent
reads Campaign results -- PTPs made, accounts won back, the trace funnel, no fee; a recovery call's
"Debtor agreed to pay" asks, then calls recovery_reopen for that account.`)
process.exit(good ? 0 : 1)
