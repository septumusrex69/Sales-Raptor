/**
 * EVERY LONG LIST IS ONE SIZE, SET IN ONE PLACE (the firm, 10 Oct, of the accounts and clients lists:
 * "make these views a little bit bigger, the lines between them a little bit bigger").
 *
 * Held: no list table carries its own 12.5px any more -- each wears `list-table` -- and the size and
 * the row height are the one rule in index.css, unlayered so a cell's own py-1.5 cannot undo it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-list-size.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const root = new URL('../../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const walk = (dir) => readdirSync(new URL(dir, root)).flatMap((n) => {
  const p = join(dir, n)
  return statSync(new URL(p, root)).isDirectory() ? walk(p) : n.endsWith('.tsx') ? [p] : []
})
const files = walk('src')
const tables = files.flatMap((f) => (read(f).match(/<table[^>]*>/g) ?? []).map((t) => ({ f, t })))
check('no list table sets its own small size', tables.filter(({ t }) => /text-\[12\.5px\]/.test(t)).map(({ f }) => f), [])
ok(`the long lists wear list-table (${tables.filter(({ t }) => /list-table/.test(t)).length})`,
  tables.filter(({ t }) => /list-table/.test(t)).length >= 60)
const css = read('src/index.css')
const at = css.lastIndexOf('.list-table {')
ok('the size is set once', at > 0 && /\.list-table \{\s+font-size: 13\.5px;\s+\}/.test(css.slice(at)))
ok('...and the row height', /\.list-table th,\s+\.list-table td \{\s+padding-top: 0\.6rem;\s+padding-bottom: 0\.6rem;\s+\}/.test(css.slice(at)))
const layerEnd = css.lastIndexOf('@layer')
ok('...outside any cascade layer, so a cell utility cannot undo it',
  at > layerEnd && !/@layer[^{]*\{[^}]*$/.test(css.slice(0, at).replace(/\{[^{}]*\}/g, '')))

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-list-size: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
