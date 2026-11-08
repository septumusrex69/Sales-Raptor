/**
 * SETTINGS -> SPELLING (S19 · Raptor H18; Stephan, 8 Nov: "spell checker is an appearance. Shouldn't it be at another
 * place? Can we also integrate Afrikaans and English?").
 *
 * Its own tab, not a card under Appearance; English and Afrikaans both ticked to start; unticking one is remembered on
 * the device; the last one cannot be unticked (switch spell check off instead); "My words" lists what was added, and
 * the dictionary files are served from Raptor itself.
 *
 * Run: node scripts/qa/e2e/spelling-settings.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('spelling-settings')
const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { context, page } = await signedInPage(browser, PROFILE, [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [PROFILE] })],
  ], [])
  await context.addInitScript(() => { try { window.localStorage.setItem('crm.spellCheck.myWords', JSON.stringify(['khumalo', 'paaiement'])) } catch { /* */ } })
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/settings?tab=Appearance`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByRole('button', { name: 'Spelling', exact: true }).waitFor({ timeout: 20000 })
  t.check('Appearance no longer carries the spell-check switch', await page.getByTestId('spell-check-switch').count(), 0)

  await page.getByRole('button', { name: 'Spelling', exact: true }).click()
  await page.getByTestId('spell-check-switch').waitFor({ timeout: 5000 })
  t.ok('Spelling has the switch', await page.getByTestId('spell-check-switch').isVisible())
  const en = page.getByTestId('spell-language-en')
  const af = page.getByTestId('spell-language-af')
  t.ok('English and Afrikaans are both ticked to start', (await en.isChecked()) && (await af.isChecked()))
  await af.uncheck()
  t.check('unticking Afrikaans is remembered on the device',
    await page.evaluate(() => window.localStorage.getItem('crm.spellCheck.languages')), '["en"]')
  t.ok('...and the last language left cannot be unticked', await en.isDisabled())
  await af.check()
  t.check('ticking it again puts both back', await page.evaluate(() => window.localStorage.getItem('crm.spellCheck.languages')), '["en","af"]')

  const mine = page.getByTestId('spell-my-words')
  t.ok('"My words" lists what was added', /khumalo/.test(await mine.innerText()) && /paaiement/.test(await mine.innerText()))
  await page.getByRole('button', { name: 'Remove khumalo' }).click()
  t.check('...and removing one takes it out', await page.evaluate(() => window.localStorage.getItem('crm.spellCheck.myWords')), '["paaiement"]')

  for (const f of ['/dictionaries/af-za/af_ZA.aff', '/dictionaries/af-za/af_ZA.dic', '/dictionaries/en-gb/en_GB.dic']) {
    const r = await page.request.get(`http://localhost:${PORT}${f}`)
    t.ok(`${f} is served by Raptor itself`, r.ok() && (await r.body()).length > 1000)
  }
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`, false)
} finally {
  await browser?.close()
  stopServer(server)
}
process.exit(t.finish() ? 0 : 1)
