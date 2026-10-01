/**
 * A REASSIGNMENT BOX MUST NOT SHOW ONE NAME AND HOLD ANOTHER.
 *
 * THE FIRM: "I added this to Nicole Loader, but it chose Samuel Ndaba as the liaison."
 *
 * The database had it right. What was wrong was the screen, and the fault needed a real browser to
 * see — which is why this lives here rather than beside the rule checks.
 *
 * WHAT WAS HAPPENING. "Reassign Account Owner" built its list from `isAssignableOwner` —
 * Administrator, Sales, Liaison — which is the answer to "who may be given a LEAD or a DEAL", a
 * different question. A Pre-legal Agent is not in that list. So on a client owned by one, the
 * `select` had NO OPTION matching its value, and a browser falls back to showing the first option.
 * Measured, before the fix, on the firm's own client:
 *
 *     panel shows        : "Samuel Ndaba"      <- the truth
 *     select HOLDS value : Stephan's id        <- what Save would write
 *     select SHOWS text  : "Stephan"
 *     options offered    : [ 'Stephan', 'Nicole Loder' ]
 *
 * Three different answers to one question on one screen, and the real owner offered nowhere. Press
 * Save on what looks like a confirmation and the client changes hands to somebody nobody chose.
 *
 * NO RULE CHECK COULD HAVE CAUGHT IT. The source reads correctly: `useState(currentOwnerId)`, and
 * a `value` bound to it. The lie is produced by the DOM when the value matches no option, and only
 * a rendered page can be asked what it is actually showing.
 *
 * Run: node scripts/qa/e2e/client-liaison.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE, COMPANY_ID } from './fixtures.mjs'

const t = makeRunner('client-liaison')

const ADMIN = { ...PROFILE, role: 'Administrator', name: 'Stephan' }
/* The three roles that matter here: the one who may not be a liaison and IS one on record, the one
   who may, and an administrator who may not be either. */
const SAMUEL = { ...PROFILE, id: 'u-samuel', name: 'Samuel Ndaba', email: 's@x.co.za', role: 'Pre-legal Agent' }
const NICOLE = { ...PROFILE, id: 'u-nicole', name: 'Nicole Loder', email: 'n@x.co.za', role: 'Liaison' }
const VUSI = { ...PROFILE, id: 'u-vusi', name: 'Vusi Maringa', email: 'v@x.co.za', role: 'Pre-legal Team Leader' }

/** The firm's own client, as it stood: owned by a Pre-legal Agent. */
const COMPANY = {
  id: COMPANY_ID, name: 'Rinda Roo Company', account_owner_id: 'u-samuel',
  created_at: '2026-10-01T07:27:05Z', commission_rate: 0.3, industry: 'Kangaroo',
}

async function openDetail(browser, company) {
  const { context, page } = await signedInPage(browser, ADMIN, [
    [(u) => /\/rest\/v1\/profiles.*id=eq\./.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN, SAMUEL, NICOLE, VUSI] })],
    [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [company] })],
  ], [])
  await page.setViewportSize({ width: 1180, height: 900 })
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/companies/${COMPANY_ID}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.waitForTimeout(2500)
  return { context, page }
}

/** What the Company Information panel says the owner is. */
const panelOwner = (page) => page.evaluate(() => {
  const dt = Array.from(document.querySelectorAll('dt')).find((d) => d.textContent.trim() === 'Account Owner')
  return dt ? dt.nextElementSibling.innerText.trim() : '(not found)'
})

/** The select's value, the text it is actually displaying, and everything it offers. */
const selectState = (page) => page.evaluate(() => {
  const s = document.querySelector('form select')
  if (!s) return null
  return {
    value: s.value,
    shown: s.selectedIndex >= 0 ? s.options[s.selectedIndex].text : '(nothing selected)',
    options: Array.from(s.options).map((o) => ({ text: o.text, value: o.value })),
  }
})

