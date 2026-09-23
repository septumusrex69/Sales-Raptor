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

/*
 * THE FIRM'S CORRECTED SPINE, which is what the database now holds.
 *
 * It used to be the mockup's day 1 to 80 version, with "Rotate to Clerk 2" and "Rotate to Clerk
 * 3" as spine steps. The firm took rotation OUT of the spine -- it is a calendar rule now, the
 * 5th two months on -- so that no allocation decision can move the date of a section 129, and the
 * sequence runs to day 160 and ends in a recommendation back to the client. A fixture still
 * drawing the old one would be a test passing against a process nobody runs.
 */
const PHASES = [
  { id: 'p1', ordinal: 1, name: 'Phase 1 · Notice', subtitle: 'Demand, listing and the final notice', from_day: 0, to_day: 40 },
  { id: 'p2', ordinal: 2, name: 'Phase 2 · Legal', subtitle: 'Mora, the court process and the summons', from_day: 40, to_day: 80 },
  { id: 'p3', ordinal: 3, name: 'Phase 3 · Open', subtitle: 'Strategy, viability and the recommendation', from_day: 80, to_day: 160 },
]
const n = (key, kind, label, day, phase, over = {}) => ({
  id: key, phase_id: phase, key, kind, label, description: `${label} description.`, day,
  deadline_days: null, deadline_unit: null, channel: null, template_id: null, statutory: false,
  assign_to: 'Current clerk', x: null, y: null, ordinal: 0, ...over,
})
const NODES = [
  n('handover-notice', 'communication', 'Handover notice', 0, 'p1', { ordinal: 1, channel: 'post' }),
  /* Wired, like the stored one, so the picker has a step that is already answered to read back. */
  n('demand-129', 'communication', 'Demand and section 129', 1, 'p1', { ordinal: 2, channel: 'registered_post', statutory: true, template_id: 'cccccccc-0000-4000-8000-000000000003' }),
  n('intention-to-list', 'communication', 'Intention to list', 10, 'p1', { ordinal: 3, channel: 'registered_post', statutory: true, deadline_days: 20, deadline_unit: 'business' }),
  n('follow-up-offer', 'communication', 'Follow-up and offer', 21, 'p1', { ordinal: 4, channel: 'email' }),
  n('final-notice', 'communication', 'Final notice', 35, 'p1', { ordinal: 5, channel: 'registered_post', statutory: true, deadline_days: 7, deadline_unit: 'calendar' }),
  n('listing-confirmed', 'action', 'Listing confirmed', 42, 'p2', { ordinal: 6 }),
  n('intended-legal-action', 'communication', 'Intended legal action', 50, 'p2', { ordinal: 7, channel: 'registered_post', statutory: true }),
  n('court-process-explained', 'communication', 'Court process explained', 60, 'p2', { ordinal: 8, channel: 'email' }),
  n('final-settlement-window', 'communication', 'Final settlement window', 70, 'p2', { ordinal: 9, channel: 'email' }),
  n('draft-summons', 'task', 'Draft summons', 75, 'p2', { ordinal: 10, assign_to: 'Team leader' }),
  n('open-strategy', 'task', 'Open strategy', 80, 'p3', { ordinal: 11 }),
  n('viability-review', 'task', 'Viability review', 110, 'p3', { ordinal: 12 }),
  n('closure-report', 'task', 'Closure report', 155, 'p3', { ordinal: 13 }),
  n('recommendation', 'task', 'Recommendation', 160, 'p3', { ordinal: 14, assign_to: 'Team leader' }),
]
const CONNECTIONS = NODES.slice(0, -1).map((a, i) => ({
  id: `e${i}`, from_node_id: a.id, to_node_id: NODES[i + 1].id, to_workflow_id: null, label: null,
}))

