/**
 * A sliding commission scale can be seen, set, and prices each new account on its own capital
 * (prompt 9: "sliding commission scales can't be seen or set").
 *
 * THE RULE, as the mandates state it: on a scale each account gets ONE rate, from the band its
 * capital handed over falls in, decided once at handover; the boundary rand belongs to the lower
 * band. An imported account keeps the rate Swordfish billed it -- that is the invoice the client paid.
 *
 * What is held here:
 *   1. the four states a client's rule can be in, and the amber one in particular -- a client the
 *      register shows on tiers, with no rand boundaries captured;
 *   2. each account's rate with where it came from, in the firm's words;
 *   3. a new account priced from the bands on ITS capital (R10 000 -> 21%, R600 000 -> 12%);
 *   4. a handover for a scale with no boundaries refused, in the sentence the firm asked for, in
 *      the function that writes and not only on the button;
 *   5. the "off their mandate rate" comparison following the client's CURRENT rule -- and moving
 *      the comparison only, never the billed rate;
 *   6. Trust settings and the client page using the one dialog, so the two cannot drift.
 *
 *   node --experimental-strip-types --import ./scripts/qa/tsresolve.mjs scripts/qa/check-commission-rule.mjs
 */
import fs from 'node:fs'
import { accountRate, handoverRateBlock, ruleKind, ruleRateFor, tierPrefixFor } from '../../src/lib/commissionRule.ts'
import { toAccountRow } from '../../src/lib/newDebtor.ts'

let failed = 0
let passed = 0
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passed++; else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}
const read = (p) => fs.readFileSync(p, 'utf8')
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*--.*$/gm, '')

const TIERS = [{ prefix: 'KIS', rate: 0.21 }, { prefix: 'KIS2', rate: 0.15 }, { prefix: 'KIS3', rate: 0.12 }, { prefix: 'KIS4', rate: 0.1 }]
/* Boundaries for the test only. The firm's real ones are in Kestrel's mandate and are theirs to type. */
const BANDS = [{ upTo: 100000, rate: 0.21 }, { upTo: 250000, rate: 0.15 }, { upTo: 1000000, rate: 0.12 }, { upTo: null, rate: 0.1 }]
const KESTREL_UNSET = { commissionRate: 0.1, commissionBands: null, commissionTiers: TIERS }
const KESTREL = { commissionRate: null, commissionBands: BANDS, commissionTiers: TIERS }

/* ---------- 1. the four states ---------- */
check('bands captured is a scale', ruleKind(KESTREL), 'scale')
/* TIERS WIN OVER A LEFTOVER FLAT RATE. Kestrel came out of the import with 10% on it -- its last
   tier, which is exactly how the scale was being lost. Reading that as "flat" would price every
   new account at 10% whatever its size. */
check('tiers with no bands is a scale with boundaries missing, even over a flat rate', ruleKind(KESTREL_UNSET), 'scale_without_bands')
check('one tier is not a scale', ruleKind({ commissionRate: 0.3, commissionTiers: [{ prefix: 'X', rate: 0.3 }] }), 'flat')
check('nothing at all is none', ruleKind({}), 'none')

/* ---------- 2. an account's rate, and where it came from ---------- */
check('KIS0012 keeps what Swordfish billed, and says so',
  accountRate({ accountRate: 0.21, capitalHandedOver: 4892.1, imported: true, reference: 'KIS0012', client: KESTREL }).label,
  '21% — as billed in Swordfish (KIS tier)')
/* THE LONGEST PREFIX THAT ALSO HAS THE BILLED RATE: a KIS2 account starts with "KIS" too. */
check('a KIS2 account is read as KIS2, not KIS', tierPrefixFor('KIS20044', 0.15, TIERS), 'KIS2')
check('two tiers on one rate: the longer prefix wins',
  tierPrefixFor('KIS20044', 0.15, [{ prefix: 'KIS', rate: 0.15 }, { prefix: 'KIS2', rate: 0.15 }]), 'KIS2')
check('a prefix whose rate is not the billed rate is not named', tierPrefixFor('KIS0012', 0.15, TIERS), null)
/* en-ZA's thousands separator is a space on one runtime and a non-breaking space on another. */
check('an account on its band says which band',
  /^25% — band R0–R25\s000$/.test(accountRate({ accountRate: null, capitalHandedOver: 18000, imported: false,
    client: { commissionBands: [{ upTo: 25000, rate: 0.25 }, { upTo: null, rate: 0.225 }] } }).label), true)
check('an account at exactly the boundary is labelled with the lower band',
  /^25% — band R0–R25\s000$/.test(accountRate({ accountRate: null, capitalHandedOver: 25000, imported: false,
    client: { commissionBands: [{ upTo: 25000, rate: 0.25 }, { upTo: null, rate: 0.225 }] } }).label), true)
check('an account on a flat client says so',
  accountRate({ accountRate: null, capitalHandedOver: 5000, imported: false, client: { commissionRate: 0.3 } }).label,
  '30% — client flat rate')
check('an account billed off its client\'s current rule is flagged',
  accountRate({ accountRate: 0.21, capitalHandedOver: 600000, imported: true, reference: 'KIS0099', client: KESTREL }).offRule, true)
