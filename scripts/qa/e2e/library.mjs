/**
 * The library, in a real browser.
 *
 * WHAT ONLY A BROWSER CAN SETTLE HERE. check-message-templates.mjs proves the rules — which
 * fields each side may use, what counts as unknown, what an SMS costs. It cannot say that the
 * page renders, that switching side changes the list rather than filtering one, that letters stay
 * off the sales library, or — the one that matters most — that a template nothing can fill is
 * actually MARKED as such where somebody will see it.
 *
 * That last one is the page's reason for existing. renderTemplate deliberately leaves an
 * unresolved placeholder standing rather than printing a gap, so a template referring to a field
 * that does not exist does not fail: it posts "{{bank_account_number}}" to a debtor, on the
 * firm's letterhead. A library that lists such a template without saying so is worse than no
 * library, because it looks like sign-off.
 *
 * AND THE DOOR, WHICH IS NOW A WINDOW. "Perhaps everyone can view everything in the library. Only
 * [an administrator] can edit." That reverses an earlier instruction to keep collectors out
 * altogether, so the check reverses with it: a team leader must be able to READ every word here
 * and must not be offered a single control that writes one.
 *
 * THE INTERESTING HALF IS THE SECOND ONE. "Can they see it" fails loudly — the page is blank.
 * "Can they change it" fails silently, because RLS refuses the write and the person is left
 * looking at a form that appeared to work. Every one of Edit, New template, Delete and the
 * attachment picker is asserted absent for the reader, one by one, rather than by screenshot.
 *
 * Run: node scripts/qa/e2e/library.mjs
 */
import {
  OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer,
} from './harness.mjs'
import { COMPANY, LIBRARY, PROFILE, TEAM } from './fixtures.mjs'

/*
 * PROFILE is a team leader: the person who may read every word here and change none of it. The
 * administrator is the same person with the one field that decides it changed, so the two runs
 * differ by exactly the thing under test and nothing else.
 */
const ADMIN = { ...PROFILE, role: 'Administrator' }

const t = makeRunner('library')
const seen = []
/** Every write the page sent, so a save can be checked on the wire and not on the screen. */
const written = []

/** The same stub for both people; only the profile's role changes. */
const handlersFor = (profile) => [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: profile.id, email: profile.email } })],
  [
    (u) => u.includes('/rest/v1/profiles'),
    (u) => {
      const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
      return { body: one ? [profile].filter((p) => p.id === one) : [profile] }
    },
  ],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  [
    (u) => u.includes('/rest/v1/message_templates'),
    /*
     * THE STUB APPLIES THE SCOPE CLAUSE. Answering both sides out of the whole fixture would put
     * the same rows under both libraries — which looks exactly like a working scope switch and is
     * a stub ignoring it.
     */
    (u, req) => {
      /* A write comes back as the row PostgREST would have returned, and is recorded so the
         check can assert on what actually left the browser rather than on what the form shows. */
      if (req.method() === 'DELETE') {
        written.push({ method: 'DELETE', url: u, body: '' })
        return { body: [] }
      }
      if (req.method() === 'PATCH' || req.method() === 'POST') {
        written.push({ method: req.method(), url: u, body: req.postData() ?? '' })
        return { body: [{ ...LIBRARY[0], id: 'cccccccc-0000-4000-8000-00000000000f' }] }
      }
      /*
       * THE ATTACHER LOOKUP, answered separately. templateUsage asks this same table for the
       * emails carrying a letter; answering it out of the whole fixture would name every template
       * in the library as an attacher, which looks exactly like a working warning.
       */
      const attaching = /attachment_id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
      if (attaching) return { body: LIBRARY.filter((r) => r.attachment_id === attaching) }
      const scope = /scope=eq\.(\w+)/.exec(u)?.[1]
      return { body: scope ? LIBRARY.filter((r) => r.scope === scope) : LIBRARY }
    },
  ],
  /*
   * WHERE A TEMPLATE IS USED, which is what decides whether it may be deleted.
   *
   * The handover email is wired into a step of a PUBLISHED workflow and must be refused; every
   * other template is used by nobody and may go. One fixture answering both cases is what stops
   * the check passing whichever answer the page happens to give.
   */
  [
    (u) => u.includes('/rest/v1/workflow_nodes'),
    (u) => {
      const id = /template_id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
      return {
        body: id === LIBRARY[1].id
          ? [{
            id: 'node-1',
            workflow_versions: { state: 'active', workflows: { name: 'Standard Collections' } },
          }]
          : [],
      }
    },
  ],
]

