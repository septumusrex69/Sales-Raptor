/**
 * NO PERUSAL OF DOCUMENTS FEE. IT WAS REMOVED, AND THIS HOLDS THE REMOVAL.
 *
 * THE FIRM (S10, 21 Oct, prompt 13 item 11): "Remove the perusal of documents fee completely: no
 * new charges, the setting and code gone, and existing perusal fees removed too (not credited)."
 *
 * What it used to be: Annexure B item 3, once a day per account, raised whenever a document on a
 * debtor's account was saved, opened or downloaded, or a trace report read (`chargePerusal`, with a
 * `chargePerusalFee` opt-out on uploads and `DAILY_LIMIT.perusal = 1`). The existing fee rows are
 * removed in SQL, separately; this file is about the code never raising another.
 *
 * WHAT IS GUARDED HERE:
 *
 *   - THE CODE IS GONE, not switched off. No `chargePerusal`, `PERUSAL_DESCRIPTION`,
 *     `PERUSAL_ITEM_ID` or `chargePerusalFee` anywhere in src/ or api/, and nothing there raises a
 *     fee under `actionCode: 'perusal'`. Searched with COMMENTS STRIPPED, so the notes explaining
 *     why it went cannot fail this, and a comment cannot hide a live call either.
 *   - SAVING, OPENING AND READING CHARGE NOTHING. uploadDocument, openDocument and traceReportUrl
 *     call no charge at all, and the documents panel shows no "charged" line.
 *   - THE SETTING IS GONE. DAILY_LIMIT is exactly { dispute: 1 }.
 *   - DISPUTES ARE NOT A PERUSAL AND ARE STILL CHARGED. They used to be raised under `perusal`
 *     and shared its one a day; they now have their own `dispute` code with the same one a day, so
 *     dispute billing is unchanged. Exercised against the engine, not just read.
 *   - IMPORTED HISTORY STILL READS. The `perusal` code, its label, its four schedules of rates and
 *     the legacy-name mapping stay, because Swordfish's imported history carries them and
 *     CLAUDE.md says imported history is frozen at what was imported.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-perusal.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACTION_BY_CODE, DAILY_LIMIT, TARIFF_HISTORY, codeForLegacyName,
} from '../../src/lib/actionTariff.ts'
import { chargeItemWith, chargeMessage } from '../../src/lib/chargeEngine.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (p) => readFileSync(join(root, p), 'utf8')
/* Block comments (which covers JSX `{/* *\/}`) and line comments. The `[^:]` keeps a URL's `//`. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')

/* EVERY SOURCE FILE THE APP AND THE API ARE BUILT FROM, not a list of the ones that used to call
   it -- the regression this guards is somebody adding a perusal back in a file nobody listed. */
const walk = (dir) => readdirSync(join(root, dir)).flatMap((name) => {
  const p = join(dir, name)
  if (name === 'node_modules' || name.startsWith('.')) return []
  if (statSync(join(root, p)).isDirectory()) return walk(p)
  return /\.(ts|tsx|js|mjs|cjs)$/.test(name) ? [p] : []
})
const sources = [...walk('src'), ...walk('api')].map((p) => ({ path: relative(root, join(root, p)), code: strip(read(p)) }))
ok(`the search found the source (${sources.length} files)`, sources.length > 50)

/* ---------------- the code is gone ---------------- */

for (const name of ['chargePerusal', 'PERUSAL_DESCRIPTION', 'PERUSAL_ITEM_ID', 'chargePerusalFee']) {
  const hits = sources.filter((f) => new RegExp(`\\b${name}\\b`).test(f.code)).map((f) => f.path)
  check(`nothing in src/ or api/ mentions ${name} outside a comment`, hits, [])
}
/* AND NOTHING RAISES ONE BY HAND. A chargeItem written out at some call site with the old code is
   the same fee by another road; reading `action_code` = 'perusal' (imported history) is fine. */
