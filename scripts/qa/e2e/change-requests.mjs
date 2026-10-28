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
/* THE BIG BOSS (S15): Stephan holds raptor.boss, which is what approving and declining ask. */
const ADMIN = { ...PROFILE, id: 'u-stephan', name: 'Stephan', email: 's@x.co.za', role: 'Administrator', grants: ['raptor.boss'] }
const OTHER_ADMIN = { ...PROFILE, id: 'u-camille', name: 'Camille', email: 'c@x.co.za', role: 'Administrator' }
const NONE = { tested_ok: null, tested_note: null, tested_at: null, tested_by: null, assigned_to: null,
  review_title: null, review_verdict: null, review_size: null, review_summary: null, review_questions: [], reviewed_at: null,
  build_requested_at: null, build_requested_by: null }
const REQUESTS = [
  { ...NONE, id: 'q1', number: 7, description: 'Diary: make broken promises red', page_path: '/diary', page_title: 'Diary', pane: 'Diary', department: 'Call centre', status: 'new', priority: 'normal',
    admin_note: null, done_in: null, created_by: TESTER.id, created_at: '2026-10-25T08:00:00Z', decided_by: null, decided_at: null, closed_at: null,
    review_title: 'Call centre · Diary: broken promises stand out', review_verdict: 'decision', review_size: 'small',
    review_summary: 'Colour the broken-promise rows.', review_questions: ['Red or orange?'], reviewed_at: '2026-10-26T02:00:00Z' },
  { ...NONE, id: 'q2', number: 8, description: 'Diary: the same, but orange', page_path: '/diary', page_title: 'Diary', pane: 'Diary', department: 'Call centre', status: 'accepted', priority: 'high',
    admin_note: null, done_in: null, created_by: ADMIN.id, created_at: '2026-10-25T09:00:00Z', decided_by: ADMIN.id, decided_at: '2026-10-25T10:00:00Z', closed_at: null,
    review_verdict: 'ready', review_size: 'small', reviewed_at: '2026-10-26T02:00:00Z' },
  { ...NONE, id: 'q3', number: 5, description: 'Old, done', page_path: '/', page_title: 'Dashboard', pane: 'Dashboard', department: 'Whole system', status: 'done', priority: 'normal',
    admin_note: 'Open the Dashboard and look at the top.', done_in: 'Raptor H12', created_by: TESTER.id, created_at: '2026-10-20T08:00:00Z', decided_by: ADMIN.id, decided_at: '2026-10-21T08:00:00Z', closed_at: '2026-10-21T08:00:00Z' },
]
const REVIEWS = [{ id: 'v1', created_at: '2026-10-26T02:00:00Z', summary: 'Two requests about the diary, one decision needed.', request_ids: ['q1', 'q2'],
  groups: [{ title: 'Broken promises stand out in the diary', request_numbers: [7, 8], what: 'Colour the broken-promise rows.', questions: ['Red or orange?'], size: 'small' }] }]
