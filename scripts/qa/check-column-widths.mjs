/**
 * Columns somebody can widen, and fit to what is in them (src/lib/columnWidths.ts).
 *
 * THE FIRM, on the accounts list: "make it so that you can adjust these columns. And if you double
 * click on the column on the top, it expands so that you can read it." The arithmetic is held here;
 * whether the drag and the fit actually move a column is held in a real browser, in e2e/accounts.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-column-widths.mjs
 */
import { clampWidth, dragWidth, fitWidth, readWidths, MIN_PX, MAX_PX } from '../../src/lib/columnWidths.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}

check('a drag adds what the pointer moved', dragWidth(200, 35), 235)
check('...and takes it away', dragWidth(200, -50), 150)
/* Too narrow and the heading is unreadable and its edge hard to find again. */
check('it never goes below the floor', dragWidth(100, -500), MIN_PX)
check('...nor above the ceiling', dragWidth(500, 900), MAX_PX)
check('widths are whole pixels', clampWidth(120.6), 121)

/* FIT: the widest natural width wins, heading included, with a sliver so the last letter breathes. */
check('fit takes the widest entry', fitWidth([80, 212.4, 140]), 214)
check('...ignores a cell that measured nothing', fitWidth([NaN, 90]), 92)
check('...stops at the ceiling for a very long entry', fitWidth([2000]), MAX_PX)
check('...and an empty column is still findable', fitWidth([]), MIN_PX)

/* STORED WIDTHS ARE READ DEFENSIVELY: per device, and whatever is there may be stale or junk. */
check('a stored width comes back', readWidths('{"debtor":260}', ['debtor', 'client']), { debtor: 260 })
check('...clamped', readWidths('{"debtor":9000}', ['debtor']), { debtor: MAX_PX })
check('...unknown columns ignored', readWidths('{"gone":200}', ['debtor']), {})
check('...a non-number ignored', readWidths('{"debtor":"wide"}', ['debtor']), {})
check('...junk is no widths at all, not a crash', readWidths('{not json', ['debtor']), {})
check('...and nothing stored is nothing', readWidths(null, ['debtor']), {})

console.log(`\ncheck-column-widths: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
