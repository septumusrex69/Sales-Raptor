/**
 * CONVERSATION MODE IN A REAL BROWSER (R-13's second half, S19 · Raptor H18; Rinda: "have all the emails together
 * that is in a trail"; Stephan: "You can build in the conversation mode").
 *
 *  1. Off by default: every message is its own row.
 *  2. Conversations on: a client's three-message trail is ONE row, with "3" on it; another sender's message on the
 *     same words is still its own row.
 *  3. Opening the trail lists all of it above the message -- and the sent reply too, which is on no Inbox page and
 *     is read from the whole mailbox; a tap opens an older one in place.
 *  4. The switch is remembered on the device.
 *
 * Run: node scripts/qa/e2e/mail-conversations.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, COLLEAGUE, MAIL as FIXTURE, PROFILE, TEAM, USER_ID } from './fixtures.mjs'

const t = makeRunner('mail-conversations')
const base = { ...FIXTURE[0], folder_id: null, done_at: null, read_at: null, linked_company_id: null, is_filed: false, companies: null }
const at = (min) => new Date(Date.UTC(2026, 10, 6, 8, min)).toISOString()
const row = (id, subject, from, fromName, min, over = {}) => ({
  ...base, id, uid: 900 + min, message_id: `<${id}@example>`, subject, from_address: from, from_name: fromName,
  snippet: `${fromName} on ${subject}`, occurred_at: at(min), to_address: PROFILE.email,
  to_recipients: [{ name: 'Me', address: PROFILE.email }], cc_recipients: [], ...over,
})
const T = (n) => `cccccccc-0000-4000-8000-00000000000${n}`
const INBOX = [
  row(T(1), 'Statement for October', 'accounts@alianna.example', 'Alianna Accounts', 1),
  row(T(2), 'RE: Statement for October', 'accounts@alianna.example', 'Alianna Accounts', 3,
    { cc_recipients: [{ name: 'Camille', address: 'camille@bredellferreira.example' }] }),
  row(T(3), 'Re: RE: Statement for October', 'camille@bredellferreira.example', 'Camille', 5),
  row(T(4), 'Statement for October', 'someone.else@other.example', 'Someone Else', 4),
]
const SENT = row(T(5), 'Re: Statement for October', PROFILE.email, 'Me', 2,
  { is_sent: true, to_address: 'accounts@alianna.example', to_name: 'Alianna Accounts', to_recipients: [{ name: 'Alianna Accounts', address: 'accounts@alianna.example' }] })
const ALL = [...INBOX, SENT]
const newest = (a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at)

const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: PROFILE.email } })],
  [(u) => u.includes('/rest/v1/profiles'), (u) => {
    const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
    return { body: one ? [PROFILE, COLLEAGUE].filter((p) => p.id === one) : [PROFILE, COLLEAGUE] }
  }],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  [(u) => u.includes('/rest/v1/user_emails'), (u, req) => {
    if (req.method() === 'PATCH') return { body: [] }
    const d = decodeURIComponent(u)
    const oneId = /[?&]id=eq\.([0-9a-f-]+)/.exec(d)?.[1]
    if (oneId) return { body: ALL.filter((m) => m.id === oneId) }
    /* The trail's read: the whole mailbox by the core of the subject, sent included. */
    const like = /subject=ilike\.[%*]([^&%*]+)[%*]/.exec(d)?.[1]?.replace(/\+/g, ' ')
    if (like) return { body: ALL.filter((m) => m.subject.toLowerCase().includes(like.toLowerCase())).sort(newest) }
    let rows = d.includes('is_sent=eq.true') ? [SENT] : INBOX
    if (d.includes('read_at=is.null')) rows = rows.filter((m) => !m.read_at)
    rows = [...rows].sort(newest)
    return { body: rows, headers: { 'content-range': `0-${rows.length - 1}/${rows.length}` } }
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
  const rows = page.getByText(/on (RE: |Re: RE: )?Statement for October$/)
  await rows.first().waitFor({ timeout: 20000 })
  const toggle = page.getByTestId('mail-conversations')
  t.check('off by default', await toggle.getAttribute('aria-pressed'), 'false')
  t.check('...so every message is its own row', await rows.count(), 4)

  /* 2. On. */
  await toggle.click()
  await page.waitForTimeout(300)
  t.check('Conversations on: the client trail is one row, the other sender still their own', await rows.count(), 2)
  t.check('...and the trail\'s row says 3', (await page.getByTestId('thread-count').allInnerTexts()).join(','), '3')
  t.ok('...standing for its newest message', await page.getByText('Camille on Re: RE: Statement for October').isVisible())

  /* 3. Open it. */
  await page.getByText('Camille on Re: RE: Statement for October').click()
  const trail = page.getByTestId('conversation-trail')
  await trail.waitFor({ timeout: 10000 })
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="conversation-message"]').length >= 4, null, { timeout: 10000 })
  const items = trail.getByTestId('conversation-message')
  t.check('the trail lists all four: three received and the reply I sent', await items.count(), 4)
  t.ok('...the sent one from the whole mailbox, marked as mine', /You → Alianna Accounts/.test(await trail.innerText()))
  t.ok('...not the other sender\'s message on the same words', !/Someone Else/.test(await trail.innerText()))
  t.ok('...oldest at the top, as a trail is read', /^Alianna Accounts/.test((await items.first().innerText()).trim()))
  await t.shot(page, 'mail-conversations')
  await items.first().click()
  await page.waitForTimeout(400)
  t.check('a tap opens the oldest in place', await items.first().getAttribute('aria-current'), 'true')

  /* 4. Remembered. */
  await page.reload()
  await rows.first().waitFor({ timeout: 20000 })
  t.check('the switch is remembered on this device', await page.getByTestId('mail-conversations').getAttribute('aria-pressed'), 'true')
} catch (e) {
  await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: '.qa-screenshots/mail-conversations-fail.png' }).catch(() => {})
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`, false)
} finally {
  await browser?.close()
  stopServer(server)
}
process.exit(t.finish() ? 0 : 1)
