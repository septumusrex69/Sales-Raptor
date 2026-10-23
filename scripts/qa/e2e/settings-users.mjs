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
 * AND, SINCE 23 OCT, USERS AND TEAMS IN ONE PLACE. The firm: "There's two different tabs for users
 * and designing teams ... this should live in the same environment." The last block makes a
 * department, a team in it, gives the team a member and a lead, and places a person from All users
 * -- asserting on the WRITES the screen sends, because "the button did something" is not the claim;
 * "the database was asked for exactly this" is.
 *
 * Run: node scripts/qa/e2e/settings-users.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('settings-users')

/* The departments the migration of 23 Oct seeded, near enough. */
const DEPTS = [
  { id: 'd-1', name: 'Administration', head_id: null, duties: [], sort: 0, created_at: '2026-10-23T00:00:00Z' },
  { id: 'd-2', name: 'Sales', head_id: 'u-6', duties: [], sort: 1, created_at: '2026-10-23T00:00:00Z' },
  { id: 'd-3', name: 'Call centre', head_id: 'u-5', duties: [], sort: 3, created_at: '2026-10-23T00:00:00Z' },
]
const ADMIN = { ...PROFILE, role: 'Administrator', name: 'The Administrator', team_id: null, department_id: 'd-1' }
/* The firm's own teams, near enough: two sales, five pre-legal -- each in its department. */
const TEAMS = ['Team Raptor', 'Team Ballflick', 'Pre-legal Alpha', 'Pre-legal Bravo',
  'Pre-legal Charlie', 'Pre-legal Delta', 'Pre-legal Echo']
  .map((name, i) => ({
    id: `t-${i}`, name, kind: i < 2 ? 'Sales' : 'Call centre', department_id: i < 2 ? 'd-2' : 'd-3',
    lead_id: null, created_at: '2026-09-15T00:00:00Z',
  }))
const person = (id, name, role, status = 'Active') => ({
  ...PROFILE, id, name, email: `${id}@raptor.test`, role, status, team_id: 't-2', department_id: 'd-3',
})
/* A floor with a ladder on it, and two people who have left. */
const PEOPLE = [ADMIN,
  person('u-2', 'A Collector', 'Pre-legal Agent'),
  person('u-3', 'Zed Agent', 'Pre-legal Agent'),
  person('u-4', 'Yolanda Leader', 'Pre-legal Team Leader'),
  { ...person('u-5', 'Mandla Manager', 'Call Centre Manager'), collector_grade: 'Elite' },
  { ...person('u-9', 'Unranked One', 'Pre-legal Agent'), collector_grade: null },
  { ...person('u-6', 'Sipho Sales', 'Sales Manager'), team_id: null, department_id: 'd-2' },
  { ...person('u-7', 'Gone Person', 'Sales Representative', 'Inactive'), team_id: null, department_id: 'd-2' },
  person('u-8', 'Also Gone', 'Pre-legal Agent', 'Inactive'),
]

const base = [
  [(u) => /\/rest\/v1\/profiles.*id=eq\./.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: PEOPLE })],
  [(u) => /\/rest\/v1\/departments/.test(u), () => ({ body: DEPTS })],
]

/** The Settings > Users screen, with `teams` answered however the caller says. */
async function open(browser, teamsHandler, { path = '/settings?tab=Users', writes = [] } = {}) {
  const { context, page } = await signedInPage(browser, ADMIN, [...writes, ...base, teamsHandler], [])
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}${path}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByRole('tab', { name: 'All users' }).waitFor({ timeout: 20000 })
  return { context, page }
}

