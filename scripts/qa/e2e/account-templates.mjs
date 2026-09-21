/**
 * THE LIBRARY, REACHED FROM INSIDE AN ACCOUNT — in a real browser.
 *
 * At the firm's instruction: "everything that we have in the library, to be in the account as
 * well as an option."
 *
 * WHY THIS NEEDS THE BROWSER AND NOT ONLY check-account-templates.mjs. That file reads source and
 * asserts the wiring; it cannot tell you the picker never rendered. CLAUDE.md records why this
 * layer exists: a panel shipped, was provably in the deployed bundle, and was invisible. Three
 * new controls were just placed on two screens, which is exactly that risk again.
 *
 * AND ONE THING ONLY A BROWSER CAN ANSWER: whether the words that land in the box carry THIS
 * debtor's figures. The merge runs through useMemo, mergeValuesFor, the balance struck off three
 * ledgers and a template parsed at runtime. Source-reading says the call is wired; only running
 * it says the number came out right — and a template merged against the library's samples would
 * put a fabricated balance into a real demand.
 *
 * Run: node scripts/qa/e2e/account-templates.mjs
 */
import {
  PORT, chromium, makeRunner, signedInPage, startServer, stopServer,
} from './harness.mjs'
import { COMPANY, PROFILE, TEAM, USER_ID, accountsPage } from './fixtures.mjs'

const t = makeRunner('account-templates')
const seen = []

/* The one account this whole file is about. Its balance is what every assertion below reads. */
const ACCOUNT = { ...accountsPage(1)[0], id: 'acc-0000' }

/*
 * THE FIRM'S WORDING, as the library would hold it. Deliberately full of merge fields — a
 * template with no fields in it would merge identically against samples and against the account,
 * so it could not tell the two apart, which is the one thing this file exists to do.
 */
const TEMPLATES = [
  {
    id: 'tpl-sms-1', scope: 'collections', kind: 'sms', name: 'First contact',
    subject: null, format: 'text',
    body: 'Good day {{debtor_name}}. Your account {{reference}} is {{balance}} in arrears. '
      + 'Please telephone {{agent_name}}.',
    position: null, language: 'en', active: true, attachment_id: null,
    seed_key: 'sms-first', updated_at: '2026-09-01T08:00:00Z',
  },
  {
    /* Retired. Offered by the library, which keeps it so somebody can answer "what did we used to
       send?", and NOT offered here, which is a different question. */
    id: 'tpl-sms-old', scope: 'collections', kind: 'sms', name: 'Retired wording',
    subject: null, format: 'text', body: 'Old words.',
    position: null, language: 'en', active: false, attachment_id: null,
    seed_key: null, updated_at: '2026-01-01T08:00:00Z',
  },
  {
    id: 'tpl-letter-1', scope: 'collections', kind: 'letter', name: 'Section 129 notice',
    subject: null, format: 'document',
    body: JSON.stringify({
      defaults: { font: 'Georgia, serif', size: 10.5, colour: '#1f2937', lineHeight: 1.45 },
      blocks: [
        { kind: 'heading', level: 1, spans: [{ text: 'NOTICE IN TERMS OF SECTION 129(1)(a)' }] },
        { kind: 'paragraph', spans: [{ text: 'Dear {{debtor_name}}, you owe {{balance}}.' }] },
      ],
    }),
    position: null, language: 'en', active: true, attachment_id: null,
    seed_key: 'letter-s129', updated_at: '2026-09-01T08:00:00Z',
  },
  {
    /* The covering email, which CARRIES the letter above. attachment_id is what makes its
       "please find the enclosed notice" true. */
    id: 'tpl-email-1', scope: 'collections', kind: 'email', name: 'Section 129 covering email',
    subject: 'Section 129 notice - account {{reference}}', format: 'text',
    body: 'Dear {{debtor_name}},\n\nPlease find the enclosed notice. The balance is {{balance}}.',
    position: null, language: 'en', active: true, attachment_id: 'tpl-letter-1',
    seed_key: 'email-s129', updated_at: '2026-09-01T08:00:00Z',
  },
  {
    /*
     * A TEMPLATE THIS ACCOUNT CANNOT FULLY ANSWER. {{respond_by}} is not the firm's detail and is
     * not on the account either, so nothing can fill it — which is the case the warning exists
     * for, and the case that must NOT be silent.
     */
    id: 'tpl-script-1', scope: 'collections', kind: 'call_script', name: 'Opening the call',
    subject: null, format: 'text',
    body: 'Good day, may I speak to {{debtor_name}}? I am calling about {{balance}} outstanding. '
      + 'We need this settled by {{respond_by}}.',
    position: null, language: 'en', active: true, attachment_id: null,
    seed_key: null, updated_at: '2026-09-01T08:00:00Z',
  },
]

