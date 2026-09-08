/**
 * Migration dry-run: can our model reproduce Swordfish's numbers?
 *
 * Run before any import writes a row. Loading 100,000 accounts into a money model nobody has
 * checked is how a collections business discovers, six weeks later, that every statement is
 * wrong. This reads the exports, recomputes what it can, and reports where we disagree with
 * Swordfish and by how much.
 *
 * It deliberately imports the app's own tariff module rather than restating the rates, so the
 * dry-run cannot quietly pass against numbers the app doesn't actually use.
 *
 *   node --experimental-strip-types scripts/swordfish/reconcile.mjs \
 *     --summary <accounts.csv> --payments <payments.csv> --actions <actions.csv>
 */
import fs from 'node:fs'
import { parseCsv, num, date } from './csv.mjs'
import { codeForLegacyName, rateFor, ACTION_BY_CODE, isQuarantinedLegacyName } from '../../src/lib/actionTariff.ts'
import { feeCeiling, scheduleFor } from '../../src/lib/annexureB.ts'

const CENT = 0.011 // a cent, with room for float noise

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}
const read = (p) => parseCsv(fs.readFileSync(p, 'utf8'))
const money = (n) => `R${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok, detail })
  console.log(`${ok === true ? '  PASS' : ok === false ? '  FAIL' : '  WARN'}  ${name}`)
  if (detail) for (const line of [].concat(detail)) console.log(`          ${line}`)
}

const summaryPath = arg('summary'), paymentsPath = arg('payments'), actionsPath = arg('actions'), interestPath = arg('interest')
if (!summaryPath) {
  console.error('need at least --summary <file>')
  process.exit(2)
}

const accounts = read(summaryPath)
const payments = paymentsPath ? read(paymentsPath) : []
const actions = actionsPath ? read(actionsPath) : []
const interest = interestPath ? read(interestPath) : []
console.log(`\nSwordfish dry-run\n  accounts ${accounts.length}  payments ${payments.length}  actions ${actions.length}  interest ${interest.length}\n`)

/* ---------- 1. Are the three exports the same accounts? ---------- */
console.log('POPULATION')
const refsOf = (rows) => new Set(rows.map((r) => r['Swordfish Reference']).filter(Boolean))
const A = refsOf(accounts), P = refsOf(payments), C = refsOf(actions)
const missing = (a, b) => [...a].filter((x) => !b.has(x)).length
if (payments.length) {
  const only = missing(P, A)
  check(
    'every account with payments appears in the account summary',
    only === 0,
    only === 0 ? undefined : [
      `${only} accounts have payments but no summary row — their balances cannot be checked.`,
      'Re-export all three reports over one identical account list.',
    ],
  )
}
if (actions.length) {
  const only = missing(C, A)
  check('every account with actions appears in the account summary', only === 0,
    only === 0 ? undefined : [`${only} accounts have actions but no summary row — their fees cannot be checked.`])
}

/* ---------- 2. Does the balance add up the way we think it does? ---------- */
console.log('\nBALANCES')
let worst = 0, bad = 0
for (const r of accounts) {
  const bal = num(r['Current Balance']), fees = num(r['All Fees (inc VAT + FCC)']), exFees = num(r['Current Balance - All Fees (inc VAT + FCC)'])
  if (bal === undefined || fees === undefined || exFees === undefined) continue
  const err = Math.abs(exFees + fees - bal)
  worst = Math.max(worst, err)
  if (err > CENT) bad++
}
check('Current Balance = (capital + interest) + all fees', bad === 0,
  [`worst disagreement ${money(worst)}; ${bad} of ${accounts.length} accounts off by more than a cent`])

/* ---------- 3. Do the payments add up to what the summary claims? ---------- */
if (payments.length) {
  console.log('\nPAYMENTS')
  const paid = new Map()
  for (const p of payments) {
    const ref = p['Swordfish Reference'], amt = num(p['Payment Amount'])
    if (!ref || amt === undefined) continue
    paid.set(ref, (paid.get(ref) ?? 0) + amt)
  }
  let checked = 0, off = 0, worstP = 0
  const examples = []
  for (const r of accounts) {
    const ref = r['Swordfish Reference'], claimed = num(r['Payments To Date'])
    if (!paid.has(ref) || claimed === undefined) continue
    checked++
    const err = Math.abs(paid.get(ref) - claimed)
    worstP = Math.max(worstP, err)
    if (err > CENT) {
      off++
      if (examples.length < 5) examples.push(`${ref}: payments ${money(paid.get(ref))} vs summary ${money(claimed)}`)
    }
  }
  check('payment lines sum to Payments To Date', off === 0,
    [`${checked} accounts checked, ${off} disagree, worst ${money(worstP)}`, ...examples])
}

/* ---------- 4. Is the in duplum ceiling being respected? ---------- */
console.log('\nIN DUPLUM')
const breaches = []
for (const r of accounts) {
  if (r['In Duplum'] !== 'Yes') continue
  const bal = num(r['Current Balance']), cap = num(r['Capital on Default'])
  if (bal === undefined || cap === undefined || cap <= 0) continue
  if (bal > cap * 2 + CENT) breaches.push(`${r['Swordfish Reference']}: balance ${money(bal)} vs twice capital ${money(cap * 2)}`)
}
const flagged = accounts.filter((r) => r['In Duplum'] === 'Yes').length
check('no flagged account exceeds twice its capital', breaches.length === 0,
  [`${flagged} accounts flagged in duplum`, ...breaches.slice(0, 5)])


/* ---------- 4b. Is the interest history complete and contiguous? ---------- */
if (interest.length) {
  console.log('\nINTEREST')
  const byAccount = new Map()
  for (const r of interest) {
    const ref = r['Swordfish Reference']
    if (!ref) continue
    const from = date(r['Date From']), to = date(r['Date To']), amt = num(r['Interest Added'])
    if (!from || !to) continue
    if (!byAccount.has(ref)) byAccount.set(ref, [])
    byAccount.get(ref).push({ from, to, amt: amt ?? 0 })
  }
  const withInterest = [...byAccount.keys()].filter((r) => A.has(r)).length
  check('every account with interest appears in the account summary',
    [...byAccount.keys()].every((r) => A.has(r)),
    [`${withInterest} of ${accounts.length} accounts have interest periods`])

  /*
   * Periods are NOT one sequence per account. Swordfish runs concurrent accrual streams —
   * interest on the balance alongside interest on fees, which start earning as they are raised —
   * and breaks a period at each payment date. So ACF10066 legitimately shows 20-30 July and
   * 1-31 July at once. An earlier version of this check read those as overlaps and reported a
   * failure against perfectly good data; what is worth checking is that no exact period is
   * duplicated, which would double-count.
   */
  const dupes = []
  for (const [ref, rows] of byAccount) {
    const seen = new Set()
    for (const r of rows) {
      const key = `${r.from}|${r.to}|${r.amt}`
      if (seen.has(key)) dupes.push(`${ref}: ${r.from} to ${r.to} appears twice at ${money(r.amt)}`)
      seen.add(key)
    }
  }
  check('no interest period is recorded twice', dupes.length === 0, dupes.slice(0, 5))

  /*
   * Only checkable where the balance is still capital plus interest: a payment reduces it, a
   * write-off or freeze stops interest, and in duplum caps it. Each of those breaks the
   * reconstruction for a legitimate reason, so they are counted separately rather than
   * reported as failures against data that is behaving correctly.
   */
  let tied = 0, checkedI = 0, worstI = 0
  const excluded = { written_off: 0, frozen: 0, in_duplum: 0 }
  for (const r of accounts) {
    if ((num(r['Payments To Date']) ?? 0) > 0) continue
    const status = r['Status'] ?? ''
    if (r['In Duplum'] === 'Yes') { excluded.in_duplum++; continue }
    if (/written.off/i.test(status)) { excluded.written_off++; continue }
    if (/frozen/i.test(status)) { excluded.frozen++; continue }
    const rows = byAccount.get(r['Swordfish Reference'])
    const exFees = num(r['Current Balance - All Fees (inc VAT + FCC)'])
    const cap = num(r['Capital on Default'])
    if (!rows || exFees === undefined || cap === undefined) continue
    checkedI++
    const err = Math.abs(rows.reduce((t, x) => t + x.amt, 0) - (exFees - cap))
    worstI = Math.max(worstI, err)
    // Each monthly accrual is rounded to a cent before it is stored, so a year of them can be
    // half a cent out per period by the time they are added back up. The tolerance scales with
    // the number of periods rather than being a flat cent, which would fail good data on long
    // histories and pass bad data on short ones.
    if (err <= rows.length * 0.005 + CENT) tied++
  }
  check('interest reconstructs the balance where it still can', tied === checkedI, [
    `${tied} of ${checkedI} tie exactly; worst gap ${money(worstI)}`,
    `excluded as legitimately not reconstructable: ${excluded.in_duplum} in duplum, ` +
      `${excluded.written_off} written off, ${excluded.frozen} frozen`,
  ])
}

/* ---------- 5. Can every action be identified, and was it priced correctly? ---------- */
if (actions.length) {
  console.log('\nACTIONS')
  // An unrecognised name only blocks the migration if money was charged against it. Most of
  // what Swordfish records are audit events — files uploaded, sub-status changed, account
  // frozen — which belong in the history but were never billable and need no tariff.
  const unbilled = new Map()
  const billedGap = new Map()
  const quarantined = new Map()
  let mapped = 0
  for (const a of actions) {
    const name = a['Action Name']
    if (!name) continue
    if (codeForLegacyName(name)) { mapped++; continue }
    const cost = num(a['Action Cost (excl VAT)']) ?? 0
    if (isQuarantinedLegacyName(name)) {
      const cur = quarantined.get(name) ?? { n: 0, total: 0 }
      cur.n++; cur.total += cost
      quarantined.set(name, cur)
      continue
    }
    const target = cost > 0 ? billedGap : unbilled
    const cur = target.get(name) ?? { n: 0, total: 0 }
    cur.n++; cur.total += cost
    target.set(name, cur)
  }
  const gaps = [...billedGap.entries()].sort((x, y) => y[1].total - x[1].total)
  check('every action that was charged for maps to a known action', gaps.length === 0,
    gaps.length === 0
      ? [`${mapped} of ${actions.length} mapped; ${unbilled.size} unbilled event types ignored as audit history`]
      : [
          `${gaps.reduce((s, [, v]) => s + v.n, 0)} charged actions across ${gaps.length} names have no catalogue entry`,
          ...gaps.slice(0, 8).map(([n, v]) => `${v.n} x "${n}" — ${money(v.total)}`),
          'Add each to ACTION_DEFINITIONS, or confirm it is not billable.',
        ])
  if (quarantined.size) {
    check('fees held back pending classification', 'warn', [
      ...[...quarantined.entries()].map(([n, v]) => `${v.n} x "${n}" — ${money(v.total)} not carried into balances`),
      'These import as history. Classify them to release the money, or write them off.',
    ])
  }

  let priced = 0, atRate = 0, short = 0, over = 0
  const staleByClient = new Map()
  for (const a of actions) {
    const cost = num(a['Action Cost (excl VAT)'])
    const code = codeForLegacyName(a['Action Name'] ?? '')
    const when = date(a['Action Date'])
    if (!code || !when || cost === undefined || cost <= 0) continue
    const def = ACTION_BY_CODE[code]
    // A per-segment action is correct at any whole multiple of the unit.
    const unit = rateFor(code, when, 1)
    if (unit === undefined) continue
    priced++
    const ok = def.perSegment
      ? Math.abs(cost / unit - Math.round(cost / unit)) < 1e-6 && cost >= unit - CENT
      : Math.abs(cost - unit) < CENT
    if (ok) { atRate++; continue }
    if (cost < unit) {
      short += unit - cost
      const c = a['Client'] ?? '(unknown)'
      staleByClient.set(c, (staleByClient.get(c) ?? 0) + (unit - cost))
    } else over += cost - unit
  }
  const pct = priced ? (100 * atRate) / priced : 0
  check('actions charged at the tariff in force on the day', pct >= 99.5 ? true : 'warn',
    [
      `${atRate} of ${priced} priced at the rate for their date (${pct.toFixed(1)}%)`,
      `under-charged ${money(short)} excl VAT, over-charged ${money(over)} excl VAT`,
      ...[...staleByClient.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([c, v]) => `worst client: ${c} — ${money(v)}`),
    ])
}

/* ---------- 5b. Is the Annexure B fee ceiling being respected? ---------- */
if (actions.length) {
  console.log('\nFEE CEILING')
  /*
   * "The total amount to be recovered from the debtor in respect of items 1 to 7 of the Annexure
   * shall not exceed the capital amount of the debt or R1225,00, whichever is the lesser."
   *
   * Two halves. The flat figure is enforced to the cent — accounts land on exactly R1,023.00 or
   * exactly R1,225.00, with the fee that would have crossed the line trimmed to fit. The capital
   * half is the one that gets missed, and it only bites on small debts, which is exactly where
   * nobody is looking. This checks both, against the ceiling in force on the account's own
   * last charged date rather than today's.
   */
  const charged = new Map()
  const lastCharge = new Map()
  for (const a of actions) {
    const ref = a['Swordfish Reference']
    const cost = num(a['Action Cost (excl VAT)']) ?? 0
    if (!ref || cost <= 0) continue
    charged.set(ref, (charged.get(ref) ?? 0) + cost)
    const when = date(a['Action Date'])
    if (when && (!lastCharge.has(ref) || when > lastCharge.get(ref))) lastCharge.set(ref, when)
  }

  const breaches = []
  let overCapital = 0, overFlat = 0, worstDate = '1900-01-01'
  for (const r of accounts) {
    const ref = r['Swordfish Reference']
    const cap = num(r['Capital on Default'])
    const total = charged.get(ref)
    if (cap === undefined || total === undefined) continue
    const on = lastCharge.get(ref) ?? worstDate
    const schedule = scheduleFor(on)
    const limit = feeCeiling(cap, schedule)
    if (total <= limit + CENT) continue
    const over = total - limit
    if (cap < schedule.itemsOneToSevenCeiling) overCapital += over
    else overFlat += over
    breaches.push({ ref, total, cap, limit, over, capitalBound: cap < schedule.itemsOneToSevenCeiling })
  }
  breaches.sort((a, b) => b.over - a.over)

  check('no account is charged past its items 1-7 ceiling', breaches.length === 0 ? true : 'warn', [
    `${breaches.length} of ${accounts.length} accounts exceed min(capital, ceiling); ${money(overCapital + overFlat)} excl VAT over in total`,
    `${money(overCapital)} of that is on accounts where the CAPITAL was the binding limit — the half of the rule Swordfish does not apply`,
    `${money(overFlat)} is a few rand over the flat ceiling on ${breaches.filter((b) => !b.capitalBound).length} accounts, which reads as keying`,
    ...breaches.filter((b) => b.capitalBound).slice(0, 5).map(
      (b) => `${b.ref}: ${money(b.total)} of fees on ${money(b.cap)} of capital — over by ${money(b.over)}`),
  ])
}

/* ---------- 6. How many Swordfish "clients" are really one client? ---------- */
console.log('\nCLIENTS')
const tranche = /\s*[-–]\s*\d+$|\s+\d{4}\s*[-–]\s*\d+$/
const bases = new Map()
for (const r of accounts) {
  const name = (r['Client'] ?? '').trim()
  if (!name) continue
  const base = name.replace(tranche, '').trim()
  if (!bases.has(base)) bases.set(base, new Set())
  bases.get(base).add(name)
}
const collapsing = [...bases.entries()].filter(([, v]) => v.size > 1)
check('Swordfish client names collapse to real clients', collapsing.length === 0 ? true : 'warn',
  [
    `${new Set(accounts.map((r) => r['Client'])).size} Swordfish clients -> ${bases.size} real clients`,
    ...collapsing.slice(0, 4).map(([b, v]) => `${b}: ${v.size} tranches`),
  ])

/* ---------- verdict ---------- */
const failed = checks.filter((c) => c.ok === false).length
const warned = checks.filter((c) => c.ok === 'warn').length
console.log(`\n${failed === 0 ? 'No blocking failures' : `${failed} FAILED`}${warned ? `, ${warned} warning(s)` : ''}.`)
console.log(failed === 0
  ? 'Safe to proceed to a trial import on a scratch project.\n'
  : 'Do not import until the failures above are understood — they mean our model and Swordfish disagree about money.\n')
process.exit(failed === 0 ? 0 : 1)
