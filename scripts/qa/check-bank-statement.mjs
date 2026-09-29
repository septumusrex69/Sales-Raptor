/**
 * READING THE BANK STATEMENT, WHICH IS WHERE MONEY ENTERS THE FIRM.
 *
 * The allocation engine, the payover runs and the remittance advice were all built and had no
 * front door: the only thing that could write a payment was the Swordfish migration. This is the
 * door, so what it gets wrong is which debtor is credited with somebody's money.
 *
 * THE FIXTURE IS INVENTED, DELIBERATELY. It is shaped exactly like the firm's real FNB export --
 * the same header block, the same channel prefixes, the same reference shapes -- with invented
 * account numbers and invented names. THIS REPOSITORY IS PUBLIC and the real statement is the
 * firm's trust account: 2 160 lines of who paid what. None of it is committed here, and the
 * figures quoted in the comments are counts taken from running the parser over it, never rows.
 *
 * THE FOUR THINGS THAT WOULD GO WRONG SILENTLY:
 *
 *   - A DEBIT READ AS A RECEIPT. 343 of the firm's 2 160 lines are money going OUT -- remittances
 *     to clients. Importing one as a payment credits a debtor with money the firm paid away.
 *   - A NAME READ AS A REFERENCE. "CAPITEC L SOLOMONS" must not produce SOLOMONS. A reference
 *     that matches nothing costs somebody thirty seconds; a reference that matches the WRONG
 *     account costs a debtor their money, and a payment is immutable once processed.
 *   - A SLASHED REFERENCE SPLIT. GPS4/10068 is ONE account number. Split at the slash it becomes
 *     GPS4, which is a real prefix -- so the failure is not "no match", it is a confident match
 *     on the wrong account.
 *   - A RE-UPLOAD DOUBLE-CREDITING. Statements overlap at month ends. Two identical keys means a
 *     receipt imported twice; but keying too coarsely means a debtor who genuinely paid R500
 *     twice in one day is credited once.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-bank-statement.mjs
 */
import { parseBankStatement, referenceFrom, summarise } from '../../src/lib/bankStatement.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

/* ---------------- a statement shaped like the firm's ---------------- */

const STATEMENT = [
  'ACCOUNT TRANSACTION HISTORY',
  '',
  'Name:, Thandi, Mokoena',
  'Account:, 60000000001, [Trust Account]',
  'Balance:, 1000.00, 900.00',
  '',
  'Date, Amount, Balance, Description',
  '2026/09/29, 399.88, 1000.00, FNB APP PAYMENT FROM  QQQ1932',
  '2026/09/29, 500.00, 1500.00, CAPITEC   QQQ1932',
  '2026/09/29, 500.00, 2000.00, CAPITEC   QQQ1932',
  '2026/09/28, 250.00, 2250.00, ABSA BANK ZZZ4/10068',
  '2026/09/28, 120.50, 2370.50, ADT CASH DEPOSOMEWHERE   WWW0296',
  '2026/09/27, 75.00, 2445.50, YYY0049 A NDLOVU',
  '2026/09/27, 60.00, 2505.50, FNB APP PAYMENT FROM  REF:XXX0016',
  '2026/09/27, 40.00, 2545.50, CAPITEC   T MOYO-VVV0060',
  '2026/09/26, 30.00, 2575.50, CAPITEC L SOLOMONS',
  '2026/09/26, 20.00, 2595.50, FNB APP PAYMENT FROM  0104',
  '2026/09/25, 0.00, 2595.50, CR.INT.RATE   4,25000',
  '2026/09/24, -1500.00, 1095.50, ACME TRADING INV-8842',
  '2026/09/24, -95.00, 1000.50, SERVICE FEE',
].join('\n')

const s = parseBankStatement(STATEMENT)

/* ---------------- the header block, which is not a table ---------------- */

/* parseCsv takes the first row as the header; here the first row is a title, which is why this
   file reads rows itself. Getting the account wrong would key every line to the wrong account. */
check('the firm’s own account is read', s.accountNumber, '60000000001')
check('...and whose it is', s.accountName, 'Thandi Mokoena')
/* The firm banks debtor money and client money separately -- a debtor pays IN to trust. */
check('...and which account it is', s.accountLabel, 'Trust Account')
/* NOTHING IS DROPPED QUIETLY. A statement that half-imports is worse than one that refuses,
   because the difference shows up later as a debtor who says they paid. */
