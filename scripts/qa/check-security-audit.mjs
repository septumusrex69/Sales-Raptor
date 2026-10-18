/**
 * THE SECURITY AUDIT'S CODE FINDINGS, HELD (audit of 5 Oct 2026, fixes built 18 Oct, S8).
 *
 *   F-01  security headers on every response: no framing, no sniffing, HSTS, a referrer policy, a
 *         permissions policy -- and the CSP in REPORT-ONLY first, because an enforced CSP is inherited
 *         by the mail reader's srcdoc frame and would quietly blank remote images in debtors' emails.
 *         The microphone is NOT denied: dictation uses it (Dictate.tsx). The audit's draft denied it.
 *   C-04  the signature image is fetched on the server only from Supabase storage, over https, with
 *         no redirects -- a narrow allow-list rather than a deny-list of private ranges.
 *   C-01  the company mail sync no longer treats an unset CRON_SECRET as "this is the cron".
 *   E-03..05  every server secret the code reads is named in .env.example.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-security-audit.mjs
 */
import { readFileSync } from 'node:fs'
import { isFetchableSignatureUrl } from '../../api/_lib/signature.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

/* ---------- F-01 ---------- */
const vercel = JSON.parse(read('vercel.json'))
const all = (vercel.headers ?? []).find((h) => h.source === '/(.*)')
const h = Object.fromEntries((all?.headers ?? []).map((x) => [x.key, x.value]))
check('the app cannot be framed by another site', h['X-Frame-Options'], 'DENY')
check('...nor its files sniffed as another type', h['X-Content-Type-Options'], 'nosniff')
ok('...https is pinned', /max-age=\d{7,}/.test(h['Strict-Transport-Security'] ?? ''))
ok('...the referrer is trimmed', Boolean(h['Referrer-Policy']))
ok('...the camera and location are off', /camera=\(\)/.test(h['Permissions-Policy'] ?? '') && /geolocation=\(\)/.test(h['Permissions-Policy'] ?? ''))
ok('...but NOT the microphone: dictation uses it', !/microphone/.test(h['Permissions-Policy'] ?? ''))
ok('the CSP is report-only until its reports are read', Boolean(h['Content-Security-Policy-Report-Only']) && !h['Content-Security-Policy'])
ok('...and names frame-ancestors none', /frame-ancestors 'none'/.test(h['Content-Security-Policy-Report-Only'] ?? ''))
ok('the rewrites and crons were kept', vercel.rewrites?.length === 1 && vercel.crons?.length === 2)

/* ---------- C-04 ---------- */
const project = 'https://kvkajxpremantdkhmjvb.supabase.co'
for (const [url, want] of [
  [`${project}/storage/v1/object/public/email-signatures/u/sig.png`, true],
  ['https://qcvesjzoiznrvunjrqpv.supabase.co/storage/v1/object/public/email-signatures/x.png', true],
  ['http://kvkajxpremantdkhmjvb.supabase.co/x.png', false],
  ['https://169.254.169.254/latest/meta-data', false],
  ['https://localhost/x.png', false],
  ['https://10.0.0.5/x.png', false],
  ['https://evil.example.com/x.png', false],
  ['https://supabase.co.evil.example.com/x.png', false],
  ['https://user:pw@kvkajxpremantdkhmjvb.supabase.co/x.png', false],
  ['https://kvkajxpremantdkhmjvb.supabase.co:8443/x.png', false],
  ['file:///etc/passwd', false],
  ['not a url', false],
]) check(`signature fetch ${want ? 'allows' : 'refuses'} ${url}`, isFetchableSignatureUrl(url, project), want)
const sig = strip(read('api/_lib/signature.ts'))
ok('the fetch asks first', /if \(!isFetchableSignatureUrl\(url\)\) return null/.test(sig))
ok('...and refuses redirects', /redirect: 'error'/.test(sig))

/* ---------- C-01 ---------- */
const sync = strip(read('api/_lib/email/sync-all.ts'))
ok('an unset CRON_SECRET is not the cron', /const fromCron = !!cronSecret && req\.headers\.authorization === `Bearer \$\{cronSecret\}`/.test(sync))
ok('...the old open door is gone', !/!cronSecret \|\|/.test(sync))

/* ---------- E-03..05 ---------- */
const env = read('.env.example')
for (const k of ['EMAIL_CREDENTIALS_KEY', 'SMS_WEBHOOK_KEY', 'CONNECT_MOBILE_API_TOKEN', 'CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']) {
  ok(`.env.example names ${k}`, new RegExp(`^${k}=`, 'm').test(env))
}
ok('...and no secret wears VITE_', !/^VITE_[A-Z_]*(SECRET|KEY_SERVICE|SERVICE_ROLE|TOKEN)/m.test(env))

if (failures.length) {
  console.error(`check-security-audit: ${failures.length} failed, ${pass} passed\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log(`check-security-audit: ${pass} passed, 0 failed`)
