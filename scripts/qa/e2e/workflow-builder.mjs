/**
 * Library → Workflows, in a real browser.
 *
 * MOVED OUT OF SETTINGS at the firm's instruction — "if we are building a workflow, currently it
 * lives in the accounts section. I think it should live in the library section." It is not a
 * setting: a setting is configured once, and a workflow is content somebody writes, argues about
 * and publishes a version of. It now has a URL, so a draft can be linked to rather than described.
 *
 * WHY THE BROWSER AND NOT JUST THE RULES. The rules beside this folder are checked to the day;
 * none of that can tell you the drawer never opened, or that the form is disabled on a draft, or
 * that the branch cards the firm asked to remove are still being drawn. This screen exists to be
 * EDITED, and "can it be edited" is not a question source can answer.
 *
 * Run: node scripts/qa/e2e/workflow-builder.mjs
 */
import {
  OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer,
} from './harness.mjs'
import { LIBRARY, PROFILE } from './fixtures.mjs'

const t = makeRunner('workflow-builder')

/* ---------- the firm's workflow, as the database would hand it back ---------- */

const VERSION = 'v1111111-1111-4111-8111-111111111111'
const PHASES = [
  { id: 'p1', ordinal: 1, name: 'Phase 1 · Notice', subtitle: 'Initial notices and engagement', from_day: 0, to_day: 40 },
  { id: 'p2', ordinal: 2, name: 'Phase 2 · Legal', subtitle: 'Legal process and preparation', from_day: 40, to_day: 80 },
]
const n = (key, kind, label, day, phase, over = {}) => ({
  id: key, phase_id: phase, key, kind, label, description: `${label} description.`, day,
  deadline_days: null, deadline_unit: null, channel: null, template_id: null, statutory: false,
  assign_to: 'Current clerk', x: null, y: null, ordinal: 0, ...over,
})
const NODES = [
  n('handover-received', 'action', 'Handover Received', 0, 'p1', { ordinal: 1 }),
  n('demand-129', 'communication', 'Demand + Section 129', 1, 'p1', { ordinal: 2, channel: 'registered_post', statutory: true }),
  n('intention-to-list', 'communication', 'Intention to List', 10, 'p1', { ordinal: 3, channel: 'registered_post', statutory: true, deadline_days: 20, deadline_unit: 'business' }),
  n('follow-up-offer', 'communication', 'Follow-up + Offer', 21, 'p1', { ordinal: 4, channel: 'email' }),
  n('final-notice', 'communication', 'Final Notice', 35, 'p1', { ordinal: 5, channel: 'registered_post', statutory: true, deadline_days: 7, deadline_unit: 'calendar' }),
  n('rotate-clerk-2', 'assignment', 'Rotate to Clerk 2', 40, 'p1', { ordinal: 6, assign_to: 'Clerk 2' }),
  n('listing-confirmed', 'action', 'Listing Confirmed', 42, 'p2', { ordinal: 7 }),
  n('intended-legal-action', 'communication', 'Intended Legal Action', 50, 'p2', { ordinal: 8, channel: 'registered_post', statutory: true }),
  n('court-process-explained', 'communication', 'Court Process Explained', 60, 'p2', { ordinal: 9, channel: 'email' }),
  n('final-settlement-window', 'communication', 'Final Settlement Window', 70, 'p2', { ordinal: 10, channel: 'email' }),
  n('draft-summons', 'document', 'Draft Summons', 75, 'p2', { ordinal: 11, assign_to: 'Team leader' }),
  n('rotate-clerk-3', 'assignment', 'Rotate to Clerk 3', 80, 'p2', { ordinal: 12, assign_to: 'Clerk 3' }),
]
const CONNECTIONS = NODES.slice(0, -1).map((a, i) => ({
  id: `e${i}`, from_node_id: a.id, to_node_id: NODES[i + 1].id, to_workflow_id: null, label: null,
}))

const WORKFLOW = {
  id: 'w1', key: 'standard-collections', name: 'Standard Collections – Non-Paying Debtor',
  description: 'Main collection workflow for non-paying debtors. Day 0 to Day 80.',
  teams: { name: 'Pre-legal' },
  workflow_versions: [{ id: VERSION, version: 1, state: 'draft', published_at: null }],
}

