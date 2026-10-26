/**
 * "REQUEST A CHANGE" AND THE REQUESTS SCREEN, IN A REAL BROWSER (S12).
 *
 *   1. A tester on the Accounts page presses the light bulb, types what they want, adds a screenshot
 *      (a 3 200-pixel PNG) and sends: ONE request with the page it came from, then ONE file -- shrunk
 *      to a JPEG no wider than 1 600 before it left.
 *   2. The Requests screen shows the night's grouped review, and the open requests; a tester sees no
 *      decision buttons.
 *   3. An Administrator opens a request: Decline is not pressable without a note, and with one it
 *      writes the status and the note.
 *
 * Run: RAPTOR_E2E_PORT=5704 node scripts/qa/e2e/change-requests.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE, TEAM } from './fixtures.mjs'

const t = makeRunner('change-requests')
const TESTER = { ...PROFILE, id: 'u-ali', name: 'Alianna Botha', email: 'a@x.co.za', role: 'Pre-legal Agent' }
const ADMIN = { ...PROFILE, id: 'u-stephan', name: 'Stephan', email: 's@x.co.za', role: 'Administrator' }
const REQUESTS = [
  { id: 'q1', number: 7, description: 'Diary: make broken promises red', page_path: '/diary', page_title: 'Diary', pane: 'Diary', department: 'Call centre', status: 'new', priority: 'normal',
    admin_note: null, done_in: null, created_by: TESTER.id, created_at: '2026-10-25T08:00:00Z', decided_by: null, decided_at: null, closed_at: null },
  { id: 'q2', number: 8, description: 'Diary: the same, but orange', page_path: '/diary', page_title: 'Diary', status: 'accepted', priority: 'high',
    admin_note: null, done_in: null, created_by: ADMIN.id, created_at: '2026-10-25T09:00:00Z', decided_by: ADMIN.id, decided_at: '2026-10-25T10:00:00Z', closed_at: null },
  { id: 'q3', number: 5, description: 'Old, done', page_path: '/', page_title: 'Dashboard', status: 'done', priority: 'normal',
    admin_note: null, done_in: 'Raptor H12', created_by: TESTER.id, created_at: '2026-10-20T08:00:00Z', decided_by: ADMIN.id, decided_at: '2026-10-21T08:00:00Z', closed_at: '2026-10-21T08:00:00Z',
    tested_ok: null, tested_note: null, tested_at: null, tested_by: null },
]
const REVIEW = { id: 'v1', created_at: '2026-10-26T02:00:00Z', summary: 'Two requests about the diary, one decision needed.',
  groups: [{ title: 'Broken promises stand out in the diary', request_numbers: [7, 8], what: 'Colour the broken-promise rows.', questions: ['Red or orange?'], size: 'small' }] }

const open = async (page, path) => {
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}${path}`, { timeout: 2000 }); return }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
}

/** A 3 200 x 2 400 PNG, drawn in the page so the test carries no binary. */
async function bigPng(page) {
  return page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 3200; c.height = 2400
    const x = c.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0, 0, 3200, 2400)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  })
}

const handlers = (who, writes) => [
  [(u, req) => req.method() === 'POST' && u.includes('/rest/v1/change_requests'), (u, req) => {
    writes.push({ table: 'change_requests', body: req.postDataJSON() })
    return { status: 201, body: { id: 'new-1', number: 9 } }
  }],
  [(u, req) => req.method() === 'POST' && u.includes('/rest/v1/change_request_files'), (u, req) => {
    writes.push({ table: 'change_request_files', body: req.postDataJSON() })
    return { status: 201, body: [] }
  }],
  [(u, req) => req.method() === 'PATCH' && u.includes('/rest/v1/change_requests'), (u, req) => {
    writes.push({ table: 'patch', url: decodeURIComponent(u), body: req.postDataJSON() })
    return { status: 200, body: [] }
  }],
  [(u, req) => u.includes('/rpc/change_request_tested'), (u, req) => {
    writes.push({ table: 'tested', body: req.postDataJSON() })
    return { status: 200, body: null }
  }],
  [(u) => u.includes('/rest/v1/change_request_reviews'), () => ({ body: REVIEW })],
  [(u) => u.includes('/rest/v1/change_request_files'), () => ({ body: [] })],
  [(u) => u.includes('/rest/v1/change_requests'), () => ({ body: REQUESTS })],
  [(u) => /\/rest\/v1\/profiles.*id=eq\./.test(u), () => ({ body: [who] })],
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [TESTER, ADMIN] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
]

