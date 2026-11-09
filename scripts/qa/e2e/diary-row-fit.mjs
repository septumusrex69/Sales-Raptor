/**
 * R-25 (Raptor H18): A DIARY ROW NEVER RUNS INTO THE NEXT COLUMN.
 *
 * The call centre's screenshot (5 Nov, a 1220px window, sidebar open): on Today, "Carried 14 days"
 * sat on top of "In progress", the debtor names were cut short under the Work chip. The row
 * went into columns as soon as the LIST was 48rem wide, while the five fixed columns alone take about
 * 47rem -- so the Account column was a few pixels wide and its case number, name and badges (all
 * shrink-0, nothing clipping) spilled across Work and Position.
 *
 * Here: four carried new accounts with long names, at the widths people use. In every row, every cell's
 * content stays inside its own cell, the Carried badge is wholly visible, and a name keeps room to read.
 *
 * Run: node scripts/qa/e2e/diary-row-fit.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, COMPANY_ID, PROFILE, USER_ID } from './fixtures.mjs'

const t = makeRunner('diary-row-fit')

const iso = (d) => d.toISOString().slice(0, 10)
const today = new Date()
const due = iso(new Date(today.getTime() - 20 * 86400000))

/* Invented: a long name, a hyphenated one and two short ones. */
const NAMES = [['Bartholomew', 'Vanderwesthuizen-Lee'], ['Annamarie', 'Oosthuizen-Moodley'], ['Jo', 'Test'], ['Sam', 'Example']]
const ENTRIES = NAMES.map(([first, last], i) => ({
  id: `de-${i}`, account_id: `acc-${i}`, owner_id: USER_ID, created_by: USER_ID, kind: 'new_account', state: 'open',
  due_on: due, priority: 20, source: 'import', reason: null, created_at: '2026-01-01T08:00:00Z',
  promises_to_pay: null, campaigns: null,
  debtor_accounts: {
    id: `acc-${i}`, company_id: COMPANY_ID, account_number: `AC${i}`, case_number: `RAP-90000${i}`,
    debtor_first_name: first, debtor_surname: last, capital_outstanding: 345 + i * 100, status: 'Active',
    sub_status: null, bucket: null, client_action_ask: null, last_action_at: null, ended_as: null, book: 'pre_legal',
    prescription_date: null, main_comment: null, main_comment_at: null,
  },
}))

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { context, page } = await signedInPage(browser, { ...PROFILE, role: 'Pre-legal Agent' }, [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [{ ...PROFILE, role: 'Pre-legal Agent' }] })],
    [(u) => u.includes('/rest/v1/companies'), () => ({ body: [{ ...COMPANY, name: 'Example Wholesalers (Pty) Ltd' }] })],
    [(u) => u.includes('/rest/v1/diary_entries') && u.includes('due_on=lt.'), () => ({ body: ENTRIES })],
    [(u) => u.includes('/rest/v1/diary_entries'), () => ({ body: [] })],
  ], [])
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/diary`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByText('Carried', { exact: false }).first().waitFor({ timeout: 20000 })

  for (const width of [800, 1024, 1100, 1220, 1300, 1440, 1700]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(300)
    const r = await page.evaluate(() => {
      const out = { rows: 0, spills: [], badgeHidden: 0, narrowNames: 0 }
      for (const li of document.querySelectorAll('li')) {
        const grid = li.firstElementChild
        if (!grid || !li.querySelector('[data-testid="diary-case-number"]')) continue
        out.rows += 1
        for (const cell of grid.children) {
          const box = cell.getBoundingClientRect()
          for (const el of cell.querySelectorAll('*')) {
            const b = el.getBoundingClientRect()
            if (b.width === 0) continue
            // Text an ellipsis box INSIDE the cell clips is truncation by design. The cell's own clipping
            // does not count: that would only hide the spill R-25 was about.
            let clip = el.parentElement, truncated = false
            while (clip && clip !== cell) {
              if (getComputedStyle(clip).overflowX !== 'visible') { truncated = true; break }
              clip = clip.parentElement
            }
            if (truncated) continue
            // Inside its own cell -- or hidden by the cell clipping it, which is still a spill of meaning.
            if (b.right > box.right + 1 || b.left < box.left - 1) out.spills.push(`${(el.textContent || el.tagName).trim().slice(0, 24)} (${Math.round(b.right - box.right)}px)`)
          }
        }
        const badge = [...li.querySelectorAll('span')].find((s) => /^Carried /.test(s.textContent || ''))
        if (badge) {
          badge.scrollIntoView({ block: 'center' })   // elementFromPoint sees only what is in the window
          const b = badge.getBoundingClientRect()
          const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
          if (!hit || !badge.contains(hit)) out.badgeHidden += 1
        }
        const name = li.querySelector('a[title]')
        if (name && name.getBoundingClientRect().width < 64) out.narrowNames += 1
      }
      return out
    })
    t.check(`${width}px: four diary rows drawn`, r.rows, 4)
    t.check(`${width}px: nothing in a row runs into the next column`, r.spills.slice(0, 4).join(', '), '')
    t.check(`${width}px: every "Carried" badge is on top, not under another column`, r.badgeHidden, 0)
    t.check(`${width}px: every debtor name has room to read`, r.narrowNames, 0)
    if (width === 1220 || width === 1440 || width === 800) await t.shot(page, `diary-row-fit-${width}`)
  }
  await context.close()
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  await browser?.close()
  stopServer(server)
}
process.exit(t.finish() ? 0 : 1)
