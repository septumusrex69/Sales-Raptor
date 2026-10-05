/**
 * THE AFFORDABILITY ASSESSMENT, WHICH IS THE ONLY DOCUMENT IN THE LIBRARY THAT ASKS.
 *
 * THE FIRM, sending BF-Financial-Information-Individuals and -Companies: "I think this is the
 * financial information request. We will call them the affordability assessment letters and build
 * them in exactly like the acknowledgement of debt so that they can sign it online."
 *
 * WHAT THIS FILE IS REALLY FOR. Every other letter here is something the firm SAYS, and the worst a
 * broken one does is read badly. This one is a FORM: twelve money lines on the individual's
 * version, every one of them a merge field that only exists because a signing blank fills it. Two
 * lists in two files have to agree completely or a line prints as braces on a document somebody is
 * being asked to sign, or -- worse -- draws a box the document never shows.
 *
 * AND IT MUST NOT BILL ANYBODY. The acknowledgement of debt raises item 4(a), banded on the claim
 * and running to hundreds of rand, because the gazette prices the DRAWING of that instrument.
 * Nothing is drawn here: it is a set of questions. A debtor charged 4(a) for a questionnaire is a
 * wrong charge on a statement the firm has to defend, and it is one line of code away.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-affordability.mjs
 */
import { readFileSync } from 'node:fs'
import { MERGE_FIELDS, isOptionalField, renderTemplate } from '../../src/lib/messageTemplates.ts'
import {
  FILLABLE, blanksFor, missingBlanks, totalOf, withFilled,
} from '../../src/lib/signingBlanks.ts'
import { SIGNABLE_SEED_KEYS, isSignable } from '../../src/lib/signingRules.ts'
import { BY_HAND_SEED_KEYS } from '../../src/lib/byHand.ts'
import { affordability, covering } from '../letters/affordability.mjs'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const letters = JSON.parse(read('scripts/letters/letters.json'))
const docs = Object.fromEntries(['individual', 'company'].map((k) => [k, affordability(k)]))
const texts = Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, JSON.stringify(d)]))
const fieldsIn = (text) => [...new Set(
  [...text.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1]))]

/* ---------------------------------------------------------------------------------------------
 * 1. IT IS BUILT, AND letters.json CARRIES WHAT affordability.mjs MAKES
 * ------------------------------------------------------------------------------------------- */

/* THE FLOOR FIRST. An empty document satisfies most of what follows, which is the vacuous pass
   this suite has been caught by before. */
ok('the individual form has a dozen blocks or more', docs.individual.blocks.length >= 12)
ok('the company form has blocks too', docs.company.blocks.length >= 8)
for (const kind of ['individual', 'company']) {
  check(`letters.json carries the ${kind} form as built`,
    JSON.stringify(letters[`letter-affordability-${kind}`]), texts[kind])
}

/* ---------------------------------------------------------------------------------------------
 * 2. EVERY FIELD IT USES EXISTS, AND EVERY ONE IT ASKS FOR HAS A BOX
 * ------------------------------------------------------------------------------------------- */

const known = new Set(MERGE_FIELDS.collections.map((f) => f.key))
for (const kind of ['individual', 'company']) {
  check(`every field on the ${kind} form is in the collections vocabulary`,
    fieldsIn(texts[kind]).filter((k) => !known.has(k)), [])
}

/*
 * AND THE FORM'S OWN FIGURES ARE BOXES ON THE SIGNING PAGE.
 *
 * THIS IS THE ASSERTION THAT MATTERS MOST. A money line on this form exists only because a signer
 * fills it: Raptor has no column for what somebody earns and never will. A field printed here with
 * no blank behind it can only ever print empty, on a form the debtor is then asked to sign as true
 * and complete.
 */
const fillable = new Set(FILLABLE.map((b) => b.key))
const MONEY_LINES = [
  'income_salary', 'income_other', 'income_partner', 'income_total',
  'expense_housing', 'expense_utilities', 'expense_food', 'expense_transport',
  'expense_school', 'expense_medical', 'expense_credit', 'expense_other', 'expense_total',
  'affordability_left', 'offer_lump_sum',
]
check('every money line on the individual form is a box the signer can fill',
  MONEY_LINES.filter((k) => !fillable.has(k)), [])
check('and every one of them is actually on the form',
  MONEY_LINES.filter((k) => !fieldsIn(texts.individual).includes(k)), [])
