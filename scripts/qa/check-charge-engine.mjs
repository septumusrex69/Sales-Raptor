/**
 * The charge engine, with a fake database under it.
 *
 * chargeItemWith used to be chargeItem, hard-wired to the browser's Supabase client. It was
 * split so the BuzzBox webhook can raise a consultation with the service-role client when a call
 * connects and no browser is open. That refactor moved the one function in the app that writes
 * to the fee ledger, so the point of this file is to prove the move changed nothing: the same
 * reads in the same order, the same row written, the same caps respected.
 *
 * The database is a fake precisely so the SEQUENCE is visible. check-charges.mjs already covers
 * the Annexure B arithmetic; what it cannot see is whether the engine asks the right questions.
 *
 * Run: node --experimental-strip-types --import ./scripts/qa/tsresolve.mjs \
 *        scripts/qa/check-charge-engine.mjs
 *
 * The --import is not optional. chargeEngine.ts imports with `.js` specifiers because Vercel
 * needs them; tsresolve.mjs is what lets Node follow those to the `.ts` sources. See its header.
 */
import { chargeItemWith } from '../../src/lib/chargeEngine.ts'
import { ENFORCE_ITEM_TOTALS } from '../../src/lib/annexureB.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push(`${name}\n     expected ${e}\n     actual   ${a}`)
}

/**
 * Enough of a Supabase client to run the engine, and a log of everything it was asked.
 *
 * The filter methods return `this` so a chain of .eq().gte().lt() works, and the object is
 * thenable so an un-awaited chain resolves like a real query builder does.
 */
function fakeDb({ capital = 100000, spentOnItem = 0, towardsCeiling = 0, status = 'active', monthCount = 0 } = {}) {
  const log = { rpc: [], selects: [], inserted: null }
  const builder = (table) => {
    const b = {
      _table: table,
      select(cols, opts) { log.selects.push({ table, cols, opts }); return b },
      eq(col, val) { log.selects.push({ filter: `eq:${col}=${val}` }); return b },
      gte(col, val) { log.selects.push({ filter: `gte:${col}` , val }); return b },
      lt(col, val) { log.selects.push({ filter: `lt:${col}`, val }); return b },
      maybeSingle: async () => ({ data: table === 'debtor_accounts' ? { status } : null, error: null }),
      insert(row) { log.inserted = { table, row }; return { error: null } },
      then(resolve) { return resolve({ count: monthCount, error: null }) },
    }
    return b
  }
  return {
    log,
    rpc(fn, args) {
      log.rpc.push({ fn, args })
      return { single: async () => ({ data: { capital, spent_on_item: spentOnItem, towards_ceiling: towardsCeiling }, error: null }) }
    },
    from: builder,
  }
}

const base = { accountId: 'acc-1', actionCode: 'consultation', description: 'Consultation', at: new Date('2026-09-12T10:00:00Z') }

/* ---- the ordinary case ---- */
{
  const db = fakeDb()
  const r = await chargeItemWith(db, { ...base, itemId: '7' })
  check('a consultation on a healthy account charges R60', r.exclVat, 60)
  check('...with 15% VAT on top', r.vat, 9)
  check('...and says it charged', r.reason, 'charged')

  check('it asks the database for the basis rather than computing it',
    db.log.rpc, [{ fn: 'account_charge_basis', args: { p_account_id: 'acc-1', p_item: '7' } }])
  check('it writes exactly one fee row', db.log.inserted?.table, 'account_fees')

  const row = db.log.inserted.row
  check('the row names the item', row.annexure_item, '7')
  check('...and the schedule that priced it', row.tariff_effective_from, '2026-03-06')
  check('...and the action, for the timeline icon', row.action_code, 'consultation')
  check('...and what the debtor reads', row.description, 'Consultation')
  check('...and is billed', row.billed, true)
  check('...and dated when it happened, not when it was written',
    row.incurred_at, '2026-09-12T10:00:00.000Z')
  check('...and marked as ours', row.source, 'raptor')
  check('...and counts toward the cap', row.counts_toward_fee_cap, true)
  check('...and stands for one unit', row.segments, 1)
}

/* ---- a written-off account ---- */
{
  const db = fakeDb({ status: 'written off' })
  const r = await chargeItemWith(db, { ...base, itemId: '7' })
  check('a written-off account earns nothing', r.exclVat, 0)
  check('...and says why', r.reason, 'written-off')
  // The work still has to be visible: an account with no trace of the work cannot be defended.
  check('...but the action is still recorded', db.log.inserted?.table, 'account_fees')
  check('...as an unbilled row', db.log.inserted.row.billed, false)
}

