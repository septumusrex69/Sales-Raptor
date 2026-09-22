/**
 * A client query about a handover, in a real browser — and the second go at the rows it refused.
 *
 * THE FIRM: "a query should have a card, like the same as a deal, with the details of the query
 * on the inside ... this ticket for a handover that is in an awaiting state should show all of
 * the details like it's ready for an import, and when the details is changed it can be approved
 * and imported."
 *
 * WHY THIS NEEDS A BROWSER. The rules around it are checked beside this folder and none of them
 * can tell you the table never rendered on this page. It is the SAME DraftTable the import screen
 * draws, lifted onto a different route with different data around it, and a shared component that
 * is provably in the bundle and invisible on one of its two screens is exactly the failure this
 * layer exists to catch.
 *
 * Run: node scripts/qa/e2e/query-ticket.mjs
 */
import {
  OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer,
} from './harness.mjs'
import { COMPANY_ID, PROFILE } from './fixtures.mjs'

const ADMIN = { ...PROFILE, role: 'Administrator', name: 'Test Administrator' }

const t = makeRunner('query-ticket')

const QUERY_ID = '11111111-1111-4111-8111-111111111111'
const BATCH_ID = '22222222-2222-4222-8222-222222222222'
const DRAFT_ID = '33333333-3333-4333-8333-333333333333'
const FOLLOW_ID = '44444444-4444-4444-8444-444444444444'

/** The query the import raised: about a batch, not an account. */
const QUERY = {
  id: QUERY_ID, account_id: null, handover_id: BATCH_ID,
  description: 'handover.csv — 1 account could not be opened and needs to be sent again.',
  kind: 'import', category: null, status: 'open', stage: 'liaison',
  owner_id: PROFILE.id, raised_by: PROFILE.id, raised_by_name: 'Handover import',
  raised_at: '2026-09-22T06:00:00Z', chase_on: null,
  outcome: null, outcome_action: null, outcome_amount: null, outcome_done: false,
  closed_at: null, closed_by: null, closed_by_name: null,
  created_at: '2026-09-22T06:00:00Z', updated_at: '2026-09-22T06:00:00Z',
}

const BATCH = {
  id: BATCH_ID, company_id: COMPANY_ID, reference: 'handover.csv',
  received_at: '2026-09-22T06:00:00Z',
}

const ORIGINAL = {
  id: DRAFT_ID, company_id: COMPANY_ID, filename: 'handover.csv', sheet_kind: 'raptor',
  date_order: 'day-first', state: 'approved', handover_id: BATCH_ID, from_query_id: null,
  approved_at: '2026-09-22T06:00:00Z', approved_by: PROFILE.id, created_by: PROFILE.id,
  created_at: '2026-09-21T00:00:00Z', updated_at: '2026-09-22T06:00:00Z',
}

/*
 * ONE ROW THAT CAME IN AND ONE THAT DID NOT. Both, because a follow-up that copied the whole
 * sheet would re-import an account already on the book — and a fixture with only the refused row
 * could not tell the difference.
 */
const ORIGINAL_ROWS = [
  {
    id: 'row-ok', draft_id: DRAFT_ID, line: 2,
    values: {
      client_reference: 'GPS3/10103', name: 'Van Der Westhuizen', capital: '48250.00',
      default_date: '2026/03/18', debtor_kind: 'Person', email_1: 'jvdw@example.co.za',
    },
    document_filename: null, excluded: false, decision: null, note: null,
    created_at: '2026-09-21T00:00:00Z', updated_at: '2026-09-21T00:00:00Z',
  },
  {
    id: 'row-bad', draft_id: DRAFT_ID, line: 3,
    values: {
      client_reference: 'GPS3/10104', name: 'Buitendag', capital: 'not money',
      default_date: '2026/03/18', debtor_kind: 'Person', email_1: 'ryno@example.co.za',
    },
    document_filename: null, excluded: false, decision: null, note: null,
    created_at: '2026-09-21T00:00:00Z', updated_at: '2026-09-21T00:00:00Z',
  },
]

/** What the ticket wrote. The point of the run is what is in here at the end. */
const draftsCreated = []
const rowsCreated = []
const rowPatches = []
const accountsOpened = []
let followUp = null
/** The follow-up's rows, which the screen edits and then imports. */
let followRows = []