check('every line was read', s.problems, [])
check('...all of them', s.lines.length, 13)

/* ---------------- credits, debits and notes are three different things ---------------- */

const sum = summarise(s.lines)
check('the credits', sum.credits, 10)
check('...and what they came to', sum.creditTotal, 1995.38)
/* MONEY GOING OUT IS NOT A RECEIPT. */
check('the debits are counted apart', sum.debits, 2)
check('...and reported as a positive figure', sum.debitTotal, 1595)
/* Zero-amount interest-rate notices: kept so the line count reconciles to the file, so a dropped
   line can be told from an excluded one. */
check('the zero-amount notices are neither', sum.notes, 1)
check('and the three kinds account for every line',
  sum.credits + sum.debits + sum.notes, s.lines.length)

/* A DEBIT NEVER CARRIES A REFERENCE. Its description names the CLIENT being paid, so reading an
   account number out of it would offer to match a remittance to a debtor. */
check('no debit carries a reference',
  s.lines.filter((l) => l.direction === 'debit' && l.reference !== null).length, 0)

/* ---------------- the reference, behind whatever the bank put in front of it ---------------- */

check('FNB app', referenceFrom('FNB APP PAYMENT FROM  QQQ1932'), 'QQQ1932')
check('Capitec', referenceFrom('CAPITEC   WWW0296'), 'WWW0296')
check('ABSA', referenceFrom('ABSA BANK PPP11708'), 'PPP11708')
check('a cash deposit at a branch', referenceFrom('ADT CASH DEPOSOMEWHERE   WWW0296'), 'WWW0296')
check('a scheduled payment', referenceFrom('SCHEDULED PYMT FROM   QQQ1494'), 'QQQ1494')
check('no prefix at all', referenceFrom('IBM10023'), 'IBM10023')
/* The statement carries "rsw0296" as often as "RSW0296"; an account number is not case. */
check('lower case is still a reference', referenceFrom('www0296'), 'WWW0296')

/*
 * CAPITEC MPY MUST BE STRIPPED BEFORE CAPITEC. MPY is itself a real client prefix on this book,
 * so stripping the shorter prefix first leaves "MPY" standing where a reference should be -- a
 * collision that files a payment against a wrong account rather than failing to file it.
 */
check('the longer channel prefix wins', referenceFrom('CAPITEC MPY MPY4174'), 'MPY4174')

/* ---------------- a reference the debtor annotated ---------------- */

/* People write the reference, then their name. 47 receipts a month on the firm's own statement. */
check('a name after the reference', referenceFrom('YYY0049 A NDLOVU'), 'YYY0049')
check('a name before it', referenceFrom('CAPITEC   W BENEKE MSS0075'), 'MSS0075')
check('a bracketed name', referenceFrom('FNB APP PAYMENT FROM  QQQ1974 (MOSALA L)'), 'QQQ1974')
check('the word REF', referenceFrom('FNB APP PAYMENT FROM  REF:XXX0016'), 'XXX0016')
check('an underscore suffix', referenceFrom('WWW5280_S'), 'WWW5280')
check('a hyphen against a surname', referenceFrom('CAPITEC   T MOYO-VVV0060'), 'VVV0060')

/* ---------------- and the two ways it must refuse ---------------- */

/*
 * A NAME IS NEVER A REFERENCE. The shape requires digits, which is what keeps a surname out --
 * and over 1 815 real credits nothing without a digit was ever returned.
 */
check('a depositor’s name is not a reference', referenceFrom('CAPITEC L SOLOMONS'), null)
check('...nor a company’s', referenceFrom('MARARA PHARMACY'), null)
check('...nor two words of one', referenceFrom('RUBAN MAINTENANCE'), null)
/* DIGITS ALONE ARE NOT ENOUGH. "0104" could be anything; a prefix is what ties it to a client. */
check('bare digits are not a reference', referenceFrom('FNB APP PAYMENT FROM  0104'), null)
check('an empty description', referenceFrom(''), null)

