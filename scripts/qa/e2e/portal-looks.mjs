/**
 * /portal-looks: THE CLIENT PORTAL'S PHOTOGRAPH OF THE DAY, APPROVED A MONTH AT A TIME (S16, 31 Oct).
 *
 * Stephan: "pre-choose everything and approve it ... exactly how it's going to look ... for the month"; "any
 * administrator can approve it". Proved in the real app: the month is drawn day by day; "Fill" drafts the empty days
 * from the rotation (NOT approved -- nothing reaches a client unapproved); approving a day writes it approved, with the
 * side and framing chosen; a change to an approved day needs approving again; and somebody who is not an Administrator
 * may look but not change.
 *
 * Run: node scripts/qa/e2e/portal-looks.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('portal-looks')
const ADMIN = { ...PROFILE, role: 'Administrator' }
const NOW = '2026-11-03T10:00:00+02:00'

const server = await startServer()
const browser = await chromium.launch()
try {
  {
    const writes = []
    const handlers = [
      [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
      [(u, req) => /\/rest\/v1\/portal_day_looks/.test(u) && req.method() === 'POST', (u, req) => { writes.push(req.postDataJSON()); return { body: [] } }],
      [(u) => /\/rest\/v1\/portal_day_looks/.test(u), () => ({ body: [] })],
    ]
    const { context, page } = await signedInPage(browser, ADMIN, handlers, [], { now: NOW })
    for (let i = 0; i < 60; i += 1) {
      try { await page.goto(`http://localhost:${PORT}/portal-looks`, { timeout: 2000 }); break }
      catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    await page.getByTestId('portal-looks').waitFor({ timeout: 15000 })
    t.ok('the month is November 2026, a card a day', /November 2026/.test(await page.getByTestId('portal-looks-month').innerText())
      && await page.getByTestId('portal-look-day').count() === 30)
    t.ok('...none approved yet, and each one says clients see Llandudno', /0 of 30/.test(await page.getByTestId('portal-looks-count').innerText())
      && /Llandudno/.test(await page.getByTestId('portal-look-day').first().innerText()))

    await page.getByTestId('portal-looks-fill').click()
    await page.waitForTimeout(400)
    const filled = writes.pop()
    t.ok('Fill drafts every empty day from the rotation, and approves none of them', Array.isArray(filled) && filled.length === 30
      && filled.every((r) => r.approved_at === null && typeof r.photo_id === 'string'))

    const first = page.getByTestId('portal-look-day').first()
    await first.getByTestId('portal-look-side-right').click()
    t.ok('a change shows at once in the preview, before anything is saved', /text-right/.test(await first.getByTestId('portal-look-band').innerHTML()))
    await first.getByTestId('portal-look-approve').click()
    await page.waitForTimeout(400)
    const approved = writes.pop()
    t.ok('approving writes the day approved, with the side chosen and who approved it', approved?.day === '2026-11-01' && approved?.text_side === 'right'
      && typeof approved?.approved_at === 'string' && approved?.approved_by === ADMIN.id)
    t.ok('...and the card and the count say so', (await first.getAttribute('data-approved')) === 'yes' && /1 of 30/.test(await page.getByTestId('portal-looks-count').innerText()))
    await t.shot(page, 'portal-looks')

    await first.getByTestId('portal-look-side-left').click()
    t.ok('changing an approved day takes its approval away until it is approved again', (await first.getAttribute('data-approved')) === 'no'
      && /Changed, not approved/.test(await first.innerText()))
    await context.close()
  }
  {
    const viewer = { ...PROFILE, role: 'Liaison' }
    const { context, page } = await signedInPage(browser, viewer, [
      [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [viewer] })],
      [(u) => /\/rest\/v1\/portal_day_looks/.test(u), () => ({ body: [] })],
    ], [], { now: NOW })
    await page.goto(`http://localhost:${PORT}/portal-looks`)
    await page.getByTestId('portal-looks').waitFor({ timeout: 15000 })
    t.ok('somebody who is not an Administrator may look, but not fill, change or approve',
      await page.getByTestId('portal-look-day').count() === 30 && await page.getByTestId('portal-looks-fill').count() === 0
      && await page.getByTestId('portal-look-approve').count() === 0)
    await context.close()
  }
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).slice(0, 200)})`, false)
} finally {
  await browser.close()
  stopServer(server)
}
t.finish()
