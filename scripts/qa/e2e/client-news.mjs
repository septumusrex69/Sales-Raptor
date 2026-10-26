/**
 * A CLIENT UNSUBSCRIBED FROM OUR NEWS, WHOLE (S12, clientNews.ts).
 *
 * THE FIRM: "We need to find a name for people that don't want to receive information. Like
 * unsubscribes." -- and, asked whether to record it once for the whole client, "Yes". In a real
 * browser, as a Liaison Manager:
 *   1. a client's News card offers "Unsubscribe this client from our news"; recording it is ONE write
 *      to the client with when, why and who, and the card then says so;
 *   2. an unsubscribed client's re-subscription cannot be recorded without saying why;
 *   3. the clients list marks the row Unsubscribed;
 *   4. a contact of that client says, on their own page, that no news goes to them.
 *
 * Run: RAPTOR_E2E_PORT=5703 node scripts/qa/e2e/client-news.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE, TEAM } from './fixtures.mjs'

const t = makeRunner('client-news')
const NICOLE = { ...PROFILE, id: 'u-nicole', name: 'Nicole Loder', email: 'n@x.co.za', role: 'Liaison Manager' }
const client = (id, name, code, extra = {}) => ({ id, name, code, email: `${code.toLowerCase()}@client.co.za`, account_owner_id: NICOLE.id,
  created_at: '2026-10-01T07:00:00Z', ...extra })
const COMPANIES = [
  client('c-a', 'Agri Saad', 'AGS'),
  client('c-s', 'Silent Holdings', 'SIH', { news_stopped_at: '2026-10-20T08:00:00Z', news_stopped_reason: 'Asked on a call', news_stopped_by: NICOLE.id }),
]
const CONTACTS = [{ id: 'p-1', first_name: 'Sam', last_name: 'Silent', email: 'sam@silent.co.za', company_id: 'c-s', created_at: '2026-10-01T07:00:00Z' }]

const open = async (page, path) => {
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}${path}`, { timeout: 2000 }); return }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
}

const server = await startServer()
const browser = await chromium.launch()
try {
  const writes = []
  const { page } = await signedInPage(browser, NICOLE, [
    [(u, req) => req.method() === 'PATCH' && u.includes('/rest/v1/companies'), (u, req) => {
      writes.push({ url: decodeURIComponent(u), body: req.postDataJSON() })
      return { status: 200, body: [] }
    }],
    [(u) => /\/rest\/v1\/profiles.*id=eq\./.test(u), () => ({ body: [NICOLE] })],
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [NICOLE] })],
    [(u) => /\/rest\/v1\/contacts/.test(u), () => ({ body: CONTACTS })],
    [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: COMPANIES })],
    [(u) => u.includes('/rest/v1/marketing_preferences'), () => ({ body: [] })],
    [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
    [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  ], [], { now: '2026-10-26T10:00:00+02:00' })
  await page.setViewportSize({ width: 1180, height: 900 })

  /* 1. Record it for a client. */
  await open(page, '/companies/c-a')
  const stop = page.getByTestId('client-news-stop')
  await stop.waitFor({ timeout: 20000 })
  await stop.click()
  t.ok('it says what it stops, and what it does not', /No newsletter or campaign .* Statements, reports and notices still go\./
    .test(await page.getByTestId('client-news').innerText()))
  await page.getByTestId('client-news-reason').fill('Emailed us to say no more news')
  await page.getByTestId('client-news-record').click()
  await page.getByTestId('client-news-stopped').waitFor({ timeout: 10000 })
  const mark = writes.find((w) => w.body && 'news_stopped_at' in w.body)
  t.ok('one write, to this client', !!mark && /id=eq\.c-a/.test(mark.url) && writes.length === 1)
  t.check('...with why and who', JSON.stringify(mark ? [!!mark.body.news_stopped_at, mark.body.news_stopped_reason, mark.body.news_stopped_by] : null),
    JSON.stringify([true, 'Emailed us to say no more news', NICOLE.id]))
  t.ok('...and the card then says so', /^This client unsubscribed from our news on .*Emailed us to say no more news\./
    .test(await page.getByTestId('client-news-stopped').innerText()))
  t.ok('...the client\'s own address reads as covered', /the client unsubscribed/.test(await page.getByTestId('news-covered-by-client').innerText()))
  await t.shot(page, 'client-news-1-recorded')

  /* 2. A re-subscription says why. */
  await open(page, '/companies/c-s')
  const resume = page.getByTestId('client-news-resume')
  await resume.waitFor({ timeout: 20000 })
  await resume.click()
  t.ok('a re-subscription cannot be recorded without a reason', await page.getByTestId('client-news-record').isDisabled())
  await page.getByTestId('client-news-reason').fill('Asked again on a call, 26 Oct')
  t.ok('...and can with one', !(await page.getByTestId('client-news-record').isDisabled()))

  /* 3. The clients list. */
  await open(page, '/companies')
  await page.locator('table.list-table').waitFor({ timeout: 20000 })
  const marks = page.getByTestId('client-row-unsubscribed')
  t.check('the list marks the unsubscribed client, and only it', await marks.count(), 1)
  t.ok('...on its own row', /Silent Holdings/.test(await page.locator('tr', { has: marks }).innerText()))

  /* 4. A contact of that client. */
  await open(page, '/contacts/p-1')
  const said = page.getByTestId('client-news-stopped')
  await said.waitFor({ timeout: 20000 })
  t.ok('a contact\'s page names the client that unsubscribed', /^Silent Holdings unsubscribed from our news/.test(await said.innerText()))
  t.ok('...and offers no way to change it from there', (await page.getByTestId('client-news-resume').count()) === 0)
  await t.shot(page, 'client-news-2-contact')
  await page.context().close()
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish('A client is unsubscribed from our news in one write with why and who; a re-subscription says why; the list and its contacts say so.')
process.exit(good ? 0 : 1)
