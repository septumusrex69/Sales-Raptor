/**
 * The diary's ordering, checked against dates that actually exist.
 *
 * Two things are being protected here.
 *
 * The first is the LADDER ITSELF, which is written down twice -- once in TypeScript for the
 * labels and once in SQL, because a book of a few hundred thousand accounts has to be ordered
 * and paged in the database rather than in the browser. Two copies of a business rule drift.
 * This reads the ladder out of supabase/schema.sql and compares it to the TypeScript, so they
 * cannot.
 *
 * The second is the ORDER a day is worked in, which is the whole point of having a ladder. The
 * case that matters is the one the real book is full of: 279 overdue entries, some of them a
 * year old. Ordered oldest-first, a promise that broke this morning sits below all of them and
 * is not rung. Every assertion below is a variation on that.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-diary-priority.mjs
 */
import { readFileSync } from 'node:fs'
import {
  DIARY_PRIORITY, DIARY_KINDS, compareDiary, sortDiary, dayLoad, dayLoadSentence,
  firstDayWithRoom, calendarStrip, isMissed, overdueBy, nearPrescription, daysBetween,
  shiftDate, DEFAULT_DIARY_CAPACITY, workingDaysFrom, planSpread,
  orderDiary, floatedKind, DIARY_ORDER_LABELS,
  monthGrid, inMonth, shiftMonth, todayIso, dayName,
} from '../../src/lib/diaryPriority.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) pass += 1
  else failures.push(`${name}\n     got      ${a}\n     expected ${e}`)
}
function ok(name, condition) {
  if (condition) pass += 1
  else failures.push(name)
}

/* ---------- 1. the ladder agrees with the database ---------- */

const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const fn = schema.match(/create or replace function public\.diary_priority[\s\S]*?\$\$;/)
ok('diary_priority() is in schema.sql', !!fn)
if (fn) {
  const fromSql = {}
  for (const [, kind, value] of fn[0].matchAll(/when '([a-z_]+)'\s*then\s*(\d+)/g)) {
    fromSql[kind] = Number(value)
  }
  const elseMatch = fn[0].match(/else\s+(\d+)/)
  ok('the SQL has an else branch for review', !!elseMatch)
  if (elseMatch) fromSql.review = Number(elseMatch[1])
  check('the SQL ladder matches the TypeScript ladder', fromSql, DIARY_PRIORITY)
}

