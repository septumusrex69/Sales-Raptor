/**
 * Look at the app before shipping it.
 *
 * Two bugs this session — chart axes clipped to "R0k", a Compose button that could never
 * appear — were things one screenshot would have caught and a typecheck never could. This
 * exists so "it compiles" stops being mistaken for "it works".
 *
 *   node scripts/qa/screenshot.mjs /accounts /settings
 *
 * It starts its own dev server, signs in, visits each route, saves a full-page PNG, and reports
 * every console error. Then it stops the server it started. One command, no leftovers.
 *
 * Credentials come from the environment and are never read from the repo:
 *
 *   RAPTOR_QA_EMAIL, RAPTOR_QA_PASSWORD
 *
 * Put them in .env.local, which is gitignored. Whoever owns the account can rotate or revoke it
 * without telling anyone, which is the point.
 *
 * SAFETY. This script refuses to run against anything but localhost, and the dev server it
 * starts is whatever .env.local points at. Point .env.local at staging, never at production: it
 * signs in and clicks things, and a screenshot is not worth taking on live client money.
 */
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
// Playwright is installed globally in this environment, not as a project dependency — the app
// itself has no need of it and should not carry a browser driver in its lockfile. Resolve it
// from the global root rather than adding it to package.json for one script.
const { chromium } = await import(
  process.env.RAPTOR_QA_PLAYWRIGHT
  ?? `${execSync('npm root -g', { encoding: 'utf8' }).trim()}/playwright/index.mjs`
)

const PORT = 5199
const OUT = process.env.RAPTOR_QA_OUT ?? path.join(process.cwd(), '.qa-screenshots')

const routes = process.argv.slice(2).filter((a) => a.startsWith('/'))
if (routes.length === 0) {
  console.error('Usage: node scripts/qa/screenshot.mjs /route [/another-route ...]')
  process.exit(2)
}

// Node does not read .env.local on its own — Vite does that for the app, not for us. Load it
// here so the credentials live in the same gitignored file as everything else secret, rather
// than having to be typed on a command line where they end up in shell history.
try { process.loadEnvFile('.env.local') } catch { /* absent is fine; the check below explains */ }

const email = process.env.RAPTOR_QA_EMAIL
const password = process.env.RAPTOR_QA_PASSWORD
if (!email || !password) {
  console.error('Set RAPTOR_QA_EMAIL and RAPTOR_QA_PASSWORD (put them in .env.local).')
  process.exit(2)
}

fs.mkdirSync(OUT, { recursive: true })

/* ------------------------------------------------------ the server, ours to stop */

const server = spawn('npm', ['run', 'dev', '--', '--port', String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
const stop = () => { if (!server.killed) server.kill('SIGTERM') }
process.on('exit', stop)
process.on('SIGINT', () => { stop(); process.exit(130) })

/*
 * Read the port Vite actually chose rather than assuming it got the one we asked for. It walks
 * forward when a port is busy — an abandoned server from an earlier run is enough — and an exact
 * match on the requested port then waits forever against a server that is running perfectly well.
 */
const ORIGIN = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('dev server did not start within 60s')), 60_000)
  let buffered = ''
  server.stdout.on('data', (d) => {
    buffered += String(d)
    const m = /http:\/\/localhost:(\d+)/.exec(buffered)
    if (m) { clearTimeout(timer); resolve(`http://localhost:${m[1]}`) }
  })
  server.on('exit', (code) => { clearTimeout(timer); reject(new Error(`dev server exited (${code})`)) })
})

// The origin is built from a localhost literal above, but assert it anyway: a future edit that
// makes this configurable should have to delete this line and think about why.
if (!/^http:\/\/localhost:\d+$/.test(ORIGIN)) {
  console.error('This script only runs against localhost. Refusing.')
  process.exit(2)
}
console.log(`dev server on ${ORIGIN}`)

/* ---------------------------------------------------------------------- the look */

/*
 * Two things the browser needs that the shell already has.
 *
 * Outbound HTTPS in this container goes through a local agent proxy, and Chromium does not read
 * the shell's proxy variables — without this every Supabase call dies as ERR_TUNNEL_CONNECTION
 * _FAILED and the sign-in silently never completes. The proxy re-signs TLS with its own CA, so
 * the certificates it presents are legitimately not ones Chromium ships with; NODE_EXTRA_CA_CERTS
 * covers Node but not the browser.
 *
 * ignoreHTTPSErrors is scoped to this page only, and this script cannot reach anything but
 * localhost and whatever localhost talks to. It is not a setting the app inherits.
 */
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  ...(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1' } } : {}),
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, ignoreHTTPSErrors: true })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

let failed = false
try {
  await page.goto(`${ORIGIN}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 })

  for (const route of routes) {
    await page.goto(ORIGIN + route, { waitUntil: 'networkidle' })
    // Data on these pages arrives after first paint; a screenshot taken too early shows
    // spinners and proves nothing.
    await page.waitForTimeout(2500)
    const file = path.join(OUT, `${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root'}.png`)
    await page.screenshot({ path: file, fullPage: true })
    const text = (await page.textContent('body')) ?? ''
    console.log(`${route} -> ${file}`)
    console.log(`   ${text.trim().slice(0, 180).replace(/\s+/g, ' ')}`)
  }
} catch (e) {
  failed = true
  console.error(`\nFAILED: ${e instanceof Error ? e.message : e}`)
} finally {
  await browser.close()
  stop()
}

if (errors.length) {
  console.error(`\n${errors.length} console error(s):`)
  for (const e of errors.slice(0, 10)) console.error(`  ${e}`)
}
process.exit(failed || errors.length ? 1 : 0)
