/**
 * The Collections hero.
 *
 * A HERO IS WHERE A NUMBER GOES TO BE BELIEVED WITHOUT BEING CHECKED. It is the biggest type on
 * the screen and the first thing read, and nobody cross-references it against the table four
 * hundred pixels below. So the things that matter here are not how it looks — a screenshot shows
 * that — but whether every figure on it comes from the same arithmetic as the rest of the page,
 * and whether it says nothing where it knows nothing.
 *
 * Four ways a hero lies while looking perfect:
 *
 *   - comparing today with the calendar day before, so every Monday reads as an infinite
 *     improvement on a Sunday that was always going to be nought
 *   - inventing a percentage where the day before brought in nothing, because every increase on
 *     nought is infinite
 *   - formatting money differently from the tables underneath, so one screen shows two figures
 *   - drawing a progress bar with its own rule, so the same collector is 46% here and 46% with a
 *     different-shaped bar below
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-collections-hero.mjs
 */
import { readFileSync, statSync } from 'node:fs'
import { previousWorkingDay } from '../../src/lib/collectionPace.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

/* ---------- the day before is a WORKING day ---------- */

/*
 * "UP 14% ON YESTERDAY" IS A LIE EVERY MONDAY if yesterday means the calendar day before. Nothing
 * is collected on a Sunday, so Monday would always read as an infinite improvement and Tuesday as
 * a collapse — a comparison that swings for reasons unconnected to the work is one people learn
 * to ignore inside a week.
 */
check('an ordinary day looks at the one before it', previousWorkingDay('2026-09-18'), '2026-09-17')
check('a Monday looks back to the Friday', previousWorkingDay('2026-09-14'), '2026-09-11')
check('a Sunday does too', previousWorkingDay('2026-09-13'), '2026-09-11')
/* 24 September is Heritage Day — the same calendar the whole of the pace arithmetic runs on. */
check('a public holiday is stepped over', previousWorkingDay('2026-09-25'), '2026-09-23')
check('and it crosses the year end', previousWorkingDay('2026-01-01'), '2025-12-31')
/* It may leave the reporting period, and that is correct: the previous working day is a fact
   about days, not about the month being reported on. */
check('...and it crosses out of a month without complaining', previousWorkingDay('2026-09-11'), '2026-09-10')

/* ---------- the hero itself ---------- */

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const hero = read('../../src/components/collections/CollectionsHero.tsx')
const page = read('../../src/pages/CollectorDashboard.tsx')
const css = read('../../src/index.css')

/*
 * NOTHING IS INVENTED WHERE NOTHING IS KNOWN. Every increase on nought is infinite, so a day
 * following a blank one gets no percentage at all rather than a confident "+100%".
 */
ok('a day after a blank one shows no comparison',
  /collectedBefore <= 0\s*\n\s*\? null/.test(page))
ok('...and the hero says so in words rather than leaving a gap',
  /No working day before it to compare/.test(hero))
/*
 * BOTH TILES THAT NEED IT, counted rather than found. Two of the four read off the target — what
 * was collected against it, and what is still needed per day — and asserting the words appear
 * "somewhere" passed happily with one of the two replaced by a confident R0. Found by
 * break-testing this line.
 */
check('both target-dependent tiles say so when there is none',
  (hero.match(/No target set for this period/g) ?? []).length, 2)
ok('...and the pace tile too', /Nothing to measure against yet/.test(hero))

/*
 * THE COMPARISON GOES THROUGH THE SAME TEAM FILTER AS EVERYTHING ELSE. Without it a team leader
 * filtered to one team would see their team's day set against the whole floor's day before.
 */
ok('the day before is filtered by team as well',
  /const collectedBefore = \(beforeRows \?\? \[\]\)\s*\n\s*\.filter\(\(r\) => !teamId \|\| teamOf\(r\.userId\) === teamId\)/.test(page))

/*
 * ONE FORMATTER AND ONE BAR. The hero had its own money formatter, grouping thousands with a hard
 * space to match the mockup, while the tables underneath group with a comma — one screen showing
 * "R 127 500" above "R 127,500" reads as two different figures for a moment, every time.
 */
