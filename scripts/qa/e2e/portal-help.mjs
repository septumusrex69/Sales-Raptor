/**
 * THE PORTAL'S HELP SECTION, IN A REAL BROWSER (Ryno, 11 Nov · Raptor · Handover 19).
 *
 * The rules check (check-portal-help) proves the examples are right; this proves a client can reach them: Help is
 * in the menu, the 50/50 film plays and steps through its chapters, the guides search and open, a guide's button
 * takes the client to the section it is about, and "Raise a ticket" opens the ask window. Already signed in (the
 * token in the browser, as "Keep me signed in" leaves it); every /api/portal call answered from fixtures.
 *
 * Run: node scripts/qa/e2e/portal-help.mjs
 */
import { PORT, chromium, makeRunner, startServer, stopServer } from './harness.mjs'

const t = makeRunner('portal-help')
const TOKEN = 'cd'.repeat(32)
const DASH = {
  accounts: 1, open: 1,
  figures: { capitalHandedOver: 1000, collectedToDate: 0, collectedThisMonth: 0, capitalOutstanding: 1000 },
  outcomes: [{ outcome: 'in_progress', label: 'In progress', finished: false, accounts: 1, handedOver: 1000, outstanding: 1000, paidToDate: 0 }],
  tickets: { waitingOnYou: 0, open: 0 }, handoverDays: [], collectedMonths: [],
  liaison: { name: 'Camille Liaison', email: 'camille@example.test', phone: '021 555 0101', whatsapp: null },
}

const server = await startServer()
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript((tok) => { try { localStorage.setItem('raptor.portal.token', tok) } catch { /* */ } }, TOKEN)
  const page = await context.newPage()
  await context.route(/supabase\.co/, (r) => r.abort())
  await context.route('**/api/portal/**', (r) => {
    const action = new URL(r.request().url()).pathname.split('/').pop()
    const json = (status, b) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) })
    if (action === 'day-look') return json(200, { row: null })
    if (action === 'me') return json(200, { name: 'Jan Pharma', email: 'jan@alianna.co.za', client: 'Alianna Pharmacy' })
    if (action === 'dashboard') return json(200, DASH)
    if (action === 'tickets') return json(200, { tickets: [] })
    if (action === 'book') return json(200, { total: 0, totals: { capitalHandedOver: 0, paidThisMonth: 0, paidToDate: 0, capitalOutstanding: 0 }, lines: [] })
    if (action === 'reports') return json(200, { reports: [] })
    return json(200, {})
  })
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/portal`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByTestId('portal-dashboard').waitFor({ timeout: 20000 })
  await page.getByTestId('portal-splash').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})

  /* In the menu, last, and it opens. */
  const nav = (await page.getByTestId('portal-sidebar').innerText()).replace(/\s+/g, ' ')
  t.ok('Help is in the sidebar, after Hand over', /Hand over.*Help/.test(nav))
  await page.getByTestId('portal-nav-help').click()
  await page.getByTestId('portal-help').waitFor({ timeout: 5000 })
  t.ok('the band names the section', /Help & guides/.test(await page.getByTestId('portal-hero').innerText()))
  await t.shot(page, 'portal-help')

  /* The film: nothing plays until pressed; then it plays and steps; chapters jump. */
  const scene = async () => Number(await page.getByTestId('split-explainer').getAttribute('data-scene'))
  t.check('the film waits on its first scene until pressed', await scene(), 0)
  await page.getByTestId('split-play-big').click()
  await page.waitForTimeout(5600)
  t.check('...pressed, it plays on to the 50/50 scene by itself', await scene(), 1)
  await page.getByTestId('split-play').click() // pause
  const caption = (await page.getByTestId('split-caption').innerText()).replace(/ /g, ' ')
  t.ok('...and the caption says R1 000 is split into two R500 halves', /R 500\.00 to the fees side, R 500\.00 to the capital side/.test(caption))
  await page.getByTestId('split-chapter').nth(3).click()
  await page.waitForTimeout(900)
  t.check('a chapter press jumps to the roll', await scene(), 3)
  t.ok('...where the fees side has shrunk to what it spent (R345 of R1 000)', /34\.5%/.test(await page.getByTestId('split-fees').getAttribute('style') ?? ''))
  await page.getByTestId('split-explainer').screenshot({ path: `${process.env.RAPTOR_QA_OUT ?? '.qa-screenshots'}/portal-help-roll.png` })
  await page.getByTestId('split-chapter').nth(5).click()
  await page.waitForTimeout(900)
  t.ok('the "paid over to you" scene names the client\'s share (R542.01)', /R 542\.01/.test((await page.getByTestId('split-caption').innerText()).replace(/ /g, ' ')))
  await t.shot(page, 'portal-help-film')

  /* The guides: search narrows, nonsense says so, a card opens, its button goes where it says. */
  const cards = await page.getByTestId('help-guide-card').count()
  t.ok(`the guides are listed (${cards})`, cards >= 10)
  await page.getByTestId('help-search').fill('remittance')
  t.ok('a search narrows the list', (await page.getByTestId('help-guide-card').count()) < cards)
  await page.getByTestId('help-search').fill('zzqx')
  t.ok('...and nonsense says nothing matches', await page.getByTestId('help-none').isVisible())
  await page.getByTestId('help-search').fill('')
  await page.locator('[data-testid="help-guide-card"][data-guide="positions"]').click()
  await page.getByTestId('help-guide').waitFor({ timeout: 3000 })
  const words = await page.getByTestId('help-guide').innerText()
  t.ok('the positions guide explains Refusing to pay and Cannot pay apart', /Refusing to pay/.test(words) && /Cannot pay/.test(words))
  await page.getByTestId('help-open-section').click()
  t.ok('...and its button opens Accounts', await page.getByTestId('portal-nav-accounts').getAttribute('aria-current') === 'page')

  /* The split guide carries the calculator, and the calculator moves. */
  await page.getByTestId('portal-nav-help').click()
  await page.getByTestId('help-split-guide').click()
  await page.getByTestId('help-try').waitFor({ timeout: 3000 })
  const toYou = async () => (await page.getByTestId('help-try-to-you').innerText()).replace(/ /g, ' ')
  t.ok('try-it opens on the film\'s example', /R 542\.01/.test(await toYou()))
  await page.getByTestId('help-try-payment').fill('2000')
  t.ok('...and a new payment changes what is paid over', !/R 542\.01/.test(await toYou()))
  await t.shot(page, 'portal-help-try')

  /* And a person, when the guides are not enough. */
  await page.getByTestId('help-ask').click()
  t.ok('Raise a ticket opens the ask window', await page.getByRole('dialog').count() > 0 || await page.getByTestId('portal-ask').count() > 0
    || /Ask a question/.test(await page.locator('body').innerText()))

  /* On a phone, Help is in the row across the top too. */
  await page.setViewportSize({ width: 390, height: 844 })
  await page.keyboard.press('Escape')
  t.ok('on a phone, Help is in the top row', await page.locator('nav[aria-label="Portal"] button', { hasText: 'Help' }).count() >= 1)
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).slice(0, 200)})`, false)
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish('A client finds Help in the portal, plays the 50/50 film, reads a guide and reaches a person.')
process.exit(good ? 0 : 1)
