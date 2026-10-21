/**
 * The working rate an agent sets for themselves, and the warnings that hang off it.
 *
 * Three things are being protected.
 *
 * THE NUMBER HAS TO REACH THE DATABASE. It is written in the app as `diaryCapacity` and stored
 * as `diary_capacity`, converted by a generic camelCase/snake_case rule in AppStore that nobody
 * looks at. The column existed in schema.sql for months while nothing ever wrote to it and
 * nothing ever read it, so every load sentence in the diary quietly used the firm default and
 * looked exactly as if it were working. A name that does not match a column fails silently, and
 * silently is the whole problem.
 *
 * THE BOUNDS ARE REFUSALS, NOT CLAMPS. Zero is a denominator, and 500 is a mistyped 30.
 *
 * AND THE WARNING FIRES AT THE RIGHT ACCOUNT. At the rate, not past it: the thirtieth account
 * of a thirty-a-day desk is the one worth mentioning, because the thirty-first is the one that
 * will not be worked.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-diary-capacity.mjs
 */
import { readFileSync } from 'node:fs'
import {
  DEFAULT_DIARY_CAPACITY, DIARY_KINDS, DIARY_ORDER_GROUPS, DIARY_ORDER_LABELS,
  FIRM_DIARY_ORDER, MAX_DIARY_CAPACITY, MIN_DIARY_CAPACITY,
  atCapacity, dayLoad, orderLabel, validCapacity, validOrder,
} from '../../src/lib/diaryPriority.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

/* ---------- the number a person may type ---------- */

check('a plain rate is taken', validCapacity('25'), 25)
check('a number is taken as well as a string', validCapacity(25), 25)
check('a decimal is rounded rather than refused', validCapacity('24.6'), 25)
check('the floor is allowed', validCapacity(MIN_DIARY_CAPACITY), MIN_DIARY_CAPACITY)
check('the ceiling is allowed', validCapacity(MAX_DIARY_CAPACITY), MAX_DIARY_CAPACITY)

// Every one of these puts the previous number back rather than storing something nobody chose.
check('zero is refused, not clamped to one', validCapacity('0'), null)
check('a negative is refused', validCapacity('-5'), null)
check('500 is refused, not clamped to 200', validCapacity('500'), null)
check('an empty box is refused', validCapacity(''), null)
check('words are refused', validCapacity('thirty'), null)
ok('the bounds are the right way round', MIN_DIARY_CAPACITY < MAX_DIARY_CAPACITY)
ok('the firm default is a rate somebody could have typed', validCapacity(DEFAULT_DIARY_CAPACITY) === DEFAULT_DIARY_CAPACITY)

/* ---------- when the box warns ---------- */

const day = (booked, capacity) => dayLoad({ date: '2026-09-14', booked, capacity })

ok('an empty day is not warned about', !atCapacity(day(0, 30)))
ok('one short of the rate is not warned about', !atCapacity(day(29, 30)))
ok('the rate itself IS warned about', atCapacity(day(30, 30)))
ok('well past the rate is warned about', atCapacity(day(44, 30)))
// The agent's own number, not the firm's: a fifteen-a-day desk is full at fifteen.
ok('a low rate warns earlier', atCapacity(day(15, 15)))
ok('...and 15 of 30 does not warn', !atCapacity(day(15, 30)))
ok('a high rate warns later', !atCapacity(day(44, 60)))
// Nobody has set a rate: the default is what the warning is measured against, not zero.
ok('an unset rate falls back before the test is applied', !atCapacity(day(20, null)))
ok('...and still warns once the default is reached', atCapacity(day(DEFAULT_DIARY_CAPACITY, null)))

/* ---------- the name has to be a real column ---------- */

const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
ok('profiles carries diary_capacity', /diary_capacity/.test(schema))
ok('profiles carries diary_order', /diary_order/.test(schema))

// The exact rule AppStore uses on the way out, applied to the exact key the control writes.
const camelToSnake = (key) => key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
check('diaryCapacity is stored as diary_capacity', camelToSnake('diaryCapacity'), 'diary_capacity')

