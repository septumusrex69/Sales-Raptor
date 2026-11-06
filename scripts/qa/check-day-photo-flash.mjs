/**
 * NO FLASH OF YESTERDAY'S PHOTOGRAPH (Raptor · Handover 17, S18).
 *
 * Stephan, 6 Nov: "the picture changes, but then for an instant it shows the old picture. And then it switches to
 * the new one." Llandudno was painted while today's approved look was still being asked for. Now: today's row is
 * remembered on the device and applied before the first paint, and until an answer is in the band is plain navy.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-day-photo-flash.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, v) => { if (v === true) pass += 1; else failures.push(name) }

const store = new Map()
globalThis.window = { localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } }
const st = await import('../../src/lib/dayLookState.ts')

ok('nothing is known before the answer', st.dayLookKnown() === false)
st.rememberDayRow('2026-11-06', { photo_id: 'x' })
ok('today\'s row is remembered for today', JSON.stringify(st.rememberedDayRow('2026-11-06')) === '{"row":{"photo_id":"x"}}')
ok('...and never read as tomorrow\'s', st.rememberedDayRow('2026-11-07') === null)
st.rememberDayRow('2026-11-06', null)
ok('a day with nothing approved is remembered as nothing, not as unknown', JSON.stringify(st.rememberedDayRow('2026-11-06')) === '{"row":null}')
globalThis.window = {}
ok('no storage: it simply asks', st.rememberedDayRow('2026-11-06') === null)

const themes = readFileSync(new URL('../../src/lib/themes.ts', import.meta.url), 'utf8')
const fn = themes.slice(themes.indexOf('export function applyDayPhoto('))
const guard = fn.indexOf('if (!dayLookKnown())')
ok('applyDayPhoto paints navy until the answer is in', guard > 0 && /setProperty\(v, 'none'\)/.test(fn.slice(guard, guard + 400)))
ok('...before it reads the look at all', guard > 0 && guard < fn.indexOf('const look = currentDayLook()'))

const ctx = readFileSync(new URL('../../src/store/ThemeContext.tsx', import.meta.url), 'utf8')
const init = ctx.indexOf('rememberedDayRow(')
ok('the remembered row is applied in the first render, before the skin', init > 0 && init < ctx.indexOf('applyTheme(saved)'))
ok('the answer is remembered when it comes', /if \(!error\) rememberDayRow\(day, data \?\? null\)/.test(ctx))
ok('no answer in time falls back to Llandudno', /setDayLook\(lookFromRow\(null\)\)/.test(ctx))

console.log(`${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1) }
