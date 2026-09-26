/**
 * Is this debtor a person or a company, and what do we hold on them?
 *
 * THESE RULES DECIDE WHAT GETS SEARCHED AT A BUREAU, and a search costs the firm money and lands
 * on somebody's credit record. A registration number searched as an ID number finds nothing; an
 * ID number with a transposed digit finds SOMEBODY — just not the debtor — and the account is
 * billed Annexure B item 4(c) for the privilege.
 *
 * The flag is the other half. `debtor_kind` has existed since the book was imported and nothing
 * could ever write to it, so three accounts said "company" and the rest defaulted to individual —
 * including sixteen named "(Pty) Ltd" holding a registration number in the ID field. The whole
 * account screen switches on it: what the panel is called, what the identity field is called,
 * whether the contacts are the debtor's own numbers or the people who answer for a company, and
 * what a trace is searched on.
 *
 * Four ways this goes quietly wrong:
 *
 *   - taking a company registration number as an ID number, or the reverse
 *   - checking an ID number's LENGTH rather than its check digit, which passes exactly the
 *     transposition that traces a stranger
 *   - storing the bureau's own prefix (K2016/210735/07) so two spellings of one company never
 *     match a lookup keyed on the number — which is what a CIPC enquiry is
 *   - inferring the flag from a name and flipping an account under somebody mid-call
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-debtor-identity.mjs
 */
import { readFileSync } from 'node:fs'
import {
  cleanDirector, directorProblem, identityProblem, kindFromIdentity,
  looksLikeRegistrationNumber, normaliseRegistrationNumber,
} from '../../src/lib/debtorIdentity.ts'
import { isValidSaId } from '../../src/lib/newDebtor.ts'
import { fullDebtorName } from '../../src/lib/debtorName.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

/* ---------- a registration number ---------- */

check('an ordinary one', normaliseRegistrationNumber('2016/210735/07'), '2016/210735/07')
/*
 * THE BUREAU'S OWN PREFIX IS STRIPPED. XDS writes K2016/210735/07 and the firm's records do not,
 * so stored as given, two spellings of one company never match — and a CIPC enquiry is keyed on
 * exactly this number. Both of the firm's own prefixed records were M-prefixed.
 */
check('the bureau prefix comes off', normaliseRegistrationNumber('K2016/210735/07'), '2016/210735/07')
check('...whatever letter it is', normaliseRegistrationNumber('M2007/034113/07'), '2007/034113/07')
check('...in either case', normaliseRegistrationNumber('k2016/210735/07'), '2016/210735/07')
check('the spaces people type come off', normaliseRegistrationNumber(' 2016 / 210735 / 07 '), '2016/210735/07')
/* A close corporation is /23 or /06 and an incorporated is /08. The pair is the enterprise TYPE,
   not a checksum, and the list changes — so the shape is checked and the pair is not. */
check('a close corporation is one too', normaliseRegistrationNumber('2000/012002/23'), '2000/012002/23')
check('...and a six-digit sequence', normaliseRegistrationNumber('2019/1234/07'), '2019/1234/07')

check('an ID number is not one', normaliseRegistrationNumber('9202090069082'), null)
check('a telephone number is not one', normaliseRegistrationNumber('0821234567'), null)
check('nothing is not one', normaliseRegistrationNumber(null), null)
check('an empty string is not one', normaliseRegistrationNumber('   '), null)
check('...and half of one is not one', normaliseRegistrationNumber('2016/210735'), null)
ok('the predicate agrees with the parser', looksLikeRegistrationNumber('K2016/210735/07'))
check('...in both directions', looksLikeRegistrationNumber('9202090069082'), false)

/* ---------- what the number says the debtor is ---------- */

/*
 * SUGGESTED, NEVER SWITCHED. A registration number in the identity field is proof of a company —
 * nobody types 2019/123456/07 for a person — but an empty field proves nothing, and a book that
 * marked those as people because the field was blank would be worse than one that says nothing.
 */
