/**
 * A client's code, and the scale their commission is billed on.
 *
 * THE FIRM asked two things at once: "does every client get a unique code that is generated for
 * it? I like the fact of giving clients numbers" — and "it can either be a fixed commission rate
 * or a sliding scale ... accounts between zero rand and a hundred thousand rand is on a specific
 * commission, then the next tier, then the next tier, and then above the last tier."
 *
 * Both are load-bearing in the same way: neither fails loudly when it is wrong. A duplicate code
 * is two books whose accounts cannot be told apart on a remittance; a scale with its tiers out of
 * order bills every account under the top boundary at the first tier's rate and nothing reports
 * it.
 */
import { codeProblem, proposeClientCode, stemFor } from '../../src/lib/clientCode.ts'
import { rateForCapital, scheduleProblems } from '../../src/lib/commission.ts'

let pass = 0
const failures = []
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)

/* ---------- 1. the shape is the firm's own ---------- */

/*
 * MEASURED AGAINST THE IMPORTED CODES, not invented. These are what Swordfish gave the firm and
 * what their remittances already carry, so the generator has to land on them.
 */
check('Alpha Upgrade Fund (Pty) Ltd', stemFor('Alpha Upgrade Fund (Pty) Ltd'), 'AUF')
check('ABSTO Industrial Supplies (Pty)Ltd', stemFor('ABSTO Industrial Supplies (Pty)Ltd'), 'AIS')
/* "(Pty)" is bracketed out and "Property" is noise, or this would be APP. */
check('Adowa Property Managers (Pty) Ltd', stemFor('Adowa Property Managers (Pty) Ltd'), 'APM')
/* One real word falls back to its first three letters rather than to a single initial. */
check('Namco-SA', stemFor('Namco-SA'), 'NAM')
/* Two words take two letters from the first and one from the second, which is what ACF is. */
check('Accelerate Fitness', stemFor('Accelerate Fitness'), 'ACF')

/*
 * AND THREE OF THE FIRM'S EIGHT ARE NOT DERIVABLE AT ALL, which is the finding worth keeping.
 * Daikin Airconditioning is DAK, Agri Saad is AID1, Growthpoint Student Accommodation is GPS1 —
 * a person chose each of them and no rule reaches them from the name.
 *
 * Asserted as NOT equal on purpose. It is the argument for the code being proposed into a box
 * somebody can overwrite rather than written silently: a generator that was always obeyed would
 * have renamed three of this firm's clients.
 */
for (const [name, theirs] of [
  ['Daikin Airconditioning SA (Pty) Ltd', 'DAK'],
  ['Agri Saad', 'AID'],
  ['Growthpoint Student Accommodation Holdings (RF) Ltd', 'GPS'],
]) {
  ok(`${theirs} is a person's choice, not a rule's (we would say ${stemFor(name)})`,
    stemFor(name) !== theirs)
}

/*
 * NOTHING USABLE COMES BACK EMPTY rather than as a guess. A code nobody can explain on a
 * remittance is worse than a box somebody has to fill in.
 */
check('a name with nothing in it yields no code', stemFor('(Pty) Ltd'), '')
check('...and proposes none', proposeClientCode('?!', []), '')

/* ---------- 2. it counts from 2, the way the data does ---------- */

check('the first of a stem is the bare stem', proposeClientCode('Alpha Upgrade Fund', []), 'AUF')
/*
 * AUF then AUF2, which is what the imported data has. Starting at AUF1 would leave AUF looking
 * like a different client from AUF1.
 */
check('the second gets a 2', proposeClientCode('Alpha Upgrade Fund', ['AUF']), 'AUF2')
check('...and the third a 3', proposeClientCode('Alpha Upgrade Fund', ['AUF', 'AUF2']), 'AUF3')
check('taken codes are compared without case or padding',
  proposeClientCode('Alpha Upgrade Fund', [' auf ']), 'AUF2')

