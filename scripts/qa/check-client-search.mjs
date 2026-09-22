/**
 * Finding a client by typing at it.
 *
 * THE FIRM: "I don't like the drop down. I think we can have a definitely a better drop down and
 * I should be able to search the client as well. There are other places in the app where I should
 * also be able to search the client where I can't see it currently."
 *
 * A native <select> is a wheel on an iPad, which is the device the firm works on, and the book
 * will hold hundreds of clients. The ranking is the part worth being sure of: get it wrong and
 * the picker technically works while putting the wrong client first, which is how a batch ends up
 * against somebody else's book.
 */
import { readFileSync } from 'node:fs'
import { clientLabel, fold, matchClients, rankClient } from '../../src/lib/clientSearch.ts'

let pass = 0
const failures = []
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)

/* The firm's own codes, and a name chosen to collide with one of them. */
const CLIENTS = [
  { id: 'a', name: 'Bredell Ferreira', code: 'BRF' },
  { id: 'b', name: 'Brookfield Rentals', code: 'BKR' },
  { id: 'c', name: 'Adowa Property Managers', code: 'APM' },
  { id: 'd', name: 'Gauteng Property Services', code: 'GPS3' },
  { id: 'e', name: "O'Brien & Sons", code: null },
  { id: 'f', name: 'Aurora Financial', code: 'AUF' },
]
const found = (q) => matchClients(CLIENTS, q).map((c) => c.id)

/* ---------- 1. the three things people type ---------- */

/*
 * THE CODE, WHICH IS WHAT THE FIRM SAYS OUT LOUD. Somebody who knows a client as BRF should not
 * have to remember how Bredell is spelt, and a native dropdown could only ever jump to the first
 * letter of the NAME.
 */
check('a code finds its client', found('BRF'), ['a'])
/* AS A CODE, not as letters that happen to be in it somewhere. Matched only by the
   includes-anywhere rule it still "works" and sorts below every name match. */
check('...and ranks as one', rankClient(CLIENTS[0], 'BRF'), 0)
check('...with part of a code close behind', rankClient(CLIENTS[3], 'GPS'), 1)
check('...in any case', found('brf'), ['a'])
check('...and part of one', found('GPS'), ['d'])

/*
 * THE CLIENT WHOSE CODE IT IS COMES FIRST. "BRF" is Bredell Ferreira's code and also a run of
 * letters inside "BRookField Rentals" -- b, r, f in order is not a match, but the folded
 * "brookfieldrentals" does not contain "brf" either, so the sharper case is below.
 */
const DECOY = [...CLIENTS, { id: 'z', name: 'Brf Holdings', code: 'BHX' }]
check('an exact code beats a name that merely starts with it',
  matchClients(DECOY, 'BRF').map((c) => c.id), ['a', 'z'])

/* ANY WORD OF THE NAME, not only the first: "ferreira" is what somebody types. */
check('a word inside the name finds it', found('ferreira'), ['a'])
check('...and so does the first word', found('bredell'), ['a'])
check('...and "property" finds both of them, alphabetically',
  found('property'), ['c', 'd'])

/* A RUN OF LETTERS ANYWHERE, last, because it finds what the others miss. */
check('a run of letters inside a word still finds it', found('dowa'), ['c'])

/* ---------- 2. what must not happen ---------- */

check('nothing typed offers everybody', found('').length, CLIENTS.length)
check('...in alphabetical order, not load order',
  matchClients(CLIENTS, '').map((c) => c.name),
  ['Adowa Property Managers', 'Aurora Financial', 'Bredell Ferreira', 'Brookfield Rentals',
    'Gauteng Property Services', "O'Brien & Sons"])
check('a search that matches nobody offers nobody', found('zzzz'), [])
check('a client with no code is still findable by name', found('obrien'), ['e'])
/* Punctuation and case are folded, so the apostrophe somebody does not type is not a wall. */
check("...however they punctuate it", found("o'brien"), ['e'])
check('accents fold too', fold('Müller'), 'muller')

/*
 * TIES KEEP ALPHABETICAL ORDER. A list that reshuffles between two identical searches is one
 * nobody trusts -- and with nothing typed this IS the list, which has to read as the alphabetical
 * one it replaced.
 */
const shuffled = [...CLIENTS].reverse()
check('the same query gives the same order whatever order they arrived in',
  matchClients(shuffled, 'property').map((c) => c.id), ['c', 'd'])

/* A long book is cut off rather than drawn in full: five hundred rows in a panel is a scroll,
   not a list, and the answer is to type more. */
const many = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, name: `Client ${i}`, code: null }))
check('a very long list is capped', matchClients(many, '', 50).length, 50)

/* ---------- 3. what the box shows once one is picked ---------- */

check('the label carries the code', clientLabel(CLIENTS[0]), 'Bredell Ferreira (BRF)')
check('...and manages without one', clientLabel(CLIENTS[4]), "O'Brien & Sons")
check('nothing chosen shows nothing', clientLabel(null), '')

check('a client that matches nothing ranks null', rankClient(CLIENTS[0], 'qqq'), null)

/* ---------- 4. it replaced the dropdowns, in all of them ---------- */

/*
 * THE FIRM: "there are other places in the app where I should also be able to search the client
 * where I can't see it currently." So this is asserted per screen rather than counted -- a count
 * passes while the one screen somebody actually asked about still has a wheel on it.
 */
const src = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const SCREENS = [
  ['components/settings/HandoverImportCard.tsx', 'the handover import'],
  ['pages/accounts/AccountsList.tsx', 'the book’s client filter'],
  ['pages/activities/ActivitiesPage.tsx', 'the activities filter'],
  ['components/layout/QuickAdd.tsx', 'adding a contact'],
  ['pages/companies/CompanyDetail.tsx', 'picking a parent client'],
]
for (const [path, what] of SCREENS) {
  const code = src(path)
  /* The element, not the prefix: /<ClientPicker/ matches <ClientPickerAnythingElse, so renaming
     it left this green. */
  ok(`${what} uses the searchable picker`, /<ClientPicker[\s/>]/.test(code))
  /* PRESENCE BEFORE ABSENCE, and the absence is specific: this screen may keep other selects
     (an owner, a status), so it is the CLIENT one that must be gone. */
  ok(`...and no longer lists clients in a <select>`,
    !/<option key=\{c\.id\}/.test(code) && !/companies\.map\(\(c\) => <option/.test(code))
}

/* ---------------------------------------------------------------- report */

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A client is found by its code, by any word of its name, or by a run of letters anywhere -- and the
client whose code was typed comes first, which is the ranking that stops a batch going against
somebody else's book. The same picker is on all five screens that used to offer a wheel.`)
