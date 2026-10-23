/**
 * A SIGNING PAGE IS NEVER RELOADED UNDER THE SIGNER (S10, 23 Oct).
 *
 * Two signers lost everything they had filled in when they reached the initials: drawing on the pad
 * blurs the focused box, so the new-version watcher thought the page was idle and reloaded it while
 * a deploy went out. Holds: the watcher returns before checking on any /sign/ page, and before it
 * could show a banner or reload.
 *
 * Run: node scripts/qa/check-sign-no-reload.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, v) => { if (v === true) pass += 1; else failures.push(name) }
const src = readFileSync(new URL('../../src/components/NewVersionWatcher.tsx', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

ok('signing pages are held', /NEVER_RELOAD_UNDER = \[[^\]]*'\/sign\/'/.test(src))
const check = src.indexOf('async function check()')
const hold = src.indexOf('if (holdsReload(window.location.pathname)) return', check)
const fetchAt = src.indexOf('deployedBundleUrl()', check)
const reload = src.indexOf('window.location.reload()', check)
const banner = src.indexOf('setUpdateReady(true)', check)
ok('the check reads the hold', check >= 0 && hold > check)
ok('...before it fetches anything', hold >= 0 && fetchAt > hold)
ok('...before any banner', hold >= 0 && banner > hold)
ok('...before any reload', hold >= 0 && reload > hold)

if (failures.length) {
  console.error(`check-sign-no-reload: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-sign-no-reload: ${pass} passed, 0 failed`)
