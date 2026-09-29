/**
 * EVERY COLOUR CLASS MUST NAME A COLOUR THAT EXISTS.
 *
 * A Tailwind utility naming a token nobody defined COMPILES TO NOTHING. No warning at build, no
 * error in the console, no class in the stylesheet -- the element simply has no rule for that
 * property. Most of the time that is a tint that does not tint or a border that is not there, and
 * nobody notices for months.
 *
 * ONCE IT WAS A BUTTON. `bg-rust-600 text-white` on the confirm inside "Reverse this payment" drew
 * white text on the modal's own white, so the firm saw a box with a Cancel in it and reported,
 * reasonably, that a payment cannot be reversed. The button was there the whole time and they were
 * pressing past it. There was a second, on the Library.
 *
 * `rust` WAS NEVER A TAILWIND FAMILY AT ALL. It exists in index.css as --c-rust, a skin token read
 * with var(); somebody wrote Tailwind classes for it and ninety-odd utilities across the app --
 * brand-300, gold-200, navy-50, negative-600 -- were naming shades of real families that had never
 * been defined either. All of them now are, and this holds them.
 *
 * WHAT THIS CANNOT DO is tell you a colour is ugly or wrong. It checks that the class resolves,
 * which is the failure that is invisible; the rest is visible the moment anybody looks.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-colour-tokens.mjs
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
const at = (p) => new URL(`../../${p}`, import.meta.url).pathname

/* ---------------- what the theme defines ---------------- */

const css = readFileSync(at('src/index.css'), 'utf8')
const themeAt = css.indexOf('@theme {')
ok('the theme block is where it was', themeAt >= 0)
const theme = css.slice(themeAt, css.indexOf('\n}', themeAt))
const defined = new Set([...theme.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]))
/* A PARSE THAT FOUND NOTHING WOULD PASS EVERYTHING BELOW. */
ok('...and it defines a palette rather than parsing to nothing', defined.size > 25)
const families = new Set([...defined].map((d) => d.split('-')[0]))
ok('the firm’s own families are all there',
  ['brand', 'gold', 'navy', 'negative', 'positive'].every((f) => families.has(f)))

/*
 * Tailwind's own palette, which needs no definition. Written out rather than inferred, because the
 * whole point is to tell a name Tailwind ships from a name somebody invented.
 */
const TAILWIND = new Set(['slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber',
  'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet',
  'purple', 'fuchsia', 'pink', 'rose'])

/* ---------------- what the app asks for ---------------- */

/* Two digits at least: `border-b-2` and `outline-offset-2` are widths, not colours. */
const USES = /\b(?:[a-z-]+:)*(bg|text|border|ring|from|to|via|fill|stroke|decoration|outline|accent|caret|divide|placeholder)-([a-z]+)-(\d{2,3})\b/g

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { yield* sources(p); continue }
    if (p.endsWith('.tsx') || p.endsWith('.ts')) yield p
  }
}

const unresolved = []
const invisible = []
let seen = 0
for (const file of sources(at('src'))) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const m of line.matchAll(USES)) {
      seen += 1
      const [cls, prop, family, shade] = [m[0], m[1], m[2], m[3]]
      if (TAILWIND.has(family) || defined.has(`${family}-${shade}`)) continue
      const where = `${file.replace(/^.*\/src\//, 'src/')}:${i + 1} ${cls}`
      unresolved.push(where)
      /*
       * THE ONES THAT ARE NOT MERELY UNDRAWN. A background that resolves to nothing, under text
       * the page has painted white, is a control nobody can see -- which is how this check came
       * to exist.
       */
      if (prop === 'bg' && /text-white/.test(line)) invisible.push(where)
    }
  })
}

/* AND THE WALK FOUND THE APP, not an empty directory. */
ok('the app was actually read', seen > 800)

check('every colour class names a colour that exists', unresolved, [])
/* Said separately, because this is the one that reaches the firm: a button they cannot see. */
check('...and no control is white text on a background that is not there', invisible, [])

/*
 * `rust` BY NAME. It is a skin token read with var(--c-rust), never a Tailwind family, and the
 * classes that spelled it are the reason a payment could not be reversed. Held on its own so the
 * message says which mistake it was rather than "some colour somewhere".
 */
const rust = []
for (const file of sources(at('src'))) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (/\b(?:[a-z-]+:)*(?:bg|text|border|ring|fill|stroke|from|to|via)-rust-\d/.test(line)) {
      rust.push(`${file.replace(/^.*\/src\//, 'src/')}:${i + 1}`)
    }
  })
}
check('rust is a skin token, not a Tailwind family', rust, [])
/* The colour itself is still there and still used -- this is about how it is spelled. */
ok('...and the colour it meant is still defined', /--c-rust: #/.test(css))
ok('...under the family that always held it', defined.has('negative-600'))

console.log(`\ncheck-colour-tokens: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