/* ---------- 3. a code somebody typed ---------- */

check('a blank code is refused', typeof codeProblem('', []), 'string')
ok('...saying what it is for', /account references are built on/.test(codeProblem('', [])))
check('a single letter is too short', typeof codeProblem('A', []), 'string')
check('a code starting with a digit is refused', typeof codeProblem('1AB', []), 'string')
check('a code with punctuation is refused', typeof codeProblem('AB-1', []), 'string')
check('a sound one is accepted', codeProblem('BFC', []), null)
check('...and is compared without case', codeProblem('auf', ['AUF']), 'AUF already belongs to another client.')

/* ---------- 4. the sliding scale ---------- */

/* The firm's own example: 0–100k at one rate, then a tier, then above. */
const scale = [{ upTo: 100000, rate: 0.3 }, { upTo: 250000, rate: 0.25 }, { upTo: null, rate: 0.2 }]
check('a well-formed scale has nothing wrong with it', scheduleProblems(scale), [])
check('and it prices each tier', [
  rateForCapital(50000, { source: 'x', bands: scale }),
  rateForCapital(100000, { source: 'x', bands: scale }),
  rateForCapital(150000, { source: 'x', bands: scale }),
  rateForCapital(900000, { source: 'x', bands: scale }),
], [0.3, 0.3, 0.25, 0.2])

/*
 * NO TOP BAND is the one that looks fine. rateForCapital falls through and hands back the last
 * band's rate anyway — right by luck, and wrong the day somebody reorders the tiers.
 */
const noTop = [{ upTo: 100000, rate: 0.3 }, { upTo: 250000, rate: 0.25 }]
ok('a scale with no "and above" tier is reported',
  scheduleProblems(noTop).some((p) => /and above/.test(p)))

/*
 * TIERS OUT OF ORDER bills every account under the top boundary at the FIRST tier's rate,
 * because the bands are read in order and the first that fits wins. Nothing fails; the invoices
 * are simply wrong.
 */
const muddled = [{ upTo: 250000, rate: 0.25 }, { upTo: 100000, rate: 0.3 }, { upTo: null, rate: 0.2 }]
ok('tiers that do not climb are reported',
  scheduleProblems(muddled).some((p) => /climb/.test(p)))
check('...which is not a theoretical worry', rateForCapital(50000, { source: 'x', bands: muddled }), 0.25)

/*
 * A RATE TYPED AS A PERCENTAGE. Commission is a fraction everywhere in Raptor — 0.3 is thirty
 * percent — and CompanyDetail already carries a comment saying 30 here is what made one account
 * read as 2300%.
 */
ok('a rate above 1 is reported as the percentage it must be',
  scheduleProblems([{ upTo: null, rate: 30 }]).some((p) => /fraction, not a percentage/.test(p)))
ok('a rate of nought is reported', scheduleProblems([{ upTo: null, rate: 0 }]).length > 0)
ok('an empty scale is reported', scheduleProblems([]).length > 0)
ok('two "and above" tiers are reported',
  scheduleProblems([{ upTo: null, rate: 0.3 }, { upTo: null, rate: 0.2 }])
    .some((p) => /Only the last tier/.test(p)))
ok('an "and above" tier that is not last is reported',
  scheduleProblems([{ upTo: null, rate: 0.3 }, { upTo: 100000, rate: 0.2 }])
    .some((p) => /has to be the last one/.test(p)))

/* ---------------------------------------------------------------- report */

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A code in the shape the firm's own imported data already uses -- AUF, then AUF2 -- proposed rather
than imposed, and refused where it would collide. And a sliding scale whose three quiet failures
are each reported: no "and above" tier, which is right by luck until somebody reorders it; tiers
that do not climb, which bills every account at the first tier's rate and says nothing; and a rate
typed as 30 rather than 0.3, which is the mistake that once made an account read as 2300%.`)
