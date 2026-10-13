/**
 * WHAT THE FIRM MAY DRAW IS NEVER BELOW NIL, AND WHAT WAITS IS NEVER MORE THAN IS HELD (prompt 12 B4).
 *
 * 11 Sep on staging: held R24 016.26, waiting R24 104.36, drawable -R88.10 -- bank charges since the
 * last drawing (R57.50 + R69.00 - R38.40 interest) taken from a share that was all still waiting.
 * The function is SQL; this models its last line exactly and holds the identity on the firm's numbers,
 * then holds schema.sql to that line.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-firm-drawable.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const r2 = (v) => Math.round(v * 100) / 100
/* The function's last line, as written. */
const split = (free, pend) => {
  const held = free + pend
  return { held: r2(held), drawable: r2(Math.max(free + Math.min(pend, 0), 0)), waiting: r2(Math.min(Math.max(pend, 0), Math.max(held, 0))) }
}
const day11 = split(-88.10, 24104.36)
check('the firm\'s 11 Sep: nothing may be drawn, not minus R88.10', day11.drawable, 0)
check('...and what waits is what is held', day11.waiting, 24016.26)
check('...so held is drawable + waiting', r2(day11.drawable + day11.waiting), day11.held)
const after = split(12543.05 - 88.10, 11473.21)
check('once the clients are paid, the charges come off what may be drawn', after.drawable, 12454.95)
check('a firm balance below nil draws nothing and waits on nothing', split(-500, 200), { held: -300, drawable: 0, waiting: 0 })
for (const [f, p] of [[100, 50], [-10, 50], [0, -20], [30, -40], [-5, 0]]) {
  const s = split(f, p)
  check(`never negative, never more than held (${f}, ${p})`, s.drawable >= 0 && s.waiting >= 0 && s.waiting <= Math.max(s.held, 0), true)
}
const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const fn = sql.slice(sql.lastIndexOf('create or replace function public.firm_trust_split('))
check('schema.sql caps what may be drawn at nil', /round\(greatest\(free \+ least\(pend, 0\), 0\), 2\)/.test(fn), true)
check('...and what waits at what is held', /round\(least\(greatest\(pend, 0\), greatest\(held, 0\)\), 2\)/.test(fn), true)

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-firm-drawable: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
