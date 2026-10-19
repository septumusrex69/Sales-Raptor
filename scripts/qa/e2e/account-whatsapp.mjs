/**
 * WHATSAPP FROM A DEBTOR'S ACCOUNT, in a real browser (S9, 19 Oct). The firm: "if I click on the
 * WhatsApp number ... it already opens it."
 *
 * The press is a real link to wa.me on the debtor's cellphone, in the form WhatsApp needs (27..., not
 * the 082... on file), with the opening line typed in and our case number in it; and pressing it
 * notes the account and raises item 1(c), the firm's decision ("just charge everything").
 *
 * Run: node scripts/qa/e2e/account-whatsapp.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, LIBRARY, PROFILE, TEAM, USER_ID, accountsPage } from './fixtures.mjs'
import { readFileSync } from 'node:fs'

const t = makeRunner('account-whatsapp')
const ACCOUNT = { ...accountsPage(1)[0], id: 'acc-0000', status: 'Active: Activated', case_number: 'BF-004321', debtor_first_name: 'Piet' }

/* A section 129 in the library, as seeded: the WhatsApp box offers the letters written for this debtor. */
const S129 = { ...LIBRARY.find((r) => r.kind === 'letter'), seed_key: 'letter-s129-individual', audience: 'individual', active: true }
const seen = []
const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: PROFILE.email } })],
  [(u) => u.includes('/rest/v1/profiles'), (u) => {
    const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
    return { body: one ? [PROFILE].filter((p) => p.id === one) : [PROFILE] }
  }],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  /* A cellphone and a landline: only the cellphone may be offered, so there is no question to ask. */
  [(u) => u.includes('/rest/v1/account_contacts'), () => ({
    body: [
      { id: 'ct-1', account_id: ACCOUNT.id, kind: 'mobile', value: '0824567890', label: null, person_name: null, person_role: null, is_primary: true, verified_at: null, retired_at: null, retired_reason: null, notes: null, created_at: '2026-03-01T08:00:00Z' },
      { id: 'ct-2', account_id: ACCOUNT.id, kind: 'landline', value: '011 592 0520', label: null, person_name: null, person_role: null, is_primary: false, verified_at: null, retired_at: null, retired_reason: null, notes: null, created_at: '2026-03-01T08:00:00Z' },
    ],
  })],
  [(u) => u.includes('/rpc/account_charge_basis'), () => ({ body: { capital: 750000, spent_on_item: 0, towards_ceiling: 0 } })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  [(u) => u.includes('/rest/v1/message_templates'), () => ({ body: [S129] })],
  [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [ACCOUNT], headers: { 'content-range': '0-0/1' } })],
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { context, page } = await signedInPage(browser, PROFILE, handlers, seen)
  await page.setViewportSize({ width: 1024, height: 768 })
  /* wa.me is the outside world: the tab WhatsApp would open in is answered with nothing. */
  await context.route('https://wa.me/**', (r) => r.fulfill({ status: 200, body: 'whatsapp' }))
  let up = false
  for (let i = 0; i < 60 && !up; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/accounts/${ACCOUNT.id}`, { timeout: 2000 }); up = true }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the account opens', up)

  /* WHATSAPP OPENS A BOX: a message, or a letter (the firm, 19 Oct: "I wanna send a section 129 via
     WhatsApp"). */
  const button = page.getByTestId('account-whatsapp')
  await button.waitFor({ timeout: 20000 })
  await button.click()
  const box = page.getByTestId('account-whatsapp-box')
  t.ok('WhatsApp opens the box: a message, or a letter', await box.isVisible())
  const wa = box.getByTestId('whatsapp-link')
  t.check('one cellphone, so no number is asked (the landline is not offered)', await box.getByText('Which number?').count(), 0)
  const href = (await wa.first().getAttribute('href')) ?? ''
  t.ok(`a message: WhatsApp on the number as it needs it (${href.slice(0, 40)}…)`, href.startsWith('https://wa.me/27824567890?text='))
  const text = decodeURIComponent(href.split('text=')[1] ?? '')
  t.ok(`...with the opening line, our case number in it ("${text}")`, /^Good day Piet, this is .+ from Bredell Ferreira, regarding your account BF-004321\.$/.test(text))
  t.check('...in a new tab, Raptor stays where it is', await wa.first().getAttribute('target'), '_blank')

  /* A LETTER: drawn, then two presses -- save the PDF, open WhatsApp with the short line. */
  await box.getByTestId('whatsapp-letters').getByRole('button', { name: /Section 129/ }).click()
  const ready = page.getByTestId('whatsapp-letter-ready')
  await ready.getByTestId('whatsapp-letter-pdf').waitFor({ timeout: 20000 })
  const line = await ready.getByTestId('whatsapp-letter-text').innerText()
  t.ok(`the letter's short covering line, not the letter ("${line}")`, /Attached is a Section 129 notice/.test(line) && /BF-004321/.test(line) && line.length < 300)
  const letterHref = (await ready.getByTestId('whatsapp-link').getAttribute('href')) ?? ''
  t.ok('...and WhatsApp opens with that line typed in', decodeURIComponent(letterHref.split('text=')[1] ?? '') === line)

  /* ONE PRESS (the firm, 19 Oct: "automatically, you should copy the message and then open the person
     on WhatsApp ... it should download the PDF so you can just attach it"). */
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  seen.length = 0
  const saved = page.waitForEvent('download', { timeout: 20000 }).catch(() => null)
  const opened = context.waitForEvent('page', { timeout: 10000 }).catch(() => null)
  await ready.getByTestId('whatsapp-link').click()
  const file = await saved
  t.check('one press downloads the PDF, to attach in WhatsApp', file ? readFileSync(await file.path()).subarray(0, 5).toString('latin1') : '(no download)', '%PDF-')
  t.ok('...opens WhatsApp', !!(await opened))
  t.check('...and copies the message', await page.evaluate(() => navigator.clipboard.readText()).catch(() => '(nothing copied)'), line)
  await page.bringToFront()
  /* ON THE WAY BACK, HOW MANY WENT (the firm, 19 Oct). Nothing is recorded until it is answered. */
  const asked = page.getByTestId('whatsapp-sent')
  await asked.waitFor({ timeout: 5000 }).catch(() => {})
  t.ok('back in Raptor, it asks how many messages were sent', await asked.isVisible())
  t.ok('...and nothing is charged before it is answered', !seen.some((s) => /POST \/rest\/v1\/account_fees/.test(s)))
  await page.getByRole('button', { name: 'One more' }).click()
  await page.getByTestId('whatsapp-sent-save').click()
  await page.waitForTimeout(1500)
  t.ok('two messages: the account is noted', seen.some((s) => /POST \/rest\/v1\/account_notes/.test(s)))
  t.ok('...and item 1(c) is raised for them', seen.some((s) => /POST \/rest\/v1\/account_fees/.test(s)))
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message : String(e)})`, false)
} finally {
  await browser?.close()
  await stopServer(server)
}
t.finish('WhatsApp from an account opens WhatsApp on the cellphone, in the right form, and is noted and charged.')
