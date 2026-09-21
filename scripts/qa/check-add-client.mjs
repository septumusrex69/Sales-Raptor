/**
 * Loading a client straight in, and what a handover may not be imported without.
 *
 * THE FIRM, having added a company and not found it: "it didn't ask me for the type of questions
 * that was asked for the lead -- contact details, contact persons, if they've signed a mandate,
 * what services are they using. This isn't the traditional way of converting a lead to a client,
 * this is just loading a client directly."
 *
 * All of that is learned on the lead -> deal -> Won path. A client with no lead behind it has
 * nowhere to have learned it, so the form has to ask -- once, while somebody has the mandate in
 * front of them.
 *
 * AND: "a client needs a mandate before handover can be imported." A refusal, not a warning.
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)

/* Comments stripped: every rule below is explained beside the code that keeps it, so read as
   written each assertion would be answered by its own explanation. */
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const modal = src('../../src/components/companies/AddClientModal.tsx')
const list = src('../../src/pages/companies/CompaniesList.tsx')
const importCard = src('../../src/components/settings/HandoverImportCard.tsx')

/* ---------- 1. the way in ---------- */

ok('the clients page offers to add one', /Add client/.test(list))
ok('...opening the form built for it', /<AddClientModal/.test(list))

/*
 * THE EMPTY STATE STATES THE WHOLE RULE. It said only "once one of its deals is marked Won",
 * which is half: topLevelClients also accepts a company with a CODE, and every client that came
 * across from Swordfish is on the list through that half. The firm added a company, could not
 * find it, and reasonably read a rule as a bug.
 */
ok('the empty state names the code half of the rule', /client code/.test(list))
ok('...as well as the won-deal half', /marked Won/.test(list))
/* And a search that matches nothing says so, rather than claiming there are no clients at all. */
ok('...and a search with no matches is told apart from an empty book',
  /No client matches that/.test(list))

/* ---------- 2. it asks what the lead path would have learned ---------- */

for (const [what, pattern] of [
  ['the client’s name', /label="Client name"/],
  ['a code', /label="Code"/],
  ['a registration number', /label="Registration number"/],
  ['a VAT number', /label="VAT number"/],
  ['a contact person', /label="Contact person"/],
  ['a telephone number', /label="Telephone"/],
  ['an email address', /label="Email"/],
  ['an address', /label="Address"/],
  ['when the mandate was signed', /label="Mandate signed on"/],
  ['who the liaison is', /label="Client liaison"/],
  ['what they signed for', /What they have signed for/],
  ['where remittance goes', /label="Remittance details"/],
]) {
  ok(`the form asks for ${what}`, pattern.test(modal))
}

/*
 * THE CODE IS PROPOSED AND NOT IMPOSED. Three of the firm's own eight codes cannot be derived
 * from a name by any rule -- a person chose DAK, AID1 and GPS1 -- so the proposal sits in a box
 * that can be overwritten, and stops following the name the moment somebody touches it.
 */
ok('the code is proposed from the name', /proposeClientCode\(/.test(modal))
ok('...and can be typed over', /setTypedCode\(/.test(modal))
ok('...with the typed one winning once it exists', /typedCode \?\? proposed/.test(modal))
ok('...and refused where it would collide', /codeProblem\(/.test(modal))

/* ---------- 3. commission ---------- */

/*
 * EITHER A RATE OR A SCALE, at the firm's instruction: "it can either be a fixed commission rate
 * or a sliding scale ... then the next tier, and then above the last tier would be another one."
 */
ok('one rate or a scale', /'fixed' \| 'scale'/.test(modal))
ok('...with tiers that can be added to', /Another tier/.test(modal))
ok('...and the scale checked before it saves', /scheduleProblems\(/.test(modal))
/*
 * A NEW TIER GOES IN ABOVE THE LAST ONE, because the last is the "and above" band and has to stay
 * last -- scheduleProblems refuses a schedule where it is not, and a form that produced one would
 * be arguing with its own validation.
 */
ok('a new tier is inserted before the "and above" one',
  /prev\.slice\(0, -1\), \{ upTo: '', rate: '' \}, prev\[prev\.length - 1\]/.test(modal))

/*
 * TYPED AS A PERCENTAGE, STORED AS A FRACTION. Everything in Raptor holds commission as 0.3 for
 * thirty percent and a person types 30. Converting at this boundary is the whole guard:
 * CompanyDetail already carries a comment about the account that read as 2300%.
 */
ok('a percentage is converted to a fraction', /n \/ 100/.test(modal))
ok('...and the screen says it is a percentage', /% of what is collected/.test(modal))

/* ---------- 4. no mandate, no handover ---------- */

/*
 * A REFUSAL, NOT A WARNING. Collecting on a book the firm holds no signed mandate for is work it
 * cannot lawfully charge for and cannot defend when the debtor's attorney asks on whose authority
 * the demand was issued -- and by then two hundred accounts are open and letters have gone out.
 */
ok('the import knows whether the client has a mandate', /mandateSignedAt/.test(importCard))
ok('...and refuses to hold a handover without one',
  /noMandate = !!client && !client\.mandateSignedAt/.test(importCard))
ok('...by disabling the button, not by warning beside it',
  /disabled=\{!companyId \|\| !!busy \|\| noMandate\}/.test(importCard))
/* Said when the client is chosen, not after the sheet is read: somebody who has to go and find a
   mandate should not first spend ten minutes on the file. */
ok('...and says so as soon as the client is picked',
  /has no signed mandate on record/.test(importCard))
/* Belt and braces: the function itself returns early, so a button re-enabled in a dev console
   still writes nothing. */
ok('...with the save itself refusing too',
  /if \(!plan \|\| !sheet \|\| !companyId \|\| noMandate\) return/.test(importCard))

/*
 * AND IT IS NOT REFUSED ON THE FORM THAT CREATES THE CLIENT. A client is often loaded while the
 * mandate is in the post, and a form that will not save without a date is a form people fill in
 * with a made-up one. The refusal belongs where the consequence is.
 */
ok('the client form does not demand a mandate date',
  !/mandateSignedAt.*out\.push|out\.push.*mandate/i.test(modal))

/* ---------------------------------------------------------------- report */

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A client loaded directly asks for what the lead path would have learned on the way -- the mandate,
the services, the people, the commission -- and gets a code proposed into a box it can be
overwritten in. The empty state now states the whole rule rather than the half that sent the firm
looking for a bug. And no handover can be held for a client with no signed mandate: refused at the
import, where the consequence is, and not on the form, where it would only teach people to type a
date they do not have.`)
