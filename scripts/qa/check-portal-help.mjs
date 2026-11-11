/**
 * THE PORTAL'S HELP SECTION TELLS THE TRUTH (Ryno, 11 Nov · Raptor · Handover 19).
 *
 * A help page that explains the 50/50 split wrongly is worse than none: the client learns to expect a figure their
 * remittance advice will never show, and the first call they make is a complaint. So:
 *
 *  1. EVERY EXAMPLE THE FILM AND THE CALCULATOR CAN SHOW IS HELD TO THE FIRM'S OWN RULES -- `checkAllocation`, the
 *     same named rules the payment run is held to (allocationRules.ts). Not a second copy of the rules: the rules.
 *     The three shown examples, then a sweep of awkward amounts (odd cents, fees bigger than the payment, nothing
 *     owing, capital smaller than the payment).
 *  2. THE RECEIPT FEE THE GUIDE NAMES IS THE TARIFF'S. The split cannot be explained without "10% plus VAT", so it is
 *     the one rate written out in words; this holds it to annexureB's current schedule.
 *  3. THE POSITIONS GUIDE IS THE THIRTEEN RUNGS, built from clientPosition.ts, every one with its meaning.
 *  4. EVERY GUIDE HAS SOMETHING IN IT, and every "open" points at a portal section that exists.
 *  5. THE PORTAL OFFERS HELP: the section is in the menu and drawn.
 *
 * Each was broken on purpose once and seen to fail (see the handover).
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-portal-help.mjs
 */
import { readFileSync } from 'node:fs'
import { allocationOf, checkAllocation } from '../../src/lib/allocationRules.ts'
import { SPLIT_EXAMPLES, splitPayment } from '../../src/pages/portal/help/splitExample.ts'
import { HELP_GUIDES, HELP_TOPICS, matchesGuide } from '../../src/pages/portal/help/helpGuides.ts'
import { CLIENT_POSITION_ORDER, CLIENT_POSITIONS } from '../../src/lib/clientPosition.ts'
import { ANNEXURE_B_2026 as DEFAULT_SCHEDULE } from '../../src/lib/annexureB.ts'

let pass = 0
const failures = []
const ok = (name, cond, detail = '') => { if (cond) pass += 1; else failures.push(`${name}${detail ? `\n    ${detail}` : ''}`) }

/* ------------------------------------------------------------------ 1. the split, held to the real rules */
/* What the engine would report for this payment, built from the illustration. Interest's `before`/`after` are
   the illustration's own; the two fee buckets are derived exactly as allocationOf derives them. */
function figures(input) {
  const r = splitPayment(input)
  const interest = Math.max(0, input.interestOwing)
  const fees = Math.max(0, input.feesOwing)
  return {
    r,
    a: allocationOf({
      payment: r.payment,
      interestTotal: interest, interestCant: 0, interestRetained: 0,
      interestBefore: interest, toInterest: r.toInterest, interestAfter: r.interestLeft,
      rfTotal: r.receiptFee, rfCant: 0, rfRetained: 0, toReceiptFees: r.toReceiptFee,
      feesTotal: fees, feesCant: 0, feesRetained: 0, toFees: r.toFees,
      /* The pool BEFORE this payment holds the old fees only; the receipt fee this payment raises joins it. */
      costsBefore: fees, costsAfter: r.receiptFeeLeft + r.feesLeft, receiptFeeRaised: r.receiptFee,
      capitalBefore: Math.max(0, input.capitalOwing), toCapital: r.toCapital, capitalAfter: r.capitalLeft,
      commission: r.commission, commissionVat: r.commissionVat, toClient: r.toClient, dueToBf: 0,
      excess: r.excess, paidToClient: false, commissionRate: input.commissionRate, vatRate: 0.15,
    }),
  }
}
const broken = (input) => checkAllocation(figures(input).a)

for (const e of SPLIT_EXAMPLES) {
  const v = broken(e.input)
  ok(`example "${e.id}" obeys every allocation rule`, v.length === 0, v.map((x) => `${x.rule}: ${x.detail}`).join('\n    '))
}

/* The film's three stories are what they say they are. */
const roll = splitPayment(SPLIT_EXAMPLES.find((e) => e.id === 'roll').input)
ok('the "roll" example really rolls something to capital', roll.rolled > 0 && roll.toCapital > roll.otherHalf)
const full = splitPayment(SPLIT_EXAMPLES.find((e) => e.id === 'full').input)
ok('the "full" example spends exactly half on fees and leaves fees owing', full.feesSide === full.half && full.feesLeft > 0)
const clear = splitPayment(SPLIT_EXAMPLES.find((e) => e.id === 'clear').input)
ok('the "clear" example takes only the receipt fee', clear.feesSide === clear.receiptFee && clear.toInterest === 0 && clear.toFees === 0)
ok('R1 000 raises a R115 receipt fee (10% plus 15% VAT)', roll.receiptFee === 115)

