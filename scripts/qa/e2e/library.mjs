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
/** Every write the page sent, so a save can be checked on the wire and not on the screen. */
const written = []

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
    (u, req) => {
      /* A write comes back as the row PostgREST would have returned, and is recorded so the
         check can assert on what actually left the browser rather than on what the form shows. */
      if (req.method() === 'DELETE') {
        written.push({ method: 'DELETE', url: u, body: '' })
        return { body: [] }
      }
      if (req.method() === 'PATCH' || req.method() === 'POST') {
        written.push({ method: req.method(), url: u, body: req.postData() ?? '' })
        return { body: [{ ...LIBRARY[0], id: 'cccccccc-0000-4000-8000-00000000000f' }] }
      }
      const scope = /scope=eq\.(\w+)/.exec(u)?.[1]
      return { body: scope ? LIBRARY.filter((r) => r.scope === scope) : LIBRARY }
    },
  ],
  /*
   * WHERE A TEMPLATE IS USED, which is what decides whether it may be deleted.
   *
   * The handover email is wired into a step of a PUBLISHED workflow and must be refused; every
   * other template is used by nobody and may go. One fixture answering both cases is what stops
   * the check passing whichever answer the page happens to give.
   */
  [
    (u) => u.includes('/rest/v1/workflow_nodes'),
    (u) => {
      const id = /template_id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
      return {
        body: id === LIBRARY[1].id
          ? [{
            id: 'node-1',
            workflow_versions: { state: 'active', workflows: { name: 'Standard Collections' } },
          }]
          : [],
      }
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
  /* The left column's group headings, which are what the kinds are. */
  const kinds = async () => (await headings()).filter((h) => /TEMPLATES|SCRIPTS|LETTERS/i.test(h))

  /*
   * LETTERS ARE A COLLECTIONS THING. A statutory notice goes by registered post because the Act
   * says so; nothing on the sales side is posted. An empty "Letters" heading sitting on the sales
   * library for ever is the furniture problem.
   */
  t.ok(`collections has letters (${(await kinds()).join(' | ')})`,
    (await kinds()).some((h) => /LETTERS/i.test(h)))
  t.ok('...and the section shows the one there is',
    await page.getByText('Section 129 notice').first().isVisible())

  /*
   * THE FINDING THE PAGE EXISTS FOR. The handover email asks for two fields nothing can fill, and
   * the row has to say so before anybody signs it off.
   */
  await page.getByText('Handover notice').first().click()
  await page.waitForTimeout(500)
  const flag = page.getByText(/fields? with nothing behind/).first()
  t.ok('a template nothing can fill is flagged when it is opened', await flag.isVisible())
  t.check('...naming how many', (await flag.innerText()).replace(/\s+/g, ' ').trim(),
    '2 fields with nothing behind them')
  t.ok('...and says what it means in words',
    await page.getByText(/the message goes out with the braces still in it/).first().isVisible())

  /*
   * TWO VIEWS OF ONE THING, which the firm asked for by pointing at them: the fields in braces
   * are what you edit, the same words filled in are what the debtor reads.
   */
  t.ok('the words show their fields', (await page.locator('pre').first().innerText()).includes('{{balance}}'))
  await page.getByRole('button', { name: 'Example data' }).click()
  await page.waitForTimeout(300)
  const filled = await page.locator('pre').first().innerText()
  t.ok(`...and fill in against the sample (${filled.slice(0, 40).replace(/\n/g, ' ')})`,
    !filled.includes('{{balance}}') && filled.includes('R 48,250.00'))
  /* The unfillable one stays in braces even here, which is the honest rendering: that IS what
     the debtor would receive. */
  t.ok('...except the one nothing can fill, which is the point',
    filled.includes('{{bank_account_number}}'))
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

  /* ---------- editing, and the merge field you press ---------- */

  await page.getByRole('button', { name: 'Collections', exact: true }).click()
  await page.waitForTimeout(600)
  await page.getByText('First contact').first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.waitForTimeout(400)

  const words = page.locator('textarea').first()
  t.ok('a template can be edited in the app', await words.isVisible())

  /*
   * THE MERGE FIELD IS A BUTTON, AND IT LANDS AT THE CURSOR. The firm: "you should be able to
   * add, for example, a merge field... you can type the merge field or you can add the merge
   * field." Appending to the end would leave somebody cutting and pasting it into the sentence it
   * belongs in, which is the work the button was meant to save.
   */
  /*
   * THE CARET IS PUT IN THE MIDDLE ON PURPOSE. The first version of this typed "Dear " and
   * inserted with the caret already at the end — where inserting at the cursor and appending to
   * the end produce the same string, so the check passed over an implementation that appends.
   * Found by writing that implementation and watching this stay green.
   */
  await words.fill('Dear , please settle.')
  await words.evaluate((el) => { el.focus(); el.setSelectionRange(5, 5) })
  await page.getByRole('button', { name: '{{debtor_name}}' }).click()
  await page.waitForTimeout(300)
  t.check('pressing a field drops it in at the cursor, not at the end',
    await words.inputValue(), 'Dear {{debtor_name}}, please settle.')
  /* And the caret followed the text it just wrote, so the next one lands beside it. */
  await page.getByRole('button', { name: '{{balance}}' }).click()
  await page.waitForTimeout(300)
  t.check('...and the caret moved with it, so the next lands beside the first',
    await words.inputValue(), 'Dear {{debtor_name}}{{balance}}, please settle.')

  /*
   * AND A FIELD THAT DOES NOT EXIST IS CAUGHT HERE, not on the way out to four hundred debtors.
   * renderTemplate leaves the placeholder standing, so this is the only moment it can be caught.
   */
  await words.fill('Dear {{ballance}}')
  await page.waitForTimeout(300)
  t.ok('a typed field that is not a field is refused',
    await page.getByText(/is not a field on this side/).first().isVisible())
  t.ok('...and Save is not available while it stands',
    await page.getByRole('button', { name: 'Save' }).isDisabled())

  /* ---------- a save reaches the database ---------- */

  await words.fill('Dear {{debtor_name}}, account {{reference}} is overdue.')
  await page.waitForTimeout(300)
  const before = written.length
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForTimeout(900)
  t.ok(`the save left the browser (${written.length - before} write)`, written.length > before)
  const sent = written[written.length - 1]
  t.check('...as an update, not a new row', sent?.method, 'PATCH')
  t.ok(`...carrying the words that were typed (${(sent?.body ?? '').slice(0, 60)})`,
    (sent?.body ?? '').includes('account {{reference}} is overdue'))

  /* ---------- a new one ---------- */

  await page.getByRole('button', { name: 'New template' }).click()
  await page.waitForTimeout(400)
  t.ok('a new template opens empty', (await page.locator('textarea').first().inputValue()) === '')
  t.ok('...and cannot be saved with no name and no words',
    await page.getByRole('button', { name: 'Save' }).isDisabled())
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.waitForTimeout(300)

  /* ---------- the sidebar folds, and comes back ---------- */

  /*
   * THE FIRM ASKED FOR IT WHILE WORKING HERE: "if that thing can collapse that sidebar it could
   * be easier to work on this." Measured in pixels, because the claim is about how much room the
   * page gets and a class-name assertion would pass over a fold that moved nothing.
   */
  const rail = page.locator('aside.app-sidebar')
  const wide = (await rail.boundingBox())?.width ?? 0
  await page.getByRole('button', { name: 'Narrow the menu' }).click()
  await page.waitForTimeout(600)
  const narrow = (await rail.boundingBox())?.width ?? 0
  t.ok(`the sidebar folds to a rail (${Math.round(wide)}px to ${Math.round(narrow)}px)`,
    narrow > 0 && narrow < wide / 2)
  /* Folded, not gone: every page must still be one click away. */
  t.ok('...and the nav is still reachable',
    await page.getByRole('link', { name: /^Library/ }).first().isVisible())
  t.check('...with the labels gone', await page.getByText('Disputes', { exact: true }).count(), 0)

  /*
   * AND IT COMES BACK, which is the half a one-way fold would fail. Reloaded in between, because
   * a preference that resets on the next page load is not a preference.
   */
  await page.reload()
  await page.waitForTimeout(1200)
  t.ok(`it is still folded after a reload (${Math.round((await rail.boundingBox())?.width ?? 0)}px)`,
    ((await rail.boundingBox())?.width ?? 0) < wide / 2)
  await t.shot(page, '62-library-collapsed')
  await page.getByRole('button', { name: 'Widen the menu' }).click()
  await page.waitForTimeout(600)
  t.check(`...and comes back to its full width`,
    Math.round((await rail.boundingBox())?.width ?? 0), Math.round(wide))

  /* ---------- deleting one ---------- */

  /*
   * REFUSED WHERE A PUBLISHED WORKFLOW SENDS IT. workflow_nodes.template_id is `on delete set
   * null`, so the delete would succeed and the step would survive saying "send an email" with
   * nothing to send. Nobody would find out until the day it ran.
   */
  await page.getByText('Handover notice').first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.waitForTimeout(900)
  t.ok('deleting asks first', await page.getByText('Delete this template?').first().isVisible())
  t.ok('...and refuses one a published workflow sends',
    await page.getByText(/published or archived workflow step/).first().isVisible())
  t.ok('...naming the workflow to go and look at',
    await page.getByText(/Standard Collections/).first().isVisible())
  t.ok('...and offering to retire it instead',
    await page.getByText(/Retire it instead/).first().isVisible())
  /*
   * A confirm that refuses and still offers the button is not a refusal.
   *
   * WHAT THIS DOES AND DOES NOT COVER. reallyDelete carries its own guard as well, and that one
   * is unreachable from here by design — with the button absent there is nothing to click. Both
   * were broken together and this line fires, so the pair holds; the second is defence in depth
   * against a future caller, not something a browser can exercise on its own.
   */
  t.check('...with no way to go ahead anyway',
    await page.getByRole('button', { name: 'Delete permanently' }).count(), 0)
  const refusedAt = written.filter((w) => w.method === 'DELETE').length
  await page.getByRole('button', { name: 'Close' }).click()
  await page.waitForTimeout(400)
  t.check('...and nothing was deleted',
    written.filter((w) => w.method === 'DELETE').length, refusedAt)
  await t.shot(page, '63-library-delete-refused')

  /* ---------- and allowed where nothing depends on it ---------- */

  await page.getByText('First contact').first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.waitForTimeout(900)
  t.check('a template nothing uses is not refused',
    await page.getByText(/published or archived workflow step/).count(), 0)
  /* Offered every time, not only when delete is refused: retiring takes it out of use just as
     completely and keeps the words. */
  t.ok('...but retiring is still offered as the safer answer',
    await page.getByText(/keeps the wording for the day somebody asks/).first().isVisible())
  t.ok('...and a seeded one says it would come back on a replay',
    await page.getByText(/sms-first-contact/).first().isVisible())

  const beforeDelete = written.filter((w) => w.method === 'DELETE').length
  await page.getByRole('button', { name: 'Delete permanently' }).click()
  await page.waitForTimeout(1000)
  const deletes = written.filter((w) => w.method === 'DELETE')
  t.ok(`the delete reached the database (${deletes.length - beforeDelete} sent)`,
    deletes.length > beforeDelete)
  t.ok(`...naming the one that was asked for (${(deletes[deletes.length - 1]?.url ?? '').slice(-50)})`,
    (deletes[deletes.length - 1]?.url ?? '').includes(LIBRARY[0].id))

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
