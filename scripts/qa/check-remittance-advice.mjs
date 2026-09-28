/**
 * THE REMITTANCE ADVICE: WHAT MAY APPEAR ON A CLIENT'S TAX INVOICE, AND WHAT MAY NOT.
 *
 * This one IS arithmetic, unlike the engine checks, and the difference is worth stating. The split
 * lives in the database so three callers cannot disagree about it; the ADVICE is a document model
 * in TypeScript, so the model is the only copy and testing it here is testing the thing itself.
 *
 * THE FOUR FIXES OVER THE REPORT IT REPLACES are each a thing the firm had to explain to a client,
 * and each would come back silently:
 *   - A row with R0.00 capital received. The money is still in the totals; it is the LINE that
 *     misleads, because beside real rows it reads as "we collected nothing for you".
 *   - "Paid in full" beside capital still outstanding, which is what a STORED status does when the
 *     money moves and nobody re-reads it.
 *   - A payment dated before the period, with no explanation of why it is in this run.
 *   - A reversal quietly reducing a total instead of appearing as a line.
 *
 * AND THE ONE RULE THE WHOLE MODULE TURNS ON: the client sees the CAPITAL PORTION and never the
 * gross payment, the receipt fee, the interest or the costs. The firm's own words on the board:
 * "Only BF sees the gross payment amount on trust-account payments."
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-remittance-advice.mjs
 */
import { readFileSync } from 'node:fs'
import {
  ANNEXURE_B_FOOTNOTE, adviceBody, adviceSchedule, adviceSubject, advStatus, buildRemittanceAdvice,
} from '../../src/lib/remittanceAdvice.ts'

import { rand, amount, randOrDash, ratePercent, NBSP } from '../../src/lib/money.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)

const FIRM = {
  name: 'Bredell Ferreira', address: '239 Bronkhorst Street', phone: '012 348 2156',
  email: 'info@bredellferreira.co.za', vatNumber: '4350289080',
}
const CLIENT = { name: 'Dr CA Roux', code: 'FF0092', vatNumber: '4000000000' }
const RUN = {
  invoiceNumber: 'PO-FF0092-2412', periodStart: '2024-11-11', periodEnd: '2024-12-10',
  issuedOn: '2024-12-11',
  trustCapital: 64034.58, trustCommission: 19210.38, dueToClient: 44824.20,
  ptcReceived: 4900, ptcFeesTaken: 1975.11, ptcCapital: 2924.89, ptcCommission: 877.47,
  dueToBf: 2852.58, commissionVat: 3013.30, carriedIn: 0, netPayover: 38958.32,
  commissionRate: 0.30, paidAt: null, eftReference: null,
}
const line = (o = {}) => ({
  lineId: 'l', allocationId: 'a', paymentId: 'p', accountId: 'acc',
  clientReference: '5956', caseNumber: 'DCR1319', debtor: 'Lindie van Wyk',
  lineKind: 'trust', paidToClient: false,
  receivedAt: '2024-11-19T00:00:00Z', capturedAt: '2024-11-19T00:00:00Z',
  paymentAmount: 1000, receiptFee: 115, toInterest: 310, toCosts: 190, toCapital: 500,
  commission: 150, commissionVat: 22.5, toClient: 327.5, dueToBf: 0,
  excessCredit: 0, needsRate: false, capitalAfter: 3206.20, carriedAmount: 0,
  lateCapture: false, accountStatus: 'Active: Arrangement', handoverDate: '2019-06-12',
  capitalHandedOver: 21206.20, paidInFull: false, ...o,
})
const build = (lines, over = {}) => buildRemittanceAdvice({
  firm: FIRM, client: CLIENT, run: { ...RUN, ...over }, lines,
})

/* ---------------- the money, written the firm's way ---------------- */

check('a Rand amount groups with a non-breaking space', rand(12345.67), `R${NBSP}12${NBSP}345.67`)
/* U+00A0 KEEPS THE FIGURE TOGETHER, and it is the character en-ZA itself produces. It also costs
   money in an SMS -- not in the GSM alphabet, so one merged amount halves every segment -- which
   is why SmsModal strips it and screens and PDFs do not. */
