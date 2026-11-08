/**
 * THE SMALL RINGS BESIDE A COLLECTOR'S FIGURES (S19 · Raptor H18; Stephan: "little pie charts to show ... how many are
 * kept, how many are taken ... keep it there, but just on the side of it"). Each ring is drawn only over a real whole,
 * from figures already on its card -- so a ring and the numbers beside it can never disagree.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-collector-rings.mjs
 */
import { readFileSync } from 'node:fs'
import { dayRing, promiseRing, ringPercent, traceRing } from '../../src/lib/collectorRings.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const vals = (r) => r.map((p) => [p.name, p.value])

/* The card's own example: 8 taken, 5 kept, 2 broken, so 7 resolved and 1 still to come. */
check('promises: kept, broken, still to come -- adding up to the ones taken',
  vals(promiseRing({ made: 8, kept: 5, broken: 2, resolved: 7 })), [['Kept', 5], ['Broken', 2], ['Still to come', 1]])
check('...never a negative "still to come"', promiseRing({ made: 3, kept: 3, broken: 1, resolved: 4 })[2].value, 0)
check('the day: the four channels the card counts', vals(dayRing({ calls: 40, emails: 9, sms: 6, notes: 20 })),
  [['Calls', 40], ['Emails', 9], ['SMS', 6], ['Notes', 20]])
check('traces: verified, tried and not right, not tried -- adding up to what was found',
  vals(traceRing({ leads: 11, worked: 4, verified: 3 })), [['Verified', 3], ['Tried, not right', 1], ['Not tried yet', 7]])
check('the middle is a whole percentage', ringPercent(5 / 7), '71%')
check('...or a dash where nothing has come due', ringPercent(null), '—')

/* Status colours on the outcome rings, the four distinct channel colours on the day's. */
const day = dayRing({ calls: 1, emails: 1, sms: 1, notes: 1 }).map((p) => p.color)
check('the day\'s four channels are four colours', new Set(day).size, 4)
check('kept and verified are the same good; broken and not right the same bad',
  [promiseRing({ made: 1, kept: 1, broken: 1, resolved: 1 })[0].color === traceRing({ leads: 1, worked: 1, verified: 1 })[0].color,
    promiseRing({ made: 1, kept: 1, broken: 1, resolved: 1 })[1].color === traceRing({ leads: 2, worked: 2, verified: 1 })[1].color], [true, true])

/* On the page: three rings, each BESIDE its figures (the figures stay). */
const page = readFileSync(new URL('../../src/pages/CollectorProfile.tsx', import.meta.url), 'utf8')
for (const id of ['ring-promises', 'ring-day', 'ring-traces']) check(`${id} is on the collector's page`, page.includes(`testId="${id}"`), true)
check('...and the figures are still there', ['label="Taken"', 'label="Calls"', 'label="Verified"'].every((m) => page.includes(m)), true)

console.log(`check-collector-rings: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
if (failures.length) process.exit(1)