const server = await startServer()
const browser = await chromium.launch()
try {
  /* 1. A tester sends one. */
  const writes = []
  const { page } = await signedInPage(browser, TESTER, handlers(TESTER, writes), [], { now: '2026-10-26T10:00:00+02:00' })
  await open(page, '/accounts')
  const bulb = page.getByTestId('request-change-open')
  await bulb.waitFor({ timeout: 20000 })
  await bulb.click()
  t.ok('nothing is sent with no words', await page.getByTestId('request-change-send').isDisabled())
  t.ok('it says which pane it is from', /From the Accounts pane/.test(await page.getByTestId('request-change-pane').innerText()))
  const picker = page.getByTestId('request-change-department')
  t.check('...and suggests the department from it', await picker.locator('[aria-checked="true"]').innerText(), 'Call centre')
  /* Headless Chromium has no speech recognition, so the component says so instead -- either way it is there. */
  t.ok('a microphone sits on the description', (await page.locator('button[title^="Talk instead of typing"]').count()
    + await page.getByText('not in this browser').count()) === 1)
  await picker.getByRole('radio', { name: 'Finance' }).click()
  await page.getByTestId('request-change-description').fill('The Paid column should show the date it was paid.')
  const bytes = await bigPng(page)
  await page.getByTestId('request-change-files').setInputFiles({ name: 'screenshot.png', mimeType: 'image/png', buffer: Buffer.from(bytes) })
  await page.locator('img[alt="screenshot.jpg"]').waitFor({ timeout: 10000 })
  await t.shot(page, 'change-requests-0-form')
  await page.getByTestId('request-change-send').click()
  await page.getByTestId('request-change-sent').waitFor({ timeout: 10000 })
  const req = writes.find((w) => w.table === 'change_requests')
  t.ok('ONE request, with the words and the page it came from (its filters too, so it opens as they saw it)',
    writes.filter((w) => w.table === 'change_requests').length === 1
    && req?.body.description === 'The Paid column should show the date it was paid.'
    && /^\/accounts(\?|$)/.test(req?.body.page_path ?? '') && req?.body.page_title === 'Accounts')
  t.check('...with the pane and the department they chose', JSON.stringify([req?.body.pane, req?.body.department]), JSON.stringify(['Accounts', 'Finance']))
  const file = writes.find((w) => w.table === 'change_request_files')
  t.ok('ONE file on it, a JPEG', !!file && file.body.request_id === 'new-1' && file.body.mime === 'image/jpeg' && file.body.name === 'screenshot.jpg')
  const width = file ? await page.evaluate(async (b64) => {
    const i = new Image(); i.src = `data:image/jpeg;base64,${b64}`; await i.decode(); return [i.naturalWidth, i.naturalHeight]
  }, file.body.data) : null
  t.check('...shrunk to 1 600 on its long side before it left', JSON.stringify(width), JSON.stringify([1600, 1200]))
  t.ok('...far smaller than the PNG', !!file && file.body.bytes < bytes.length / 4)
  t.ok('the screen gives its number', /R-9/.test(await page.getByTestId('request-change-sent').innerText()))
  await t.shot(page, 'change-requests-1-sent')

  /* 2. The Requests screen, as the tester. */
  await open(page, '/requests')
  const review = page.getByTestId('requests-review')
  await review.waitFor({ timeout: 20000 })
  t.ok('the night\'s review is on top, grouped, with its question', /Broken promises stand out in the diary/.test(await review.innerText())
    && /R-7/.test(await review.innerText()) && /Red or orange\?/.test(await review.innerText()))
  const cards = page.getByTestId('request-card')
  t.check('the list opens on the open ones, high first', JSON.stringify(await cards.evaluateAll((els) => els.map((e) => e.dataset.number))), JSON.stringify(['8', '7']))
  const first = cards.first()
  t.ok('a closed request says it can be opened', /Open/.test(await first.getByTestId('request-toggle').innerText())
    && (await first.getByTestId('request-toggle').getAttribute('aria-expanded')) === 'false')
  t.ok('...and says its number, who asked (with their role) and who decided',
    /^R-8$/.test((await first.getByTestId('request-number').innerText()).trim())
    && /Asked by Stephan · Administrator/.test(await first.getByTestId('request-asker').innerText())
    && /Accepted by Stephan/.test(await first.getByTestId('request-decider').innerText()))
  t.ok('the department and the pane are on the row', /Call centre/.test(await cards.nth(1).getByTestId('request-where').innerText())
    && /Diary pane/.test(await cards.nth(1).getByTestId('request-where').innerText()))
  await page.getByTestId('requests-department').selectOption('Sales')
  t.check('...and the list filters by department', await cards.count(), 0)
  await page.getByTestId('requests-department').selectOption('all')
  t.ok('...an undecided one has no "by" line', (await cards.nth(1).getByTestId('request-decider').count()) === 0
    && /Asked by Alianna Botha · Pre-legal Agent/.test(await cards.nth(1).getByTestId('request-asker').innerText()))
  await t.shot(page, 'change-requests-3-list')
  await first.getByTestId('request-toggle').click()
  t.ok('opening it turns the toggle to Close', /Close/.test(await first.getByTestId('request-toggle').innerText()))
  t.check('a tester sees no decision buttons', await page.getByTestId('request-decide').count(), 0)

  /* Their own Done request asks them to test it. */
  await page.getByTestId('requests-shelf').getByRole('radio', { name: /Done/ }).click()
  const done = page.locator('[data-testid="request-card"][data-number="5"]')
  t.ok('a Done request says it is waiting for a test', /Waiting for a test/.test(await done.innerText()))
  await done.getByTestId('request-toggle').click()
  t.ok('...and asks the person who asked to test it', /This is done\. Please test it\./.test(await done.getByTestId('request-test').innerText()))
  await done.getByTestId('request-test-not-right').click()
  t.ok('"Not right yet" needs to say what', await done.getByTestId('request-test-send-back').isDisabled())
  await done.getByTestId('request-test-note').fill('The reference is still missing on disputes.')
  await done.getByTestId('request-test-send-back').click()
  await page.waitForTimeout(500)
  t.check('...and sends it back with that', JSON.stringify(writes.find((w) => w.table === 'tested')?.body),
    JSON.stringify({ p_number: 5, p_ok: false, p_note: 'The reference is still missing on disputes.' }))
  await t.shot(page, 'change-requests-4-test')
  await page.context().close()

  /* 3. An Administrator declines one. */
  const adminWrites = []
  const { page: ap } = await signedInPage(browser, ADMIN, handlers(ADMIN, adminWrites), [], { now: '2026-10-26T10:00:00+02:00' })
  await open(ap, '/requests?r=7')
  const card = ap.locator('[data-testid="request-card"][data-number="7"]')
  await card.getByTestId('request-decide').waitFor({ timeout: 20000 })
  t.ok('a decline needs a note', await card.getByTestId('request-move-declined').isDisabled())
  await card.getByTestId('request-note').fill('Covered by R-8.')
  await card.getByTestId('request-move-declined').click()
  await ap.waitForTimeout(600)
  const patch = adminWrites.find((w) => w.table === 'patch')
  t.ok('...and with one it writes the status and the note to that request', !!patch && /id=eq\.q1/.test(patch.url)
    && patch.body.status === 'declined' && patch.body.admin_note === 'Covered by R-8.')
  await t.shot(ap, 'change-requests-2-admin')
  await ap.context().close()
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish('A request is sent with its page and a shrunk screenshot; the night\'s review and the open list show; only an Administrator decides, and a decline says why.')
process.exit(good ? 0 : 1)
