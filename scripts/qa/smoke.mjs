/**
 * A robot that clicks through the whole app and shouts if anything breaks.
 *
 *   npm run test:smoke                 every page, every tab, one real record of each kind
 *   npm run test:smoke -- --tablet     the same again at tablet width (what collectors use)
 *   npm run test:smoke -- --headed     watch it happen (needs a display)
 *
 * What counts as broken -- each is a bug a person would otherwise have had to notice and report:
 *   - the page crashed (our ErrorBoundary appeared, or the screen went blank)
 *   - a JavaScript error, uncaught or logged with console.error
 *   - one of our own requests (/api/* or Supabase) answered 5xx
 *   - a page took longer than 15s to settle
 *
 * READ-ONLY by design. It navigates, opens tabs, and opens existing records. It never clicks
 * Save, Send, Call, Delete or anything else that writes, so it is safe on any data -- but point
 * .env.local at staging anyway, as screenshot.mjs says. It signs in as a real user.
 *
 * Without RAPTOR_QA_EMAIL / RAPTOR_QA_PASSWORD it still checks the signed-out pages, and says
 * plainly that it skipped the rest rather than passing quietly.
 *
 * Adding a scenario: append to SCENARIOS below. `tabs` are the exact button labels to click.
 */
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const { chromium } = await import(
  process.env.RAPTOR_QA_PLAYWRIGHT
  ?? `${execSync('npm root -g', { encoding: 'utf8' }).trim()}/playwright/index.mjs`
)

/* ------------------------------------------------------------------ the scenarios */

const SCENARIOS = [
  { route: '/' },
  { route: '/accounts', open: '/accounts/', openTabs: ['Overview', 'Transactions', 'Documents'] },
  { route: '/queries' },
  { route: '/leads', open: '/leads/' },
  { route: '/deals', open: '/deals/' },
  { route: '/contacts', open: '/contacts/' },
  { route: '/companies', open: '/companies/' },
  { route: '/tasks' },
  { route: '/calendar' },
  { route: '/activities' },
  { route: '/reports', tabs: ['Overview', 'Leads', 'Pipeline', 'Products & Services', 'Debt Collection', 'Sales Team', 'Lead Sources', 'Geography', 'Rejected Deals'] },
  { route: '/settings', tabs: ['Profile', 'Appearance', 'Users', 'Teams', 'Targets', 'Pipelines', 'Custom Fields', 'Lead Sources', 'Rejection Reasons', 'Notifications', 'Integrations', 'Data Import'] },
  { route: '/', open: '/reps/', openTabs: ['Workload', 'Activity', 'Effectiveness', 'Commercial Performance', 'Discipline'] },
  { route: '/a-page-that-does-not-exist' },
]

/* ------------------------------------------------------------------ setup */

const args = process.argv.slice(2)
const headed = args.includes('--headed')
const tablet = args.includes('--tablet')
const OUT = process.env.RAPTOR_QA_OUT ?? path.join(process.cwd(), '.qa-screenshots', 'smoke')
fs.mkdirSync(OUT, { recursive: true })

try { process.loadEnvFile('.env.local') } catch { /* absent is fine */ }
const email = process.env.RAPTOR_QA_EMAIL
const password = process.env.RAPTOR_QA_PASSWORD

const PORT = 5198
const server = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort=false'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, VITE_REPORT_ERRORS_LOCALLY: '0' },
})
const stop = () => { if (!server.killed) server.kill('SIGTERM') }
process.on('exit', stop)
process.on('SIGINT', () => { stop(); process.exit(130) })

const ORIGIN = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('dev server did not start within 60s')), 60_000)
  let buf = ''
  server.stdout.on('data', (d) => {
    buf += String(d)
    const m = /http:\/\/localhost:(\d+)/.exec(buf)
    if (m) { clearTimeout(timer); resolve(`http://localhost:${m[1]}`) }
  })
  server.on('exit', (code) => { clearTimeout(timer); reject(new Error(`dev server exited (${code})`)) })
})
if (!/^http:\/\/localhost:\d+$/.test(ORIGIN)) { console.error('Only runs against localhost. Refusing.'); process.exit(2) }

