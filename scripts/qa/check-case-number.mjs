/**
 * RAPTOR'S OWN CASE NUMBER, AND WHY A NOTICE CANNOT QUOTE THE CLIENT'S REFERENCE.
 *
 * The firm, looking at an SMS that had gone out quoting "dens": "always remember for the
 * reference numbers to have a case number. So this is the case number from Raptor. So that we can
 * find them easily. If they use the client reference, it's more difficult to find."
 *
 * THE BOOK AGREES WITH THEM AND THIS IS THE NUMBER: the client's reference is used on more than
 * one account 5,013 times over, so 5,018 accounts -- 21% of the book -- cannot be identified by
 * it. A debtor reading theirs back down the phone puts the clerk on several files at once.
 *
 * WHAT THIS FILE GUARDS is the pair of confusions that produced the problem, because both of them
 * look correct from one angle:
 *
 *   - THREE DIFFERENT NUMBERS LIVE ON AN ACCOUNT. `case_number` is ours. `account_number` is the
 *     creditor's, off the client's handover sheet -- except when Raptor generated one because the
 *     sheet carried none, which is how it came to be labelled "our reference" on the hero while
 *     being the client's on most rows. `client_reference` is the client's own filing. A notice
 *     must quote the first and the screen must not call any of the others ours.
 *   - THE SMS LENGTH. Swapping the reference for the case number is free only because the two are
 *     the same width; a longer one would push messages past 160 and double what the debtor is
 *     charged under Annexure B item 1(c).
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-case-number.mjs
 */
import { readFileSync } from 'node:fs'
import { MERGE_FIELDS, mergeValuesFor, sampleValues } from '../../src/lib/messageTemplates.ts'
import { smsCost } from '../../src/lib/smsSegments.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const schema = readFileSync('supabase/schema.sql', 'utf8')
const book = readFileSync('src/lib/accountBook.ts', 'utf8')

/* ------------------------------------------------------------------ the three numbers */

const fields = MERGE_FIELDS.collections
const keyed = Object.fromEntries(fields.map((f) => [f.key, f]))

ok('the collections side offers our case number', keyed.case_number !== undefined)
ok('...and still offers the client\'s reference, which the debtor recognises',
  keyed.reference !== undefined)
ok('...and the creditor\'s own account number, which is a third thing',
  keyed.account_number !== undefined)
/*
 * NAMED APART. Two fields whose labels both read "reference" is how somebody writing a notice
 * picks the wrong one, and the wrong one is the one 21% of the book shares.
 */
ok('our case number says it is ours', /our case number/i.test(keyed.case_number.label))
ok('...and the client\'s says it is the debtor\'s',
  /the debtor knows/i.test(keyed.reference.label))

/*
 * AND {{reference}} STILL MEANS WHAT IT ALWAYS MEANT. Flipping it to resolve to Raptor's number
 * would have been the small change -- and it would have silently altered what a field labelled
 * "the reference the debtor knows" puts on every notice already written.
 */
const account = {
  caseNumber: 'RAP-100735',
  debtorKind: 'individual',
  debtorTitle: null,
  debtorFirstName: 'ryno',
  debtorSurname: 'buitendag',
  accountNumber: 'Abc1111',
  clientReference: 'dens',
  capitalOutstanding: 6030.79,
  preferredLanguage: 'en',
}
/* The resolver takes the whole shape, formatter included -- a check that passes only half of it
   dies inside the function rather than reporting anything useful. */
const inputs = {
  account, balance: null, clientName: 'Tjobecom', agentName: 'Stephan', agentPhone: '012 111 2222',
  today: '2026-09-23', money: (n) => `R ${n}`, firm: { firmName: 'Bredell Ferreira' },
}
const values = mergeValuesFor(inputs)
check('our case number resolves to ours', values.case_number, 'RAP-100735')
check('...the client\'s reference still resolves to theirs', values.reference, 'dens')
check('...and the creditor\'s account number to the one on the agreement',
  values.account_number, 'Abc1111')

/*
 * THE FALLBACK STAYS. An account whose client sent no reference falls back to the account number,
 * which is what it always did -- and our case number is unaffected by any of that.
 */
const noRef = mergeValuesFor({ ...inputs, account: { ...account, clientReference: null } })
check('a debtor whose client filed no reference still gets one', noRef.reference, 'Abc1111')
check('...and our case number is the same either way', noRef.case_number, 'RAP-100735')

/* ------------------------------------------------------------------ it is ours, and unique */

ok('the case number is a column on the account', /add column if not exists case_number/.test(schema))
/*
 * UNIQUE AND NOT NULL, both. Either alone is not enough: a nullable one puts "quote RAP-" on a
 * notice, and a non-unique one is the client's reference again under a new name.
 */
ok('...unique, so it means one account for ever',
  /create unique index[^\n]*debtor_accounts_case_number_key/.test(schema))
