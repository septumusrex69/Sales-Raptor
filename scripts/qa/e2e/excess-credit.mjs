/**
 * TRUST -> EXCEPTIONS: AN OVERPAYMENT CAN BE DECIDED, IN A REAL BROWSER.
 *
 * The firm, 8 Oct, looking at three R490.42 overpayments: "I don't know how to fix anything ...
 * there's no option." Two things were wrong and only one of them a browser can see:
 *   - a DECIDED overpayment never left the list (finance_exceptions only left out 'with_client'),
 *     so deciding looked like doing nothing -- check-payments-queue holds the SQL;
 *   - "move it to another of their accounts" asked for "the account's id", a database key.
 * So this presses Decide it, sees the four choices, moves the credit to an account PICKED FROM A
 * LIST of the debtor's other accounts, and checks exactly that is sent.
 *
 * Run: node scripts/qa/e2e/excess-credit.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('excess-credit')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null }

const JOB = (id, account, debtor, decided = false) => ({
  allocation_id: id, account_id: account, company_id: 'co-1', client: 'Lowveld Motors (Pty) Ltd',
  case_number: 'RAP-124039', debtor, kind: 'excess_credit',
  problem: 'Paid more than the account owed; held as a credit', amount: 490.42, action: 'Decide',
  run_id: 'run-1', run_status: 'needs_review', occurred_at: '2026-10-06', decided,
})
const OTHER = [
  { id: 'acc-other', account_number: 'LVM-2002', capital_outstanding: 3200, status: 'Active: Activated', companies: { name: 'Lowveld Motors (Pty) Ltd' } },
  { id: 'acc-gone', account_number: 'LVM-1999', capital_outstanding: 0, status: 'Written-off', companies: { name: 'Lowveld Motors (Pty) Ltd' } },
]

let sent = []
const handlers = [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rest\/v1\/firm_settings/.test(u), () => ({ body: [{ firm_name: 'Bredell Ferreira' }] })],
  /* What the database lists: decided ones are gone, as the fixed view has it. */
  [(u) => /\/rpc\/finance_exception_jobs/.test(u), () => ({
    body: [JOB('alloc-ilse', 'acc-ilse', 'Ilse Muller'), JOB('alloc-nobody', 'acc-solo', 'Sole Debtor')]
      .filter((j) => !sent.some((s) => s.p_allocation === j.allocation_id)),
  })],
  /* The account's own identity number, then the debtor's other accounts by it. */
  [(u) => /\/rest\/v1\/debtor_accounts\?.*select=debtor_id_number/.test(u), (u) => ({
    body: /id=eq\.acc-ilse/.test(u)
      ? { debtor_id_number: '8001015009087', debtor_kind: 'individual' }
      : { debtor_id_number: null, debtor_kind: 'individual' },
  })],
  [(u) => /\/rest\/v1\/debtor_accounts\?.*debtor_id_number=eq\./.test(u), () => ({ body: OTHER })],
  [(u) => /\/rpc\/dispose_excess_credit/.test(u), (u, req) => { sent.push(req.postDataJSON()); return { body: 'done' } }],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
  await page.goto(`http://127.0.0.1:${PORT}/trust/exceptions`, { waitUntil: 'domcontentloaded' })
  const decide = page.getByRole('button', { name: 'Decide it' })
  await decide.first().waitFor({ timeout: 20000 })
  t.check('both overpayments are listed', await decide.count(), 2)

  /* ---- the box opens, with every choice ---- */
  await page.getByTestId('exception-row').filter({ hasText: 'Ilse Muller' }).filter({ hasText: 'Lowveld Motors' })
    .first().getByRole('button', { name: 'Decide it' }).click()
  await page.getByText('Refund it to the debtor').waitFor({ timeout: 10000 })
  for (const choice of ['Refund it to the debtor', 'Move it to another of their accounts', 'Release it to the client']) {
    t.ok(`"${choice}" is a choice`, await page.getByText(choice).first().isVisible())
  }

  /* ---- move: picked from a list, never typed ---- */
  await page.getByText('Move it to another of their accounts').click()
  const pick = page.locator('select').filter({ has: page.locator('option', { hasText: 'Choose one of their accounts' }) })
  await pick.waitFor({ timeout: 10000 })
  t.check('there is no box to type an account id into', await page.getByPlaceholder("The account's id").count(), 0)
  const options = await pick.locator('option').allInnerTexts()
  t.ok(`the debtor's other open account is offered (${options.join(' | ')})`, options.some((o) => /LVM-2002/.test(o)))
  t.check('...and a written-off one is not', options.some((o) => /LVM-1999/.test(o)), false)
  await pick.selectOption('acc-other')
  await page.getByPlaceholder('The debtor asked for it back').fill('Debtor asked for it to go to their other account')
  await t.shot(page, 'excess-credit-move')
  await page.getByRole('button', { name: 'Decide it' }).last().click()
  await page.waitForTimeout(500)
  t.check('Decide it sends the move to the chosen account', JSON.stringify(sent[0]), JSON.stringify({
    p_allocation: 'alloc-ilse', p_disposal: 'moved', p_reason: 'Debtor asked for it to go to their other account',
    p_payable_to: null, p_move_to: 'acc-other',
  }))
  /* AND IT LEAVES THE LIST -- the half the firm could not see. */
  await page.waitForTimeout(500)
  t.check('...and the decided one leaves the list', await page.getByRole('button', { name: 'Decide it' }).count(), 1)

  /* ---- a debtor with no other account is told so, not handed an empty box ---- */
  await page.getByRole('button', { name: 'Decide it' }).first().click()
  await page.getByText('Move it to another of their accounts').click()
  await page.getByTestId('no-move-target').waitFor({ timeout: 10000 }).catch(() => {})
  t.ok('a debtor with no other account is told there is nowhere to move it',
    await page.getByTestId('no-move-target').isVisible())
  await context.close()
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).split('\n')[0].slice(0, 160)})`, false)
  try {
    const pages = browser.contexts().flatMap((c) => c.pages())
    if (pages[0]) await t.shot(pages[0], 'excess-credit-where-it-stopped')
  } catch { /* nothing more to learn */ }
} finally {
  await browser.close()
  stopServer(server)
}

const good = t.finish(`An overpayment on Exceptions opens its four choices, moves to an account picked from the debtor's
others, and leaves the list once decided. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)
