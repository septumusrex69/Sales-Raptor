/**
 * THE DEBTOR PORTAL, IN A REAL BROWSER (Raptor H16, part 1).
 *
 * A debtor opens /my-account from an SMS, types the case number however they copied it, gets a code, and sees what
 * they owe, how to pay and what they have paid -- with none of Raptor's staff screens around it. The server is
 * answered from fixtures; what this holds is that the page asks it the right things and draws the answer.
 *
 * Run: node scripts/qa/e2e/debtor-portal.mjs
 */
import { OUT, PORT, chromium, makeRunner, startServer, stopServer, stubSupabase } from './harness.mjs'

const t = makeRunner('debtor-portal')
const plain = (x) => x.split(String.fromCharCode(0xa0)).join(' ')
const asked = []
const TOKEN = 'a'.repeat(64)
const ACCOUNT = {
  asAt: '2026-11-11', name: 'Tumelo Patience Molefe', caseNumber: 'RAP-125318', client: 'Alianna Pharmacy', clientReference: 'ALIANNAPH/30182',
  closed: null,
  summary: { capital: 177.5, interest: 0, fees: 177.5, paid: 100, balance: 255, settleToday: 280.5, note: 'Interest, fees and costs on this account have reached the legal maximum (the in duplum rule): they can no longer grow, so what you see is the most that can be claimed on top of the amount you owed.' },
  payments: [{ on: '2026-10-23', amount: 100 }],
  pay: { accountName: 'Bredell Ferreira Attorneys Trust Account', bank: 'FNB', branchCode: '250655', accountNumber: '62000000000', accountType: 'Trust', reference: 'RAP-125318' },
  contact: { phone: '012 000 0000', email: 'collections@bredellferreira.co.za' },
  live: null,
  proposal: null,
  tickets: [],
}
let offered = null
const raised = []