ok('...and never absent', /alter column case_number set not null/.test(schema))
/*
 * FROM A SEQUENCE, NOT FROM A COUNT. `max + 1` over a table is the implementation that works
 * until two handovers import at once, and then two accounts carry one number.
 */
ok('...handed out by a sequence, so two imports at once cannot collide',
  /nextval\('public\.debtor_account_case_seq'\)/.test(schema))
ok('...and the sequence was moved past the backfill', /setval\('public\.debtor_account_case_seq'/.test(schema))

/*
 * THE MAPPER. A column in the database, in the type and in the select but missing here reads as
 * undefined for ever and nothing fails -- diary_capacity sat in that state for months.
 */
ok('the account mapper reads it back', /caseNumber: r\.case_number/.test(book))
/*
 * AND THE SEARCH FINDS IT, which is the firm's whole ask. A number on every notice that the box
 * a clerk types into cannot find would be worse than the reference it replaced.
 */
ok('the account search looks at the case number', /case_number\.ilike/.test(book))
ok('...as well as the two numbers it always searched',
  /account_number\.ilike/.test(book) && /client_reference\.ilike/.test(book))

/*
 * THE SCREEN DOES NOT CALL SOMEBODY ELSE'S NUMBER OURS. The gold badge read `accountNumber` under
 * a tooltip saying "our reference for this account" -- true when Raptor generated it, false
 * whenever the client's sheet supplied it, which is most rows.
 */
const page = readFileSync('src/pages/accounts/AccountDetail.tsx', 'utf8')
ok('the account hero shows our case number', /\{account\.caseNumber\}/.test(page))
ok('...and no longer claims the creditor\'s number is ours',
  !/title="Our reference for this account"/.test(page))

/* ------------------------------------------------------------------ what it costs in an SMS */

/*
 * THE SWAP IS FREE ONLY BECAUSE THE TWO ARE THE SAME WIDTH. 'GPS3/10103' and 'RAP-100001' are
 * both ten characters, so not one of the twelve messages crosses 160 and doubles from R3.50 to
 * R7.00. A longer case number would have been a price rise on every SMS the firm sends, paid by
 * the debtor, and nothing on any screen would have said so.
 */
const samples = sampleValues()
check('the case number sample is the width of the reference it replaced',
  samples.case_number.length, samples.reference.length)

/*
 * MEASURED MERGED, which is what the network bills for -- the braces never reach a handset. The
 * longest of the firm's twelve, with its worst-case name, rebuilt here so the margin is visible
 * rather than assumed.
 */
const longest = '{{debtor_name}}, {{debtor_id_masked}}. Final notice on matter {{case_number}} '
  + 'emailed to you. Pay or call by {{respond_by}} to avoid legal action. {{firm_phone}}'
const merged = longest.replace(/\{\{([a-z_]+)\}\}/g, (all, f) => samples[f] ?? all)
const cost = smsCost(merged)
check(`the longest SMS is still one message (${cost.units} units)`, cost.segments, 1)
check('...and still GSM-7', cost.encoding, 'GSM-7')
ok(`...with ${160 - cost.units} characters of room left`, cost.units <= 160)

/* ------------------------------------------------------------------ the right half of the library */

/*
 * THE FIRM'S COLLECTIONS WORDING EXISTS TWICE all the way down -- "Dear" against "To the
 * directors of", an identity number against a registration number, summons against liquidation.
 * Offered unfiltered, a collector chooses between two rows whose names differ by one word in
 * brackets, at speed, on an iPad, and the wrong choice tells a person their company is being
 * wound up.
 */
const library = readFileSync('src/lib/templateLibrary.ts', 'utf8')
ok('the library reads the audience back', /audience: \(r\.audience/.test(library))
ok('...and asks the database for it', /attachment_id, audience/.test(library))

const picker = readFileSync('src/components/library/UseTemplate.tsx', 'utf8')
ok('the picker filters by the debtor in front of the collector',
  /r\.audience === audience/.test(picker))
/*
 * A TEMPLATE THAT SUITS EITHER IS ALWAYS OFFERED -- every call script the firm has written is one
 * -- and a caller with no debtor kind filters nothing. A picker that silently hid half the
 * library would be worse than one that shows all of it.
 */
ok('...keeps the wording that suits either', /r\.audience === null/.test(picker))
ok('...and hides nothing when the caller has no debtor to hand', /!audience \|\|/.test(picker))

for (const [what, file] of [
  ['the SMS box', 'src/pages/accounts/SmsModal.tsx'],
  ['the call script', 'src/pages/accounts/CallScriptModal.tsx'],
]) {
  ok(`${what} is told which kind of debtor it is on`,
    /audience=\{debtorKind\}/.test(readFileSync(file, 'utf8')))
}
ok('the email composer is told through the account context it already takes',
  /audience=\{letterContext\.audience\}/.test(readFileSync('src/components/ComposeEmailModal.tsx', 'utf8')))

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-case-number: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
