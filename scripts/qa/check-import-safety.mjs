/**
 * THREE THINGS THE FIRST TEST IMPORT FOUND, ON 6 OCTOBER 2026.
 *
 * 1. A COMPANY DEBTOR LOST ITS REGISTRATION NUMBER'S MEANING. The firm: "The Swordfish summary has
 *    no person/business field, so a registration number in 'ID Number' (e.g. 2016/482913/07) is
 *    dropped as 'not 13 digits'... The letter of demand needs {{debtor_reg_no}}."
 *
 *    debtor_accounts was always designed for this -- ONE column with TWO meanings and `debtor_kind`
 *    saying which, "cheaper and less error-prone than two columns of which one is always null". The
 *    VALUE was being stored; the KIND was not, and the kind is what the merge fields read.
 *    {{debtor_reg_no}} resolves only on a company and {{debtor_id_masked}} only on an individual,
 *    so a letter of demand to a company printed nothing where its registration number belongs --
 *    and masked that number as though it were somebody's identity. Eleven accounts on staging.
 *
 * 2. "DELETE EVERYTHING FIRST" SAT NEXT TO AN ORDINARY IMPORT. The firm: "One wrong tick wipes
 *    every client, lead, deal, contact, task, activity and account. Move it behind a 'Start over'
 *    link, say exactly what will be deleted ('1 client and 8 accounts')."
 *
 *    A LIST OF TABLE NAMES IS NOT A WARNING. It reads identically on an empty database and on a
 *    live one, so it says the same the day it costs nothing and the day it costs the firm its book.
 *
 * 3. THE CLIENT REGISTER COULD NOT BE READ ALONE. The firm: "'Read the exports' stays disabled
 *    until the four account files are chosen." Which is backwards from how the work happens: a
 *    client is signed, the mandate is filed, and the first handover arrives weeks later.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-import-safety.mjs
 */
import { readFileSync } from 'node:fs'
import { kindFromIdentity, normaliseRegistrationNumber } from '../../src/lib/debtorIdentity.ts'
import {
  countWhatAWipeWouldDelete, tollIsUnknown, wipeTollLine,
} from '../../src/lib/swordfishImport.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const no = (name, actual) => check(name, actual, false)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* ------------------ 1. a registration number is a company, not a reject ------------------ */

/* THE FIRM'S OWN EXAMPLES, off the staging rows. */
for (const reg of ['2016/482913/07', '2013/100044/07', '2005/140359/07', '1997/595910/23']) {
  check(`${reg} is a company`, kindFromIdentity(reg), 'company')
  check(`...and survives normalising`, normaliseRegistrationNumber(reg), reg)
}
/* A BUREAU PREFIXES A LETTER AND THE FIRM DOES NOT. Two spellings of one company must be one
   string, or a lookup keyed on it misses. */
check('a bureau prefix is stripped', normaliseRegistrationNumber('K2016/482913/07'), '2016/482913/07')
check('...and so are typed spaces', normaliseRegistrationNumber('2016 / 482913 / 07'), '2016/482913/07')
/*
 * AND A REAL ID IS NOT A COMPANY. `kindFromIdentity` answers 'company' or NOTHING, deliberately:
 * its own comment says a company whose number was never captured still looks like an individual
 * here, "and a book that marked those as people because the field was empty would be worse than
 * one that says nothing". So the import falls back to 'individual' and the function does not --
 * asserting 'individual' here failed on correct code, which is the assertion being wrong rather
 * than the rule.
 */
check('thirteen digits is not a company', kindFromIdentity('8610022527087'), null)
check('a cellphone in the ID column is neither', kindFromIdentity('0823456789'), null)
check('...and is not normalised into one', normaliseRegistrationNumber('0823456789'), null)

const summary = code(read('src/lib/swordfishImport.ts'))
ok('the summary import sets the kind off the identity',
  /debtor_kind: kindFromIdentity\(text\(r\['ID Number'\]\)\) \?\? 'individual'/.test(summary))
ok('...and stores the registration number normalised',
  /debtor_id_number: normaliseRegistrationNumber\(text\(r\['ID Number'\]\)\)/.test(summary))

