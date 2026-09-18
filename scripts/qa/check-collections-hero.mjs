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
import { greetingFor, greetingLine } from '../../src/lib/greeting.ts'

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

/* The firm's own lines, which is most of why the panel exists. */
ok('the gold line under the headline is there', /Discipline drives results/.test(hero))
ok('...and the rail beside it', /Higher<br \/>Performance<br \/>Closer<br \/>Tomorrow/.test(hero))
ok('...and the one at the foot', /Built for a higher standard/.test(hero))

/*
 * THE HEADLINE IS THE FIRM'S LINE, AND IT IS ONE SENTENCE WITH NO HARD BREAK IN IT.
 *
 * The line this replaced was two sentences and was broken between them by hand, because the
 * shape it made was half the point. This is one, so a <br> anywhere inside it would be an
 * arbitrary break that only looks right at the window width somebody happened to be at.
 */
const title = hero.slice(hero.indexOf('<h1'), hero.indexOf('</h1>'))
ok('there is a heading to read', title.length > 40)
ok('the firm’s line is on it', /The sky is only the beginning\./.test(title))
ok('...unbroken', !/<br/.test(title))
/* And balanced, so the widths where it does wrap do not drop one word onto a line of its own. */
ok('...and balanced where it has to wrap', /text-balance/.test(title))

/*
 * AND IT DOES NOT NAME THE SCREEN. The panel carried "Collections" twice at one point — a gold
 * eyebrow and the heading right under it — and the design that replaced it carries the word
 * nowhere at all. That is only safe because the route is titled in the bar above it, which it
 * was NOT until this change: /performance was missing from AppLayout's table and the bar was
 * blank. So the two are asserted together; the hero alone would pass on a screen that names
 * itself nowhere. Comments are stripped before counting, because half this file's explanations
 * say "Collections" and a count over the raw source is a count of prose. `\b` on both ends keeps
 * the component's own name out of it — there is no word boundary inside `CollectionsHero`.
 */
