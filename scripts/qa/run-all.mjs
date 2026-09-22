#!/usr/bin/env node
/**
 * Every check, in one command.
 *
 * There are three kinds here and they answer different questions:
 *
 *   check-*.mjs        the rules, as pure functions and as source read back. Fast, no browser,
 *                      no network. These are what stop the diary ladder, the in duplum ceiling
 *                      or the hand-out gates from drifting.
 *   e2e/*.mjs          the real app in a real browser, every request answered from fixtures.
 *                      These are what stop a panel from shipping invisible -- which happened
 *                      once this session, in a bundle that provably contained it.
 *
 * Two scripts take a file argument and are skipped here; they are tools, not checks.
 *
 * Run: npm run qa            (everything)
 *      npm run qa -- --fast  (skip the browser)
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const fast = process.argv.includes('--fast')
const dir = path.dirname(new URL(import.meta.url).pathname)

/* Tools rather than checks: both want a file to work on and fail loudly without one. */
const TAKES_AN_ARGUMENT = new Set(['check-debtors.mjs', 'check-readers.mjs'])

const unit = fs.readdirSync(dir)
  .filter((f) => f.startsWith('check-') && f.endsWith('.mjs') && !TAKES_AN_ARGUMENT.has(f))
  .sort()

const browser = fast ? [] : fs.existsSync(path.join(dir, 'e2e'))
  ? fs.readdirSync(path.join(dir, 'e2e'))
    .filter((f) => f.endsWith('.mjs') && !['harness.mjs', 'fixtures.mjs'].includes(f))
    .sort().map((f) => path.join('e2e', f))
  : []

let failed = 0
let checks = 0

for (const file of [...unit, ...browser]) {
  const isBrowser = file.startsWith('e2e')
  const args = isBrowser
    ? [path.join(dir, file)]
    : ['--import', path.join(dir, 'tsresolve.mjs'), path.join(dir, file)]
  try {
    const out = execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const n = /(\d+) passed, 0 failed/.exec(out)
    /*
     * A FILE THAT REPORTS NO COUNT IS A FAILURE, not a zero.
     *
     * It used to be counted as `n ? Number(n[1]) : 0` and printed as `ok`, which made a silent
     * file indistinguishable from a healthy one -- and a file that exits 0 having asserted
     * NOTHING (an early return, a loop over an empty list, a rewrite that dropped its own
     * summary) looked exactly the same. A review of this suite found eighteen files in that
     * state, roughly 800 assertion sites reported as nothing in the headline.
     *
     * The two in TAKES_AN_ARGUMENT are not run here at all, so they cannot be caught by this.
     */
    if (!n) {
      failed += 1
      console.log(`  FAIL ${file}`)
      console.log('       exited 0 but printed no "N passed, 0 failed" line, so it counted as')
      console.log('       nothing. A file that asserts nothing looks the same from here.')
      continue
    }
    checks += Number(n[1])
    console.log(`  ok   ${file}  (${n[1]})`)
  } catch (e) {
    failed += 1
    console.log(`  FAIL ${file}`)
    const text = `${e.stdout ?? ''}${e.stderr ?? ''}`
    console.log(text.split('\n').filter((l) => l.trim()).slice(-14).map((l) => `       ${l}`).join('\n'))
  }
}

console.log(failed === 0
  ? `\nAll green — ${checks.toLocaleString('en-ZA')} checks across ${unit.length + browser.length} files.`
  : `\n${failed} of ${unit.length + browser.length} files FAILED.`)
process.exit(failed === 0 ? 0 : 1)