check('a registration number says company', kindFromIdentity('2016/210735/07'), 'company')
check('...even with the bureau prefix', kindFromIdentity('K2016/210735/07'), 'company')
check('an ID number says nothing either way', kindFromIdentity('9202090069082'), null)
check('an empty field says nothing', kindFromIdentity(''), null)
check('and neither does rubbish', kindFromIdentity('n/a'), null)

/* ---------- what to say about the field ---------- */

/* SAID, NEVER ENFORCED: some records are foreign passports, and refusing to store what a
   collector was given loses the only thing anybody has to work from. */
check('an empty field is not nagged about', identityProblem('individual', ''), null)
check('...on a company either', identityProblem('company', null), null)
check('a good ID on a person is fine', identityProblem('individual', '9202090069082'), null)
check('a good registration on a company is fine', identityProblem('company', '2016/210735/07'), null)

/*
 * NAMED, SO IT GETS FIXED. "Not valid" sends somebody hunting for a typo; saying which field it
 * belongs in gets it moved. The book holds two dozen telephone numbers in the ID column.
 */
ok('a telephone number in the ID field is named as one',
  /telephone number/.test(identityProblem('individual', '0821234567') ?? ''))
ok('a registration number on a person points at the flag',
  /Mark this debtor as a company/.test(identityProblem('individual', '2016/210735/07') ?? ''))
ok('an ID number on a company asks the same question the other way',
  /Is this debtor a person/.test(identityProblem('company', '9202090069082') ?? ''))
ok('something that is neither, on a company, says what one looks like',
  /2016\/210735\/07/.test(identityProblem('company', 'ABC123') ?? ''))
ok('...and on a person says how many digits',
  /13 digits/.test(identityProblem('individual', '12345') ?? ''))

/* ---------- a director ---------- */

/*
 * A NAME IS REQUIRED AND AN ID NUMBER IS NOT, which looks backwards and is not. The ID is the more
 * useful of the two — it is what makes a director traceable alone, and on a suretyship it is who
 * actually owes the money — but a collector reading a letterhead has the names first. Requiring
 * the number until it turns up means the names are never captured at all.
 */
const director = (over = {}) => ({ fullName: 'A Director', idNumber: null, status: 'Active', appointedOn: null, ...over })
check('a name alone is enough', directorProblem(director(), isValidSaId), null)
ok('a director with no name is refused',
  /needs a name/.test(directorProblem(director({ fullName: '  ' }), isValidSaId) ?? ''))
check('a good ID number is accepted',
  directorProblem(director({ idNumber: '9202090069082' }), isValidSaId), null)
check('...and the spaces people type are ignored',
  directorProblem(director({ idNumber: '920209 0069 082' }), isValidSaId), null)

/*
 * LUHN-CHECKED, NOT MERELY THIRTEEN DIGITS. A transposed pair is the commonest way a number is
 * typed wrong and it is thirteen digits either way — a length check passes exactly the number that
 * traces somebody else, at the firm's expense and onto a stranger's record.
 */
const transposed = '9202090069028'
check('a thirteen-digit number is not automatically an ID', isValidSaId(transposed), false)
ok('...and the message says a digit is transposed',
  /transposed/.test(directorProblem(director({ idNumber: transposed }), isValidSaId) ?? ''))
ok('too few digits is said plainly',
  /13 digits/.test(directorProblem(director({ idNumber: '92020900' }), isValidSaId) ?? ''))

const cleaned = cleanDirector({ fullName: '  Jan   van der Merwe ', idNumber: ' 9202090069082 ', status: 'Resigned', appointedOn: '' })
check('a name is tidied on the way in', cleaned.fullName, 'Jan van der Merwe')
check('...and the ID despaced', cleaned.idNumber, '9202090069082')
check('an empty ID is stored as nothing, not as an empty string', cleanDirector(director({ idNumber: '  ' })).idNumber, null)
check('an empty date is too', cleaned.appointedOn, null)
check('the status is carried as given', cleaned.status, 'Resigned')