/* ---- the items 1-7 ceiling ---- */
{
  const db = fakeDb({ capital: 100000, towardsCeiling: 1200 })
  const r = await chargeItemWith(db, { ...base, itemId: '7' })
  check('the ceiling trims a charge to what is left', r.exclVat, 25)
  check('...and it is still a charge', r.reason, 'charged')
}
{
  const db = fakeDb({ capital: 100000, towardsCeiling: 1225 })
  const r = await chargeItemWith(db, { ...base, itemId: '7' })
  check('past the ceiling nothing is earned', r.exclVat, 0)
  check('...and it says so', r.reason, 'at-ceiling')
  check('...and the work is still written down', db.log.inserted.row.billed, false)
}
{
  // The half of regulation 11 that is usually forgotten: capital, or R1225, whichever is LESS.
  const db = fakeDb({ capital: 300, towardsCeiling: 300 })
  const r = await chargeItemWith(db, { ...base, itemId: '7' })
  check('a small debt caps at its own capital', r.exclVat, 0)
}

/* ---- quantity ---- */
{
  const db = fakeDb()
  const r = await chargeItemWith(db, { ...base, itemId: '4c', actionCode: 'trace', description: 'Credit bureau search', quantity: 4 })
  check('four bureau searches cost 4 x R16', r.exclVat, 64)
  check('...as ONE row carrying the count, not four rows', db.log.inserted.row.segments, 4)
}
{
  const db = fakeDb()
  const r = await chargeItemWith(db, { ...base, itemId: '7', quantity: 0 })
  check('a nonsense quantity is floored at one, never zero', r.exclVat, 60)
}

/* ---- item 3, and the flag that decides how it behaves ---- */
{
  /*
   * The gazette prices item 3 as "a total amount of R25,00" for the account. Bredell Ferreira
   * instructed on 9 September 2026 that it be charged per occurrence instead, as Swordfish did,
   * and ENFORCE_ITEM_TOTALS records that as a flag rather than a deletion.
   *
   * So this asserts whichever behaviour the flag currently selects. Written the other way it
   * would be a test of what I happened to believe on the day, and flipping the flag back — which
   * the comment in annexureB.ts explicitly invites — would fail a test that was never wrong.
   */
  const db = fakeDb({ spentOnItem: 25 })
  const r = await chargeItemWith(db, { ...base, itemId: '3', actionCode: 'perusal', description: 'ONE' })
  if (ENFORCE_ITEM_TOTALS) {
    check('with totals enforced, a second sundry expense earns nothing', r.exclVat, 0)
    check('...and says which rule stopped it', r.reason, 'item-total-spent')
  } else {
    check('with totals off, item 3 charges per occurrence', r.exclVat, 25)
    check('...as the firm instructed on 9 Sep 2026', r.reason, 'charged')
  }
  // True either way, and the half of regulation 11 that is NOT flagged off.
  const capped = fakeDb({ spentOnItem: 25, capital: 100000, towardsCeiling: 1225 })
  const atCeiling = await chargeItemWith(capped, { ...base, itemId: '3', actionCode: 'perusal', description: 'ONE' })
  check('the items 1-7 ceiling still binds item 3 whatever the flag says', atCeiling.exclVat, 0)
}

/* ---- errors are raised, not swallowed ---- */
{
  const db = fakeDb()
  db.rpc = () => ({ single: async () => ({ data: null, error: { message: 'boom' } }) })
  let threw = null
  try { await chargeItemWith(db, { ...base, itemId: '7' }) } catch (e) { threw = e.message }
  check('a failed basis read throws rather than charging a guess', threw, 'boom')
}
{
  const db = fakeDb()
  const realFrom = db.from
  db.from = (t) => {
    const b = realFrom(t)
    if (t === 'account_fees') b.insert = () => ({ error: { message: 'insert failed' } })
    return b
  }
  let threw = null
  try { await chargeItemWith(db, { ...base, itemId: '7' }) } catch (e) { threw = e.message }
  check('a failed write throws rather than reporting a fee that does not exist', threw, 'insert failed')
}

console.log(`\n${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  FAIL ${f}`)
process.exit(failures.length ? 1 : 0)
