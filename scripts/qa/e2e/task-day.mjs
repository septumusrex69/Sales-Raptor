/**
 * SEEING THE DAY'S LOAD BEFORE BOOKING ONTO IT, IN A REAL BROWSER.
 *
 * THE FIRM, on the Add Task box: "it asks you when, but it should look like a rediarisation almost
 * thing, to show you how many meetings do you have for a specific day." And on the list: "in the
 * tasks, maybe I should like be able to search for a specific day for my tasks... I think it's
 * important to see next week as well."
 *
 * WHY THIS NEEDS A BROWSER AND NOT A SOURCE CHECK. The thing being added is a three-week grid
 * inside a 520-pixel modal, and the failure this layer exists for is exactly that shape: a panel
 * that shipped, was provably in the bundle, and was invisible. check-day-plan can prove the
 * component is referenced and that the arithmetic is right; only a real Chromium can say the
 * counts are on the screen, the squares can be pressed, and the box still saves a task afterwards.
 *
 * THE COUNTS HERE ARE MEETINGS, and deliberately so: the fixture profile owns none of the mock
 * tasks, so every number on the grid traces back to a stubbed calendar row and the assertions can
 * be exact rather than "a digit appeared".
 *
 * Run: node scripts/qa/e2e/task-day.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE, USER_ID } from './fixtures.mjs'

const t = makeRunner('task-day')

/* A Wednesday, pinned. mockData reads the real clock for TODAY, so the whole page -- the views,
   the overdue count, the week strips -- hangs off this one value. */
const NOW = '2026-10-14T08:00:00+02:00'
/** The Thursday after it, which is where the meetings are. */
const THU = '2026-10-15'

const meeting = (id, title, startsAt) => ({
  id, owner_id: USER_ID, title, starts_at: startsAt, ends_at: null, all_day: false,
  starts_on: null, ends_on: null, location: 'Teams', notes: null, source: 'invite',
  ical_uid: `uid-${id}`, organiser_name: 'A Client', organiser_email: 'client@example.com',
  attendees: [], user_email_id: null, created_at: '2026-10-01T00:00:00Z',
})

const MEETINGS = [
  meeting('m1', 'Call centre discussion', `${THU}T09:00:00+02:00`),
  meeting('m2', 'Client review', `${THU}T14:00:00+02:00`),
]

const handlers = [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [PROFILE] })],
  [(u) => /\/rest\/v1\/calendar_events/.test(u), () => ({ body: MEETINGS })],
  [(u) => /\/rest\/v1\/firm_settings/.test(u), () => ({ body: [{ firm_name: 'Bredell Ferreira' }] })],
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { context, page } = await signedInPage(browser, PROFILE, handlers, [], { now: NOW })
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/tasks`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.waitForTimeout(2500)

  /* ---------------------------------------------------------------- next week */

  /*
   * THE BUTTON EXISTS AND IS A BUTTON. Asserted before anything is clicked: an order-only or
   * after-the-click assertion passes vacuously the day the control stops being drawn.
   */
  const nextWeek = page.getByRole('button', { name: 'Next Week', exact: true })
  t.check('the list offers next week', await nextWeek.count(), 1)
  await nextWeek.click()
  await page.waitForTimeout(400)
  /* AND IT IS THE VIEW THE PAGE IS ON -- in the URL, so a link to it can be sent to somebody. */
  t.ok('...and pressing it is the view the page is on', page.url().includes('view=Next+Week')
    || page.url().includes('view=Next%20Week'))

  /* ---------------------------------------------------------------- a day of their own choosing */

  const aDay = page.getByRole('button', { name: 'A day', exact: true })
  t.check('the list can be filtered to a day', await aDay.count(), 1)
  await aDay.click()
  await page.waitForTimeout(400)

  /*
   * THE SQUARE FOR THE THURSDAY, FOUND BY WHAT IT SAYS IT IS.
   *
   * The title carries the whole sentence -- the date and what is on it -- because a tooltip that
   * says only "2" is no help to somebody deciding. Which also makes it the honest thing to assert:
   * the number under the date and the sentence in the tooltip come from one DayCount.
   */
  const thu = page.locator('button[title*="Thursday, 15 October"]').first()
  t.check('the grid draws the day', await thu.count(), 1)
  const title = await thu.getAttribute('title')
  t.ok('...and says what is on it', /2 meetings/.test(title ?? ''))
  /* THE COUNT IS ON THE SQUARE, not only in the tooltip: the firm asked to SEE the load, and a
     number nobody hovers is a number nobody reads. */
  t.ok('...with the count on the square itself', /\b2\b/.test(await thu.innerText()))
  /* AND THE GRID IS ACTUALLY ON THE SCREEN. The failure this layer exists for. */
  const box = await thu.boundingBox()
  t.ok('...and the grid is visible, not merely rendered',
    !!box && box.width > 10 && box.height > 10)

  await thu.click()
  await page.waitForTimeout(500)
  t.ok('pressing a day filters the list to it', page.url().includes(`date=${THU}`))
  const dayText = await page.locator('body').innerText()
  t.ok('...and the day names itself', /15 October 2026/.test(dayText))
  /* THE SAME SENTENCE THE CALENDAR'S DRILLDOWN SHOWS. dayHeadline, one function, both routes. */
  t.ok('...and says what is on it', /2 meetings/.test(dayText))

  /* ---------------------------------------------------------------- and the Add Task box */

  await page.getByRole('button', { name: 'Add Task' }).first().click()
  await page.waitForTimeout(500)

  /*
   * THE BOX THAT BOOKS A TASK NOW SHOWS THE LOAD TOO, which is the firm's actual request.
   *
   * AND THE DATE FIELD IS GONE. An `<input type="date">` accepts the 15th exactly as readily when
   * the 15th already holds two client meetings, which is the whole complaint.
   */
  const modal = page.locator('[role="dialog"], .fixed').filter({ hasText: 'Add Task' }).last()
  t.check('the box no longer has a bare date field',
    await page.locator('input[type="date"]').count(), 0)
  const boxThu = page.locator('button[title*="Thursday, 15 October"]').last()
  t.check('the box draws the day grid', await boxThu.count(), 1)
  t.ok('...with the day\'s load on it', /2 meetings/.test(await boxThu.getAttribute('title') ?? ''))
  const boxBox = await boxThu.boundingBox()
  t.ok('...and it is visible inside the modal',
    !!boxBox && boxBox.width > 10 && boxBox.height > 10)

  await boxThu.click()
  await page.waitForTimeout(300)
  /* ONE SENTENCE ABOUT THE DAY ACTUALLY CHOSEN -- the grid shows the shape, this says what it
     means, because "2" means nothing to somebody who has not counted their own week. */
  t.ok('choosing a day says what that day holds',
    /Thursday, 15 October\s*·\s*2 meetings/.test(await modal.innerText()))

  await t.shot(page, 'task-day-box')

  /*
   * AND THE BOX STILL SAVES. A picker that replaced a working field and broke the form would be a
   * worse state than the field, so the task is actually added and found on the list afterwards.
   */
  await modal.getByLabel(/Task Title/i).fill('Ring the client back')
  await modal.getByRole('button', { name: 'Add Task', exact: true }).click()
  await page.waitForTimeout(700)
  const after = await page.locator('body').innerText()
  t.ok('a task booked on the grid is saved', /Ring the client back/.test(after))

  await t.shot(page, 'task-day')
  await context.close()
} finally {
  if (browser) await browser.close()
  stopServer(server)
}

process.exit(t.finish() ? 0 : 1)
