/**
 * What the browser downloads before it can show anything, and what a tab does when the server
 * has moved on.
 *
 * THE FIRM, on the deployed app: "when I try to load it again, there's always some issue. It's
 * slow to load ... I can't even open the app." Two separate faults, both here.
 *
 * SLOW: twenty-four screens were compiled into the first file the browser fetches, so opening
 * the login page downloaded the mail client, the diary, the letter editor and the charting
 * library. 1 697 kB, 462 kB over the wire.
 *
 * WILL NOT OPEN: the version watcher reloaded whenever the served bundle differed from the
 * running one, with nothing stopping it doing that again on the next pass. A reload loop is
 * invisible -- the page never lives long enough to draw a banner or an error -- and it does not
 * need a bug of ours to start: a deployment mid-rollout, a CDN node still holding the previous
 * index.html, or two builds behind one alias will each do it.
 */
import { readFileSync } from 'node:fs'
import { nextVersionAction } from '../../src/lib/versionCheck.ts'

let pass = 0
const failures = []
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)

/* ---------- 1. the reload loop ---------- */

const NEW = '/assets/index-NEW.js'
const OLD = '/assets/index-OLD.js'
const at = (over) => nextVersionAction({
  own: OLD, deployed: NEW, reloadedFor: null, safeToReload: true, ...over,
})

check('running the served bundle says nothing', at({ deployed: OLD }), 'none')
check('a bundle nobody could read says nothing', at({ deployed: null }), 'none')
check('a tab with no bundle of its own says nothing', at({ own: null }), 'none')
check('a new deploy reloads', at({}), 'reload')
/* Mid-task is the case the silent reload was always guarded against. */
check('...but not over somebody typing', at({ safeToReload: false }), 'banner')

/*
 * THE SECOND PASS, WHICH IS THE ONLY PASS WHERE THE BUG EXISTED. Having reloaded for this exact
 * bundle and come back still running the old one, reloading again does the same thing again.
 */
check('a tab that already reloaded for this bundle does not reload again',
  at({ reloadedFor: NEW }), 'banner')
/* And it is the BUNDLE that is remembered, not the fact of having reloaded: a genuinely newer
   deploy after a failed one must still get through. */
check('...but a different bundle still reloads',
  at({ reloadedFor: '/assets/index-OLDER.js' }), 'reload')

/* ---------- 2. what is in the first download ---------- */

const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/*
 * EVERY SCREEN IS FETCHED ON DEMAND, and the three that are not are named here rather than
 * counted, because "some are lazy" is what was true before and it was not enough. A new page
 * added with a plain import is the regression this catches, and it is invisible until somebody
 * on mobile data waits for it.
 */
const EAGER_BY_DESIGN = ['LoginPage', 'AppLayout', 'DashboardRouter', 'CollectorDashboard']
const pageImports = [...app.matchAll(/^import \{ (\w+) \} from '\.\/pages\/[^']+'$/gm)]
  .map((m) => m[1])
check('no screen beyond the ones you land on is in the first download',
  pageImports.filter((n) => !EAGER_BY_DESIGN.includes(n)), [])

/* PRESENCE BEFORE ABSENCE: a file with no lazy() at all satisfies the assertion above. */
const lazied = [...app.matchAll(/^const (\w+) = lazy\(/gm)].map((m) => m[1])
ok('...because they are lazy() instead', lazied.length >= 20)
for (const name of ['MailPage', 'AccountDetail', 'SettingsPage', 'ReportsPage', 'CollectorProfile']) {
  ok(`${name} is fetched on demand`, lazied.includes(name))
}
/*
 * THE CHARTING LIBRARY WAS DRAGGED IN BY CollectorProfile, NOT BY Reports. Reports had been
 * split for exactly this reason and it made no difference, because a second eagerly-imported
 * page imported recharts too. Assert on the importers rather than on the split.
 */
const chartPages = ['src/pages/reports/ReportsPage.tsx', 'src/pages/CollectorProfile.tsx',
  'src/components/dashboard/SalesTrendCard.tsx']
for (const path of chartPages) {
  const src = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
  if (!/from 'recharts'/.test(src)) continue
  const name = path.split('/').pop().replace('.tsx', '')
  ok(`${name} draws charts, so it is not in the first download`,
    lazied.includes(name) || !new RegExp(`^import \\{ ${name} \\}`, 'm').test(app))
}
/* A lazy route with no boundary throws instead of loading. */
ok('the routes sit inside a Suspense boundary', /<Suspense/.test(app))

/* ---------------------------------------------------------------- report */

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The first download is the login screen and the dashboard, not the whole app; every other screen
arrives when somebody asks for it. And a tab that reloads itself onto a new version will do that
once per version -- twice is a loop, and a loop is indistinguishable from an app that will not
open.`)
