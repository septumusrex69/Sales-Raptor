/**
 * Taking an account by hand.
 *
 * The form is the only place an account is opened without a Swordfish file behind it, so it is
 * the only place a wrong capital or a wrong date gets in unchecked. Each case below was worked
 * out by hand.
 *
 *   node --experimental-strip-types scripts/qa/check-new-debtor.mjs
 */
import { isValidSaId, suggestReference, validateNewDebtor, toAccountRow, toContactRows } from '../../src/lib/newDebtor.ts'

let failed = 0
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

const ok = {
  accountNumber: 'ACF10131', clientReference: '99231', firstName: 'Thandiwe', surname: 'Mokoena',
  idNumber: '', capital: '18500', handoverDate: '2026-09-01', interestRateAnnual: '24',
  mobile: '', workPhone: '', altNumber: '', email: '', address: '', employer: '',
  kin1Name: '', kin1Phone: '', kin2Name: '', kin2Phone: '',
}
const TODAY = '2026-09-10'

/* South African ID numbers carry a Luhn check digit, so a transposed pair fails. */
{
  // Two real-format numbers with correct check digits, computed by hand.
  check('a valid SA ID passes', isValidSaId('8001015009087'), true)
  check('the same number with two digits swapped fails', isValidSaId('8001010509087'), false)
  check('thirteen digits is not enough on its own', isValidSaId('1234567890123'), false)
  check('twelve digits is not an ID', isValidSaId('800101500908'), false)
  check('a month of 13 is not a birth date', isValidSaId('8013015009087'), false)
  check('letters are not digits', isValidSaId('800101500908X'), false)
}

/* The reference follows the client's own series rather than whatever gets typed. */
{
  check('the next in a plain series', suggestReference(['ACF10085', 'ACF10130', 'ACF10043']), 'ACF10131')
  check('a prefix with a slash is kept', suggestReference(['GPS3/10103', 'GPS3/10106']), 'GPS3/10107')
  check('padding is preserved', suggestReference(['AIS0009', 'AIS0015']), 'AIS0016')
  // One stray legacy reference must not rename the series after itself.
  check('the commonest prefix wins', suggestReference(['APM0007', 'APM0008', 'LEGACY99']), 'APM0009')
  check('nothing to learn from gives nothing', suggestReference([]), null)
  check('references with no number give nothing', suggestReference(['odd', 'other']), null)
}

/* What stops a save. */
{
  check('a good account has no problems', validateNewDebtor(ok, TODAY), [])

  const noSurname = validateNewDebtor({ ...ok, surname: '  ' }, TODAY)
  check('a surname is required', noSurname.map((p) => p.field), ['surname'])

  check('capital must be present', validateNewDebtor({ ...ok, capital: '' }, TODAY).map((p) => p.field), ['capital'])
  check('capital must be positive', validateNewDebtor({ ...ok, capital: '0' }, TODAY).map((p) => p.field), ['capital'])
  check('capital may carry separators', validateNewDebtor({ ...ok, capital: '18 500,00'.replace(',', '.') }, TODAY), [])

  check('a handover date is required', validateNewDebtor({ ...ok, handoverDate: '' }, TODAY).map((p) => p.field), ['handoverDate'])
  check('and cannot be tomorrow', validateNewDebtor({ ...ok, handoverDate: '2026-09-11' }, TODAY).map((p) => p.field), ['handoverDate'])
  check('today is fine', validateNewDebtor({ ...ok, handoverDate: TODAY }, TODAY), [])

  check('a rate is required', validateNewDebtor({ ...ok, interestRateAnnual: '' }, TODAY).map((p) => p.field), ['interestRateAnnual'])
  check('zero interest is a real answer', validateNewDebtor({ ...ok, interestRateAnnual: '0' }, TODAY), [])
  check('a negative rate is not', validateNewDebtor({ ...ok, interestRateAnnual: '-1' }, TODAY).map((p) => p.field), ['interestRateAnnual'])

  check('a malformed email is caught', validateNewDebtor({ ...ok, email: 'not-an-address' }, TODAY).map((p) => p.field), ['email'])
  check('a real one is not', validateNewDebtor({ ...ok, email: 'thandiwe@example.co.za' }, TODAY), [])
  check('no email at all is fine', validateNewDebtor({ ...ok, email: '' }, TODAY), [])

  check('a bad ID is caught', validateNewDebtor({ ...ok, idNumber: '1234567890123' }, TODAY).map((p) => p.field), ['idNumber'])
  check('no ID at all is allowed', validateNewDebtor({ ...ok, idNumber: '' }, TODAY), [])

  /* Every problem is reported at once, not one per attempt. */
  const many = validateNewDebtor({ ...ok, surname: '', capital: '', handoverDate: '' }, TODAY)
  check('all problems are reported together', many.map((p) => p.field), ['surname', 'capital', 'handoverDate'])
}

/* The row that gets written. */
{
  const row = toAccountRow(ok, 'company-1', null)
  check('capital opens the ledger', row.capital_handed_over, 18500)
  check('and the in duplum ceiling is stamped at it', row.in_duplum_ceiling, 18500)
  check('interest runs from the handover', row.interest_from, '2026-09-01')
  check('the account opens active', row.status, 'Active: Activated')
  check('and is marked as taken by hand', row.source, 'manual')
  /*
   * Commission is the CLIENT's and is stored as a fraction. Typing 23 into an account and storing
   * it raw is what put "2300%" on the accounts list, because every renderer multiplies by a
   * hundred. It is now inherited and never typed.
   */
  check('the client’s rate is inherited as given', toAccountRow(ok, 'c', null, 0.3).commission_rate, 0.3)
  check('a client with no resolved rate leaves it null', toAccountRow(ok, 'c', null, null).commission_rate, null)
  check('and it is a fraction, so it renders as a percentage',
    Math.round((toAccountRow(ok, 'c', null, 0.3).commission_rate ?? 0) * 100), 30)
}

/* Contact details, including next of kin, which is a labelled phone rather than its own table. */
{
  const full = {
    ...ok, mobile: '082 555 0101', workPhone: '011 555 0000', altNumber: '083 555 0202',
    email: 'thandiwe@example.co.za', address: '14 Main Rd, Pretoria', employer: 'Shoprite',
    kin1Name: 'Mother', kin1Phone: '082 555 0303', kin2Name: '', kin2Phone: '082 555 0404',
  }
  const rows = toContactRows(full, 'acct-1')
  check('every filled contact becomes a row', rows.length, 8)
  check('the mobile is primary', rows.find((r) => r.kind === 'mobile').is_primary, true)
  check('the alternative number is labelled', rows.find((r) => r.label === 'Alternative').kind, 'phone')
  check('a named kin keeps the name as the label',
    rows.filter((r) => r.label === 'Mother').map((r) => r.value), ['082 555 0303'])
  check('an unnamed kin still says what it is',
    rows.filter((r) => r.label === 'Next of kin').map((r) => r.value), ['082 555 0404'])
  check('an empty form writes no contacts at all', toContactRows(ok, 'acct-1').length, 0)
  // A name with nobody to ring is not a way to reach anyone.
  check('a kin name with no number is dropped',
    toContactRows({ ...ok, kin1Name: 'Brother' }, 'acct-1').length, 0)
}

console.log(failed === 0 ? '\nAll checks passed.\n' : `\n${failed} check(s) failed.\n`)
process.exit(failed ? 1 : 0)