// Proxy handling: see the long note in screenshot.mjs for why it is a raw flag.
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy
const browser = await chromium.launch({
  headless: !headed,
  ...(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {}),
  ...(proxy ? { args: [`--proxy-server=${proxy}`], ignoreDefaultArgs: ['--proxy-server'] } : {}),
})
const viewport = tablet ? { width: 820, height: 1180 } : { width: 1440, height: 1000 }
const page = await browser.newPage({ viewport, ignoreHTTPSErrors: true })

/* ------------------------------------------------------------------ what we watch */

let problems = [] // for the step currently running
page.on('pageerror', (e) => problems.push(`JS error: ${e.message}`))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  // A 4xx the app handled on purpose (no row, not allowed) logs as a failed resource; the 5xx
  // check below is the one that means something is wrong.
  if (/Failed to load resource: the server responded with a status of 4\d\d/.test(t)) return
  problems.push(`console.error: ${t.slice(0, 300)}`)
})
page.on('response', (r) => {
  const u = r.url()
  if (r.status() >= 500 && (u.startsWith(ORIGIN) || /supabase\.co/.test(u))) {
    problems.push(`HTTP ${r.status()} from ${u.replace(/\?.*/, '')}`)
  }
})

const results = []
async function step(name, fn) {
  problems = []
  const t = Date.now()
  try {
    await fn()
    await settle()
    const crashed = await page.locator('[data-testid="error-boundary"]').count()
    if (crashed) problems.push(`page crashed: ${(await page.locator('[data-testid="error-boundary"] pre').textContent())?.trim()}`)
    const text = ((await page.textContent('body')) ?? '').trim()
    if (text.length < 20) problems.push('page is blank')
  } catch (e) {
    problems.push(`step failed: ${e instanceof Error ? e.message.split('\n')[0] : e}`)
  }
  const ok = problems.length === 0
  const ms = Date.now() - t
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${ms}ms)`)
  if (!ok) {
    const shot = path.join(OUT, `${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}.png`)
    try { await page.screenshot({ path: shot, fullPage: true }) } catch { /* gone */ }
    for (const p of [...new Set(problems)]) console.log(`        ${p}`)
    console.log(`        screenshot: ${shot}`)
  }
  results.push({ name, ok, problems: [...new Set(problems)] })
}

async function settle() {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => problems.push('did not settle within 15s'))
  await page.waitForTimeout(600) // a render after the last response
}

/* ------------------------------------------------------------------ the tour */

try {
  await step('signed out: /login', () => page.goto(`${ORIGIN}/login`))
  await step('signed out: a private page sends you to /login', async () => {
    await page.goto(`${ORIGIN}/accounts`)
    await page.waitForURL(/\/login/, { timeout: 10_000 })
  })

  if (!email || !password) {
    console.log('\nSKIPPED the signed-in tour: set RAPTOR_QA_EMAIL and RAPTOR_QA_PASSWORD in .env.local.')
  } else {
    await step('sign in', async () => {
      await page.goto(`${ORIGIN}/login`)
      await page.fill('input[type="email"]', email)
      await page.fill('input[type="password"]', password)
      await page.click('button[type="submit"]')
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 })
    })

    for (const s of SCENARIOS) {
      await step(s.route, () => page.goto(ORIGIN + s.route))
      for (const tab of s.tabs ?? []) {
        await step(`${s.route} › ${tab}`, () => page.getByRole('button', { name: tab, exact: true }).first().click({ timeout: 5_000 }))
      }
      if (s.open) {
        // The first real record of this kind -- whatever the data happens to hold today.
        const href = await page.locator(`main a[href^="${s.open}"]`).first().getAttribute('href', { timeout: 5_000 }).catch(() => null)
        if (!href) { console.log(`skip  ${s.open}:id  (no record linked from ${s.route})`); continue }
        await step(`${s.open}:id (${href})`, () => page.goto(ORIGIN + href))
        for (const tab of s.openTabs ?? []) {
          // Tab buttons carry a count after the label ("Transactions 12"), so match the start.
          await step(`${s.open}:id › ${tab}`, () =>
            page.locator('main button').filter({ hasText: new RegExp(`^\\s*${tab}\\b`) }).first().click({ timeout: 5_000 }))
        }
      }
    }
  }
} finally {
  await browser.close()
  stop()
}

const bad = results.filter((r) => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} steps passed${tablet ? ' (tablet width)' : ''}`)
if (bad.length) console.log(`FAILED: ${bad.map((b) => b.name).join(' | ')}`)
process.exit(bad.length ? 1 : 0)
