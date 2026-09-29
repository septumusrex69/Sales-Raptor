/**
 * THE SEND BUTTON SAYS SOMETHING, OR IT IS BROKEN.
 *
 * THE FIRM PRESSED SEND ON A REPLY WITH TWO PHOTOGRAPHS ATTACHED AND NOTHING HAPPENED. No error,
 * no spinner, no message -- and the deployment's own runtime logs show `/api/email/send` was never
 * called at all, so nothing had gone wrong on the server. Four things in the composer could stop a
 * press dead and every one of them did it silently: three bare `return`s in the submit handler,
 * and the browser refusing to submit a form whose `required` field is empty by drawing a bubble on
 * a control that, inside a modal somebody has scrolled to the bottom of, is off the screen.
 *
 * THIS IS THE CLASS OF BUG THE SOURCE-READING CHECKS CANNOT SEE. Every assertion about the guards
 * passes whether the press produces a message or nothing at all; what is wrong is what a person
 * looking at the screen gets back, which needs a screen. Hence a real browser, the real form, and
 * a real click on the real button.
 *
 * FOUR PRESSES, each the shape of a failure the firm could hit:
 *
 *   1. NOTHING TYPED -- the reproduction of what they reported. It must name the missing field.
 *   2. THE THING FILLED IN -- it must actually post, or the fix has made a wall.
 *   3. NO ADDRESS -- the other required field, so the message is not hard-coded to one of them.
 *   4. A REFUSAL FROM THE SERVER -- the server's own sentence has to reach the screen.
 *
 * Run: node scripts/qa/e2e/compose-send.mjs
 */
import {
  OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer,
} from './harness.mjs'
import { COLLEAGUE, COMPANY, MAIL, PROFILE, TEAM, USER_ID } from './fixtures.mjs'

const t = makeRunner('compose-send')
const seen = []

const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: PROFILE.email } })],
  [
    (u) => u.includes('/rest/v1/profiles'),
    (u) => {
      const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
      const all = [PROFILE, COLLEAGUE]
      return { body: one ? all.filter((p) => p.id === one) : all }
    },
  ],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [
    (u) => u.includes('/rpc/nav_counts'),
    () => ({ body: { mail: 1, tasks: 0, disputes: 0, diary: 0 } }),
  ],
  [
    (u) => u.includes('/rest/v1/user_emails'),
    (u, req) => {
      if (req.method() === 'PATCH') return { body: [] }
      const rows = MAIL.filter((m) => !m.is_junk && !m.is_sent)
      return { body: rows, headers: { 'content-range': `0-${rows.length - 1}/${rows.length}` } }
    },
  ],
]

