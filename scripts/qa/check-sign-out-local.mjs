/**
 * SIGNING OUT ENDS THIS BROWSER'S SESSION, NEVER EVERY SESSION (S10, 21 Oct).
 *
 * supabase.auth.signOut() with no argument is GLOBAL: it revokes every session the person has.
 * An Administrator signing in on a new device was emailed a code, and before they typed it the
 * idle timer in tabs left open on their old Mac signed out -- globally -- and took the new
 * device's session with it. The check then failed "Invalid or expired session", which read as an
 * expired code. Holds:
 *   1. every signOut call in src/ names scope 'local';
 *   2. the code screen turns a 401 into "you were signed out", not a word about the code.
 *
 * Run: node scripts/qa/check-sign-out-local.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0
const failures = []
const ok = (name, v) => { if (v === true) pass += 1; else failures.push(name) }
const root = new URL('../../', import.meta.url).pathname
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const files = []
const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) && files.push(p) })
walk(join(root, 'src'))

const calls = files.flatMap((f) => [...strip(readFileSync(f, 'utf8')).matchAll(/auth\.signOut\(([^)]*)\)/g)].map((m) => ({ f: f.slice(root.length), arg: m[1] })))
ok('there is a sign-out to hold (sanity)', calls.length > 0)
const globalOnes = calls.filter((c) => !/scope:\s*'local'/.test(c.arg)).map((c) => c.f)
ok(`every sign-out is local${globalOnes.length ? ` (global in ${globalOnes.join(', ')})` : ''}`, globalOnes.length === 0)

const code = strip(readFileSync(join(root, 'src/components/auth/AdminDeviceCode.tsx'), 'utf8'))
ok('the code screen reads a 401 as signed out', /if \(res\.status === 401\) return \{ ok: false, body: \{ error: SIGNED_OUT \} \}/.test(code))
ok('...and that says so, without mentioning expiry', /const SIGNED_OUT = 'You were signed out[^']*'/.test(code) && !/const SIGNED_OUT = '[^']*expired/.test(code))

if (failures.length) {
  console.error(`check-sign-out-local: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-sign-out-local: ${pass} passed, 0 failed`)
