/**
 * A PERUSAL OF DOCUMENTS, ONCE A DAY.
 *
 * THE FIRM: "we should add a fee perusal of documents. This is any time anybody saves a document
 * or opens a document, but limited to one a day. So one charge a day. Can't be more than one
 * perusal of documents in a day. This includes a trace and everything else."
 *
 * A NARROWING, NOT A NEW FEE, AND THAT IS WHY IT IS SAFE TO BUILD WITHOUT ASKING. `perusal` has
 * been Annexure B item 3 since the import, with four schedules of rates and its mapping recorded
 * with the evidence in actionTariff.ts, and raising a dispute has charged exactly that pair all
 * along. What it never had was a limit: the gazette words item 3 as "a total amount of R25,00" for
 * the whole account, the firm instructed on 9 September that it is charged per occurrence instead
 * (ENFORCE_ITEM_TOTALS), and that left nothing between a collector and a fee every time they
 * opened a PDF. One a day is the boundary put back where the firm wants it.
 *
 * WHAT IS GUARDED HERE:
 *
 *   - THE LIMIT IS ON THE ACTION, NOT THE ITEM, which is what makes "and everything else" true: a
 *     document opened, one saved, a trace report read and a dispute handed to a liaison are all
 *     `perusal` and share the day.
 *   - IT IS ENFORCED IN THE ENGINE. A cap at the call site is a cap the next call site forgets.
 *   - ONLY CHARGES THAT EARNED SOMETHING COUNT AGAINST IT, exactly as the monthly allowance works.
 *   - THE FEE NEVER BLOCKS THE WORK. A document has to save and a document has to open.
 *   - AND THE CHARGE COMES AFTER, so nobody pays for a file that never landed.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-perusal.mjs
 */
import { readFileSync } from 'node:fs'
import { DAILY_LIMIT, TARIFF_HISTORY } from '../../src/lib/actionTariff.ts'
import { chargeItemWith, chargeMessage } from '../../src/lib/chargeEngine.ts'
import { ANNEXURE_B_2026 } from '../../src/lib/annexureB.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const charges = read('src/lib/accountCharges.ts')
const workspace = read('src/lib/accountWorkspace.ts')
const traceData = read('src/lib/traceStoreData.ts')
const panels = read('src/pages/accounts/AccountWorkspacePanels.tsx')
const engine = read('src/lib/chargeEngine.ts')

/* ---------------- the rule ---------------- */

check('a perusal may be charged once a day', DAILY_LIMIT.perusal, 1)
/*
 * AND NOTHING ELSE HAS ONE. Every other action the firm charges happens as often as the work
 * happens -- a call is a call -- and a daily cap quietly added to one of them would be the firm
 * under-recovering with nobody able to see why.
 */
check('...and it is the only action with a daily limit', Object.keys(DAILY_LIMIT), ['perusal'])
/* ITEM 3, WHICH IS NOT A GUESS: the mapping and its evidence predate this by months. */
check('a perusal is item 3', /export const PERUSAL_ITEM_ID = '3'/.test(charges), true)
ok('...which the gazette calls an expense not otherwise provided for',
  /not specifically provided for/.test(ANNEXURE_B_2026.items.find((i) => i.id === '3').description))
/* THE FIRM'S OWN WORDS ON THE STATEMENT, and one description so three call sites cannot write
   three. */
ok('...described to the debtor in the firm’s words',
  /export const PERUSAL_DESCRIPTION = 'Perusal of documents'/.test(charges))
/* AND PRICED ON EVERY SCHEDULE, because a fee is priced on the day of the ACTION -- a perusal
   re-read today that happened in 2019 is still a 2019 fee. */
check('the firm has always charged a perusal at its schedule’s rate',
  TARIFF_HISTORY.map((t) => t.rates.perusal), [25, 21, 20, 18])

/* ---------------- the engine enforces it ---------------- */

/*
 * A FAKE DATABASE, so the rule is exercised rather than read. It answers the basis RPC, the
 * account's status, and counts the fees already raised -- which is the only thing the daily cap
 * turns on.
 */
/*
 * A FAKE DATABASE, so the rule is exercised rather than read.
 *
 * CHAINABLE AND TOLERANT, which is not laziness: a fake that only answers the exact chain the code
 * writes today crashes with a TypeError the moment somebody removes a filter -- which is CLAUDE.md's
 * own second trap, an exception two lines below the check that should have REPORTED the change. It
 * records every filter instead, so "the day is counted on the action code" is a thing this file can
 * assert about behaviour rather than about the text of the source.
 */
