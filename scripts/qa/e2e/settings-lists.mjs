/**
 * THE SETTINGS LISTS SAVE, AND YOUR NOTIFICATION SWITCHES SAVE (Raptor H19).
 *
 * Stephan, 9 Nov: the Administrators and the Sales Manager change the sales lists (everybody else sees them);
 * a value still on leads or deals is moved, never orphaned; the Notifications tab shows the real kinds and each
 * person switches their own off. The database holds the rules (scripts/qa/live/h19-settings-lists.sql); this holds
 * the screen to them:
 *  - Pipelines reads the saved stages: a stage the firm added sits before Won and Rejected, in its saved order;
 *  - a built-in stage has no remove button; an added one does;
 *  - removing a stage deals still use asks where to move them (never Won or Rejected) and sends that to the database;
 *  - adding sends the name and the chance of closing;
 *  - a Sales Representative sees the list and is told who changes it -- no add box, no remove buttons;
 *  - Notifications lists the real kinds; switching one off saves {kind, muted: true} for you.
 *
 * Run: node scripts/qa/e2e/settings-lists.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('settings-lists')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null }
const REP = { ...PROFILE, name: 'Sipho', role: 'Sales Representative', team_id: null }
const item = (list, value, position, builtIn, probability = null) =>
  ({ list, value, position, built_in: builtIn, probability, removed_at: null })
const ITEMS = [
  item('deal_stage', 'Won', 1000, true), item('deal_stage', 'Rejected', 1001, true),
  item('deal_stage', 'New Deal', 0, true), item('deal_stage', 'Quotation Sent', 1, true),
  item('deal_stage', 'Site visit', 2, false, 35), item('deal_stage', 'Mandate Sent', 3, true),
  item('lead_source', 'Website', 0, true), item('lead_source', 'Trade fair', 1, false),
]
const server = await startServer()
let browser
const open = async (who, tab, calls) => {
  const json = (req) => { try { return JSON.parse(req.postData() ?? 'null') } catch { return null } }
  const { context, page } = await signedInPage(browser, who, [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [who] })],
    [(u) => /\/rest\/v1\/sales_list_items/.test(u), () => ({ body: ITEMS })],
    [(u) => /\/rpc\/sales_list_usage/.test(u), () => ({ body: [{ value: 'Site visit', uses: 3 }, { value: 'New Deal', uses: 2 }] })],
    [(u) => /\/rpc\/sales_list_(add|remove|rename|reorder|set_probability)/.test(u), (u, req) => {
      calls.push({ fn: /\/rpc\/(\w+)/.exec(u)[1], body: json(req) })
      return { body: 3 }
    }],
    [(u, req) => /\/rest\/v1\/notification_preferences/.test(u) && req.method() !== 'GET', (u, req) => {
      calls.push({ fn: 'notification_preferences', body: json(req) })
      return { status: 201, body: [] }
    }],
    [(u) => /\/rest\/v1\/notification_preferences/.test(u), () => ({ body: [] })],
  ], [])
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/settings?tab=${encodeURIComponent(tab)}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  return { context, page }
}
try {
  browser = await chromium.launch()
  {
    const calls = []
    const { context, page } = await open(ADMIN, 'Pipelines', calls)
    const rows = page.getByTestId('sales-list-row')
    await page.locator('[data-testid="sales-list-row"][data-value="Site visit"]').waitFor({ timeout: 20000 })
    t.check('Pipelines reads the saved stages, in order, Won and Rejected last',
      (await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-value')))).join(' | '),
      'New Deal | Quotation Sent | Site visit | Mandate Sent | Won | Rejected')
    const row = (v) => page.locator(`[data-testid="sales-list-row"][data-value="${v}"]`)
    t.check('a built-in stage cannot be removed', await row('Won').getByTestId('sales-list-remove').count(), 0)
    t.check('...an added one can', await row('Site visit').getByTestId('sales-list-remove').count(), 1)
    await page.waitForFunction(() => /3 in use/.test(document.querySelector('[data-value="Site visit"]')?.textContent ?? ''), null, { timeout: 10000 })
    t.ok('...and says how many deals use it', /3 in use/.test(await row('Site visit').innerText()))
    await row('Site visit').getByTestId('sales-list-remove').click()
    const move = page.getByTestId('sales-list-move')
    await move.waitFor({ timeout: 5000 })
    t.ok('removing a stage in use asks where its deals go', /3 deals use Site visit/.test((await move.innerText()).replace(/\s+/g, ' ')))
    const options = await move.locator('option').allInnerTexts()
    t.ok('...offering open stages only, never Won or Rejected', options.length === 3 && !options.includes('Won') && !options.includes('Rejected'))
    t.check('...and nothing is sent before it is confirmed', calls.length, 0)
    await move.locator('select').selectOption('Mandate Sent')
    await move.getByRole('button', { name: /Move them and remove/ }).click()
    await page.getByTestId('sales-list-done').waitFor({ timeout: 5000 })
    t.check('...then the database is told where to move them', JSON.stringify(calls[0]),
      JSON.stringify({ fn: 'sales_list_remove', body: { p_list: 'deal_stage', p_value: 'Site visit', p_move_to: 'Mandate Sent' } }))
    t.ok('...and the page says what it did', /3 deals moved to Mandate Sent/.test(await page.getByTestId('sales-list-done').innerText()))
    await page.getByTestId('sales-list-add-input').fill('  Proposal  ')
    await page.getByTestId('sales-list-add').click()
    await page.waitForFunction(() => /Proposal added/.test(document.querySelector('[data-testid="sales-list-done"]')?.textContent ?? ''), null, { timeout: 5000 })
    t.check('adding a stage sends its name and chance of closing', JSON.stringify(calls[1]),
      JSON.stringify({ fn: 'sales_list_add', body: { p_list: 'deal_stage', p_value: 'Proposal', p_probability: 40 } }))
    await t.shot(page, 'settings-lists-pipelines')
    await context.close()
  }
  {
    const calls = []
    const { context, page } = await open(REP, 'Lead Sources', calls)
    await page.locator('[data-testid="sales-list-row"][data-value="Trade fair"]').waitFor({ timeout: 20000 })
    t.ok('a Sales Representative sees the saved sources', true)
    t.ok('...is told who changes them', /Administrator or the Sales Manager/.test(await page.getByTestId('sales-list-read-only').innerText()))
    t.check('...and has no add box', await page.getByTestId('sales-list-add-input').count(), 0)
    t.check('...and no remove buttons', await page.getByTestId('sales-list-remove').count(), 0)
    await context.close()
  }
  {
    const calls = []
    const { context, page } = await open(ADMIN, 'Notifications', calls)
    await page.getByTestId('notification-switches').waitFor({ timeout: 20000 })
    const kinds = await page.getByTestId('notification-switch').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))
    t.ok('Notifications lists the real kinds (change requests, accounts handed out, the debtor portal)',
      ['change_request', 'handover', 'debtor'].every((k) => kinds.includes(k)))
    t.ok('...and none of the demo\'s ("Proposal viewed")', !/Proposal viewed|Meeting starting/.test(await page.getByTestId('notification-switches').innerText()))
    const sw = page.locator('[data-kind="change_request"] [role="switch"]')
    await page.waitForFunction(() => !document.querySelector('[data-kind="change_request"] [role="switch"]')?.hasAttribute('disabled'), null, { timeout: 5000 })
    t.check('everything is on until switched off', await sw.getAttribute('aria-checked'), 'true')
    await sw.click()
    await page.waitForFunction(() => document.querySelector('[data-kind="change_request"] [role="switch"]')?.getAttribute('aria-checked') === 'false', null, { timeout: 5000 })
    await page.waitForTimeout(300)
    const saved = calls.find((c) => c.fn === 'notification_preferences')?.body
    t.ok('switching change requests off saves it, for you', !!saved && saved.kind === 'change_request' && saved.muted === true && saved.user_id === ADMIN.id)
    await t.shot(page, 'settings-lists-notifications')
    await context.close()
  }
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`, false)
} finally {
  await browser?.close()
  stopServer(server)
}
process.exit(t.finish() ? 0 : 1)
