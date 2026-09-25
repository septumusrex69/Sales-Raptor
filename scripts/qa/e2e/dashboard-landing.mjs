/**
 * WHERE A PERSON ACTUALLY LANDS, AND WHERE "MY DASHBOARD" ACTUALLY GOES, IN A REAL BROWSER.
 *
 * THE FIRM MOVED THE LANDING PAGE. Everybody in the firm now opens Raptor on the company
 * dashboard — "it's important for everybody in the company to understand that we are a
 * collective, so it's important to go into the company dashboard as the first thing that you
 * see. And then you should go to your own stuff." The screen you land on is no longer an
 * accident of your role; the button is.
 *
 * WHAT THIS FILE USED TO GUARD, AND STILL DOES FROM THE OTHER END. The firm made a user, gave
 * them Pre-legal Agent, and Raptor opened on the COMMUNICATIONS dashboard — because their
 * profile carried a three-week-old Communications team and the router asked the team before the
 * role. That routing is gone, but the underlying mistake is still available to make: "go to my
 * dashboard" reading a stale team instead of the role would put the same person on the same
 * wrong floor, one click later.
 *
 * SOURCE CANNOT ANSWER THIS. A check beside this folder can say a map has the right values; it
 * cannot say what a pre-legal agent on a Communications team is looking at after they click,
 * which is the entire question. So it is asked here, of the running app.
 *
 * Run: node scripts/qa/e2e/dashboard-landing.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('dashboard-landing')

const COMMS_TEAM = { id: 'team-comms', name: 'Team Ballflick', kind: 'Communications', created_at: '2026-09-01T00:00:00Z' }
const SALES_TEAM = { id: 'team-sales', name: 'Team Raptor', kind: 'Sales', created_at: '2026-09-01T00:00:00Z' }

/* The firm's own number, which is what a notice falls back to when the person has none of their
   own -- the warning names it, so the fixture has to carry it. */
const FIRM = [{ firm_name: 'Bredell Ferreira', phone: '010 594 5065' }]

/** Sign in as `who`, open "/", and hand back the page plus what it says. */
async function land(browser, who, firm = FIRM) {
  const handlers = [
    [(u) => /\/rest\/v1\/profiles.*id=eq\./.test(u), () => ({ body: [who] })],
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [who] })],
    [(u) => /\/rest\/v1\/teams/.test(u), () => ({ body: [COMMS_TEAM, SALES_TEAM] })],
    [(u) => /\/rest\/v1\/firm_settings/.test(u), () => ({ body: firm })],
  ]
  const { context, page } = await signedInPage(browser, who, handlers, [])
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.waitForTimeout(2500)
  return { context, page, text: await page.locator('body').innerText() }
}