ok('...which is U+00A0, not a space anybody can type', rand(1000).includes(' '))
check('a negative keeps the R in front of the minus', rand(-289.84), `-R${NBSP}289.84`)
check('the number alone is grouped too', amount(1096738811), `1${NBSP}096${NBSP}738${NBSP}811.00`)
check('nought is an amount', rand(0), `R${NBSP}0.00`)
/* NULL IS NOT NOUGHT: a client with no commission rate shows a dash, because 0% is a rate
   somebody agreed to. The same distinction payment_allocations.commission_rate keeps. */
check('a missing figure is a dash, never R 0.00', randOrDash(null), '—')
check('...and a missing rate too', ratePercent(null), '—')
check('a rate is written as a percentage', ratePercent(0.30), '30%')
check('...without trailing noughts', ratePercent(0.225), '22.5%')

/* ---------------- what the client is allowed to see ---------------- */

const adv = build([line()])
const c = adv.collections[0]
/*
 * THE CAPITAL PORTION AND NOTHING ELSE. The row carries a R1 000 payment of which R115 was the
 * receipt fee, R310 interest and R190 costs -- none of which is the client's business, and all of
 * which the firm keeps. R500 is what they collected FOR the client.
 */
check('the collections row shows the capital portion', c.capitalReceived, 500)
const row = JSON.stringify(c)
for (const [what, value] of [['the gross payment', 1000], ['the receipt fee', 115], ['interest', 310], ['costs', 190]]) {
  ok(`...and never ${what}`, !row.includes(`:${value},`) && !row.includes(`:${value}}`))
}
check('...with the commission and VAT on it', [c.commission, c.vat], [150, 22.5])

/* ---------------- the four fixes ---------------- */

/* A LINE WITH NO CAPITAL IS NOT PRINTED. The payment is still in the run's totals. */
const nothing = build([line(), line({ lineId: 'z', toCapital: 0, commission: 0, commissionVat: 0 })])
check('a payment that reached no capital is not a line', nothing.collections.length, 1)

/* "PAID IN FULL" IS EARNED, NOT STORED. FileFish printed it beside R5 635.80 outstanding. */
check('paid in full only when the capital is nought',
  advStatus({ paidInFull: true, accountStatus: 'Active: Activated' }), 'Paid in full')
/*
 * AND A STORED STATUS MAY NOT SAY IT EITHER. This is where FileFish's "Paid in Full" beside
 * R5 635.80 outstanding actually came from, and deriving the phrase is only half the fix if the
 * column can still supply the words.
 */
check('...and a stored status cannot say it while capital is outstanding',
  advStatus({ paidInFull: false, accountStatus: 'Paid in Full' }), 'In progress')
check('...however it is spelled',
  advStatus({ paidInFull: false, accountStatus: 'Closed: paid in full' }), 'In progress')
/* THE INTERNAL PREFIX IS DROPPED. "Active: Unfrozen" is how a row got into the table. */
check('the internal prefix does not reach a client',
  advStatus({ paidInFull: false, accountStatus: 'Active: Unfrozen' }), 'Unfrozen')
check('...and an empty status reads as in progress',
  advStatus({ paidInFull: false, accountStatus: '' }), 'In progress')

/* A PAYMENT OLDER THAN THE PERIOD SAYS WHY IT IS HERE. */
const late = build([line({ lateCapture: true })])
check('a payment captured after the previous cut-off is flagged', late.collections[0].lateCapture, true)

/* A REVERSAL IS A LINE, NOT A SILENT SUBTRACTION. */
const rev = build([line(), line({ lineId: 'r', lineKind: 'reversal', toCapital: -500, commission: -150, commissionVat: -22.5 })])
check('a reversal appears as its own line', rev.collections.filter((x) => x.reversal).length, 1)
check('...carrying negative figures', rev.collections.find((x) => x.reversal).capitalReceived, -500)

/* ---------------- the client-direct table ---------------- */

