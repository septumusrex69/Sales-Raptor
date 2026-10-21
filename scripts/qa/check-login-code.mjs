/**
 * AN ADMINISTRATOR'S LOGIN CODE ON A NEW DEVICE (S10, 21 Oct).
 *
 * The firm agreed to a code by email after removing the authenticator-app version ("I don't want
 * to scan anything"). This holds:
 *   - the rules, as the pure functions in src/lib/loginCode.ts: who is asked, the code's shape,
 *     the resend throttle, the order a typed code is judged in, which mailbox sends it, the email;
 *   - the server (api/_lib/email/loginCode.ts): the code is random, kept only as an HMAC, single
 *     use, its tries counted before the answer, and never returned or logged;
 *   - the database (the LAST definitions in schema.sql): the browser writes none of the three
 *     tables, and the device id is hashed in the database, not handed in hashed;
 *   - the app: RequireAuth puts the gate round everything, holds while the role is unknown, and
 *     fails closed;
 *   - and that no authenticator app came back.
 *
 * Run: node scripts/qa/check-login-code.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import {
  CODE_CHECK_MESSAGE, CODE_TTL_MINUTES, MAX_ATTEMPTS, MAX_SENDS_PER_HOUR, RESEND_SECONDS, WAIVER_MINUTES,
  codeCheck, codeSenderOrder, deviceLabel, isDeviceId, loginCodeEmail, maskEmail, needsDeviceCode,
  normaliseCode, resendDecision,
} from '../../src/lib/loginCode.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
/* Comments out first: a note saying what must never be written would otherwise count as it. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
const stripSql = (s) => s.replace(/--.*$/gm, ' ')

/* ---------- who is asked ---------- */
ok('an Administrator is asked for a code', needsDeviceCode('Administrator'))
for (const role of ['Sales Manager', 'Pre-legal Agent', 'Liaison', 'Communications', '', null, undefined]) {
  ok(`...and nobody else is (${JSON.stringify(role)})`, needsDeviceCode(role) === false)
}

/* ---------- the code and the device id ---------- */
check('six digits are the code', normaliseCode('123456'), '123456')
check('...pasted with a space out of the mail app', normaliseCode('123 456'), '123456')
check('...or read aloud with a dash', normaliseCode('123-456'), '123456')
check('...a leading zero survives', normaliseCode('012345'), '012345')
for (const bad of ['12345', '1234567', '12a456', '', null, 123456]) check(`...and ${JSON.stringify(bad)} is not a code`, normaliseCode(bad), null)
ok('a device id is 64 lower-case hex', isDeviceId('a'.repeat(64)))
for (const bad of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), '', null]) ok(`...and ${JSON.stringify(bad)} is not`, isDeviceId(bad) === false)

/* ---------- the limits are the ones agreed ---------- */
check('a code lasts ten minutes', CODE_TTL_MINUTES, 10)
check('...five tries', MAX_ATTEMPTS, 5)
check('...a minute between sends', RESEND_SECONDS, 60)
check('...five sends an hour', MAX_SENDS_PER_HOUR, 5)

/* ---------- the resend throttle ---------- */
const T = Date.parse('2026-10-21T08:00:00Z')
const iso = (ms) => new Date(ms).toISOString()
check('the first code goes, opening a window', resendDecision(null, T), { ok: true, windowStartedAt: iso(T), sendsInWindow: 1 })
const recent = resendDecision({ sentAt: iso(T - 30_000), windowStartedAt: iso(T - 30_000), sendsInWindow: 1 }, T)
ok('a second inside a minute is refused', recent.ok === false)
check('...saying how long to wait', recent.ok ? null : recent.waitSeconds, 30)
check('after a minute another goes, counted in the same window',
  resendDecision({ sentAt: iso(T - 61_000), windowStartedAt: iso(T - 600_000), sendsInWindow: 2 }, T),
  { ok: true, windowStartedAt: iso(T - 600_000), sendsInWindow: 3 })
const full = resendDecision({ sentAt: iso(T - 120_000), windowStartedAt: iso(T - 1_200_000), sendsInWindow: 5 }, T)
ok('the sixth in an hour is refused', full.ok === false)
ok('...and points at the way out', !full.ok && /another Administrator/.test(full.reason))
check('an hour on, the window starts again',
  resendDecision({ sentAt: iso(T - 120_000), windowStartedAt: iso(T - 3_600_000), sendsInWindow: 5 }, T),
  { ok: true, windowStartedAt: iso(T), sendsInWindow: 1 })

/* ---------- judging a typed code, in order ---------- */
const H = 'b'.repeat(64)
const live = { deviceHash: H, expiresAt: iso(T + 60_000), attempts: 0 }
check('no code waiting', codeCheck(null, H, T), 'none')
check('a code sent for another browser is refused first', codeCheck({ ...live, expiresAt: iso(T - 1), attempts: 9 }, 'c'.repeat(64), T), 'other-device')
check('an expired code says so', codeCheck({ ...live, expiresAt: iso(T) }, H, T), 'expired')
check('five wrong tries spends it', codeCheck({ ...live, attempts: MAX_ATTEMPTS }, H, T), 'used-up')
check('...four does not', codeCheck({ ...live, attempts: MAX_ATTEMPTS - 1 }, H, T), 'compare')
for (const k of ['none', 'other-device', 'expired', 'used-up']) ok(`"${k}" tells the person what to press`, /Send a new code/.test(CODE_CHECK_MESSAGE[k]))

