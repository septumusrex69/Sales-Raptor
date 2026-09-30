/**
 * A NARROW FIELD IS NARROW, AND A FORM SAYS WHY IT WILL NOT SUBMIT.
 *
 * THE FIRM, ON THE TEAMS SCREEN: "Team doesn't add."
 *
 * NOTHING WAS WRONG WITH ADDING A TEAM. The database took the insert, the policy allowed it, the
 * handler was correct. What was wrong was that the NAME BOX WAS FORTY PIXELS WIDE — a sliver with
 * a cursor in it, beside a kind dropdown that had swallowed the entire row. They typed nothing
 * into a field they could not see, pressed the button, and the form returned early on a blank
 * name without a word.
 *
 * THE CAUSE IS A TAILWIND RULE THAT READS BACKWARDS. `inputClass` began with `w-full`, and the way
 * to make a narrow control was to append a width: `${inputClass} w-40`. That does not work, and it
 * does not fail loudly either. Both are width utilities, and which one wins is decided by the
 * order the GENERATED STYLESHEET emits them, not by the order they appear in the attribute —
 * `w-full` is emitted last, so it wins every time. Every "narrow" control built that way has been
 * full width since it was written.
 *
 * On the Teams form the select also carried `shrink-0`: full width AND refusing to give any back,
 * which is what squeezed the name to a sliver. Elsewhere it was quieter — six number and kind
 * fields across the workflow drawer, the workflow library and the split-receipt modal, all of them
 * asking for 20 to 40 units and all of them rendering full width.
 *
 * SO THE WIDTH CAME OUT OF THE SHARED CLASS. `controlClass` is the look with no width; a field
 * that wants to fill its parent uses `inputClass`, which is `w-full` plus that. There is nothing
 * to override and nothing to lose an argument with.
 *
 * WHAT THIS FILE CANNOT DO is measure a rendered page — that is the e2e layer. What it can do is
 * refuse the construction, which is the only reason the bug was invisible for as long as it was.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-field-widths.mjs
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

const root = new URL('../../src/', import.meta.url).pathname
const read = (p) => readFileSync(p, 'utf8')

/** Every .tsx and .ts under src, so a new screen is covered the day it is written. */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}
const files = walk(root)
ok('there are source files to read at all', files.length > 100)

/* ---------------- the width lives in one place ---------------- */

const modal = read(join(root, 'components/ui/Modal.tsx'))
ok('there is a look without a width', /export const controlClass =/.test(modal))
/* AND THE FULL-WIDTH ONE IS BUILT FROM IT, so the two cannot describe different fields. Written
   out twice, a change to the border or the focus ring lands on one and not the other. */
ok('...and the full-width one is that plus a width',
  /export const inputClass = `w-full \$\{controlClass\}`/.test(modal))
ok('...so the look is written once', !/export const inputClass =\s*\n?\s*'w-full rounded/.test(modal))

/* ---------------- and nothing tries to argue with it ---------------- */

/*
 * THE ASSERTION THIS FILE EXISTS FOR. `${inputClass}` followed by any width utility is the
 * construction that silently does nothing. Caught as a LIST so the failure names every offender
 * rather than the first one.
 *
 * `w-auto` counts. It reads as "let the content decide" and is beaten by w-full exactly the same
 * way, which is how five selects in the workflow library came to be full width.
 */
const offenders = []
/* COMMENTS OFF FIRST. This file's own explanation quotes the broken construction, and so does
   Modal.tsx where the fix is written down -- a scan that could not tell the warning from the
   fault would report the warning. */
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
/*
 * `max-w-` AND `min-w-` ARE NOT THIS BUG and must not be swept up with it: `w-full max-w-[7rem]`
 * is a field that fills its parent up to a cap, which is a real and working thing that three
 * boxes on the add-client form rely on. The lookbehind is what separates a width from a bound.
 */
for (const f of files) {
  const src = stripComments(read(f))
  for (const m of src.matchAll(/\$\{inputClass\}[^`]*?(?<![a-z-])w-[a-z0-9[\]/.-]+/g)) {
    offenders.push(`${f.slice(root.length)}: ${m[0].replace(/\s+/g, ' ').slice(0, 60)}`)
  }
}
check('no field fights inputClass for its own width', offenders, [])

/*
 * AND THE OTHER DIRECTION: a control that asks for a width must be built on the widthless one.
 * Without this the fix above could be undone by going back to a hand-written class string that
 * happens to start with w-full again.
 */
const narrow = []
for (const f of files) {
  const src = stripComments(read(f))
  for (const m of src.matchAll(/\$\{controlClass\}([^`]*)/g)) {
    if (/\bw-full\b/.test(m[1])) narrow.push(f.slice(root.length))
  }
}
check('nothing puts w-full back on top of a width', narrow, [])

/* ---------------- the Teams form, specifically ---------------- */

/*
 * THE SCREEN THE FIRM REPORTED. Held by name because it is the one that cost them the feature,
 * and because the shape it needs is not the same as the generic rule above: the name must be the
 * field that takes the slack, and min-w-0 is what lets a flex child narrow at all rather than
 * standing on its content's width.
 */
const settings = read(join(root, 'pages/settings/SettingsPage.tsx'))
const form = settings.slice(settings.indexOf('New team name') - 900, settings.indexOf('New team name') + 1400)
ok('the teams form is where this check thinks it is', form.includes('New team name'))
ok('the team name takes the slack', /\$\{controlClass\} flex-1 min-w-0/.test(form))
ok('...and the kind keeps its own width', /\$\{controlClass\} w-40 shrink-0/.test(form))

/*
 * AND IT REFUSES VISIBLY. The handler returning early on a blank name is correct; doing it in
 * silence is what made a working feature look broken. A button that cannot act says so by being
 * unpressable — which is quieter than a warning, and CLAUDE.md is clear that a warning firing when
 * nothing is wrong is worse than no warning.
 */
ok('the add button is dead while the name is blank', /disabled=\{!name\.trim\(\)\}/.test(form))
ok('...and says why when somebody hovers it', /Give the team a name first/.test(form))
/* THE GUARD STAYS TOO. The button is the courtesy; the early return is the rule, and a form can
   still be submitted with Enter from the name field. */
ok('...while the handler still refuses a blank name', /if \(!name\.trim\(\)\) return/.test(form))

console.log(`\ncheck-field-widths: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