const ptc = build([line({
  lineKind: 'ptc', paidToClient: true, paymentAmount: 4900, toInterest: 0, toCosts: 1975.11,
  toCapital: 2924.89, commission: 877.47, commissionVat: 131.62, dueToBf: 2852.58, toClient: 0,
})])
const d = ptc.direct[0]
check('a client-direct row shows what the debtor paid them', d.receivedByYou, 4900)
/*
 * "ANNEXURE B FEES" IS WHAT THIS PAYMENT RECOVERED, never what the account still owes. The firm's
 * own wording in prompt 4: do not show other fees still outstanding on the account.
 */
check('...the fees this payment actually recovered', d.annexureBFees, 1975.11)
check('...and the capital portion and commission', [d.capitalPortion, d.commission], [2924.89, 877.47])
/* DUE TO US EXCLUDES THE COMMISSION VAT -- the same rule as due_to_bf, and the board's own
   1 975.11 + 877.47 = 2 852.58. Including it would charge the client that VAT twice. */
check('due to us is fees plus commission, without the VAT', d.dueToUs, 2852.58)
ok('the footnote explains what an Annexure B fee is',
  ANNEXURE_B_FOOTNOTE.includes('Debt Collectors Act') && ANNEXURE_B_FOOTNOTE.includes('do not form part of the capital'))

/* ---------------- page one ---------------- */

check('page one leads with what was collected', adv.headline.collectedByBf, 64034.58)
check('...counts the payments behind it', adv.headline.payments, 1)
check('...and ends on the net', adv.headline.net, 38958.32)
/* THE WORKINGS ADD UP TO THE NET, which is the only arithmetic on the page and the one a client
   checks with a calculator. 64 034.58 - 19 210.38 - 2 852.58 - 3 013.30 = 38 958.32. */
const workings = adv.workings.filter((w) => !w.emphasis).reduce((t, w) => t + w.amount, 0)
check('the workings add up to the net', Math.round(workings * 100) / 100, 38958.32)
check('...and the last line is the net itself', adv.workings.at(-1).amount, 38958.32)
ok('...named as the amount being paid', /paying you/i.test(adv.workings.at(-1).label))
ok('the commission line quotes the rate', adv.workings.some((w) => w.label.includes('30%')))

/* A SHORTFALL BROUGHT FORWARD IS A LINE OF ITS OWN, and it is negative. */
const carried = build([line()], { carriedIn: -1479.92, netPayover: 37478.40 })
ok('a shortfall carried in is shown', carried.workings.some((w) => /Brought forward/.test(w.label) && w.amount === -1479.92))

/* ---------------- a tax invoice says what it is missing ---------------- */

const noVat = buildRemittanceAdvice({
  firm: { ...FIRM, vatNumber: null }, client: { ...CLIENT, vatNumber: null, code: null },
  run: RUN, lines: [line()],
})
ok('a missing firm VAT number is reported', noVat.problems.some((p) => /firm has no VAT/i.test(p)))
ok('...and the client’s', noVat.problems.some((p) => /has no VAT number/i.test(p)))
ok('...and a provisional invoice number', noVat.problems.some((p) => /provisional/i.test(p)))
check('a complete invoice reports nothing', adv.problems, [])

/* ---------------- and nothing a PDF cannot draw ---------------- */

/*
 * WINDOWS-1252 IS THE WHOLE REPERTOIRE, because the fourteen standard PDF faces can draw nothing
 * else. The first run of this document used a real MINUS SIGN (U+2212) and winAnsi refused it --
 * which is the guard working. Anything reaching a PDF uses the hyphen every encoding has.
 */
const pdfSrc = readFileSync(new URL('../../src/lib/remittancePdf.ts', import.meta.url), 'utf8')
check('the statement contains no character WinAnsi cannot encode',
  (pdfSrc.match(/[−‐‑]/g) ?? []), [])
/* AND IT REFUSES RATHER THAN SUBSTITUTING. A debtor's name is a word; the firm's rule for a
   section 129 applies to an invoice too. */
