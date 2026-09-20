/**
 * The library, in a real browser.
 *
 * WHAT ONLY A BROWSER CAN SETTLE HERE. check-message-templates.mjs proves the rules — which
 * fields each side may use, what counts as unknown, what an SMS costs. It cannot say that the
 * page renders, that switching side changes the list rather than filtering one, that letters stay
 * off the sales library, or — the one that matters most — that a template nothing can fill is
 * actually MARKED as such where somebody will see it.
 *
 * That last one is the page's reason for existing. renderTemplate deliberately leaves an
 * unresolved placeholder standing rather than printing a gap, so a template referring to a field
 * that does not exist does not fail: it posts "{{bank_account_number}}" to a debtor, on the
 * firm's letterhead. A library that lists such a template without saying so is worse than no
 * library, because it looks like sign-off.
 *
 * AND THE DOOR. "Collectors can't see the library because collectors don't build it. That's only
 * basically administrators. Team leaders neither." Checked by signing in as each.
 *
 * Run: node scripts/qa/e2e/library.mjs
 */
import {
  OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer,
} from './harness.mjs'
import { COMPANY, LIBRARY, PROFILE, TEAM } from './fixtures.mjs'

/*
 * PROFILE is a team leader, which is the person this page must turn away. The administrator is
 * the same person with the one field that decides it changed, so the two runs differ by exactly
 * the thing under test and nothing else.
 */
const ADMIN = { ...PROFILE, role: 'Administrator' }

const t = makeRunner('library')
const seen = []

/** The same stub for both people; only the profile's role changes. */
const handlersFor = (profile) => [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: profile.id, email: profile.email } })],
  [
    (u) => u.includes('/rest/v1/profiles'),
    (u) => {
      const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
      return { body: one ? [profile].filter((p) => p.id === one) : [profile] }
    },
  ],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  [
    (u) => u.includes('/rest/v1/message_templates'),
    /*
     * THE STUB APPLIES THE SCOPE CLAUSE. Answering both sides out of the whole fixture would put
     * the same rows under both libraries — which looks exactly like a working scope switch and is
     * a stub ignoring it.
     */
    (u) => {
      const scope = /scope=eq\.(\w+)/.exec(u)?.[1]
      return { body: scope ? LIBRARY.filter((r) => r.scope === scope) : LIBRARY }
    },
  ],
]

let browser
const server = startServer()
try {
  browser = await chromium.launch()

  /* ---------- the door ---------- */

  /*
   * A TEAM LEADER IS TURNED AWAY, and this is the stricter half of the rule — team leaders can
   * freeze accounts and set targets, so "management can" is the wrong instinct here.
   */
  {
    const leader = PROFILE
    const { page, context } = await signedInPage(browser, leader, handlersFor(leader), seen)
    let up = false
    for (let i = 0; i < 60; i += 1) {
      try { await page.goto(`http://localhost:${PORT}/library`, { timeout: 2000 }); up = true; break }
      catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    t.ok('the dev server answers', up)
    await page.getByText('The library is not open to you').waitFor({ timeout: 20000 })
    t.ok('a team leader is turned away', true)
    /*
     * REFUSED, NOT BLANK. A blank page where a menu item led is indistinguishable from one that
     * failed to load, and the person reports a bug rather than learning the rule.
     */
    t.ok('...and told why, rather than shown an empty page',
      await page.getByText(/Only an administrator writes/).first().isVisible())
    t.check('...and no template reaches them', await page.getByText('First contact').count(), 0)
    /*
     * AND THE SIDEBAR DOES NOT ADVERTISE IT. A menu item that always refuses teaches people the
     * sidebar lies. The page keeps its guard for anyone who types the address, which is what the
     * refusal above is.
     */
    t.check('...and the sidebar does not offer it either',
      await page.getByRole('link', { name: /^Library/ }).count(), 0)
    await context.close()
  }

  /* ---------- an administrator ---------- */

  const { page } = await signedInPage(browser, ADMIN, handlersFor(ADMIN), seen)
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(`http://localhost:${PORT}/library`)
  await page.getByRole('heading', { name: 'Library', exact: true }).waitFor({ timeout: 20000 })
  t.ok('an administrator is offered it in the sidebar',
    await page.getByRole('link', { name: /^Library/ }).first().isVisible())
  await page.getByText('First contact').first().waitFor({ timeout: 20000 })

  const headings = async () => (await page.locator('h3').allInnerTexts()).map((h) => h.trim())

  /*
   * LETTERS ARE A COLLECTIONS THING. A statutory notice goes by registered post because the Act
   * says so; nothing on the sales side is posted. An empty "Letters" heading sitting on the sales
   * library for ever is the furniture problem.
   */
  t.ok(`collections has letters (${(await headings()).join(' | ')})`,
    (await headings()).some((h) => /LETTERS/i.test(h)))
  t.ok('...and the section shows the one there is',
    await page.getByText('Section 129 notice').first().isVisible())

  /*
   * THE FINDING THE PAGE EXISTS FOR. The handover email asks for two fields nothing can fill, and
   * the row has to say so before anybody signs it off.
   */
  const flag = page.getByText(/fields with nothing behind them/).first()
  t.ok('a template nothing can fill is flagged on the row', await flag.isVisible())
  t.check('...naming how many', (await flag.innerText()).trim(), '2 fields with nothing behind them')
  t.check('...and only on that row',
    await page.getByText(/fields? with nothing behind (them|it)/).count(), 1)

  await page.getByText('Handover notice').first().click()
  await page.waitForTimeout(400)
  t.ok('...and opening it says what it means in words',
    await page.getByText(/the message goes out with the braces still in it/).first().isVisible())
  await t.shot(page, '60-library-collections')

  /* ---------- the other side is a different library, not a filter ---------- */

  await page.getByRole('button', { name: 'Sales', exact: true }).click()
  await page.waitForTimeout(700)
  t.ok('switching side brings its own wording',
    await page.getByText('Quotation follow-up').first().isVisible())
  t.check('...and leaves the collections wording behind',
    await page.getByText('First contact').count(), 0)
  /* The kinds themselves change, which is the part a filter could not do. */
  t.check('...and offers no letters, because the sales side posts nothing',
    (await headings()).filter((h) => /LETTERS/i.test(h)).length, 0)
  await t.shot(page, '61-library-sales')

  const real = errors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e))
  t.check('no console errors', real.length, 0)
  if (real.length) console.log('  console:', real.slice(0, 5))
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).split('\n')[0].slice(0, 140)})`, false)
  try {
    const pages = browser ? browser.contexts().flatMap((c) => c.pages()) : []
    if (pages[0]) await t.shot(pages[0], '69-where-it-stopped')
  } catch { /* nothing more to learn */ }
  console.log('\n--- what the app asked Supabase for ---')
  console.log(seen.slice(-14).join('\n') || '(nothing)')
} finally {
  if (browser) await browser.close()
  stopServer(server)
}

const good = t.finish(`The library opens to an administrator and to nobody else, carries letters on
the collections side and not on the sales side, and says on the row itself when a template asks for
a field nothing can fill. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)
