/**
 * Every check this repo has, in one command, with one answer at the end.
 *
 *   npm test
 *
 * There were twenty-odd check scripts and nothing that ran them all, so in practice the one that
 * mattered was the one nobody remembered to run. This runs:
 *
 *   1. every scripts/qa/check-*.mjs that needs no input file (the money, dates, calls, SMS ...)
 *   2. the linter
 *   3. the typecheck + production build -- the same thing Vercel does before it deploys
 *
 * It does NOT open a browser. That is scripts/qa/smoke.mjs (`npm run test:smoke`), which needs a
 * login and a dev server and so cannot run everywhere this can.
 *
 * Exit code is 0 only if everything passed, so CI can gate on it.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const QA = path.join(ROOT, 'scripts/qa')

/*
 * Checks that read a real export the person passes on the command line. They are tools for
 * looking at a file, not tests, and with no argument they print usage and exit 2. Detected from
 * the file itself rather than listed by name, so a new one of these does not need this edited.
 */
const needsInput = (file) => /process\.argv(\.slice\(2\)|\[2\])/.test(readFileSync(file, 'utf8'))

const steps = []
for (const name of readdirSync(QA).filter((f) => /^check-.*\.mjs$/.test(f)).sort()) {
  const file = path.join(QA, name)
  if (needsInput(file)) continue
  steps.push({
    label: name.replace(/^check-|\.mjs$/g, ''),
    cmd: process.execPath,
    args: ['--experimental-strip-types', '--no-warnings', '--import', './scripts/qa/tsresolve.mjs', file],
  })
}
steps.push({ label: 'lint', cmd: 'npm', args: ['run', '--silent', 'lint'] })
if (!process.argv.includes('--no-build')) {
  steps.push({ label: 'typecheck + build', cmd: 'npm', args: ['run', '--silent', 'build'] })
}

const verbose = process.argv.includes('--verbose')
const failed = []
const started = Date.now()
for (const s of steps) {
  const t = Date.now()
  const r = spawnSync(s.cmd, s.args, { cwd: ROOT, encoding: 'utf8' })
  const ok = r.status === 0
  const ms = Date.now() - t
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.label.padEnd(22)} ${String(ms).padStart(6)}ms`)
  if (!ok || verbose) {
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
    // The failing lines are what matter; a passing check's 50 PASS lines are noise.
    const shown = ok ? out : out.split('\n').filter((l) => !/^PASS\b/.test(l)).slice(-40).join('\n')
    if (shown) console.log(shown.replace(/^/gm, '      '))
  }
  if (!ok) failed.push(s.label)
}

console.log(`\n${steps.length - failed.length}/${steps.length} passed in ${((Date.now() - started) / 1000).toFixed(1)}s`)
if (failed.length) console.log(`FAILED: ${failed.join(', ')}`)
process.exit(failed.length ? 1 : 0)
