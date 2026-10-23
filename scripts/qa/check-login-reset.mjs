/**
 * A PASSWORD RESET THAT CANNOT DEFEAT ITSELF (S10, 23 Oct).
 *
 * Nicole pressed "Forgot password?" three times in three minutes; each press cancels the link before
 * it and the mail takes a minute, so every link she opened was the cancelled one, and the page it
 * landed on said nothing. Holds: a refused link is explained on the login page, read at module load
 * before the hash is stripped; the button waits before it can send again; the message says to open
 * only the newest email.
 *
 * Run: node scripts/qa/check-login-reset.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, v) => { if (v === true) pass += 1; else failures.push(name) }
const src = readFileSync(new URL('../../src/pages/auth/LoginPage.tsx', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const top = src.indexOf('const linkError')
const fn = src.indexOf('export function LoginPage')
ok('the link error is read from the hash', top >= 0 && /window\.location\.hash/.test(src.slice(top, fn)))
ok('...at module load, before the component', top >= 0 && fn > top)
ok('...and an expired link is named as such', /otp_expired/.test(src) && /replaced by a newer one/.test(src))
ok('...and shown as the page\'s first error', /useState<string \| null>\(linkError\)/.test(src))
ok('a sent link starts the wait', /setResetSent\(true\); setWait\(RESEND_WAIT_SECONDS\)/.test(src))
ok('...and the button is held while it runs', /disabled=\{resetting \|\| wait > 0\}/.test(src))
ok('...for a minute', /RESEND_WAIT_SECONDS = 60\b/.test(src))
ok('the message says to open only the newest email', /Open only the\s+newest one/.test(src))

if (failures.length) {
  console.error(`check-login-reset: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-login-reset: ${pass} passed, 0 failed`)