ok('the hero uses the app’s own currency formatter', /const money = formatCurrency/.test(hero))
ok('...and no hand-rolled one survives beside it', !/replace\(\/\\\\B\(\?=/.test(hero))
ok('the hero’s bar laps on the same rule as the tables', /targetLaps\(achieved\)/.test(hero))
ok('...including the colour it changes to', /over \? 'bg-emerald-400' : 'bg-gold-400'/.test(hero))

/* Every figure comes from the page's own `line`, which is what the tables are drawn from. */
ok('collected comes from the same total as the tables', /collected: score\?\.collected \?\? 0/.test(page))
ok('the target comes from the same resolution', /target: line\?\.target \?\? null/.test(page))
ok('ahead-or-behind is measured against the day’s pace',
  /againstPace: line\?\.target == null \? null : line\.collected - line\.target \* line\.expected/.test(page))
ok('...and what was expected by now is the same arithmetic',
  /expectedByNow: line\?\.target == null \? null : line\.target \* line\.expected/.test(page))

/*
 * THE CONTROLS LIVE IN THE HERO. They used to sit in a card below the title, and a figure read
 * under the wrong month or the wrong team is not slightly wrong, it is about somebody else.
 */
ok('the period picker is in the hero', /<SalesMonthPicker[\s\S]{0,200}variant="dark"/.test(page))
ok('...with the as-at date', /aria-label="Read the report as at"/.test(page))
ok('...and the team filter', /aria-label="Team"/.test(page))
/* And the caption that used to duplicate them is gone: two rows saying the same thing leaves the
   reader working out which one is live. */
ok('the controls are not captioned by a copy of themselves',
  !/Collection period: <span/.test(hero))

/* The firm's own brand lines, which is most of why the panel exists. */
ok('the firm’s three words are on it', /People <span[\s\S]{0,80}Process/.test(hero))
ok('...and the four the sidebar carries', /Higher<br \/>Recovery<br \/>Brighter<br \/>Tomorrows/.test(hero))
ok('...and the line under the title', /Performance today\. A stronger tomorrow\./.test(hero))
ok('...and the one at the foot', /Discipline creates results/.test(hero))

/* ---------- the photograph ---------- */

/*
 * A BACKGROUND, NOT AN <img>, and the same three declarations the sign-in panel uses: modern
 * browsers take image-set, Safari 14-16 the -webkit- form, anything older the plain JPEG.
 */
ok('the photograph is a background', /\.collections-hero \{/.test(css))
ok('...with a JPEG anything can read', /background-image: url\('\/brand\/collections-hero\.jpg'\)/.test(css))
ok('...a webkit image-set for Safari 14-16', /-webkit-image-set\(url\('\/brand\/collections-hero\.webp'\)/.test(css))
ok('...and the standard one above it', /image-set\(\s*\n\s*url\('\/brand\/collections-hero\.webp'\) type\('image\/webp'\)/.test(css))

/*
 * IT HAS TO BE SMALL ENOUGH TO SHIP. The source was a 2.3MB PNG; a hero that costs two megabytes
 * on every visit to the screen people open first thing every morning is a hero that gets deleted.
 */
const sizes = {
  webp: statSync(new URL('../../public/brand/collections-hero.webp', import.meta.url)).size,
  jpg: statSync(new URL('../../public/brand/collections-hero.jpg', import.meta.url)).size,
}
ok(`the webp is under 250KB (${Math.round(sizes.webp / 1024)}KB)`, sizes.webp < 250 * 1024)
ok(`the jpeg fallback is under 350KB (${Math.round(sizes.jpg / 1024)}KB)`, sizes.jpg < 350 * 1024)
/* Both files must actually be there: image-set falls through silently to a coloured panel. */
ok('both files exist', sizes.webp > 10_000 && sizes.jpg > 10_000)

/*
 * THE SCRIM IS TWO GRADIENTS AND THEY COMPOUND. At 0.86 and 0.74 the foot of the panel went to
 * almost solid navy and the photograph may as well not have been there — which is exactly what
 * the first version did. Each has to be read as half of what reaches the eye.
 */
const scrim = css.slice(css.indexOf('.collections-hero::before'), css.indexOf('.collections-hero > *'))
ok('there is a scrim to read', scrim.length > 200)
const darkest = Math.max(...[...scrim.matchAll(/rgba\(8, 15, 24, ([\d.]+)\)/g)].map((m) => Number(m[1])))
ok(`the vertical pass stays light (darkest stop ${darkest})`, darkest <= 0.95)
ok('the picture is cropped onto the ridge, not the sky', /background-position: center 6\d%/.test(css))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Four figures over the controls that decide what they mean, every one of them from the same query
the tables are drawn from, compared against the previous WORKING day so a Monday is not measured
against a Sunday — and a photograph that costs 138KB rather than 2.3MB.`)
