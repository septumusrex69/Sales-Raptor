/**
 * S17's three compose problems in a real browser (S21 · Raptor H19). Stephan, 5 Nov:
 *   "I try to add Rinda ... multiple people to CC";
 *   "the thing where I was writing was going down";
 *   "show me the email signature that I uploaded ... how it will look relative to the text".
 *
 * The source checks (check-compose-cc-signature) hold the rules; what they cannot see is a second person
 * actually staying on the line, the address that leaves the browser, the signature actually drawn, or the dialog
 * actually moving off the part of the screen the keyboard covers.
 *
 * Run: RAPTOR_E2E_PORT=5311 node scripts/qa/e2e/compose-cc-signature.mjs
 */
import {
  PORT, chromium, makeRunner, signedInPage, startServer, stopServer,
} from './harness.mjs'
import { COLLEAGUE, COMPANY, MAIL, PROFILE, TEAM, USER_ID } from './fixtures.mjs'

const t = makeRunner('compose-cc-signature')

/* Invented, like every fixture here: the repo is public. */
const ME = { ...PROFILE, email_signature: 'Test Leader\nBredell Ferreira Attorneys' }
const people = [ME, COLLEAGUE]

const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: ME.email } })],
  [(u) => u.includes('/rest/v1/profiles'), (u) => {
    const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
    return { body: one ? people.filter((p) => p.id === one) : people }
  }],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  [(u) => /rpc\/mail_recipient_history/.test(u), () => ({ body: [] })],
  [(u) => u.includes('/rest/v1/user_emails'), (u, req) => {
    if (req.method() === 'PATCH') return { body: [] }
    const rows = MAIL.filter((m) => !m.is_junk && !m.is_sent)
    return { body: rows, headers: { 'content-range': `0-${rows.length - 1}/${rows.length}` } }
  }],
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, ME, handlers, [])
  await page.route('**/api/email/status*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: true, email: ME.email }) }))
  await page.route('**/api/email/sync*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  const posts = []
  await page.route('**/api/email/send*', (r) => {
    posts.push(JSON.parse(r.request().postData() ?? '{}'))
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, messageId: '<x@raptor>', from: ME.email }) })
  })

  let up = false
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/mail`, { timeout: 2000 }); up = true; break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the dev server answers', up)
  await page.getByRole('button', { name: 'New email' }).waitFor({ timeout: 20000 })
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'New email' }).click()
  const modal = page.locator('[data-modal-open]')
  const boxes = modal.locator('input[role="combobox"]')
  await boxes.first().waitFor({ timeout: 10000 })
  await boxes.first().fill('debtor@example.co.za')
  await modal.getByRole('button', { name: 'Add Cc' }).click()
  const cc = boxes.nth(1)
  const chips = modal.locator('[data-testid="recipient-chip"]')
  const options = modal.locator('ul[role="listbox"] li[role="option"]')

  /* ---------- 1. a colleague by name, then a second person ---------- */

  await cc.fill('than')
  await options.first().waitFor({ timeout: 5000 }).catch(() => {})
  const found = await options.allInnerTexts()
  t.ok(`typing "than" finds the colleague by name (${found.length})`, found.some((x) => x.includes('Thandi Junior')))
  t.ok('...marked as a colleague', found.some((x) => /colleague/i.test(x)))
  t.check('...and she has no X to forget her', await modal.getByRole('button', { name: /Forget thandi/ }).count(), 0)
  await options.first().locator('button').first().click()
  t.check('picking her makes a chip', await chips.count(), 1)
  t.check('...and leaves the box empty for the next one', await cc.inputValue(), '')

  await cc.fill('attorney@example.co.za,')
  t.check('a comma after an address makes a second chip', await chips.count(), 2)
  t.ok('...and the first one is still there', (await chips.allInnerTexts()).join(' ').includes('thandi@raptor.test'))
  await cc.fill('third@example.co.za')
  await cc.press('Backspace')
  t.check('Backspace in a box with text deletes text, not a person', await chips.count(), 2)
  await cc.fill('')
  await cc.press('Backspace')
  t.check('...in an empty box it takes the last person off', await chips.count(), 1)
  await cc.fill('attorney@example.co.za')
  await cc.press('Enter')
  t.check('Enter finishes an address too', await chips.count(), 2)
  t.check('...without sending the form', posts.length, 0)
  /* Counted before it is pressed: a locator that never resolves throws, two lines above the check that says why. */
  const takeOff = modal.getByRole('button', { name: 'Take thandi@raptor.test off' })
  t.check('each chip has an X of its own', await takeOff.count(), 1)
  if (await takeOff.count()) await takeOff.click()
  t.check('a chip\'s X takes that one off', (await chips.allInnerTexts()).join(' ').includes('thandi'), false)
  await cc.fill('than')
  await options.first().waitFor({ timeout: 5000 }).catch(() => {})
  await options.first().locator('button').first().click()

  /* ---------- 3. the signature, under what was typed ---------- */

  await modal.locator('input:not([role]):not([type=file])').first().fill('Statement attached')
  await modal.locator('textarea').first().fill('Good morning.\n\nPlease find the statement attached.')
  await page.waitForTimeout(400)
  /* PART OF THE EMAIL (Stephan, 9 Nov: "just make it part of the email ... not necessary to have like a separate
     box"): inside the message box, under the text, with no label of its own. */
  const frame = modal.locator('[data-testid="message-box"] iframe[title="Your signature"]')
  t.check('the signature is drawn inside the message box', await frame.count(), 1)
  t.check('...in a frame that cannot run scripts', await frame.getAttribute('sandbox'), 'allow-same-origin')
  const inside = await frame.evaluate((f) => f.contentDocument?.body?.innerText ?? '')
  t.ok('...with the signature in it', inside.includes('Bredell Ferreira Attorneys'))
  t.check('...and no preview panel or label beside it', await modal.getByText('How the email ends').count(), 0)
  const order = await modal.locator('[data-testid="message-box"]').evaluate((box) => [...box.children].map((c) => c.tagName).join(','))
  t.check('...under what is typed', order, 'TEXTAREA,IFRAME')
  /* LIKE OUTLOOK (Stephan, 9 Nov: "The signature is way below the text"): right under the last line typed, not twelve
     rows down. Two short paragraphs leave the signature within a few lines of the text. */
  const gap = await modal.locator('[data-testid="message-box"]').evaluate((box) => {
    const ta = box.querySelector('textarea'); const fr = box.querySelector('iframe')
    return ta && fr ? Math.round(fr.getBoundingClientRect().top - ta.getBoundingClientRect().top) : -1
  })
  t.ok(`...right under the text, as in Outlook (${gap}px from the top of the text)`, gap > 0 && gap < 140)
  const face = await frame.evaluate((f) => f.contentDocument?.body?.firstElementChild?.getAttribute('style') ?? '')
  t.ok('...in the firm\'s face, as the send wraps it', /font-family:/.test(face))
  await t.shot(page, '10-cc-and-signature')

  /* ---------- the press ---------- */

  await cc.fill('rinda')
  await modal.getByRole('button', { name: /^Send$/ }).click()
  await page.waitForTimeout(600)
  t.check('half a name on the Cc line does not post', posts.length, 0)
  t.ok('...it is named', /“rinda” on the Cc line is not an email address/.test(await modal.innerText()))
  await cc.fill('')
  await modal.getByRole('button', { name: /^Send$/ }).click()
  await page.waitForTimeout(1200)
  t.check('fixed, it posts', posts.length, 1)
  t.check('...with both people on the Cc, once each', posts[0]?.cc, 'attorney@example.co.za, thandi@raptor.test')

  /* ---------- 1b. Stephan, 9 Nov, on staging: "I try to add Nicholas and Camille to the same email, it keeps
     removing one." A REPLY ALL opens with Camille already on the Cc line; tapping into the box and adding a colleague
     must ADD them. It replaced her: the pre-filled address, with no comma after it, became the text being typed the
     moment the box took focus, and the pick was written over it. ---------- */
  await page.route('**/api/email/attachment*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ body: 'Hello' }) }))
  await page.getByText('Debt collection enquiry').first().click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Reply all' }).first().click()
  await page.waitForTimeout(600)
  const skipMatch = page.getByRole('button', { name: /reply without matching it/i })
  if (await skipMatch.count()) await skipMatch.click()
  const replyModal = page.locator('[data-modal-open]')
  const replyChips = replyModal.locator('[data-testid="recipient-chip"]')
  await replyChips.first().waitFor({ timeout: 8000 }).catch(() => {})
  t.ok('a reply all opens with Camille on the Cc line', (await replyChips.allInnerTexts()).join(' ').includes('camille@bredellferreira.co.za'))
  const replyCc = replyModal.locator('input[role="combobox"]').nth(1)
  await replyCc.click()
  t.ok('...and tapping into the box leaves her a chip', (await replyChips.allInnerTexts()).join(' ').includes('camille@bredellferreira.co.za'))
  await replyCc.fill('than')
  const replyOptions = replyModal.locator('ul[role="listbox"] li[role="option"]')
  await replyOptions.first().waitFor({ timeout: 5000 }).catch(() => {})
  if (await replyOptions.count()) await replyOptions.first().locator('button').first().click()
  const both = (await replyChips.allInnerTexts()).join(' ')
  t.ok(`adding a colleague keeps Camille (${both.replace(/\s+/g, ' ')})`, both.includes('camille@bredellferreira.co.za') && both.includes('thandi@raptor.test'))
  await replyModal.getByRole('button', { name: 'Close' }).first().click().catch(() => {})
  await page.waitForTimeout(300)

  /* ---------- 2. the keyboard ---------- */

  /*
   * Chromium has no on-screen keyboard, so the visual viewport an iPad reports with one up is played by hand:
   * 400px of a 900px window visible, slid down 60px. The dialog must sit inside exactly that.
   */
  const { context: kctx, page: ipad } = await signedInPage(browser, ME, handlers, [])
  await kctx.addInitScript(() => {
    const fake = new EventTarget()
    Object.assign(fake, { height: window.innerHeight, width: window.innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1, pageTop: 0, pageLeft: 0 })
    Object.defineProperty(window, 'visualViewport', { get: () => fake })
    window.__keyboard = (h, top) => { fake.height = h; fake.offsetTop = top; fake.dispatchEvent(new Event('resize')) }
  })
  await ipad.setViewportSize({ width: 1024, height: 900 })
  await ipad.route('**/api/email/status*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: true, email: ME.email }) }))
  await ipad.route('**/api/email/sync*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await ipad.goto(`http://localhost:${PORT}/mail`)
  await ipad.getByRole('button', { name: 'New email' }).waitFor({ timeout: 20000 })
  await ipad.waitForTimeout(1500)
  await ipad.getByRole('button', { name: 'New email' }).click()
  const overlay = ipad.locator('[data-modal-open]')
  await overlay.waitFor({ timeout: 10000 })
  t.check('with no keyboard the dialog is as it was', await overlay.getAttribute('data-keyboard'), null)
  await ipad.evaluate(() => window.__keyboard(400, 60))
  await ipad.waitForTimeout(200)
  t.check('with the keyboard up it says so', await overlay.getAttribute('data-keyboard'), 'open')
  const o = await overlay.boundingBox()
  t.check('...the overlay starts where the visible part starts', Math.round(o?.y ?? -1), 60)
  t.check('...and is exactly as tall as what can be seen', Math.round(o?.height ?? -1), 400)
  const card = await ipad.locator('[role="dialog"]').boundingBox()
  t.ok(`...and the card fits inside it (${Math.round(card?.y ?? 0)}..${Math.round((card?.y ?? 0) + (card?.height ?? 0))})`,
    !!card && card.y >= 60 && card.y + card.height <= 460 + 1)
  await ipad.evaluate(() => window.__keyboard(window.innerHeight, 0))
  await ipad.waitForTimeout(200)
  t.check('keyboard down, it goes back', await overlay.getAttribute('data-keyboard'), null)
} finally {
  if (browser) await browser.close()
  stopServer(server)
}

t.finish(`
Rinda's case: a colleague found by her name, a second person added beside her rather than over her, each with
an X, and Send carrying both once. The signature drawn under the box by the send's own functions, after the
last paragraph. And with the iPad keyboard up, the dialog sits in the part of the screen still visible.`)
