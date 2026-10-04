/**
 * THE SKINS, AND THE FOUR PLACES A SKIN HAS TO BE REGISTERED IN BEFORE IT WORKS.
 *
 * A skin is cosmetic, which is exactly why it rots quietly: nothing fails, a screen just comes
 * out half-dressed. The four places are themes.ts, the stylesheet, index.css's import list and
 * the pre-paint script in index.html, and three of them are easy to forget:
 *
 *   THE PRE-PAINT SCRIPT IS A DUPLICATE ON PURPOSE. A module import cannot run before the first
 *   paint, so index.html repeats the storage key, the ids and the default by hand. Its own
 *   comment says to keep them in step; this is what makes that more than a hope. Forget a new id
 *   there and every load of that skin renders the baseline and then snaps to it.
 *
 *   THE IMPORT IS WHAT MAKES THE FILE EXIST. A [data-theme] block in a stylesheet nothing imports
 *   is a file that passes every review and changes nothing on the screen.
 *
 *   AND A SKIN HAS TO REDEFINE WHAT THE OTHERS REDEFINE. A token one skin overrides and another
 *   does not is a widget that keeps the previous skin's colour -- the half-dressed screen, and
 *   the hardest of these to see, because it is right on the screen somebody happens to open.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-themes.mjs
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { BASE_THEME, DEFAULT_THEME, THEMES, themeById } from '../../src/lib/themes.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const themesLib = read('src/lib/themes.ts')
const indexCss = read('src/index.css')
const html = read('index.html')

/* ------------------------------------------------ the register */

/* THE UNION AND THE LIST ARE THE SAME SET. An id in the type with no entry is a skin the picker
   never offers; an entry with no id does not compile, which is the easy half. */
