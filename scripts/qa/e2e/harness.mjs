/**
 * Driving the real app in a real browser, with no database behind it.
 *
 * WHY STUBBED RATHER THAN POINTED AT STAGING. A signed-in browser test needs three things a
 * project cannot rely on having: network access to Supabase, a live account whose password is
 * somewhere safe, and staging data nobody has edited this morning. Miss any one and the suite
 * stops running, which is how test suites die. Answering the app's own requests from fixtures
 * costs none of that, and it makes the numbers KNOWN — a check can assert "Broken promises 40"
 * instead of "a number appeared".
 *
 * What it does not test: that the SQL is right. Those are the .mjs checks beside this folder and
 * the migrations run against staging. This tests the half those cannot reach — that the screen
 * renders the thing, and that clicking it does what it says.
 */
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const { chromium } = await import(
  process.env.RAPTOR_QA_PLAYWRIGHT
  ?? `${execSync('npm root -g', { encoding: 'utf8' }).trim()}/playwright/index.mjs`
)

export const PORT = Number(process.env.RAPTOR_E2E_PORT ?? 5199)
export const OUT = process.env.RAPTOR_QA_OUT ?? path.join(process.cwd(), '.qa-screenshots')

/*
 * ZERO SETUP, on purpose.
 *
 * src/lib/supabase.ts throws at import without VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, so
 * the dev server cannot boot on a fresh checkout — and a suite that needs a person to create a
 * file before it runs is a suite that does not get run. Every request is answered from fixtures
 * here, so the values only have to be well-formed, never real: if .env.local is missing one is
 * written pointing at a project that does not exist.
 *
 * It is never overwritten. Somebody with a real .env.local keeps it, and their project ref is
 * what the session key below is derived from, so the stub lands under the key the app looks in.
 */
const ENV_FILE = '.env.local'
if (!fs.existsSync(ENV_FILE)) {
  fs.writeFileSync(ENV_FILE, [
    '# Written by scripts/qa/e2e so the dev server can boot with no real project.',
    '# Every request the tests make is answered from fixtures; nothing here reaches a network.',
    'VITE_SUPABASE_URL=https://e2e-fixtures.supabase.co',
    'VITE_SUPABASE_ANON_KEY=e2e-anon-key-not-a-real-credential',
    '',
  ].join('\n'), { mode: 0o600 })
  console.log(`(wrote a placeholder ${ENV_FILE} — no real project is contacted)`)
}
try { process.loadEnvFile(ENV_FILE) } catch { /* the default below covers it */ }
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://e2e-fixtures.supabase.co'
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0]

/**
 * A session the client will accept.
 *
 * supabase-js only DECODES this to read the expiry and the subject — signatures are verified
 * server-side, and there is no server here. So an unsigned token with the right claims is enough
 * to get past the auth gate and onto the screen under test.
 */
function fakeSession(userId, email) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [
    b64({ alg: 'HS256', typ: 'JWT' }),
    b64({ sub: userId, email, role: 'authenticated', aud: 'authenticated', exp, iat: exp - 3600 }),
    'not-a-real-signature',
  ].join('.')
  return {
    access_token: token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: 'fake-refresh-token',
    user: {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      email_confirmed_at: '2026-01-01T00:00:00Z',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  }
}

/** Start the dev server and wait for it to answer. Ours to stop, so nothing is left running. */
export async function startServer() {
  const server = spawn('npm', ['run', 'dev', '--', '--port', String(PORT)], {
    stdio: 'ignore', detached: true,
  })
  return server
}

export function stopServer(server) {
  try { process.kill(-server.pid) } catch { /* already gone */ }
}

/**
 * The stub.
 *
 * `handlers` is a list of [match, respond]. The first whose match returns true answers. Anything
 * unmatched gets an empty array with a 200 — an unknown table is "nothing there", never a hang,
 * because a page waiting for ever on an unstubbed request fails as a timeout twenty lines from
 * the cause.
 */
export async function stubSupabase(page, handlers, seen) {
  await page.route('**/*.supabase.co/**', async (route) => {
    const req = route.request()
    const url = req.url()
    seen?.push(`${req.method()} ${url.replace(/^https:\/\/[^/]+/, '')}`)

    for (const [match, respond] of handlers) {
      if (match(url, req)) {
        const r = await respond(url, req)
        return route.fulfill({
          status: r.status ?? 200,
          contentType: 'application/json',
          /*
           * content-range is how PostgREST reports a count and how fetchAccounts reads its total
           * -- but a cross-origin response only lets the page read headers named in
           * access-control-expose-headers. Without this the header arrives, the browser hides it,
           * and every total silently falls back to "however many rows came back".
           */
          headers: {
            'access-control-expose-headers': 'content-range, content-length',
            ...(r.headers ?? {}),
          },
          body: JSON.stringify(r.body ?? []),
        })
      }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
}

/** A browser already signed in as `profile`, with the stub in place. */
export async function signedInPage(browser, profile, handlers, seen) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  await stubSupabase(page, handlers, seen)

  // Seeded before any app code runs, so AuthContext finds a session on its first look rather
  // than flashing the login page and redirecting.
  await context.addInitScript(
    ([key, session]) => { try { window.localStorage.setItem(key, session) } catch { /* ignore */ } },
    [`sb-${PROJECT_REF}-auth-token`, JSON.stringify(fakeSession(profile.id, profile.email))],
  )
  return { context, page }
}

export { chromium }

/* ---------- the little test runner ---------- */

export function makeRunner(name) {
  let pass = 0
  const failures = []
  const shots = []
  fs.mkdirSync(OUT, { recursive: true })

  return {
    check(label, actual, expected) {
      if (Object.is(actual, expected)) { pass += 1; return }
      failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
    },
    ok(label, actual) { this.check(label, actual, true) },
    async shot(page, file) {
      const p = path.join(OUT, `${file}.png`)
      await page.screenshot({ path: p, fullPage: true })
      shots.push(p)
    },
    finish(note) {
      if (failures.length) {
        console.log(`\n${failures.length} FAILED in ${name}:\n`)
        for (const f of failures) console.log('  ✗ ' + f + '\n')
      } else {
        console.log(`${pass} passed, 0 failed`)
        if (note) console.log(`\n${note}`)
      }
      if (shots.length) console.log(`\n${shots.length} screenshots in ${OUT}`)
      return failures.length === 0
    },
  }
}