const debtors = code(read('src/lib/swordfishDebtors.ts'))
/* THE ENRICHMENT PATH TOO, which is the one that was calling it a reject. */
ok('the enrichment path reads a registration number',
  /const regNumber = idNumber \? null : normaliseRegistrationNumber\(rawId\)/.test(debtors))
ok('...sets the kind', /patch\.debtor_kind = 'company'/.test(debtors))
no('...and no longer counts it as rejected',
  /if \(rawId && !idNumber\) out\.stats\.idsRejected\+\+/.test(debtors))
ok('...counting it apart instead', /out\.stats\.registrationNumbers\+\+/.test(debtors))

/* ------------------ 2. the wipe says what it would take ------------------ */

/** A fake client: each table reports a count, or an error where `fail` names it. */
const db = (counts, fail = null) => ({
  from: (table) => ({
    select: () => Promise.resolve(
      table === fail ? { count: null, error: { message: 'no' } } : { count: counts[table] ?? 0, error: null }),
  }),
})

{
  const toll = await countWhatAWipeWouldDelete(
    db({ companies: 1, debtor_accounts: 8, leads: 0, deals: 0 }))
  check('the firm’s own example', wipeTollLine(toll), '1 client and 8 accounts')
  no('...and it is known', tollIsUnknown(toll))
}
{
  const toll = await countWhatAWipeWouldDelete(
    db({ companies: 7, debtor_accounts: 23412, leads: 118, deals: 9 }))
  /* `en-ZA` GROUPS THOUSANDS WITH U+00A0, so "23 412" typed with an ordinary space never matches
     and the two strings print identically in the failure. Built rather than typed, for the same
     reason the e2e harness builds it. */
  const NBSP = String.fromCharCode(0xa0)
  check('a real book reads in full',
    wipeTollLine(toll), `7 clients, 23${NBSP}412 accounts, 118 leads and 9 deals`)
}
/* NOTHING TO LOSE IS SAID PLAINLY, which is the case where the tick is harmless. */
check('an empty database says so',
  wipeTollLine(await countWhatAWipeWouldDelete(db({}))), '0 clients and 0 accounts')
/*
 * A COUNT THAT FAILED IS NOT A ZERO. Zero reads as "nothing to lose" -- the one thing this must
 * never say wrongly -- so an unreadable count comes back negative and the screen refuses to offer
 * the wipe at all.
 */
{
  const toll = await countWhatAWipeWouldDelete(db({ companies: 1 }, 'debtor_accounts'))
  ok('an unreadable count is not nothing', tollIsUnknown(toll))
  check('...and reads as negative rather than nil', toll.accounts, -1)
}

const tab = read('src/components/settings/DataImportTab.tsx')
ok('the wipe is behind a link', /Start over instead/.test(tab))
ok('...which has to be opened first', /startOver && \(/.test(tab))
ok('...and it names what would go', /wipeTollLine\(toll\)/.test(tab))
ok('...and refuses where the count is unknown', /tollIsUnknown\(toll\)/.test(tab))
/* THE TYPED CONFIRMATION STAYS. A tick alone was never the whole guard and still is not. */
ok('typing the words is still required', /delete everything/.test(tab))
/*
 * AND THE ORDINARY PATH SAYS WHAT IT DOES. Without this, "Start over instead" is the only sentence
 * on the card about what happens to what is already there.
 */
ok('the ordinary import says it adds', /This ADDS to whatever is already there/.test(tab))

/* ------------------ 3. the register reads on its own ------------------ */

ok('a register with no accounts is readable',
  /const clientsOnly = !haveAccounts && !!files\.clients/.test(tab))
ok('...and that is what enables the button', /const ready = haveAccounts \|\| clientsOnly/.test(tab))
no('...rather than the four required files alone',
  /const ready = SOURCES\.filter\(\(s\) => s\.required\)\.every/.test(tab))
/* THE BUTTON SAYS WHICH JOB IT IS ABOUT TO DO, because "Import 0 accounts" is not an answer. */
ok('the read button names the register', /Read the client register/.test(tab))
ok('the write button counts clients where there are no accounts',
  /plan\.debtorAccounts\.length === 0[\s\S]{0,160}plan\.companies\.length/.test(tab))

console.log(`check-import-safety: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
if (failures.length) process.exit(1)