/* The awkward amounts a client will type. */
const sweep = []
for (const payment of [0.01, 0.03, 1, 99.99, 333.33, 1000, 2500, 12345.67]) {
  for (const interestOwing of [0, 7.77, 500, 99999]) {
    for (const feesOwing of [0, 13, 2000]) {
      for (const capitalOwing of [0.5, 400, 1e6]) {
        for (const commissionRate of [0, 0.125, 0.3]) sweep.push({ payment, interestOwing, feesOwing, capitalOwing, commissionRate })
      }
    }
  }
}
const bad = sweep.map((input) => ({ input, v: broken(input) })).filter((x) => x.v.length)
ok(`every one of ${sweep.length} awkward inputs obeys every allocation rule`, bad.length === 0,
  bad.slice(0, 3).map((x) => `${JSON.stringify(x.input)} -> ${x.v[0].rule}: ${x.v[0].detail}`).join('\n    '))

/* And the checker can see a wrong split: commission on the whole payment is the classic error. */
{
  const { a } = figures(SPLIT_EXAMPLES[0].input)
  const wrong = { ...a, commission: Math.round(a.payment * 0.15 * 100) / 100 }
  ok('a split charging commission on the whole payment is caught', checkAllocation(wrong).some((v) => /Commission/.test(v.rule)))
}

/* ------------------------------------------------------------------ 2. the receipt fee the guide names */
const splitGuide = HELP_GUIDES.find((g) => g.id === 'split')
const splitWords = JSON.stringify(splitGuide?.blocks ?? [])
ok('the split guide exists and carries the explainer', !!splitGuide && splitGuide.blocks.some((b) => b.kind === 'split'))
ok(`the guide's receipt fee is the tariff's (${DEFAULT_SCHEDULE.receiptFeeRate * 100}%)`,
  splitWords.includes(`${DEFAULT_SCHEDULE.receiptFeeRate * 100}% of the payment plus VAT`))
ok('the guide says commission is on capital only', /never on interest or fees/.test(splitWords))

/* ------------------------------------------------------------------ 3. the positions guide */
const positions = HELP_GUIDES.find((g) => g.id === 'positions')
const terms = positions?.blocks.find((b) => b.kind === 'terms')?.items ?? []
ok('the positions guide lists all thirteen positions', terms.length === 13 && CLIENT_POSITION_ORDER.length === 13, `got ${terms.length}`)
for (const p of CLIENT_POSITION_ORDER) {
  const t = terms.find((x) => x.term.endsWith(CLIENT_POSITIONS[p].label))
  ok(`the positions guide explains "${CLIENT_POSITIONS[p].label}" in clientPosition's own words`, t?.meaning === CLIENT_POSITIONS[p].meaning)
}

/* ------------------------------------------------------------------ 4. every guide */
const SECTIONS = ['dashboard', 'reports', 'tickets', 'accounts', 'handover']
const ids = new Set()
for (const g of HELP_GUIDES) {
  ok(`guide "${g.id}" has a unique id`, !ids.has(g.id)); ids.add(g.id)
  ok(`guide "${g.id}" has a title, a summary and something in it`, !!g.title && !!g.summary && g.blocks.length > 0)
  ok(`guide "${g.id}" is under a known topic`, HELP_TOPICS.includes(g.topic))
  if (g.open) ok(`guide "${g.id}" opens a section that exists`, SECTIONS.includes(g.open.section))
}
for (const t of HELP_TOPICS) ok(`topic "${t}" has at least one guide`, HELP_GUIDES.some((g) => g.topic === t))
ok('searching "commission" finds the split guide', matchesGuide(splitGuide, 'commission'))
ok('searching for nonsense finds nothing', !HELP_GUIDES.some((g) => matchesGuide(g, 'zzqx')))

/* ------------------------------------------------------------------ 5. the portal offers it */
const page = readFileSync(new URL('../../src/pages/portal/PortalPage.tsx', import.meta.url), 'utf8')
ok('Help is in the portal menu', /\{ id: 'help', label: 'Help'/.test(page))
ok('the Help section is drawn', /section === 'help' && <PortalHelp/.test(page))

console.log(`${pass} passed, ${failures.length} failed`)
if (failures.length) { console.error(failures.map((f) => `  x ${f}`).join('\n')); process.exit(1) }
