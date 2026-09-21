/**
 * Matching a client's PDFs to the accounts in their handover sheet.
 *
 * THE FIRM: "some people give us 200 handovers ... uploading 200 handovers one by one is a
 * tedious task." So filenames do the work — and the failure this guards against is not a file
 * left unmatched, which is visible, but a file matched to the WRONG account, which is not. One
 * debtor's document under another debtor's name is the exact thing the firm named as the way this
 * process goes wrong.
 *
 * So every ambiguity here is REPORTED rather than resolved, and the checks below are mostly about
 * the cases where a tempting guess exists.
 */
import { fold, matchDocuments } from '../../src/lib/documentMatch.ts'

let pass = 0
const failures = []
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)

/* ---------- 1. the five ways a client writes one reference ---------- */

/*
 * A reference is written GPS3/10103 and a filename cannot contain a slash, so clients substitute
 * whatever comes to hand — and not consistently within one folder. All of these are one account.
 */
const REF = 'GPS3/10103'
for (const name of ['GPS3-10103.pdf', 'GPS3_10103.pdf', 'GPS3 10103.pdf', 'gps310103.pdf',
  'Invoice GPS3-10103.pdf', 'Statement_GPS3-10103_Aug2026.pdf']) {
  const plan = matchDocuments({ filenames: [name], references: [REF] })
  check(`"${name}" is that account's`, plan.matched, [{ filename: name, reference: REF }])
}
check('and the folding is what makes them one string', fold('GPS3/10103'), 'GPS310103')

/* ---------- 2. one account, several documents ---------- */

/*
 * NOT AN ERROR. An invoice and a signed agreement are two files about one debt, and the firm's
 * own words are "most handovers only have ONE PDF" — most, not all.
 */
const two = matchDocuments({
  filenames: ['GPS3-10103 invoice.pdf', 'GPS3-10103 agreement.pdf'],
  references: [REF],
})
check('two files for one account are both matched', two.matched.length, 2)
check('...and the account is not reported as missing one', two.withoutDocument, [])

/* ---------- 3. the file that could be two accounts ---------- */

/*
 * LONGEST MATCH WINS WHERE ONE REFERENCE CONTAINS ANOTHER. With BF-04 and BF-047 both on the
 * book, "BF-047.pdf" contains both — and contains the shorter one only incidentally. The longer
 * is the more specific reading and the only one a person would have meant.
 */
const nested = matchDocuments({
  filenames: ['BF-047.pdf'], references: ['BF-04', 'BF-047'],
})
check('the more specific reference wins where one contains the other',
  nested.matched, [{ filename: 'BF-047.pdf', reference: 'BF-047' }])
check('...and the shorter one is simply left without a document',
  nested.withoutDocument, ['BF-04'])

/*
 * TWO REFERENCES OF THE SAME LENGTH IS A COIN-TOSS, AND THIS DOES NOT TOSS IT. A document
 * attached to the wrong account is worse than one not attached at all, because the second is
 * visible and the first is not.
 */
const coin = matchDocuments({
  filenames: ['ACF10085-ACF10086.pdf'], references: ['ACF10085', 'ACF10086'],
})
check('a file that could be either account is reported, not guessed',
  coin.ambiguous, [{ filename: 'ACF10085-ACF10086.pdf', references: ['ACF10085', 'ACF10086'] }])
check('...and is not quietly matched to one of them', coin.matched, [])

/* ---------- 4. a short reference cannot be a coincidence ---------- */

/*
 * "47" appears inside "Invoice 2047.pdf", inside a date and inside half the filenames in a
 * folder. Below four characters the reference has to BE the name rather than appear in it.
 */
const short = matchDocuments({
  filenames: ['Invoice 2047.pdf', '47.pdf'], references: ['47'],
})
check('a short reference does not match a name that merely contains it',
  short.unmatched, ['Invoice 2047.pdf'])
check('...but still matches a file named for it', short.matched, [{ filename: '47.pdf', reference: '47' }])

/* ---------- 5. what is left over, both ways ---------- */

const leftovers = matchDocuments({
  filenames: ['GPS3-10103.pdf', 'scan0001.pdf'],
  references: [REF, 'GPS3/10104'],
})
check('a file nobody can place is named', leftovers.unmatched, ['scan0001.pdf'])
/* Not an error: most handovers arrive with one PDF and some arrive with none. */
check('...and so is an account no file mentions', leftovers.withoutDocument, ['GPS3/10104'])

/*
 * NOTHING IS MATCHED BY POSITION. A folder listing is not a manifest — it sorts differently on
 * every machine and a client's zip may be missing three files. Two files and two references in
 * the same order, with NO reference in either name, must match nothing at all.
 */
const byOrder = matchDocuments({
  filenames: ['scan0001.pdf', 'scan0002.pdf'], references: ['GPS3/10103', 'GPS3/10104'],
})
check('two files and two accounts in order are not paired off',
  [byOrder.matched.length, byOrder.unmatched.length], [0, 2])

/* An empty or extension-only name is not a match for anything. */
check('a file with no name to speak of is unmatched',
  matchDocuments({ filenames: ['.pdf'], references: [REF] }).unmatched, ['.pdf'])
/* And a blank reference in the sheet never claims a file. */
check('a blank reference claims nothing',
  matchDocuments({ filenames: ['scan.pdf'], references: ['', '  '] }).matched, [])

/* ---------------------------------------------------------------- report */

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Two hundred PDFs placed by their filenames, through the five ways a client spells one reference --
and every tempting guess refused instead: a file that could belong to two accounts is reported, a
short reference must BE the filename rather than appear in it, and two files in the same order as
two accounts are not paired off, because a folder listing is not a manifest. A document on the
wrong account is worse than one on no account, since only the second is visible.`)
