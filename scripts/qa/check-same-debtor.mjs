/**
 * One debtor, several accounts — and what may never group two people into one.
 *
 * THE FIRM: "it is also possible for the same debtor to be handed over twice ... the same ID
 * number. You can create something called a linked account ... it will indicate, when you're on
 * an account, this debtor has other accounts, those account numbers, and you would be able to
 * click on that account number and it opens that account."
 *
 * NOTHING IS STORED. Two accounts are one debtor because they carry the same identity number,
 * which is a fact about the rows rather than a relationship somebody made — the same shape as the
 * client position and the account band. So the whole of it is one pure function deciding whether
 * an identifier can be trusted, and that decision is the only thing that can hurt anybody: group
 * on the wrong column and the screen invites a collector to click through to a stranger's debt.
 */
import { readFileSync } from 'node:fs'
import { debtorKey, orderOtherAccounts, LINKED_ACCOUNTS_HEADING } from '../../src/lib/sameDebtor.ts'

let pass = 0
const failures = []
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)

/* ---------- 1. what may be grouped ---------- */

/* A real ID, checksum and all — the same one check-new-debtor.mjs computed for its fixtures. */
const ID = '8503125009089'
ok('a valid ID groups', debtorKey(ID, 'individual') !== null)
check('...and two spellings of it meet', debtorKey('850312 5009 089', 'individual'), debtorKey(ID, 'individual'))

/*
 * THE FAILURE THAT MATTERS, AND IT IS NOT HYPOTHETICAL. Every one of the 45 rows in the client's
 * own sheet had a CELL PHONE NUMBER in the ID column. Grouped on whatever is in that column, two
 * debtors who share a telephone number become one person — on a panel whose whole purpose is to
 * offer a collector a link into "their" other account.
 */
check('a telephone number in the ID column groups with nothing',
  debtorKey('0746013863', 'individual'), null)
check('...and neither does a nine-digit one', debtorKey('746013863', 'individual'), null)
/* Thirteen digits that fail the checksum are a typo, and a typo must not group either: it would
   put one debtor's account under somebody else's mistyped ID. */
check('thirteen digits that fail the checksum group with nothing',
  debtorKey('8503125009098', 'individual'), null)
check('an empty ID groups with nothing', debtorKey('', 'individual'), null)
check('...as does a missing one', debtorKey(null, 'individual'), null)

/*
 * A COMPANY IS ITS REGISTRATION NUMBER, and one registration written two ways is one company:
 * the firm's own is 2019/940923/07.
 */
check('a registration number groups', debtorKey('2019/940923/07', 'company'), 'reg:201994092307')
check('...however it is punctuated',
  debtorKey('2019 940923 07', 'company'), debtorKey('2019/940923/07', 'company'))
/* Short codes group with nothing: a four-digit "reference" in that column would otherwise put
   every business carrying it into one. */
check('a short code groups with nothing', debtorKey('12345', 'company'), null)

/*
 * AND THE KINDS DO NOT CROSS. `debtor_id_number` is ONE column with TWO meanings disambiguated by
 * `debtor_kind` (accountBook.ts says so), so an ID and a registration number that happen to
 * reduce to the same digits must not meet.
 */
const digits = '8503125009089'
ok('a person and a company on the same digits do not group together',
  debtorKey(digits, 'individual') !== debtorKey(digits, 'company'))
/* A kind nobody recognises is not quietly treated as a person. */
check('an unknown kind still needs a valid ID', debtorKey('12345', 'anything'), null)

/* ---------- 2. the order the panel shows them in ---------- */

const rows = [
  { id: 'a', reference: 'ACF10085', clientName: 'X', balance: 500, status: 'Written-off', writtenOff: true },
  { id: 'b', reference: 'ACF10086', clientName: 'X', balance: 200, status: 'Active: Activated', writtenOff: false },
  { id: 'c', reference: 'ACF10087', clientName: 'X', balance: 9000, status: 'Active: Activated', writtenOff: false },
]
/*
 * OPEN FIRST, BIGGEST FIRST. Somebody with a live arrangement on one debt and a write-off from
 * 2019 needs the live one without scrolling.
 *
 * WRITTEN OFF, NOT "SETTLED", and that was not a wording choice. This read `settled` and the
 * select asked debtor_accounts for an `is_settled` column, which does not exist on that table --
 * check-select-columns.mjs refused it, and PostgREST would have rejected the whole request and
 * emptied the panel. The book has five statuses and none of them is settled.
 */
check('the open ones come first, largest balance first',
  orderOtherAccounts(rows).map((r) => r.id), ['c', 'b', 'a'])
/* The input is not reordered in place: it is React state on the page that renders it. */
check('the caller’s array is left alone', rows.map((r) => r.id), ['a', 'b', 'c'])
check('nothing to show is nothing to sort', orderOtherAccounts([]), [])

/* ---------- 3. the word, and the claim it must not make ---------- */

const panel = readFileSync(new URL('../../src/components/collections/OtherAccountsPanel.tsx',
  import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/*
 * THE HEADING IS IN ONE PLACE, because the firm asked the naming question outright — "do we call
 * it linked accounts? Any other possibilities?" — and a word that is going to be reconsidered
 * should not be typed into six files first.
 */
ok('the heading is a constant, not a string in the markup', /LINKED_ACCOUNTS_HEADING/.test(panel))
/*
 * AND IT IS THE FIRM'S OWN WORD, which is a reversal. This asserted the opposite until the firm
 * said, of the same thing on the import screen: "just call it linked account, not other account."
 * The argument against it -- that "linked" invites an unlink button for a grouping nobody linked
 * -- is still in sameDebtor.ts and still true; the words on a screen are the firm's.
 */
ok('the heading uses the firm\u2019s word', /[Ll]inked/.test(LINKED_ACCOUNTS_HEADING))

/*
 * AND THE PANEL SAYS THE BALANCES ARE SEPARATE. Three or four figures under one heading read as
 * parts of a total, and a total is the one thing this must never imply: each account has its own
 * capital, its own in duplum ceiling and its own commission.
 */
ok('the panel says outright that nothing here is a total', /combined total/.test(panel))
ok('...and each row goes to its own account', /\/accounts\/\$\{a\.id\}/.test(panel))
/* Presence before absence: an empty file would satisfy the assertion above it. */
ok('the panel is rendered from the rows', /rows\.length/.test(panel))
ok('...and draws nothing when there are none', /rows\.length === 0\) return null/.test(panel))

/* ---------------------------------------------------------------- report */

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A debtor's accounts are grouped by an identity number the row can be trusted on, and by nothing
else: not by a telephone number sitting in that column, not by thirteen digits that fail their own
checksum, and not across a person and a company that reduce to the same digits. Each is a way two
strangers would have been shown to each other as one person.`)