const db = (billedToday) => {
  const inserted = []
  /* ONE RECORD PER QUERY, NOT ONE FLAT LIST OF FILTERS. The engine reads account_fees TWICE -- once
     for the item's monthly allowance and once for the day -- and both narrow by account, so a flat
     list cannot say which of them carried what and every assertion below would pass on the wrong
     one. */
  const queries = []
  const chain = (result, table) => {
    const q = { table, eq: [] }
    queries.push(q)
    const self = {
      select: () => self,
      insert: async (row) => { inserted.push(row); return { error: null } },
      update: () => self,
      or: () => self,
      eq: (col, val) => { q.eq.push([col, val]); return self },
      gte: () => self,
      lt: () => self,
      maybeSingle: async () => result,
      single: async () => result,
      then: (onOk) => Promise.resolve(result).then(onOk),
    }
    return self
  }
  return {
    inserted,
    queries,
    rpc: () => chain({ data: { capital: 50000, spent_on_item: 0, towards_ceiling: 0 }, error: null }, 'rpc'),
    from: (table) => {
      if (table === 'debtor_accounts') return chain({ data: { status: 'Active' }, error: null }, table)
      if (table === 'account_fees') return chain({ count: billedToday, error: null }, table)
      return chain({ error: null }, table)
    },
  }
}
const perusal = (billedToday) => {
  const d = db(billedToday)
  return chargeItemWith(d, {
    accountId: 'a', itemId: '3', actionCode: 'perusal', description: 'Perusal of documents',
  }).then((r) => ({ result: r, rows: d.inserted, queries: d.queries }))
}

const first = await perusal(0)
check('the first perusal of the day is charged', first.result.reason, 'charged')
check('...at the current schedule’s rate', first.result.exclVat, 25)
const second = await perusal(1)
check('the second is not', second.result.reason, 'daily-limit')
check('...and earns nothing', second.result.exclVat, 0)
/*
 * BUT IT IS STILL WRITTEN DOWN. The work happened; it simply earned nothing. Exactly what a
 * refused monthly allowance does, and what keeps "how many documents were opened on this account"
 * answerable from the ledger.
 */
check('...while the action is still recorded', second.rows.length, 1)
check('...as an unbilled row', second.rows[0]?.billed, false)
/* AND THE SENTENCE SAYS WHOSE RULE IT IS. This is the firm's, not the gazette's, so it does not
   read like a statutory cap the debtor could look up. */
ok('the refusal says it can be charged again tomorrow',
  /already been charged once today/.test(chargeMessage(second.result, '3'))
  && /again tomorrow/.test(chargeMessage(second.result, '3')))

/*
 * COUNTED ON THE ACTION CODE, NOT THE ITEM, which is the whole of "this includes a trace and
 * everything else". Asserted as source, because the fake above cannot tell which column was
 * filtered on.
 */
/* THE QUERY THAT COUNTS THE DAY, picked out by the column that makes it the day's rather than the
   item's -- and its existence asserted before anything is read off it, or removing the count
   entirely would leave every assertion below reading an empty list and passing. */
const dayQueries = second.queries.filter((q) => q.table === 'account_fees'
  && q.eq.some(([c]) => c === 'action_code'))
check('one query counts the day', dayQueries.length, 1)
const asked = (dayQueries[0]?.eq ?? []).map(([c, v]) => `${c}=${v}`)
ok(`the day is counted on the action (${asked.join(', ')})`,
  asked.includes('action_code=perusal'))
/* AND NOT ON THE ITEM. Counted there, a dispute handed to a liaison and a document opened would
   still share the day -- but so would anything else the firm ever prices under item 3, and the
   limit would drift away from the action the firm actually named. */
ok('...rather than on the Annexure B item', !asked.includes('annexure_item=3'))
/* ONLY CHARGES THAT EARNED SOMETHING, as the monthly allowance works: a perusal recorded at nought
   took nothing from the debtor and cannot be the reason the next one goes unrecovered. */
ok('...and only the ones that earned something', asked.includes('billed=true'))
/*
 * PER ACCOUNT PER DAY, which is the firm's answer when asked which it was: "one charge per account
 * per day". The debtor pays it, so the day belongs to the FILE.
 */
ok('...on this account', asked.includes('account_id=a'))
/*
 * AND NOT PER PERSON. `created_by` is written on every fee row, so counting the day there was one
 * filter away -- and a collector, their team leader and the client liaison all reading the same
 * trace report on the same afternoon would then be three charges for one set of documents, which is
 * the firm billing a debtor for its own internal handover.
 */
ok('...and not once for each person who reads it',
  !asked.some((f) => f.startsWith('created_by=') || f.startsWith('raised_by=') || f.startsWith('user_id=')))
const dayBlock = engine.slice(engine.indexOf('const perDay = DAILY_LIMIT'))
/* THE DAY IS THE PERSON'S OWN, built from the same clock the rest of the app calls today rather
   than from a timezone written out here. */
