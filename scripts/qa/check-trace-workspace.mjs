/**
 * The trace workspace: sections, grouped rows, narrowing, and the page under the table.
 *
 * ONE NUMBER FILED THREE TIMES IS ONE NUMBER. The bureau files the same line under Cell, Home
 * and Work — one real profile carried a single number under all three, updated within a month of
 * each other. Printed as filed, a collector sees fifteen numbers where there are six, rings the
 * same one three times, and marks one of the three tested while the other two still read "Not
 * tested". Most of what is checked here is that grouping holds and that an outcome recorded on a
 * row reaches every finding behind it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-trace-workspace.mjs
 */
import {
  OUTCOME_OPTIONS, TRACE_CATEGORIES, TRACE_SORTS, categoryById, categoryCounts,
  groupTraceRows, itemsIn, outcomeTone, pageOf, riskTone, traceRowKey, workRows,
} from '../../src/lib/traceStore.ts'

let pass = 0
const failures = []
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${name}\n    expected ${e}\n    got      ${a}`)
}
const ok = (name, actual) => eq(name, actual, true)

let seq = 0
const I = (over = {}) => ({
  id: `i${seq += 1}`, traceId: 't1', accountId: 'a1',
  kind: 'mobile', value: '082 555 0101', label: null,
  peopleLinked: null, seenOn: null, amount: null, status: null,
  outcome: null, outcomeAt: null, outcomeNote: null, promotedContactId: null,
  ...over,
})

/* ---------- the sections ---------- */

eq('every section has a distinct id',
  new Set(TRACE_CATEGORIES.map((c) => c.id)).size, TRACE_CATEGORIES.length)
/*
 * No kind may sit in two sections, or a finding is counted twice and the rail's numbers add up
 * to more than the trace holds.
 */
{
  const kinds = TRACE_CATEGORIES.flatMap((c) => c.kinds)
  eq('no kind belongs to two sections', new Set(kinds).size, kinds.length)
}
ok('numbers come first, because that is the work', TRACE_CATEGORIES[0].id === 'phones')
ok('every section says what you do with it, not what is in it',
  TRACE_CATEGORIES.every((c) => c.blurb.length > 0))
/*
 * The first column is named after what it holds. A generic "Value" over a column of houses tells
 * somebody scanning the table nothing at all.
 */
ok('...and names its own first column', TRACE_CATEGORIES.every((c) => c.valueHeading !== 'Value'))
/*
 * A HOUSE CANNOT BE RUNG. Offering an outcome picker against a property or a directorship asks a
 * question with no true answer, and a column of "Not tested" against every property is how a
 * column stops being read.
 */
eq('property is not something you try', categoryById('property').worked, false)
eq('...nor a directorship', categoryById('companies').worked, false)
eq('a number is', categoryById('phones').worked, true)
eq('an address is too — you can confirm somebody lives there', categoryById('addresses').worked, true)
eq('an unknown id falls back rather than throwing', categoryById('nonsense').id, 'phones')

/* ---------- one number, filed three times ---------- */

{
  const items = [
    /*
     * The NEWEST printing carries the LOWEST link count on purpose. With the worst figure also
     * being the newest one, "take the worst" and "take the newest" produce the same answer and
     * the assertion below proves nothing — which is exactly how it first shipped.
     */
    I({ id: 'cell', kind: 'mobile', value: '076 589 6002', seenOn: '2026-09-10', peopleLinked: 2 }),
    I({ id: 'home', kind: 'phone', value: '0765896002', seenOn: '2026-08-02', peopleLinked: 6 }),
    I({ id: 'work', kind: 'work', value: '076-589-6002', seenOn: '2025-01-01', peopleLinked: null }),
    I({ id: 'other', kind: 'mobile', value: '066 375 2684', seenOn: '2021-06-29' }),
  ]
  const rows = groupTraceRows(items)
  eq('three printings of one number are one row', rows.length, 2)

  const merged = rows.find((r) => r.key === '0765896002')
  eq('...spacing is how it was typed, not part of the number', merged.items.length, 3)
  eq('...and it wears every type it was filed under', merged.kinds, ['phone', 'work', 'mobile'])
  // Shown the way it was most recently filed, so it reads like the bureau's latest record of it.
  eq('...shown as most recently printed', merged.value, '076 589 6002')
  eq('...and dated by the most recent of them', merged.seenOn, '2026-09-10')
  /*
   * THE WORST OF THEM, not the newest. A number the bureau holds against six people is held
   * against six people whichever column it was printed in, and taking the friendliest figure is
   * how a switchboard ends up looking like a personal line.
   */
  eq('...and carries the worst link count, not the newest', merged.peopleLinked, 6)

  ok('an outcome on the row has every finding behind it', merged.items.length === 3)
  eq('...so recording one reaches all three', merged.items.map((i) => i.id).sort(), ['cell', 'home', 'work'])
}

/* An email is the same thing however it was capitalised; a name is not re-spaced away. */
eq('case is not part of an address',
  groupTraceRows([I({ kind: 'email', value: 'Sipho@Example.co.za' }), I({ kind: 'email', value: 'sipho@example.co.za' })]).length, 1)
eq('two different numbers do not collide',
  groupTraceRows([I({ value: '082 555 0101' }), I({ value: '082 555 0102' })]).length, 2)
eq('the key keeps a leading plus, because +27 and 0 are different numbers',
  traceRowKey(I({ value: '+27 82 555 0101' })), '+27825550101')

/* A merged row whose findings disagree must not claim one of them. */
{
  const [row] = groupTraceRows([
    I({ kind: 'mobile', value: '082 555 0101', outcome: 'verified' }),
    I({ kind: 'work', value: '0825550101', outcome: null }),
  ])
  eq('findings that disagree do not report an outcome', row.outcome, null)
  ok('...and say so', row.mixed)
}
{
  const [row] = groupTraceRows([
    I({ kind: 'mobile', value: '082 555 0101', outcome: 'verified' }),
    I({ kind: 'work', value: '0825550101', outcome: 'verified' }),
  ])
  eq('findings that agree report it', row.outcome, 'verified')
  ok('...and are not mixed', !row.mixed)
}
// On the account if any printing of it made it there — it is one number either way.
ok('promoted once is promoted',
  groupTraceRows([
    I({ kind: 'mobile', value: '082 555 0101', promotedContactId: 'c1' }),
    I({ kind: 'work', value: '0825550101' }),
  ])[0].promoted)

/* ---------- the rail's numbers ---------- */

{
  const items = [
    I({ kind: 'mobile', value: '082 555 0101' }),
    I({ kind: 'work', value: '0825550101' }),
    I({ kind: 'email', value: 'a@example.co.za' }),
    I({ kind: 'property', value: 'ERF 1 KLIPTOWN', status: 'Owner' }),
  ]
  const counts = categoryCounts(items)
  /*
   * COUNTED AS ROWS, NOT AS FINDINGS. The rail says 15 and the table shows 6 if one counts what
   * the bureau printed and the other counts things — which is the same badge-over-a-shorter-list
   * failure the mail queue had.
   */
  eq('the rail counts what the table will show', counts.phones, 1)
  eq('...for every section', [counts.emails, counts.property, counts.people], [1, 1, 0])
  eq('a section with nothing in it counts nought', counts.companies, 0)
  eq('itemsIn takes only its own kinds', itemsIn(items, categoryById('phones')).length, 2)
}

/* ---------- narrowing and ordering ---------- */

const phones = categoryById('phones')
const many = [
  I({ id: 'a', value: '076 589 6002', seenOn: '2026-09-10', peopleLinked: 6, outcome: 'verified' }),
  I({ id: 'b', value: '066 375 2684', seenOn: '2021-06-29', peopleLinked: 1 }),
  I({ id: 'c', value: '087 700 9710', seenOn: '2021-08-21', peopleLinked: 2, outcome: 'no_answer' }),
  I({ id: 'd', value: '010 210 7030', seenOn: '2020-09-17', peopleLinked: 14, outcome: 'not_theirs' }),
]

eq('most recently seen first by default',
  workRows({ items: many, category: phones }).map((r) => r.value),
  ['076 589 6002', '087 700 9710', '066 375 2684', '010 210 7030'])
eq('oldest first turns it round',
  workRows({ items: many, category: phones, sort: 'oldest' }).map((r) => r.value)[0], '010 210 7030')
/*
 * NULL IS NOT NOUGHT OTHER PEOPLE. "The bureau did not say" sorts last, or every number it said
 * nothing about is offered ahead of a number it positively said belongs to one person.
 */
eq('fewest links first, and an unknown count is not the best one',
  workRows({ items: [...many, I({ id: 'e', value: '011 555 0000', peopleLinked: null })], category: phones, sort: 'fewest_links' })
    .map((r) => r.peopleLinked),
  [1, 2, 6, 14, null])

eq('search narrows on the number', workRows({ items: many, category: phones, search: '087' }).map((r) => r.value), ['087 700 9710'])
eq('...not tripped by a stray space either side', workRows({ items: many, category: phones, search: '  087  ' }).length, 1)
eq('...and it is not case-sensitive', workRows({
  items: [I({ kind: 'email', value: 'Sipho@Example.co.za' })], category: categoryById('emails'), search: 'sipho',
}).length, 1)
eq('...and finds nothing rather than everything', workRows({ items: many, category: phones, search: 'zzz' }).length, 0)
eq('an outcome filter narrows to it',
  workRows({ items: many, category: phones, outcome: 'verified' }).map((r) => r.value), ['076 589 6002'])
eq('...untested is its own answer',
  workRows({ items: many, category: phones, outcome: 'untested' }).map((r) => r.value), ['066 375 2684'])
eq('...and "any" is everything', workRows({ items: many, category: phones, outcome: 'any' }).length, 4)
// A section only ever shows its own kinds, whatever else is on the trace.
eq('a section never shows another section’s findings',
  workRows({ items: [...many, I({ kind: 'email', value: 'a@example.co.za' })], category: phones }).length, 4)

/* ---------- the page under the table ---------- */

{
  const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
  const first = pageOf(rows, 1, 6)
  eq('a page holds what it holds', first.rows, [1, 2, 3, 4, 5, 6])
  eq('...and says how many of how many', [first.showing, first.total], [6, 15])
  eq('there are three pages of fifteen', first.pages, 3)
  eq('the last page is the remainder', pageOf(rows, 3, 6).rows, [13, 14, 15])
  /*
   * CLAMPED. The page number outlives the list it was counted against: somebody on page 3 types
   * into the search box, four rows come back, and an unclamped slice hands them an empty table
   * with a working Previous button — which reads as the search having found nothing at all.
   */
  eq('a page past the end shows the last one, not nothing', pageOf([1, 2, 3], 9, 6).rows, [1, 2, 3])
  eq('...and reports the page it actually showed', pageOf([1, 2, 3], 9, 6).page, 1)
  eq('a page before the first is the first', pageOf(rows, 0, 6).page, 1)
  eq('an empty list is one empty page, not nought pages', pageOf([], 1, 6).pages, 1)
  eq('...showing nothing out of nothing', [pageOf([], 1, 6).showing, pageOf([], 1, 6).total], [0, 0])
}

/* ---------- how it reads ---------- */

eq('the picker offers not-tested as a real choice', OUTCOME_OPTIONS[0].outcome, null)
/*
 * Which is the firm's "you can unverify it". A picker that can only move forwards leaves a wrong
 * outcome standing, and the next collector rings a number this one already proved dead.
 */
eq('...labelled', OUTCOME_OPTIONS[0].label, 'Not tested')
eq('...and it offers every outcome besides', OUTCOME_OPTIONS.length, 5)
eq('reaching them is the green one', outcomeTone('verified'), 'green')
eq('a number that rang is worth another try, not a dead one', outcomeTone('no_answer'), 'amber')
eq('a disconnected one is dead', outcomeTone('unreachable'), 'red')
/*
 * Somebody else's number tells you nothing about reaching this person, which is the same as not
 * having tried — so it is grey, not red. Red would read as "this number is finished".
 */
eq('somebody else’s number is grey, not dead', outcomeTone('not_theirs'), 'grey')
eq('untried is grey', outcomeTone(null), 'grey')
// Only a high grade earns red. A grade shown in red whatever it says is a grade nobody reads.
eq('a high risk grade is loud', riskTone('High'), 'red')
eq('an average one is not', riskTone('Average'), 'amber')
eq('a missing grade says nothing', riskTone(null), 'grey')
ok('every sort offered has a name', TRACE_SORTS.every((s) => s.label.length > 0))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A number filed under Cell, Home and Work is one row carrying all three findings, the rail counts
what the table will show, and the page under it cannot outlive the list it was counted against.`)