// Every kind the database will accept must have a label, or the day list renders a blank chip.
const kindsInCheck = schema.match(/kind text not null default 'review' check \(kind in \(([\s\S]*?)\)\)/)
ok('the kind CHECK is in schema.sql', !!kindsInCheck)
if (kindsInCheck) {
  const allowed = [...kindsInCheck[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
  check('every kind the database allows has a label', allowed, Object.keys(DIARY_KINDS).sort())
  check('every kind the database allows has a priority', allowed, Object.keys(DIARY_PRIORITY).sort())
}

/*
 * The words themselves, pinned.
 *
 * These are the firm's own terms, given in their own voice — "Broken PTP", not "Broken promise".
 * A label is what an agent picks from under time pressure sixty times a day, so drifting back to
 * a developer's wording is a real regression and an invisible one: nothing breaks, the vocabulary
 * just stops being theirs.
 */
{
  const labels = Object.fromEntries(
    Object.entries(DIARY_KINDS).map(([k, v]) => [k, v.label]),
  )
  check('the firm\'s own words', labels, {
    promise_broken: 'Broken PTP',
    new_account: 'New account',
    promise_due: 'PTP due',
    callback: 'Callback requested',
    dispute_chase: 'Dispute follow-up',
    no_contact: 'No contact — retry',
    trace: 'Trace follow-up',
    review: 'Follow-up',
  })
  ok('no two kinds read the same',
    new Set(Object.values(labels)).size === Object.keys(labels).length)
  ok('every kind says why it exists',
    Object.values(DIARY_KINDS).every((v) => typeof v.why === 'string' && v.why.length > 20))
}

/* ---------- 2. the case the real book is full of ---------- */

const today = '2026-09-14'

// Taken from the shape of the live staging book: a pile of year-old routine chases, and one
// promise that broke this morning.
const day = [
  { id: 'old-review-2025', kind: 'review', dueOn: '2025-09-30' },
  { id: 'old-review-2024', kind: 'review', dueOn: '2024-08-02' },
  { id: 'broke-today', kind: 'promise_broken', dueOn: today },
  { id: 'new-account', kind: 'new_account', dueOn: today },
  { id: 'chase-last-week', kind: 'dispute_chase', dueOn: '2026-09-07' },
]
check(
  'a promise that broke today outranks a review from 2024',
  sortDiary(day, today).map((e) => e.id),
  ['broke-today', 'new-account', 'chase-last-week', 'old-review-2024', 'old-review-2025'],
)

// Within one band, the oldest genuinely does come first.
check(
  'inside a band, oldest first',
  sortDiary([
    { id: 'b', kind: 'review', dueOn: '2026-09-10' },
    { id: 'a', kind: 'review', dueOn: '2026-01-05' },
    { id: 'c', kind: 'review', dueOn: '2026-09-14' },
  ], today).map((e) => e.id),
  ['a', 'b', 'c'],
)

// The ladder, top to bottom, from a deliberately scrambled input.
check(
  'the whole ladder orders correctly',
  sortDiary(
    ['review', 'trace', 'no_contact', 'dispute_chase', 'callback', 'promise_due', 'new_account', 'promise_broken']
      .map((kind) => ({ kind, dueOn: today })),
    today,
  ).map((e) => e.kind),
  // The firm's own order, given in their words: broken PTP, new account, PTP due, callback
  // requested, dispute follow-up, and so forth.
  ['promise_broken', 'new_account', 'promise_due', 'callback', 'dispute_chase', 'no_contact', 'trace', 'review'],
)

// A rung the firm merged away. It must not come back by accident in either copy of the ladder:
// a kind the database refuses but the app still offers is a save that fails at the last step.
ok('the retired instalment rung is gone from the TypeScript', !('payment_default' in DIARY_PRIORITY))
// As a VALUE, not as a word: the schema names the migration that retired it in a comment, and
// a check that cannot tell a live constraint entry from a note about history is a check that
// makes people delete the note.
ok('...and from the SQL', !/'payment_default'/.test(schema))

/* ---------- 3. prescription beats the ladder ---------- */

ok('60 days out is near prescription', nearPrescription('2026-11-01', today))
ok('a year out is not', !nearPrescription('2027-09-14', today))
ok('a missing prescription date is not urgent', !nearPrescription(null, today))
ok('a missing prescription date is not urgent (undefined)', !nearPrescription(undefined, today))

check(
  'a routine review that is about to prescribe beats a broken PTP that is not',
  sortDiary([
    { id: 'broken', kind: 'promise_broken', dueOn: today, prescriptionOn: '2029-01-01' },
    { id: 'prescribing', kind: 'review', dueOn: today, prescriptionOn: '2026-10-01' },
  ], today).map((e) => e.id),
  ['prescribing', 'broken'],
)

check(
  'two prescribing accounts: the sooner one first, whatever the kind',
  sortDiary([
    { id: 'later', kind: 'promise_broken', dueOn: today, prescriptionOn: '2026-11-10' },
    { id: 'sooner', kind: 'review', dueOn: today, prescriptionOn: '2026-09-20' },
  ], today).map((e) => e.id),
  ['sooner', 'later'],
)

// A date already past still counts as near -- an account that prescribed last week is the most
// urgent conversation on the book, not the least.
ok('a prescription date already gone is still urgent', nearPrescription('2026-08-01', today))

// Sorting must be stable enough to be a total order: comparing anything to itself is 0.
const self = { kind: 'review', dueOn: today, prescriptionOn: '2026-10-01' }
check('an entry compares equal to itself', compareDiary(self, self, today), 0)

/* ---------- 4. how full a day is ---------- */

check('an empty weekday is free', dayLoad({ date: '2026-09-14', booked: 0, capacity: 30 }).level, 'free')
check('23 of 30 is filling', dayLoad({ date: '2026-09-14', booked: 23, capacity: 30 }).level, 'filling')
// The boundary itself, from both sides: three quarters is where "filling" starts.
check('exactly three quarters is filling', dayLoad({ date: '2026-09-14', booked: 24, capacity: 32 }).level, 'filling')
check('a hair under three quarters is still free', dayLoad({ date: '2026-09-14', booked: 23, capacity: 32 }).level, 'free')
check('30 of 30 is full', dayLoad({ date: '2026-09-14', booked: 30, capacity: 30 }).level, 'full')
check('38 of 30 is over', dayLoad({ date: '2026-09-14', booked: 38, capacity: 30 }).level, 'over')

// The real one. Ruben Liebenberg has 44 accounts on a single day in the live book.
check('44 on one day reads as over', dayLoad({ date: '2026-09-04', booked: 44, capacity: 30 }).level, 'over')

// The thresholds are proportions, so they hold at either end of the range.
check('12 of 15 is filling for a low-capacity agent', dayLoad({ date: '2026-09-14', booked: 12, capacity: 15 }).level, 'filling')
check('45 of 60 is filling for a high-capacity agent', dayLoad({ date: '2026-09-14', booked: 45, capacity: 60 }).level, 'filling')
check('no capacity set falls back to the firm default', dayLoad({ date: '2026-09-14', booked: 0 }).capacity, DEFAULT_DIARY_CAPACITY)
check('a nonsense capacity falls back too', dayLoad({ date: '2026-09-14', booked: 0, capacity: 0 }).capacity, DEFAULT_DIARY_CAPACITY)

// Weekends and South African public holidays.
ok('a Saturday is closed', dayLoad({ date: '2026-09-19', booked: 0 }).closed)
ok('a Sunday is closed', dayLoad({ date: '2026-09-20', booked: 0 }).closed)
ok('Heritage Day is closed', dayLoad({ date: '2026-09-24', booked: 0 }).closed)
ok('an ordinary Tuesday is open', !dayLoad({ date: '2026-09-15', booked: 0 }).closed)

check('a closed day says so', dayLoadSentence(dayLoad({ date: '2026-09-19', booked: 0 })), 'Nobody is at a desk')
check('a full day says so', dayLoadSentence(dayLoad({ date: '2026-09-14', booked: 30, capacity: 30 })), '30 accounts — a full day')
check('one account is not "1 accounts"', dayLoadSentence(dayLoad({ date: '2026-09-14', booked: 1, capacity: 30 })), '1 account booked')

/* ---------- 5. suggesting a day ---------- */

// Friday 2026-09-18 is full; the weekend is closed; Monday the 21st should be offered.
const loads = new Map([['2026-09-18', 30]])
check('a full Friday pushes the suggestion past the weekend', firstDayWithRoom('2026-09-18', loads, 30), '2026-09-21')

// Heritage Day falls on Thursday 24 September 2026.
check('a public holiday is never suggested', firstDayWithRoom('2026-09-24', new Map(), 30), '2026-09-25')

// A run of full days is walked through rather than given up on.
const busy = new Map([
  ['2026-09-14', 40], ['2026-09-15', 40], ['2026-09-16', 40], ['2026-09-17', 40], ['2026-09-18', 40],
])
check('a full week is walked past', firstDayWithRoom('2026-09-14', busy, 30), '2026-09-21')

// It must terminate rather than loop when every day is full.
const everyDayFull = new Map(Array.from({ length: 80 }, (_, i) => [shiftDate('2026-09-14', i), 99]))
check('an impossible diary returns the day asked for', firstDayWithRoom('2026-09-14', everyDayFull, 30), '2026-09-14')

/* ---------- 6. the picker's calendar ---------- */

const strip = calendarStrip('2026-09-14', 3)
check('three weeks is 21 days', strip.length, 21)
check('the strip starts on a Monday', new Date(`${strip[0]}T00:00:00Z`).getUTCDay(), 1)
// 2026-09-14 is itself a Monday, so the strip starts on it.
check('a Monday starts its own week', strip[0], '2026-09-14')
// A Sunday belongs to the week that began six days earlier, not the one starting tomorrow.
check('a Sunday belongs to the week before it', calendarStrip('2026-09-20', 1)[0], '2026-09-14')
check('a Wednesday rolls back to Monday', calendarStrip('2026-09-16', 1)[0], '2026-09-14')

/* ---------- 7. missed, and how late ---------- */

ok('an open entry from yesterday is missed', isMissed({ state: 'open', dueOn: '2026-09-13' }, today))
ok('an open entry due today is not missed', !isMissed({ state: 'open', dueOn: today }, today))
ok('an open entry due tomorrow is not missed', !isMissed({ state: 'open', dueOn: '2026-09-15' }, today))
// The point of the design: a worked entry from last year is history, not arrears.
ok('a done entry is never missed', !isMissed({ state: 'done', dueOn: '2025-01-01' }, today))
ok('a moved entry is never missed', !isMissed({ state: 'moved', dueOn: '2025-01-01' }, today))
ok('a cancelled entry is never missed', !isMissed({ state: 'cancelled', dueOn: '2025-01-01' }, today))

check('one day', overdueBy('2026-09-13', today), '1 day late')
check('a few days', overdueBy('2026-09-08', today), '6 days late')
check('weeks', overdueBy('2026-08-14', today), '4 weeks late')
check('months', overdueBy('2026-06-14', today), '3 months late')
// The oldest entry in the live book is from December 2023.
check('the worst one in the real book', overdueBy('2023-12-10', today), '3 years late')
check('nothing to say about a future date', overdueBy('2026-09-20', today), '')
check('nothing to say about today', overdueBy(today, today), '')

/* ---------- 8. date arithmetic across awkward boundaries ---------- */

check('days between, forward', daysBetween('2026-09-14', '2026-09-20'), 6)
check('days between, backward', daysBetween('2026-09-20', '2026-09-14'), -6)
check('across a month end', daysBetween('2026-08-31', '2026-09-01'), 1)
check('across a year end', daysBetween('2026-12-31', '2027-01-01'), 1)
// 2028 is a leap year; February has 29 days.
check('across a leap day', daysBetween('2028-02-28', '2028-03-01'), 2)
check('shift across a month end', shiftDate('2026-09-30', 1), '2026-10-01')
check('shift backwards across a year end', shiftDate('2027-01-01', -1), '2026-12-31')

/* ---------- 9. spreading a backlog over real days ---------- */

// Monday 14 to Friday 18 September 2026.
check('five working days from a Monday', workingDaysFrom('2026-09-14', 5),
  ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'])

// Starting on a Saturday: the run begins on the Monday, and the Saturday is not in it.
check('a weekend start rolls into the week', workingDaysFrom('2026-09-19', 3),
  ['2026-09-21', '2026-09-22', '2026-09-23'])

// Heritage Day is Thursday 24 September 2026 -- it must be stepped over, not counted.
check('a public holiday is stepped over', workingDaysFrom('2026-09-23', 3),
  ['2026-09-23', '2026-09-25', '2026-09-28'])

check('asking for none gives none', workingDaysFrom('2026-09-14', 0), [])

// The real case: Ruben's 44 missed accounts, spread at 30 a day.
const ruben = planSpread(44, '2026-09-15', 30)
check('44 at 30 a day needs two working days', ruben.days, ['2026-09-15', '2026-09-16'])
check('and 14 land on the second', ruben.onLastDay, 14)

// The whole imported backlog -- 279 entries -- at 30 a day.
const whole = planSpread(279, '2026-09-15', 30)
check('279 at 30 a day needs ten working days', whole.days.length, 10)
check('which reaches into the following fortnight', whole.days[9], '2026-09-29')
check('and 9 land on the last day', whole.onLastDay, 9)

// An exact fit must not produce a stray empty day.
const exact = planSpread(60, '2026-09-14', 30)
check('an exact fit uses exactly the days it needs', exact.days.length, 2)
check('and fills the last day', exact.onLastDay, 30)

// Fewer entries than a single day holds.
const small = planSpread(4, '2026-09-14', 30)
check('a handful needs one day', small.days, ['2026-09-14'])
check('and all four land on it', small.onLastDay, 4)

// A nonsense capacity must not divide by zero or loop forever.
check('a zero capacity is treated as one a day', planSpread(3, '2026-09-14', 0).perDay, 1)
check('and still terminates', planSpread(3, '2026-09-14', 0).days.length, 3)

/* ---------- 10. ordering the day the way the agent asked ---------- */

const mixed = [
  { id: 'small-broken', kind: 'promise_broken', dueOn: '2026-09-14', outstanding: 1200 },
  { id: 'huge-review', kind: 'review', dueOn: '2026-09-14', outstanding: 900000 },
  { id: 'old-callback', kind: 'callback', dueOn: '2024-01-05', outstanding: 5000 },
  { id: 'mid-promise-due', kind: 'promise_due', dueOn: '2026-09-14', outstanding: 40000 },
]

// The default is still the ladder.
check('urgent is the ladder', orderDiary(mixed, 'urgent', today).map((e) => e.id),
  ['small-broken', 'mid-promise-due', 'old-callback', 'huge-review'])

check('biggest balance first', orderDiary(mixed, 'amount', today).map((e) => e.id),
  ['huge-review', 'mid-promise-due', 'old-callback', 'small-broken'])

check('longest waiting first', orderDiary(mixed, 'oldest', today).map((e) => e.id),
  ['old-callback', 'small-broken', 'mid-promise-due', 'huge-review'])

// Floating a kind reorders the top and leaves the ladder underneath untouched.
check('call backs first', orderDiary(mixed, 'first:callback', today).map((e) => e.id),
  ['old-callback', 'small-broken', 'mid-promise-due', 'huge-review'])
check('promises due first', orderDiary(mixed, 'first:promise_due', today).map((e) => e.id),
  ['mid-promise-due', 'small-broken', 'old-callback', 'huge-review'])
check('reviews first', orderDiary(mixed, 'first:review', today).map((e) => e.id),
  ['huge-review', 'small-broken', 'mid-promise-due', 'old-callback'])

// Floating a kind nothing matches must not disturb the ladder.
check('floating an absent kind leaves the ladder', orderDiary(mixed, 'first:trace', today).map((e) => e.id),
  ['small-broken', 'mid-promise-due', 'old-callback', 'huge-review'])

// Prescription is not a preference. It outranks every ordering the agent can pick.
const prescribing = [
  { id: 'rich', kind: 'promise_broken', dueOn: '2026-09-14', outstanding: 900000, prescriptionOn: '2030-01-01' },
  { id: 'expiring', kind: 'review', dueOn: '2026-09-14', outstanding: 900, prescriptionOn: '2026-10-01' },
]
for (const order of ['urgent', 'amount', 'oldest', 'first:promise_broken']) {
  check(`prescription still wins under "${order}"`,
    orderDiary(prescribing, order, today).map((e) => e.id), ['expiring', 'rich'])
}

// An entry with no balance must not throw or sort unpredictably.
check('a missing balance sorts last under amount',
  orderDiary([
    { id: 'none', kind: 'review', dueOn: today },
    { id: 'some', kind: 'review', dueOn: today, outstanding: 10 },
  ], 'amount', today).map((e) => e.id), ['some', 'none'])

check('floatedKind reads a kind out', floatedKind('first:promise_due'), 'promise_due')
check('floatedKind on a plain order is null', floatedKind('urgent'), null)
check('floatedKind refuses a kind that does not exist', floatedKind('first:nonsense'), null)

// Every order offered in the UI must be one orderDiary actually understands.
ok('every offered order is handled', DIARY_ORDER_LABELS.every(
  (o) => ['urgent', 'amount', 'oldest'].includes(o.id) || floatedKind(o.id) !== null))
check('there is one option per kind plus the three general ones',
  DIARY_ORDER_LABELS.length, Object.keys(DIARY_PRIORITY).length + 3)

// Ordering must never lose or duplicate a row.
for (const order of DIARY_ORDER_LABELS.map((o) => o.id)) {
  const out = orderDiary(mixed, order, today)
  if (out.length !== mixed.length || new Set(out.map((e) => e.id)).size !== mixed.length) {
    failures.push(`order "${order}" lost or duplicated a row`)
  } else pass += 1
}

/* ---------- 11. a month at a time ---------- */

const grid = monthGrid('2026-09-14')
// Always six weeks, so the grid does not change height as you page through the year and move
// the day you were about to click.
check('a month grid is six whole weeks', grid.length, 42)
check('it starts on a Monday', new Date(`${grid[0]}T00:00:00Z`).getUTCDay(), 1)
// 1 September 2026 is a Tuesday, so the grid opens on Monday 31 August.
check('it reaches back to finish the first week', grid[0], '2026-08-31')
check('and forward to finish the last', grid[41], '2026-10-11')
ok('every day of September is in it',
  Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`).every((d) => grid.includes(d)))

// A month that begins on a Monday must not gain a blank week in front of it.
const october = monthGrid('2026-10-05')
check('a month starting on a Thursday still starts its grid on a Monday', october[0], '2026-09-28')
// February in a leap year, the classic off-by-one.
const feb = monthGrid('2028-02-10')
ok('a leap February contains the 29th', feb.includes('2028-02-29'))
check('and is still six weeks', feb.length, 42)

check('a day in the month is in the month', inMonth('2026-09-30', '2026-09-14'), true)
check('a neighbour is not', inMonth('2026-10-01', '2026-09-14'), false)
check('nor is the one before', inMonth('2026-08-31', '2026-09-14'), false)

check('next month', shiftMonth('2026-09-14', 1), '2026-10-01')
check('previous month', shiftMonth('2026-09-14', -1), '2026-08-01')
check('across a year end forwards', shiftMonth('2026-12-20', 1), '2027-01-01')
check('across a year end backwards', shiftMonth('2026-01-20', -1), '2025-12-01')
check('a whole year', shiftMonth('2026-09-14', 12), '2027-09-01')

// todayIso must use the LOCAL day. toISOString() would roll a South African evening into
// tomorrow, and an agent would open the app at 22:00 and be shown work that is not due yet.
check('today is the local day, not UTC',
  todayIso(new Date(2026, 8, 14, 23, 30)), '2026-09-14')
check('and pads single digits', todayIso(new Date(2026, 0, 5, 9, 0)), '2026-01-05')

check('today is named', dayName('2026-09-14', today), 'Today')
check('tomorrow is named', dayName('2026-09-15', today), 'Tomorrow')
check('yesterday is named', dayName('2026-09-13', today), 'Yesterday')
check('further out is not', dayName('2026-09-23', today), '')

/* ---------- report ---------- */

if (failures.length > 0) {
  console.error(`FAIL — ${failures.length} of ${pass + failures.length} checks\n`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
/*
 * THE LINE run-all.mjs READS. A file that prints no count is counted as ZERO in the
 * headline and is indistinguishable from a healthy one -- a review of this suite found 20
 * files silent that way, about 800 assertion sites reported as nothing.
 */
console.log(`${pass} passed, 0 failed`)
console.log(`PASS — ${pass} checks: the TypeScript ladder matches the SQL, and a broken PTP`)
console.log('       is worked before a year-old follow-up while an account about to prescribe beats both.')
