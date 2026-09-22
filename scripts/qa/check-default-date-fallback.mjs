/**
 * The date an account opens on when the client's date of default is in the future.
 *
 * THE FIRM, reversing their own instruction of two days earlier: "just say that it can be
 * accepted, but when it's accepted it will be minimum 30 days before handover. Let's make it
 * default three months before handover. However, still send a notification and make a note for
 * the client, send it to the communications department, and make a note on the system."
 *
 * THIS IS A GUESS THE FIRM MAKES ABOUT A DEBTOR'S MONEY, so what has to be checked is not the
 * arithmetic but the things that stop the guess being silent or being wrong in the debtor's
 * disfavour. In duplum, prescription and interest are all measured from this date.
 *
 * THE DIRECTION MATTERS AND IS ASSERTED. Every clock this starts runs against the debtor, so a
 * LATER date is the cautious end: it charges less interest, brings the in duplum ceiling on
 * sooner, and cannot make a live debt look prescribed. Three months back is conservative; three
 * years back would not be.
 */
import { readFileSync } from 'node:fs'
import {
  MIN_DAYS_BEFORE_HANDOVER, MONTHS_BEFORE_HANDOVER,
  substituteDefaultDate, substitutionMessage,
} from '../../src/lib/defaultDateFallback.ts'
import { communicationsNotices } from '../../src/lib/communicationsNotice.ts'

let pass = 0
const failures = []
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)

const days = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)

/* ---------- the firm's two numbers ---------- */

check('three months before handover, as the firm asked', MONTHS_BEFORE_HANDOVER, 3)
check('...and never nearer than thirty days', MIN_DAYS_BEFORE_HANDOVER, 30)

/* ---------- what it produces ---------- */

check('a September handover opens three months back', substituteDefaultDate('2026-09-22'), '2026-06-22')
check('...and one in January crosses the year', substituteDefaultDate('2026-01-15'), '2025-10-15')

/*
 * MONTH ARITHMETIC, NOT NINETY DAYS, so the date lands on a day of the month somebody recognises.
 * Where that day does not exist -- 31 May back three months is 31 February -- it has to fall to
 * the last day of the shorter month. setUTCMonth on its own rolls FORWARD past it, which would
 * make "three months before" land two months back and nothing would say so.
 */
check('31 May falls back to the end of February', substituteDefaultDate('2026-05-31'), '2026-02-28')
check('...and 31 March to 31 December', substituteDefaultDate('2026-03-31'), '2025-12-31')
check('...a leap February is the 29th', substituteDefaultDate('2028-05-31'), '2028-02-29')

/* ---------- the floor ---------- */

/*
 * THIRTY DAYS IS A RULE, THREE MONTHS IS A DEFAULT, and they are not the same kind of thing. The
 * default can be shortened by whoever comes next; the rule was stated by the firm. So the floor
 * is applied after the months rather than assumed to be satisfied by them -- and this asserts it
 * holds for every handover date across a year, not for one.
 */
let tooClose = []
for (let i = 0; i < 365; i += 1) {
  const d = new Date(Date.UTC(2026, 0, 1))
  d.setUTCDate(d.getUTCDate() + i)
  const on = d.toISOString().slice(0, 10)
  const got = substituteDefaultDate(on)
  if (days(got, on) < MIN_DAYS_BEFORE_HANDOVER) tooClose.push(`${on} -> ${got}`)
}
check(`no handover date in a year lands inside thirty days${
  tooClose.length ? ` (${tooClose.slice(0, 3).join(', ')})` : ''}`, tooClose, [])

/*
 * AND THE FLOOR ACTUALLY FIRES, which the loop above cannot show. Three months always clears
 * thirty days, so with the default in place the clamp is unreachable -- deleting it passed every
 * assertion here, across a whole year of handover dates. The months are a parameter for exactly
 * this: shorten the default and the rule the firm stated has to hold on its own.
 */
/* One month back from 15 March is 15 February -- twenty-eight days, so the floor moves it. */
check('shortened to one month over February, the floor moves it',
  substituteDefaultDate('2026-03-15', 1), '2026-02-13')
check('...which is thirty days, not the month', days('2026-02-13', '2026-03-15'), 30)
/*
 * AND IT ONLY FIRES WHEN IT HAS TO. One month back from 22 September is 22 August, thirty-one
 * days, which already clears the rule -- so the substitute is the month, not the floor. A clamp
 * that moved this would be shortening every date to exactly thirty days.
 */
check('...but a month that already clears thirty days is left alone',
  substituteDefaultDate('2026-09-22', 1), '2026-08-22')
check('shortened to nothing at all, it is still thirty days back',
  substituteDefaultDate('2026-09-22', 0), '2026-08-23')
/* Across a month boundary the floor still counts days rather than landing on a day number. */
check('...and over a short month too', substituteDefaultDate('2026-03-15', 0), '2026-02-13')

/*
 * AND IT IS BEFORE, NOT AFTER. A substitute later than the handover would open an account whose
 * default has not happened yet -- the very thing this exists to prevent.
 */
let notBefore = []
for (const on of ['2026-01-01', '2026-02-28', '2026-03-01', '2026-12-31', '2028-02-29']) {
  if (substituteDefaultDate(on) >= on) notBefore.push(on)
}
check('...and always before the handover', notBefore, [])

