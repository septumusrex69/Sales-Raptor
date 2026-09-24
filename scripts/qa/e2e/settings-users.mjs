/**
 * THE TEAM PICKER, IN A REAL BROWSER — INCLUDING WHEN THE TABLE DOES NOT LOAD.
 *
 * The firm: "when I load a user, I can't add it to a team." Seven teams sat in the database and
 * the picker offered one option: "No team". Nothing on the screen, and nothing in the source, was
 * wrong — `fetchTable` had swallowed a failed request, logged it to a console nobody has open on
 * an iPad, and handed the screen an empty array. A failed list and an empty list looked the same.
 *
 * THIS IS THE LAYER THAT CAN TELL THE DIFFERENCE. The rule checks beside this folder read source
 * and can only say the picker maps `teams`; they cannot say what a person sees when the request
 * behind `teams` returns 500. That is the entire bug, so it is tested where it happens.
 *
 * Run: node scripts/qa/e2e/settings-users.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('settings-users')

const ADMIN = { ...PROFILE, role: 'Administrator', name: 'The Administrator' }
/* The firm's own teams, near enough: two sales, five pre-legal. */
const TEAMS = ['Team Raptor', 'Team Ballflick', 'Pre-legal Alpha', 'Pre-legal Bravo',
  'Pre-legal Charlie', 'Pre-legal Delta', 'Pre-legal Echo']
  .map((name, i) => ({ id: `t-${i}`, name, kind: 'Sales', created_at: '2026-09-15T00:00:00Z' }))
const PEOPLE = [ADMIN, {
  ...PROFILE, id: 'u-2', name: 'A Collector', email: 'collector@raptor.test',
  role: 'Pre-legal Agent', team_id: 't-2',
}]

const base = [
  [(u) => /\/rest\/v1\/profiles.*id=eq\./.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: PEOPLE })],
]

/** The Settings > Users screen, with `teams` answered however the caller says. */
async function open(browser, teamsHandler) {
  const { context, page } = await signedInPage(browser, ADMIN, [...base, teamsHandler], [])
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/settings?tab=Users`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByRole('button', { name: 'Add User' }).waitFor({ timeout: 20000 })
  return { context, page }
}

/** The option labels of the LAST select on the page — the invite box's team picker. */
const teamOptions = (page) => page.evaluate(() => {
  const sels = Array.from(document.querySelectorAll('select'))
  const last = sels[sels.length - 1]
  return last ? Array.from(last.options).map((o) => o.text) : []
})

const server = await startServer()
let browser
try {
  browser = await chromium.launch()

  /* ---------- teams load: the picker offers them ---------- */
  {
    const { context, page } = await open(browser, [(u) => /\/rest\/v1\/teams/.test(u), () => ({ body: TEAMS })])
    await page.getByRole('button', { name: 'Add User' }).click()
    await page.getByLabel(/Team/).waitFor({ timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(500)
    const opts = await teamOptions(page)
    t.ok('the invite box offers a team picker', opts.length > 0)
    /* THE FIRM'S COMPLAINT, as an assertion: not just "more than one option" but every team. */
    t.check('...offering every team there is', opts.length, TEAMS.length + 1)
    t.ok('...with "No team" still first, since a team is optional', opts[0] === 'No team')
    for (const team of TEAMS) t.ok(`...including ${team.name}`, opts.includes(team.name))
    await context.close()
  }

  /* ---------- teams fail: the person is TOLD, not shown an empty list ---------- */
  {
    const { context, page } = await open(browser, [
      (u) => /\/rest\/v1\/teams/.test(u),
      () => ({ status: 500, body: { message: 'server error' } }),
    ])
    await page.waitForTimeout(2500)
    const text = await page.locator('body').innerText()
    /*
     * THIS IS THE WHOLE POINT. Before, this state was indistinguishable from "the firm has no
     * teams": the picker showed "No team" and the app said nothing at all.
     */
    t.ok('a table that failed to load is said out loud', /did not load/.test(text))
    t.ok('...and named, so somebody knows which list is lying', /teams/.test(text))
    await page.getByRole('button', { name: 'Add User' }).click()
    await page.waitForTimeout(500)
    const opts = await teamOptions(page)
    /* The picker is still honest about what it has -- it has nothing. The message is what
       carries the meaning, and that is the correct division. */
    t.check('the picker shows what it actually has', opts.join(' | '), 'No team')
    await context.close()
  }
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}

const good = t.finish(
  'The team picker offers every team, and a `teams` request that fails now SAYS so by name rather\n'
  + 'than presenting as a firm with no teams — which is what the firm met.',
)
process.exit(good ? 0 : 1)
