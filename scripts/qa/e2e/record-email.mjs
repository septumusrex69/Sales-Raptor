/**
 * Answering a message from the record it is filed on, in a real browser.
 *
 * WHY THIS LAYER. check-message-actions.mjs beside this folder proves the arithmetic: who a
 * reply-all reaches, what a forward quotes, when the button is worth offering. It cannot prove
 * the one thing the firm actually asked for, which is a claim about POSITION — "to put these
 * things at the top, currently it's still at the bottom, so if you want to reply, you have to go
 * all the way down." Whether a button is above the body or below it is not visible in source,
 * and a source check that asserts the JSX order would go on passing the day a stylesheet reorders
 * the column.
 *
 * Driven on a LEAD, because the change was asked for on an account and granted on all four
 * screens: "the same functions for the emailing inside the leads, the deals, the clients as
 * well." A check on the screen that prompted the request proves the least.
 *
 * Run: node scripts/qa/e2e/record-email.mjs
 */
import {
  OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer,
} from './harness.mjs'
import {
  COMPANY, COMPANY_ID, LEAD, LEAD_CC, LEAD_EMAIL, LEAD_EMAIL_ACTIVITY, LEAD_ID,
  PROFILE, TEAM, USER_ID,
} from './fixtures.mjs'

const t = makeRunner('record-email')
const seen = []

const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: PROFILE.email } })],
  [
    (u) => u.includes('/rest/v1/profiles'),
    (u) => {
      const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
      return { body: one ? [PROFILE].filter((p) => p.id === one) : [PROFILE] }
    },
  ],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [{ ...COMPANY, id: COMPANY_ID }] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  [(u) => u.includes('/rest/v1/leads'), () => ({ body: [LEAD] })],
  [(u) => u.includes('/rest/v1/activities'), () => ({ body: [LEAD_EMAIL_ACTIVITY] })],
  /* Everything else answers [] from the harness, which is what an empty CRM looks like. */
]

let browser
const server = startServer()
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, PROFILE, handlers, seen)

  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  let up = false
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/leads/${LEAD_ID}`, { timeout: 2000 }); up = true; break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the dev server answers', up)

  await page.getByText('Vaal Fire Services').first().waitFor({ timeout: 20000 })

  /* ---------- one wording, one button ---------- */

  await page.getByRole('tab', { name: /Emails/ }).or(page.getByRole('button', { name: /^Emails/ }))
    .first().click()
  await page.waitForTimeout(600)

  /*
   * "IN EMAILS AND CLIENTS, FOR EXAMPLE, IT ASKS TO COMPOSE, BUT IN ACCOUNTS IT SAYS WRITE TO
   * THEM. So maybe just make it all the same, like write to them."
   */
  t.ok('the card offers to write to them', await page.getByRole('button', { name: 'Write to them' }).first().isVisible())
  t.check('...and nothing here still says Compose',
    await page.getByRole('button', { name: /^Compose$/ }).count(), 0)

  /* ---------- the actions, and where they are ---------- */

  await page.getByText('Quotation for the collection mandate').first().click()
  await page.waitForTimeout(500)
  await t.shot(page, '50-record-email-open')

  const reply = page.getByRole('button', { name: /^Reply$/ }).first()
  const replyAll = page.getByRole('button', { name: /^Reply all$/ }).first()
  const forward = page.getByRole('button', { name: /^Forward$/ }).first()
  const unread = page.getByRole('button', { name: /^Mark unread$/ }).first()

  t.ok('an opened message offers Reply', await reply.isVisible())
  /* Offered because the fixture carries an attorney on Cc — see LEAD_EMAIL_ACTIVITY. */
  t.ok('...Reply all, because somebody else was on it', await replyAll.isVisible())
  t.ok('...Forward', await forward.isVisible())
  t.ok('...and Mark unread', await unread.isVisible())

  /*
   * THE WHOLE POINT OF DRIVING THIS IN A BROWSER. Reply must be ABOVE the message, not under it.
   * Compared as pixels down the page, which is the thing the firm was complaining about — a JSX
   * ordering assertion would pass over a stylesheet that put the bar back at the bottom.
   */
  const body = page.getByText('please could you confirm the commission structure').first()
  const replyBox = await reply.boundingBox()
  const bodyBox = await body.boundingBox()
  t.ok('the message body is on screen', !!bodyBox)
  t.ok(`Reply is above the message, not below it (${Math.round(replyBox?.y ?? -1)}px vs ${Math.round(bodyBox?.y ?? -1)}px)`,
    !!replyBox && !!bodyBox && replyBox.y < bodyBox.y)

  /* ---------- reply all reaches the person who was copied ---------- */

  await replyAll.click()
  await page.waitForTimeout(600)
  const box = page.locator('[data-modal-open]').first()
  void box
  const cc = page.getByLabel(/^Cc/i).first()
  t.ok('reply all opens the composer with a Cc line', await cc.isVisible())
  t.ok(`...carrying the person who was copied (${await cc.inputValue()})`,
    (await cc.inputValue()).includes(LEAD_CC.address))
  t.ok('...and it is editable, so it can be checked before Send',
    await cc.isEditable())
  const to = page.getByLabel(/^To/i).first()
  t.check('...and it answers the sender', await to.inputValue(), LEAD_EMAIL)
  await t.shot(page, '51-record-email-reply-all')

  /* ---------- nothing broke on the way ---------- */

  const real = errors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e))
  t.check('no console errors', real.length, 0)
  if (real.length) console.log('  console:', real.slice(0, 5))
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).split('\n')[0].slice(0, 140)})`, false)
  try {
    const pages = browser ? browser.contexts().flatMap((c) => c.pages()) : []
    if (pages[0]) await t.shot(pages[0], '59-where-it-stopped')
  } catch { /* nothing more to learn */ }
  console.log('\n--- what the app asked Supabase for ---')
  console.log(seen.slice(-14).join('\n') || '(nothing)')
} finally {
  if (browser) await browser.close()
  stopServer(server)
}

const good = t.finish(`A message opened on a record offers all four answers at the TOP of it, the
card says "Write to them" like every other one, and a reply-all arrives with the person who was
copied already on the Cc line. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)