const raisers = sources.filter((f) => /actionCode\s*:\s*['"`]perusal['"`]/.test(f.code)
  || /action_code\s*:\s*['"`]perusal['"`]/.test(f.code)).map((f) => f.path)
check('nothing in src/ or api/ raises a fee under the perusal code', raisers, [])

/* ---------------- saving, opening and reading charge nothing ---------------- */

const fnBody = (src, sig) => {
  const at = src.indexOf(sig)
  if (at < 0) return null
  const next = src.indexOf('\nexport ', at + sig.length)
  return src.slice(at, next < 0 ? undefined : next)
}
const workspace = strip(read('src/lib/accountWorkspace.ts'))
const traceData = strip(read('src/lib/traceStoreData.ts'))
const panels = strip(read('src/pages/accounts/AccountWorkspacePanels.tsx'))
/* Each body asserted to EXIST before it is searched, or renaming the function would leave the
   search reading nothing and passing. */
for (const [label, src, sig] of [
  ['saving a document', workspace, 'export async function uploadDocument('],
  ['opening a document', workspace, 'export async function openDocument('],
  ['reading a trace report', traceData, 'export async function traceReportUrl('],
]) {
  const body = fnBody(src, sig)
  ok(`${label} is still there to check`, body !== null)
  ok(`${label} charges nothing`, body !== null && !/\bcharge[A-Z]\w*\(|chargeItem/.test(body))
  ok(`...and hands back no charge`, body !== null && !/ChargeResult|\bcharge\s*:/.test(body))
}
ok('the workspace no longer reaches for the fee code at all', !/accountCharges/.test(workspace))
ok('...nor does reading a trace', !/accountCharges/.test(traceData))
ok('the documents panel shows no "charged" line', !/setCharged|chargeMessage/.test(panels))

/* ---------------- the setting is gone ---------------- */

/*
 * EXACTLY ONE DAILY LIMIT, AND IT IS THE DISPUTE'S. `perusal: 1` left in place would be a setting
 * for a fee that does not exist -- "the setting and code gone" -- and any other entry would be a
 * daily cap quietly added to work the firm charges as often as it happens.
 */
check('DAILY_LIMIT is exactly { dispute: 1 }', DAILY_LIMIT, { dispute: 1 })

/* ---------------- disputes are still charged, once a day ---------------- */

const disputeRaise = /itemId:\s*'3',\s*actionCode:\s*'dispute',\s*description:\s*'ONE'/
ok('raising a dispute charges item 3 under `dispute` (accountQueries.ts)',
  disputeRaise.test(strip(read('src/lib/accountQueries.ts'))))
ok('...and the same from a ticket raised off an email (api ticket.ts)',
  disputeRaise.test(strip(read('api/_lib/email/ticket.ts'))))
ok('the dispute code has a label', ACTION_BY_CODE.dispute?.label === 'Dispute (other necessary expenses)')
/* NO RATES OF ITS OWN: the price comes from the item via chargeItem, not the action rates, and an
   entry here would be a second figure for the same R25 that could drift. */
ok('...and no action rates of its own', TARIFF_HISTORY.every((t) => t.rates.dispute === undefined))

/*
 * A FAKE DATABASE, so the dispute's one a day is exercised rather than read.
 *
 * CHAINABLE AND TOLERANT, which is not laziness: a fake that only answers the exact chain the code
 * writes today crashes with a TypeError the moment somebody removes a filter -- CLAUDE.md's own
 * second trap. It records every filter instead.
 */
const db = (billedToday) => {
  const inserted = []
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
const dispute = (billedToday) => {
  const d = db(billedToday)
  return chargeItemWith(d, {
    accountId: 'a', itemId: '3', actionCode: 'dispute', description: 'ONE',
  }).then((r) => ({ result: r, rows: d.inserted, queries: d.queries }))
}

const first = await dispute(0)
check('the first dispute of the day is charged', first.result.reason, 'charged')
check('...at R25, as before', first.result.exclVat, 25)
const second = await dispute(1)
check('a second the same day is not', second.result.reason, 'daily-limit')
check('...and earns nothing', second.result.exclVat, 0)
check('...while it is still recorded', second.rows.length, 1)
check('...as an unbilled row', second.rows[0]?.billed, false)
ok('the refusal says it can be charged again tomorrow',
  /already been charged once today/.test(chargeMessage(second.result, '3'))
  && /again tomorrow/.test(chargeMessage(second.result, '3')))
/* COUNTED ON THE DISPUTE CODE, so a PTC confirmation or a deeds search -- item 3 as well -- cannot
   use up a dispute's day, and a dispute cannot use up theirs. The query is asserted to exist
   before anything is read off it. */
const dayQueries = second.queries.filter((q) => q.table === 'account_fees'
  && q.eq.some(([c]) => c === 'action_code'))
check('one query counts the day', dayQueries.length, 1)
const asked = (dayQueries[0]?.eq ?? []).map(([c, v]) => `${c}=${v}`)
ok(`the day is counted on the dispute code (${asked.join(', ')})`, asked.includes('action_code=dispute'))
ok('...rather than on the Annexure B item', !asked.includes('annexure_item=3'))
ok('...only the ones that earned something', asked.includes('billed=true'))
ok('...per account (the firm: "one charge per account per day")', asked.includes('account_id=a'))
ok('...and not per person',
  !asked.some((f) => f.startsWith('created_by=') || f.startsWith('raised_by=') || f.startsWith('user_id=')))

/* ---------------- imported history still reads ---------------- */

/*
 * THE `perusal` CODE STAYS, FOR SWORDFISH'S HISTORY ONLY. Imported fee rows carry it, and a code
 * removed from the union and the tariff would leave those rows unlabelled and unpriceable -- which
 * is rewriting history CLAUDE.md says is frozen.
 */
ok('the perusal code still exists for imported history', ACTION_BY_CODE.perusal?.label === 'Perusal of Documents')
check('...priced on every schedule exactly as before',
  TARIFF_HISTORY.map((t) => t.rates.perusal), [25, 21, 20, 18])
check('...and imported names still map to it', codeForLegacyName('Perusal of documents'), 'perusal')
check('...including the evidenced "Necessary Costs"', codeForLegacyName('Necessary Costs'), 'perusal')

console.log(`\ncheck-perusal: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
