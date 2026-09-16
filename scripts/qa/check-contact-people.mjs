/**
 * A company is not reached on a number. It is reached through a PERSON who has one.
 *
 * account_contacts was built for an individual debtor, where every number is theirs and saying so
 * is unnecessary. On a company it is the question a collector has to answer before they dial:
 * four numbers in a flat list is four numbers and a guess, and the call opens with the wrong name.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-contact-people.mjs
 */
import { readFileSync } from 'node:fs'
import { contactsByPerson } from '../../src/lib/contactPeople.ts'

let pass = 0
const failures = []
const ok = (name, actual) => {
  if (actual === true) { pass += 1; return }
  failures.push(`${name}\n    expected true\n    got      ${JSON.stringify(actual)}`)
}
const eq = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const schema = read('../../supabase/schema.sql')
const workspace = read('../../src/lib/accountWorkspace.ts')
const grouping = read('../../src/lib/contactPeople.ts')
const panels = read('../../src/pages/accounts/AccountWorkspacePanels.tsx')
const traceData = read('../../src/lib/traceStoreData.ts')

const C = (over) => ({
  id: 'x', accountId: 'a', kind: 'mobile', value: '0821110000', label: null,
  personName: null, personRole: null, isPrimary: false, verifiedAt: null,
  retiredAt: null, retiredReason: null, notes: null, createdAt: '2026-01-01T00:00:00Z', ...over,
})

/* ---------- grouping ---------- */

const grouped = contactsByPerson([
  /*
   * Peter's ROLE is deliberately on his second row and not his first: whoever typed the number
   * left the job title blank and filled it in when they added the email. Put it on the first row
   * and the assertion below passes whether the fallback exists or not.
   */
  C({ id: 'peterMobile', value: '0830000148', personName: 'Peter Smith' }),
  C({ id: 'switchboard', kind: 'work', value: '0110000148' }),
  C({ id: 'peterEmail', kind: 'email', value: 'peter@example.com', personName: 'Peter Smith', personRole: 'Accounts manager' }),
  C({ id: 'director', value: '0760000263', personName: 'Sipho Radebe', personRole: 'Director' }),
])
eq('the people are told apart', grouped.length, 3)
/*
 * THE COMPANY'S OWN DETAILS FIRST. A switchboard and a registered address belong to the company
 * rather than to anybody at it, and they are what a collector falls back on when the named people
 * do not answer — so they lead rather than being buried under three names.
 */
eq('...with the company itself first', grouped[0].person, null)
/* Everything of one person's under that person, however many ways of reaching them there are. */
eq('...and a person\'s number and email sit together',
  grouped.find((g) => g.person === 'Peter Smith').contacts.map((c) => c.id), ['peterMobile', 'peterEmail'])
/*
 * ONE OF A PERSON'S ROWS CARRIES THEIR JOB TITLE AND THE OTHERS DO NOT — whoever typed the second
 * one did not repeat it. Taking the first row's role would lose it whenever the rows arrive the
 * other way round.
 */
eq('a role given on any of their rows is kept',
  grouped.find((g) => g.person === 'Peter Smith').role, 'Accounts manager')
eq('...and the company has none', grouped[0].role, null)
eq('nobody at all groups into nothing', contactsByPerson([]), [])
/* An individual's contacts carry no person, so they stay one group rather than one each. */
eq('a debtor\'s own contacts are one group',
  contactsByPerson([C({ id: 'a' }), C({ id: 'b', kind: 'email', value: 'x@y.co.za' })]).length, 1)

/* ---------- it is stored, not crammed into a caption ---------- */

ok('whose it is has a column', /add column if not exists person_name text/.test(schema))
ok('...and what they do there', /add column if not exists person_role text/.test(schema))
ok('...with null meaning the debtor themselves',
  /comment on column public\.account_contacts\.person_name/.test(schema))
/* Grouping the panel by person is the query this adds, and it is per account. */
ok('...indexed for the only query it adds',
  /account_contacts_person_idx[\s\S]{0,80}\(account_id, person_name\)/.test(schema))
/*
 * THE HAND-WRITTEN MAPPER AGAIN. A column in the database, in the type and in the select('*') but
 * missing from toContact reads as undefined for ever and nothing fails.
 */
ok('the type carries it', /personName: string \| null/.test(workspace))
ok('...and the mapper reads it off the row', /personName: r\.person_name/.test(workspace))
ok('...and adding a contact can set it', /person_name: input\.personName/.test(workspace))

/*
 * PROMOTING FROM A TRACE WRITES THE COLUMN, not the caption. It used to cram the name into the
 * label because there was nowhere else for it, and a label is free text that nothing can group by
 * — so a company's contacts were a flat run of numbers with names buried in their captions.
 */
ok('a promoted finding records whose it is',
  /personName: asNextOfKin \? item\.value : subjectName/.test(traceData))
/* A next of kin is their own person, and their role is the relationship. */
ok('...and a next of kin is filed as one', /personRole: asNextOfKin \? 'Next of kin' : null/.test(traceData))

/* ---------- and the panel reads as a company rather than a person ---------- */

/*
 * FIXED SLOTS ARE A PERSON'S SHAPE. "Mobile (Primary)", "Residential Address", "Employer" are all
 * facts about a human being; on a company they led the panel with a number nobody could
 * attribute. Everything a company is reached on belongs to somebody, so it lives under them.
 */
ok('a company is not given a person\'s slots', /\{!isCompany && \(\s*\n\s*<>\s*\n\s*<ContactSlot icon="mobile"/.test(panels))
ok('...and says so in the heading', /isCompany \? 'Company details' : 'Debtor details'/.test(panels))
ok('...calling the number a registration number',
  /isCompany \? 'Registration Number' : 'ID Number'/.test(panels))
/* Thirteen digits is an ID, and a registration number is not, so the warning is for people only. */
ok('...and not warning that it is the wrong length', /!isCompany && v && !\/\^\\d\{13\}/.test(panels))
ok('a company lists who to ask for', /Who to ask for/.test(panels))
/* The one the Call button dials, marked where the numbers are. */
ok('...marking the number Call will dial', /c\.isPrimary && \(/.test(panels))
/*
 * A PERSON WE HAVE A NAME FOR AND NO NUMBER FOR. Promoting a relative off a trace stores their
 * NAME as the contact — that is all the bureau gave — so the row printed the name twice.
 */
ok('a name with no number is said once', /c\.value === group\.person \?/.test(panels))
ok('...and says what is missing', /No number yet/.test(panels))
/* A company with nobody on it is incomplete, and the empty state says what fixes it. */
ok('a company with nobody to ask for says so', /Nobody to ask for yet/.test(panels))
/*
 * AND THE FORM ASKS FOR IT. The third field was one free-text box captioned "Whose is it?" — on a
 * company the most important thing on the form, typed into a caption nothing can group by.
 */
ok('adding a company contact asks who to ask for', /Who do you ask for\? \(blank = the company\)/.test(panels))
ok('...and what they do there', /What do they do there\?/.test(panels))
/* An individual keeps the label: "daughter's phone" is a caption, not a contact person. */
ok('an individual still gets a plain label', /Whose is it\? \(optional\)/.test(panels))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A company's contacts belong to people, and the panel says who to ask for. An individual's belong to
the debtor, and it does not — the two accounts are not the same shape and no longer pretend to be.`)
