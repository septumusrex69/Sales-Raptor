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
import { MAX_CH } from '../../../src/lib/handoverColumnWidth.ts'

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
  /* WHO LOOKS AFTER THE CLIENT. This is the liaison the corrections are raised with and emailed
     to -- AccountDetail reads the same column for its "Client liaison" line. */
  account_owner_id: PROFILE.id,
  /* Whom the liaison forwards it to, so the greeting has somebody to name. */
  contact_person: 'Thandi Nkosi',
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

/*
 * A DRAFT THAT SURVIVES BEING WRITTEN AND READ BACK, in memory.
 *
 * The table under test only exists after a sheet has been held, and holding it writes two tables
 * and then reads them again. Answered with an empty array, as an unstubbed table is, the save
 * appears to work and the read comes back with nothing — so the screen under test never renders.
 * Small enough to be a fixture; the verdicts are still computed by the real planHandover.
 */
const DRAFT_ID = '44444444-4444-4444-8444-444444444444'
const draftRows = []
let nextRowId = 0
/** What the screen asked to change about the draft itself, so a discard can be proved. */
const draftPatches = []
let discarded = false
/** Everything the approval wrote, so what reaches the client can be asserted. */
const queriesRaised = []
const accountsOpened = []
const mailSent = []
/** Any Annexure B fee raised on the way through. Must stay empty: see the assertion below. */
const feesRaised = []
/** Notes written onto opened accounts, so the per-row note can be proved to still land. */
const notesWritten = []
/** The batch rows the approval created. A query now hangs off one, so its id has to be real. */
const handoversCreated = []
const DRAFT = {
  id: DRAFT_ID, company_id: COMPANY_ID, filename: 'handover.csv', sheet_kind: 'raptor',
  date_order: 'day-first', state: 'draft', handover_id: null, approved_at: null,
  approved_by: null, created_by: PROFILE.id, created_at: '2026-09-21T00:00:00Z',
  updated_at: '2026-09-21T00:00:00Z',
}

const handlers = [
  /*
   * AN OBJECT WHERE .maybeSingle() ASKS FOR ONE, AN ARRAY EVERYWHERE ELSE.
   *
   * PostgREST returns one or the other depending on the Accept header supabase-js sends, and
   * answering every read with an array left `company.account_owner_id` undefined -- so the
   * approval found no liaison, emailed nobody, and said so. Which is correct behaviour on a
   * client that really has none, and useless as a test of the case that matters.
   */
  [(u) => /\/rest\/v1\/companies/.test(u) && /account_owner_id/.test(u), () => ({ body: CLIENT })],
  [(u) => /\/rest\/v1\/companies/.test(u), slowly([CLIENT])],
  [(u) => /\/rest\/v1\/profiles/.test(u) && /select=email/.test(u), () => ({ body: { email: ADMIN.email } })],
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rest\/v1\/teams/.test(u), () => ({ body: [TEAM] })],

  [(u, r) => /handover_draft_rows/.test(u) && r.method() === 'POST', (u, r) => {
    for (const row of JSON.parse(r.postData() ?? '[]')) {
      nextRowId += 1
      draftRows.push({
        id: `row-${nextRowId}`, draft_id: DRAFT_ID, line: row.line, values: row.values,
        document_filename: row.document_filename, excluded: false, decision: null, note: null,
        created_at: '2026-09-21T00:00:00Z', updated_at: '2026-09-21T00:00:00Z',
      })
    }
    return { body: [] }
  }],
  /* An edit: PATCH ...?id=eq.row-N, merged into the stored row so the next read re-judges it. */
  [(u, r) => /handover_draft_rows/.test(u) && r.method() === 'PATCH', (u, r) => {
    const id = decodeURIComponent(new URL(u).searchParams.get('id') ?? '').replace('eq.', '')
    const patch = JSON.parse(r.postData() ?? '{}')
    const row = draftRows.find((x) => x.id === id)
    if (row) Object.assign(row, patch)
    return { body: [] }
  }],
  [(u) => /handover_draft_rows/.test(u), () => ({ body: draftRows })],

  /*
   * THE BATCH ITSELF, which nothing here answered until a query needed its id.
   *
   * `/handover_drafts/` and `/handover_draft_rows/` both match their own literal, so a POST to
   * `/rest/v1/handovers` fell through to the harness default and the import read `batch.id` as
   * undefined -- with no error, because the insert appeared to succeed. Every account opened in
   * this fixture has been carrying an undefined handover_id ever since, and nothing asked.
   *
   * Ordered BEFORE the drafts handlers is not enough on its own -- the regexes do not overlap --
   * but it is put here so the three tables of one feature read together.
   */
  [(u, r) => /\/rest\/v1\/handovers\b/.test(u) && r.method() === 'POST', (u, r) => {
    handoversCreated.push(JSON.parse(r.postData() ?? '{}'))
    return { body: { id: `batch-${handoversCreated.length}` } }
  }],
  [(u, r) => /handover_drafts/.test(u) && r.method() === 'POST', () => ({ body: { id: DRAFT_ID } })],
  [(u, r) => /handover_drafts/.test(u) && r.method() === 'PATCH', (u, r) => {
    draftPatches.push(r.postData() ?? '')
    if ((r.postData() ?? '').includes('discarded')) discarded = true
    return { body: [] }
  }],
  /*
   * TWO SHAPES FROM ONE TABLE, and answering both the same way is what broke this first.
   * fetchDraft asks for ONE row by id and reads it with .maybeSingle(), so PostgREST returns an
   * object; fetchOpenDrafts asks for the whole queue and gets an ARRAY it calls .map on. Handed
   * the object, the list threw and the queue never rendered at all.
   */
  [(u, r) => /\/rest\/v1\/debtor_accounts/.test(u) && r.method() === 'POST', (u, r) => {
    const row = JSON.parse(r.postData() ?? '{}')
    accountsOpened.push(row)
    return { body: { ...row, id: `acct-${accountsOpened.length}`, created_at: '2026-09-22T00:00:00Z' } }
  }],
  [(u, r) => /account_fees/.test(u) && r.method() === 'POST', (u, r) => {
    feesRaised.push(r.postData() ?? '')
    return { body: [] }
  }],
  [(u, r) => /account_notes/.test(u) && r.method() === 'POST', (u, r) => {
    notesWritten.push(JSON.parse(r.postData() ?? '{}'))
    return { body: [] }
  }],
  [(u, r) => /account_queries/.test(u) && r.method() === 'POST', (u, r) => {
    const row = JSON.parse(r.postData() ?? '{}')
    queriesRaised.push(row)
    return { body: { ...row, id: `q-${queriesRaised.length}`, raised_at: '2026-09-22T00:00:00Z' } }
  }],
  [(u) => /handover_drafts/.test(u) && /id=eq\./.test(u), () => ({ body: DRAFT })],
  [(u) => /handover_drafts/.test(u), () => ({ body: discarded ? [] : [DRAFT] })],
]