/* ---------- the sentence that carries it everywhere ---------- */

/*
 * ONE MESSAGE DOING FOUR JOBS: the draft table, the client's email, the batch query, and the
 * account's own note through noteForAccount. So it has to hold BOTH dates -- the one the client
 * sent is what they must correct, and the one we opened on is what every figure is now being
 * calculated from. Naming only one leaves somebody unable to check the other.
 */
const msg = substitutionMessage('15/03/2027', '21/06/2026')
ok('the message names what the client sent', msg.includes('15/03/2027'))
ok('...and the date we opened on', msg.includes('21/06/2026'))
ok('...and says the client still has to confirm it', /client must confirm/i.test(msg))
ok('...and says how the substitute was arrived at', /3 months before handover/.test(msg))

/* ---------- Communications is told ---------- */

const told = communicationsNotices({
  department: ['u1', 'u2'],
  references: ['BF-206'],
  clientName: 'Bredell Ferreira',
  handoverId: 'batch-1',
  actorId: 'lead',
})
check('everyone in the department is told', told.map((n) => n.userId), ['u1', 'u2'])
ok('...what happened', /date of default in the future/i.test(told[0].message))
ok('...to which client', /Bredell Ferreira/.test(told[0].message))
ok('...and that the client still owes us the real date', /confirm the real date/i.test(told[0].message))
/* THE BATCH, not the first account: the question is about a sheet and one answer covers all of
   them. */
check('...linking to the batch', told[0].link, '/accounts?handover=batch-1')

/* Whoever pressed Approve is looking at the result; a bell for your own action is how people
   learn to ignore bells. */
check('the person who approved it is not told',
  communicationsNotices({
    department: ['lead', 'u2'], references: ['BF-206'], clientName: 'X',
    handoverId: 'b', actorId: 'lead',
  }).map((n) => n.userId), ['u2'])
/* Somebody on two Communications teams is one person, not two notifications. */
check('nobody is told twice',
  communicationsNotices({
    department: ['u1', 'u1'], references: ['BF-206'], clientName: 'X', handoverId: 'b',
  }).map((n) => n.userId), ['u1'])
/* Nothing substituted, nothing to say. */
check('a handover with no substitutions tells nobody',
  communicationsNotices({ department: ['u1'], references: [], clientName: 'X', handoverId: 'b' }), [])

/*
 * NAMED WHILE THERE ARE FEW, COUNTED WHEN THERE ARE MANY. Three references answer the question
 * outright; forty is a wall nobody reads, and the batch is one click away.
 */
const few = communicationsNotices({
  department: ['u1'], references: ['A', 'B', 'C'], clientName: 'X', handoverId: 'b',
})
ok('three accounts are named', /\(A, B, C\)/.test(few[0].message))
const many = communicationsNotices({
  department: ['u1'], references: ['A', 'B', 'C', 'D'], clientName: 'X', handoverId: 'b',
})
ok('...and four are counted instead', /4 accounts/.test(many[0].message) && !/\(A, B/.test(many[0].message))

/* ---------- it is actually wired in ---------- */

const lib = readFileSync('src/lib/handoverDraft.ts', 'utf8')
/* THE ACCOUNT OPENS ON THE SUBSTITUTE. Without this the message says one date and the ledger
   uses another, which is worse than refusing the row. */
ok('the account opens on the substituted date',
  /debtor\.handoverDate = row\.planned\.defaultDateUsed/.test(lib))
ok('...and only where the planner set one', /if \(row\.planned\?\.defaultDateUsed\)/.test(lib))
ok('Communications is notified after the accounts are open',
  lib.indexOf('communicationsNotices({') > lib.indexOf('createDebtorAccount('))
ok('...from the teams whose kind is Communications',
  /eq\('teams\.kind', 'Communications'\)/.test(lib))
/* A department with nobody in it is a real gap, and the person who just ran the import is the
   one who can raise it -- so it is said rather than passing quietly. */
ok('...and an empty department is reported', /nobody on a Communications team to tell/.test(lib))
/* NEVER FATAL. A notifications table that refuses must not undo an import that worked; the
   account's own note carries the same fact independently. */
ok('...and a bell that will not ring does not undo the import',
  /communicationsNotices\(\{[\s\S]{0,900}?\} catch \(e\) \{/.test(lib))

/* And the clerk who picks the account up is told what they are holding. */
const suggest = readFileSync('src/lib/noteSuggestion.ts', 'utf8')
ok('the clerk is told the date is ours, not the client’s',
  /default_date: \(\) =>/.test(suggest) && /not one the client/.test(suggest))
ok('...and not to quote a settlement off it', /settlement figure/.test(suggest))

if (failures.length > 0) {
  console.log(`${pass} passed, ${failures.length} failed\n`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A date of default in the future no longer stops the row. The account opens three months before
handover -- never nearer than thirty, and always at the end that is cautious for the debtor, since
every clock this starts runs against them. Nothing about it is silent: the substitute is named on
the draft, in the client's email, on the batch query, in the account's own note, in the clerk's
instruction, and in a notification to everyone in Communications.`)