const heroCode = hero.replace(/\/\*[\s\S]*?\*\//g, '')
check('the panel leaves the naming to the bar', (heroCode.match(/\bCollections\b/g) ?? []).length, 0)
ok('...and the bar has a title for the route',
  /\{ test: \/\^\\\/performance\/, title: 'Collections' \}/.test(read('../../src/components/layout/AppLayout.tsx')))
/* The specific route first, or a collector's own figures get the whole floor's title. */
const titles = read('../../src/components/layout/AppLayout.tsx')
ok('...with the collector’s own page titled before it',
  titles.indexOf("title: 'Collector'") > 0
  && titles.indexOf("title: 'Collector'") < titles.indexOf("title: 'Collections'"))

/*
 * THE GREETING IS RIGHT FOR THE TIME OF DAY. "Good morning" at four in the afternoon is the kind
 * of detail that tells a person the screen is not paying attention.
 */
check('eight in the morning', greetingFor(new Date('2026-09-18T08:00:00')), 'Good morning')
check('noon is already the afternoon', greetingFor(new Date('2026-09-18T12:00:00')), 'Good afternoon')
check('and five is the evening', greetingFor(new Date('2026-09-18T17:00:00')), 'Good evening')
check('the small hours are still the morning', greetingFor(new Date('2026-09-18T00:30:00')), 'Good morning')
/* First name only: a greeting that answers with a full name reads as a letter from a bank. */
check('the line uses the first name', greetingLine(new Date('2026-09-18T08:00:00'), 'Stephan Bredell'),
  'Good morning, Stephan')
/* And no dangling comma where the profile carries no name at all. */
check('...and greets nobody by name rather than nobody',
  greetingLine(new Date('2026-09-18T08:00:00'), ''), 'Good morning')
check('...including where it is null', greetingLine(new Date('2026-09-18T08:00:00'), null), 'Good morning')
ok('the hero renders it', /greetingLine\(new Date\(\), currentUser\?\.name\)/.test(hero))

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
ok('the whole valley is in frame', /background-position: center;/.test(css))

/*
 * AND THE TWO PASSES COMPOUND, which is the trap this has fallen into twice. At 0.86 across and
 * 0.74 down, neither of which looks extreme on its own, the foot of the panel reached 0.96 and
 * the photograph may as well not have been there. What matters is what reaches the eye, so the
 * darkest each pass gets is combined the way the browser combines them rather than read apart.
 */
const passes = scrim.split('linear-gradient').slice(1)
check('there are two passes over the picture', passes.length, 2)
const worst = passes.map((p) => Math.max(...[...p.matchAll(/rgba\(8, 15, 24, ([\d.]+)\)/g)].map((m) => Number(m[1]))))
const combined = 1 - worst.reduce((acc, a) => acc * (1 - a), 1)
ok(`together they leave the picture visible (${combined.toFixed(2)} at the worst corner)`, combined <= 0.9)
/* And the horizontal pass is the heavy one: the type is on the left, the mountain on the right. */
ok(`the heavy pass is the one across (${worst[0]} vs ${worst[1]})`, worst[0] > worst[1])

/*
 * IT IS A CARD, ROUNDED OFF THE SAME TOKEN AS EVERY OTHER HERO.
 *
 * It ran full bleed with square corners for a version — the panel had been called "bulky" and
 * edge-to-edge was the answer to that. It was the wrong answer, and the firm said so: a square
 * panel running into the sidebar beside eight rounded ones is the one screen somebody forgot to
 * finish. A hard-coded 18px would pass a check for "round" and still drift the day a skin moves
 * the token, so what is asserted is that this reads the SAME token .app-hero does.
 */
const panel = css.slice(css.indexOf('.collections-hero {'), css.indexOf('.collections-hero::before'))
ok('the panel is rounded off the shared token', /border-radius: var\(--skin-hero-radius\);/.test(panel))
ok('...the same one every other hero uses',
  /\.app-hero \{[\s\S]*?border-radius: var\(--skin-hero-radius\);/.test(css))
/* And it sits inside the page's padding rather than cancelling it. */
ok('...and it does not bleed past the page’s padding', !/collections-hero[^"]*-mx-6/.test(hero))

/*
 * THE FOUR FIGURES SIT ON ONE LINE.
 *
 * The labels above them are different lengths and one carries a date, so on any width where
 * "Collected this period" wraps and "Ahead of pace" does not, the four big figures land at four
 * different heights. The rendered proof is in the browser check next door, which measures them;
 * this asserts the mechanism, because a passing measurement at one window width says nothing
 * about the next.
 */
const tile = hero.slice(hero.indexOf('function Tile('))
ok('the label reserves its second line', /min-h-\[2\.2em\]/.test(tile))
/*
 * min-height, NOT height: a third line has to push the figure down rather than be cut in half.
 * `\b` is no good here — it sits happily between the `-` and the `h` of `min-h-`, so the first
 * version of this line reported the correct code as broken. Found by running it.
 */
ok('...as a minimum rather than a cap', !/[^-]h-\[2\.2em\]/.test(tile))

/*
 * THE CONTROLS LOSE THEIR BOXES BUT NOT THEIR AFFORDANCE. A control drawn as text is a control
 * nobody finds, so the skin that strips the chrome has to put it back on hover AND on keyboard
 * focus — the second is the one that gets forgotten, and forgetting it locks out the people
 * working the whole screen from the keyboard.
 */
const skin = css.slice(css.indexOf('.hero-controls select,'))
ok('the chrome comes off in a skin scoped to the hero', /\.hero-controls select/.test(skin))
ok('...and comes back on hover', /\.hero-controls select:hover/.test(skin))
ok('...and on keyboard focus', /\.hero-controls select:focus-visible/.test(skin))
ok('...for the date field too', /\.hero-controls input\[type='date'\]:focus-visible/.test(skin))
ok('the shared month picker is left alone',
  !/variant="bare"|variant="text"/.test(read('../../src/components/ui/SalesMonthPicker.tsx')))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Four figures over the controls that decide what they mean, every one of them from the same query
the tables are drawn from, compared against the previous WORKING day so a Monday is not measured
against a Sunday — and a photograph that costs a hundred-odd kilobytes rather than two megabytes.`)