/*
 * THE SLASHED SERIES IS ONE ACCOUNT NUMBER, AND THIS IS THE SHARPEST ASSERTION HERE. ZZZ4/10068
 * split at the slash yields ZZZ4 -- which satisfies the unslashed shape and is a real prefix. So
 * the failure mode is not "no match", it is a CONFIDENT MATCH ON THE WRONG ACCOUNT, which is the
 * one outcome this whole file exists to prevent.
 */
check('a slashed reference stays whole', referenceFrom('ABSA BANK ZZZ4/10068'), 'ZZZ4/10068')
check('...even bare', referenceFrom('ZZZ3/20038'), 'ZZZ3/20038')
/* AND SPLITTING IS STILL AVAILABLE where the whole token is plainly not a reference. */
check('a reference joined to something else is still found',
  referenceFrom('WWW4163/SEB029'), 'WWW4163')

/* ---------------- a re-upload cannot credit anybody twice ---------------- */

const keys = s.lines.map((l) => l.key)
check('every line has its own key', new Set(keys).size, keys.length)

/* READING THE SAME FILE AGAIN PRODUCES THE SAME KEYS, which is what makes the unique index in the
   database refuse the second import rather than duplicating it. */
const again = parseBankStatement(STATEMENT)
check('re-reading the file gives the same keys', again.lines.map((l) => l.key), keys)

/*
 * AND TWO GENUINE PAYMENTS ARE NOT ONE. The fixture has a debtor paying R500 twice on the same
 * day with an identical description -- lines 2 and 3. Keying on date, amount and description
 * alone would collapse them and lose R500 of somebody's money, so identical tuples are numbered
 * in file order.
 */
const twice = s.lines.filter((l) => l.amount === 500 && l.date === '2026-09-29')
check('the same payment made twice in a day is two lines', twice.length, 2)
check('...with different keys', twice[0].key !== twice[1].key, true)
/* The occurrence index is the ONLY thing separating them, so it has to be in the key. */
ok('...separated by an occurrence number',
  twice[0].key.replace(/\|\d+$/, '') === twice[1].key.replace(/\|\d+$/, ''))

/* THE KEY MOVES WITH EVERY PART OF THE LINE, or two different receipts collide. */
const other = parseBankStatement(STATEMENT.replace('399.88', '399.89'))
ok('a different amount is a different key', other.lines[0].key !== s.lines[0].key)
const otherDay = parseBankStatement(STATEMENT.replace('2026/09/29, 399.88', '2026/09/30, 399.88'))
ok('a different date is a different key', otherDay.lines[0].key !== s.lines[0].key)
/* THE FIRM'S OWN ACCOUNT IS IN THE KEY, so a trust statement and a business statement carrying
   the same amount on the same day are two receipts rather than one. */
const otherAcct = parseBankStatement(STATEMENT.replace('60000000001', '60000000002'))
ok('a different bank account is a different key', otherAcct.lines[0].key !== s.lines[0].key)

/* ---------------- what cannot be read is reported ---------------- */

const broken = parseBankStatement([
  'Date, Amount, Balance, Description',
  '2026/09/29, 100.00, 0.00, FNB APP PAYMENT FROM  QQQ1932',
  '2026/09/29, not-a-number, 0.00, SOMETHING',
  'total for the month, , , ',
].join('\n'))
check('the good line is still read', broken.lines.length, 1)
check('...and the two bad ones are named', broken.problems.length, 2)
ok('...saying which line', /Line 3/.test(broken.problems[0]))

/*
 * A DATE THAT IS ONLY WELL-SHAPED IS NOT A DATE. 2026/02/31 is a corrupt export, and accepting it
 * would give a payment a received_at the bank never wrote.
 */
const impossible = parseBankStatement([
  'Date, Amount, Balance, Description',
  '2026/02/31, 100.00, 0.00, QQQ1932',
].join('\n'))
check('an impossible date is refused', impossible.lines.length, 0)
check('...and reported', impossible.problems.length, 1)

/*
 * THE DECIMAL COMMA IS NOT A FIELD BREAK. "CR.INT.RATE   4,25000" is the SA decimal separator;
 * treating it as a column would cut the description, and stripping it would read 4,25000 as
 * R425 000 rather than a rate of 4.25%.
 */
const note = s.lines.find((l) => l.direction === 'note')
check('the interest-rate notice keeps its whole description',
  note?.description, 'CR.INT.RATE   4,25000')

console.log(`\ncheck-bank-statement: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