/* ---------- which mailbox sends it ---------- */
const admins = [
  { id: 'stephan', name: 'Stephan', hasMailbox: true, active: true },
  { id: 'camille', name: 'Camille', hasMailbox: true, active: true },
  { id: 'barry', name: 'Barry Joubert', hasMailbox: false, active: true },
  { id: 'gone', name: 'Aaron Left', hasMailbox: true, active: false },
]
check('your own mailbox first, then the others by name', codeSenderOrder('stephan', admins), ['stephan', 'camille'])
check('Barry has none, so his comes from a colleague\'s', codeSenderOrder('barry', admins), ['camille', 'stephan'])
check('nobody with a mailbox: nothing to send from', codeSenderOrder('barry', [admins[2]]), [])

/* ---------- the email ---------- */
const mail = loginCodeEmail({ name: 'Smit & Seun <x>', code: '042917', device: 'Safari on iPad' })
ok('the email carries the code', mail.text.includes('042917') && mail.html.includes('042917'))
ok('...but NOT in the subject, which a lock screen shows', !mail.subject.includes('042917'))
ok('...says it expires in ten minutes', /expires in 10 minutes/.test(mail.text))
ok('...says who to tell, in the firm\'s words', /If this was not you, tell Stephan/.test(mail.text))
ok('...is from the firm', /Bredell Ferreira/.test(mail.text))
ok('...and escapes what it merges', mail.html.includes('Smit') && !mail.html.includes('<x>') && !/& Seun/.test(mail.html))
check('an iPad is named as one', deviceLabel('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari on iPad')
check('...and so is iPadOS dressed as a Mac', deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari on iPad')
check('the address is shown masked', maskEmail('stephan@bredellferreira.co.za'), 'st••••@bredellferreira.co.za')

/* ---------- the server ---------- */
const server = strip(read('api/_lib/email/loginCode.ts'))
ok('the route is dispatched', /'login-code':\s*loginCode/.test(strip(read('api/email/[action].ts'))))
ok('...and is not a new function under api/', !readdirSync(new URL('../../api/', import.meta.url)).some((f) => /login/i.test(f)))
ok('the session is verified before anything', server.indexOf('requireCaller(req, admin)') > 0 && server.indexOf('requireCaller(req, admin)') < server.indexOf("from('login_codes')"))
ok('the code is made with crypto.randomInt', /crypto\.randomInt\(0, 1_000_000\)/.test(server))
ok('...kept only as a keyed hash', /code_hash:\s*keyedHash\('login-code'/.test(server) && !/code_hash:\s*code\b/.test(server))
ok('...compared in constant time', /sameHex\(keyedHash\('login-code'/.test(server))
const countAt = server.indexOf('update({ attempts: attempts + 1 })')
const compareAt = server.indexOf('sameHex(')
ok('a try is counted BEFORE the answer', countAt > 0 && compareAt > 0 && countAt < compareAt)
ok('...and only by whoever read that count', /\.eq\('attempts', attempts\)/.test(server))
const spentAt = server.indexOf("from('login_codes').delete().eq('user_id', userId)")
ok('a code that works is spent before the device is trusted', spentAt > compareAt && spentAt < server.lastIndexOf('await trust()'))
/* NEVER RETURNED, NEVER LOGGED. Every json({...}) and console line, read for the identifier. */
/* Each reply runs to the end of its line. An interpolated ${code} is looked for first, because
   stripping the string literals (so the word "code" in a sentence does not count) would also
   strip an interpolation inside one. */
const replies = server.split('\n').filter((l) => l.includes('.json(')).map((l) => l.slice(l.indexOf('.json(')))
ok('the server answers in several places', replies.length >= 8)
ok('...and no answer carries the code', replies.every((r) =>
  !/\$\{code\}/.test(r) && !/\bcode\b/.test(r.replace(/'[^']*'|`[^`]*`/g, ''))))
const logs = server.match(/console\.\w+\([^\n]*/g) ?? []
ok('...and no log line does either', logs.length > 0 && logs.every((l) => !/\$\{code\}|\bcode\b[,)]/.test(l)))
ok('the device id is stored as its sha256', /createHash\('sha256'\)\.update\(body\.deviceId, 'utf8'\)\.digest\('hex'\)/.test(server))
ok('the way out is spent before the throttle', server.indexOf("from('login_code_waivers')") > 0 && server.indexOf("from('login_code_waivers')") < server.indexOf('resendDecision('))
ok('a failed send expires the code it stored', /update\(\{ expires_at: nowIso \}\)/.test(server))
ok('the sender order is the rule above', /codeSenderOrder\(me\.id,/.test(server))

/* ---------- the database: the LAST definitions ---------- */
const schema = read('supabase/schema.sql')
const lastFn = (name) => {
  const at = schema.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const end = schema.indexOf('\n$$;', at)
  return end < 0 ? '' : stripSql(schema.slice(at, end))
}
const seen = lastFn('trusted_device_seen')
ok('trusted_device_seen exists', seen.length > 0)
ok('...takes the device id and hashes it itself', /device_hash = encode\(sha256\(convert_to\(p_device_id, 'UTF8'\)\), 'hex'\)/.test(seen))
ok('...and answers only about the caller', /user_id = auth\.uid\(\)/.test(seen))
const remove = lastFn('trusted_devices_remove')
ok('removing somebody else\'s device takes an Administrator', /p_user_id is distinct from auth\.uid\(\)[\s\S]*current_user_role\(\) is distinct from 'Administrator'[\s\S]*raise exception/.test(remove))
const waive = lastFn('login_code_waive')
ok('letting somebody in without a code takes an Administrator', /current_user_role\(\) is distinct from 'Administrator' then\s*raise exception/.test(waive))
ok('...never for yourself', /p_user_id = auth\.uid\(\) then\s*raise exception/.test(waive))
ok(`...and lasts ${WAIVER_MINUTES} minutes, as the screen says`, waive.includes(`interval '${WAIVER_MINUTES} minutes'`))
const tail = stripSql(schema.slice(schema.lastIndexOf('create table if not exists public.trusted_devices')))
for (const t of ['trusted_devices', 'login_codes', 'login_code_waivers']) {
  ok(`${t} has row level security`, new RegExp(`alter table public\\.${t} enable row level security`).test(tail))
  ok(`...and nobody but the server writes it`, !new RegExp(`create policy \\w+ on public\\.${t}\\s+for (insert|update|delete|all)`).test(tail))
  ok(`...and anon and the browser lose every grant`, new RegExp(`revoke all on public\\.${t} from public, anon, authenticated`).test(tail))
}
ok('only trusted_devices is readable, and only by select', /grant select on public\.trusted_devices to authenticated/.test(tail) && !/grant \w+[^;]*on public\.login_codes/.test(tail))
for (const f of ['trusted_device_seen(text)', 'trusted_devices_remove(uuid, uuid)', 'login_code_waive(uuid)']) {
  ok(`${f} is revoked from public and anon`, tail.includes(`revoke all on function public.${f} from public, anon;`))
}

/* ---------- the app ---------- */
const requireAuth = strip(read('src/components/auth/RequireAuth.tsx'))
ok('RequireAuth puts the gate round the whole app', /<AdminDeviceCode[\s\S]*\{children\}[\s\S]*<\/AdminDeviceCode>/.test(requireAuth))
const gate = strip(read('src/components/auth/AdminDeviceCode.tsx'))
ok('the gate holds while the role is unknown', /if \(!userId\)\s*\{\s*return <div/.test(gate))
ok('...asks the database with the raw device id', /rpc\('trusted_device_seen', \{ p_device_id: deviceId\(\) \}\)/.test(gate))
ok('...and fails closed: only a plain true lets it through', /if \(!rpcError && data === true\) letIn\(\)\s*else setState\('code'\)/.test(gate))
ok('...and says what to do if the mail does not come', /another\s+Administrator to let you in from Settings → Users/.test(read('src/components/auth/AdminDeviceCode.tsx')))
const deviceIdSrc = strip(read('src/lib/deviceId.ts'))
ok('the device id comes from crypto.getRandomValues', /crypto\.getRandomValues/.test(deviceIdSrc))
ok('...and every storage touch is wrapped', (deviceIdSrc.match(/try \{[^}]*localStorage/g) ?? []).length === 2)
ok('Settings offers the devices on an Administrator\'s row', /needsDeviceCode\(u\.role\) && \(\s*<button onClick=\{\(\) => setDeviceUser\(u\)\}/.test(strip(read('src/pages/settings/SettingsPage.tsx'))))
ok('...and the way out only for somebody else', /\{!isSelf && \(/.test(strip(read('src/components/settings/TrustedDevices.tsx'))))
ok('the e2e browser is a known device by default', /\/rpc\/trusted_device_seen[\s\S]{0,200}body: 'true'/.test(read('scripts/qa/e2e/harness.mjs')))

/* ---------- and no authenticator app came back ---------- */
const appSource = [requireAuth, gate, strip(read('src/store/AuthContext.tsx')), strip(read('api/_lib/auth.ts')), server].join('\n')
ok('no authenticator app: no TOTP, no MFA enrolment, no aal2', !/totp|mfa\.|enroll|aal2|qrcode/i.test(appSource))

console.log(failures.length ? `\n${failures.length} FAILED:\n\n  ✗ ${failures.join('\n\n  ✗ ')}\n` : '')
console.log(`check-login-code: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