let browser
let server
try {
  server = await startServer()
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, PROFILE, handlers, seen)

  /* The serverless functions the dev server does not run. */
  await page.route('**/api/email/status*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ connected: true, email: PROFILE.email }),
  }))
  await page.route('**/api/email/sync*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{}',
  }))
  await page.route('**/api/email/attachment*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ body: 'Please let me know what information you need.' }),
  }))

  /*
   * EVERY SEND, AND WHAT THE SERVER ANSWERS. `refuse` is flipped for the last press so the same
   * route can play both a working mailbox and a broken one -- a second route would race the first.
   */
  const posts = []
  let refuse = null
  await page.route('**/api/email/send*', (route) => {
    posts.push((route.request().postData() ?? '').length)
    return refuse
      ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: refuse }) })
      : route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, messageId: '<sent@raptor>', from: PROFILE.email }),
      })
  })

  await page.goto(`http://localhost:${PORT}/mail`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2200)
  await page.getByText('Debt collection enquiry').first().click()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'Reply', exact: true }).first().click()
  await page.waitForTimeout(700)
  /*
   * Past the matching step, the way the firm was: this message belongs to no debtor, and the
   * composer that opens is the one they were looking at when the button did nothing.
   */
  await page.getByRole('button', { name: /reply without matching it/i }).click()
  await page.waitForTimeout(1200)

  const modal = page.locator('[data-modal-open]')
  const send = page.getByRole('button', { name: /^Send$/ })
  const shown = async () => (await modal.locator('.text-red-600').allTextContents()).join(' ')

  t.ok('the composer opens on a reply', await send.isVisible())

  /* Two files on it, because that is what they had on and it must not be what stops it. */
  const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex')
  await modal.locator('input[type=file]').first().setInputFiles([
    { name: 'IMG_1422.jpeg', mimeType: 'image/jpeg', buffer: jpeg },
    { name: 'IMG_1423.jpeg', mimeType: 'image/jpeg', buffer: jpeg },
  ])
  await page.waitForTimeout(500)
  t.ok('...and carries what was attached to it', await modal.getByText('IMG_1422.jpeg').isVisible())

  /* ---------------- 1. the press that did nothing ---------------- */

  /*
   * THE BROWSER MUST NOT BE THE ONE REFUSING. With the form validating natively this press
   * produced no request, no error and no visible anything -- which is the bug, exactly.
   */
  await send.click()
  await page.waitForTimeout(700)
  t.check('an empty message does not post', posts.length, 0)
  t.ok('...and the button is not dead: it says what is missing',
    /needs a message/i.test(await shown()))
  await t.shot(page, '01-compose-says-what-is-missing')

  /* ---------------- 2. and it still sends ---------------- */

  await modal.locator('textarea').first().fill('Thank you — the statement is attached.')
  await page.waitForTimeout(300)
  await send.click()
  await page.waitForTimeout(1500)
  t.check('filled in, it posts', posts.length, 1)
  /* THE ATTACHMENTS WENT WITH IT. A send that quietly drops the files is the same complaint back
     in a worse form -- the firm would have no way of knowing until the client asked again. */
  t.ok('...carrying the attachments', (posts[0] ?? 0) > 200)
  t.ok('...and the composer closes on success', (await modal.count()) === 0)

  /* ---------------- 3. the other required field ---------------- */

  /*
   * NOT HARD-CODED TO THE MESSAGE BOX. The handler names whichever field is missing, and a check
   * that only ever sees one of them would pass on a sentence that always said the same thing.
   */
  await page.getByRole('button', { name: 'Reply', exact: true }).first().click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: /reply without matching it/i }).click()
  await page.waitForTimeout(1000)
  await modal.locator('textarea').first().fill('Ready to go.')
  await modal.locator('input[type=email]').first().fill('')
  await page.waitForTimeout(300)
  await send.click()
  await page.waitForTimeout(700)
  t.check('no address does not post', posts.length, 1)
  t.ok('...and it names the address rather than the message',
    /who it goes to/i.test(await shown()))

  /* ---------------- 4. and the server's own refusal reaches the screen ---------------- */

  refuse = 'No mailbox is connected for this user.'
  await modal.locator('input[type=email]').first().fill('client@example.co.za')
  await page.waitForTimeout(300)
  await send.click()
  await page.waitForTimeout(1500)
  t.check('a refused send did reach the server', posts.length, 2)
  t.ok('...and the server’s sentence is what is shown',
    /no mailbox is connected/i.test(await shown()))
  t.ok('...with the composer left open and the message still in it',
    (await modal.count()) > 0 && (await modal.locator('textarea').first().inputValue()) === 'Ready to go.')
  await t.shot(page, '02-compose-shows-the-refusal')
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).split('\n')[0].slice(0, 140)})`, false)
  try {
    const pages = browser ? browser.contexts().flatMap((c) => c.pages()) : []
    if (pages[0]) await t.shot(pages[0], '09-where-it-stopped')
  } catch { /* nothing more to learn */ }
  console.log('\n--- what the app asked Supabase for ---')
  console.log(seen.slice(-14).join('\n') || '(nothing)')
} finally {
  if (browser) await browser.close()
  stopServer(server)
}

const good = t.finish(`Send never fails in silence: it names the field that is missing, posts what
is filled in with its attachments, and shows the server's own words when the server says no.
Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)
