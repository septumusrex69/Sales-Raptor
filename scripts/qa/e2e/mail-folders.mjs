/**
 * R-13 (S19, Raptor H18): MAIL FOLDERS OF ONE'S OWN. Rinda: "file our emails into the relevant subfolder keeping our
 * inbox to a minimum." Stephan: "an option for people to have the folders ... and they can, for example, link a
 * folder with a client."
 *
 *  1. New folder, linked to a client: it is made, and opened (empty, saying how to fill it).
 *  2. From the Inbox, a message ticked and moved into it: it LEAVES the Inbox, and -- being on no record yet -- is
 *     filed on the folder's client too (a PATCH linking linked_company_id; nothing charged).
 *  3. The folder shows it; Back to the inbox puts it back.
 *
 * The stub keeps folder_id on the fixture rows and filters on it exactly as PostgREST would.
 *
 * Run: node scripts/qa/e2e/mail-folders.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, COLLEAGUE, MAIL as FIXTURE, PROFILE, TEAM, USER_ID } from './fixtures.mjs'

const t = makeRunner('mail-folders')
const MAIL = FIXTURE.map((m) => ({ ...m, folder_id: null }))
const FOLDERS = []
const links = []
const idsIn = (u) => {
  const d = decodeURIComponent(u)
  const m = /[?&]id=(?:eq\.([0-9a-f-]+)|in\.\(([^)]*)\))/.exec(d)
  return m ? (m[1] ? [m[1]] : m[2].split(',').map((x) => x.replace(/"/g, ''))) : []
}

const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: PROFILE.email } })],
  [(u) => u.includes('/rest/v1/profiles'), (u) => {
    const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
    const all = [PROFILE, COLLEAGUE]
    return { body: one ? all.filter((p) => p.id === one) : all }
  }],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  [(u) => u.includes('/rest/v1/mail_folders'), (u, req) => {
    if (req.method() === 'POST') {
      const row = { id: `fold-${FOLDERS.length + 1}`, created_at: new Date().toISOString(), ...req.postDataJSON() }
      FOLDERS.push(row)
      return { status: 201, body: row }
    }
    return { body: [...FOLDERS].sort((a, b) => a.name.localeCompare(b.name)) }
  }],
  [(u) => u.includes('/rest/v1/user_emails'), (u, req) => {
    if (req.method() === 'PATCH') {
      const sent = (() => { try { return req.postDataJSON() ?? {} } catch { return {} } })()
      const ids = idsIn(u)
      for (const m of MAIL) {
        if (!ids.includes(m.id)) continue
        if ('folder_id' in sent) m.folder_id = sent.folder_id
        if ('linked_company_id' in sent) { m.linked_company_id = sent.linked_company_id; m.is_filed = true; links.push(m.id) }
      }
      return { body: ids.map((id) => ({ id })) }
    }
    const d = decodeURIComponent(u)
    const has = (c) => d.includes(c)
    const oneId = /[?&]id=eq\.([0-9a-f-]+)/.exec(d)?.[1]
    if (oneId) return { body: MAIL.filter((m) => m.id === oneId) }
    let rows = MAIL
    const inFolder = /folder_id=eq\.([\w-]+)/.exec(d)?.[1]
    if (inFolder) rows = rows.filter((m) => m.folder_id === inFolder)
    else {
      if (has('is_sent=eq.true')) rows = rows.filter((m) => m.is_sent)
      else if (has('is_junk=eq.true')) rows = rows.filter((m) => m.is_junk)
      else if (has('is_junk=eq.false')) rows = rows.filter((m) => !m.is_junk && !m.is_sent)
      if (has('done_at=is.null')) rows = rows.filter((m) => !m.done_at)
      if (has('done_at=not.is.null')) rows = rows.filter((m) => m.done_at)
      if (has('folder_id=is.null')) rows = rows.filter((m) => !m.folder_id)
    }
    if (has('read_at=is.null')) rows = rows.filter((m) => !m.read_at)
    return { body: rows, headers: { 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` } }
  }],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, PROFILE, handlers, [])
  await page.setViewportSize({ width: 1280, height: 900 })
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/mail`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  const subject = MAIL.find((m) => !m.is_junk && !m.is_sent && !m.done_at).subject
  await page.getByText(subject).first().waitFor({ timeout: 20000 })
  const strip = page.getByTestId('mail-folders')
  t.ok('the folder row is there, with New folder on it', await strip.getByTestId('mail-folder-new').isVisible())

  /* 1. A folder for a client. */
  await strip.getByTestId('mail-folder-new').click()
  await page.getByLabel('Folder name').fill('Statements')
  await page.getByLabel('Linked client').selectOption({ label: COMPANY.name })
  await page.getByTestId('folder-save').click()
  await page.getByTestId('mail-folder-empty').waitFor({ timeout: 5000 })
  t.ok('a new folder is made and opened, linked to its client', /Statements/.test(await strip.innerText()) && (await strip.innerText()).includes(COMPANY.name))
  t.ok('...empty, saying how to fill it', /Nothing in Statements yet/.test(await page.getByTestId('mail-folder-empty').innerText()))

  /* 2. File one message from the Inbox. */
  await page.getByTestId('mail-tab-all').click()
  await page.getByText(subject).first().waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByTestId('mail-bulk-folder').click()
  await page.getByTestId('folder-pick').filter({ hasText: 'Statements' }).click()
  await page.waitForTimeout(600)
  const moved = MAIL.find((m) => m.folder_id === 'fold-1')
  t.ok('a ticked message is filed in the folder', !!moved)
  t.check('...and leaves the Inbox', moved ? await page.getByText(moved.subject, { exact: true }).count() : -1, 0)
  t.ok('...and, on no record yet, is put on the folder\'s client too', moved ? links.includes(moved.id) : false)
  t.ok('...which it says', /filed in Statements, 1 also put on/.test(await page.locator('body').innerText()))

  /* 3. In the folder, and back out. */
  await strip.getByTestId('mail-folder').filter({ hasText: 'Statements' }).click()
  await page.getByText(moved.subject).first().waitFor({ timeout: 5000 })
  t.ok('the folder shows it', true)
  t.check('...with its unread on the folder\'s chip', await strip.getByTestId('mail-folder-unread').count(), moved.read_at ? 0 : 1)
  /* Select mode stays on after a move, as it does after every bulk action on this page. */
  if (await page.getByRole('button', { name: 'Select', exact: true }).count()) await page.getByRole('button', { name: 'Select', exact: true }).click()
  await page.getByRole('checkbox').nth(1).check()
  await page.getByTestId('mail-bulk-folder').click()
  await page.getByTestId('folder-pick-inbox').click()
  await page.waitForTimeout(600)
  t.check('Back to the inbox takes it out of the folder', moved.folder_id, null)
} catch (e) {
  await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: '.qa-screenshots/mail-folders-fail.png' }).catch(() => {})
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`, false)
} finally {
  await browser?.close()
  stopServer(server)
}
process.exit(t.finish() ? 0 : 1)
