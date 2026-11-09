/**
 * SETTINGS, BY WHOSE SETTINGS THEY ARE (S19 · Raptor H18; Stephan, 8 Nov: "rejection reasons, lead sources, custom
 * fields, pipelines ... Some of that stuff could be specific to other departments ... under like departmental
 * things ... You can also build that out for all the other departments").
 *
 *  - The menu is headed You / The firm / Sales / Call centre / Communications / Finance.
 *  - Sales holds pipelines, lead sources, rejection reasons, custom fields; the call centre its targets and workflows.
 *  - A department's pages elsewhere are links, offered only to somebody who may open them (a collector sees no Trust).
 *  - The five tabs that do not save say so, in the menu and on the page.
 *
 * Run: node scripts/qa/e2e/settings-departments.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('settings-departments')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null }
const AGENT = { ...PROFILE, name: 'A Collector', role: 'Pre-legal Agent' }
const server = await startServer()
let browser
const open = async (who) => {
  const { context, page } = await signedInPage(browser, who, [[(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [who] })]], [])
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/settings`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByTestId('settings-nav').waitFor({ timeout: 20000 })
  return { context, page }
}
try {
  browser = await chromium.launch()
  {
    const { context, page } = await open(ADMIN)
    const headings = await page.getByTestId('settings-nav').locator('p').allInnerTexts()
    t.check('the menu is grouped: you, the firm, then each department', headings.map((h) => h.trim().toUpperCase()).join(' | '),
      'YOU | THE FIRM | SALES | CALL CENTRE | COMMUNICATIONS | FINANCE')
    const sales = await page.getByTestId('settings-group-Sales').innerText()
    t.ok('Sales holds pipelines, lead sources, rejection reasons and custom fields',
      ['Pipelines', 'Lead Sources', 'Rejection Reasons', 'Custom Fields'].every((x) => sales.includes(x)))
    const cc = await page.getByTestId('settings-group-Call centre').innerText()
    t.ok('the call centre has its targets and its notice workflows', /Collection targets/.test(cc) && /Notice workflows/.test(cc))
    const fin = await page.getByTestId('settings-group-Finance').innerText()
    /* Pay is a tick no role is born with, the Administrator's included (capabilities.ts NO_ROLE_CAPABILITIES). */
    t.ok('Finance gathers Trust settings for an Administrator', /Trust settings/.test(fin))
    t.ok('...and not Commission rules without the pay tick', !/Commission rules/.test(fin))
    t.check('the five that do not save are marked so in the menu', await page.getByTestId('settings-unsaved').count(), 5)
    await page.getByTestId('settings-group-Sales').getByRole('button', { name: /Pipelines/ }).click()
    t.ok('...and say so on the page', /Not saved yet/.test(await page.getByTestId('settings-not-saved').innerText()))
    await page.getByTestId('settings-group-Call centre').getByRole('button', { name: /Collection targets/ }).click()
    t.ok('Collection targets opens the Targets page', /tab=Targets/.test(page.url()))
    await page.getByTestId('settings-not-saved').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
    t.check('...where nothing says it is unsaved (it saves)', await page.getByTestId('settings-not-saved').count(), 0)
    await t.shot(page, 'settings-departments')
    await context.close()
  }
  {
    const { context, page } = await open({ ...ADMIN, grants: ['people.pay'] })
    t.ok('with the pay tick, Commission rules is under Finance too', /Commission rules/.test(await page.getByTestId('settings-group-Finance').innerText()))
    await context.close()
  }
  {
    const { context, page } = await open(AGENT)
    t.check('a collector is offered no Finance heading at all', await page.getByTestId('settings-group-Finance').count(), 0)
    t.check('...and no link to Trust settings', await page.getByRole('link', { name: 'Trust settings' }).count(), 0)
    await context.close()
  }
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`, false)
} finally {
  await browser?.close()
  stopServer(server)
}
process.exit(t.finish() ? 0 : 1)