const server = await startServer()
const browser = await chromium.launch()
try {
  /* ---------- a client owned by somebody who may not be a liaison ---------- */
  {
    const { context, page } = await openDetail(browser, COMPANY)

    /* THE PANEL IS THE TRUTH and was never the problem. Asserted anyway, because it is what the
       other two are compared against — if this drifts, the comparison below means nothing. */
    /* The cell now carries a marker beside the name, so this reads the name out of it rather than
       comparing the whole cell -- the name is the assertion, the chip has its own below. */
    t.ok('the panel names the owner on record', /^Samuel Ndaba/.test(await panelOwner(page)))

    /* AND THE PANEL SAYS SO TOO, because three other routes create a client without ever asking
       who the liaison is and a warning only inside the Reassign box never reaches them. */
    t.ok('...and flags that they should not be', /not a liaison/i.test(await panelOwner(page)))

    await page.locator('dd button').first().click()
    await page.waitForTimeout(400)
    const sel = await selectState(page)
    t.ok('the reassign box opened', !!sel)

    /*
     * THE ASSERTION THIS FILE EXISTS FOR. Not "is the value right" and not "is the text right" --
     * the two TOGETHER. Either alone passed while the box was lying.
     */
    t.check('the box holds the owner on record', sel.value, 'u-samuel')
    t.ok('...and shows the person it is holding',
      sel.shown.startsWith('Samuel Ndaba'))
    t.ok('...rather than falling back to whoever is first',
      !sel.shown.startsWith('Stephan') && !sel.shown.startsWith('Nicole'))

    /* AND IT SAYS WHY THEY SHOULD NOT BE, rather than hiding it. Marked, not silently offered as
       an ordinary choice. */
    t.ok('...marked as not a liaison', /not a liaison/i.test(sel.shown))
    t.ok('...and the box explains what to do about it',
      /should be a Liaison/i.test(await page.locator('form').innerText()))

    /* ---------- and everybody else offered is a liaison ---------- */
    const others = sel.options.filter((o) => o.value !== 'u-samuel')
    t.check('the only other choice is the liaison', others.map((o) => o.text).join('|'), 'Nicole Loder')
    /* THE FOUR THE FIRM SAW ON THE OTHER SCREEN, by role rather than by name: an administrator, a
       pre-legal agent and a pre-legal team leader are not choices here. */
    const text = sel.options.map((o) => o.text).join(' | ')
    t.ok('...not an administrator', !/Stephan/.test(text))
    t.ok('...not a pre-legal team leader', !/Vusi/.test(text))
    await context.close()
  }

  /* ---------- the ordinary case, where the owner IS a liaison ---------- */
  {
    const { context, page } = await openDetail(browser, { ...COMPANY, account_owner_id: 'u-nicole' })
    t.ok('a liaison owner reads correctly on the panel', /^Nicole Loder/.test(await panelOwner(page)))
    /* NOTHING FLAGGED WHERE NOTHING IS WRONG. */
    t.ok('...with no warning beside it', !/not a liaison/i.test(await panelOwner(page)))
    await page.locator('dd button').first().click()
    await page.waitForTimeout(400)
    const sel = await selectState(page)
    t.check('...and the box holds them', sel.value, 'u-nicole')
    t.check('...and shows them', sel.shown, 'Nicole Loder')
    /* NO MARKED ENTRY WHERE THERE IS NOTHING WRONG. A warning that fires when nothing is wrong is
       worse than no warning: people stop reading it. */
    t.ok('...with nothing flagged', !/not a liaison/i.test(sel.options.map((o) => o.text).join(' ')))
    t.check('...and only liaisons offered', sel.options.map((o) => o.text).join('|'), 'Nicole Loder')
    await context.close()
  }
} finally {
  await browser.close()
  await stopServer(server)
}

const good = t.finish(
  'A reassignment box can no longer show one name while holding another. The owner on record is\n'
  + 'always an option, marked where their role is not eligible, and everybody else offered is a\n'
  + 'Liaison or a Liaison Manager — the same rule the Add a client form uses.',
)
process.exit(good ? 0 : 1)