const WORKFLOW = {
  id: 'w1', key: 'standard-collections', name: 'Standard Collections – Non-Paying Debtor',
  description: 'Main collection workflow for non-paying debtors. Day 0 to Day 80.',
  teams: { name: 'Pre-legal' },
  /*
   * THE TRIGGER IS IN THE FIXTURE, not left out and defaulted. A stub that omits a column tests
   * the fallback and nothing else -- and this suite has already been caught twice this month
   * answering a request in a way that never exercised the feature under test. This workflow is
   * the firm's own 160-day spine, so the trigger is the one it was written for.
   */
  workflow_versions: [{
    id: VERSION, version: 1, state: 'draft', published_at: null,
    trigger_kind: 'handover', trigger_note: null,
  }],
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
  /*
   * THE OLD ADDRESS STILL WORKS. /accounts/workflows held a read-only page showing this chart
   * transcribed from paper; it is retired, but a bookmark to it must not land on a blank page.
   */
  await page.goto(`http://localhost:${PORT}/accounts/workflows`)
  await page.locator('p', { hasText: /^Phase 1 · Notice$/ }).first().waitFor({ timeout: 20000 })
  t.check(`the old accounts address lands on the builder (${new URL(page.url()).pathname})`,
    new URL(page.url()).pathname, '/library/workflows/standard-collections')
  /* Replaced, not pushed: Back should go where the person came from, not round the redirect. */

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
  t.check(`all fourteen steps are drawn (${cards.length})`, cards.length, 14)
  t.ok('day 1 is the section 129', cards.some((c) => /^day 1\b[\s\S]*Demand and section 129/i.test(c)))
  t.ok('...and it says it goes by registered post',
    cards.some((c) => /Demand and section 129[\s\S]*Registered post/i.test(c)))
  t.ok('day 35 is the final notice with the debtor’s seven days',
    cards.some((c) => /day 35\b[\s\S]*Final notice[\s\S]*Registered post · 7 days to respond/i.test(c)))
  t.ok('...and day 10 counts its twenty in BUSINESS days',
    cards.some((c) => /day 10\b[\s\S]*Intention to list[\s\S]*Registered post · 20 business days to respond/i.test(c)))
  /*
   * ROTATION IS NOT A STEP ANY MORE. The firm took it out of the spine so that no allocation
   * decision can move the date of a section 129; a card called "Rotate to Clerk 2" on day 40
   * would mean the old version is still being drawn.
   */
  t.ok('rotation is not drawn as a step', !cards.some((c) => /rotate to clerk/i.test(c)))
  t.ok('...and the sequence runs to the recommendation on day 160',
    cards.some((c) => /^day 160\b[\s\S]*Recommendation/i.test(c)))
  t.ok('all three phases are drawn',
    await page.locator('p', { hasText: /^Phase 3 · Open$/ }).first().isVisible())
  t.ok('...with their day ranges', await page.getByText(/day 80 – 160/i).first().isVisible())

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
  await page.getByRole('button', { name: /day 35 .*Final notice/is }).click()
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
  t.ok('the drawer names the step', /Final notice/i.test(drawer.text))

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
  t.ok('the next step is chosen by name', /Day 42 – Listing confirmed/.test(drawer.text))

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
  await page.getByRole('button', { name: /day 60 .*Court process explained/is }).click()
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
  await page.getByRole('button', { name: /day 50 .*Intended legal action/is }).click()
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
    await page.getByText('160 days').first().isVisible())
  t.ok('...and the team it belongs to is named',
    await page.getByText('Pre-legal').first().isVisible())
  t.ok('...and the notices still to write are counted, statutory apart',
    await page.getByText(/7 · 4 statutory/).isVisible())

  /* ---------- what the old read-only page was for ---------- */

  /*
   * TWO THINGS MOVED ONTO THIS SCREEN when /accounts/workflows was retired, and retiring it was
   * only safe because they did. A workflow written in day numbers is unreadable against a
   * calendar — "day 110" tells nobody whether the viability review lands in the December
   * shutdown — and that is the kind of error somebody spots in a second and never spots in a
   * day number.
   */
  /*
   * WHAT SETS THE WORKFLOW OFF, ON THE PAGE. A workflow could say what happens to a file and not
   * how the file got there, so every day number silently meant "days from the handover" -- and
   * the firm's next four workflows are entered from a broken arrangement, a dispute, a default.
   * The sentence is what stops a section 129 being laid out against the wrong day zero.
   */
  t.ok('the builder says what sets this workflow off',
    await page.getByText('Starts when', { exact: false }).first().isVisible())
  /*
   * ASKED OF THE CONTROL, NOT OF THE PAGE TEXT. On a draft the trigger is a <select>, and a
   * browser does not lay an unselected <option> out -- getByText finds the words in the DOM and
   * reports them as not visible, which is a failing check about nothing. The selected value is
   * the fact worth asserting anyway.
   */
  const triggerBox = page.locator('select').filter({ has: page.locator('option[value="handover"]') })
  t.ok('...as a control the firm can change while it is a draft', await triggerBox.first().isVisible())
  t.check('...set to the event this workflow was written for',
    await triggerBox.first().inputValue(), 'handover')
  t.ok('...and every trigger is offered, not just this one',
    await triggerBox.first().locator('option').count() > 5)
  t.ok('...and says what day 0 therefore is',
    await page.getByText('Day 0 is the day the account was handed over', { exact: false })
      .first().isVisible())

  const handover = page.locator('input[type="date"]').first()
  t.ok('the builder asks what handover to date this against', await handover.isVisible())
  await handover.fill('2026-09-18')
  await page.waitForTimeout(600)
  /* Day 35 from 18 September 2026 is 23 October 2026. Asserted as a real date rather than as
     "some date appeared", which is what makes it a check rather than a screenshot. */
  t.ok('...and every card carries the day it actually lands on',
    await page.getByText('23 Oct 2026', { exact: true }).first().isVisible())
  /* Moving the handover moves them. A date that did not move would be today's, formatted. */
  await handover.fill('2026-09-19')
  await page.waitForTimeout(600)
  t.check('...which moves when the handover does',
    await page.getByText('23 Oct 2026', { exact: true }).count(), 0)
  t.ok('...to the day after',
    await page.getByText('24 Oct 2026', { exact: true }).first().isVisible())
  /*
   * SEPTEMBER IS "Sep", NOT "Sept". en-ZA renders it with four letters where every other month
   * gets three, so a column of dates comes out ragged one month in twelve — which is why the
   * month names are written out by hand rather than formatted by the locale.
   */
  await handover.fill('2026-09-01')
  await page.waitForTimeout(600)
  t.ok('...spelling September in three letters, as every other month is',
    await page.getByText('1 Sep 2026', { exact: true }).first().isVisible())
  t.check('...and never as "Sept"', await page.getByText(/\bSept\b/).count(), 0)

  /*
   * AND THE FIRM'S OPEN QUESTION, which the retired page raised and nobody has answered: the
   * chart staffs this workflow with four clerks and the spine closes before the fourth is ever
   * reached. It is computed for the date on screen rather than written once, because on some
   * handover dates all four ARE reached — a warning that fires when nothing is wrong is worse
   * than no warning.
   */
  await handover.fill('2026-09-18')
  await page.waitForTimeout(600)
  t.ok('the fourth clerk never receiving the file is still said',
    await page.getByText(/Clerk 4 never receives this file/).first().isVisible())
  t.ok('...naming the day it closes and the rotation that comes too late',
    await page.getByText(/closes on 2027-02-25/).first().isVisible())
  /*
   * AND THE NUMBERS ARE THE CHART'S, not whatever arithmetic produced the banner. Written first
   * as "Clerk 4 never receives this file" alone, this check stayed green when the staffing number
   * was changed from four to eight — the banner still said Clerk 4, because that is reached + 1.
   * It is the pair that pins it: four staffed, three reached.
   */
  const banner = (await page.getByText(/never receives this file/).first()
    .locator('xpath=ancestor::div[1]').innerText()).replace(/\s+/g, ' ')
  t.ok(`...and says the chart staffs it with four (${banner.slice(-110)})`,
    /staffs this workflow with 4\b/.test(banner))
  t.ok('...against the three it actually reaches', /this is a 3-clerk workflow/.test(banner))

  /*
   * WHAT THIS DOES NOT COVER, said plainly rather than left to be assumed. The banner is supposed
   * to be SILENT when all four clerks are reached, and no handover date reaches four on a
   * 160-day spine — three rotations need about 180 days — so a browser cannot exercise that half
   * with this workflow. It is checked where it can be: check-workflow-schedule.mjs asserts
   * short === 0 on a 240-day sequence.
   */
  await t.shot(page, '22-workflow-dated')

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
    await reader.page.getByRole('button', { name: /day 35 .*Final notice/is }).isVisible())

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
  await reader.page.getByRole('button', { name: /day 35 .*Final notice/is }).click()
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
Library → Workflows draws the firm's corrected day 0 to 160 line from data, with the branch cards gone to
workflows of their own. The step drawer carries ONE way of saying when and keeps the debtor's
period as its own field, which is the fault in the mockup it replaces. Nothing on it pretends to
work: Test is disabled and the empty tabs say so. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)
