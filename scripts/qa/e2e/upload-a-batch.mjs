/**
 * "Upload a batch" on a client's page, in a real browser.
 *
 * THE FIRM: "when I go to Bredell Ferreira as a client and I say upload a batch, it takes me
 * here" — and the screenshot was Settings, on the Profile tab.
 *
 * THE LINK WAS RIGHT AND THE PAGE IGNORED IT. CompanyDetail navigated to ?tab=Data Import;
 * SettingsPage held the tab in a useState seeded with 'Profile' and never read the query string.
 * Nothing failed, nothing was logged, and the only symptom was landing on somebody's own profile
 * after asking to import a book.
 *
 * NO SOURCE CHECK WOULD HAVE CAUGHT THIS. Both halves read correctly on their own: a link with a
 * query string, and a page with tabs. The fault is only in the joint, so the button has to be
 * clicked and the screen it lands on has to be looked at. That is what this is for.
 *
 * Run: node scripts/qa/e2e/upload-a-batch.mjs
 */
import {
  OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer,
} from './harness.mjs'
import { COMPANY_ID, PROFILE, TEAM } from './fixtures.mjs'

const t = makeRunner('upload-a-batch')

/* Data Import is Administrator-only, and this is the journey an Administrator makes. */
const ADMIN = { ...PROFILE, role: 'Administrator', name: 'Test Administrator' }

/* A CLIENT, WHICH MEANS A CODE OR A WON DEAL. Both CompanyDetail and the import's own picker
   decide it that way, so a company with neither would not show the button to click. */
const CLIENT = {
  id: COMPANY_ID,
  name: 'Northbank Properties',
  code: 'NBP',
  status: 'Won',
  owner_id: PROFILE.id,
  mandate_signed_at: '2026-02-01',
  created_at: '2026-01-01T00:00:00Z',
}

/*
 * THE COMPANIES ARRIVE LATE, ON PURPOSE.
 *
 * AppStore starts empty and fills in when its fetch lands, so on a cold load the import card
 * mounts with no clients and gets them a moment later. Answered instantly, the stub hides that
 * ordering completely and the seeding looks correct however it is written. Half a second is
 * enough to put the first render where it really is.
 */
const slowly = (body) => async () => {
  await new Promise((r) => setTimeout(r, 500))
  return { body }
}

const handlers = [
  [(u) => /\/rest\/v1\/companies/.test(u), slowly([CLIENT])],
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rest\/v1\/teams/.test(u), () => ({ body: [TEAM] })],
]

