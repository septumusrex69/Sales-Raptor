/**
 * THE TOP BAR FINDS A DEBTOR BY ANYTHING (S14, Raptor H13), in a real browser.
 *
 * The firm, 27 Oct: search "on a surname, on a telephone number ... on a reference number, on a
 * client reference number". The book is asked in the database (global_search) after a short pause;
 * the sales side is matched in the browser by name, email, phone and client code.
 *
 * Run: node scripts/qa/e2e/global-search.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, TEAM } from './fixtures.mjs'

const t = makeRunner('global-search')
const asked = []
const ACCOUNT = { kind: 'account', id: 'acc-1', label: 'Boitshoko Mose', sub: 'RAP-125279 · BOP00005 · Bonnitta Pharmacy', path: '/accounts/acc-1' }
const TICKET = { kind: 'ticket', id: 'q-1', label: 'T-1016', sub: 'Boitshoko Mose · BOP00005', path: '/queries/q-1' }

const server = await startServer()
const browser = await chromium.launch()
try {
  const { page } = await signedInPage(browser, PROFILE, [
    [(u, req) => u.includes('/rpc/global_search'), (u, req) => {
      const q = req.postDataJSON()?.p_q ?? ''
      asked.push(q)
      return { body: /^t-?1016$/i.test(q) ? [TICKET] : /mose|0821234567|082 123 4567|BOP00005/i.test(q) ? [ACCOUNT] : [] }
    }],
    [(u) => /\/rest\/v1\/profiles.*id=eq\./.test(u), () => ({ body: [PROFILE] })],
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [PROFILE] })],
    [(u) => u.includes('/rest/v1/companies'), () => ({ body: [{ ...COMPANY, code: 'BOP', phone: '015 291 0000', email: 'accounts@bonnitta.example' }] })],
    [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
    [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  ], [])
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  const box = page.getByTestId('global-search')
  await box.waitFor({ timeout: 20000 })
  const results = page.getByTestId('global-search-result')
  const find = async (typed) => {
    await box.fill(typed)
    await page.waitForTimeout(700)
    return results.evaluateAll((els) => els.map((e) => `${e.dataset.kind}:${e.querySelector('span span')?.textContent}`))
  }

  t.check('a surname finds the debtor in the book', JSON.stringify(await find('Mose')), JSON.stringify(['Account:Boitshoko Mose']))
  t.check('...so does a phone number, as typed', JSON.stringify(await find('082 123 4567')), JSON.stringify(['Account:Boitshoko Mose']))
  t.check('...and an account number', JSON.stringify(await find('BOP00005')), JSON.stringify(['Account:Boitshoko Mose']))
  t.check('a ticket number finds the ticket', JSON.stringify(await find('T-1016')), JSON.stringify(['Ticket:T-1016']))
  t.ok('the client is found by its code and its phone number too',
    (await find('015 291 0000')).some((r) => r.startsWith('Client:')) && (await find('bop')).some((r) => r.startsWith('Client:')))
  /* Typed quickly, the database is asked once for the finished word, not once per key. */
  asked.length = 0
  await box.fill('')
  await box.pressSequentially('Mose', { delay: 40 })
  await page.waitForTimeout(700)
  t.check('typing waits for the pause: one question for the whole word', JSON.stringify(asked), JSON.stringify(['Mose']))
  await results.first().click()
  await page.waitForTimeout(300)
  t.ok('a result opens what it found', /\/accounts\/acc-1$/.test(page.url()))
  await t.shot(page, 'global-search')
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish('The top bar finds a debtor by surname, phone number or reference, a ticket by number, and a client by code or phone.')
process.exit(good ? 0 : 1)