/* ---------- it reaches the screen ---------- */

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const panels = read('../../src/pages/accounts/AccountWorkspacePanels.tsx')
const detail = read('../../src/pages/accounts/AccountDetail.tsx')
const modal = read('../../src/pages/accounts/DirectorModal.tsx')
const workspace = read('../../src/lib/accountWorkspace.ts')
const standing = read('../../src/lib/accountStandingData.ts')
const sql = read('../../supabase/schema.sql')

/* THE FLAG CAN BE SET. It could be read everywhere and written nowhere, which is the whole bug. */
ok('a debtor can be marked a person or a company',
  /\[\['individual', 'A person'\], \['company', 'A company'\]\] as const/.test(panels))
ok('...and the write reaches the column', /row\.debtor_kind = patch\.debtorKind/.test(workspace))
ok('...and the field it governs is relabelled', /isCompany \? 'Registration number' : 'ID number'/.test(panels))
/* Suggested, never switched: flipping an account under somebody mid-call would relabel their
   panel and refuse their trace search without anybody asking. */
ok('a registration number on a person is pointed out', /kindFromIdentity\(account\.debtorIdNumber\)/.test(panels))
ok('...and not acted on by itself', !/saveDebtorIdentity\([^)]*debtorKind: kindFromIdentity/.test(panels))
ok('the identity warning is the shared rule, not a copy',
  /warn=\{\(v\) => identityProblem\(account\.debtorKind, v\)\}/.test(panels))