/** The option labels of the LAST select on the page — the invite box's team picker. */
const teamOptions = (page) => page.evaluate(() => {
  const sels = Array.from(document.querySelectorAll('select'))
  const last = sels[sels.length - 1]
  return last ? Array.from(last.options).map((o) => o.text) : []
})
const optionsOf = (locator) => locator.evaluate((el) => Array.from(el.options).map((o) => o.text))

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
    /*
     * THE FIRM'S COMPLAINT, as an assertion: not just "more than one option" but every team the
     * person may join -- since 23 Oct, every one IN THE DEPARTMENT chosen above it. A sales rep is
     * offered Sales by default, so both sales teams and nothing from the floor.
     */
    t.check('...offering every team in the department their role may join', opts.length, 3)
    t.ok('...with "No team" still first, since a team is optional', opts[0] === 'No team')
    for (const team of TEAMS.slice(0, 2)) t.ok(`...including ${team.name}`, opts.includes(team.name))
    t.check('the department is offered as the role’s own',
      await page.getByTestId('invite-department').evaluate((el) => el.options[el.selectedIndex].text), 'Sales')
    /* Change the role and the department and teams follow: the floor's five, not the sales two. */
    await page.locator('form select').first().selectOption('Pre-legal Agent')
    await page.waitForTimeout(300)
    const floor = await teamOptions(page)
    t.check('a pre-legal agent is offered the floor’s teams', floor.length, 6)
    t.ok('...and no sales team', !floor.includes('Team Raptor'))
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
    /* 23 Oct: the heading names the department's head. */
    t.ok('...and each heading names its head', heads.some((h) => /CALL CENTRE.*Head: Mandla Manager/i.test(h)))

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
    const cell = (name, i) => page.evaluate(([who, idx]) => {
      const rows = Array.from(document.querySelectorAll('table')[0].querySelectorAll('tbody tr'))
      const row = rows.find((tr) => (tr.querySelector('td')?.innerText || '').includes(who))
      return row ? (row.querySelectorAll('td')[idx]?.innerText || '').replace(/\s+/g, ' ').trim() : ''
    }, [name, i])
    const teamCell = (name) => cell(name, 2)
    t.ok('a ranked collector shows their rank beside the team',
      /Elite/i.test(await teamCell('Mandla Manager')))
    /* An unranked collector is offered NO accounts at all, so a blank would hide a thing to fix. */
    t.ok('...and an unranked one says "no rank" rather than nothing',
      /no rank/i.test(await teamCell('Unranked One')))
    /* A rank on a sales rep would be a column of dashes down two thirds of the list. */
    t.ok('...while somebody who does not collect has no rank at all',
      !/rank|elite|senior|junior|skilled/i.test(await teamCell('Sipho Sales')))
    /* 23 Oct: the row says Department, Team and Role, in that order. */
    const headers = await page.evaluate(() => Array.from(document.querySelectorAll('table')[0].querySelectorAll('thead th')).map((th) => th.innerText.trim()))
    t.check('the columns read User, Department, Team, Role', headers.slice(0, 4).join(' | '), 'User | Department | Team | Role')

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
  /* ---------- the number every notice gives a debtor ---------- */

  /*
   * A COLLECTOR'S PHONE IS NOT A PERSONAL DETAIL, it is what a section 129 prints on the line
   * "Direct line:" — and a merge field nothing fills holds the notice rather than posting braces
   * to a debtor. All fifty live profiles had no number, so no statutory demand could go out on
   * any account, and the only place to set one was the person's OWN Settings → Profile: fifty
   * people logging in before the first demand is sent.
   *
   * ASKED OF THE RENDERED MODAL, because "an administrator can fill these in" is a claim about a
   * form somebody has to open, not about a field existing in a file.
   */
  {
    const { context, page } = await open(browser,
      [(u) => /\/rest\/v1\/teams/.test(u), () => ({ body: TEAMS })])
    await page.waitForTimeout(1500)
    await page.getByTitle('Edit user').first().click()
    await page.getByText('Edit User', { exact: true }).waitFor({ timeout: 10000 })
    const modal = await page.locator('body').innerText()
    t.ok('an administrator can edit somebody else’s details', /Edit User/.test(modal))
    t.ok('...including the phone a notice quotes', /Phone/.test(modal))
    /* Said where it is typed: the consequence is not obvious from a field called "Phone". */
    t.ok('...and why it matters, beside the field itself',
      /section 129 on this person's\s*accounts holds/.test(modal))
    t.ok('...and WhatsApp, which is its own number', /WhatsApp/.test(modal))
    await context.close()
  }

  /* ---------- departments & teams: one place, and what it writes ---------- */
  {
    const sent = []
    /* Every write the screen makes, recorded and answered the way PostgREST would. */
    const writes = [[
      (u, req) => req.method() !== 'GET' && /\/rest\/v1\/(departments|teams|profiles)/.test(u),
      (u, req) => {
        const table = /\/rest\/v1\/(\w+)/.exec(u)[1]
        const id = /id=eq\.([^&]+)/.exec(u)?.[1] ?? null
        let body = null
        try { body = req.postDataJSON() } catch { body = null }
        sent.push({ method: req.method(), table, id, body })
        return { status: req.method() === 'POST' ? 201 : 200, body: { id: id ?? body?.id ?? 'x' } }
      },
    ]]
    const { context, page } = await open(browser, [(u) => /\/rest\/v1\/teams/.test(u), () => ({ body: TEAMS })],
      { path: '/settings?tab=Teams', writes })

    /* THE TEAMS TAB IS GONE, and its old address lands on Departments & teams. */
    await page.getByTestId('departments-teams').waitFor({ timeout: 10000 })
    const url = new URL(page.url())
    t.check('?tab=Teams is sent to Users', url.searchParams.get('tab'), 'Users')
    t.check('...on the Departments & teams tab', url.searchParams.get('users'), 'departments')
    t.check('there is no Teams item in the settings menu any more',
      await page.locator('nav').getByRole('button', { name: 'Teams', exact: true }).count(), 0)
    t.ok('the tree lists the departments', await page.getByTestId('tree-department-Call centre').count() === 1)
    t.ok('...with each department’s head', /Head: Mandla Manager/.test(await page.getByTestId('org-tree').innerText()))
    t.ok('...and its teams under it', await page.getByTestId('tree-team-Pre-legal Bravo').count() === 1)

    /* + Department. */
    await page.getByTestId('add-department').click()
    await page.getByTestId('new-department-name').fill('Reception')
    await page.getByRole('button', { name: 'Add department' }).click()
    await page.waitForTimeout(400)
    const madeDept = sent.find((w) => w.table === 'departments' && w.method === 'POST')
    t.ok('creating a department writes one', !!madeDept)
    t.check('...called what was typed', madeDept?.body?.name, 'Reception')
    t.check('...and the pane opens on it', (await page.getByTestId('pane-title').innerText()).trim(), 'Reception')
    t.ok('...with no head yet', /No head yet/.test(await page.getByTestId('department-head').innerText()))

    /* + Team, in it. Nothing in "Reception" or "Front desk" says which roles may join, so it is asked. */
    await page.getByTestId('add-team').click()
    await page.getByTestId('new-team-name').fill('Front desk')
    t.check('the new team is offered the department being looked at',
      await page.getByTestId('new-team-department').evaluate((el) => el.options[el.selectedIndex].text), 'Reception')
    t.ok('...and waits to be told who may join',
      await page.getByRole('button', { name: 'Add team' }).isDisabled())
    await page.getByTestId('new-team-kind').selectOption('Sales')
    await page.getByRole('button', { name: 'Add team' }).click()
    await page.waitForTimeout(400)
    const madeTeam = sent.find((w) => w.table === 'teams' && w.method === 'POST')
    t.ok('creating a team writes one', !!madeTeam)
    t.check('...in the department chosen', madeTeam?.body?.department_id, madeDept?.body?.id)
    t.check('...taking the roles chosen', madeTeam?.body?.kind, 'Sales')
    t.check('...and the pane opens on it', (await page.getByTestId('pane-title').innerText()).trim(), 'Front desk')

    /* A member, then the lead from the members. */
    await page.getByTestId('team-add-member').selectOption({ label: 'Sipho Sales — Sales Manager' })
    await page.waitForTimeout(400)
    const joined = sent.find((w) => w.table === 'profiles' && w.id === 'u-6')
    t.check('adding a member puts them in the team', joined?.body?.team_id, madeTeam?.body?.id)
    t.check('...and in its department, in the same write', joined?.body?.department_id, madeDept?.body?.id)
    await page.getByTestId('team-lead').getByRole('button', { name: 'Choose' }).click()
    const leadChoices = await optionsOf(page.getByLabel('Lead of Front desk'))
    t.check('the lead is chosen from the members only', leadChoices.join(' | '), 'Nobody | Sipho Sales')
    await page.getByLabel('Lead of Front desk').selectOption({ label: 'Sipho Sales' })
    await page.waitForTimeout(400)
    const led = sent.find((w) => w.table === 'teams' && w.method === 'PATCH' && 'lead_id' in (w.body ?? {}))
    t.check('setting the lead writes it on the team', led?.body?.lead_id, 'u-6')
    t.ok('...and the pane says so', /Sipho Sales/.test(await page.getByTestId('team-lead').innerText()))

    /* ALLOCATING FROM ALL USERS: department first, then a team inside it. */
    await page.getByRole('tab', { name: 'All users' }).click()
    await page.getByLabel('Department for A Collector').waitFor({ timeout: 10000 })
    const floorTeams = await optionsOf(page.getByLabel('Team for Mandla Manager'))
    t.ok('a row offers only the teams in that person’s department', floorTeams.includes('Pre-legal Bravo') && !floorTeams.includes('Team Raptor'))
    t.ok('...and says "Without a team" for none', floorTeams[0] === 'Without a team')
    await page.getByLabel('Department for A Collector').selectOption({ label: 'Administration' })
    await page.waitForTimeout(400)
    const moved = sent.filter((w) => w.table === 'profiles' && w.id === 'u-2').pop()
    t.check('choosing a department writes it', moved?.body?.department_id, 'd-1')
    t.ok('...and takes them out of the team, which was in the old one', 'team_id' in (moved?.body ?? {}) && moved.body.team_id === null)
    await page.getByLabel('Team for Mandla Manager').selectOption({ label: 'Pre-legal Bravo' })
    await page.waitForTimeout(400)
    const placed = sent.filter((w) => w.table === 'profiles' && w.id === 'u-5').pop()
    t.check('choosing a team writes it', placed?.body?.team_id, 't-3')
    t.check('...with its department beside it', placed?.body?.department_id, 'd-3')
    await context.close()
  }

  /* ---------- an iPad in portrait: the tree and the pane stack ---------- */
  {
    const { context, page } = await open(browser, [(u) => /\/rest\/v1\/teams/.test(u), () => ({ body: TEAMS })],
      { path: '/settings?tab=Users&users=departments' })
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.getByTestId('departments-teams').waitFor({ timeout: 10000 })
    await page.waitForTimeout(300)
    const tree = await page.getByTestId('org-tree').boundingBox()
    const pane = await page.getByTestId('pane-title').boundingBox()
    t.ok('on an iPad the pane sits under the tree, not squeezed beside it', !!tree && !!pane && pane.y > tree.y + tree.height - 1)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    t.ok('...and nothing scrolls sideways', overflow <= 1)
    await context.close()
  }

  /*
   * ---------- the organogram: the structure drawn, and reached from a department ----------
   *
   * The firm: "like you see all users, departments and team, and then organogram ... if you go to
   * the call center and you say view organogram." Asked of the rendered page because what matters is
   * what is DRAWN -- a head on the drawing, a vacant post as a box -- and that on an iPad the wide
   * company view scrolls inside its own box rather than dragging the page sideways.
   */
  {
    const { context, page } = await open(browser, [(u) => /\/rest\/v1\/teams/.test(u), () => ({ body: TEAMS })])
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.getByRole('tab', { name: 'Organogram' }).click()
    await page.getByTestId('organogram').waitFor({ timeout: 10000 })
    t.check('the Organogram tab is in the URL', new URL(page.url()).searchParams.get('users'), 'organogram')
    t.ok('the company is at the top, by the firm’s name', /Bredell Ferreira/.test(await page.getByTestId('organogram-firm').innerText()))
    for (const d of DEPTS) t.ok(`...with ${d.name} under it`, await page.getByTestId(`organogram-department-${d.name}`).count() === 1)
    t.ok('each department shows its head', /Mandla Manager/.test(await page.getByTestId('organogram-head-Call centre').innerText())
      && /Sipho Sales/.test(await page.getByTestId('organogram-head-Sales').innerText()))
    t.ok('...and a department with no head says so rather than drawing nothing',
      /No head yet/.test(await page.getByTestId('organogram-head-Administration').innerText()))
    t.ok('a team with no lead is drawn with the post vacant',
      /No lead yet/.test(await page.getByTestId('organogram-lead-Pre-legal Alpha').innerText()))
    const floor = await page.getByTestId('organogram-department-Call centre').innerText()
    t.check('the head is drawn once, not again in their team', floor.split('Mandla Manager').length - 1, 1)
    t.ok('people who have left are not on it', !/Gone Person|Also Gone/.test(await page.getByTestId('organogram').innerText()))
    const page_ = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    t.ok('on an iPad the page itself does not scroll sideways', page_ <= 1)
    /* SCROLLED, not measured: an element that merely overflows reports a scrollWidth too, while
       whatever clips it (the card, the layout) leaves the far departments unreachable. */
    const scrolled = await page.getByTestId('organogram-scroll').evaluate((el) => { el.scrollLeft = 120; return el.scrollLeft })
    t.ok('...the company view scrolls inside its own box instead', scrolled > 0)
    /* Folding a department takes its teams off the drawing and keeps the department. */
    await page.getByRole('button', { name: 'Fold Call centre' }).click()
    await page.waitForTimeout(300)
    t.check('a department folds away its teams', await page.getByTestId('organogram-team-Pre-legal Alpha').count(), 0)
    t.ok('...keeping its head', /Mandla Manager/.test(await page.getByTestId('organogram-head-Call centre').innerText()))
    /* Nothing on it is a control that changes anything. */
    t.check('the organogram offers no selects to change anyone', await page.getByTestId('organogram').locator('select').count(), 0)

    /* "VIEW ORGANOGRAM" FROM THE CALL CENTRE'S PANE. */
    await page.getByRole('tab', { name: 'Departments & teams' }).click()
    await page.getByTestId('tree-department-Call centre').click()
    await page.getByTestId('department-view-organogram').click()
    await page.getByTestId('organogram').waitFor({ timeout: 10000 })
    const url = new URL(page.url())
    t.check('"View organogram" opens the Organogram tab', url.searchParams.get('users'), 'organogram')
    t.check('...focused on that department', await page.getByTestId('organogram-focus').evaluate((el) => el.options[el.selectedIndex].text), 'Call centre')
    t.check('...drawing it alone', await page.locator('[data-testid^="organogram-department-"]').count(), 1)
    t.ok('...head first', /Mandla Manager/.test(await page.getByTestId('organogram-head-Call centre').innerText()))
    const fits = await page.getByTestId('organogram-scroll').evaluate((el) => el.scrollWidth - el.clientWidth)
    t.ok('...and on an iPad one department fits without scrolling', fits <= 1)
    await page.getByTestId('organogram-focus').selectOption({ label: 'Whole company' })
    await page.waitForTimeout(300)
    t.check('the picker goes back to the whole company', await page.locator('[data-testid^="organogram-department-"]').count(), DEPTS.length)

    /* FROM A TEAM'S PANE: its department, with the team lit. */
    await page.getByRole('tab', { name: 'Departments & teams' }).click()
    await page.getByTestId('tree-team-Pre-legal Bravo').click()
    await page.getByTestId('team-view-organogram').click()
    await page.getByTestId('organogram').waitFor({ timeout: 10000 })
    t.check('from a team, its department is drawn', await page.getByTestId('organogram-focus').evaluate((el) => el.options[el.selectedIndex].text), 'Call centre')
    t.check('...with that team lit', await page.getByTestId('organogram-team-Pre-legal Bravo').getAttribute('data-lit'), 'true')
    t.check('...and no other', await page.locator('[data-lit]').count(), 1)
    await context.close()
  }

} finally {
  if (browser) await browser.close()
  await stopServer(server)
}

const good = t.finish(
  'The team picker offers every team the person may join, a `teams` request that fails SAYS so by\n'
  + 'name, and users, departments and teams live in one place -- the firm’s "same environment".',
)
process.exit(good ? 0 : 1)