const server = await startServer()
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  await stubSupabase(page, [])
  await page.route('**/api/debtor/*', async (route) => {
    const action = route.request().url().split('/api/debtor/')[1]
    const body = route.request().postDataJSON() ?? {}
    asked.push([action, body, route.request().headers()['x-debtor-token'] ?? null])
    if (action === 'request-code') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'If that case number is one of ours, a code is on its way to the email address (or cellphone) we have for you. It lasts 10 minutes.' }) })
    if (action === 'verify') return body.code === '123456'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: TOKEN, expiresAt: '2026-11-18T00:00:00Z', needsPassword: true }) })
      : route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'That code is not right. Check it, or ask for a new one.' }) })
    if (action === 'account') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(offered
      ? { ...ACCOUNT, proposal: { status: 'pending', arrangement: offered.arrangement, amount: Number(offered.amount), firstDueOn: offered.firstDueOn, declineReason: null, createdAt: '2026-11-11T08:00:00Z' } }
      : ACCOUNT) })
    if (action === 'dispute' || action === 'ask') { raised.push([action, body]); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ticketNo: 1041 }) }) }
    if (action === 'propose') { offered = body; return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) }
    if (action === 'statement') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fileName: 'Statement RAP-125318 2026-11-11.pdf', pdf: Buffer.from('%PDF-1.7 test').toString('base64') }) })
    if (action === 'proof-of-payment') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    if (action === 'set-password') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    if (action === 'sign-in') return body.password === 'a good password'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: TOKEN, expiresAt: '2026-12-11T00:00:00Z' }) })
      : route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'That case number and password do not match. First time here, or forgot your password? Send yourself a code.' }) })
    if (action === 'sign-out') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    return route.fulfill({ status: 404, body: '{}' })
  })

  await page.goto(`http://127.0.0.1:${PORT}/my-account`, { waitUntil: 'domcontentloaded' })
  /* A RETURNING DEBTOR'S PAGE FIRST: case number and password (Stephan, 3 Nov: a code "not every single time"). */
  await page.getByTestId('debtor-password').waitFor({ timeout: 20000 })
  t.ok('no staff menu around it -- a debtor never sees Raptor', await page.getByRole('navigation').count() === 0 && !/Dashboard|Diary|Trust/.test(await page.locator('body').innerText()))
  t.ok('it opens on case number and password, with the code one press away for a first visit', await page.getByLabel('Password').isVisible()
    && /First time here, or forgot your password\? Send me a code/.test(await page.getByTestId('debtor-first-time').innerText()))
  await page.getByTestId('debtor-first-time').click()
  await page.getByTestId('debtor-ask').waitFor()

  await page.getByLabel('Case number').fill('blah')
  await page.getByRole('button', { name: 'Send me a code' }).click()
  t.ok('something that is not a case number is said, and not sent', /Type the case number/.test(await page.getByTestId('debtor-error').innerText()) && asked.length === 0)

  await page.getByLabel('Case number').fill('rap 125318')
  await page.getByRole('button', { name: 'Send me a code' }).click()
  await page.getByTestId('debtor-verify').waitFor()
  t.ok('the case number goes as typed; the server reads it', JSON.stringify(asked.at(-1)?.[1]) === JSON.stringify({ caseNumber: 'rap 125318' }))
  t.ok('...and the answer never says whether the case exists', /If that case number is one of ours/.test(await page.getByTestId('debtor-code-sent').innerText()))

  await page.getByLabel('Code').fill('000000')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByTestId('debtor-error').waitFor()
  t.ok('a wrong code is said', /That code is not right/.test(await page.getByTestId('debtor-error').innerText()))

  await page.getByLabel('Code').fill('123456')
  await page.getByRole('button', { name: 'Continue' }).click()
  /* THE CODE ONCE, THEN A PASSWORD. */
  await page.getByTestId('debtor-choose-password').waitFor({ timeout: 10000 })
  t.ok('after the first code the debtor chooses a password, and is told it replaces the code', /next time you sign in with your case number and this password, and no code/.test(await page.getByTestId('debtor-choose-password').innerText()))
  await page.getByLabel('New password').fill('a good password')
  await page.getByRole('button', { name: 'Save my password and open my account' }).click()
  await page.getByTestId('debtor-account').waitFor({ timeout: 10000 })
  t.ok('...the password is saved with the session the code opened', asked.some(([a, b, tok]) => a === 'set-password' && b.password === 'a good password' && tok === TOKEN))
  t.ok('the account is read with the session token', asked.some(([a, , tok]) => a === 'account' && tok === TOKEN))
  const view = plain(await page.getByTestId('debtor-account').innerText())
  t.ok('who and whose: name, case, the client and their reference', /Tumelo Patience Molefe/.test(view) && /Case RAP-125318 · on behalf of Alianna Pharmacy \(their reference ALIANNAPH\/30182\)/.test(view))
  /* en-ZA in Chromium writes R 255,00 and Node R 255.00 (HANDOFF: the separators differ), so either mark. */
  t.ok('what they owe, large', /^R 255[.,]00$/.test(plain(await page.getByTestId('debtor-balance').innerText())))
  t.ok('what settling today costs, and why it differs', /To settle in full today: R 280[.,]50/.test(view) && /fee on the final payment/.test(view))
  t.ok('the breakdown adds up to it', /Original amount owed\s*R 177[.,]50/.test(view) && /Fees and costs \(VAT included\)\s*R 177[.,]50/.test(view) && /You have paid\s*− R 100[.,]00/.test(view))
  t.ok('in duplum is explained', /legal maximum \(the in duplum rule\)/.test(plain(await page.getByTestId('debtor-note').innerText())))
  const pay = plain(await page.getByTestId('debtor-pay').innerText())
  t.ok('how to pay: the trust account, with the case number as the reference', /Trust Account/.test(pay) && /62000000000/.test(pay) && /Reference\s*RAP-125318/.test(pay))
  t.ok('the payments received are listed', /23 October 2026\s*R 100[.,]00/.test(plain(await page.getByTestId('debtor-payments').innerText())))
  const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  t.ok('it fits a phone: nothing scrolls sideways', wide)
  await t.shot(page, 'debtor-portal-account')

  /* ---------- part 2: the statement, and a proof of payment ---------- */
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('debtor-statement').click()])
  t.check('the statement arrives as a PDF file named for the case', download.suggestedFilename(), 'Statement RAP-125318 2026-11-11.pdf')
  t.ok('...asked for with the session token', asked.some(([a, , tok]) => a === 'statement' && tok === TOKEN))

  await page.getByRole('button', { name: 'Send it' }).isDisabled().then((d) => t.ok('nothing to send until a file is chosen', d))
  await page.getByLabel('Proof of payment file').setInputFiles({ name: 'slip.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') })
  await page.getByLabel('Amount paid').fill('500')
  await page.getByLabel('Date paid').fill('2026-11-10')
  await page.getByRole('button', { name: 'Send it' }).click()
  await page.getByTestId('debtor-pop-done').waitFor()
  const sentPop = asked.find(([a]) => a === 'proof-of-payment')
  t.ok('the slip goes up as the file the debtor chose, with what they said they paid',
    !!sentPop && sentPop[1].fileName === 'slip.png' && Buffer.from(sentPop[1].data, 'base64').toString() === 'not really a png'
    && sentPop[1].amount === '500' && sentPop[1].paidOn === '2026-11-10' && sentPop[2] === TOKEN)
  t.ok('...and the debtor is told it is not yet a payment', /check it against our bank account/.test(await page.getByTestId('debtor-pop-done').innerText()))
  await t.shot(page, 'debtor-portal-part2')

  /* ---------- part 3: an arrangement, offered ---------- */
  await page.getByTestId('debtor-propose').waitFor()
  await page.getByRole('radio', { name: 'Monthly' }).click()
  await page.getByLabel('Amount you can pay').fill('10')
  await page.getByLabel('First payment date').fill('2026-12-25')
  t.ok('a first payment more than 30 days out is explained, and cannot be sent', /within 30 days/.test(await page.getByTestId('debtor-offer-problem').innerText())
    && await page.getByTestId('debtor-propose').getByRole('button', { name: /Send my/ }).isDisabled())
  await page.getByLabel('First payment date').fill('2026-11-25')
  /* R10 a month on R280,50 is 29 months: longer than 12, so an APPLICATION (Stephan, 3 Nov), not a refusal. */
  const app = plain(await page.getByTestId('debtor-offer-application').innerText())
  t.ok(`more than 12 months is an application, said before Send with what would avoid it (${app.slice(0, 60)}...)`,
    /29 months/.test(app) && /affordability assessment/.test(app) && /At R 23[.,]38 a month or more it is an ordinary offer/.test(app))
  t.ok('...and the button says application', await page.getByRole('button', { name: 'Send my application' }).isEnabled())
  await page.getByLabel('Amount you can pay').fill('50')
  t.ok('within 12 months it is an ordinary offer again', await page.getByTestId('debtor-offer-application').count() === 0)
  t.ok('a good offer says how many payments it takes', /R 50[.,]00 a month from 25 November 2026: about 6 payments to settle/.test(plain(await page.getByTestId('debtor-offer-summary').innerText())))
  await page.getByRole('button', { name: 'Send my offer' }).click()
  await page.getByTestId('debtor-offer-pending').waitFor()
  t.check('the offer goes to the server as chosen', JSON.stringify(offered), JSON.stringify({ arrangement: 'monthly', amount: '50', firstDueOn: '2026-11-25' }))
  t.ok('...and the page then says it is waiting for us, not agreed', /We have your offer of R 50[.,]00 a month/.test(plain(await page.getByTestId('debtor-offer-pending').innerText())))
  await t.shot(page, 'debtor-portal-part3')

  /* ---------- part 4: a question, and a dispute ---------- */
  const tk = page.getByTestId('debtor-ticket')
  await tk.getByRole('radio', { name: 'Ask a question' }).click()
  await page.getByLabel('Your question').fill('hi')
  await page.getByRole('button', { name: 'Send my question' }).click()
  t.ok('a question needs more than a word, said and not sent', /Type your question first/.test(await page.getByTestId('debtor-ticket-error').innerText()) && raised.length === 0)
  await page.getByLabel('Your question').fill('Can I pay on the 25th instead of the 1st?')
  await page.getByRole('button', { name: 'Send my question' }).click()
  await page.getByTestId('debtor-ticket-sent').waitFor()
  t.ok('a question is sent as written, and acknowledged with its reference', JSON.stringify(raised.at(-1)) === JSON.stringify(['ask', { text: 'Can I pay on the 25th instead of the 1st?' }])
    && /reference 1041/.test(await page.getByTestId('debtor-ticket-sent').innerText()))
  await page.getByRole('button', { name: 'Send something else' }).click()
  await page.getByRole('radio', { name: 'I dispute this account' }).click()
  t.ok('a dispute says, before it is sent, that collecting pauses and the reply is in writing', /We pause collecting while we look into it, and reply in writing/.test(await page.getByTestId('debtor-ticket').innerText()))
  await page.getByLabel('Why do you dispute it').selectOption('This is not my debt')
  await page.getByLabel('What is wrong').fill('I never had an account with Alianna Pharmacy.')
  await page.getByRole('button', { name: 'Send my dispute' }).click()
  await page.getByTestId('debtor-ticket-sent').waitFor()
  t.ok('the dispute goes with the debtor\'s reason and words', JSON.stringify(raised.at(-1)) === JSON.stringify(['dispute', { reason: 'This is not my debt', text: 'I never had an account with Alianna Pharmacy.' }]))
  t.ok('...and is acknowledged as paused, answered in writing', /Collection is paused while we look into it/.test(await page.getByTestId('debtor-ticket-sent').innerText()))
  await t.shot(page, 'debtor-portal-part4')

  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.getByTestId('debtor-password').waitFor()
  t.ok('signing out forgets the session in this browser', (await page.evaluate(() => sessionStorage.getItem('raptor.debtor.token') ?? localStorage.getItem('raptor.debtor.token'))) === null)

  /* ---------- the next visit: case number and password, NO code ---------- */
  const codesBefore = asked.filter(([a]) => a === 'request-code').length
  await page.getByLabel('Case number').fill('RAP-125318')
  await page.getByLabel('Password').fill('wrong one')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByTestId('debtor-error').waitFor()
  t.ok('a wrong password is said the same way whatever the reason', /case number and password do not match/.test(await page.getByTestId('debtor-error').innerText()))
  await page.getByLabel('Password').fill('a good password')
  await page.getByLabel('Keep me signed in on this device').check()
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByTestId('debtor-account').waitFor({ timeout: 10000 })
  t.ok('the next visit signs in with the password -- no code asked for', asked.filter(([a]) => a === 'request-code').length === codesBefore)
  t.ok('..."keep me signed in" keeps it in this browser, past the tab', (await page.evaluate(() => localStorage.getItem('raptor.debtor.token'))) === TOKEN)
  await context.close()
} catch (e) {
  try { const pg = browser.contexts().flatMap((c) => c.pages())[0]; if (pg) await t.shot(pg, 'debtor-portal-where-it-stopped') } catch { /* */ }
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  await browser.close()
  stopServer(server)
}
const good = t.finish(`The debtor portal signs in by case number and shows what is owed, how to pay and what was paid.
Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)
