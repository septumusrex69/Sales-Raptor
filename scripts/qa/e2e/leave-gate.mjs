/**
 * THE QUESTION AT THE DOOR, IN A REAL BROWSER (S10, 22 Oct).
 *
 * check-leave-gate holds the rule; this holds what only a browser can show -- that a navigation is
 * actually STOPPED. A bar that asked was already there and could be walked past; the firm asked for
 * the walk to be refused while the date is today.
 *
 *   1. Their own account, worked (a note), on today's diary: leaving for the list is stopped, the
 *      question says today will not do, Stay keeps them on the account.
 *   2. Choose a date books a later day, and they are let through to where they were going.
 *   3. Somebody else's account, worked: nobody is stopped.
 *
 * Run: node scripts/qa/e2e/leave-gate.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, TEAM, USER_ID, accountsPage } from './fixtures.mjs'

const t = makeRunner('leave-gate')
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date())

function handlersFor(account, diary) {
  return [
    [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: PROFILE.email } })],
    [(u) => u.includes('/rest/v1/profiles'), (u) => {
      const people = [PROFILE, { ...PROFILE, id: 'other-1', name: 'Lerato', email: 'l@raptor.test' }]
      const one = /id=eq\.([0-9a-z-]+)/.exec(u)?.[1]
      return { body: one ? people.filter((p) => p.id === one) : people }
    }],
    [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
    [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
    [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
    [(u, req) => u.includes('/rest/v1/account_notes') && req.method() === 'POST', () => ({
      status: 201, body: { id: 'note-1', account_id: account.id, body: 'Rang in about the balance.', created_at: new Date().toISOString() },
    })],
    /* THE ACCOUNT'S OWN DIARY DATE: today until a later one is booked, then that one, by this person. */
    [(u, req) => u.includes('/rest/v1/diary_entries') && req.method() === 'POST', (u, req) => {
      const row = JSON.parse(req.postData() ?? '{}')
      diary.current = { id: 'de-2', due_on: row.due_on, owner_id: row.owner_id, created_by: USER_ID, created_at: new Date().toISOString() }
      return { status: 201, body: { ...diary.current, account_id: account.id, kind: row.kind ?? 'review', state: 'open', source: 'manual', priority: 70 } }
    }],
    [(u) => u.includes('/rest/v1/diary_entries') && u.includes('select=id%2Cdue_on'), () => ({ body: diary.current ? diary.current : null })],
    [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [account], headers: { 'content-range': '0-0/1' } })],
  ]
}

async function open(page, path) {
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}${path}`, { timeout: 2000 }); return true }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  return false
}

async function writeNote(page) {
  await page.getByText('Add Note', { exact: true }).first().click()
  await page.getByPlaceholder('What was said, what was agreed...').fill('Rang in about the balance.')
  await page.getByPlaceholder('What was said, what was agreed...').press('Enter').catch(() => {})
  const save = page.locator('form').filter({ has: page.getByPlaceholder('What was said, what was agreed...') }).locator('button[type="submit"]')
  if (await save.count()) await save.first().click().catch(() => {})
  await page.waitForTimeout(1500)
}

const server = await startServer()
const browser = await chromium.launch()
try {
  /* ---------------------------------------------- 1-2. their own account */
  {
    const account = { ...accountsPage(1)[0], id: 'acc-0000', status: 'Active: Activated', assigned_to: USER_ID }
    const diary = { current: { id: 'de-1', due_on: today, owner_id: USER_ID, created_by: USER_ID, created_at: '2026-01-01T08:00:00Z' } }
    const { context, page } = await signedInPage(browser, PROFILE, handlersFor(account, diary), [])
    t.ok('the account opens', await open(page, `/accounts/${account.id}`))
    await page.getByText('Add Note', { exact: true }).first().waitFor({ timeout: 20000 })
      .catch(async (e) => { console.log((await page.locator('body').innerText()).slice(0, 600)); throw e })
    await writeNote(page)

    await page.getByTestId('back-link').click()
    await page.getByTestId('leave-gate').waitFor({ timeout: 5000 }).catch(() => {})
    t.check('leaving their own worked account, due today, is stopped', await page.getByTestId('leave-gate').getAttribute('data-ask').catch(() => null), 'must')
    t.ok('...and says today will not do', /day after today/.test(await page.getByTestId('leave-gate').innerText().catch(() => '')))
    t.ok('...with no "keep it" on offer', await page.getByTestId('leave-keep').count() === 0)
    await t.shot(page, 'leave-gate-must')
    await page.getByTestId('leave-stay').click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(400)
    t.ok('Stay keeps them on the account', new URL(page.url()).pathname === `/accounts/${account.id}`)

    /* Only if Stay held them here: the failure above is the report, not a thirty-second crash. */
    if (new URL(page.url()).pathname === `/accounts/${account.id}`) await page.getByTestId('back-link').click({ timeout: 3000 }).catch(() => {})
    await page.getByTestId('leave-move').click({ timeout: 3000 }).catch(() => {})
    await page.getByRole('button', { name: /^(Book it|Diarise|Save)/ }).first().waitFor({ timeout: 5000 }).catch(() => {})
    t.ok('the diary box offers no reminder instead', await page.getByRole('button', { name: 'A reminder' }).count() === 0)
    const book = page.locator('[data-modal-open] button').filter({ hasText: /Book|Diarise|Save/ }).last()
    await book.click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(1500)
    t.ok('a later day booked, they go where they were going', new URL(page.url()).pathname === '/accounts')
    t.ok('...the date booked is after today', !!diary.current && diary.current.due_on > today)
    await context.close()
  }

  /* ---------------------------------------------- 3. somebody else's */
  {
    const account = { ...accountsPage(1)[0], id: 'acc-0001', status: 'Active: Activated', assigned_to: 'other-1' }
    const diary = { current: { id: 'de-9', due_on: today, owner_id: 'other-1', created_by: 'other-1', created_at: '2026-01-01T08:00:00Z' } }
    const { context, page } = await signedInPage(browser, PROFILE, handlersFor(account, diary), [])
    await open(page, `/accounts/${account.id}`)
    await page.getByText('Add Note', { exact: true }).first().waitFor({ timeout: 20000 })
    await writeNote(page)
    await page.getByTestId('back-link').click()
    await page.waitForTimeout(1200)
    t.ok('somebody else\'s account: nobody is stopped', await page.getByTestId('leave-gate').count() === 0 && new URL(page.url()).pathname === '/accounts')
    await context.close()
  }
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish(
  `The question at the door (S10): leaving your own worked account while it is on today's diary is
stopped, Stay keeps you there, a later day lets you through to where you were going; somebody
else's account never stops anybody.`)
process.exit(good ? 0 : 1)
