/**
 * THE DEBTOR'S FILE, IN A REAL BROWSER.
 *
 * THE FIRM, LOOKING AT THIS PANEL: "I'm not completely happy with how we look at the data details
 * here. It's important to show that a debtor has a mobile primary number. He could have a
 * secondary number, mobile. Then a work number -- I'd say a work number, because nobody has a home
 * number anymore. So an email address, there should be a second, an alternative email address. And
 * then the rest of the stuff... maybe we can add contact time, between certain hours, and then you
 * can choose the two hours and then add a different schedule."
 *
 * WHY THIS LAYER AND NOT ONLY check-contact-windows. That file reads the source and asserts the
 * slots are written down in the firm's order; it cannot tell you they came out in that order ON
 * SCREEN, which is a different question the moment a container query, a grid or a conditional sits
 * between the two. CLAUDE.md records why this layer exists at all: a panel shipped, was provably
 * in the deployed bundle, and was invisible.
 *
 * AND IT IS THE ONE PLACE THE HOURS CAN BE PROVED TO REACH THE DATABASE. The window is typed into
 * two pickers, added, and the PATCH is caught on the way out -- a control that draws correctly and
 * writes nothing looks identical until somebody reopens the account the next morning.
 *
 * Run: node scripts/qa/e2e/debtor-details.mjs
 */
import {
  OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer,
} from './harness.mjs'
import { COMPANY, PROFILE, TEAM, USER_ID, accountsPage } from './fixtures.mjs'

const t = makeRunner('debtor-details')

/*
 * ONE O'CLOCK IN JOHANNESBURG, which is deliberately between the two windows below. The caution is
 * the only thing on this panel that depends on what time it is, and a test running on the real
 * clock would assert it twice a day and deny it the rest of the time.
 */
const NOW = '2026-10-03T11:00:00Z'

const ACCOUNT = {
  ...accountsPage(1)[0],
  id: 'acc-0000',
  /* THE FIRM'S OWN EXAMPLE: "the debtor likes to be contacted between 8 and 9, and 7 and 5." */
  contact_windows: [{ from: '08:00', to: '09:00' }, { from: '17:00', to: '18:00' }],
  contact_preference: 'WhatsApp',
  preferred_language: 'Afrikaans',
}

const contact = (id, kind, value, extra = {}) => ({
  id, account_id: ACCOUNT.id, kind, value, label: null, person_name: null, person_role: null,
  is_primary: false, verified_at: null, retired_at: null, retired_reason: null, notes: null,
  created_at: '2026-03-01T08:00:00Z', ...extra,
})

const PRIMARY = '0632238046'
const SECOND = '0824567890'
const WORK = '0129410461'
/* A HOME LINE, which the firm says nobody has and the book keeps turning up. It has no slot and it
   is not thrown away: it belongs under "Anything else on file", wearing its own chip. */
const HOME = '0113334444'
const MAIL = 'stephan@urbanhausgroup.co.za'
const ALT_MAIL = 'stephan@gmail.com'
const THIRD_MAIL = 'accounts@urbanhausgroup.co.za'

/** Everything written back to debtor_accounts, so the hours can be proved to have left the page. */
const written = []

