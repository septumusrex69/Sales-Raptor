/**
 * A forward that waits for its attachment says so, and can go without it (S21 · Raptor H19).
 *
 * Stephan, 10 Nov, forwarding a partnership agreement to Julian: "it literally just doesn't want to send." Nothing reached
 * the send route: Send was greyed out while the PDF came out of a slow mailbox, with only a small note beside Attach.
 * Played here with an attachment that never answers, then with one that does.
 *
 * Run: RAPTOR_E2E_PORT=5311 node scripts/qa/e2e/forward-attachment.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, MAIL, PROFILE, TEAM, USER_ID } from './fixtures.mjs'

const t = makeRunner('forward-attachment')
const ME = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null }
/* Invented: the shape of the message he forwarded -- one PDF attached. */
const MSG = { ...MAIL[0], id: 'fwd-1', uid: 61479, subject: 'Fwd: Partnership agreement', attachment_names: ['Partnership_Agreement.pdf'] }
const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: ME.email } })],
  [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [ME] })],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 1, tasks: 0, disputes: 0, diary: 0 } })],
  [(u) => u.includes('/rest/v1/user_emails'), (u, req) => (req.method() === 'PATCH' ? { body: [] } : { body: [MSG], headers: { 'content-range': '0-0/1' } })],
]

async function openForward(browser, { fileAnswers }) {
  const { context, page } = await signedInPage(browser, ME, handlers, [])
  await page.route('**/api/email/status*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: true, email: ME.email }) }))
  await page.route('**/api/email/sync*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('**/api/email/attachment*', (r) => {
    const b = JSON.parse(r.request().postData() ?? '{}')
    if (!b.filename) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ body: 'Please see the attached.', html: '<p>Please see the attached.</p>', images: [] }) })
    if (!fileAnswers) return undefined /* the mailbox never answers: the request is left hanging */
    return r.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.alloc(600000, 65) })
  })
  const posts = []
  await page.route('**/api/email/send*', (r) => { posts.push(JSON.parse(r.request().postData() ?? '{}')); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, messageId: '<x>', from: ME.email }) }) })
  let up = false
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/mail`, { timeout: 2000 }); up = true; break } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the dev server answers', up)
  await page.getByText('Partnership agreement').first().click({ timeout: 20000 })
  await page.getByRole('button', { name: 'Forward' }).first().click()
  const skip = page.getByRole('button', { name: /without matching/i })
  await page.waitForTimeout(600)
  if (await skip.count()) await skip.click()
  const modal = page.locator('[data-modal-open]')
  await modal.locator('input[role="combobox"]').first().fill('julian@example.co.za')
  return { context, page, modal, posts }
}

const server = await startServer()
let browser
try {
  browser = await chromium.launch()

  /* ---------- the mailbox does not answer ---------- */
  {
    const { context, page, modal, posts } = await openForward(browser, { fileAnswers: false })
    await page.waitForTimeout(1500)
    const send = modal.getByRole('button', { name: /^(Send|Fetching the attachment…)$/ })
    t.check('while the file is fetched, the button says what it is waiting for', await send.innerText(), 'Fetching the attachment…')
    t.ok('...and the note names the file, with a way to go without it',
      /Fetching Partnership_Agreement\.pdf from your mailbox/.test(await modal.getByTestId('forward-fetching').innerText()))
    await modal.getByTestId('forward-skip').click()
    t.check('Send without it gives the button back', await modal.getByRole('button', { name: /^Send$/ }).isEnabled(), true)
    t.ok('...and says the file is not attached', /Not attached[\s\S]*Partnership_Agreement\.pdf/.test(await modal.innerText()))
    await modal.getByRole('button', { name: /^Send$/ }).click()
    await page.waitForTimeout(1200)
    t.check('it sends', posts.length, 1)
    t.check('...without the file', (posts[0]?.attachments ?? []).length, 0)
    await context.close()
  }

  /* ---------- the mailbox answers ---------- */
  {
    const { context, page, modal, posts } = await openForward(browser, { fileAnswers: true })
    await modal.getByRole('button', { name: /^Send$/ }).waitFor({ timeout: 15000 })
    await modal.getByRole('button', { name: /^Send$/ }).click()
    await page.waitForTimeout(1500)
    t.check('with the file in hand it sends on the first press', posts.length, 1)
    t.check('...carrying the PDF', JSON.stringify((posts[0]?.attachments ?? []).map((a) => a.filename)), JSON.stringify(['Partnership_Agreement.pdf']))
    await context.close()
  }
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  if (browser) await browser.close()
  stopServer(server)
}
process.exit(t.finish(`A forward waiting for its attachment says which file, and "Send without it" lets it go; with the file in hand it sends with it.`) ? 0 : 1)
