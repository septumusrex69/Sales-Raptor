/**
 * CONFIRM AND ACCEPT A PAYMENT ARRANGEMENT, as the debtor sees it (S9, 19 Oct). The firm: "they
 * should just click here to confirm and accept ... it's a signed document in terms of 4B."
 *
 * The page shows the arrangement on the letterhead, asks for no drawn signature -- a typed name and
 * a tick -- refuses without either, and on Confirm and accept calls signing_accept and then the
 * signed-copy route, which is where item 4(b) is raised.
 *
 * Run: node scripts/qa/e2e/arrangement-accept.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'
import { arrangementDocument } from '../../../src/lib/arrangementDocument.ts'

const t = makeRunner('arrangement-accept')
const body = arrangementDocument({
  today: '19 October 2026', debtor_name: 'Mr Pompies', case_number: 'BF-004321', client_name: 'Rinda Roo',
  balance: 'R 12,500.00', ptp_amount: 'R 500.00', ptp_frequency: 'every month', ptp_date: '1 November 2026',
})
let state = 'sent'
const calls = []
const ROW = () => ({
  title: 'Payment arrangement', body, blanks: [], filled: {}, mode: 'accept',
  page_setup: { widthMm: 210, heightMm: 297, marginTopMm: 37.5, marginRightMm: 20, marginBottomMm: 24, marginLeftMm: 20, backgroundUrl: '/brand/email/welcome.jpg' },
  signer_name: 'Mr Pompies', state, signed_name: state === 'signed' ? 'Piet Pompies' : null, signed_at: state === 'signed' ? '2026-10-19T09:00:00Z' : null,
})

const server = await startServer()
const browser = await chromium.launch()
try {
  const { page, context } = await signedInPage(browser, PROFILE, [
    [(u) => /\/rpc\/signing_document/.test(u), () => ({ body: [ROW()] })],
    [(u) => /\/rpc\/signing_accept/.test(u), (u, req) => { calls.push(['accept', req.postDataJSON()]); state = 'signed'; return { body: true } }],
    [(u) => /\/rpc\/signing_sign/.test(u), () => { calls.push(['sign']); return { body: true } }],
  ], [])
  await context.route('**/api/email/signed-copy', (r) => { calls.push(['signed-copy', r.request().postDataJSON()]); return r.fulfill({ status: 200, body: '{"sent":true}' }) })
  await page.setViewportSize({ width: 1024, height: 900 })
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/sign/tok-arr`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  const button = page.getByRole('button', { name: 'Confirm and accept' })
  await button.waitFor({ timeout: 20000 })
  const text = (await page.locator('.ltr-page').first().innerText()).replace(/\s+/g, ' ')
  t.ok('the arrangement is on the page: the instalment, how often, the first payment', /R 500\.00/.test(text) && /every month/.test(text) && /1 November 2026/.test(text))
  t.ok('...against our case number and the balance', /BF-004321/.test(text) && /R 12,500\.00/.test(text))
  t.ok('...and it is not called an acknowledgement of debt (the firm’s word)', !/acknowledg/i.test(text))
  t.check('no signature pad: confirm and accept, not sign', await page.locator('canvas').count(), 0)

  await button.click()
  t.ok('without a name it is refused, and says why', await page.getByText('Type your full name before accepting.').isVisible())
  await page.getByPlaceholder('As it appears on your ID').fill('Piet Pompies')
  await button.click()
  t.ok('...without the tick, likewise', await page.getByText('Tick the box to confirm you accept the arrangement.').isVisible())
  t.check('...and nothing was sent either time', calls.length, 0)

  await page.getByRole('checkbox').check()
  await button.click()
  await page.waitForTimeout(1500)
  const accepted = calls.find((c) => c[0] === 'accept')
  t.ok('accepting calls signing_accept with the typed name', accepted?.[1]?.p_token === 'tok-arr' && accepted?.[1]?.p_name === 'Piet Pompies')
  t.ok('...never signing_sign', !calls.some((c) => c[0] === 'sign'))
  t.ok('...then the signed-copy route, which raises item 4(b) and emails the copy', calls.some((c) => c[0] === 'signed-copy' && c[1]?.token === 'tok-arr'))
  await t.shot(page, 'arrangement-accepted')
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).slice(0, 200)})`, false)
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish('A payment arrangement is confirmed and accepted with a typed name and a tick, and the acceptance is sent on to be charged and copied.')
process.exit(good ? 0 : 1)
