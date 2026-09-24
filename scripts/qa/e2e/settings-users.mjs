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
const person = (id, name, role, status = 'Active') => ({
  ...PROFILE, id, name, email: `${id}@raptor.test`, role, status, team_id: 't-2',
})
/* A floor with a ladder on it, and two people who have left. */
const PEOPLE = [ADMIN,
  person('u-2', 'A Collector', 'Pre-legal Agent'),
  person('u-3', 'Zed Agent', 'Pre-legal Agent'),
  person('u-4', 'Yolanda Leader', 'Pre-legal Team Leader'),
  { ...person('u-5', 'Mandla Manager', 'Call Centre Manager'), collector_grade: 'Elite' },
  { ...person('u-9', 'Unranked One', 'Pre-legal Agent'), collector_grade: null },
  person('u-6', 'Sipho Sales', 'Sales Manager'),
  person('u-7', 'Gone Person', 'Sales Representative', 'Inactive'),
  person('u-8', 'Also Gone', 'Pre-legal Agent', 'Inactive'),
]

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

  /* ---------- a hundred people, organised ---------- */
  {
    const { context, page } = await open(browser, [(u) => /\/rest\/v1\/teams/.test(u), () => ({ body: TEAMS })])
    await page.waitForTimeout(500)
    /* The users table is the first on the page; the collectors panel has one of its own. */
    const rows = await page.evaluate(() => Array.from(
      document.querySelectorAll('table')[0].querySelectorAll('tbody tr'),
    ).map((tr) => (tr.querySelector('th')
      ? `HEAD ${tr.innerText.replace(/\s+/g, ' ').trim()}`
      : `ROW ${(tr.querySelector('td')?.innerText || '').split('\n').pop().trim()}`)))

    const heads = rows.filter((r) => r.startsWith('HEAD'))
    t.ok('the list is grouped rather than one run of a hundred', heads.length >= 4)
    /* The firm's own order. */
    const order = ['ADMINISTRATION', 'SALES', 'CALL CENTRE'].map((d) => heads.findIndex((h) => h.includes(d)))
    t.ok('every department this fixture has is drawn', order.every((i) => i >= 0))
    t.ok('...in the firm’s order: the office, then sales, then the floor',
      order[0] < order[1] && order[1] < order[2])

    /*
     * THE LADDER, which is the part a name-sorted list destroys: manager above leader above
     * agents. Read as positions in the rendered table, not from the model.
     */
    const at = (name) => rows.findIndex((r) => r.includes(name))
    t.ok('the call centre manager is drawn above the team leader', at('Mandla Manager') < at('Yolanda Leader'))
    t.ok('...and the team leader above the agents', at('Yolanda Leader') < at('A Collector'))
    t.ok('...with the agents in their own order', at('A Collector') < at('Zed Agent'))

    /*
     * THE RANK, BESIDE THE TEAM. The firm: "you can put their rank, their grade -- rather call it
     * a rank -- next to the team that they're in." Read out of the rendered cell, because whether
     * a badge is actually drawn next to the team is not a question source can answer.
     */
    const teamCell = (name) => page.evaluate((who) => {
      const rows = Array.from(document.querySelectorAll('table')[0].querySelectorAll('tbody tr'))
      const row = rows.find((tr) => (tr.querySelector('td')?.innerText || '').includes(who))
      return row ? (row.querySelectorAll('td')[2]?.innerText || '').replace(/\s+/g, ' ').trim() : ''
    }, name)
    t.ok('a ranked collector shows their rank beside the team',
      /Elite/i.test(await teamCell('Mandla Manager')))
    /* An unranked collector is offered NO accounts at all, so a blank would hide a thing to fix. */
    t.ok('...and an unranked one says "no rank" rather than nothing',
      /no rank/i.test(await teamCell('Unranked One')))
    /* A rank on a sales rep would be a column of dashes down two thirds of the list. */
    t.ok('...while somebody who does not collect has no rank at all',
      !/rank|elite|senior|junior|skilled/i.test(await teamCell('Sipho Sales')))

    /*
     * AND A DEPARTMENT FOLDS. "Now it's just one long big list ... drop downs would be nice."
     * Asserted by counting rows, not by looking for a class: what matters is that the people
     * stop being drawn and the heading keeps its count.
     */
    const bodyRows = () => page.evaluate(() => document.querySelectorAll('table')[0].querySelectorAll('tbody tr').length)
    const before = await bodyRows()
    await page.getByRole('button', { name: /CALL CENTRE/i }).click()
    await page.waitForTimeout(300)
    const after = await bodyRows()
    t.ok('folding a department hides its people', after < before)
    t.ok('...and the heading is still there with its count',
      /CALL CENTRE/i.test(await page.locator('table').first().innerText()))
    await page.getByRole('button', { name: /CALL CENTRE/i }).click()
    await page.waitForTimeout(300)
    t.check('...and unfolding brings them back', await bodyRows(), before)

    /* Folded away, and the fold really is closed. */
    t.ok('the people who have left have their own heading', rows.some((r) => /NO LONGER HERE/.test(r)))
    t.ok('...and are not drawn until it is opened', at('Gone Person') < 0)
    await page.getByRole('button', { name: /No longer here/ }).click()
    await page.waitForTimeout(300)
    const opened = await page.evaluate(() => document.querySelectorAll('table')[0].querySelectorAll('tbody tr').length)
    t.check('...and appear when it is', opened, rows.length + 2)
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