const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: PROFILE.email } })],
  [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [PROFILE] })],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [
    (u) => u.includes('/rest/v1/debtor_accounts'),
    (u, req) => {
      if (req.method() === 'PATCH') { written.push(req.postData() ?? ''); return { body: [] } }
      return { body: [ACCOUNT], headers: { 'content-range': '0-0/1' } }
    },
  ],
  [(u) => u.includes('/rest/v1/account_contacts'), () => ({
    body: [
      contact('ct-1', 'mobile', PRIMARY, { is_primary: true }),
      contact('ct-2', 'mobile', SECOND),
      contact('ct-3', 'work', WORK),
      contact('ct-4', 'email', MAIL),
      contact('ct-5', 'email', ALT_MAIL),
      contact('ct-6', 'phone', HOME),
      contact('ct-7', 'email', THIRD_MAIL),
    ],
  })],
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, PROFILE, handlers, [], { now: NOW })

  let up = false
  for (let i = 0; i < 40 && !up; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/accounts/${ACCOUNT.id}`, { timeout: 2000 }); up = true }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the account opens', up)
  await page.getByText('Debtor details').first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(2000)

  /* ---------- the slots, in the firm's order and on screen ---------- */

  const panel = page.locator('.\\@container\\/details').first()
  const text = await panel.innerText()
  const at = (s) => text.indexOf(s)

  const order = ['Mobile (Primary)', 'Mobile (Second)', 'Work number', 'Email address',
    'Alternative email', 'Residential address', 'Employer']
  /* PRESENT BEFORE ORDERED. indexOf returns -1, so an order-only assertion passes vacuously the
     day a slot is deleted -- the trap CLAUDE.md names, and it is the same here as in a unit file. */
  for (const label of order) t.ok(`"${label}" is drawn`, at(label) >= 0)
  t.ok('...and they come out in the firm’s order',
    order.every((label, i) => i === 0 || at(order[i - 1]) < at(label)))

  /* AND EACH HOLDS WHAT ITS LABEL SAYS, which is the half the old panel could not promise: one
     slot called "Alternative number" took whichever of a second cellphone and a work line came
     back first. */
  t.ok('the primary mobile is the number Call rings', at(PRIMARY) > at('Mobile (Primary)')
    && at(PRIMARY) < at('Mobile (Second)'))
  t.ok('...the second mobile is a mobile', at(SECOND) > at('Mobile (Second)') && at(SECOND) < at('Work number'))
  t.ok('...and the landline is the work number', at(WORK) > at('Work number') && at(WORK) < at('Email address'))
  t.ok('the first address is in the email slot', at(MAIL) > at('Email address') && at(MAIL) < at('Alternative email'))
  t.ok('...and the second has a slot of its own',
    at(ALT_MAIL) > at('Alternative email') && at(ALT_MAIL) < at('Residential address'))

  /* ---------- and everything beyond them is still on the file ---------- */

  /*
   * THE FIRM: "the other email addresses -- there's other email addresses here at the bottom now,
   * so it's kind of any additional info can come under there." A third address and a home line are
   * both that, and neither may vanish because the slots above are full.
   */
  t.ok('a home line nobody gave a slot is still drawn', at(HOME) > at('Anything else on file'))
  t.ok('...and so is a third email address', at(THIRD_MAIL) > at('Anything else on file'))

  /* ---------- the hours ---------- */

  t.ok('the panel asks when they may be telephoned', at('Best time to call') >= 0)
  t.ok('...and says both windows', text.includes('08:00') && text.includes('17:00'))
  /* ONE O'CLOCK IS NEITHER OF THEM, and the caution is the whole reason the hours are worth
     recording: a collector about to dial is the person who needs to know. */
  t.ok('...and that one o’clock is not one of them', text.includes('Not one of those hours now'))

  await t.shot(page, '10-debtor-details')

  /* ADDING ONE, AND PROVING IT LEFT THE PAGE. */
  await page.getByRole('button', { name: /08:00/ }).first().click()
  /* EXACT, because "To" also matches the aria-label on each window's remove button ("Remove 08:00
     to 09:00") and a checkbox elsewhere on the page. */
  const from = page.getByLabel('From', { exact: true })
  const to = page.getByLabel('To', { exact: true })
  await from.waitFor({ timeout: 5000 })
  await from.fill('12:00')
  await to.fill('13:00')
  /* SCOPED TO THE SLOTS: the page header carries an "Add" and so does the panel's own "+ Add". */
  await panel.locator('dl').getByRole('button', { name: 'Add', exact: true }).click()
  await page.waitForTimeout(600)
  t.check(`the new window was written (${written.length})`, written.length, 1)
  /* THE SHAPE THE COLUMN HOLDS, not whatever the control had in it: "HH:MM" either side, which is
     what parseWindows will take back out of jsonb and what sorts correctly as a string. */
  t.ok('...as hours and minutes under contact_windows',
    /"contact_windows":\[.*\{"from":"12:00","to":"13:00"\}/.test(written[0] ?? ''))
  /* AND THE TWO IT ALREADY HAD ARE STILL THERE. The list is written whole, so a save that forgot
     to carry the others would clear them and look exactly like a save that worked. */
  t.ok('...beside the two that were already on file',
    (written[0] ?? '').includes('"from":"08:00"') && (written[0] ?? '').includes('"from":"17:00"'))
  await t.shot(page, '20-hours-open')
} finally {
  if (browser) await browser.close()
  stopServer(server)
}

const good = t.finish(`
The debtor's file draws a primary mobile, a second mobile, a work number, an email address and an
alternative one — in that order, each holding what its label says — and the home line and third
address nobody gave a slot are still on the file underneath. The hours the debtor asked to be rung
in are drawn, a caller at one o'clock is told it is not one of them, and a window added in the two
pickers reaches the database as "HH:MM" without clearing the two already there. Screenshots in
${OUT}.`)
process.exit(good ? 0 : 1)