/* THE COMPANY'S FORM ASKS FOR A PROPOSAL AND NOT A HOUSEHOLD BUDGET -- the firm's own two PDFs
   differ exactly here, and a form asking a company for its school fees is a form nobody filled. */
check('the company form asks for no household lines',
  fieldsIn(texts.company).filter((k) => k.startsWith('expense_') || k.startsWith('income_')), [])
ok('but it does ask how many instalments',
  fieldsIn(texts.company).includes('offer_instalments'))

/* ---------------------------------------------------------------------------------------------
 * 3. THE TOTALS WORK THEMSELVES OUT, AND CANNOT BE TOLD OTHERWISE
 * ------------------------------------------------------------------------------------------- */

const blankOf = (key) => FILLABLE.find((b) => b.key === key)
const money = { income_salary: '18400', income_other: '1250', income_partner: '4000' }
const spend = {
  expense_housing: '6500', expense_utilities: '1900', expense_food: '4200',
  expense_transport: '2300', expense_school: '2800', expense_medical: '1750',
  expense_credit: '3100', expense_other: '900',
}
check('total income adds the three income lines',
  totalOf(blankOf('income_total'), money), 23650)
check('total expenses adds the eight expense lines',
  totalOf(blankOf('expense_total'), spend), 23450)
check('and what is left is the one less the other',
  totalOf(blankOf('affordability_left'), { ...money, ...spend }), 200)

/*
 * NOTHING ANSWERED IS NOT NOUGHT. Nought is an answer -- "I have no other income" -- and a blank
 * form showing R 0.00 on every line reads as a completed form saying the debtor has nothing, which
 * is a different document from an empty one.
 */
check('an untouched form has no total at all', totalOf(blankOf('income_total'), {}), null)
/* A LINE TYPED BADLY DOES NOT VOID THE SUM. The debtor would be left with no way to see what they
   had done. */
check('a line that is not a number is left out rather than breaking the total',
  totalOf(blankOf('income_total'), { income_salary: '18400', income_other: 'about a thousand' }),
  18400)
/* AND THE FIRM'S OWN FORMATS PARSE. "R18 400,00" is what somebody pastes off a payslip. */
check('a pasted figure with a rand sign and a comma reads as a number',
  totalOf(blankOf('income_total'), { income_salary: 'R18 400,00' }), 18400)

/*
 * AND A TOTAL POSTED BY A BROWSER IS IGNORED.
 *
 * The signing page draws it read-only, so there is nothing to send -- but `filled` is a JSON object
 * that arrived over the wire, and the one field on this form a debtor would gain by editing is the
 * one that says what they can afford. withFilled recomputes it regardless.
 */
const blanks = blanksFor(MONEY_LINES, 'individual')
const merged = withFilled({}, blanks, { ...money, ...spend, affordability_left: '99999' })
check('a total sent by the browser is recomputed rather than believed',
  merged.affordability_left, '200.00')
/* AND IT IS NEVER WHAT HOLDS THE SIGNATURE: nobody types it, so asking for it would hold the
   document over arithmetic rather than over an answer. */
check('a total is never reported missing',
  missingBlanks(blanks, {}).map((b) => b.key).filter((k) => k.endsWith('_total')), [])
/* A COUNT IS A WHOLE NUMBER OF THINGS. "12 months" is a schedule nobody can build. */
ok('a number of instalments typed as words is refused',
  missingBlanks(blanksFor(['offer_instalments'], 'company'), { offer_instalments: '12 months' })
    .length === 1)
ok('...and a plain number is accepted',
  missingBlanks(blanksFor(['offer_instalments'], 'company'), { offer_instalments: '12' })
    .length === 0)

/* ---------------------------------------------------------------------------------------------
 * 3b. AND WHAT THE DEBTOR TYPED IS WRITTEN THE WAY THE FIRM WRITES IT
 * ------------------------------------------------------------------------------------------- */

/*
 * THE FIRST RENDERED FORM SHOWED WHY THIS IS HERE. A debtor who types 18400 had "R 18400" printed
 * on the line above "Total income R 23 650.00" -- two formats for one kind of figure, on one
 * document, with the computed one looking finished and the one they gave looking like a draft. The
 * same page put "2026-11-01" under "The date of the first payment", which is the browser's date
 * input speaking and not a date in a letter.
 *
 * AND IT IS THE SIGNED DOCUMENT this is about, not the screen: what withFilled writes is what the
 * PDF carries, for ever.
 */