const EVENTS = [{ id: 'e1', request_id: 'q1', kind: 'sent', body: null, from_status: null, to_status: null, by_id: TESTER.id, at: '2026-10-25T08:00:00Z' },
  { id: 'e2', request_id: 'q1', kind: 'reviewed', body: 'Colour the broken-promise rows.', from_status: null, to_status: null, by_id: null, at: '2026-10-26T02:00:00Z' },
  { id: 'e3', request_id: 'q1', kind: 'question', body: 'Which colour?', choices: ['Red', 'Orange'], answers: null, from_status: null, to_status: null, by_id: ADMIN.id, at: '2026-10-26T03:00:00Z' }]

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
  [(u, req) => u.includes('/rpc/change_request_edit'), (u, req) => {
    writes.push({ table: 'edit', body: req.postDataJSON() })
    return { status: 200, body: null }
  }],
  [(u, req) => u.includes('/rpc/change_request_tested'), (u, req) => {
    writes.push({ table: 'tested', body: req.postDataJSON() })
    return { status: 200, body: null }
  }],
  [(u, req) => req.method() === 'POST' && u.includes('/rest/v1/change_request_events'), (u, req) => {
    writes.push({ table: 'event', body: req.postDataJSON() })
    return { status: 201, body: [] }
  }],
  [(u) => u.includes('/rest/v1/change_request_events'), () => ({ body: EVENTS })],
  [(u) => u.includes('/rest/v1/change_request_reviews'), () => ({ body: REVIEWS })],
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

  /* 2. The Feedback Centre, as the tester. */
  await open(page, '/requests')
  const review = page.getByTestId('requests-review')
  await review.waitFor({ timeout: 20000 })
  t.ok('the night\'s review is on top, with its summary', /Last night.s review/.test(await review.innerText()) && /one decision needed/.test(await review.innerText()))
  t.check('...its tiles count what it read, by verdict', JSON.stringify(await Promise.all(['reviewed', 'ready', 'decision', 'blocked']
    .map(async (v) => (/^\s*(\d+)/.exec(await page.getByTestId(`requests-tile-${v}`).innerText()) ?? [])[1]))), JSON.stringify(['2', '1', '1', '0']))
  t.ok('new requests waiting for a decision are listed under it', /R-7/.test(await page.getByTestId('requests-waiting').innerText()))
  const cards = page.getByTestId('request-card')
  const shelves = page.getByTestId('requests-shelf').getByRole('radio')
  t.check('the list opens on Needs a decision -- the shelves say whose move it is -- with All last', JSON.stringify([await shelves.evaluateAll((els) => els.map((e) => e.textContent.replace(/ \(\d+\)/, ''))),
    await page.getByTestId('requests-shelf').getByRole('radio', { checked: true }).innerText(),
    await cards.evaluateAll((els) => els.map((e) => e.dataset.number))]),
  JSON.stringify([['Needs a decision', 'With Claude', 'To test', 'Done', 'Declined', 'All'], 'Needs a decision (2)', ['8', '7']]))
  t.check('...each row says where it is, and who it waits on', JSON.stringify(await cards.evaluateAll((els) => els.map((e) =>
    `${e.querySelector('[data-testid="request-status"]')?.textContent}|${e.querySelector('[data-testid="request-feedback"]')?.textContent ?? ''}`))),
  JSON.stringify(['Approved|', 'Reviewed|Needs feedback from Alianna']))
  await shelves.filter({ hasText: /^To test/ }).click()
  t.check('...a released request waits on To test until the person who asked tests it', JSON.stringify(await cards.evaluateAll((els) => els.map((e) => e.dataset.number))), JSON.stringify(['5']))
  await shelves.filter({ hasText: /^All/ }).click()
  t.check('the tickets: high first, then newest', JSON.stringify(await cards.evaluateAll((els) => els.map((e) => e.dataset.number))), JSON.stringify(['8', '7', '5']))
  t.ok('each row says its number, title, department, status and who asked',
    /^R-7$/.test((await cards.nth(1).getByTestId('request-number').innerText()).trim())
    && /Call centre · Diary: broken promises stand out/.test(await cards.nth(1).getByTestId('request-title').innerText())
    && /Reviewed/.test(await cards.nth(1).getByTestId('request-status').innerText())
    && /Alianna Botha/.test(await cards.nth(1).getByTestId('request-asker').innerText())
    && /Approved/.test(await cards.nth(0).getByTestId('request-status').innerText()))
  // Stephan's iPad showed "R-" over "6": a squeezed column broke the number at its hyphen.
  const wide = page.viewportSize()
  await page.setViewportSize({ width: 900, height: wide.height })
  t.ok('...and on a narrow screen the number stays on one line', (await cards.getByTestId('request-number').evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)))).every((lines) => lines < 1.9))
  await page.setViewportSize(wide)
  await page.getByTestId('requests-tile-decision').click()
  t.check('a tile filters the tickets to what it counts', JSON.stringify(await cards.evaluateAll((els) => els.map((e) => e.dataset.number))), JSON.stringify(['7']))
  await page.getByTestId('requests-tile-filter').click()
  await page.getByTestId('requests-department').selectOption('Sales')
  t.check('...and so does the department', await cards.count(), 0)
  await page.getByTestId('requests-department').selectOption('all')
  await t.shot(page, 'change-requests-3-overview')

  await page.getByTestId('requests-views').getByRole('tab', { name: /Board/ }).click()
  t.check('the board puts each in its workflow column', JSON.stringify(await page.getByTestId('requests-board-column').evaluateAll((cols) =>
    cols.map((c) => `${c.dataset.column}:${[...c.querySelectorAll('[data-testid="request-card"]')].map((x) => x.dataset.number).join(',')}`))),
  JSON.stringify(['Submitted:', 'Reviewed:7', 'Approved:8', 'In development:', 'Released:5']))
  await t.shot(page, 'change-requests-5-board')
  await open(page, '/requests')
  await page.getByTestId('requests-board').waitFor({ timeout: 20000 })
  t.ok('...and the view is remembered', (await page.getByTestId('requests-board').count()) === 1)

  /* Their own released request asks them to test it, in the panel. */
  await page.locator('[data-testid="request-card"][data-number="5"]').click()
  const panel = page.getByTestId('request-panel')
  await panel.waitFor({ timeout: 10000 })
  t.ok('a ticket opens in a panel beside the list, with its number in the address', /r=5/.test(page.url()) && (await page.getByTestId('requests-board').count()) === 1)
  t.check('a tester sees no decision buttons', await panel.getByTestId('request-actions').count(), 0)
  t.ok('...and is asked to test what was released, with how', /This is released\. Please test it\./.test(await panel.getByTestId('request-test').innerText())
    && /How to test: Open the Dashboard/.test(await panel.getByTestId('request-test-how').innerText()))
  await panel.getByTestId('request-test-not-right').click()
  t.ok('"Not right yet" needs to say what', await panel.getByTestId('request-compose-send').isDisabled())
  await panel.getByTestId('request-compose-words').fill('The reference is still missing on disputes.')
  await panel.getByTestId('request-compose-send').click()
  await page.waitForTimeout(500)
  t.check('...and sends it back with that', JSON.stringify(writes.find((w) => w.table === 'tested')?.body),
    JSON.stringify({ p_number: 5, p_ok: false, p_note: 'The reference is still missing on disputes.' }))
  await t.shot(page, 'change-requests-4-test')

  /* A question with options: the person who asked ticks one, or Other with their own words. */
  const choices = panel.getByTestId('request-choices')
  t.check('a question with options shows them as ticks, with Other last', JSON.stringify(await choices.getByTestId('request-choice').allInnerTexts()),
    JSON.stringify(['Red', 'Orange', 'Other']))
  t.ok('...nothing is sent before something is ticked', await panel.getByTestId('request-choice-send').isDisabled())
  await choices.getByTestId('request-choice').filter({ hasText: 'Orange' }).click()
  await panel.getByTestId('request-choice-send').click()
  await page.waitForTimeout(500)
  const answers = () => writes.filter((w) => w.table === 'event' && w.body.answers === 'e3').map((w) => w.body)
  t.check('...a tick answers the question, as a reply pointing at it', JSON.stringify(answers()[0]),
    JSON.stringify({ request_id: 'q3', kind: 'comment', body: 'Orange', by_id: TESTER.id, answers: 'e3' }))
  await choices.getByTestId('request-choice').filter({ hasText: 'Other' }).click()
  t.ok('...Other needs their own words', await panel.getByTestId('request-choice-send').isDisabled())
  await panel.getByTestId('request-choice-other').fill('Purple')
  await panel.getByTestId('request-choice-send').click()
  await page.waitForTimeout(500)
  t.check('...and sends them as Other', answers()[1]?.body, 'Other: Purple')
  await t.shot(page, 'change-requests-6-choices')

  /* S14: the person who sent it may correct the wording while it waits -- "just to correct spelling". */
  t.check('a released request offers no correction', await page.getByTestId('request-edit').count(), 0)
  await open(page, '/requests?r=7')
  const panel7 = page.locator('[data-testid="request-panel"][data-number="7"]')
  await panel7.getByTestId('request-edit').click()
  await panel7.getByTestId('request-edit-words').fill('Diary: make broken promises red, please')
  await panel7.getByTestId('request-edit-save').click()
  await page.waitForTimeout(500)
  t.check('the sender corrects the wording of a request that is still waiting',
    JSON.stringify(writes.find((w) => w.table === 'edit')?.body), JSON.stringify({ p_number: 7, p_description: 'Diary: make broken promises red, please' }))
  await page.context().close()

  /* 2b. ANOTHER ADMINISTRATOR IS NOT THE BIG BOSS (Stephan, S15: "I am the only person that can approve a
     suggestion for building Raptor"). They may ask and note, never approve, decline or ask Claude. */
  {
    const { page: op } = await signedInPage(browser, OTHER_ADMIN, handlers(OTHER_ADMIN, []), [], { now: '2026-10-26T10:00:00+02:00' })
    await open(op, '/requests?r=7')
    const od = op.getByTestId('request-panel')
    await od.getByTestId('request-actions').waitFor({ timeout: 20000 })
    t.check('another Administrator is offered no approve, decline or build',
      await od.locator('[data-testid="request-approve-build"], [data-testid="request-approve"], [data-testid="request-decline"], [data-testid="request-build"]').count(), 0)
    t.ok('...and is told who decides', /Only the Big Boss approves what gets built/.test(await od.getByTestId('request-actions').innerText()))
    t.ok('...but can still ask the person who sent it', await od.getByTestId('request-ask').isVisible())
    await op.context().close()
  }

  /* 3. The Big Boss works a ticket from the panel. */
  const adminWrites = []
  const { page: ap } = await signedInPage(browser, ADMIN, handlers(ADMIN, adminWrites), [], { now: '2026-10-26T10:00:00+02:00' })
  await open(ap, '/requests?r=7')
  const ad = ap.getByTestId('request-panel')
  await ad.getByTestId('request-actions').waitFor({ timeout: 20000 })
  t.ok('the panel shows the night\'s reading apart from the status', /Needs your decision/.test(await ad.getByTestId('request-panel-review').innerText())
    && /Red or orange\?/.test(await ad.getByTestId('request-panel-review').innerText()))
  t.ok('...and the history', /sent the request/.test(await ad.getByTestId('request-activity').innerText()) && /The nightly review/.test(await ad.getByTestId('request-activity').innerText()))
  t.check('a person is never offered In development or Released', await ad.locator('[data-testid="request-start"], [data-testid="request-release"]').count(), 0)
  await ad.getByTestId('request-approve-build').click()
  await ap.waitForTimeout(600)
  const queued = adminWrites.filter((w) => w.table === 'patch').map((w) => w.body)
  t.ok('"Approve & ask Claude" approves it and puts it on Claude\'s queue', queued.some((b) => b.status === 'accepted')
    && queued.some((b) => typeof b.build_requested_at === 'string' && b.build_requested_by === ADMIN.id))
  t.ok('...and says so on its history', adminWrites.some((w) => w.table === 'event' && w.body.kind === 'comment' && w.body.body === 'Asked Claude to build this.'))
  await ad.getByTestId('request-ask').click()
  t.ok('an Administrator sees the options, waiting for the person who asked', /Waiting for .+ to choose/.test(await ad.getByTestId('request-choices').innerText())
    && (await ad.getByTestId('request-choice-send').count()) === 0)
  await ad.getByTestId('request-compose-words').fill('Red or orange?')
  await ad.getByTestId('request-compose-choices').fill('Red')
  t.ok('one option is not a choice', await ad.getByTestId('request-compose-send').isDisabled())
  await ad.getByTestId('request-compose-choices').fill('1. Red\n2. Orange')
  await ad.getByTestId('request-compose-send').click()
  await ap.waitForTimeout(500)
  t.check('Request info asks the person who asked, as a question on the request', JSON.stringify(adminWrites.find((w) => w.table === 'event' && w.body.kind === 'question')?.body),
    JSON.stringify({ request_id: 'q1', kind: 'question', body: 'Red or orange?', by_id: ADMIN.id, choices: ['Red', 'Orange'] }))
  await ad.getByTestId('request-decline').click()
  t.ok('a decline needs a reason', await ad.getByTestId('request-compose-send').isDisabled())
  await ad.getByTestId('request-compose-words').fill('Covered by R-8.')
  await ad.getByTestId('request-compose-send').click()
  await ap.waitForTimeout(600)
  const patch = adminWrites.find((w) => w.table === 'patch' && w.body.status === 'declined')
  t.ok('...and with one it writes the status and the reason to that request', !!patch && /id=eq\.q1/.test(patch.url)
    && patch.body.status === 'declined' && patch.body.admin_note === 'Covered by R-8.')
  await t.shot(ap, 'change-requests-2-admin')
  await ap.context().close()

  /*
   * 4. THE BELL (S14, Raptor H13). The firm, 27 Oct: every line said "just now", two replies on one
   * request were two lines, and a request already opened and approved still showed unread.
   */
  const NOTIFS = [
    { id: 'n1', type: 'change_request.reply', message: 'Alianna replied on R-7: Red', link: '/requests?r=7', read: false, created_at: '2026-10-27T05:43:50Z' },
    { id: 'n2', type: 'change_request.reply', message: 'Alianna replied on R-7: Orange after all', link: '/requests?r=7', read: false, created_at: '2026-10-27T05:43:51Z' },
    { id: 'n3', type: 'change_request.new', message: 'Alianna asked for a change (R-8)', link: '/requests?r=8', read: false, created_at: '2026-10-27T05:39:00Z' },
  ]
  const bellWrites = []
  const { page: bp } = await signedInPage(browser, ADMIN, [
    [(u, req) => req.method() === 'PATCH' && u.includes('/rest/v1/notifications'), (u, req) => {
      bellWrites.push({ url: decodeURIComponent(u), body: req.postDataJSON() }); return { status: 200, body: [] }
    }],
    [(u) => u.includes('/rest/v1/notifications'), () => ({ body: NOTIFS })],
    [(u) => u.includes('/rpc/nav_request_count'), () => ({ body: 2 })],
    ...handlers(ADMIN, []),
  ], [], { now: '2026-10-27T09:00:00+02:00' })
  await open(bp, '/requests')
  await bp.getByTestId('notifications-count').waitFor({ timeout: 20000 })
  t.check('the bell counts things waiting, not messages: two replies on R-7 are one', await bp.getByTestId('notifications-count').innerText(), '2')
  /* S14: the sidebar says it too, like Mail's count. Waited for: it arrives with the other counts. */
  await bp.waitForFunction(() => /\d/.test(document.querySelector('nav a[href="/requests"]')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {})
  t.ok('the sidebar\'s Requests carries the count of what waits on me', /^Requests\s*2$/.test((await bp.locator('nav a[href="/requests"]').innerText()).trim()))
  await bp.getByTestId('notifications-bell').click()
  const lines = bp.getByTestId('notification')
  t.check('...one line per request, the newest message on it', JSON.stringify(await lines.evaluateAll((els) => els.map((e) => e.querySelector('p')?.textContent))),
    JSON.stringify(['Alianna replied on R-7: Orange after all', 'Alianna asked for a change (R-8)']))
  t.check('...with a real date and time, and how many more', JSON.stringify(await bp.getByTestId('notification-when').allInnerTexts()),
    JSON.stringify(['Today 07:43 · and 1 more', 'Today 07:39']))
  await bp.keyboard.press('Escape')
  await open(bp, '/requests?r=8')
  await bp.getByTestId('request-panel').waitFor({ timeout: 20000 })
  await bp.waitForTimeout(500)
  t.ok('opening R-8 marks its notification read, and nothing else', bellWrites.length === 1 && /id=eq\.n3/.test(bellWrites[0].url) && bellWrites[0].body.read === true)
  await bp.context().close()
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish('A request is sent with its page and a shrunk screenshot; the Feedback Centre shows the night\'s review, its tiles filter, the board and the panel work, the asker tests, and only an Administrator decides.')
process.exit(good ? 0 : 1)