/* A registration number is normalised on save; anything else is stored as typed. */
ok('a registration number is normalised on the way in',
  /normaliseRegistrationNumber\(raw\) \?\? \(raw\.replace/.test(workspace))

/* DIRECTORS BY HAND, on a company, with somewhere for the ID number to go. */
ok('a director can be added', /export async function saveDirector/.test(standing))
ok('...and removed', /export async function removeDirector/.test(standing))
ok('...stamped as typed rather than read off a bureau report',
  /source: input\.source \?\? 'manual'/.test(standing))
ok('...with the duplicate said in words', /already on this account/.test(standing))
ok('the modal asks for the ID number', /ID number/.test(modal))
ok('...and says why it matters', /what makes them traceable/.test(modal))
ok('...checking it before Save is pressed', /disabled=\{busy \|\| !!problem\}/.test(modal))
/*
 * THE BUTTON ITSELF, not merely a mention of the flag. This asserted that the string
 * `account.debtorKind === 'company'` appeared somewhere in the file — which it does in four
 * places — so deleting the Add control entirely left the check green. Found by break-testing it.
 */
const directorBlock = detail.slice(
  detail.indexOf('DIRECTORS CAN BE TYPED IN'),
  detail.indexOf('PersonalJudgments judgments='),
)
ok('there is a directors block to read', directorBlock.length > 400)
ok('the panel offers Add on a company', /onClick=\{onAddDirector\}/.test(directorBlock))
ok('...gated on it being one', /account\.debtorKind === 'company' && \(/.test(directorBlock))
ok('...and the handler opens the form', /onAddDirector=\{\(\) => setDirector\(\{ editing: null \}\)\}/.test(detail))
ok('...and the form is rendered', /<DirectorModal/.test(detail))
ok('...and says what to do when there are none', /Nobody recorded yet/.test(detail))
/*
 * CORRECTING IS OFFERED ONLY WHERE IT WAS TYPED. Editing a bureau-reported name in place would
 * leave the account disagreeing with the PDF filed against it, with nothing to say which moved.
 */
ok('only hand-typed directors are editable', /d\.source === 'manual' && \(/.test(detail))

/*
 * The backfill, in the checked-in record.
 *
 * BOUNDED TO ITS OWN STATEMENT, not sliced to the end of the file. It was sliced to the end, and
 * schema.sql is append-only — so the next thing appended to it became part of what this check
 * read. The message-template drafts did exactly that, and the word "empty" in a call script
 * failed a check about company names, because the pattern hunting for "(Pty)" matched the middle
 * of it. Two bugs in one line, both of them the check's.
 */
const backfillFrom = sql.lastIndexOf('-- ---------- A debtor is a person or a company')
const backfill = sql.slice(backfillFrom, sql.indexOf(';', backfillFrom) + 1)
ok('the backfill is in the schema', backfill.length > 400)
/* One statement, counted. `endsWith(';')` is not the same assertion: schema.sql also ends in a
   semicolon, so an unbounded slice satisfies it and this check goes on reading the whole file. */
check('...and it is one statement, not the rest of the file',
  (backfill.match(/;/g) ?? []).length, 1)
ok('...marking on the registration number, which is proof',
  /debtor_id_number ~\* '\^\[A-Z\]\?/.test(backfill))
ok('...normalising the bureau prefix off at the same time', /regexp_replace/.test(backfill))
/*
 * A company-shaped NAME is evidence, not proof — `\bcc\b` matches a person with the initials
 * C.C. — and the cost of being wrong is a real person's account relabelled and their trace
 * refused. What that rule MEANS is that the statement never reads a name column, which is what is
 * asserted here; hunting the SQL text for "pty" was always going to catch an ordinary word.
 */
const statement = backfill.replace(/--[^\n]*/g, '')
ok('...and never on the name alone', !/debtor_surname|debtor_first_name/.test(statement))
ok('...nor on a company-shaped word in the name', !/\(pty\)|\\bcc\\b/i.test(statement))

/* ---------- the name is one line at rest and five columns when you press it ---------- */

/*
 * THE FIRM ASKED FOR THE PARTS AND THEN ASKED FOR THEM BACK TOGETHER.
 *
 * First: "I imported some of this data, but it shows, for example, the full name Zanele Sithole.
 * It doesn't show the surname and the name, stuff like that." So the panel drew all five columns.
 * THAT WAS NOT A COSMETIC REQUEST: the client sheet we were sent held all 45 of its surnames in
 * "Debtor Initials", and every letter is addressed from the surname, so seeing which field holds
 * what IS checking an import.
 *
 * Then, looking at it in use: "I know previously I told you to separate the surname and the
 * things, but rather do it like this. It looks better."
 *
 * SO WHAT THIS FILE NOW HOLDS IS THAT NOTHING WAS LOST, IT MOVED ONE CLICK. The resting state is
 * a name; the editor is still one box per column; and INITIALS — the column the import got wrong
 * — has a field of its own beside the name rather than being folded into it.
 */

/* The string the panel leads with, run rather than described. */
check('a name is written out in full', fullDebtorName({
  debtorTitle: 'Mr', debtorFirstName: 'Ryno', debtorSecondName: null, debtorSurname: 'Buitendag',
}), 'Mr Ryno Buitendag')
/*
 * THE TITLE IS PART OF IT. addressAs falls back to the surname alone when there is none, and the
 * firm found a section 129 of their own opening "Dear buitendag" — so a name with no title in
 * front of it is a thing somebody should see at rest, not only in the editor.
 */
check('...and a missing title is visibly missing', fullDebtorName({
  debtorFirstName: 'Ryno', debtorSurname: 'Buitendag',
}), 'Ryno Buitendag')
check('...with the second given name in its place', fullDebtorName({
  debtorTitle: 'Mrs', debtorFirstName: 'Anna', debtorSecondName: 'Maria', debtorSurname: 'Venter',
}), 'Mrs Anna Maria Venter')
/*
 * EMPTY RATHER THAN A GAP. A name assembled out of nothing must not come back as a space: a blank
 * that occupies a line reads as a name somebody half-finished, and the caller cannot tell it from
 * a real one to say "Not recorded" instead.
 */
check('a name with nothing in it is empty, not blank', fullDebtorName({}), '')
check('...and whitespace counts as nothing', fullDebtorName({ debtorSurname: '   ' }), '')

/*
 * READ OUT OF NameSlot ALONE, not the whole file.
 *
 * Written against the file, three of these assertions were vacuous: `{value || 'Not recorded'}`
 * appears in three slots and `{!isCompany && (` twice, so deleting the one in the name block left
 * the others and the check stayed green. An assertion that can be satisfied by a different part
 * of the same file is not an assertion about the part it names.
 */
const nameSlot = panels.slice(
  panels.indexOf('function NameSlot('),
  panels.indexOf('function ContactSlot('))
ok('NameSlot was actually found, or everything below is about an empty string',
  nameSlot.length > 500)

ok('the panel leads with the whole name', /fullDebtorName\(account\)/.test(nameSlot))
ok('...called what it is', /'Business name' : 'Full name'/.test(nameSlot))
/* A blank is shown as a blank, which is this panel's rule everywhere else. */
ok('...and an empty one says so rather than disappearing', /\{full \|\| 'Not recorded'\}/.test(nameSlot))

/*
 * AND THE COLUMNS ARE STILL FOUR BOXES BEHIND IT. This is the half that keeps the firm's FIRST
 * instruction true: a surname filed under initials is still something a person can see, they
 * press the name to see it. One box per column, each named.
 */
for (const part of ['Title', 'First name', 'Second name', 'Surname']) {
  ok(`the editor still has a box for the ${part.toLowerCase()}`,
    new RegExp(`aria-label="${part}"`).test(nameSlot))
}
/*
 * INITIALS IS ITS OWN SLOT, NOT ONE OF THOSE BOXES — and the two must not both write it. The
 * same column written from two places is the thing CLAUDE.md is a list of.
 */
ok('initials has a field of its own beside the name',
  /label="Initials" value=\{account\.debtorInitials\}/.test(panels))
ok('...saving to the same column', /saveDebtorIdentity\(account\.id, \{ initials: v \}\)/.test(panels))
ok('...and not written from the name editor as well',
  !/aria-label="Initials"/.test(nameSlot) && !/initials,/.test(nameSlot))
/* A company has a name, not a person's shape -- the same rule that keeps "Residential address"
   off a company, and it must keep initials off one too. */
ok('a company has no initials', /\{!isCompany && \(\s*<TextSlot icon="name" label="Initials"/.test(panels))
ok('a company is not broken into a title and a surname',
  /isCompany \? name : fullDebtorName\(account\)/.test(nameSlot))

/* The old unlabelled joined line was the bug, not a smaller version of it: joined, unlabelled,
   and shrinking to just the surname whenever the title and initials were empty. */
ok('...and the unlabelled joined line is still gone',
  !/const formal = \[account\.debtorTitle/.test(nameSlot))

/*
 * AND THE NAME IS IN THE TOP BAR AS WELL, which is where the firm put it: "the full name,
 * Johannes van der Merwe -- you can put it in the hero section up there."
 */
ok('the name is in the top bar', /useTitleSlot\(/.test(detail))
ok('...with the account number beside it', /account\?\.accountNumber && \(/.test(detail))
/* A hook cannot live behind an early return: called after the loading branch it would run on
   some renders and not others, which React refuses outright. */
ok('...and the hook is above the early returns',
  detail.indexOf('useTitleSlot(') < detail.indexOf('if (loading) return'))
/*
 * THE SECOND NAME CAN BE TYPED. It was imported, stored on the row and read by toAccount, with
 * nothing anywhere that could write or show it -- the same failure as a mapper dropping a column,
 * only slower: the value is simply never true again after the day it landed.
 */
ok('the second name has an editor at all', /aria-label="Second name"/.test(nameSlot))
ok('...and saving sends it', /secondName: second/.test(nameSlot))
const writer = read('../../src/lib/accountWorkspace.ts')
ok('...and the writer knows the column',
  /'secondName' in patch.*debtor_second_name/.test(writer))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A debtor can finally be marked a company, a registration number is stored the one way a lookup can
match it, and a director's ID number can be typed in before anybody has paid a bureau for it —
Luhn-checked, because a transposed digit is thirteen digits long and traces a stranger.`)