ok('an unprintable character is reported, not swapped', /unprintableMessage\(\[\.\.\.new Set\(unprintable\)\]\)/.test(pdfSrc))
const emailSrc = readFileSync(new URL('../../src/lib/remittanceEmail.ts', import.meta.url), 'utf8')
ok('...and a statement that cannot be drawn is not emailed',
  /if \(problem\) throw new Error\(problem\)/.test(emailSrc))
/* THE RUN IS MARKED SENT ONLY AFTER THE MESSAGE HAS GONE. The other order leaves a client never
   chased for a statement they never received, with the queue showing the job as done. */
ok('the run is marked sent after the send, not before',
  emailSrc.indexOf('await markRunSent(runId)') > emailSrc.indexOf("fetch('/api/email/send'"))
/* NO NEW ENDPOINT: api/ is at Vercel Hobby's cap of twelve functions. */
ok('it reuses the existing send endpoint', /fetch\('\/api\/email\/send'/.test(emailSrc))
/* BLANK LINES ARE PARAGRAPHS, which is the firm's rule after a final notice went out as one block. */
ok('the covering message is rendered by emailBodyHtml', /emailBodyHtml\(adviceBody\(adv\)\)/.test(emailSrc))

/* ---------------- the spreadsheet that travels with it ---------------- */

/*
 * THE SAME DETAIL, FOR WORKING RATHER THAN READING. The firm asked for both: the PDF is the tax
 * invoice, the .xlsx is what a bookkeeper sorts and totals against their own ledger.
 *
 * AMOUNTS GO IN AS NUMBERS AND REFERENCES AS TEXT, which is the same argument pointing two ways.
 * xlsxWrite's default is text because the rejected-rows sheet goes BACK to a client and Excel
 * reformatting it would eat their corrections -- 40 of 42 phone numbers on one client's own sheet
 * had already lost a leading zero that way. Here text would stop a column being summed. So the
 * caller says which, and the choice that can corrupt data is the one needing no thought.
 */
/* A RUN WITH BOTH KINDS ON IT, because the schedule's job is to carry both tables and a fixture
   with only one would let a missing heading through. */
const both = build([line(), line({
  lineId: 'p2', lineKind: 'ptc', paidToClient: true, paymentAmount: 4900, toInterest: 0,
  toCosts: 1975.11, toCapital: 2924.89, commission: 877.47, commissionVat: 131.62,
  dueToBf: 2852.58, toClient: 0,
})])
const schedule = adviceSchedule(both)
ok('the schedule is a readable zip', schedule.length > 1000
  && schedule[0] === 0x50 && schedule[1] === 0x4B && schedule[2] === 0x03 && schedule[3] === 0x04)
const sheetXml = new TextDecoder().decode(schedule)
/* A DEFLATED entry would not be greppable; stored is what makes this assertion possible at all,
   and stored is what xlsxWrite already chose so that no caller has to be async. */
ok('...with the sheet inside it', sheetXml.includes('xl/worksheets/sheet1.xml'))
/*
 * BOTH TABLES, NOT JUST ONE. The first version of this looked for a single numeric cell and a
 * break test that turned every COLLECTIONS amount into text walked straight through it, because
 * the client-direct table still had one. An assertion that one amount somewhere is a number
 * proves nothing about the column a bookkeeper wants to sum.
 */
ok('a collections amount is a number Excel can total', /<v>500<\/v>/.test(sheetXml))
ok('...and a client-direct one', /<v>4900<\/v>/.test(sheetXml))
ok('...and the workings, so the reconciliation totals too', /<v>38958\.32<\/v>/.test(sheetXml))
ok('...and a reference keeps its leading zeros as text',
  /<t xml:space="preserve">5956<\/t>/.test(sheetXml))
ok('both tables are on the one sheet',
  sheetXml.includes('Collections by us') && sheetXml.includes('Paid to you directly'))
ok('...and the workings after them', sheetXml.includes('How we got there'))
/* AND IT GOES WITH THE PDF, not instead of it. */
ok('the email carries both attachments',
  /\$\{adv\.run\.invoiceNumber\}\.pdf/.test(emailSrc)
  && /\$\{adv\.run\.invoiceNumber\} schedule\.xlsx/.test(emailSrc))

console.log(`\ncheck-remittance-advice: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