check('...and one on it is not',
  accountRate({ accountRate: 0.21, capitalHandedOver: 4892.1, imported: true, reference: 'KIS0012', client: KESTREL }).offRule, false)
check('no rule is not evidence an account is wrong',
  accountRate({ accountRate: 0.21, capitalHandedOver: 4892.1, imported: true, client: {} }).offRule, false)

/* ---------- 3. a new account priced on its own capital ---------- */
check('R10 000 to Kestrel is 21%', ruleRateFor(KESTREL, 10000), 0.21)
check('R600 000 to Kestrel is 12%', ruleRateFor(KESTREL, 600000), 0.12)
check('exactly at a boundary takes the lower band', ruleRateFor(KESTREL, 100000), 0.21)
check('a cent over takes the next', ruleRateFor(KESTREL, 100000.01), 0.15)
const input = {
  accountNumber: 'KIS0101', clientReference: '', firstName: 'A', surname: 'B', idNumber: '',
  capital: '600000', handoverDate: '2026-10-06', interestRateAnnual: '24',
  mobile: '', workPhone: '', altNumber: '', email: '', address: '', employer: '',
  kin1Name: '', kin1Phone: '', kin2Name: '', kin2Phone: '',
}
const big = toAccountRow(input, 'kestrel', 'h1', KESTREL)
check('a handover row is stamped on its band', big.commission_rate, 0.12)
check('...expected the same, so a new account is never "off its mandate rate"', big.commission_rate_expected, 0.12)
check('...and says where it came from', big.commission_rate_source, 'Band on capital at handover')
check('a small one on the same client gets the small-debt rate', toAccountRow({ ...input, capital: '10000' }, 'kestrel', 'h1', KESTREL).commission_rate, 0.21)
check('a bare number is still a flat rate', toAccountRow(input, 'c', null, 0.3).commission_rate, 0.3)

/* ---------- 4. a scale with no boundaries refuses ---------- */
check('the sentence the firm asked for', handoverRateBlock('Kestrel', KESTREL_UNSET),
  'Kestrel is on a 4-tier scale but its rand boundaries are not captured — set them on the client first.')
check('a captured scale is not refused', handoverRateBlock('Kestrel', KESTREL), null)
{
  const src = strip(read('src/lib/handoverDraft.ts'))
  const fn = src.slice(src.indexOf('export async function approveDraft'))
  /* The THROW, not the call: computing the sentence and carrying on is the bug. */
  const guard = fn.search(/if \(rateBlock\) throw/)
  const write = fn.indexOf('createDebtorAccount(')
  /* Presence before order: indexOf is -1 when the guard is gone, and -1 < anything. */
  check('approveDraft refuses a scale with no boundaries', guard > 0, true)
  check('...before it opens a single account', guard > 0 && write > 0 && guard < write, true)
  check('...and refuses an unread rule rather than opening accounts at no rate', /if \(!input\.commission\) throw/.test(fn), true)
  check('the handover screen says it before approve is pressed', /rateBlock/.test(strip(read('src/components/settings/HandoverImportCard.tsx'))), true)
  check('adding one account by hand refuses the same thing', /handoverRateBlock\(/.test(strip(read('src/pages/companies/CompanyDetail.tsx'))), true)
}

/* ---------- 5. the drift comparison follows the current rule ---------- */
{
  const schema = read('supabase/schema.sql')
  const at = schema.lastIndexOf('create or replace function public.commission_expected_follows_rule(')
  check('the rule-follows trigger function is in schema.sql', at >= 0, true)
  const body = at >= 0 ? strip(schema.slice(at, schema.indexOf('$$;', schema.indexOf('$$', at) + 2))) : ''
  check('...it moves the comparison', /set commission_rate_expected\s*=/.test(body), true)
  /* AND NEVER THE BILLED RATE: commission_rate is the record of what was charged. */
  check('...and never the billed rate', /commission_rate\s*=/.test(body.replace(/commission_rate_(expected|source)\s*=/g, '')), false)
  check('...fired when a client\'s rate or bands change',
    /create or replace trigger companies_commission_expected\s+after update of commission_rate, commission_bands on public\.companies/.test(schema), true)
}

/* ---------- 6. one dialog, two doors ---------- */
{
  const settings = strip(read('src/pages/finance/FinanceSettings.tsx'))
  check('Trust settings has no dialog of its own', /function CommissionModal/.test(settings), false)
  check('...it uses the shared one', /from '..\/..\/components\/companies\/CommissionModal'/.test(settings), true)
  check('...and says when a scale has no boundaries', settings.includes('Scale, boundaries missing'), true)
  check('...reading the tiers to say it', /commission_tiers/.test(settings), true)
  const card = strip(read('src/components/companies/CommissionCard.tsx'))
  check('the client page opens the same dialog', /<CommissionModal/.test(card), true)
  check('...behind the finance tick', /canViewFinance\(/.test(card), true)
  check('...and says the boundaries are not captured', card.includes('Boundaries not yet captured'), true)
  const modal = strip(read('src/components/companies/CommissionModal.tsx'))
  check('a flat rate over a scale must be confirmed', /This replaces a \{scaleSize\}-tier scale with a flat rate/.test(modal), true)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