const typed = withFilled({}, blanksFor(['income_salary', 'ptp_amount', 'ptp_date'], 'individual'), {
  income_salary: '18400', ptp_amount: 'R2 500,00', ptp_date: '2026-11-01',
})
check('a figure the debtor typed is written out in full', typed.income_salary, '18\u00a0400.00')
check('...however they pasted it', typed.ptp_amount, '2\u00a0500.00')
check('and a date is written as a date in a letter', typed.ptp_date, '1 November 2026')
/*
 * AND AN ANSWER THAT IS NOT A NUMBER OR NOT A DATE IS LEFT EXACTLY AS TYPED. A signer's words are
 * theirs, and a formatter that silently rewrites an answer it did not understand is worse than one
 * that leaves it alone -- the collector reading it needs to see what the debtor actually wrote.
 */
const odd = withFilled({}, blanksFor(['income_salary', 'ptp_date'], 'individual'), {
  income_salary: 'about five hundred', ptp_date: 'next Friday',
})
check('a figure that is not a number is left as the debtor wrote it',
  odd.income_salary, 'about five hundred')
check('and so is a date that is not one', odd.ptp_date, 'next Friday')

/* ---------------------------------------------------------------------------------------------
 * 4. AN UNANSWERED LINE PRINTS BLANK, NOT AS BRACES
 * ------------------------------------------------------------------------------------------- */

/*
 * OPTIONAL MEANS SOMETHING DIFFERENT ON A FORM. On a notice it is "97% of the book cannot answer
 * this". Here it is "the debtor did not fill this line in", which on a form is an answer -- and
 * what prints is "R" with nothing after it, which is exactly what the firm's own paper form looks
 * like before somebody fills it in. The alternative is {{income_other}} on a document somebody is
 * signing as true and complete.
 */