let browser
const server = startServer()
try {
  browser = await chromium.launch()

  /* ---------- the door ---------- */

  /*
   * A TEAM LEADER READS EVERY WORD AND CHANGES NONE.
   *
   * The silent half is the one worth a browser: hiding a control is not a permission, RLS is —
   * and a reader offered an Edit button would fill in a form, press Save, and be told nothing,
   * because the database refuses the write after the app has already taken the typing.
   */
  {
    const leader = PROFILE
    const { page, context } = await signedInPage(browser, leader, handlersFor(leader), seen)
    let up = false
    for (let i = 0; i < 60; i += 1) {
      try { await page.goto(`http://localhost:${PORT}/library`, { timeout: 2000 }); up = true; break }
      catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    t.ok('the dev server answers', up)
    await page.getByText('First contact', { exact: true }).first().waitFor({ timeout: 20000 })
    t.ok('a team leader reads the library', true)
    /* The whole library, not a subset: the scope switch and both sides still work for them. */
    t.ok('...including the letters',
      await page.getByText('Section 129 notice', { exact: true }).first().isVisible())
    await page.getByText('Handover notice', { exact: true }).first().click()
    await page.waitForTimeout(600)
    t.ok('...and the words themselves',
      (await page.locator('pre').first().innerText()).includes('{{balance}}'))
    /* The finding the page exists for reaches them too. A reader who cannot see that a template
       is broken cannot report it, and they are the ones who meet it on a live account. */
    t.ok('...and is told when one asks for a field nothing can fill',
      await page.getByText(/fields? with nothing behind/).first().isVisible())

    /* ---------- and changes nothing ---------- */
    t.check('no Edit is offered', await page.getByRole('button', { name: 'Edit' }).count(), 0)
    t.check('...no New template', await page.getByRole('button', { name: 'New template' }).count(), 0)
    t.check('...no Delete',
      await page.getByRole('button', { name: 'Delete', exact: true }).count(), 0)
    /* Said once at the top rather than guessed at from four absences. */
    t.ok('...and the rule is stated rather than left to be inferred',
      await page.getByText(/An administrator writes these/).first().isVisible())
    /*
     * NOTHING LEFT THE BROWSER, taken over the whole visit rather than by looking at buttons: a
     * write fired on load would not be caught by counting controls. Read off `seen`, which the
     * harness fills for EVERY request, so a write to a table this file never stubbed still shows
     * up. RPCs are excluded because nav_counts is a POST and reads nothing but counts.
     */
    const wrote = seen.filter((r) =>
      /^(POST|PATCH|PUT|DELETE) \/rest\/v1\//.test(r) && !r.includes('/rest/v1/rpc/'))
    t.check(`...and nothing was written (${wrote.slice(0, 2).join('; ') || 'nothing'})`,
      wrote.length, 0)

    /* AND THE SIDEBAR OFFERS IT, which is the half that changed: a library everyone may read is
       a library everyone must be able to find. The workflows half of the same rule is checked in
       e2e/workflow-builder.mjs, which already holds a whole workflow to read. */
    t.ok('the sidebar offers the library to them',
      await page.getByRole('link', { name: /^Library/ }).first().isVisible())
    await t.shot(page, '59-library-read-only')
    await context.close()
  }

  /* ---------- an administrator ---------- */

  const { page } = await signedInPage(browser, ADMIN, handlersFor(ADMIN), seen)
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(`http://localhost:${PORT}/library`)
  /* `.first()`: the page's own heading and the top bar's now both say Library, which is right —
     the bar names where you are and the card names what it holds. */
  await page.getByRole('heading', { name: 'Library', exact: true }).first().waitFor({ timeout: 20000 })
  t.ok('an administrator is offered it in the sidebar',
    await page.getByRole('link', { name: /^Library/ }).first().isVisible())
  await page.getByText('First contact').first().waitFor({ timeout: 20000 })

  const headings = async () => (await page.locator('h3').allInnerTexts()).map((h) => h.trim())
  /* The left column's group headings, which are what the kinds are. */
  const kinds = async () => (await headings()).filter((h) => /TEMPLATES|SCRIPTS|LETTERS/i.test(h))

  /*
   * LETTERS ARE A COLLECTIONS THING. A statutory notice goes by registered post because the Act
   * says so; nothing on the sales side is posted. An empty "Letters" heading sitting on the sales
   * library for ever is the furniture problem.
   */
  t.ok(`collections has letters (${(await kinds()).join(' | ')})`,
    (await kinds()).some((h) => /LETTERS/i.test(h)))
  t.ok('...and the section shows the one there is',
    await page.getByText('Section 129 notice', { exact: true }).first().isVisible())

  /*
   * THE ORDER THE FIRM READS THEM IN: "SMS templates, email templates, letters, and then call
   * scripts." Cheapest and first contact through to the most involved, which is the order an
   * account escalates in — and the letter sits beside the email because the email is what posts
   * it.
   *
   * PRESENCE BEFORE ORDER. indexOf returns -1 for something that is not there, so an order-only
   * assertion goes green the day a heading disappears: -1 < everything.
   */
  {
    const on = await kinds()
    const want = ['SMS TEMPLATES', 'EMAIL TEMPLATES', 'LETTERS', 'CALL SCRIPTS']
    t.ok(`all four sections are on screen (${on.join(' | ')})`,
      want.every((w) => on.includes(w)))
    /* Joined, not compared as arrays: this runner's check is Object.is, under which two equal
       arrays are never equal — a difference that reads on screen as "expected X, got X". */
    t.check('...in the firm\'s order',
      on.filter((h) => want.includes(h)).join(' > '), want.join(' > '))
  }

  /* ---------- the letter an email posts with ---------- */

  /*
   * THE PAIR THE FIRM POINTED AT. The covering email's own words say "attached is a notice issued
   * in terms of section 129(1)(a)". If nothing is attached, that is a defective statutory demand
   * that reads as a correct one — so which emails carry a letter has to be visible on the LIST,
   * at the firm's instruction, and not only once the message is open.
   */
  const carrier = page.getByText('Section 129 covering email', { exact: true }).first()
  t.ok('an email that posts a letter is marked on the list itself',
    await carrier.locator('xpath=ancestor::button[1]').locator('[data-attaches]').isVisible())
  /* And one that posts nothing is not, or the marker says nothing at all. */
  t.check('...and one that posts nothing is not marked',
    await page.getByText('Handover notice', { exact: true }).first()
      .locator('xpath=ancestor::button[1]').locator('[data-attaches]').count(), 0)

  await carrier.click()
  await page.waitForTimeout(500)
  t.ok('...and opening it says there is an attachment',
    await page.getByText('Attached', { exact: true }).first().isVisible())
  /* Scoped to the band, not to the page: the LEFT COLUMN also holds a button called "Section
     129 notice", and a page-wide lookup finds that one first — which reads as a working
     attachment and is actually the list row. */
  const clip = page.locator('[data-attachment-open]').first()
  t.check('...naming which letter it is',
    (await clip.innerText()).replace(/\s+/g, ' ').trim(), 'Section 129 notice (retired)')

  /*
   * PRESSING IT OPENS THE LETTER, AND IT CLOSES AGAIN — the firm's own words. Read OVER the email
   * rather than instead of it: the question is whether the two go together, and losing your place
   * in the email to answer it is a poor trade.
   */
  t.check('the letter is not showing until it is asked for',
    await page.getByText(/NOTICE IN TERMS OF SECTION 129/).count(), 0)
  await clip.click()
  await page.waitForTimeout(600)
  t.ok('pressing the attachment opens the letter',
    await page.getByText(/NOTICE IN TERMS OF SECTION 129/).first().isVisible())
  t.ok('...over the email, which is still there underneath',
    await page.getByText(/Attached to Section 129 covering email/).first().isVisible())
  await t.shot(page, '64-library-attachment')
  await page.getByRole('button', { name: 'Close' }).click()
  await page.waitForTimeout(500)
  t.check('...and it closes again',
    await page.getByText(/NOTICE IN TERMS OF SECTION 129/).count(), 0)
  t.ok('...leaving the email where it was',
    await page.getByText(/Attached is a notice issued in terms/).first().isVisible())

  /*
   * THE FINDING THE PAGE EXISTS FOR. The handover email asks for two fields nothing can fill, and
   * the row has to say so before anybody signs it off.
   */
  await page.getByText('Handover notice').first().click()
  await page.waitForTimeout(500)
  const flag = page.getByText(/fields? with nothing behind/).first()
  t.ok('a template nothing can fill is flagged when it is opened', await flag.isVisible())
  t.check('...naming how many', (await flag.innerText()).replace(/\s+/g, ' ').trim(),
    '2 fields with nothing behind them')
  t.ok('...and says what it means in words',
    await page.getByText(/the message goes out with the braces still in it/).first().isVisible())

  /*
   * TWO VIEWS OF ONE THING, which the firm asked for by pointing at them: the fields in braces
   * are what you edit, the same words filled in are what the debtor reads.
   */
  t.ok('the words show their fields', (await page.locator('pre').first().innerText()).includes('{{balance}}'))
  await page.getByRole('button', { name: 'Example data' }).click()
  await page.waitForTimeout(300)
  const filled = await page.locator('pre').first().innerText()
  t.ok(`...and fill in against the sample (${filled.slice(0, 40).replace(/\n/g, ' ')})`,
    !filled.includes('{{balance}}') && filled.includes('R 48,250.00'))
  /* The unfillable one stays in braces even here, which is the honest rendering: that IS what
     the debtor would receive. */
  t.ok('...except the one nothing can fill, which is the point',
    filled.includes('{{bank_account_number}}'))
  await t.shot(page, '60-library-collections')

  /* ---------- the other side is a different library, not a filter ---------- */

  await page.getByRole('button', { name: 'Sales', exact: true }).click()
  await page.waitForTimeout(700)
  t.ok('switching side brings its own wording',
    await page.getByText('Quotation follow-up').first().isVisible())
  t.check('...and leaves the collections wording behind',
    await page.getByText('First contact').count(), 0)
  /* The kinds themselves change, which is the part a filter could not do. */
  t.check('...and offers no letters, because the sales side posts nothing',
    (await headings()).filter((h) => /LETTERS/i.test(h)).length, 0)
  await t.shot(page, '61-library-sales')

  /* ---------- a letter is a page, not a paragraph ---------- */

  /*
   * THE FAULT THIS GUARDS. A letter is stored as a letterDocument JSON in the same body column an
   * SMS uses plain text in. If the pane does not notice, the firm's section 129 opens as four
   * thousand characters of JSON — which is not subtle, but the version of it that IS subtle is a
   * table or a bullet quietly rendering as its raw text while everything around it looks fine.
   */
  /* Back to the collections side: the block above left the sales library showing, and letters
     live only on this one. */
  await page.getByRole('button', { name: 'Collections', exact: true }).click()
  await page.waitForTimeout(700)
  await page.getByText('Section 129 notice', { exact: true }).first().click()
  await page.waitForTimeout(700)
  t.check('a letter never shows the JSON it is stored as',
    await page.getByText(/"kind":"heading"/).count(), 0)
  t.ok('...it is drawn as the page it prints on',
    await page.locator('.ltr-page').first().isVisible())
  /* Real millimetres. A page laid out in pixels is a page that is right on one screen. */
  {
    const box = await page.locator('.ltr-page').first().boundingBox()
    const ratio = box ? box.height / box.width : 0
    t.ok(`...at A4 proportions (${box ? Math.round(box.width) : 0}x${box ? Math.round(box.height) : 0}px)`,
      Math.abs(ratio - 297 / 210) < 0.02)
  }
  /*
   * AND THE SECTIONS NUMBER THEMSELVES. The fixture types no digits at all, so a "1" and a "2" on
   * screen can only have been counted — which is the thing that stops a section inserted in the
   * middle leaving three headings with the wrong numbers on them.
   */
  /* "1." rather than "1", at the firm's request: the full stop is what makes it read as
     numbering rather than as a digit that wandered in beside a heading. */
  t.check('the sections number themselves, with a full stop',
    (await page.locator('.ltr-page .ltr-n').allInnerTexts()).map((x) => x.trim()).join(' '), '1. 2.')
  t.ok('the table is a real table', await page.locator('.ltr-page table td').first().isVisible())
  t.ok('...and the bullet a real bullet', await page.locator('.ltr-page ul li').first().isVisible())
  /* The running header is the printer's line, and {{page}} is filled by the renderer rather than
     from the account — nothing but a printer knows it. */
  /* At the FOOT now, at the firm's instruction -- it competed with the logo at the top. */
  t.ok('the running line counts the pages',
    await page.getByText(/Page 1 of 2/).first().isVisible())
  /* Merge fields still toggle, exactly as they do for the wording of an SMS. */
  t.ok('a letter shows its fields', (await page.locator('.ltr-page').first().innerText()).includes('{{balance}}'))
  await page.getByRole('button', { name: 'Example data' }).click()
  await page.waitForTimeout(400)
  t.ok('...and fills them in against the sample',
    (await page.locator('.ltr-page').first().innerText()).includes('R 48,250.00'))
  await t.shot(page, '65-library-letter')

  /* ---------- and it is edited on the page itself ---------- */

  /*
   * THE FIRM ASKED FOR THIS IN SO MANY WORDS: "can't it be just like one page which you
   * immediately see how it would look like... and then you don't even have a preview." So the
   * shape of the screen is itself the requirement, and is asserted as one: ONE editable surface,
   * and it is the sheet -- not a stack of boxes with a picture of the page beside it.
   */
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.waitForTimeout(700)
  t.check('a letter is not edited in a textarea',
    await page.locator('textarea').count(), 0)
  t.check('...nor in a stack of boxes: there is one thing to type in',
    await page.locator('[contenteditable="true"]').count(), 1)
  t.ok('...and the thing you type in IS the sheet it prints on',
    await page.locator('.ltr-page [contenteditable="true"].ltr-body').first().isVisible())
  /* And no second page beside it. A preview would be the old shape wearing the new one's clothes. */
  t.check('...with no separate preview beside it',
    await page.locator('.ltr-page').count(), 1)
  {
    const box = await page.locator('.ltr-page').first().boundingBox()
    const ratio = box ? box.height / box.width : 0
    t.ok(`...still at A4 proportions while being typed on (${box ? Math.round(box.width) : 0}px wide)`,
      Math.abs(ratio - 297 / 210) < 0.02)
  }
  t.ok('...with a bold button', await page.getByRole('button', { name: 'Bold', exact: true }).first().isVisible())
  t.ok('...a way to add a table',
    await page.getByRole('button', { name: 'Insert a table' }).first().isVisible())
  t.ok('...and the page’s own typography',
    await page.getByRole('combobox', { name: 'Line spacing' }).first().isVisible())

  const sheet = page.locator('.ltr-page [contenteditable="true"]').first()

  /*
   * BOLD IS REFUSED INSIDE A HEADING, and the reason is worth the assertion. letterCss draws
   * headings at font-weight 700, so a browser reports the selection as already bold and
   * execCommand('bold') can only take it OFF -- emitting font-weight:normal, which the model has
   * no room for and the parse drops. The page would then show a word gone light that prints bold.
   */
  await sheet.click()
  await sheet.evaluate((el) => {
    const h = el.querySelector('h1, h2, h3')
    if (!h) throw new Error(`no heading on the sheet: ${el.innerHTML.slice(0, 200)}`)
    const r = document.createRange()
    r.selectNodeContents(h)
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r)
  })
  await page.waitForTimeout(250)
  t.check('bold is refused inside a heading, which is already bold',
    await page.getByRole('button', { name: 'Bold', exact: true }).first().isDisabled(), true)

  /*
   * THE ROUND TRIP, IN A REAL BROWSER. editableHtmlToSpans and documentHtmlToBlocks are both
   * checked to the character beside this folder; what a browser cannot be told is whether typing
   * on the sheet and pressing Bold on a selection actually reaches the stored document.
   *
   * ON THE PARAGRAPH, not the heading -- see above; the heading cannot take a bold and the button
   * is disabled there on purpose.
   */
  await sheet.evaluate((el) => {
    const p = el.querySelector('p')
    if (!p) throw new Error(`no paragraph on the sheet: ${el.innerHTML.slice(0, 200)}`)
    const r = document.createRange()
    r.selectNodeContents(p)
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r)
  })
  await page.keyboard.type('Read this carefully')
  await page.waitForTimeout(300)
  /*
   * THE LAST NINE CHARACTERS ONLY. Bolding the whole paragraph would make the assertion below
   * pass on an implementation that ignores the selection entirely and bolds everything -- which
   * is exactly the bug worth catching, because the writer would see one word bold and the debtor
   * a whole paragraph.
   */
  await sheet.evaluate((el) => {
    const p = el.querySelector('p')
    const node = [...p.childNodes].find((n) => n.nodeType === 3 && n.textContent.length >= 9)
      ?? p.firstChild
    if (!node) throw new Error(`nothing to select in: ${p.innerHTML}`)
    const r = document.createRange()
    r.setStart(node, node.textContent.length - 9)
    r.setEnd(node, node.textContent.length)
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r)
  })
  await page.getByRole('button', { name: 'Bold', exact: true }).first().click()
  await page.waitForTimeout(400)

  /*
   * AND A MERGE FIELD, PRESSED RATHER THAN TYPED. The buttons live outside the editor, beside the
   * other kinds of template, and before the page editor lent them a caret they pressed and
   * nothing happened -- on the one kind of template with the most fields in it.
   */
  /*
   * AT THE START OF THE PARAGRAPH, chosen rather than convenient. The caret has to be put
   * somewhere first, because the bold above left the word SELECTED and a field dropped on a
   * selection replaces it. The START is the useful place to put it: it proves the field lands AT
   * THE CARET rather than being appended to the end, which is the whole reason the buttons were
   * wired through to the page, and it keeps the field clear of the bold run so the split below
   * still says which words carry the mark. (Put at the END it would come back bold, because the
   * caret is inside the bold run -- correct, and a weaker thing to assert.)
   */
  await sheet.locator('p').first().click()
  await page.keyboard.press('Home')
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: '{{reference}}', exact: true }).first().click()
  await page.waitForTimeout(400)
  t.ok('a merge field pressed outside the page lands inside it',
    (await sheet.innerText()).includes('{{reference}}'))

  const beforeLetter = written.length
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForTimeout(1000)
  const sentLetter = written[written.length - 1]
  t.ok(`the letter reached the database (${written.length - beforeLetter} write)`,
    written.length > beforeLetter)
  t.check('...still as a document', /"format":"document"/.test(sentLetter?.body ?? ''), true)

  /*
   * READ BACK AS THE DOCUMENT IT IS, rather than pattern-matched against the escaped JSON of a
   * PATCH. The first version of this was a regex over the wire format and it was unreadable and
   * wrong; parsing says exactly what the letter now contains.
   */
  const savedDoc = (() => {
    try { return JSON.parse(JSON.parse(sentLetter?.body ?? '{}').body ?? 'null') }
    catch { return null }
  })()
  const savedBlocks = savedDoc?.blocks ?? []
  /*
   * THE WHOLE LETTER CAME BACK, and this is the failure the single sheet introduces that the old
   * stack of boxes could not have: the page is parsed as ONE piece of HTML, so a parse that gives
   * up at the first thing it does not recognise silently drops everything below the caret. The
   * writer edits one paragraph and saves a letter missing its table.
   */
  t.check(`...with every part of the letter still on it (${savedBlocks.map((b) => b.kind).join(',')})`,
    savedBlocks.map((b) => b.kind).join(','),
    'heading,paragraph,heading,table,heading,list')
  t.ok('...the first block still a heading, untouched',
    savedBlocks[0]?.kind === 'heading'
    && (savedBlocks[0]?.spans ?? []).map((x) => x.text).join('') === 'NOTICE IN TERMS OF SECTION 129(1)(a)')
  /* The numbering is counted, not stored -- so it must NOT have come back as typed-in digits. */
  t.check('...and the numbered sections still number themselves',
    savedBlocks.filter((b) => b.kind === 'heading' && b.numbered).length, 2)
  t.ok('...the table still a table with its two columns',
    savedBlocks[3]?.kind === 'table' && (savedBlocks[3]?.rows ?? []).every((r) => r.length === 2))

  const spans = savedBlocks[1]?.spans ?? []
  t.check('...carrying the words that were typed',
    spans.map((x) => x.text).join(''), '{{reference}}Read this carefully')
  /*
   * THE HALF THAT MATTERS: the mark is on PART of it. A document where the whole paragraph came
   * back bold, or none of it did, passes a looser check and is a letter the writer saw one way
   * and the debtor another.
   */
  t.check(`...with the selected words bold and the rest not (${JSON.stringify(spans)})`,
    spans.map((x) => `${x.text}${x.bold ? '*' : ''}`).join('|'),
    '{{reference}}Read this |carefully*')

  /* ---------- editing, and the merge field you press ---------- */

  await page.getByRole('button', { name: 'Collections', exact: true }).click()
  await page.waitForTimeout(600)
  await page.getByText('First contact').first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.waitForTimeout(400)

  const words = page.locator('textarea').first()
  t.ok('a template can be edited in the app', await words.isVisible())

  /*
   * THE MERGE FIELD IS A BUTTON, AND IT LANDS AT THE CURSOR. The firm: "you should be able to
   * add, for example, a merge field... you can type the merge field or you can add the merge
   * field." Appending to the end would leave somebody cutting and pasting it into the sentence it
   * belongs in, which is the work the button was meant to save.
   */
  /*
   * THE CARET IS PUT IN THE MIDDLE ON PURPOSE. The first version of this typed "Dear " and
   * inserted with the caret already at the end — where inserting at the cursor and appending to
   * the end produce the same string, so the check passed over an implementation that appends.
   * Found by writing that implementation and watching this stay green.
   */
  await words.fill('Dear , please settle.')
  await words.evaluate((el) => { el.focus(); el.setSelectionRange(5, 5) })
  await page.getByRole('button', { name: '{{debtor_name}}' }).click()
  await page.waitForTimeout(300)
  t.check('pressing a field drops it in at the cursor, not at the end',
    await words.inputValue(), 'Dear {{debtor_name}}, please settle.')
  /* And the caret followed the text it just wrote, so the next one lands beside it. */
  await page.getByRole('button', { name: '{{balance}}' }).click()
  await page.waitForTimeout(300)
  t.check('...and the caret moved with it, so the next lands beside the first',
    await words.inputValue(), 'Dear {{debtor_name}}{{balance}}, please settle.')

  /*
   * AND A FIELD THAT DOES NOT EXIST IS CAUGHT HERE, not on the way out to four hundred debtors.
   * renderTemplate leaves the placeholder standing, so this is the only moment it can be caught.
   */
  await words.fill('Dear {{ballance}}')
  await page.waitForTimeout(300)
  t.ok('a typed field that is not a field is refused',
    await page.getByText(/is not a field on this side/).first().isVisible())
  t.ok('...and Save is not available while it stands',
    await page.getByRole('button', { name: 'Save' }).isDisabled())

  /* ---------- a save reaches the database ---------- */

  await words.fill('Dear {{debtor_name}}, account {{reference}} is overdue.')
  await page.waitForTimeout(300)
  const before = written.length
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForTimeout(900)
  t.ok(`the save left the browser (${written.length - before} write)`, written.length > before)
  const sent = written[written.length - 1]
  t.check('...as an update, not a new row', sent?.method, 'PATCH')
  t.ok(`...carrying the words that were typed (${(sent?.body ?? '').slice(0, 60)})`,
    (sent?.body ?? '').includes('account {{reference}} is overdue'))

  /* ---------- a new one ---------- */

  await page.getByRole('button', { name: 'New template' }).click()
  await page.waitForTimeout(400)
  t.ok('a new template opens empty', (await page.locator('textarea').first().inputValue()) === '')
  t.ok('...and cannot be saved with no name and no words',
    await page.getByRole('button', { name: 'Save' }).isDisabled())
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.waitForTimeout(300)

  /* ---------- choosing the letter an email posts ---------- */

  /*
   * THE PICKER OFFERS LETTERS AND ONLY LETTERS. check_template_attachment refuses a non-letter,
   * a cross-scope attachment and an email attached to itself — a dropdown offering what the save
   * will refuse teaches people the app is broken.
   */
  await page.getByText('Section 129 covering email', { exact: true }).first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.waitForTimeout(500)
  const picker = page.locator('select').filter({ hasText: 'Nothing attached' }).first()
  t.ok('an email is asked what it posts with', await picker.isVisible())
  t.check('...opening on the letter it already carries',
    await picker.locator('option:checked').innerText(), 'Section 129 notice (retired)')
  const offered = (await picker.locator('option').allInnerTexts()).map((o) => o.trim())
  t.check('...and offering the letters, and nothing else',
    offered.join(' | '), 'Nothing attached | Section 129 notice (retired)')

  /* Changed to nothing, and the change has to reach the database as a null rather than be
     dropped by the mapper — which is the silent failure CLAUDE.md warns about by name. */
  const beforeClear = written.length
  await picker.selectOption('')
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForTimeout(900)
  const cleared = written[written.length - 1]
  t.ok(`clearing it reaches the database (${(cleared?.body ?? '').slice(0, 70)})`,
    written.length > beforeClear && /"attachment_id":null/.test(cleared?.body ?? ''))

  /*
   * AND A KIND THAT CANNOT CARRY ONE IS NOT ASKED. message_templates_attachment_kind allows an
   * attachment on an email and on nothing else.
   */
  await page.getByText('First contact', { exact: true }).first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.waitForTimeout(500)
  t.check('an SMS is not asked what it posts with',
    await page.locator('select').filter({ hasText: 'Nothing attached' }).count(), 0)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.waitForTimeout(300)

  /* ---------- the sidebar folds, and comes back ---------- */

  /*
   * THE FIRM ASKED FOR IT WHILE WORKING HERE: "if that thing can collapse that sidebar it could
   * be easier to work on this." Measured in pixels, because the claim is about how much room the
   * page gets and a class-name assertion would pass over a fold that moved nothing.
   */
  const rail = page.locator('aside.app-sidebar')
  const wide = (await rail.boundingBox())?.width ?? 0
  await page.getByRole('button', { name: 'Narrow the menu' }).click()
  await page.waitForTimeout(600)
  const narrow = (await rail.boundingBox())?.width ?? 0
  t.ok(`the sidebar folds to a rail (${Math.round(wide)}px to ${Math.round(narrow)}px)`,
    narrow > 0 && narrow < wide / 2)
  /* Folded, not gone: every page must still be one click away. */
  t.ok('...and the nav is still reachable',
    await page.getByRole('link', { name: /^Library/ }).first().isVisible())
  t.check('...with the labels gone', await page.getByText('Disputes', { exact: true }).count(), 0)

  /*
   * AND IT COMES BACK, which is the half a one-way fold would fail. Reloaded in between, because
   * a preference that resets on the next page load is not a preference.
   */
  await page.reload()
  await page.waitForTimeout(1200)
  t.ok(`it is still folded after a reload (${Math.round((await rail.boundingBox())?.width ?? 0)}px)`,
    ((await rail.boundingBox())?.width ?? 0) < wide / 2)
  await t.shot(page, '62-library-collapsed')
  await page.getByRole('button', { name: 'Widen the menu' }).click()
  await page.waitForTimeout(600)
  t.check(`...and comes back to its full width`,
    Math.round((await rail.boundingBox())?.width ?? 0), Math.round(wide))

  /* ---------- deleting one ---------- */

  /*
   * REFUSED WHERE A PUBLISHED WORKFLOW SENDS IT. workflow_nodes.template_id is `on delete set
   * null`, so the delete would succeed and the step would survive saying "send an email" with
   * nothing to send. Nobody would find out until the day it ran.
   */
  await page.getByText('Handover notice').first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.waitForTimeout(400)
  /* `exact`, because the letter editor's per-block bin is called "Delete this block" and
     getByRole matches a name by substring unless told otherwise. */
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.waitForTimeout(900)
  t.ok('deleting asks first', await page.getByText('Delete this template?').first().isVisible())
  t.ok('...and refuses one a published workflow sends',
    await page.getByText(/published or archived workflow step/).first().isVisible())
  t.ok('...naming the workflow to go and look at',
    await page.getByText(/Standard Collections/).first().isVisible())
  t.ok('...and offering to retire it instead',
    await page.getByText(/Retire it instead/).first().isVisible())
  /*
   * A confirm that refuses and still offers the button is not a refusal.
   *
   * WHAT THIS DOES AND DOES NOT COVER. reallyDelete carries its own guard as well, and that one
   * is unreachable from here by design — with the button absent there is nothing to click. Both
   * were broken together and this line fires, so the pair holds; the second is defence in depth
   * against a future caller, not something a browser can exercise on its own.
   */
  t.check('...with no way to go ahead anyway',
    await page.getByRole('button', { name: 'Delete permanently' }).count(), 0)
  const refusedAt = written.filter((w) => w.method === 'DELETE').length
  await page.getByRole('button', { name: 'Close' }).click()
  await page.waitForTimeout(400)
  t.check('...and nothing was deleted',
    written.filter((w) => w.method === 'DELETE').length, refusedAt)
  await t.shot(page, '63-library-delete-refused')

  /* ---------- throwing away a letter something posts ---------- */

  /*
   * WARNED, NOT REFUSED. message_templates.attachment_id is `on delete set null`, the same silent
   * shape as the workflow step: deleting the notice leaves the covering email intact, still
   * saying "attached is a notice issued in terms of section 129(1)(a)", with nothing attached.
   * Replacing a letter with a better one is ordinary work; nobody being told is not.
   */
  await page.getByText('Section 129 notice', { exact: true }).first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.waitForTimeout(900)
  t.ok('deleting a letter says which email would be left attaching nothing',
    await page.getByText(/would be left attaching nothing/).first().isVisible())
  t.ok('...naming it',
    await page.getByText(/Section 129 covering email attaches this letter/).first().isVisible())
  t.ok('...and still lets it happen, because it is a warning and not a refusal',
    await page.getByRole('button', { name: 'Delete permanently' }).isVisible())
  const heldAt = written.filter((w) => w.method === 'DELETE').length
  await page.getByRole('button', { name: 'Keep it' }).click()
  await page.waitForTimeout(400)
  t.check('...and keeping it deletes nothing',
    written.filter((w) => w.method === 'DELETE').length, heldAt)

  /* ---------- and allowed where nothing depends on it ---------- */

  await page.getByText('First contact').first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.waitForTimeout(900)
  t.check('a template nothing uses is not refused',
    await page.getByText(/published or archived workflow step/).count(), 0)
  /* Offered every time, not only when delete is refused: retiring takes it out of use just as
     completely and keeps the words. */
  t.ok('...but retiring is still offered as the safer answer',
    await page.getByText(/keeps the wording for the day somebody asks/).first().isVisible())
  t.ok('...and a seeded one says it would come back on a replay',
    await page.getByText(/sms-first-contact/).first().isVisible())

  const beforeDelete = written.filter((w) => w.method === 'DELETE').length
  await page.getByRole('button', { name: 'Delete permanently' }).click()
  await page.waitForTimeout(1000)
  const deletes = written.filter((w) => w.method === 'DELETE')
  t.ok(`the delete reached the database (${deletes.length - beforeDelete} sent)`,
    deletes.length > beforeDelete)
  t.ok(`...naming the one that was asked for (${(deletes[deletes.length - 1]?.url ?? '').slice(-50)})`,
    (deletes[deletes.length - 1]?.url ?? '').includes(LIBRARY[0].id))

  const real = errors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e))
  t.check('no console errors', real.length, 0)
  if (real.length) console.log('  console:', real.slice(0, 5))
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).split('\n').slice(0, 6).join(' | ').slice(0, 400)})`, false)
  try {
    const pages = browser ? browser.contexts().flatMap((c) => c.pages()) : []
    if (pages[0]) await t.shot(pages[0], '69-where-it-stopped')
  } catch { /* nothing more to learn */ }
  console.log('\n--- what the app asked Supabase for ---')
  console.log(seen.slice(-14).join('\n') || '(nothing)')
} finally {
  if (browser) await browser.close()
  stopServer(server)
}

const good = t.finish(`The library opens to an administrator and to nobody else, carries letters on
the collections side and not on the sales side, and says on the row itself when a template asks for
a field nothing can fill. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)
