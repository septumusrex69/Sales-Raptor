/**
 * EMAIL OPENS IN THE READING PANE FOR EVERYBODY (S10, 23 Oct).
 *
 * The firm: "put it in default for every user ... the second pane." Holds: the default is
 * 'reading', and the key is the renamed one, so a 'list' left from before does not keep anybody
 * on the old layout.
 *
 * Run: node scripts/qa/check-email-view-default.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, v) => { if (v === true) pass += 1; else failures.push(name) }
const src = readFileSync(new URL('../../src/lib/emailView.ts', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const fn = src.slice(src.indexOf('export function storedEmailView'), src.indexOf('export function useEmailView'))

ok('the default is the reading pane', /return 'reading'\s*\}\s*$/.test(fn.trim() + '\n') || /\n\s*return 'reading'\n\}/.test(fn))
ok('...and never the list', !/return 'list'/.test(fn))
ok('the stored choice uses the new key', /const KEY = 'raptor\.email\.view\.v2'/.test(src))

if (failures.length) {
  console.error(`check-email-view-default: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-email-view-default: ${pass} passed, 0 failed`)
