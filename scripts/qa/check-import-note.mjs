/**
 * What the CLIENT's own record says after a handover is imported, and what "Add a debtor" asks.
 *
 * THE FIRM: "in the notes section of the client, I don't see any notes made of any imports that
 * I've made. Of course that's important -- that a handover has been received and imported, this
 * is how many accounts have been imported, just a quick description. And so collections have been
 * added, and then obviously the query that has been logged."
 *
 * EVERYTHING AN IMPORT WROTE WAS FILED AGAINST AN ACCOUNT -- a note per debtor, a query on the
 * batch, a notice to Communications. So the one place a person looks first to ask "what did we
 * get from them in September" said "No activity recorded yet" over a book that had just grown.
 *
 * Run: node --experimental-strip-types scripts/qa/check-import-note.mjs
 */
import { readFileSync } from 'node:fs'
import { importNoteBody, importNoteSubject } from '../../src/lib/importNote.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass += 1
  else failures.push(`${name}\n    expected ${e}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const facts = (over = {}) => ({
  created: 5, capital: 'R 18 050', leftBehind: 0, corrections: 0,
  queryRaised: false, substituted: 0, ...over,
})

/* ---------- the heading ---------- */

/* NAMED FOR THEIR OWN FILE, which is what the client will recognise a week later. */
check('the heading names the sheet', importNoteSubject('handover 3.xlsx'),
  'Handover imported: handover 3.xlsx')

/* ---------- what it says ---------- */

const plain = importNoteBody(facts())
ok(`a clean import says what opened (${plain})`, /5 accounts were opened/.test(plain))
ok('...and what it is worth', /R 18 050/.test(plain))
/*
 * AND NOTHING ELSE. A line reading "0 accounts could not be opened" sends somebody looking for a
 * problem that is not there -- which CLAUDE.md names as the thing that teaches people to stop
 * reading warnings. Every fact is left out entirely when it is nought.
 */
ok('...and says nothing about what did not happen', !/\b0\b/.test(plain))
ok('...including about a query nobody needed', !/query/i.test(plain))

/* ---------- the numbers agree with the words ---------- */

ok('one account is not "1 accounts"', /\b1 account was opened\b/.test(importNoteBody(facts({ created: 1 }))))
ok('one left behind is not "1 accounts"',
  /\b1 account could not be opened\b/.test(importNoteBody(facts({ leftBehind: 1 }))))
ok('...and several are not "3 account"',
  /\b3 accounts could not be opened\b/.test(importNoteBody(facts({ leftBehind: 3 }))))
ok('one to confirm is not "1 of the accounts opened have"',
  /\b1 of the accounts opened has\b/.test(importNoteBody(facts({ corrections: 1 }))))
ok('one substituted date is not "1 accounts opened"',
  /\b1 account opened on a date of default\b/.test(importNoteBody(facts({ substituted: 1 }))))

/* ---------- the query, which is the half the firm asked for by name ---------- */

const told = importNoteBody(facts({ corrections: 2, leftBehind: 1, queryRaised: true }))
ok(`a query that was raised is said (${told})`, /query has been raised/.test(told))
/*
 * AND A QUERY THAT WAS NOT. This is the case worth noticing: corrections with no query is work
 * the client has not been told about, and a note that simply left the sentence out would read
 * exactly like one where everything went to plan.
 */
const untold = importNoteBody(facts({ corrections: 2, leftBehind: 1, queryRaised: false }))
ok(`...and one that was not is said too (${untold})`, /has not been told yet/.test(untold))
/* But not on a clean import, where there was nothing to tell them. */
ok('...and neither on an import with nothing outstanding', !/told yet/.test(plain))

/* The substituted dates, which the client also has to answer. */
ok('a substituted date of default reaches the client’s record',
  /three months before handover/.test(importNoteBody(facts({ substituted: 4 }))))

/* ---------- and the import actually writes it ---------- */

const draft = readFileSync(new URL('../../src/lib/handoverDraft.ts', import.meta.url), 'utf8')
ok('the import writes a note on the client', /from\('activities'\)\.insert\(\{/.test(draft))
ok('...as a Note against the company', /type: 'Note',[\s\S]{0,140}?company_id: judged\.draft\.companyId/.test(draft))
ok('...through the one place the sentence is written',
  /importNoteBody\(\{/.test(draft) && /importNoteSubject\(judged\.draft\.filename\)/.test(draft))
/*
 * THE CAPITAL IS OF WHAT OPENED, not of the draft. judged.totalCapital is the whole sheet's
 * figure and would report money for accounts that never came in -- on the firm's own handover
 * that is the difference between R 18 050 and R 42 685.
 */
ok('...counting only the capital that actually opened',
  /openedCapital \+= row\.planned\?\.capital \?\? 0/.test(draft)
  && /capital: formatCurrency\(openedCapital\)/.test(draft))
/* Whether the client was told is a FACT about this run, not an assumption that raiseQuery worked. */
ok('...and says the client was told only when they were',
  /queryRaised = true/.test(draft) && /let queryRaised = false/.test(draft))
/*
 * LAST, AND NEVER AT THE ACCOUNTS' EXPENSE. It is a record of what happened, so a timeline entry
 * that failed is worth reporting and is not worth losing an import over.
 */
ok('...and a note that fails does not undo the import',
  /catch \(e\) \{[\s\S]{0,200}?was not noted on the client/.test(draft))

/* ---------- "Add a debtor" asks what kind of debtor it is ---------- */

/*
 * THE FIRM: "when you add a debtor, remember we have to account for a company as well -- person
 * or a company or a business. And then you would say, add a debtor: okay, this debtor is an
 * individual or a person."
 *
 * IT CHANGES THE FIELDS UNDER IT, which is the point rather than a nicety. A company has no first
 * name and no ID number; asking one for a thirteen-digit ID is how a registration number ends up
 * in the ID column -- which is what the old handover sheet did on its own, in all 45 rows.
 */
const modal = readFileSync(new URL('../../src/components/companies/AddDebtorModal.tsx', import.meta.url), 'utf8')
ok('the form asks person or business', /Person or business/.test(modal))
ok('...in the firm’s words over the database’s',
  /'individual', 'Person'/.test(modal) && /'company', 'Business'/.test(modal))
ok('...and it reaches the account', /debtorKind: 'individual'/.test(modal))
ok('a business is not asked for a first name', /\{!isCompany && \(\s*<Field label="First name"/.test(modal))
ok('...nor for an ID number', /isCompany \? 'Registration number' : 'ID number'/.test(modal))
ok('...and the box it types into is not capped at thirteen',
  /maxLength=\{isCompany \? 30 : 13\}/.test(modal))
ok('...and a business names itself rather than having a surname',
  /isCompany \? 'Registered name' : 'Surname'/.test(modal))

/* ---------- and it can carry a note ---------- */

/* THE FIRM: "at the add a debtor, there should be a note as well, option for make a note." */
ok('the form takes a note', /const \[note, setNote\] = useState\(''\)/.test(modal))
ok('...which can be spoken', /<DictateButton size="small" value=\{note\} onChange=\{setNote\}/.test(modal))
/* SEPARATE FROM THE ACCOUNT. It is not a field on the ledger; it goes onto the timeline. */
ok('...and is handed over separately from the account',
  /onSave\(form, note\.trim\(\) \|\| null\)/.test(modal))

const detail = readFileSync(new URL('../../src/pages/companies/CompanyDetail.tsx', import.meta.url), 'utf8')
ok('the note is written onto the account', /from\('account_notes'\)\.insert\(\{/.test(detail))
/* AFTER the account, because it hangs off its id. */
ok('...after the account it belongs to',
  detail.indexOf('createDebtorAccount(') < detail.indexOf("from('account_notes').insert({"))
/*
 * AND A NOTE THAT FAILS IS SAID. It is somebody's words about a debtor they have just had on the
 * telephone; losing it silently loses the only record of that call.
 */
ok('...and a note that fails is reported rather than swallowed',
  /the note did not save/.test(detail))

console.log(`${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