ok('...over the person’s own day', /dayStart\.setHours\(0, 0, 0, 0\)/.test(dayBlock))

/* ---------------- and the three places that raise it ---------------- */

ok('there is one function for it', /export async function chargePerusal\(/.test(charges))
/*
 * NEVER THROWS. A document has to save and a document has to open; a fee that will not write is
 * something to report afterwards, not a reason to refuse somebody the file they asked for.
 */
const fn = charges.slice(charges.indexOf('export async function chargePerusal('))
ok('...which cannot stop the work', /catch \(e\) \{[\s\S]{0,200}?return null/.test(fn))
/* THE CAP IS NOT IN IT. A limit enforced at the call site is a limit the next call site forgets. */
ok('...and does not enforce the cap itself', !/DAILY_LIMIT/.test(fn))

/* SAVING ONE. */
const upload = workspace.slice(workspace.indexOf('export async function uploadDocument('))
ok('saving a document raises it', /chargePerusal\(\{ accountId: input\.accountId/.test(upload))
/* AFTER THE ROW LANDS: a document that would not save has not been perused, and charging first is
   how a debtor pays for a file nobody has. */
const atInsert = upload.indexOf("from('account_documents')")
const atCharge = upload.indexOf('chargePerusal(')
ok('...after it has actually saved', atInsert > 0 && atCharge > atInsert)
ok('...and hands the charge back to be shown', /charge: ChargeResult \| null/.test(upload))

/* OPENING ONE. */
ok('opening a document raises it', /export async function openDocument\(/.test(workspace))
const open = workspace.slice(workspace.indexOf('export async function openDocument('))
/*
 * THE URL FIRST, for the same reason: a document that cannot be opened has not been perused.
 *
 * MEASURED INSIDE THE FILE BRANCH, which is the only one that can fail. A signed document is not
 * in the bucket -- it IS the signing request, and the row points at it -- so its address is built
 * rather than fetched and there is nothing to go wrong before the fee. Measured across the whole
 * function, that branch's charge sits above `documentUrl` and this read as a regression on code
 * that is right.
 */
const fileBranch = open.slice(open.indexOf('const url = await documentUrl('))
const atUrl = fileBranch.indexOf('await documentUrl(')
const atOpenCharge = fileBranch.indexOf('chargePerusal(')
ok('...after the address is signed', atUrl >= 0 && atOpenCharge > atUrl)
/*
 * AND THE SIGNED ONE IS CHARGED TOO, ON BOTH OF ITS ROADS.
 *
 * Item 6 is for reading a document on the account; where it is kept is not the debtor's business,
 * and a fee that depends on storage is a fee nobody can explain.
 *
 * A SIGNED DOCUMENT NOW HAS TWO WAYS OUT of this function and the regression is forgetting one of
 * them. The firm's instruction -- "it should save a PDF" -- means the first open DRAWS it and
 * repoints the row, after which it is an ordinary file and falls through to the branch above. The
 * other way is the fallback: a request that will not draw still opens as the signing page, because
 * "could not open that document" on an agreement that plainly exists is the worse answer. Both
 * charge, so neither is a free read.
 */
ok('...a signed copy that will not draw still opens, and is still perused',
  /url: signingPath\(token\),[\s\S]{0,400}?charge: await chargePerusal\(/.test(open))
ok('...and the drawn one falls through to the file branch, which charges',
  /path = filed/.test(open)
  && /const url = await documentUrl\(path, doc\.name\)[\s\S]{0,120}chargePerusal\(/.test(open))
/* AND THE DRAWING HAPPENS BEFORE EITHER FEE. A PDF that failed to draw has not been perused --
   the same rule as the signed address above, applied to the thing that replaced it. */
const atFile = open.indexOf('fileSignedCopy(')
ok('...with the PDF drawn before anything is charged',
  atFile >= 0 && atFile < open.indexOf('chargePerusal('))
ok('the documents panel opens through it', /await openDocument\(doc, userId\)/.test(panels))
/* AND SAYS WHAT IT EARNED, where it earned anything -- and only then: "no charge, already charged
   today" on every document anybody opens is a line people stop reading. */
ok('...and says what was charged', /charge\.reason === 'charged' \? chargeMessage\(charge, PERUSAL_ITEM_ID\)/.test(panels))

/* AND A TRACE, WHICH THE FIRM NAMED. */
ok('reading a trace report raises it', /if \(accountId\) await chargePerusal\(\{ accountId \}\)/.test(traceData))
ok('...on the account the trace is of', /traceReportUrl\(trace\.documentId, trace\.accountId\)/.test(read('src/pages/accounts/TraceWorkspaceModal.tsx')))

console.log(`\ncheck-perusal: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