const control = readFileSync(new URL('../../src/components/diary/DiaryCapacity.tsx', import.meta.url), 'utf8')
const written = [...control.matchAll(/updateUser\([^,]+,\s*\{\s*([A-Za-z]+)\s*:/g)].map((m) => m[1])
ok('the control writes exactly one field', written.length === 1)
check('...and it is diaryCapacity', written[0], 'diaryCapacity')
ok('every field it writes is a real column',
  written.every((f) => new RegExp(`\\b${camelToSnake(f)}\\b`).test(schema)))

/* ---------- the hand-written profile mapper has to carry them ---------- */

/*
 * AppStore converts rows generically; AuthContext lists every field by hand. A column the diary
 * depends on can therefore be in the database, in the type and in the select, and still never
 * reach currentUser. That is exactly the state diary_capacity was in.
 */
const auth = readFileSync(new URL('../../src/store/AuthContext.tsx', import.meta.url), 'utf8')
for (const [column, field] of [['diary_capacity', 'diaryCapacity'], ['diary_order', 'diaryOrder']]) {
  ok(`AuthContext declares ${column} on the row`, new RegExp(`${column}:`).test(auth))
  ok(`AuthContext maps it to ${field}`, new RegExp(`${field}:\\s*row\\.${column}`).test(auth))
}

/* ---------- the order somebody picked has to survive ---------- */

check('a stored order is honoured', validOrder('first:new_account'), 'first:new_account')
check('the firm\u2019s own order is a valid stored value', validOrder(FIRM_DIARY_ORDER), FIRM_DIARY_ORDER)
check('never chosen reads as null, not as an error', validOrder(null), null)
check('an empty string reads as never chosen', validOrder(''), null)
// A kind retired from the ladder leaves stored rows behind. They must read as "never chosen"
// rather than blanking the control or sorting by something that no longer exists.
check('an order we no longer offer is refused', validOrder('first:carrier_pigeon'), null)
check('junk is refused', validOrder('DROP TABLE'), null)
ok('every grouped option is a real order',
  DIARY_ORDER_GROUPS.flatMap((g) => g.options).every((o) => validOrder(o.id) === o.id))
check('the groups offer exactly what the flat list does',
  DIARY_ORDER_GROUPS.reduce((n, g) => n + g.options.length, 0), DIARY_ORDER_LABELS.length)
ok('the firm\u2019s order is one of the options offered',
  DIARY_ORDER_GROUPS.flatMap((g) => g.options).some((o) => o.id === FIRM_DIARY_ORDER))
check('a button never shows a blank order', orderLabel('first:nonsense'), orderLabel(FIRM_DIARY_ORDER))

/* ---------- one rung for one fact ---------- */

/*
 * The firm asked whether a broken PTP and a missed instalment were the same thing, twice, and
 * settled it: they are. "If you've missed an instalment or you missed a PTP, you've missed a
 * payment that you've made."
 *
 * So there must be exactly ONE rung covering both, and its reason has to say so — otherwise an
 * agent with a returned debit order has no obvious rung to reach for and picks the catch-all,
 * where it stops counting as a broken promise at all.
 */
const broken = DIARY_KINDS.promise_broken
ok('the retired rung is gone from the labels', !('payment_default' in DIARY_KINDS))
ok('the surviving rung names the instalment case too', /instalment/i.test(broken.why))
ok('...and the promise-on-a-call case', /promise|agreed/i.test(broken.why))
ok('nothing is called an "arrangement default" any more',
  !Object.values(DIARY_KINDS).some((k) => /arrangement default|missed instalment/i.test(k.label)))
ok('no two rungs read the same',
  new Set(Object.values(DIARY_KINDS).map((k) => k.label)).size === Object.keys(DIARY_KINDS).length)

/* ---------- the warnings are wired to the shared test ---------- */

// Both boxes must ask atCapacity rather than writing `booked >= capacity` again by hand: two
// copies of the threshold is how a warning ends up firing one account late in one of them.
for (const file of ['DiariseModal', 'MoveDiaryModal']) {
  const src = readFileSync(new URL(`../../src/components/diary/${file}.tsx`, import.meta.url), 'utf8')
  ok(`${file} does not re-implement the threshold`, !/booked\s*>=\s*\w*[Cc]apacity/.test(src))
}

const diarise = readFileSync(new URL('../../src/components/diary/DiariseModal.tsx', import.meta.url), 'utf8')
// Warned, never refused, at the firm's instruction — the button must still be pressable.
ok('a full day does not disable the button', !/disabled=\{[^}]*overCapacity/.test(diarise))
ok('a full day changes what the button says', /Book it anyway/.test(diarise))
ok('an acceptance is cleared when the day changes', /setAcceptedOver\(false\)/.test(diarise))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A rate is the agent's own, refused rather than clamped when it is a typo, reaches a column that
actually exists, and warns on the account that fills the day rather than the one after it.`)
