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
  'GPS3/10103,48250.00,2026/03/18,Person,Van Der Westhuizen,jvdw@example.co.za',
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
  await acceptCard.getByPlaceholder(/A note for whoever works this account/)
    .fill('Confirm the email address with the client.')
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

  /* ONE QUERY, for the one account accepted with something wrong on it -- not for the clean one
     and not for the rejected one. */
  t.check('a query is raised for the account accepted with a problem', queriesRaised.length, 1)
  t.check("...as an import correction, not a debtor's dispute", queriesRaised[0]?.kind, 'import')
  t.check('...with the liaison', queriesRaised[0]?.stage, 'liaison')
  t.ok('...carrying the note that was typed',
    (queriesRaised[0]?.description ?? '').includes('Confirm the email address with the client.'))
  t.ok('...and the problem it overrode',
    /section 129 is sent by email/.test(queriesRaised[0]?.description ?? ''))
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
