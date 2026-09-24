/**
 * WHICH DASHBOARD A PERSON ACTUALLY OPENS ON, IN A REAL BROWSER.
 *
 * The firm made a user, gave them Pre-legal Agent, and Raptor opened on the COMMUNICATIONS
 * dashboard — courtesy calls, meetings, client servicing, and not one collections figure. Their
 * profile carried a three-week-old Communications team, and DashboardRouter asked the team before
 * the role.
 *
 * SOURCE CANNOT ANSWER THIS. A check beside this folder can say the branches are in a particular
 * order; it cannot say which screen a pre-legal agent on a Communications team is looking at,
 * which is the entire question. So it is asked here, of the running app.
 *
 * Run: node scripts/qa/e2e/dashboard-landing.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('dashboard-landing')

const COMMS_TEAM = { id: 'team-comms', name: 'Team Ballflick', kind: 'Communications', created_at: '2026-09-01T00:00:00Z' }
const SALES_TEAM = { id: 'team-sales', name: 'Team Raptor', kind: 'Sales', created_at: '2026-09-01T00:00:00Z' }

/** Sign in as `who` and report the heading of the dashboard that renders. */
async function landOn(browser, who) {
  const handlers = [
    [(u) => /\/rest\/v1\/profiles.*id=eq\./.test(u), () => ({ body: [who] })],
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [who] })],
    [(u) => /\/rest\/v1\/teams/.test(u), () => ({ body: [COMMS_TEAM, SALES_TEAM] })],
  ]
  const { context, page } = await signedInPage(browser, who, handlers, [])
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.waitForTimeout(2500)
  const text = await page.locator('body').innerText()
  await context.close()
  return text
}

const server = await startServer()
let browser
try {
  browser = await chromium.launch()

  /*
   * THE FIRM'S OWN CASE: the role says pre-legal, the team still says Communications. Before this,
   * the team won.
   */
  {
    const text = await landOn(browser, {
      ...PROFILE, id: 'u-stale', name: 'Stale Team', role: 'Pre-legal Agent', team_id: COMMS_TEAM.id,
    })
    t.ok('a pre-legal agent on a Communications team does NOT get the Communications dashboard',
      !/Communications Dashboard/.test(text))
    /* Asserted positively as well: "not Communications" would also be satisfied by a blank page
       or a crash, which is not the same as landing correctly. */
    t.ok('...they get the collections floor', /Collection|Diary|Book|Promise/i.test(text))
  }

  /* A pre-legal agent with no team at all — the case the router's own comment was written for. */
  {
    const text = await landOn(browser, {
      ...PROFILE, id: 'u-noteam', name: 'No Team', role: 'Pre-legal Agent', team_id: null,
    })
    t.ok('a pre-legal agent with no team also lands on collections',
      !/Communications Dashboard/.test(text) && /Collection|Diary|Book|Promise/i.test(text))
  }

  /* AND THE COMMUNICATIONS TEAM STILL GETS THEIRS. This change must not take their screen away:
     everybody on that team who is NOT pre-legal is unaffected. */
  {
    const text = await landOn(browser, {
      ...PROFILE, id: 'u-comms', name: 'Comms Person', role: 'Liaison', team_id: COMMS_TEAM.id,
    })
    t.ok('a liaison on the Communications team still gets the Communications dashboard',
      /Communications Dashboard/.test(text))
  }

  /* An administrator is answered before either of them. */
  {
    const text = await landOn(browser, {
      ...PROFILE, id: 'u-admin', name: 'The Admin', role: 'Administrator', team_id: COMMS_TEAM.id,
    })
    t.ok('an administrator still gets the admin overview, team notwithstanding',
      !/Communications Dashboard/.test(text))
  }
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}

const good = t.finish(
  'A pre-legal agent lands on the collections floor whatever their team says, and the\n'
  + 'Communications team keeps its own dashboard.',
)
process.exit(good ? 0 : 1)