/* The smallest sheet the planner accepts: the five required columns and one debtor. */
const SHEET = [
  'Your reference,Handover amount,Date of default,Person or business,Surname',
  'GPS3/10103,48250.00,18/03/2026,Person,Van Der Westhuizen',
].join('\n')

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, ADMIN, handlers, [])

  let up = false
  for (let i = 0; i < 60; i += 1) {
    try {
      await page.goto(`http://localhost:${PORT}/companies/${COMPANY_ID}`, { timeout: 2000 })
      up = true
      break
    } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the dev server answers', up)

  const upload = page.getByRole('button', { name: 'Upload a batch' }).first()
  await upload.waitFor({ timeout: 20000 })
  /* PRESENCE FIRST. Everything below passes vacuously on a page with no such button. */
  t.ok('the client page offers to upload a batch', await upload.isVisible())
  /* And it no longer offers to type the numbers in: "if I record a batch, that is an absolutely
     useless exercise." */
  t.check('...and not to record one',
    await page.getByRole('button', { name: 'Record a batch' }).count(), 0)

  await upload.click()
  await page.waitForURL(/\/settings\?/, { timeout: 10000 })

  const url = new URL(page.url())
  t.check('it goes to Settings', url.pathname, '/settings')
  t.check('...naming the tab', url.searchParams.get('tab'), 'Data Import')
  t.check('...and the client', url.searchParams.get('client'), COMPANY_ID)

  /*
   * THE PART THAT WAS BROKEN. The URL was already right before this fix; what it landed on was
   * Profile. So assert the pane, not the address.
   */
  const heading = page.getByRole('heading', { name: 'Import a handover' }).first()
  await heading.waitFor({ timeout: 15000 }).catch(() => {})
  t.ok('the handover import is on the screen', await heading.isVisible().catch(() => false))
  t.check('...and it did not land on Profile',
    await page.getByRole('heading', { name: 'Profile', exact: true }).count(), 0)

  /*
   * AND THE CLIENT IS ALREADY CHOSEN. Somebody who pressed the button on Bredell Ferreira's own
   * page has said whose handover it is; asking again is the app forgetting where they came from.
   * The <select> is read by VALUE, because a select showing "Choose a client…" while its state
   * holds an id is exactly the failure a label check would miss.
   */
  await t.shot(page, 'upload-a-batch-landed')

  const picker = page.locator('select').first()
  await picker.waitFor({ timeout: 10000 })
  t.check('the client is already chosen', await picker.inputValue(), COMPANY_ID)

  /*
   * NOW COLD, which is the case the seeding has to survive and the click above does not reach.
   *
   * Arriving by click, AppStore is already full — the company page just rendered off it. Opening
   * the same address in a new tab, or reloading on it, mounts the import card with `clients`
   * EMPTY and filled in a moment later. Seeded from the initial render, the id is judged against
   * an empty list, found to be nobody, and thrown away before the client it names arrives.
   */
  await page.goto(`http://localhost:${PORT}/settings?tab=Data+Import&client=${COMPANY_ID}`)
  const coldPicker = page.locator('select').first()
  await coldPicker.waitFor({ timeout: 15000 })
  await page.waitForFunction(
    (id) => document.querySelector('select')?.value === id, COMPANY_ID, { timeout: 10000 },
  ).catch(() => {})
  t.check('opened cold, the client is still chosen', await coldPicker.inputValue(), COMPANY_ID)

  /*
   * A CLIENT ID NOBODY RECOGNISES IS NOT CHOSEN AT ALL — asserted through the Hold button, not
   * through the picker.
   *
   * This first read the <select>'s value and proved nothing: a select whose value matches no
   * option reports an empty string, which is exactly what it reports when nothing was chosen.
   * The two cases are indistinguishable there. Where they differ is what the screen then lets
   * you do — with a bogus id in state the picker still shows "Choose a client…" while Hold is
   * enabled, which is the worst of both and the thing the guard exists to prevent.
   */
  await page.goto(`http://localhost:${PORT}/settings?tab=Data+Import&client=not-a-company`)
  await page.locator('select').first().waitFor({ timeout: 15000 })
  /*
   * WAIT FOR THE CLIENTS TO LAND BEFORE READING THE SHEET, or this assertion passes for the
   * wrong reason. The seeding only runs once the list arrives; checked before that, the picker
   * is empty and Hold is disabled whether the guard exists or not. Written without this wait it
   * was green against code with the guard deleted, which is the trap CLAUDE.md names.
   */
  await page.waitForFunction(
    () => (document.querySelector('select')?.options.length ?? 0) > 1, null, { timeout: 15000 },
  )
  await page.setInputFiles('input[type="file"]', {
    name: 'handover.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(SHEET),
  })
  await page.getByRole('button', { name: 'Read the sheet' }).click()
  const hold = page.getByRole('button', { name: 'Hold it in Raptor' })
  await hold.waitFor({ timeout: 15000 })
  t.ok('the sheet was read', await hold.isVisible())
  t.ok('...but a client we do not know cannot be held against', await hold.isDisabled())

  await page.goto(`http://localhost:${PORT}/settings?tab=Data+Import&client=${COMPANY_ID}`)
  await page.locator('select').first().waitFor({ timeout: 15000 })

  /* Clicking away clears the client from the URL: it means nothing to any other tab, and a stale
     company id in the address of the Teams screen is a puzzle for whoever sees it next. */
  await page.getByRole('button', { name: 'Teams', exact: true }).first().click()
  await page.waitForFunction(() => !new URL(location.href).searchParams.get('client'), null,
    { timeout: 5000 }).catch(() => {})
  t.check('moving to another tab drops the client',
    new URL(page.url()).searchParams.get('client'), null)
  t.check('...and names the tab it moved to',
    new URL(page.url()).searchParams.get('tab'), 'Teams')
} finally {
  if (browser) await browser.close()
  stopServer(server)
}

const good = t.finish(`
A button that navigates and a page that ignores the navigation both read correctly on their own.
The joint between them is only visible from a browser, which is why this clicks the button and
then looks at what is on the screen -- and at the picker's VALUE, not its label. Screenshots in
${OUT}.`)
process.exit(good ? 0 : 1)
