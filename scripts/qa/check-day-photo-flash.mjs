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
ok('...before it reads the look at all', guard > 0 && fn.indexOf('currentDayLook()') > 0 && guard < fn.indexOf('currentDayLook()'))

const ctx = readFileSync(new URL('../../src/store/ThemeContext.tsx', import.meta.url), 'utf8')
const init = ctx.indexOf('rememberedDayRow(')
ok('the remembered row is applied in the first render, before the skin', init > 0 && init < ctx.indexOf('applyTheme(saved)'))
ok('the answer is remembered when it comes', /if \(!error\) rememberDayRow\(day, data \?\? null\)/.test(ctx))
ok('no answer in time falls back to Llandudno', /setDayLook\(lookFromRow\(null\)\)/.test(ctx))

/*
 * S19 (Stephan, 8 Nov: "The pictures still keep hopping ... It would show yesterday's picture or something, and then
 * another one"): the PHOTOGRAPH, not only the answer. Llandudno was painted UNDER today's, and showed until Unsplash
 * answered; the dashboard and the bands asked for two sizes, so two downloads and two hops.
 */
{
  const load = await import('../../src/lib/dayPhotoLoad.ts')
  globalThis.window = { localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) } }
  const url = 'https://images.unsplash.com/photo-x?w=2400'
  ok('a photograph nobody has asked for has no state', load.photoState(url) === undefined)
  load.loadPhoto(url, () => {})
  ok('...asked for, it is loading (no browser here, so it stays so)', load.photoState(url) === 'loading')
  load.setPhotoStateForTest(url, null)
  store.set('raptor.dayPhotoLoaded', url)
  ok('one this device has seen arrive counts as there (the browser has it)', load.photoState(url) === 'loaded')
  ok('...but only that one', load.photoState('https://images.unsplash.com/photo-y?w=2400') === undefined)

  const body = fn.slice(0, fn.indexOf('\n}\n'))
  ok('applyDayPhoto paints navy while the photograph is still on its way', /stand === undefined \|\| stand === 'loading'/.test(body) && /'--skin-hero-background', '#12212f'/.test(body))
  ok('...and Llandudno is painted only when it FAILED', /stand === 'failed' \? LLANDUDNO_LOOK : today/.test(body))
  ok('no slot paints Llandudno underneath today\'s any more', !/portal-photo\.webp/.test(body) && /bandBackground\(look, DAY_PHOTO_WIDTH, false\)/.test(body))
  ok('one size for every slot, so one download', !/at\(3200\)/.test(body) && /const DAY_PHOTO_WIDTH = 2400/.test(themes))

  const hero = readFileSync(new URL('../../src/components/collections/CollectionsHero.tsx', import.meta.url), 'utf8')
  ok('the day\'s line keeps its room and shows nothing until today is known', /known \? '' : 'invisible'/.test(hero))
  ok('...and the credit waits too', /if \(!known\) return null/.test(hero))
}

console.log(`${pass} passed, ${failures.length} failed`)
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1) }
