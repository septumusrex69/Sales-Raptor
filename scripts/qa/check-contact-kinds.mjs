/**
 * A SAVED CONTACT SAYS WHAT IT IS.
 *
 * THE FIRM, LOOKING AT AN ACCOUNT THEY HAD JUST TRACED: "here by the trace, it's also important to
 * notify when you save something, what is it? Is it a work number? Is it the additional number? Is
 * it an additional email? Is it a house number? ... Now here I've verified next of kins and I
 * don't like see anybody here. I mean these other numbers, it could just be an alternative number,
 * you know. This, the same number, was put in as the alternative number in this one."
 *
 * FOUR FAULTS ON ONE PANEL, AND THE DATA BEHIND IT SHOWS EVERY ONE:
 *
 *   - THE KIND WAS RECORDED AND NEVER DRAWN. Those three rows under "Other numbers" are two WORK
 *     lines and a HOME line. Saved correctly off the trace, shown identically.
 *   - THE NEXT OF KIN WERE SAVED UPSIDE DOWN. Four contacts of kind `other` whose VALUE is a NAME
 *     -- "Elise Ferreira" -- and whose label holds the number. Nothing can dial them, and
 *     otherPeople groups on person_name, which plain Save left null, so they were invisible.
 *   - THE SAME NUMBER WAS ON THE ACCOUNT TWICE, drawn as "Mobile (Primary)" and "Alternative
 *     number" over one telephone.
 *   - AND THE TRACE'S BUTTON SAID "Save", so which of those a finding became was something you
 *     found out afterwards.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-contact-kinds.mjs
 */
import { readFileSync } from 'node:fs'
import { contactWhat, otherPeople } from '../../src/lib/contactPeople.ts'
import { savesAs } from '../../src/lib/traceStore.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const panels = read('src/pages/accounts/AccountWorkspacePanels.tsx')
const workspace = read('src/lib/accountWorkspace.ts')
const traceData = read('src/lib/traceStoreData.ts')
const traceModal = read('src/pages/accounts/TraceWorkspaceModal.tsx')

/* ---------------- what a contact is, in one word ---------------- */

const c = (over) => ({ kind: 'mobile', personRole: null, ...over })
/* THE THREE THE FIRM NAMED, in the words they used for them. */
check('a work line says work', contactWhat(c({ kind: 'work' })), 'Work')
check('a home line says home', contactWhat(c({ kind: 'phone' })), 'Home')
check('a mobile says mobile', contactWhat(c({ kind: 'mobile' })), 'Mobile')
check('an email says email', contactWhat(c({ kind: 'email' })), 'Email')
/*
 * 'other' HAS NO WORD OF ITS OWN. It is the kind a thing gets when nothing else fits, so "Other"
 * beside it tells a reader exactly what they already knew.
 */
check('the catch-all says nothing rather than "Other"', contactWhat(c({ kind: 'other' })), null)
/*
 * AND A PERSON'S ROLE WINS. "Next of kin" says more about a number than "Mobile" does, and it is
 * what stops a collector opening a call to somebody's sister as though she were the debtor.
 */
check('a next of kin is named as one',
  contactWhat(c({ kind: 'phone', personRole: 'Next of kin' })), 'Next of kin')
check('...and it beats the kind', contactWhat(c({ kind: 'mobile', personRole: 'Mother' })), 'Mother')

/* AND THE PANEL DRAWS IT. Recorded and not shown is the state the firm was looking at. */
/* ASSERTED AS THE WHOLE CONDITIONAL, not just as the call. The expression appearing somewhere
   tells you nothing about whether the row draws it -- a `{false && (...)}` around it passes. */