/* The firm's own row. Filled in, so the letter has a trust account to name. */
const FIRM = [{
  firm_name: 'Bredell Ferreira',
  /* Bank and branch code APART, the way the firm asked for them to be stored. {{firm_bank}} joins
     them back together for a notice already written -- which is the half worth driving here. */
  trust_bank: 'Standard Bank',
  trust_branch_code: '051001',
  trust_account_name: 'Bredell Ferreira Trust',
  trust_account_number: '01 234 5678',
  phone: '015 291 1234',
  email: 'info@bredellferreira.co.za',
  website: 'www.bredellferreira.co.za',
  physical_address: '25 Kerk Street\nPolokwane\n0699',
  postal_address: 'PO Box 1234\nPolokwane\n0700',
  office_hours: 'Monday to Friday, 08:00 \u2013 16:30',
  signatory_name: 'J Bredell',
  signatory_title: 'Duly authorised legal representative',
  email_font: 'Georgia, "Times New Roman", Times, serif',
  email_size_pt: '10.5',
  updated_at: '2026-09-01T08:00:00Z',
}]

const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: PROFILE.email } })],
  [(u) => u.includes('/rest/v1/profiles'), (u) => {
    const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
    return { body: one ? [PROFILE].filter((p) => p.id === one) : [PROFILE] }
  }],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rest/v1/firm_settings'), () => ({ body: FIRM })],
  [(u) => u.includes('/rest/v1/message_templates'), () => ({ body: TEMPLATES })],
  [(u) => u.includes('/rest/v1/letterheads'), () => ({ body: [] })],
  /*
   * A NUMBER AND AN ADDRESS ON THE ACCOUNT, because both buttons are disabled without one --
   * SMS is refused with "No phone number on this account yet", which is correct behaviour and
   * would have made every assertion below unreachable.
   */
  [(u) => u.includes('/rest/v1/account_contacts'), () => ({
    body: [
      {
        id: 'ct-1', account_id: ACCOUNT.id, kind: 'mobile', value: '0824567890',
        label: null, person_name: null, person_role: null, is_primary: true,
        verified_at: null, retired_at: null, retired_reason: null, notes: null,
        created_at: '2026-03-01T08:00:00Z',
      },
      {
        id: 'ct-2', account_id: ACCOUNT.id, kind: 'email', value: 'debtor@example.test',
        label: null, person_name: null, person_role: null, is_primary: true,
        verified_at: null, retired_at: null, retired_reason: null, notes: null,
        created_at: '2026-03-01T08:00:00Z',
      },
    ],
  })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({
    body: [ACCOUNT],
    headers: { 'content-range': '0-0/1' },
  })],
]

