/**
 * THE SIGNING PAGE, AS A CLIENT SEES THE MANDATE (the firm, 18 Oct, on their first one).
 *   - "this ... is going over" clause 5: the letterhead's FOOTER was printed across the text, a whole
 *     A4 drawn once behind one continuous sheet. Now only its head (at the top) and its foot (at the
 *     bottom of the sheet) are drawn.
 *   - "if I ... stop in the middle of the signature, it doesn't allow me to sign there again": the
 *     pad takes a second stroke.
 *   - one name, asked once: the mandate's signatory IS the signer.
 *
 * Run: node scripts/qa/e2e/sign-mandate.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'
import { mandateDocument, mandateBlanks, STANDARD_SCALE } from '../../../src/lib/mandate.ts'

const t = makeRunner('sign-mandate')
const doc = mandateDocument({ party: 'company', clientName: 'Abc Cricket', commission: { kind: 'scale', bands: STANDARD_SCALE } })
const ROW = {
  title: 'Debt collection agreement', body: doc.blocks, blanks: mandateBlanks('company'), filled: { mandate_client_name: 'Abc Cricket' },
  page_setup: { widthMm: 210, heightMm: 297, marginTopMm: 37.5, marginRightMm: 20, marginBottomMm: 24, marginLeftMm: 20, backgroundUrl: '/brand/email/welcome.jpg' },
  signer_name: 'Piet', state: 'sent',
}

const server = await startServer()
const browser = await chromium.launch()
try {
  const { page } = await signedInPage(browser, PROFILE, [
    [(u) => /\/rpc\/signing_document/.test(u), () => ({ body: [ROW] })],
  ], [])
  await page.setViewportSize({ width: 1180, height: 900 })
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/sign/tok-123`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByTestId('sign-letterhead-foot').waitFor({ timeout: 20000, state: 'attached' })
  const bands = await page.evaluate(() => {
    const sheet = document.querySelector('.ltr-page')
    const head = document.querySelector('[data-testid="sign-letterhead-head"]')
    const foot = document.querySelector('[data-testid="sign-letterhead-foot"]')
    const s = sheet.getBoundingClientRect(), h = head.getBoundingClientRect(), f = foot.getBoundingClientRect()
    const mm = s.width / 210
    return { bg: getComputedStyle(sheet).backgroundImage, headTop: Math.round(h.top - s.top), footAtBottom: Math.abs(f.bottom - s.bottom) < 2,
      footH: Math.round(f.height / mm), sheetMm: Math.round(s.height / mm) }
  })
  t.check('the sheet itself carries no letterhead image (it printed page one\'s footer mid-text)', bands.bg, 'none')
  t.check('the letterhead\'s head at the top', bands.headTop, 0)
  t.ok(`...and its foot at the very bottom of the ${bands.sheetMm}mm sheet, the height of the margin`, bands.footAtBottom && bands.footH === 24 && bands.sheetMm > 297)

  /* The signatory is the signer: no second name box. */
  t.check('no second "Your full name" box under the signature', await page.getByText('Your full name').count(), 0)

  /* Two strokes, with a stop between: the second draws. */
  const pad = page.locator('canvas').first()
  await pad.scrollIntoViewIfNeeded()
  const box = await pad.boundingBox()
  const ink = () => pad.evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n })
  await page.mouse.move(box.x + 20, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + 120, box.y + 60, { steps: 8 })
  await page.waitForTimeout(700)
  await page.mouse.move(box.x + 160, box.y + 40, { steps: 4 }); await page.mouse.up()
  const first = await ink()
  await page.mouse.move(box.x + 300, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + 420, box.y + 90, { steps: 8 }); await page.mouse.up()
  const second = await ink()
  t.ok(`a second stroke after a pause still draws (${first} -> ${second} inked pixels)`, first > 0 && second > first)
  await t.shot(page, 'sign-mandate')
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish('The signing page draws the letterhead head and foot without crossing the text, asks one name, and the pad takes every stroke.')
process.exit(good ? 0 : 1)