ok('every contact row says what it is',
  /\{contactWhat\(contact\) && \([\s\S]{0,200}?\{contactWhat\(contact\)\}/.test(panels))
ok('...imported from the one place that decides it',
  /import \{ contactWhat,[^}]*\} from '\.\.\/\.\.\/lib\/contactPeople\.ts'/.test(panels))

/* ---------------- the same number is not two numbers ---------------- */

const add = workspace.slice(workspace.indexOf('export async function addContact('))
ok('a contact that is already there is not added again', /const same = await existingContact\(/.test(add))
ok('...and the one already there is handed back rather than an error raised',
  /if \(same\) return same/.test(add))
/*
 * MATCHED ON THE DIGITS. "083 257 3344" and "0832573344" are one telephone, and only a comparison
 * that ignores spaces, brackets and dashes can say so.
 */
const same = workspace.slice(workspace.indexOf('function sameValue('))
ok('a number is its digits', same.includes("value.replace(/[^\\d]/g, '')"))
ok('...with a country code read as the nought it stands for',
  /startsWith\('27'\)[\s\S]{0,80}?`0\$\{digits\.slice\(2\)\}`/.test(same))
ok('...and an email matched without its case', /kind === 'email'\) return value\.trim\(\)\.toLowerCase\(\)/.test(same))
/*
 * AN ADDRESS IS ITSELF. Two ways of writing one street is a judgement for the person looking at
 * them, not for a comparison that would quietly swallow a flat number.
 */
ok('an address is compared as written', /return value\.trim\(\)$/m.test(same))
/*
 * AND A RETIRED ONE IS NOT IN THE WAY. Somebody putting back a number the firm stopped using has
 * decided it is good again, and the new row carries that decision.
 */
const existing = workspace.slice(workspace.indexOf('async function existingContact('))
ok('a number the firm stopped using does not block putting it back',
  /\.is\('retired_at', null\)/.test(existing))

/* ---------------- a linked person lands the right way up ---------------- */

const promote = traceData.slice(traceData.indexOf('export async function promoteTraceItem('))
/*
 * THE NUMBER IS THE CONTACT AND THE NAME IS THE PERSON. Saved the other way round, the account
 * held four names nobody could dial and otherPeople could not see them at all.
 */
ok('a linked person is saved on their number', /value: linkedTo \?\? item\.value/.test(promote))
ok('...under their own name', /personName: item\.kind === 'link' \? item\.value/.test(promote))
ok('...with what connects them as their role', /linkedHow\(item\.label\) \?\? 'Linked person'/.test(promote))
/* DIALABLE, which is the whole point: a person's number is a number. */
ok('...and as a number rather than the catch-all',
  /const personKind = linkedTo \? 'phone' : 'other'/.test(promote))
/*
 * WHERE THERE IS NO NUMBER, NOTHING IS INVENTED. A person linked through an address or an
 * identity number is worth recording and there is nothing to ring.
 */
ok('a person with no number is still recorded', /linkedNumber\(item\.label\)/.test(promote))

/* AND THAT IS WHAT MAKES THEM VISIBLE. otherPeople groups on person_name, which is the field
   plain Save was leaving null -- the firm's "I don't like see anybody here". */
const kin = otherPeople([
  { id: '1', kind: 'phone', value: '0832537190', label: 'Telephone · 0832537190',
    personName: 'Elise Ferreira', personRole: 'Telephone', isPrimary: false, verifiedAt: null,
    retiredAt: null, retiredReason: null, notes: null, accountId: 'a', createdAt: '' },
])
check('a person saved off a trace shows up under the debtor', kin.length, 1)
check('...as themselves', kin[0]?.person, 'Elise Ferreira')

/* ---------------- and the button says what it will save ---------------- */

const item = (over) => ({ kind: 'mobile', value: '0832573344', label: null, ...over })
check('a work line', savesAs(item({ kind: 'work' })), 'a work number')
check('a home line', savesAs(item({ kind: 'phone' })), 'a home number')
check('a mobile', savesAs(item({ kind: 'mobile' })), 'a mobile number')
check('an email', savesAs(item({ kind: 'email' })), 'an email address')
check('an address', savesAs(item({ kind: 'address' })), 'an address')
/* A LINKED PERSON IS NOT ITS OWN KIND: it lands as that person and their number. */
check('a linked person with a number',
  savesAs(item({ kind: 'link', value: 'Elise Ferreira', label: 'Telephone · 0832537190' })),
  'a person and their number')
check('...and one without',
  savesAs(item({ kind: 'link', value: 'Elise Ferreira', label: 'Address · 12 Main Road' })),
  'a linked person')
/* NOTHING FALLS THROUGH TO A BLANK. A button reading "Save as" with nothing after it is worse
   than the bare "Save" it replaced. */
for (const k of ['mobile', 'phone', 'work', 'email', 'address', 'employer', 'directorship', 'property', 'link']) {
  ok(`${k} has something to say`, (savesAs(item({ kind: k })) ?? '').length > 3)
}

ok('the trace button says it', /Save as \{savesAs\(row\.items\[0\]\)\}/.test(traceModal))
ok('...and no longer just says Save', !/<Plus size=\{13\} \/> Save\s*$/m.test(traceModal))

console.log(`\ncheck-contact-kinds: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