const server = startServer()
const browser = await chromium.launch()
try {
  const { page } = await signedInPage(browser, PROFILE, handlers, seen)

  let up = false
  for (let i = 0; i < 40 && !up; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/accounts/${ACCOUNT.id}`, { timeout: 2000 }); up = true }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the account opens', up)
  await page.waitForTimeout(2500)

  /* ---------- the SMS box ---------- */

  const smsButton = page.getByRole('button', { name: 'SMS', exact: true }).first()
  t.ok('the account offers an SMS', await smsButton.isVisible())
  await smsButton.click()
  await page.waitForTimeout(600)

  const useTemplate = page.getByRole('button', { name: 'Use a template' }).first()
  /*
   * THE PLACEMENT ASSERTION. This is the one a unit check cannot make: the control is wired, in
   * the bundle, and either on the screen or not.
   */
  t.ok('...with the firm’s wording offered inside it', await useTemplate.isVisible())
  await useTemplate.click()
  await page.waitForTimeout(600)

  /* Retired wording is kept by the library and not offered to send. */
  t.check('a retired template is not offered',
    await page.getByRole('button', { name: /Retired wording/ }).count(), 0)
  t.ok('...and a live one is',
    await page.getByRole('button', { name: /First contact/ }).first().isVisible())

  await page.getByRole('button', { name: /First contact/ }).first().click()
  await page.waitForTimeout(500)

  const smsText = await page.locator('textarea').first().inputValue()
  /*
   * MERGED AGAINST THIS DEBTOR, and asserted on a value that could only have come from the
   * account. The fixture's surname is what the app addressed; the library's sample is
   * "Mr Van Der Westhuizen", so finding THAT here would mean a fabricated name went into a real
   * message.
   */
  t.check(`the wording arrives merged, not in braces (${smsText})`,
    /\{\{/.test(smsText), false)
  t.ok(`...against this account, not the library's samples (${smsText})`,
    !smsText.includes('Van Der Westhuizen') && !smsText.includes('48,250.00'))
  /*
   * AND THE BALANCE IS A REAL FIGURE OFF THIS ACCOUNT -- the strongest thing this file can say.
   * The number went through mergeValuesFor, the statement struck off the three ledgers and the
   * app's own money formatting, and came out as the account's own. Asserted as the FIGURE rather
   * than as "no braces remain": a template that lost the sentence entirely would also have no
   * braces in it.
   */
  t.ok(`...and the debtor's own balance (${JSON.stringify(smsText)})`,
    /R\s?180,000\.00/.test(smsText))
  /* The reference is the client's own, which is what appears on the debtor's paperwork. */
  t.ok('...carrying the reference the debtor knows', smsText.includes('REF/0'))

  /*
   * AND IT IS PRICED. Annexure B item 1(c) is per SEGMENT, so a template that runs past 160
   * characters costs twice what the firm thinks it does. The cost line is live while you type
   * and a template dropped into the box must not bypass it.
   */
  const priceLine = await page.getByText(/plus VAT/).first().innerText()
  t.ok(`...and priced the moment it lands (${priceLine})`, /R\d+\.\d\d plus VAT/.test(priceLine))

  /*
   * AND PRICED AT ONE SEGMENT, WHICH IS THE WHOLE POINT OF THIS ASSERTION.
   *
   * THE BUG THIS CAUGHT, found by looking at the screenshot this file takes. en-ZA groups
   * thousands with a NON-BREAKING space, so a merged {{balance}} arrived carrying U+00A0 -- which
   * is not in the GSM alphabet, so one of them dropped the whole message to UCS-2 and cut every
   * segment from 160 characters to 70. This message is 94 characters: one segment at R3.50 with
   * an ordinary space, TWO at R7.00 with the non-breaking one. Every templated SMS carrying a
   * balance cost the firm double, and the warning it produced named the offending character as
   * " ", which nobody could act on.
   *
   * ASSERTED ON THE SEGMENT COUNT AND THE ENCODING NOTE TOGETHER. The count alone would go green
   * again on a message that merely got shorter.
   */
  const counts = await page.getByText(/characters .* message/).first().innerText()
  t.ok(`...as ONE message, not two (${counts})`, /\b1 message\b/.test(counts))
  t.check('...with nothing in it forcing the expensive encoding',
    await page.getByText(/cuts each message to 70 characters/).count(), 0)
  await t.shot(page, '80-account-sms-template')

  await page.getByRole('button', { name: 'Cancel' }).first().click()
  await page.waitForTimeout(400)

  /* ---------- the call script ---------- */

  await page.getByRole('button', { name: 'Call script' }).first().click()
  await page.waitForTimeout(600)
  t.ok('a call script can be opened from the account',
    await page.getByRole('button', { name: 'Choose a script' }).first().isVisible())
  /* Reading charges nothing, and the screen says so — every other button in that row does. */
  t.ok('...saying plainly that reading charges nothing',
    await page.getByText(/Reading this charges nothing/).first().isVisible())

  await page.getByRole('button', { name: 'Choose a script' }).first().click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /Opening the call/ }).first().click()
  await page.waitForTimeout(500)

  const script = await page.getByText(/may I speak to/).first().innerText()
  /* The figure, not the absence of a placeholder: "does not contain {{balance}}" would also pass
     on a script that lost the sentence entirely. */
  t.ok(`the script carries this debtor's balance (${JSON.stringify(script)})`,
    /R\s?180,000\.00/.test(script))
  /*
   * AND THE FIELD NOTHING COULD FILL IS NAMED. {{respond_by}} is left STANDING in the words by
   * renderTemplate — visible, but visible as a mistake somebody made rather than as a field the
   * app could not answer. The sentence is what turns it into an instruction.
   */
  t.ok('...and what could not be filled is still standing in it', script.includes('{{respond_by}}'))
  t.ok('...and is named, rather than left to be spotted',
    await page.getByText(/\{\{respond_by\}\} could not be filled from this account/).first().isVisible())
  await t.shot(page, '81-account-call-script')
  await page.locator('button[aria-label="Close"]').first().click()
  await page.waitForTimeout(400)

  /* ---------- the email, and the letter its template carries ---------- */

  /*
   * THE FIRM: "if I save the email template and have an attachment to the email template, it
   * should also replicate that when I'm in the account and I want to send something."
   *
   * WHY THIS NEEDS THE BROWSER AND WAS NOT COVERED BEFORE. check-account-templates asserts the
   * wiring by reading source; the SMS box and the call script are driven here. The EMAIL path --
   * the one that has to draw a PDF, size it and hang it on the message -- was asserted only by
   * source-reading. That is the half with a round trip and a PDF library in it.
   */
  await page.getByRole('button', { name: 'Email', exact: true }).first().click()
  await page.waitForTimeout(800)

  const pick = page.getByRole('button', { name: 'Use a template' }).first()
  t.ok('the email composer offers the firm\u2019s templates', await pick.isVisible())
  await pick.click()
  await page.waitForTimeout(600)

  /* The covering email, which carries the section 129. The list says so before it is picked. */
  t.ok('...marking the one that posts a letter',
    await page.getByText('posts a letter').first().isVisible())
  await page.getByRole('button', { name: /Section 129 covering email/ }).first().click()
  await page.waitForTimeout(2500)

  t.check('picking it fills the subject',
    await page.getByLabel(/Subject/).first().inputValue(),
    'Section 129 notice - account REF/0')
  t.ok('...and the body, merged against this debtor',
    (await page.locator('textarea').first().inputValue()).includes('Mhlongo'))
  /*
   * AND THE LETTER CAME WITH IT. message_templates.attachment_id is what makes "please find the
   * enclosed notice" true; an email that says it and encloses nothing is a worse message than one
   * that says nothing at all.
   */
  const attached = await page.getByText(/\.pdf/).first().innerText().catch(() => '')
  t.ok(`the letter it carries is attached as a PDF (${attached})`, /\.pdf/.test(attached))
  await t.shot(page, '82-account-email-template')
} finally {
  await browser.close()
  stopServer(server)
}

const good = t.finish(`The firm's wording, reached from the account it is about: offered in the SMS
box, in the email composer and as a call script, merged against this debtor rather than against the
library's samples, priced the moment it lands, honest about the one field nothing could fill -- and
a covering email brings the letter it posts with it, drawn and attached.`)
process.exit(good ? 0 : 1)