const handlers = [
  /*
   * THE PROFILE, BOTH SHAPES. Without these the run ended on "We couldn't load your profile" --
   * every assertion having passed, because the import itself had already happened. The screenshot
   * is what showed it, which is the argument for taking one at the end at all.
   *
   * An OBJECT where .maybeSingle() asks for one and an ARRAY everywhere else: PostgREST returns
   * whichever the Accept header asks for, and answering both the same way is what left the
   * liaison's address undefined in the sibling fixture.
   */
  [(u) => /\/rest\/v1\/profiles/.test(u) && /select=email/.test(u),
    () => ({ body: { email: ADMIN.email } })],
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rest\/v1\/teams/.test(u), () => ({ body: [] })],

  [(u) => /\/rest\/v1\/companies/.test(u) && /id=eq\./.test(u),
    () => ({ body: { id: COMPANY_ID, name: 'Northbank Properties', commission_rate: 0.25 } })],
  [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [{ id: COMPANY_ID, name: 'Northbank Properties' }] })],
  /*
   * ONE ROW WHERE ONE IS ASKED FOR, A LIST EVERYWHERE ELSE -- and both of these are asked for
   * both ways. The app's own store reads `handovers` as a whole table on sign-in, so answering
   * every request with the single object put "(data ?? []).map is not a function" across the
   * screen while every assertion here still passed. The screenshot is what showed it.
   */
  [(u) => /\/rest\/v1\/account_queries/.test(u) && /id=eq\./.test(u), () => ({ body: QUERY })],
  [(u) => /\/rest\/v1\/account_queries/.test(u), () => ({ body: [QUERY] })],
  [(u) => /\/rest\/v1\/handovers\b/.test(u) && /id=eq\./.test(u), () => ({ body: BATCH })],
  [(u) => /\/rest\/v1\/handovers\b/.test(u), () => ({ body: [BATCH] })],

  /*
   * THE DRAFT IS ASKED FOR TWO WAYS and they are different questions: by the batch it became
   * (the original, frozen) and by the query it caused (the follow-up, which does not exist until
   * the button is pressed). Answering both the same way is what would make the ticket show the
   * original as though it were editable.
   */
  /*
   * THE VALUE IS HONOURED, not just the shape of the filter. Answering every
   * `from_query_id=eq.*` with the draft meant a lookup for the WRONG query still found it -- so
   * breaking the lookup changed nothing here and the check passed on code that could never find
   * a follow-up again.
   */
  [(u) => /handover_drafts/.test(u) && new RegExp(`from_query_id=eq\\.${QUERY_ID}`).test(u),
    () => ({ body: followUp })],
  [(u) => /handover_drafts/.test(u) && /from_query_id=eq\./.test(u), () => ({ body: null })],
  [(u) => /handover_drafts/.test(u) && /handover_id=eq\./.test(u),
    () => ({ body: { id: DRAFT_ID } })],
  [(u, r) => /handover_drafts/.test(u) && r.method() === 'POST', (u, r) => {
    const row = JSON.parse(r.postData() ?? '{}')
    draftsCreated.push(row)
    followUp = { ...ORIGINAL, ...row, id: FOLLOW_ID, state: 'draft', handover_id: null }
    return { body: { id: FOLLOW_ID } }
  }],
  [(u, r) => /handover_drafts/.test(u) && r.method() === 'PATCH', () => ({ body: [] })],
  [(u) => /handover_drafts/.test(u) && new RegExp(`id=eq.${FOLLOW_ID}`).test(u),
    () => ({ body: followUp })],
  [(u) => /handover_drafts/.test(u) && /id=eq\./.test(u), () => ({ body: ORIGINAL })],

  [(u, r) => /handover_draft_rows/.test(u) && r.method() === 'POST', (u, r) => {
    for (const row of JSON.parse(r.postData() ?? '[]')) {
      rowsCreated.push(row)
      followRows.push({
        id: `follow-${followRows.length + 1}`, draft_id: FOLLOW_ID, line: row.line,
        values: row.values, document_filename: row.document_filename,
        excluded: false, decision: null, note: null,
        created_at: '2026-09-22T07:00:00Z', updated_at: '2026-09-22T07:00:00Z',
      })
    }
    return { body: [] }
  }],
  /* ONE CELL, MERGED AGAINST THE STORED ROW -- the same call the import table makes. Answered
     from the harness default it would return 200 and change nothing, and the correction below
     would appear to save while the fixture stayed as it was. */
  [(u, r) => /rpc\/set_draft_row_value/.test(u) && r.method() === 'POST', (u, r) => {
    const { p_row_id: id, p_key: key, p_value: value } = JSON.parse(r.postData() ?? '{}')
    rowPatches.push({ id, patch: { values: { [key]: value } } })
    const row = followRows.find((x) => x.id === id)
    if (row) row.values = { ...row.values, [key]: (value ?? '').trim() || null }
    return { body: null }
  }],
  [(u, r) => /handover_draft_rows/.test(u) && r.method() === 'PATCH', (u, r) => {
    const id = decodeURIComponent(new URL(u).searchParams.get('id') ?? '').replace('eq.', '')
    const patch = JSON.parse(r.postData() ?? '{}')
    rowPatches.push({ id, patch })
    const row = followRows.find((x) => x.id === id)
    if (row) Object.assign(row, patch)
    return { body: [] }
  }],
  [(u) => /handover_draft_rows/.test(u) && new RegExp(`draft_id=eq.${FOLLOW_ID}`).test(u),
    () => ({ body: followRows })],
  [(u) => /handover_draft_rows/.test(u), () => ({ body: ORIGINAL_ROWS })],

  [(u, r) => /\/rest\/v1\/debtor_accounts/.test(u) && r.method() === 'POST', (u, r) => {
    const row = JSON.parse(r.postData() ?? '{}')
    accountsOpened.push(row)
    return { body: { ...row, id: `acct-${accountsOpened.length}` } }
  }],
  /* The one that DID come in, so the ticket knows GPS3/10103 already has an account. */
  [(u) => /\/rest\/v1\/debtor_accounts/.test(u), () => ({
    body: [{ id: 'acct-old', client_reference: 'GPS3/10103', account_number: 'NBP00001' }],
  })],
  [(u) => /account_notes/.test(u), () => ({ body: [] })],
  [(u) => /account_contacts/.test(u), () => ({ body: [] })],
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, PROFILE, handlers, [])
  await page.route('**/api/email/send', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })

  let up = false
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/queries/${QUERY_ID}`, { timeout: 2000 }); up = true; break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the dev server answers', up)

  /* ---------- the ticket itself ---------- */

  /*
   * A QUERY HAS A PAGE. Before this both lists opened the ACCOUNT, which answers a different
   * question — and one a query about a whole sheet cannot answer, because it has none.
   */
  await page.getByText('handover.csv', { exact: false }).first().waitFor({ timeout: 20000 })
  const ticket = await page.locator('body').innerText()
  t.ok('the ticket names the sheet it is about', /handover\.csv/.test(ticket))
  t.ok('...and says it is with the liaison', /liaison/i.test(ticket))
  /* THE ROWS, READ BACK OFF THE FROZEN DRAFT rather than copied onto the query at approval. */
  t.ok('...and lists the row that could not be opened', /GPS3\/10104/.test(ticket))
  t.ok('...saying what is wrong with it', /not a number/i.test(ticket))

  /* ---------- the second go ---------- */

  /*
   * RAISED BY A BUTTON, never by opening the page. A draft created as a side effect of looking
   * at a ticket is one nobody asked for, and a "waiting to be approved" queue with strangers in
   * it is a queue nobody trusts.
   */
  t.check('opening the ticket creates nothing', draftsCreated.length, 0)

  await t.shot(page, 'query-ticket')

  const start = page.getByRole('button', { name: /Correct these and import them/ })
  t.ok('the ticket offers a second go', await start.isVisible())
  await start.click()
  await page.waitForTimeout(1200)

  t.check('one draft is raised', draftsCreated.length, 1)
  /* TIED TO THE QUERY, which is what stops a second one being made next time. */
  t.check('...against this query', draftsCreated[0]?.from_query_id, QUERY_ID)
  /* NAMED FOR THE SHEET IT CAME FROM: a liaison looking at the queue a week later has to tell it
     from the original at a glance. */
  t.ok('...named for the sheet it came from', /handover/.test(draftsCreated[0]?.filename ?? ''))
  /* ONLY THE REFUSED ROW. The one that came in already has an account; copying it would have the
     client's debt handed over twice. */
  t.check('...carrying only the row that was refused', rowsCreated.length, 1)
  t.check('...which one', rowsCreated[0]?.values?.client_reference, 'GPS3/10104')
  /* Renumbered from 2: every message about a row says "Row 3", and 3 here would be 3 on a sheet
     nobody is looking at. */
  t.check('...renumbered for the new sheet', rowsCreated[0]?.line, 2)

  /*
   * AND REOPENING THE TICKET FINDS THE ONE ALREADY THERE. Pressing the button twice, or two
   * people opening the same ticket, must not make a second draft -- a "waiting to be approved"
   * queue with duplicates of the same sheet in it is a queue nobody can act on.
   */
  await page.reload()
  await page.waitForTimeout(1500)
  t.check('reopening the ticket raises no second draft', draftsCreated.length, 1)
  t.check('...and copies no rows again', rowsCreated.length, 1)
  t.ok('...it goes straight to the table instead of offering to start one',
    !(await page.getByRole('button', { name: /Correct these and import them/ }).isVisible()))

  /* ---------- the table is really there ---------- */

  /*
   * THE SAME TABLE THE IMPORT SCREEN DRAWS. This is the assertion this file exists for: a shared
   * component provably in the bundle and invisible on one of its two screens.
   */
  /*
   * SCOPED TO THE DRAFT TABLE, because the ticket now draws two. The "Not brought in" listing
   * above it is a table as well, and an unscoped `table tbody tr` picks THAT one -- which has no
   * inputs in it, so the edit below waited thirty seconds for a cell that was never going to be
   * there. Found by the thing that makes it the draft table: its cells are typed into.
   */
  const sheet = page.locator('table').filter({ has: page.locator('tbody input') }).first()
  const cells = sheet.locator('tbody input')
  await cells.first().waitFor({ timeout: 15000 })
  t.ok('the draft table is drawn on the ticket', await cells.count() > 10)
  const shown = await page.locator('body').innerText()
  t.ok('...with the sheet’s own headings', /Handover amount/i.test(shown))
  t.ok('...and the row it must fix', /GPS3\/10104/.test(shown))

  /*
   * APPROVE IS HELD while the row is still refused — the same gate the import screen uses, which
   * is the point of sharing the table rather than drawing a second one.
   */
  const approve = page.getByRole('button', { name: /Approve \d+ handover/ })
  t.ok('an approve button is offered', await approve.isVisible())
  t.check('...but held while the amount is not a number', await approve.isDisabled(), true)

  /* ---------- correct it, and import ---------- */

  const headings = await sheet.locator('thead th').allInnerTexts()
  const amountAt = headings.findIndex((h) => /Handover amount/i.test(h))
  t.ok('the handover amount column is on the table', amountAt >= 0)
  if (amountAt >= 0) {
    const amount = sheet.locator('tbody tr').first().locator('td').nth(amountAt).locator('input')
    await amount.fill('1150')
    await amount.blur()
    await page.waitForTimeout(1200)
    t.ok('the correction is written to the row',
      rowPatches.some((p) => p.patch?.values?.capital === '1150'))
  }

  await page.waitForTimeout(600)
  t.check('...and the handover can now be approved', await approve.isDisabled(), false)
  await approve.click()
  await page.waitForTimeout(2500)

  /*
   * IMPORTED THROUGH THE ONE APPROVAL — the same path that opens the accounts, raises our
   * references, writes the notes and tells the client. A second import path here would do some
   * of that and not the rest.
   */
  t.check('the corrected account is opened', accountsOpened.length, 1)
  t.check('...as the one that was refused',
    accountsOpened[0]?.client_reference, 'GPS3/10104')
  t.check('...with the corrected amount', Number(accountsOpened[0]?.capital_handed_over), 1150)
  /* Our own reference, generated rather than read off a sheet that never had one. */
  t.ok('...and our own reference', /^NBP\d{5}$/.test(accountsOpened[0]?.account_number ?? ''))

  await t.shot(page, 'query-ticket-imported')
  /* THE PAGE IS STILL A PAGE AFTERWARDS. Every assertion above can pass while the screen behind
     them has fallen over -- the import had already happened by then. */
  const after = await page.locator('body').innerText()
  t.ok('the ticket is still readable after the import',
    !/could not load your profile/i.test(after) && !/Something went wrong/i.test(after))
  /* AND NOTHING FELL OVER QUIETLY BEHIND IT. The app shows a failed read as a toast rather than
     as a broken page, so a page that renders is not on its own proof that it loaded. */
  t.ok('...with nothing having failed to load', !/Failed to load/i.test(after))
} catch (e) {
  t.check('the run finished without throwing', String(e), 'no error')
} finally {
  if (browser) await browser.close()
  stopServer(server)
}

process.exit(t.finish(`
A client query about a handover has a page of its own, drawn from the frozen draft rather than
from a description copied onto it. The rows it could not open are raised as a fresh draft when
somebody asks for one, shown in the SAME table the import screen draws, corrected in place and
imported through the one approval. Screenshots in ${OUT}.`) ? 0 : 1)