/* The smallest sheet the planner accepts: the five required columns and one debtor. */
const SHEET = [
  'Your reference,Handover amount,Date of default,Person or business,Surname',
  'GPS3/10103,48250.00,18/03/2026,Person,Van Der Westhuizen',
].join('\n')

/*
 * A fuller sheet: one clean row, one REFUSED (an amount that is not a number) and one merely
 * WARNED (no email address) -- and no street address anywhere, which is the shape of the file the
 * firm actually sent.
 *
 * The third row is the one that matters for the gate. Written with only the first two, there was
 * no row that could be accepted at all -- a refusal offers no Accept, by design -- so the half of
 * the flow the firm asked for could not be reached.
 *
 * THE DATES ARE WRITTEN yyyy/mm/dd ON PURPOSE, which is what readXlsxRows produces from a real
 * .xlsx date cell. Written 18/03/2026 -- the way they look in Excel -- the display assertion
 * below passed against code that printed the raw cell, because a CSV hands the text straight
 * through and there was nothing to turn round.
 */
const FULL_SHEET = [
  'Your reference,Handover amount,Date of default,Person or business,Surname,Email address',
  /*
   * THE FIRM'S OWN ADDRESS, at its real length. Two things had to be true of it and the first
   * draft got the second one wrong:
   *   - LONGER THAN THE OLD ONE-SIZE COLUMN, or the clipping in the photograph cannot happen
   *     here and the check below passes against the unfixed code. `jvdw@example.co.za` fitted.
   *   - AND SHORTER THAN MAX_CH, or the clipping check EXCLUDES it as an allowed overflow and
   *     passes vacuously. A 34-character address did exactly that: only the width comparison
   *     noticed the width was gone.
   */
  'GPS3/10103,48250.00,2026/03/18,Person,Van Der Westhuizen,kagiso.molefe@example.co.za',
  'GPS3/10104,not money,2026/03/18,Person,Buitendag,',
  'GPS3/10105,1200.00,2026/03/18,Person,Ndlovu,',
].join('\n')


/*
 * THE CLIENT PICKER, which is a combobox over a listbox rather than a <select>.
 *
 * THE FIRM: "I don't like the drop down ... I should be able to search the client as well." So
 * these read the input's VALUE rather than a select's, and "the clients have arrived" is asked by
 * opening the panel and counting rows — there is no options.length to wait on any more.
 */
const clientBox = (page) => page.getByPlaceholder(/Search for a client/).first()