for (const key of MONEY_LINES) {
  ok(`${key} leaves rather than printing braces`, isOptionalField(key))
}
const rendered = renderTemplate(texts.individual, { debtor_name: 'T Mokoena' })
ok('an unanswered form renders without holding on a missing figure',
  !/\{\{\s*(income|expense|affordability|offer)_/.test(rendered.text))

/* ---------------------------------------------------------------------------------------------
 * 5. IT CAN BE SENT FOR SIGNATURE, AND IT RAISES NOTHING
 * ------------------------------------------------------------------------------------------- */

for (const kind of ['individual', 'company']) {
  ok(`the ${kind} form is signable by its seed key`,
    isSignable({ seedKey: `letter-affordability-${kind}`, name: 'anything at all' }))
}
/* AND BY ITS NAME, for a copy the firm writes themselves for one client. Both names: the firm
   renamed the document in the same sentence that asked for it. */
ok('a form the firm names themselves is still signable',
  isSignable({ seedKey: null, name: 'Affordability assessment for Northfield' })
  && isSignable({ seedKey: null, name: 'Financial information request' }))
/* AND NOTHING ELSE BECAME SIGNABLE. A debtor invited to sign a section 129 has signed nothing. */
for (const name of ['Section 129 notice (individual)', 'Final notice (company)',
  'Credit bureau listing notice (individual)', 'Notice of intended summons (individual)']) {
  check(`${name} is still not signable`, isSignable({ seedKey: null, name }), false)
}

/*
 * THE SEED KEYS ARE THE REAL ONES, which they were not.
 *
 * SIGNABLE_SEED_KEYS read ['aod-individual', 'aod-company'] while the rows in the database are
 * seeded as `letter-aod-individual`. The key branch therefore never matched a single template and
 * every acknowledgement of debt was found by the name regex underneath it. It worked, which is why
 * nobody saw it -- and the half it cost is the half the comment claimed was reliable: a firm that
 * renames their own agreement loses the ability to send it for signature, and the name is exactly
 * what the firm edits.
 */
const seeded = read('scripts/letters/seed-affordability.sql')
  + read('scripts/letters/seed-aod.sql')
for (const key of SIGNABLE_SEED_KEYS) {
  ok(`${key} is a key something is actually seeded with`, seeded.includes(`$q$${key}$q$`))
}

/*
 * AND THE FORM RAISES NO CHARGE. See the header: item 4(a) prices the drawing of an
 * acknowledgement of debt, banded on the claim. Nothing is drawn here.
 */
const panel = read('src/pages/accounts/SigningPanel.tsx')
ok('the panel knows the two documents apart', /function docKindOf\(/.test(panel))
ok('...and only one of them charges',
  /charges: true,[\s\S]{0,120}noun: 'acknowledgement of debt'/.test(panel)
  && /charges: false,[\s\S]{0,160}noun: 'affordability assessment'/.test(panel))
ok('...and the charge is asked for only where the document charges',
  /!doc_\.charges \|\| claimAmount === null/.test(panel))
/* AND THE COVERING EMAIL FOLLOWS THE DOCUMENT. "Attached is an acknowledgement of debt" on a form
   asking what somebody earns is a different document described. */
ok('each document has its own covering email',
  /email-affordability-individual/.test(panel) && /email-aod-individual/.test(panel))
ok('...and the one that is sent is the one for the document chosen',
  /coverings\.find\(\(r\) => r\.seedKey === doc_\.covering\[debtorKind\]\)/.test(panel))
/* AND THE ARRANGEMENT IS ALWAYS THE DEBTOR'S ON THIS ONE: the whole document is the question. */
ok('the affordability form never prints the firm’s own promise',
  /!doc_\.offersTerms \|\| leaveBlank/.test(panel))

/* THE COVERING EMAILS ARE NOT OFFERED BY HAND, for the reason the acknowledgement's are not: the
   message is only half a message without the token made at the moment of sending. */
for (const key of ['email-affordability-individual', 'email-affordability-company']) {
  check(`${key} is not in the by-hand picker`, BY_HAND_SEED_KEYS.includes(key), false)
}

/* ---------------------------------------------------------------------------------------------
 * 6. WHAT IT SAYS ABOUT ITSELF
 * ------------------------------------------------------------------------------------------- */

for (const kind of ['individual', 'company']) {
  /*
   * IT IS NOT AN AGREEMENT AND IT DOES NOT HOLD THE ACCOUNT, said on the form and in the email
   * both. A debtor who fills in an affordability assessment and hears nothing for a week will
   * believe the account is on hold -- and the next notice in the sequence goes out regardless.
   */
  ok(`the ${kind} form says it does not suspend the account`,
    /does not suspend the account/.test(texts[kind]))
  ok(`the ${kind} form says it is not an agreement`,
    /not an agreement to accept/.test(texts[kind]))
  ok(`the ${kind} covering email says both too`,
    /does not suspend the account/.test(covering(kind))
    && /not an agreement to accept/.test(covering(kind)))
  /* AND WHERE TO SEND THE DOCUMENTS, which is the whole point of the form: the signing page cannot
     take an upload, so the attachments come back by email. */
  ok(`the ${kind} form says where to send the documents`, /\{\{agent_email\}\}/.test(texts[kind]))
  /* ONE RULE, AND IT IS THE DEBTOR'S -- the firm's decision on the acknowledgement, applied here
     for a stronger reason: the firm is asking for information, not agreeing to anything. */
  check(`the ${kind} form has one signature block`,
    docs[kind].blocks.filter((b) => b.kind === 'signature').length, 1)
  check(`...and it is the debtor's`,
    docs[kind].blocks.find((b) => b.kind === 'signature').signer, 'debtor')
}

/*
 * AND THE RAND SIGNS CAME OFF THE TWO LINES THAT ARE NOT MONEY.
 *
 * The firm's own PDFs print "Day of the month you will pay it  R ___" and "Number of instalments
 * proposed  R ___". Neither is an amount, and a form that draws an R in front of a count is a form
 * somebody answers in rands -- which would reach a collector as an offer to pay twelve rand.
 */
ok('the number of instalments has no rand sign',
  !/R \{\{offer_instalments\}\}/.test(texts.company))
/* AND THE DAY OF THE MONTH IS A REAL DATE. "The 25th" is not something the diary can book. */
check('the first payment is asked as a date',
  blankOf('ptp_date').kind, 'date')
ok('the form asks for a date rather than a day of the month',
  /The date of the first payment/.test(texts.individual)
  && !/Day of the month/.test(texts.individual))

if (failures.length > 0) {
  console.error(`\n${failures.length} failed, ${pass} passed\n`)
  for (const f of failures) console.error(`  ✗ ${f}\n`)
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The only document in the library that ASKS rather than says, so the assertions are about a form:
every money line on it is a box the signer can fill, the two totals work themselves out and ignore
anything a browser posts for them, an unanswered line prints blank rather than as braces, and the
whole thing raises no charge -- item 4(a) prices the drawing of an acknowledgement of debt, and
nothing is drawn here.`)
