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
import { tierStart } from '../../src/lib/commission.ts'

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

/* ---------- 5. where each tier starts, and the confirmation ---------- */

/*
 * THE FIRM: "if it's up to 100,000 for one tier, the next tier should start from 100,001
 * automatically." Shown rather than typed, because two numbers that have to agree are two numbers
 * that drift, and the one nobody re-reads afterwards is the start.
 */
check('the first tier starts at nothing', tierStart(null), 0)
/*
 * A CENT ABOVE THE BOUNDARY, NOT A RAND. rateForCapital is `capital <= upTo`, so the boundary
 * rand belongs to the LOWER band -- commission.ts says it in its own words, "an account handed
 * over at exactly R25,000.00 is 25%, not 22.5%". R100 000.50 is a real capital figure and
 * "From R100 001" would leave it in no tier at all.
 */
check('the next starts a cent above the one before', tierStart(100000), 100000.01)
check('...and not a rand above it', tierStart(100000) === 100001, false)
check('...for any boundary', tierStart(250000), 250000.01)
/*
 * FLOATING POINT, ON A BOUNDARY THAT ACTUALLY SHOWS IT.
 *
 * This first asserted tierStart(12345.67), which proved nothing: that addition is exact in binary
 * and the check stayed green with the rounding removed. A boundary of R20.14 is not -- naively,
 * 20.14 + 0.01 is 20.150000000000002, and a commission scale is not the place to print that.
 * Found by removing the rounding and looking for a value that changed.
 */
check('the cent survives the arithmetic', tierStart(20.14), 20.15)
check('...on the other one that showed it too', tierStart(10.12), 10.13)
/* A tier whose boundary has not been typed yet says so rather than showing a number. */
check('an unfilled boundary has no start to show', tierStart(NaN), null)
check('...nor a boundary of nought', tierStart(0), null)

/* And the screen shows it rather than asking for it. */
ok('the form shows where each tier starts', /startOf\(tiers, i\)/.test(modal))
ok('...through the rule rather than its own arithmetic', /tierStart\(/.test(modal))

/*
 * AND A CONFIRMATION BEFORE IT IS SIGNED, at the firm's instruction: "when you click accept,
 * there should be a confirmation button -- you're about to sign this client on this sliding scale
 * or on this collection commission, confirm."
 *
 * NOT AN "ARE YOU SURE?", which teaches people to click through. It reads the terms back in
 * words, because a rate typed as 3 instead of 30 is invisible in a box and obvious in a sentence
 * -- and every account this client ever hands over inherits it.
 */
ok('signing is a second step, not the first button', /setConfirming\(true\)/.test(modal))
ok('...and the first button says it is a review', /Review and sign/.test(modal))
ok('...and the second says what it does', /Confirm and sign/.test(modal))
/* The RENDERING, not the definition: this first asserted only that `terms` was computed, and
   stayed green when the list stopped showing it. */
ok('the terms are read back in words', /terms\.map\(\(t\) => <li key=\{t\}>\{t\}<\/li>\)/.test(modal))
ok('...worked out from the scale rather than written out', /const terms = kind === 'fixed'/.test(modal))
ok('...naming the client and the code', /You are about to sign/.test(modal))
ok('...and saying every future account inherits it',
  /Every account this client hands over will be billed on this/.test(modal))
/* Back to the form, not out of it: somebody who spots a wrong rate should not retype the address. */
ok('going back keeps what was typed', /setConfirming\(false\)/.test(modal))
/* The mandate is not refused here, so the confirmation is where its absence is said out loud. */
ok('a missing mandate is named on the confirmation',
  /no handover can be imported/i.test(modal))

/* ------------------------------------------- what they signed, shown back to them */
/*
 * THE FIRM: "I don't see anywhere where their collection commission is displayed. They're signing
 * what they're signed on." Signing it on the form and never seeing it again is the same gap the
 * mandate had -- stored, enforced somewhere else, invisible on the page about the client.
 */
const card = src('../../src/components/companies/CommissionCard.tsx')
const page = src('../../src/pages/companies/CompanyDetail.tsx')

ok('the client page shows the commission', /<CommissionCard/.test(page))
/* The element itself, not merely the two strings somewhere in the file: `company={company}`
   appears on half the cards on this page, so matching it loose proves nothing. */
ok('...handed the company rather than an account', /<CommissionCard[^>]*company=\{company\}/.test(page))
ok('the card shows a fixed rate', /of everything collected/.test(card))
ok('...and every tier of a scale', /bands\.map/.test(card))
/* The SAME boundary the form uses. A card that drew its own "from" would be the second
   implementation CLAUDE.md warns about, and the two would disagree by a rand. */
ok('the tier a band starts at comes from tierStart', /tierStart\(/.test(card))
ok('...imported, not rewritten here', /from '\.\.\/\.\.\/lib\/commission/.test(card))
/* A fraction shown raw reads as a third of a percent. */
ok('the stored fraction is turned back into a percentage', /fraction \* 100/.test(card))
/* A warning that fires when nothing is wrong is worse than no warning -- so both of these sit
   behind an absence. */
ok('a client with nothing signed is told so', /Nothing signed/.test(card))
ok('...and a missing mandate is named on the card too', /No mandate on record/.test(card))
ok('the source of the scale is shown where there is one', /commissionBandsSource/.test(card))

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