async function clientsLoaded(page) {
  await clientBox(page).waitFor({ timeout: 15000 })
  await clientBox(page).click()
  await page.waitForFunction(
    () => document.querySelectorAll('ul[role="listbox"] li[role="option"]').length > 0,
    null, { timeout: 15000 },
  )
  await page.keyboard.press('Escape')
}

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, ADMIN, handlers, [])

  /* SAME ORIGIN, so the supabase stub never sees it -- unrouted, the dev server answers 404 and
     the approval would report that it could not email anybody. */
  await page.route('**/api/email/send', async (route) => {
    mailSent.push(JSON.parse(route.request().postData() ?? '{}'))
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })

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

  await clientBox(page).waitFor({ timeout: 10000 })
  t.check('the client is already chosen',
    await clientBox(page).inputValue(), 'Northbank Properties (NBP)')

  /*
   * NOW COLD, which is the case the seeding has to survive and the click above does not reach.
   *
   * Arriving by click, AppStore is already full — the company page just rendered off it. Opening
   * the same address in a new tab, or reloading on it, mounts the import card with `clients`
   * EMPTY and filled in a moment later. Seeded from the initial render, the id is judged against
   * an empty list, found to be nobody, and thrown away before the client it names arrives.
   */
  await page.goto(`http://localhost:${PORT}/settings?tab=Data+Import&client=${COMPANY_ID}`)
  await clientBox(page).waitFor({ timeout: 15000 })
  await page.waitForFunction(
    () => (document.querySelector('input[role="combobox"]')?.value ?? '') !== '',
    null, { timeout: 10000 },
  ).catch(() => {})
  t.check('opened cold, the client is still chosen',
    await clientBox(page).inputValue(), 'Northbank Properties (NBP)')

  /*
   * AND IT CAN BE SEARCHED, which is what the firm asked for. Typed at the CODE, because that is
   * what they say out loud — "BRF" for Bredell Ferreira — and a native dropdown could only ever
   * jump to the first letter of the name.
   */
  await clientBox(page).click()
  await clientBox(page).fill('nbp')
  await page.waitForTimeout(300)
  const hits = page.locator('ul[role="listbox"] li[role="option"]')
  t.check('typing the client code finds it', await hits.count(), 1)
  t.ok('...and it is the right one', /Northbank/.test(await hits.first().innerText()))
  await clientBox(page).fill('zzzz')
  await page.waitForTimeout(300)
  t.check('a search that finds nobody offers nothing', await hits.count(), 0)
  /* NAMED, NOT EMPTY: a panel that opens on nothing reads as a broken picker. */
  t.ok('...and says so', /No client matches/.test(await page.locator('ul[role="listbox"]').innerText()))
  await page.keyboard.press('Escape')

  /*
   * TAPPING A CLIENT CLOSES THE LIST. THE FIRM: "the moment that I click on a client, it just
   * selects it, it has like this little tick, and then you have to close it manually."
   *
   * THE PICKER ALWAYS CLOSED ITSELF -- take() sets open to false. What reopened it was the
   * <label> around it: activating anything inside a label forwards the activation to the label's
   * control, so the row's own click selected the client and then focused the input underneath,
   * and the input opens on focus. FormField is a <label> too, so this was three of the five
   * places the picker is used.
   *
   * Asserted on the listbox being GONE rather than on the input's value: the value was always
   * right, which is exactly why this looked like a picker that ignores you rather than a bug.
   */
  /* Blurred first: the box opens on FOCUS, and after the Escape above it still has it -- so a
     click here would be a click on an already-focused input and open nothing. */
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await clientBox(page).click()
  await page.waitForTimeout(300)
  const rows = page.locator('ul[role="listbox"] li[role="option"]')
  t.ok('the list opens on the picker', await rows.count() > 0)
  await rows.first().click()
  await page.waitForTimeout(400)
  t.check('choosing a client closes the list',
    await page.locator('ul[role="listbox"]').count(), 0)
  t.ok('...and the client is chosen', (await clientBox(page).inputValue()).length > 0)

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
  /*
   * WAIT FOR THE CLIENTS TO LAND BEFORE READING THE SHEET, or this assertion passes for the
   * wrong reason. The seeding only runs once the list arrives; checked before that, the picker
   * is empty and Hold is disabled whether the guard exists or not. Written without this wait it
   * was green against code with the guard deleted, which is the trap CLAUDE.md names.
   */
  await clientsLoaded(page)
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
  await clientBox(page).waitFor({ timeout: 15000 })

  /*
   * THE WHOLE SHEET IS ON THE SCREEN, at the firm's asking: "I can see only limited information,
   * not all the information that was on the sheet ... all the fields of the handover sheet should
   * pretty much be in there. And it should show which data is wrong."
   */
  await page.goto(`http://localhost:${PORT}/settings?tab=Data+Import&client=${COMPANY_ID}`)
  await clientsLoaded(page)
  await page.setInputFiles('input[type="file"]', {
    name: 'handover.csv', mimeType: 'text/csv', buffer: Buffer.from(FULL_SHEET),
  })
  await page.getByRole('button', { name: 'Read the sheet' }).click()
  await page.getByRole('button', { name: 'Hold it in Raptor' }).click()
  await page.getByRole('button', { name: /Approve \d+ handover/ }).waitFor({ timeout: 20000 })

  /* The rows have to be ACCEPTED for this to be testing the table somebody actually uses. The
     first version of this fixture used a heading the importer did not know, so every row refused
     for having no name and the screen under test was a table of empty boxes. */
  t.ok('the good rows are accepted',
    /2 ready/.test(await page.locator('body').innerText()))

  const headers = await page.locator('table thead th').allTextContents()
  t.ok('every column of the sheet is on the screen', headers.length >= 40)
  for (const col of ['Street address 1', 'Email address', 'Employer', 'Next of kin']) {
    t.ok(`${col} is one of them`, headers.some((h) => h.trim().startsWith(col)))
  }
  /*
   * READ DEFENSIVELY FROM HERE. findIndex returns -1 for a column that is not on the screen, and
   * Playwright reads .nth(-1) as .last() -- so every assertion below would wait thirty seconds on
   * the wrong cell and then THROW, killing the run before the failure that caused it was ever
   * printed. Reverting the table to its old six columns did exactly that: a stack trace with no
   * failing assertion in it. CLAUDE.md names this one; this is it in a browser.
   */
  const columnAt = (heading) => {
    const i = headers.findIndex((h) => h.trim().startsWith(heading))
    t.ok(`there is a "${heading}" column to look at`, i >= 0)
    return i
  }
  const cell = (rowIndex, column) => (column < 0
    ? null
    : page.locator('table tbody tr').nth(rowIndex).locator('td').nth(column).locator('input'))

  /* An empty column is an empty BOX somebody can type in, which is what was missing: a row warned
     about an address with nowhere on the screen to put one. */
  const street = columnAt('Street address 1')
  const streetCell = cell(0, street)
  t.check('a column the sheet left empty is an empty box, not a missing one',
    streetCell ? await streetCell.inputValue() : '(no such column)', '')
  if (streetCell) {
    await streetCell.fill('14 Protea Street')
    await streetCell.blur()
  }

  /* AND THE WRONG CELL IS MARKED. The second row's amount is not a number. */
  const amount = columnAt('Handover amount')
  const badCell = cell(1, amount)
  const cls = badCell ? (await badCell.getAttribute('class')) ?? '' : ''
  t.ok('a cell that is wrong is marked on the cell', /negative|gold/.test(cls))
  t.ok('...and says why when you rest on it',
    badCell ? ((await badCell.getAttribute('title')) ?? '').includes('not a number') : false)
  /* A cell with nothing wrong is not marked, or the marking means nothing. */
  const okCell = cell(0, amount)
  t.ok('...and a cell that is fine is not marked',
    okCell ? !/negative|gold/.test((await okCell.getAttribute('class')) ?? '') : false)

  /*
   * DATES ARE SHOWN THE WAY SOUTH AFRICA WRITES THEM.
   *
   * THE FIRM: "this date of default that it says is wrong, it's actually in the right way --
   * first day, then month, then year. This is how we do it in South Africa. So everything else is
   * wrong, to be honest." The fixture's dates are 18/03/2026; read out of the sheet they arrive
   * as 2026/03/18, which is what the table used to print.
   */
  const dateCol = columnAt('Date of default')
  const firstDate = cell(0, dateCol)
  t.check('a date is shown day first', firstDate ? await firstDate.inputValue() : '', '18/03/2026')

  /* AND NO ESCAPE SEQUENCE REACHES THE SCREEN. \u2014 is a JavaScript string escape; in JSX text
     or an attribute it is just those six characters, which is what the firm was looking at. */
  const screenText = await page.locator('body').innerText()
  t.ok('no \\u escape is printed at anybody', !/\\u[0-9a-f]{4}/i.test(screenText))
  const ph = await page.getByPlaceholder(/A note for whoever works this account/).first()
    .getAttribute('placeholder')
  t.ok('...including in the note box', (ph ?? '').includes('—') && !(ph ?? '').includes('\\u'))

  /*
   * THE ROW NUMBER STAYS PUT WHILE THE OTHER FORTY COLUMNS GO PAST.
   *
   * THE FIRM: "keep the rows fixed to the left here so it doesn't move, so if you move around you
   * can always know in which row you are, because you're working on a specific query."
   *
   * MEASURED AFTER SCROLLING, because before it every column is at its resting place and the
   * assertion passes whether anything is pinned or not -- which is exactly the vacuous pass
   * CLAUDE.md warns about. The reference beside it is deliberately NOT pinned, so it moving is
   * half the proof: a table that simply did not scroll would satisfy the first half alone.
   */
  const scroller = page.locator('div.overflow-x-auto').filter({ has: page.locator('table') }).first()
  const rowCell = page.locator('table tbody tr').first().locator('td').first()
  const refCell = page.locator('table tbody tr').first().locator('td').nth(1)
  /* Wound back to the left first: earlier steps here filled a cell forty columns along, which
     scrolled the table to reach it -- so "before" was already most of the way across and the
     scroll below moved everything BACKWARDS. The measurement was right and the direction was
     not, which is the kind of assertion that fails for a reason nobody reads. */
  await scroller.evaluate((el) => { el.scrollLeft = 0 })
  await page.waitForTimeout(250)
  const before = { row: await rowCell.boundingBox(), ref: await refCell.boundingBox() }
  await scroller.evaluate((el) => { el.scrollLeft = 600 })
  await page.waitForTimeout(250)
  const moved = await scroller.evaluate((el) => el.scrollLeft)
  t.ok('the table really did scroll sideways', moved > 100)
  const after = { row: await rowCell.boundingBox(), ref: await refCell.boundingBox() }
  t.ok('the row number stays where it was',
    !!before.row && !!after.row && Math.abs(after.row.x - before.row.x) < 2)
  t.ok('...while everything beside it moves',
    !!before.ref && !!after.ref && before.ref.x - after.ref.x > 100)
  /* Pinned over the scrolled columns, not under them: without an opaque background the cells
     passing beneath show through and the number becomes unreadable at exactly the moment it is
     needed. Read off the computed style, because a class name proves nothing about paint order. */
  const paint = await rowCell.evaluate((el) => {
    const s = getComputedStyle(el)
    return { pos: s.position, left: s.left, bg: s.backgroundColor }
  })
  t.check('...and it is pinned rather than merely placed', paint.pos, 'sticky')
  t.check('...to the left edge', paint.left, '0px')
  t.ok('...over an opaque background', !/transparent|rgba\(0, 0, 0, 0\)/.test(paint.bg))
  /*
   * AND NOTHING IS CUT OFF. THE FIRM: "if there's written things like that, that goes into like a
   * hidden state, just make the thing longer so that the column is longer so I can actually see
   * that stuff." The photograph was an email column reading "kagiso.molefe@".
   *
   * Asked of EVERY cell rather than of the email one, because the complaint is about the rule and
   * not about that column -- and measured with scrollWidth against clientWidth, which is the
   * browser reporting that it had to hide something. A value past the cap is allowed to clip, so
   * the exception is stated rather than the assertion weakened to nothing.
   */
  const clipped = await page.$$eval('table tbody input', (els, cap) => els
    .filter((el) => el.scrollWidth > el.clientWidth + 1 && el.value.trim().length <= cap)
    .map((el) => el.value), MAX_CH)
  /* Joined into a string, not compared as an array: this runner's check is Object.is, so two
     empty arrays are not equal and the failure reads "expected [] got []". Joined, a failure
     names the values that were cut off, which is what somebody fixing it needs. */
  t.check('nothing in the table is cut off', clipped.join(' | '), '')
  /* And the widths are not simply all the same again: a column of addresses is wider than a
     column of dates, which is the whole of what content-sized means here. */
  const widthOf = async (heading) => {
    const i = columnAt(heading)
    const c = cell(0, i)
    const b = c ? await c.boundingBox() : null
    return b ? b.width : 0
  }
  const emailWidth = await widthOf('Email address')
  const dateWidth = await widthOf('Date of default')
  t.ok('an address column is wider than a date column', emailWidth > dateWidth + 10)

  await t.shot(page, 'upload-a-batch-pinned-row')
  await scroller.evaluate((el) => { el.scrollLeft = 0 })

  await t.shot(page, 'upload-a-batch-table')

  /*
   * THE HANDOVER IS HELD UNTIL EVERY PROBLEM HAS AN ANSWER.
   *
   * THE FIRM: "it should be in a pending state, and the approving cannot happen if all of the
   * bottom things have not been sorted out. For example an ID number is not correct -- then you
   * could say accept it, or reject it. You can also put in a note to the person working the
   * account."
   *
   * The second row of the fixture has an amount that is not a number (a refusal) and no email (a
   * warning), so two rows are waiting.
   */
  const approve = page.getByRole('button', { name: /Approve \d+ handover/ })
  t.check('approve is on the screen', await approve.count(), 1)
  t.check('...and is held', await approve.isDisabled(), true)
  const heldText = await page.locator('body').innerText()
  t.ok('...saying which rows it is waiting for', /needs? a decision/.test(heldText))
  /*
   * AND ITS COUNT IS HONEST WHILE IT IS HELD. This is the only moment the two numbers differ:
   * `ready` counts the warned row because nothing refuses it, and the gate does not because
   * nobody has decided it yet. Asserted after the decisions instead, both read 2 and the
   * assertion could not tell the old behaviour from the new one.
   */
  t.ok('...and offers only what is actually settled',
    /Approve 1 handover\b/.test(await approve.innerText()))

  /* A REFUSED ROW OFFERS NO ACCEPT. There is nothing to accept: it has no amount. */
  const rejects = page.getByRole('button', { name: 'Reject', exact: true })
  const accepts = page.getByRole('button', { name: 'Accept', exact: true })
  t.check('every waiting row can be rejected', await rejects.count(), 2)
  t.check('...but only the one that could be imported can be accepted', await accepts.count(), 1)

  /*
   * ACCEPT THE WARNED ROW, WITH A NOTE, which is the firm's own example.
   *
   * SCOPED TO THE SAME CARD AS THE BUTTON. Every waiting row has a note box, and taking the first
   * one on the page filled the REFUSED row's note and then accepted a different row with nothing
   * in it -- green on the accept, silent on the note, and the assertion below is what caught it.
   */
  const acceptCard = page.locator('div.rounded-lg.border').filter({ has: accepts.first() }).last()
  const noteBox = acceptCard.getByPlaceholder(/A note for whoever works this account/)

  /*
   * ---- THE BOX OPENS WITH THE INSTRUCTION ALREADY IN IT ----
   *
   * THE FIRM: "you can automatically fill the note for the clerk ... fill it automatically and
   * then just accept, and they can remove it if they need to."
   *
   * The row waiting here has no email address, so the suggestion is the one about a section 129
   * needing somewhere to go. Asserted in a browser because the box is filled from useState's
   * initialiser and this component re-renders on every save -- whether that opening value
   * survives, and whether it can then be emptied, is not a question source can answer.
   */
  t.ok('the note box opens with something already in it',
    (await noteBox.inputValue()).trim().length > 0)
  const opened = await noteBox.inputValue()
  /* AN INSTRUCTION, not the problem read back: the problem is printed directly above the box. */
  t.ok('...which says what to do about it', /ask for an email address/i.test(opened))
  t.ok('...and does not quote the fault back', !/no email address/i.test(opened))
  t.ok('...and is marked as a suggestion', /Suggested/.test(await acceptCard.innerText()))

  /*
   * AND IT CAN BE EMPTIED. Written as `value={note || suggested}` the box refills itself and
   * cannot be cleared at all -- and this note goes onto the account under the name of whoever
   * presses Accept, so words nobody could remove would be words put in their mouth.
   */
  await noteBox.fill('')
  await page.waitForTimeout(200)
  t.check('...and it can be emptied', await noteBox.inputValue(), '')
  t.ok('...which drops the suggested label with it',
    !/Suggested/.test(await acceptCard.innerText()))

  await noteBox.fill('Confirm the email address with the client.')
  await page.waitForTimeout(200)
  /* Once it is their wording it is no longer ours, and labelling it would be wrong. */
  t.ok('a note somebody typed is not called a suggestion',
    !/Suggested/.test(await acceptCard.innerText()))
  await acceptCard.getByRole('button', { name: 'Accept', exact: true }).click()
  await page.waitForTimeout(700)
  t.check('accepting records the note', await page.locator('text=Confirm the email address with the client.').count(), 1)
  t.ok('...and says so', /Accepted/.test(await page.locator('body').innerText()))
  /* One down, one to go: the refusal still holds it. */
  t.check('still held while the other row waits', await approve.isDisabled(), true)

  await rejects.first().click()
  await page.waitForTimeout(700)
  t.check('with everything decided, approve is offered', await approve.isDisabled(), false)
  /* AND THE COUNT AGREES WITH THE GATE. A button offering to import accounts it is refusing to
     import is the screen disagreeing with itself. */
  t.ok('...for the rows that will actually open',
    /Approve 2 handover/.test(await approve.innerText()))

  /*
   * A DECISION CAN BE TAKEN BACK, and taking it back holds the handover again -- a decision with
   * no way to undo it is a typo nobody can fix.
   *
   * SCOPED TO THE REJECTED ROW, and named rather than taken as `.first()`. Both cards say
   * "Change" by now; the first is the REFUSED one, so an unscoped click undid a rejection while
   * the test went on to look for the Accept button that a refusal never offers.
   */
  const rejectedCard = page.locator('div.rounded-lg.border')
    .filter({ hasText: 'GPS3/10104' }).last()
  await rejectedCard.getByRole('button', { name: 'Change', exact: true }).click()
  await page.waitForTimeout(700)
  t.check('changing a decision holds it again', await approve.isDisabled(), true)
  /* A refusal put back is still a refusal: it may be rejected again, never accepted. */
  t.check('...and a refused row still offers no Accept',
    await rejectedCard.getByRole('button', { name: 'Accept', exact: true }).count(), 0)
  await rejectedCard.getByRole('button', { name: 'Reject', exact: true }).click()
  await page.waitForTimeout(700)

  /* NOTHING ON THIS SCREEN SAYS ANYTHING IS POSTED. The firm: "we will never be posting
     something. Never ever we will post a letter. We will send everything via email." */
  const onScreen = (await page.locator('body').innerText()) ?? ''
  t.ok('nothing on the screen says a notice is posted', !/\bpost(ed|ing)\b/i.test(onScreen))
  t.ok('...and a missing email is what it warns about', /sent by email/.test(onScreen))

  /*
   * AND NOW APPROVE IT, which is where the client's side of this happens.
   *
   * THE FIRM: "if it was accepted with mistakes it should create a client query ... that would be
   * flagged at the client liaison. Also an email will be created and sent to the client liaison
   * with the problems."
   */
  t.check('re-answered, it is approvable again', await approve.isDisabled(), false)

  await approve.click()
  await page.waitForTimeout(2500)

  t.check('the accounts are opened', accountsOpened.length, 2)
  /* OUR REFERENCE, generated rather than read off a sheet that never had one. */
  t.ok('...each with our own reference',
    accountsOpened.every((a) => /^NBP\d{5}$/.test(a.account_number ?? '')))

  /*
   * ONE QUERY FOR THE WHOLE SHEET.
   *
   * THE FIRM: "let's say there's a handover sheet of 500 imports and 50 of them have problems.
   * Now there'll be 50 different individual queries. I think we should have a query per handover
   * sheet." It raised one per corrected account, which on a real batch is a liaison's client page
   * turned into fifty copies of the same sentence about fifty different debtors.
   *
   * This fixture has one row accepted with a problem and one rejected, so under the old shape it
   * raised one -- the same number, for a different reason. What tells them apart is WHAT IT HANGS
   * OFF, which is asserted next, and that is the assertion that matters here.
   */
  /* The batch is created before the first account, so a run that dies leaves something
     findable -- and the query below hangs off it, so its id has to be a real one. */
  t.check('the batch itself is created', handoversCreated.length, 1)
  t.ok('...carrying every account it opened',
    accountsOpened.every((a) => typeof a.handover_id === 'string'))

  t.check('one query is raised for the sheet', queriesRaised.length, 1)
  t.check('...against the batch, not one debtor', typeof queriesRaised[0]?.handover_id, 'string')
  t.check('...and against no single account', queriesRaised[0]?.account_id ?? null, null)
  t.check("...as an import correction, not a debtor's dispute", queriesRaised[0]?.kind, 'import')
  t.check('...with the liaison', queriesRaised[0]?.stage, 'liaison')
  /* It names the sheet, because a liaison with four clients and three sheets each cannot tell two
     queries apart by a count of accounts. */
  t.ok('...naming the sheet it is about',
    (queriesRaised[0]?.description ?? '').includes('handover.csv'))
  t.ok('...and what is outstanding on it',
    /could not be opened|open with something for the client to confirm/
      .test(queriesRaised[0]?.description ?? ''))
  /*
   * AND THE PER-ROW NOTE STILL LANDS ON THE ACCOUNT. That is where it always belonged -- it is
   * for whoever picks the account up, not for the client -- and moving the query to the batch
   * must not take it with it.
   */
  t.ok('the note typed on the row still reaches its account',
    notesWritten.some((n) => (n.body ?? '').includes('Confirm the email address with the client.')))
  t.ok('...with the problem it overrode',
    notesWritten.some((n) => /section 129 is sent by email/.test(n.body ?? '')))
  /* A category says why the DEBTOR objects, so it means nothing here and the database refuses it
     on any kind but a dispute. */
  t.check('...and no dispute category', queriesRaised[0]?.category ?? null, null)

  /* THE EMAIL. Written to be forwarded, so the liaison does not have to rewrite it. */
  t.check('one email goes to the liaison', mailSent.length, 1)
  t.check('...addressed to them', mailSent[0]?.to, ADMIN.email)
  /* "Data import for <client> — <date>", at the firm's asking: it led with the client's name and
     left the reader to work out what about it. */
  t.ok('...saying what it is, then whose',
    (mailSent[0]?.subject ?? '').startsWith('Data import for Northbank Properties'))
  t.ok('...with the reference in the table', /GPS3\/10105/.test(mailSent[0]?.bodyHtml ?? ''))
  t.ok('...and what the sheet left empty', /\(nothing\)/.test(mailSent[0]?.bodyHtml ?? ''))

  /*
   * AND THE ONE THAT DID NOT COME IN IS ON IT. THE FIRM: "there were more ones that I didn't
   * accept that should have been on this email." GPS3/10104 was rejected in this run, so the
   * client is told to send it again -- built from the accounts that WERE opened, it appeared
   * nowhere.
   */
  t.ok('the rejected account is on the email too',
    /GPS3\/10104/.test(mailSent[0]?.bodyHtml ?? ''))
  t.ok('...under a heading that asks for it again',
    /send these again/i.test(mailSent[0]?.bodyHtml ?? ''))

  /*
   * ---------- THE REFUSED ROWS GO BACK AS A SHEET, AND THE SHEET COMES BACK IN ----------
   *
   * THE FIRM: "those ones that were rejected, they should be attached in the email sent to the
   * client liaison. Only the rejected ones."
   *
   * A client sent a table of problems has to go back to their own spreadsheet and find each row
   * again. Sent their sheet back with only the refused rows on it, they fix the cells and send it
   * on -- so the file has to be one the importer will accept, and that is the half worth proving
   * in a browser. This uploads the attachment we just generated straight back into the import
   * screen and reads what the planner makes of it.
   */
  const attached = mailSent[0]?.attachments ?? []
  t.check('one file is attached to the liaison\u2019s email', attached.length, 1)
  t.ok('...named for the sheet the client sent', /handover/.test(attached[0]?.filename ?? ''))
  t.ok('...as a spreadsheet', (attached[0]?.contentType ?? '').includes('spreadsheetml'))

  const corrected = Buffer.from(attached[0]?.content ?? '', 'base64')
  t.ok('...and it is a real zip', corrected[0] === 0x50 && corrected[1] === 0x4b)

  /*
   * NOW READ IT BACK WITH THE IMPORTER. Bytes that open in Excel and bytes the importer reads are
   * different claims, and a writer nobody reads back produces a file the client corrects and we
   * then refuse. The unit check unzips it; only here does the real reader run.
   */
  /*
   * THE STUB ANSWERS EVERY DRAFT WITH THE SAME ROWS, so anything held earlier would still be on
   * screen and the assertions below would read it instead of the corrected sheet. Emptied here
   * rather than keyed by draft id because that is the smaller lie: this part of the run is about
   * one file, and written without it the round trip passed against a sheet of forty empty
   * columns -- it was reading the first upload's rows the whole time.
   */
  draftRows.length = 0
  await page.goto(`http://localhost:${PORT}/settings?tab=Data+Import&client=${COMPANY_ID}`)
  await clientsLoaded(page)
  await page.keyboard.press('Escape')
  await page.setInputFiles('input[type="file"]', {
    name: attached[0].filename,
    mimeType: attached[0].contentType,
    buffer: corrected,
  })
  /* Choosing the file only chooses it -- nothing is read until asked, which is the whole shape of
     this screen. Written without the click, the assertion below failed against a working writer. */
  await page.getByRole('button', { name: 'Read the sheet' }).click()
  await page.waitForTimeout(1500)
  await t.shot(page, 'upload-a-batch-corrected-sheet')
  /*
   * READ OFF THE PLAN SUMMARY, which is what this screen shows before anything is held. The rows
   * themselves only appear after "Hold it in Raptor", and holding it here would put a second
   * draft into a fixture that counts them -- so the assertion is on what the importer SAYS about
   * the file, which is the claim being made anyway.
   */
  const readBack = await page.locator('body').innerText()
  t.ok('the importer recognises it as our own handover sheet',
    /firm.s own handover sheet/i.test(readBack))
  t.ok('...with every column of it', /40 columns recognised/.test(readBack))
  /* ONE ROW: only the refused one goes back. The two that were opened are not asked for again,
     and a sheet that asked for them would have the client re-sending accounts already on the
     book -- which the importer would then refuse as duplicates of themselves. */
  t.ok('...carrying one row, the one that could not be opened',
    /\b1\b[\s\S]{0,40}rows with something in them/.test(readBack))
  /* Still refused, because the client has not corrected it yet -- presence before absence: a
     file that read as nothing at all would also show no accepted rows. */
  t.ok('...still not accepted, because nothing has been corrected yet',
    /\b1\b[\s\S]{0,40}reasons on each row/.test(readBack))
  /*
   * AND THE COLUMN WE ADDED IS IGNORED ON THE WAY BACK IN. It is last so the sheet's own columns
   * stay where they were, and unknown so the client may leave it or delete it -- the screen says
   * as much rather than refusing the file for it.
   */
  t.ok('...and the column we added is not mistaken for one of theirs',
    /not imported: What we need/.test(readBack))

  /*
   * AND THE CLIENT'S OWN VALUES CAME WITH IT. Held in Raptor so the row table is drawn, because
   * the summary above counts rows and says nothing about what is in them -- a sheet of forty
   * empty columns satisfies every assertion up to here and is useless to the client, who would
   * be retyping the row rather than correcting it.
   *
   * Safe to hold at this point: every assertion that counts drafts has already run.
   */
  await page.getByRole('button', { name: 'Hold it in Raptor' }).click()
  await page.waitForTimeout(1500)
  const held = await page.locator('body').innerText()
  t.ok('the row the client must correct is theirs, not a blank one', /GPS3\/10104/.test(held))
  t.ok('...with the name that was never the problem', /Buitendag/.test(held))
  /* Only the refused one: asking for the accounts already opened would have the client
     re-handing over debts that are on the book. */
  t.ok('...and not the rows that were opened', !/GPS3\/10103/.test(held))
  t.ok('...and the subject says how many need resending',
    /1 not brought in/.test(mailSent[0]?.subject ?? ''))
  /* Nothing that went out to a client may read "1 account need". */
  t.ok('...in the firm’s own English', !/\b1 accounts\b/.test(mailSent[0]?.bodyHtml ?? ''))
  /* Addressed to somebody, so the liaison does not have to top and tail it before forwarding. */
  t.ok('...and greets the person at the client',
    /Good day Thandi Nkosi,/.test(mailSent[0]?.bodyHtml ?? ''))

  /*
   * AND NOTHING WAS CHARGED TO A DEBTOR. A dispute raises Annexure B item 3 because the DEBTOR
   * objected; a client's sheet being wrong is their typing. This is the assertion that would cost
   * the firm a Council complaint if it ever stopped being true.
   *
   * TWO LOCKS, AND IT TAKES BOTH TO BREAK IT. `charge: false` at the call site is one;
   * escalationChargeable('import') inside raiseQuery is the other, and either alone holds. Setting
   * charge: true on its own raised nothing, which is the design working and also the reason this
   * line needed breaking twice before it proved anything: it only fails when the kind is a
   * dispute AND the call asks to charge.
   */
  t.check('no fee is raised against any debtor', feesRaised.length, 0)

  await page.goto(`http://localhost:${PORT}/settings?tab=Data+Import&client=${COMPANY_ID}`)
  await page.waitForTimeout(800)

  /*
   * A QUEUED SHEET CAN BE THROWN AWAY WITHOUT OPENING IT.
   *
   * THE FIRM: "there's another sheet that was now queued for handover that I didn't import and
   * complete. I should be able to delete that." Nothing on the waiting list could be got rid of
   * except by opening it first and discarding from inside.
   */
  await page.goto(`http://localhost:${PORT}/settings?tab=Data+Import&client=${COMPANY_ID}`)
  const queued = page.locator('text=Waiting to be approved')
  await queued.waitFor({ timeout: 15000 })
  /* COUNTED, NOT just .isVisible() on .first(). Asking whether the first match is visible says
     nothing when there is no match to be first -- and an exact-name lookup that finds nothing
     resolves to a locator that is simply never visible, which reads as a pass nowhere. */
  const discard = page.getByRole('button', { name: 'Discard', exact: true })
  t.check('a queued sheet offers to be discarded', await discard.count(), 1)

  /*
   * ASKED TWICE. One press must not throw anything away, or a mis-tap on an iPad does.
   *
   * WAITED OUT FIRST. Written as a bare check straight after the click this passed against code
   * with the confirm step deleted, because the request it is asserting the absence of had not
   * been made yet -- an absence checked too early is an absence of nothing.
   */
  /* COUNTED BY WHAT THEY SAY, not how many there are. Approving the handover PATCHes this same
     table to mark the draft approved, so a bare length check was counting that too. */
  const discards = () => draftPatches.filter((p) => p.includes('discarded')).length
  if (await discard.count()) await discard.click()
  await page.waitForTimeout(600)
  t.check('one press only asks', discards(), 0)
  const sure = page.getByRole('button', { name: 'Sure?', exact: true })
  t.check('...and says it is asking', await sure.count(), 1)

  /* GUARDED. Clicking a button that is not there throws, and a throw here kills the run before
     t.finish() prints the two assertions above that had ALREADY failed -- which is how deleting
     the confirm step came back as a stack trace with no failing check in it. */
  if (await sure.count()) await sure.click()
  await page.waitForTimeout(600)
  t.check('the second press discards it', discards(), 1)
  t.ok('...by marking it discarded rather than deleting it',
    draftPatches.some((p) => p.includes('"state":"discarded"') || p.includes("'state':'discarded'")))
  /* And it leaves the queue, so the screen agrees with what was just done. */
  await page.waitForTimeout(400)
  t.check('...and it goes off the waiting list',
    await page.getByRole('button', { name: 'Discard', exact: true }).count(), 0)

  /*
   * THE SETTINGS MENU FOLDS AWAY TOO. THE FIRM: "the pane on the left hand side has been
   * collapsed, but now that you've got all these other settings, that pane should also be able to
   * collapse, because now the screen is getting small."
   */
  await page.goto(`http://localhost:${PORT}/settings?tab=Data+Import&client=${COMPANY_ID}`)
  const tabList = page.getByRole('button', { name: 'Rejection Reasons', exact: true })
  await tabList.waitFor({ timeout: 15000 })
  t.check('the settings menu is there to begin with', await tabList.count(), 1)

  const narrow = page.getByRole('button', { name: /Narrow this menu/ })
  t.check('...and offers to fold away', await narrow.count(), 1)
  if (await narrow.count()) await narrow.click()
  await page.waitForTimeout(300)
  t.check('folded, the tab list is gone', await tabList.count(), 0)
  /* AND THE WAY BACK CARRIES WHERE YOU ARE. Folded to a bare icon, the one thing lost is which
     tab is open -- these tabs have no icons, and the panes do not all announce themselves. */
  const back = page.getByRole('button', { name: /Data Import/ })
  t.check('...and the way back says which tab is open', await back.count(), 1)

  /* REMEMBERED. A preference that resets on the next page load is not a preference. */
  await page.reload()
  await page.waitForTimeout(800)
  t.check('it is still folded after a reload',
    await page.getByRole('button', { name: 'Rejection Reasons', exact: true }).count(), 0)

  /*
   * AND IT IS ITS OWN PREFERENCE, not the main menu's: folding this must not fold that.
   *
   * ASSERTED ON THE MAIN MENU'S OWN TOGGLE, because its links do not tell you. Collapsed, the
   * sidebar hides each label and puts it in a `title` instead -- so "Accounts" is still there
   * under the same accessible name either way, and counting it proved nothing. Its toggle does
   * change: it reads "Narrow the menu" open and "Widen the menu" folded.
   */
  t.check('the main menu is still open', await page.locator('[title="Narrow the menu"]').count(), 1)
  t.check('...and has not folded itself',
    await page.locator('[title="Widen the menu"]').count(), 0)

  if (await back.count()) await back.click()
  await page.waitForTimeout(300)
  t.check('and it comes back', await tabList.count(), 1)

  /* Clicking away clears the client from the URL: it means nothing to any other tab, and a stale
     company id in the address of the Teams screen is a puzzle for whoever sees it next. */
  await page.getByRole('button', { name: 'Teams', exact: true }).first().click()
  await page.waitForFunction(() => !new URL(location.href).searchParams.get('client'), null,
    { timeout: 5000 }).catch(() => {})
  t.check('moving to another tab drops the client',
    new URL(page.url()).searchParams.get('client'), null)
  t.check('...and names the tab it moved to',
    new URL(page.url()).searchParams.get('tab'), 'Teams')
} catch (e) {
  /*
   * A THROW MUST NOT SWALLOW THE FAILURES THAT CAUSED IT.
   *
   * Playwright throws on a click or a waitFor that finds nothing, and an uncaught throw here
   * ends the process before t.finish() prints anything -- so breaking the thing under test came
   * back as a stack trace with no failing assertion in it, twice, and each time the assertions
   * HAD already failed and been recorded. Caught and recorded, the run reports what it knew.
   */
  t.check('the run finished without throwing', String(e).split('\n')[0], 'no error')
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