const server = await startServer()
let browser
try {
  browser = await chromium.launch()

  /*
   * THE FIRM'S OWN CASE: the role says pre-legal, the team still says Communications.
   */
  {
    const { context, page, text } = await land(browser, {
      ...PROFILE, id: 'u-stale', name: 'Stale Team', role: 'Pre-legal Agent', team_id: COMMS_TEAM.id,
    })
    /* The hero's own words, which only the company dashboard carries. Asserted positively rather
       than as "not Communications", which a blank page or a crash would also satisfy. */
    t.ok('a pre-legal agent lands on the company dashboard', /the beginning/i.test(text))
    t.ok('...not on the communications one', !/Communications Dashboard/.test(text))
    /* AND THE STALE TEAM DOES NOT DECIDE WHERE THEY GO NEXT. This is the Stefnova glitch, moved
       onto the button. */
    const href = await page.locator('a', { hasText: 'Go to my dashboard' }).first().getAttribute('href')
    t.check('...and their dashboard is the collections floor', href, '/dashboard/collections')

    /* Clicking it actually arrives — a correct href into a route nobody serves is a blank page. */
    await page.locator('a', { hasText: 'Go to my dashboard' }).first().click()
    await page.waitForTimeout(1500)
    const floor = await page.locator('body').innerText()
    t.ok('...and clicking it opens the floor', /Collections/.test(floor))
    /*
       ONE SCREEN WEARS THE PHOTOGRAPH. The firm: "all of the other dashboards can just have the
       other hero section. There should only be one very special page." So the floor must NOT
       carry the hero's line — a second epic screen is the thing that makes the first one ordinary.
    */
    t.ok('...and the floor does not wear the company hero', !/the beginning/i.test(floor))
    await context.close()
  }

  /* A pre-legal agent with no team at all — the case the old router's comment was written for. */
  {
    const { context, page, text } = await land(browser, {
      ...PROFILE, id: 'u-noteam', name: 'No Team', role: 'Pre-legal Agent', team_id: null,
    })
    t.ok('a pre-legal agent with no team lands on the company dashboard too', /the beginning/i.test(text))
    const href = await page.locator('a', { hasText: 'Go to my dashboard' }).first().getAttribute('href')
    t.check('...and their dashboard is still the floor', href, '/dashboard/collections')
    await context.close()
  }

  /* THE COMMUNICATIONS TEAM KEEPS ITS OWN SCREEN. This change must not take it away — everybody
     on that team who is not pre-legal is one click from exactly what they had. */
  {
    const { context, page, text } = await land(browser, {
      ...PROFILE, id: 'u-comms', name: 'Comms Person', role: 'Liaison', team_id: COMMS_TEAM.id,
    })
    t.ok('a liaison lands on the company dashboard', /the beginning/i.test(text))
    const href = await page.locator('a', { hasText: 'Go to my dashboard' }).first().getAttribute('href')
    t.check('...and their dashboard is communications', href, '/dashboard/communications')
    await page.locator('a', { hasText: 'Go to my dashboard' }).first().click()
    await page.waitForTimeout(1500)
    t.ok('...and clicking it opens theirs',
      /Communications/.test(await page.locator('body').innerText()))
    await context.close()
  }

  /* An administrator lands in the same place as everybody else, which is the point of it. */
  {
    const { context, page, text } = await land(browser, {
      ...PROFILE, id: 'u-admin', name: 'The Admin', role: 'Administrator', team_id: COMMS_TEAM.id,
    })
    t.ok('an administrator lands on the company dashboard as well', /the beginning/i.test(text))
    const href = await page.locator('a', { hasText: 'Go to my dashboard' }).first().getAttribute('href')
    t.check('...and their own screen is the office', href, '/dashboard/admin')
    await context.close()
  }
  /* ---------- you are missing your own number ---------- */

  /*
   * THE FIRM, TOLD THAT NOT ONE OF THE FIFTY LIVE PROFILES CARRIES A PHONE NUMBER: "if someone
   * doesn't have a phone number entered, it should be on their dashboard as a warning. Like
   * you're missing data... but then what it should do is it should give the company's default
   * details as contact, for example, Peter on 012 348 2156."
   *
   * ASKED HERE RATHER THAN OF THE SOURCE because the warning is a card that returns null in the
   * ordinary case, on the one screen everybody opens. A component that is written, is in the
   * bundle and never renders is exactly what this layer exists for.
   */
  {
    const { context, page, text } = await land(browser, {
      ...PROFILE, id: 'u-nophone', name: 'No Number', phone: null, whatsapp: null,
    })
    t.ok('somebody with no phone number is told so on the screen they land on',
      /no phone (or WhatsApp )?number for you/i.test(text))
    /* AND WHICH NUMBER GOES OUT INSTEAD, by name. "The firm's number" in the abstract is not
       something anybody can check against what a debtor is reading. */
    t.ok('...and the number a debtor gets instead is named', /010 594 5065/.test(text))
    /*
     * NOTHING IS HELD UP, and the card has to say so. The warning is about a better number, not a
     * blocked notice -- and "your notices are being held" is precisely the wrong sentence, since
     * held-on-a-missing-field is the bug this whole change removed. Read off the CARD rather than
     * the page: the word turns up elsewhere on a dashboard, and a body-wide search would make
     * this assertion about somebody else's copy.
     */
    const warning = page.locator('.card', { hasText: 'number for you' })
    /* READ DEFENSIVELY. innerText on a locator that matches nothing waits thirty seconds and then
       throws, two assertions below the one that should have reported the absence -- and takes the
       rest of the file with it. CLAUDE.md names this exact trap. */
    const card = await warning.count() > 0 ? await warning.first().innerText() : ''
    t.ok('...and the warning does not claim anything is being held',
      /nothing is held up/i.test(card) && !/being held|cannot be sent/i.test(card))
    /* One click to the one place they can fix it. Counted before it is read, for the reason
       above -- getAttribute on nothing waits and then throws. */
    const fix = page.locator('a', { hasText: 'Add it on your profile' })
    const href = await fix.count() > 0 ? await fix.first().getAttribute('href') : null
    t.check('...with the way to fix it on it', href, '/settings?tab=Profile')
    await context.close()
  }
  {
    /* THE HALF THAT KEEPS IT WORTH READING. CLAUDE.md: a warning that fires when nothing is
       wrong is worse than no warning. */
    const { context, text } = await land(browser, {
      ...PROFILE, id: 'u-hasphone', name: 'Has Number', phone: '012 348 2156', whatsapp: '082 123 4567',
    })
    t.ok('somebody whose details are in order is not warned about anything',
      !/number for you/i.test(text))
    await context.close()
  }
  {
    /* Only the half that is missing. A person with a desk phone and no WhatsApp is ordinary. */
    const { context, text } = await land(browser, {
      ...PROFILE, id: 'u-nowa', name: 'No WhatsApp', phone: '012 348 2156', whatsapp: null,
    })
    t.ok('a missing WhatsApp number is said on its own', /no WhatsApp number for you/i.test(text))
    t.ok('...without claiming the phone number is missing too', !/no phone number for you/i.test(text))
    await context.close()
  }
} catch (e) {
  /* A CRASH IS A FAILURE, REPORTED. Thrown out of the try this file prints a stack and no count,
     and run-all reads the count -- so a file that reports nothing is a file nobody sees. */
  t.ok(`the run finished without throwing (${String(e).slice(0, 140)})`, false)
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}

const good = t.finish(
  'Everybody in the firm opens Raptor on the company dashboard, and "Go to my dashboard" is\n'
  + 'decided by the role — a stale team cannot send a collector to somebody else\'s floor. And\n'
  + 'somebody with no phone number on Raptor is told so there, and told which number a debtor\n'
  + 'gets instead.',
)
process.exit(good ? 0 : 1)