const union = (themesLib.match(/export type ThemeId =([^\n]+)/)?.[1] ?? '')
  .split('|').map((s) => s.trim().replace(/'/g, '')).filter(Boolean)
check('every id in the type is a skin in the list',
  union.filter((id) => !THEMES.some((t) => t.id === id)), [])
check('...and every skin is in the type',
  THEMES.filter((t) => !union.includes(t.id)).map((t) => t.id), [])
ok('there is more than one skin to choose between', THEMES.length > 1)

/* THE DEFAULT AND THE BASE ARE BOTH REAL SKINS. The base is the one the stylesheet renders with
   no attribute set, and it has no [data-theme] block by definition -- see applyTheme. */
ok('the default is a skin that exists', THEMES.some((t) => t.id === DEFAULT_THEME))
ok('the base is a skin that exists', THEMES.some((t) => t.id === BASE_THEME))
check('an unknown id falls back rather than returning nothing',
  themeById('no-such-skin').id, THEMES[0].id)

/* ------------------------------------------------ the stylesheet, for each skin */

/*
 * Every skin but the base brings a file, that file is imported, and its rules are qualified the
 * way the cascade requires.
 *
 * THE FILENAME IS THE ID, BY CONVENTION, and derived rather than listed. A hand-kept map is one
 * more place to register a skin -- which is the whole failure this file exists to catch, and it
 * caught it on itself: a third skin landed from another session and the map did not know about it,
 * so the assertions about that skin passed by not running.
 */
const skinFile = (id) => `src/styles/${id}.css`
const SKINS = THEMES.filter((t) => t.id !== BASE_THEME).map((t) => t.id)

for (const theme of THEMES) {
  if (theme.id === BASE_THEME) {
    /* THE BASE STAMPS NOTHING, so a [data-theme='original'] block would never match. */
    ok(`${theme.id}: the base skin has no block of its own`,
      !new RegExp(`\\[data-theme=['"]${theme.id}['"]\\]`).test(indexCss))
    continue
  }
  const file = skinFile(theme.id)
  ok(`${theme.id}: has a stylesheet`, existsSync(new URL(`../../${file}`, import.meta.url)))
  if (!existsSync(new URL(`../../${file}`, import.meta.url))) continue
  const css = read(file)
  /*
   * QUALIFIED AS html[data-theme='x'], NOT THE BARE ATTRIBUTE. `:root` and `[data-theme]` carry
   * identical specificity and the default tokens are declared after the skins in the bundle, so
   * a bare selector loses every override to source order and the file appears to do nothing.
   */
  ok(`${theme.id}: its rules are qualified with html`,
    new RegExp(`html\\[data-theme='${theme.id}'\\]`).test(css))
  check(`${theme.id}: and none of them are bare`,
    new RegExp(`(^|[^a-z\\]])\\[data-theme='${theme.id}'\\]`, 'm').test(css), false)
  /* AND index.css IMPORTS IT, or the file changes nothing at all. */
  ok(`${theme.id}: index.css imports it`,
    indexCss.includes(`@import "./${file.replace('src/', '')}"`))
}

/* ------------------------------------------------ the pre-paint script */

const preload = html.slice(html.indexOf('<script>'), html.indexOf('</script>'))
/* EVERY ID IS KNOWN TO IT. A skin missing here renders the baseline for a frame and then snaps. */
for (const theme of THEMES) {
  ok(`the pre-paint script knows ${theme.id}`, preload.includes(`'${theme.id}'`))
}
/* THE SAME STORAGE KEY AND THE SAME DEFAULT, or the script and the module disagree about what
   the person chose -- which looks exactly like the choice not being saved. */
const storageKey = themesLib.match(/const STORAGE_KEY = '([^']+)'/)?.[1]
check('the storage key is the one the module uses', preload.includes(`'${storageKey}'`), true)
ok('...and the key is the one in use', !!storageKey)
check('the pre-paint default is the module default',
  preload.includes(`var id = '${DEFAULT_THEME}'`), true)
/* AND IT STRIPS THE ATTRIBUTE FOR THE BASE SKIN ONLY, which is what applyTheme does. Stamping
   the base would select a block that does not exist; not stamping a skin renders the baseline. */
ok('...and it stamps everything but the base',
  new RegExp(`id !== '${BASE_THEME}'`).test(preload))

/* ------------------------------------------------ the tokens each skin redefines */

/** The `--token:` names declared in a file's `html[data-theme='id'] { ... }` root block. */
function tokensOf(css, id) {
  const open = css.indexOf(`html[data-theme='${id}'] {`)
  if (open === -1) return []
  const end = css.indexOf('\n}', open)
  const block = css.slice(open, end === -1 ? undefined : end)
  return [...block.matchAll(/^\s*(--[a-z0-9-]+):/gim)].map((m) => m[1])
}

const bySkin = new Map(SKINS.map((id) => [id, tokensOf(read(skinFile(id)), id)]))
/* THE PREMISE FIRST, or the comparison below passes on a set of empty lists. */
for (const [id, tokens] of bySkin) {
  ok(`${id}: redefines a substantial palette (${tokens.length})`, tokens.length > 80)
}

/*
 * A TOKEN ONE SKIN OVERRIDES AND ANOTHER DOES NOT is a widget wearing the previous skin's colour.
 *
 * COMPARED AGAINST WHAT EVERY SKIN BETWEEN THEM DEFINES, rather than one skin against another:
 * with three skins a pairwise rule is three comparisons and the next one makes six, and the
 * question is the same every time -- is anything redefined somewhere and not here.
 *
 * PRIVATE NAMES ARE EXEMPT. Each skin declares a gradient of its own and assigns it to the shared
 * --skin-gold-gradient, which is the token anything actually reads.
 *
 * AND SO IS THE PICTURE A SKIN MAY LEAVE ALONE. A skin keeping the baseline's photograph is a
 * decision, not an oversight: the raptor skin never changed the Collections hero and inherits all
 * three of that panel's tokens. Named rather than pattern-matched, so the next token somebody adds
 * to that panel is not waved through with them.
 */
const PRIVATE = /^--(raptor|desert|glass)/
const BASELINE_IMAGERY = [
  '--skin-collections-hero-image',
  '--skin-collections-hero-ground',
  '--skin-collections-scrim',
  '--skin-collections-hero-min',
  '--skin-collections-hero-min-lg',
]
const everywhere = [...new Set([...bySkin.values()].flat())]
  .filter((t) => !PRIVATE.test(t) && !BASELINE_IMAGERY.includes(t))
for (const [id, tokens] of bySkin) {
  check(`${id}: redefines everything the other skins do`,
    everywhere.filter((t) => !tokens.includes(t)), [])
}
/* AND THE EXEMPTION DESCRIBES A REAL DIFFERENCE, so the list cannot outlive what it excuses. */
check('the baseline-imagery exemption is still needed',
  BASELINE_IMAGERY.some((t) => [...bySkin.values()].some((v) => v.includes(t))
    && [...bySkin.values()].some((v) => !v.includes(t))), true)

/* ------------------------------------------------ the pictures */

/*
 * EVERY PICTURE A SKIN NAMES IS ON DISK. A url() to a file that is not there is a panel that
 * renders as a flat colour -- no error, nothing in the console, just a hero with no photograph.
 */
for (const id of SKINS) {
  const css = read(skinFile(id))
  for (const m of css.matchAll(/url\('(\/[^']+)'\)/g)) {
    ok(`${id}: ${m[1]} is on disk`, existsSync(new URL(`../../public${m[1]}`, import.meta.url)))
  }
}
/*
 * AND A SKIN'S HERO PICTURE IS BIG ENOUGH TO BE MAGNIFIED INTO A HERO.
 *
 * THIS EXACT MISTAKE IS ON THE RECORD TWICE NOW. The Collections photograph was once "encoded at
 * 1800px wide from a 2048px source and then magnified into a panel 700px tall", and the firm's
 * word for it was "pixelated" -- see the floor check-collections-hero puts on that file. The
 * desert hero was then encoded at 1920 from a 2172px source, and the firm asked the same question
 * about the same artefacts: "are you sure that's 8K, the resolution looks a bit shitty?"
 *
 * A FLOOR ON THE FILE SIZE IS A CRUDE PROXY for "it was not encoded down", and crude is the point:
 * it is the one check that would have caught both. The ceiling is the other half -- a hero that
 * costs two megabytes on the screen people open first thing every morning is a hero that gets
 * deleted.
 */
const HERO_ART = ['/brand/desert-hero.webp', '/brand/desert-band.webp']
for (const art of HERO_ART) {
  const bytes = statSync(new URL(`../../public${art}`, import.meta.url)).size
  const kb = Math.round(bytes / 1024)
  ok(`${art} is over 150KB, which is what stops it being re-encoded down to mush (${kb}KB)`,
    bytes > 150 * 1024)
  ok(`...and under 400KB (${kb}KB)`, bytes < 400 * 1024)
}

/* AND SO IS EVERY PICTURE index.css NAMES, which is where the baseline's own art lives. */
for (const m of indexCss.matchAll(/url\('(\/[^']+)'\)/g)) {
  ok(`index.css: ${m[1]} is on disk`, existsSync(new URL(`../../public${m[1]}`, import.meta.url)))
}

/*
 * AND NOT ONE OF THEM IS AN image-set().
 *
 * THIS COST A BLANK PANEL ON AN iPAD, and the firm works on one. Lightning CSS reads a stack of
 * declarations as a single intent, drops the plain url() safety net and emits a prefixed
 * image-set carrying type() -- which WebKit's prefixed form has never supported and therefore
 * rejects, leaving the element with no background at all. index.css carries the whole story on
 * `.login-photo`; this is what stops the next skin reintroducing it.
 */
/* COMMENTS STRIPPED FIRST. Every one of these files carries a comment explaining why image-set()
   is not used, and the first cut of this assertion read that prose and reported the fault it was
   written to prevent -- the same trap check-account-templates records from the other side. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '')
for (const [id, file] of [...SKINS.map((i) => [i, skinFile(i)]), ['base', 'src/index.css']]) {
  check(`${id}: no image-set()`, /image-set\(/.test(code(read(file))), false)
}

/* ------------------------------------------------ the preview tile */

/* THE SWATCH IS THREE REAL COLOURS. The tile is drawn from them, so a typo is a grey rectangle
   rather than an error. */
for (const theme of THEMES) {
  /*
   * A COLOUR THE TILE CAN ACTUALLY DRAW, which is not the same as a hex.
   *
   * This demanded six hex digits until a skin built on frosted glass gave its surface as
   * `rgba(10,24,34,0.62)` -- which is the honest value for a translucent surface and renders
   * perfectly. What the assertion is for is a typo or an empty string leaving a grey rectangle
   * where somebody picks a skin, so it takes either form and nothing else.
   */
  for (const key of ['ground', 'surface', 'accent']) {
    ok(`${theme.id}: the ${key} swatch is a colour`,
      /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s]+\))$/i.test(theme.swatch[key]))
  }
  ok(`${theme.id}: has a name and a description`,
    theme.name.trim().length > 0 && theme.description.trim().length > 0)
  /* THE LOCKUP IS A FILE THAT EXISTS, for the reason the pictures above do: a sidebar with no
     wordmark is a skin that looks broken rather than one that looks different. */
  ok(`${theme.id}: its lockup is on disk`,
    existsSync(new URL(`../../public${theme.lockupLight}`, import.meta.url)))
}

/*
 * AND THE DESERT SWATCH IS THE DESERT SKIN'S OWN COLOURS, not three that merely look warm. The
 * tile is how somebody picks, and a preview that is not the thing it previews is worse than none.
 */
const desert = themeById('desert')
const desertCss = read('src/styles/desert.css')
check('the desert ground is its own --color-navy-950',
  desertCss.includes(`--color-navy-950: ${desert.swatch.ground};`), true)
check('...its surface is its own --color-surface',
  desertCss.includes(`--color-surface: ${desert.swatch.surface};`), true)
check('...and its accent is its own --c-gold',
  desertCss.includes(`--c-gold: ${desert.swatch.accent};`), true)

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-themes: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
