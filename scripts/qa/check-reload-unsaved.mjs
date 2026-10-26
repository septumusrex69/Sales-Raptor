/**
 * A STAFF PAGE SOMEBODY HAS TYPED ON IS NEVER RELOADED UNDER THEM (Raptor H13).
 *
 * The new-version watcher reloaded silently whenever no modal was open and no box had focus. A form
 * on the page itself loses focus the moment the person taps anything else -- on the iPad the keyboard
 * dropping is enough -- so a deploy could reload a half-written note away. The signing pages were
 * exempted after two signers lost their work that way (check-sign-no-reload); this holds the same
 * rule for everybody else: typed on this page -> the banner, never the silent reload.
 *
 * Run: node scripts/qa/check-reload-unsaved.mjs
 */
import { readFileSync } from 'node:fs'
import { nextVersionAction, safeToReload } from '../../src/lib/versionCheck.ts'

let pass = 0
const failures = []
const ok = (name, v) => { if (v === true) pass += 1; else failures.push(name) }
const src = readFileSync(new URL('../../src/components/NewVersionWatcher.tsx', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const idle = { modalOpen: false, editing: false, typedOn: null, pathname: '/accounts/a1' }
ok('nothing typed, nothing open, nothing focused: safe', safeToReload(idle) === true)
ok('typed on this page, box no longer focused: NOT safe', safeToReload({ ...idle, typedOn: '/accounts/a1' }) === false)
ok('...typed on another page, then moved here: safe', safeToReload({ ...idle, typedOn: '/accounts/a2' }) === true)
ok('a modal open: not safe', safeToReload({ ...idle, modalOpen: true }) === false)
ok('a box focused: not safe', safeToReload({ ...idle, editing: true }) === false)
ok('typed here means the banner, never the reload', nextVersionAction({
  own: '/assets/a.js', deployed: '/assets/b.js', reloadedFor: null,
  safeToReload: safeToReload({ ...idle, typedOn: '/accounts/a1' }),
}) === 'banner')

ok('the watcher asks safeToReload', /safeToReload\(\{[\s\S]*?typedOn,[\s\S]*?pathname: window\.location\.pathname/.test(src))
ok('...and every input on the page reports to it, in the capture phase',
  /document\.addEventListener\('input', onInput, true\)/.test(src) && /function onInput\(\) \{ typedOn = window\.location\.pathname \}/.test(src))
ok('...and lets go of it on unmount', /document\.removeEventListener\('input', onInput, true\)/.test(src))

if (failures.length) {
  console.error(`check-reload-unsaved: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-reload-unsaved: ${pass} passed, 0 failed`)