/** Every PATCH the page sends, so the test can prove an edit actually left the browser. */
const patched = []

/**
 * The signed-in person, which this file did not need until now.
 *
 * Settings had no role check on its Workflows tab at all — the boundary was RLS and nothing else,
 * so a browser with no profile loaded still drew the builder. The library HAS one, so a run
 * without a profile now lands on "the library is not open to you" rather than on the canvas.
 * That is the boundary working; it just has to be stubbed.
 */
const asRole = (role) => [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: PROFILE.id, email: PROFILE.email } })],
  [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [{ ...PROFILE, role }] })],
]

const handlers = [
  [(u, r) => /\/rest\/v1\/workflow_nodes/.test(u) && r.method() === 'PATCH',
    (u, r) => { patched.push({ url: u, body: r.postData() }); return { body: [] } }],
  [(u) => /\/rest\/v1\/workflows\?/.test(u), () => ({ body: [WORKFLOW] })],
  [(u) => /\/rest\/v1\/workflow_phases/.test(u), () => ({ body: PHASES })],
  [(u) => /\/rest\/v1\/workflow_nodes/.test(u), () => ({ body: NODES })],
  [(u) => /\/rest\/v1\/workflow_connections/.test(u), () => ({ body: CONNECTIONS })],
  /* THE LIBRARY, which the builder now reads so a step can be told what to send. The stub honours
     the scope clause: answering both sides out of the whole fixture would put sales wording in a
     collections picker, which is exactly the bug the clause exists to prevent. */
  [(u) => /\/rest\/v1\/message_templates/.test(u), (u) => {
    const scope = /scope=eq\.(\w+)/.exec(u)?.[1]
    return { body: scope ? LIBRARY.filter((r) => r.scope === scope) : LIBRARY }
  }],
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const admin = { ...PROFILE, role: 'Administrator' }
  const { page } = await signedInPage(browser, admin, [...asRole('Administrator'), ...handlers], [])

  let up = false
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/library/workflows`, { timeout: 2000 }); up = true; break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the dev server answers', up)

  /* ---------- Library → Workflows ---------- */
  await page.getByText('Standard Collections – Non-Paying Debtor').waitFor({ timeout: 20000 })
  t.ok('the workflow is listed in the library', true)
  /* SETTINGS NO LONGER OFFERS IT. A tab left behind after a move is a second door onto the same
     room, and the one people keep using is whichever they found first. */
  await page.goto(`http://localhost:${PORT}/settings`)
  await page.getByRole('button', { name: 'Profile', exact: true }).waitFor({ timeout: 20000 })
  t.check('...and Settings no longer has a Workflows tab',
    await page.getByRole('button', { name: 'Workflows', exact: true }).count(), 0)
  await page.goto(`http://localhost:${PORT}/library/workflows`)
  await page.getByText('Standard Collections – Non-Paying Debtor').waitFor({ timeout: 20000 })
  /*
   * THE BADGE TELLS THE TRUTH. The firm's mockup shows "Active"; this version is a draft, and a
   * workflow labelled active that anybody can still edit would contradict the trigger underneath
   * it that freezes published versions. Saying "draft" is the honest half of that rule.
   */
  t.ok('...and says which state it is really in',
    await page.getByText('draft', { exact: false }).first().isVisible())

  await page.getByText('Standard Collections – Non-Paying Debtor').click()
  /* The phase name is also an option in the Add-step picker, so the BAR is named. */
  await page.locator('p', { hasText: /^Phase 1 · Notice$/ }).first().waitFor({ timeout: 10000 })
  /*
   * AND THE WORKFLOW IS IN THE ADDRESS. The whole reason this moved out of a settings tab: the
   * builder used to be reached by clicking twice, with nothing to send anybody. A draft being
   * argued about now has a link.
   */
  t.ok(`opening one puts it in the URL (${new URL(page.url()).pathname})`,
    new URL(page.url()).pathname === '/library/workflows/standard-collections')
  await t.shot(page, '10-builder')

  /* ---------- the canvas ---------- */
  /*
   * innerText reports what is RENDERED, and the day label is set in capitals by CSS — so every
   * match here is case-insensitive. Written case-sensitively first, it found no cards at all and
   * reported a canvas with twelve steps on it as empty.
   */
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .map((b) => b.innerText.replace(/\s+/g, ' ').trim())
      .filter((s) => /^day \d+/i.test(s)))
  t.check(`all twelve steps are drawn (${cards.length})`, cards.length, 12)
  t.ok('day 1 is the section 129', cards.some((c) => /^day 1 Demand \+ Section 129/i.test(c)))
  t.ok('...and it says it goes by registered post',
    cards.some((c) => /Demand \+ Section 129 Registered post/i.test(c)))
  t.ok('day 35 is the final notice with the debtor’s seven days',
    cards.some((c) => /day 35 Final Notice Registered post · 7 days to respond/i.test(c)))
  t.ok('...and day 10 counts its twenty in BUSINESS days',
    cards.some((c) => /day 10 Intention to List Registered post · 20 business days to respond/i.test(c)))
  t.ok('both phases are drawn',
    await page.locator('p', { hasText: /^Phase 2 · Legal$/ }).first().isVisible())
  t.ok('...with their day ranges', await page.getByText(/day 40 – 80/i).first().isVisible())

  /*
   * THE BRANCHES ARE NOT HERE, which is the firm's instruction and a design decision rather than
   * a tidy-up: hung underneath, they made the main line look like the exception. Asserted over the
   * CANVAS, not the page — "Related workflows" names them below it on purpose, as the place they
   * will be linked from.
   */
  const canvasText = await page.evaluate(() => {
    const bar = [...document.querySelectorAll('p')].find((p) => /phase 1 · notice/i.test(p.innerText))
    return bar.closest('section').parentElement.innerText
  })
  for (const gone of ['Payment Arrangement', 'Dispute', 'Sequestration', 'Liquidation', 'Validate', 'Collectable']) {
    t.ok(`the canvas does not draw ${gone}`, !new RegExp(gone, 'i').test(canvasText))
  }

  /* ---------- the drawer, and it is editable ---------- */
  await page.getByRole('button', { name: /day 35 Final Notice/i }).click()
  await page.getByText('Step details').waitFor({ timeout: 10000 })
  await t.shot(page, '20-drawer')

  const drawer = await page.evaluate(() => {
    /* The app's own sidebar is an <aside> too, and it comes first in the document — so picking
       "the aside" returned the navigation and reported an empty form on a filled one. */
    const aside = [...document.querySelectorAll('aside')]
      .find((a) => /step details/i.test(a.innerText))
    return {
      text: aside.innerText.replace(/\s+/g, ' '),
      legends: [...aside.querySelectorAll('legend')].map((l) => l.innerText.trim()),
      inputs: [...aside.querySelectorAll('input, select, textarea')].map((el) => ({
        tag: el.tagName, type: el.type, value: el.value, disabled: el.disabled,
      })),
    }
  })
  t.ok('the drawer names the step', /Final Notice/i.test(drawer.text))

  /*
   * ONE "WHEN", AND THE DEBTOR'S PERIOD SEPARATELY. The firm's mockup had three ways of saying
   * when on this form — an absolute workflow day, a "wait period after completion", and a next
   * step — and any two of them can disagree in silence. The seven days on that card were the
   * DEBTOR'S, wearing a scheduling label.
   */
  t.check(`the form groups time in two, not three (${drawer.legends.join(' / ')})`,
    drawer.legends.join(' / ').toLowerCase(), 'when / period given to the debtor')
  t.ok('there is no wait-period-after-completion', !/wait period/i.test(drawer.text))
  t.ok('the workflow day is editable and holds 35',
    drawer.inputs.some((i) => i.type === 'number' && i.value === '35' && !i.disabled))
  t.ok('the debtor’s seven days are their own field',
    drawer.inputs.some((i) => i.type === 'number' && i.value === '7' && !i.disabled))
  t.ok('...with the kind of day beside it',
    /calendar days/.test(drawer.text) && /business days/.test(drawer.text))
  t.ok('...and it says what a business day skips',
    /skip weekends and South African public holidays/i.test(drawer.text))
  t.ok('a statutory notice is marked as one', /Required by the Act or the mandate/i.test(drawer.text))
  /* Next step is an edge, offered as a step rather than as a second day field. */
  t.ok('the next step is chosen by name', /Day 40 – Rotate to Clerk 2/.test(drawer.text))

  /* ---------- an edit actually leaves the browser ---------- */
  const name = page.locator('aside').filter({ hasText: 'Step details' }).locator('input').first()
  await name.fill('Final Notice — seven days')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.waitForTimeout(600)
  t.check(`the change was sent to the database (${patched.length})`, patched.length, 1)
  t.ok('...carrying the new name', /seven days/.test(patched[0]?.body ?? ''))
  /* And only the fields the form owns: x and y belong to the drag, not to this panel. */
  t.ok('...and not the card’s position, which this form does not own',
    !/"x"|"y"/.test(patched[0]?.body ?? ''))

  /* ---------- the step is told what to send ---------- */

  /*
   * THE COLUMN NOTHING COULD SET. workflow_nodes.template_id has existed since this table was
   * written, and while the builder lived in Settings and the library lived somewhere else there
   * was no control for it anywhere: a step could be created saying "send an email" with nothing
   * to send, the builder COUNTED those under "Notices to write", and no screen could fix one.
   * This is the reason the workflows moved into the library at all.
   */
  await page.getByRole('button', { name: /day 60 Court Process Explained/i }).click()
  await page.getByText('Step details').waitFor({ timeout: 10000 })
  const sends = page.locator('aside').filter({ hasText: 'Step details' })
    .locator('select').filter({ hasText: 'Not written yet' }).first()
  t.ok('a communication step is asked what it sends', await sends.isVisible())
  /*
   * NARROWED TO WHAT THE CHANNEL CAN CARRY. Day 60 goes by email, so it is offered the emails and
   * nothing else — a picker showing forty rows of which four are usable is a picker people stop
   * reading, and choosing a letter for an email step is a save the database would take and a
   * message that would never make sense.
   */
  const offered = (await sends.locator('option').allInnerTexts()).map((o) => o.trim())
  t.check(`an email step is offered the emails (${offered.join(' | ')})`,
    offered.join(' | '),
    'Not written yet | Handover notice | Section 129 covering email')

  /* And a step that goes by REGISTERED POST is offered the letters instead, which is the half
     that proves the list is narrowed by channel rather than merely short. */
  await page.getByRole('button', { name: /day 1 Demand \+ Section 129/i }).click()
  await page.waitForTimeout(500)
  const posts = page.locator('aside').filter({ hasText: 'Step details' })
    .locator('select').filter({ hasText: 'Not written yet' }).first()
  const postOffered = (await posts.locator('option').allInnerTexts()).map((o) => o.trim())
  t.check(`a registered-post step is offered the letters (${postOffered.join(' | ')})`,
    postOffered.join(' | '), 'Not written yet | Section 129 notice (retired)')
  /*
   * AND THE UNWRITTEN STATUTORY NOTICE IS SAID IN RED. An unwritten notice is ordinary early in a
   * draft. An unwritten notice the ACT REQUIRES, on a workflow about to be published, is the firm
   * failing to make a demand it must make — and this one is the section 129.
   */
  t.ok('...and an unwritten statutory notice says the Act requires it',
    await page.getByText(/required by the Act and there is nothing written/).first().isVisible())

  /* Choosing one leaves the browser, against the column that could not be set before. */
  const beforePick = patched.length
  await posts.selectOption({ label: 'Section 129 notice (retired)' })
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.waitForTimeout(700)
  const picked = patched[patched.length - 1]
  t.ok(`the wording reaches the database (${(picked?.body ?? '').slice(0, 70)})`,
    patched.length > beforePick && (picked?.body ?? '').includes(LIBRARY[2].id))

  /* ---------- nothing pretends to work ---------- */
  /* `exact`, because the profile is loaded now and the sidebar's account button reads "Test
     Leader" — a loose /Test/ matches that first and asks whether the AVATAR is disabled. */
  const test = await page.getByRole('button', { name: 'Test', exact: true }).isDisabled()
  t.ok('the Test button is visibly disabled rather than faking a dry run', test)
  t.ok('the conditions tab says it is not built',
    await page.getByRole('button', { name: 'conditions' }).isVisible())
  await page.getByRole('button', { name: 'conditions' }).click()
  t.ok('...and says so plainly',
    await page.getByText(/Conditions are not built yet/).isVisible())

  /* ---------- what the workflow adds up to ---------- */
  t.ok('the duration is counted from the steps',
    await page.getByText('80 days').first().isVisible())
  t.ok('...and the team it belongs to is named',
    await page.getByText('Pre-legal').first().isVisible())
  t.ok('...and the notices still to write are counted, statutory apart',
    await page.getByText(/7 · 4 statutory/).isVisible())

  /* ---------- a reader, under the library's rule ---------- */

  /*
   * EVERYONE READS, AN ADMINISTRATOR WRITES — the firm's rule for the whole library, and the
   * workflows are in the library now. This is a boundary that DID NOT EXIST before the move:
   * Settings had no role check on the tab at all, so anybody who could reach Settings could open
   * the builder and be refused by RLS only after they had typed.
   *
   * A team leader is the right person to check it with. They freeze accounts and set targets, so
   * "management can" is the wrong instinct — and the write policy was narrowed to Administrator
   * alone in the same migration, which took the workflow write away from them.
   */
  const reader = await signedInPage(
    browser, { ...PROFILE, role: 'Pre-legal Team Leader' },
    [...asRole('Pre-legal Team Leader'), ...handlers], [],
  )
  await reader.page.goto(`http://localhost:${PORT}/library/workflows/standard-collections`)
  await reader.page.locator('p', { hasText: /^Phase 1 · Notice$/ }).first().waitFor({ timeout: 20000 })
  t.ok('a team leader reads the workflow', true)
  /* The whole thing, not a stub of it: the canvas is what says what happens to their file. */
  t.ok('...the whole canvas, which is what says what happens to their file',
    await reader.page.getByRole('button', { name: /day 35 Final Notice/i }).isVisible())

  t.check('...and is offered no way to take a draft',
    await reader.page.getByRole('button', { name: /takes a draft/ }).count(), 0)
  t.check('...nor to publish', await reader.page.getByRole('button', { name: 'Publish' }).count(), 0)
  t.check('...nor to add a step',
    await reader.page.getByRole('button', { name: 'Add step' }).count(), 0)

  /*
   * AND THE DRAWER OPENS, LOCKED. Not hidden — a collector has to be able to read what a step
   * does, including the wording it sends. Every field in it is disabled, which is asserted over
   * the form rather than over a class name.
   */
  await reader.page.getByRole('button', { name: /day 35 Final Notice/i }).click()
  await reader.page.getByText('Step details').waitFor({ timeout: 10000 })
  const locked = await reader.page.evaluate(() => {
    const aside = [...document.querySelectorAll('aside')]
      .find((a) => /step details/i.test(a.innerText))
    const fields = [...aside.querySelectorAll('input, select, textarea')]
    return { total: fields.length, open: fields.filter((f) => !f.disabled).length }
  })
  t.ok(`the drawer still opens (${locked.total} fields)`, locked.total > 5)
  t.check('...with every field of it locked', locked.open, 0)
  t.ok('...and says who writes these rather than leaving it to be guessed',
    await reader.page.getByText(/An administrator writes the workflows/).first().isVisible())
  const beforeRead = patched.length
  await reader.page.waitForTimeout(400)
  t.check('...and nothing was written', patched.length, beforeRead)
  await t.shot(reader.page, '25-workflow-read-only')
  await reader.context.close()
} catch (e) {
  /*
   * A THROW IS A FAILURE, REPORTED AS ONE.
   *
   * Without this the file died on the first timeout and printed nothing at all — not the results
   * of the thirty checks that had already run, not which line stopped it. A suite whose failure
   * mode is an uncaught TimeoutError forty lines from the cause is a suite people stop reading.
   * Found by breaking the template picker and watching a red run print no red.
   */
  t.ok(`the run finished without throwing (${String(e).split('\n')[0].slice(0, 140)})`, false)
  try {
    const pages = browser ? browser.contexts().flatMap((c) => c.pages()) : []
    if (pages[0]) await t.shot(pages[0], '29-where-it-stopped')
  } catch { /* nothing more to learn */ }
} finally {
  if (browser) await browser.close()
  stopServer(server)
}

const good = t.finish(`
Settings → Workflows draws the firm's day 0 to 80 line from data, with the branch cards gone to
workflows of their own. The step drawer carries ONE way of saying when and keeps the debtor's
period as its own field, which is the fault in the mockup it replaces. Nothing on it pretends to
work: Test is disabled and the empty tabs say so. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)
