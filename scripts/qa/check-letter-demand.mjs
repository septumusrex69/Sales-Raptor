/**
 * THE LETTER OF DEMAND BUILDER'S RULES (S13 · Raptor · Handover 16, Ryno, 3 Nov) -- src/lib/letterOfDemand.ts,
 * the sheet reader's pure parts (demandLetterPdf.ts), and the server's "send from the central mailbox".
 *
 * Held here: the amount the letter demands (a typed one wins; otherwise the invoices, in cents); the mismatch
 * warning; numbers in words; the wording's fields and bold; what is missing before a download and before a
 * send; what an account fills in and what it leaves alone; clients ranked as you type; and who may send from
 * the firm's central mailbox, on the screen and on the server alike.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-letter-demand.mjs
 */
import { readFileSync } from 'node:fs'

const L = await import('../../src/lib/letterOfDemand.ts')
const P = await import('../../src/lib/demandLetterPdf.ts')

let pass = 0
const failures = []
const check = (name, got, want) => {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g === w) pass += 1
  else failures.push(`${name}\n      expected ${w}\n      got      ${g}`)
}
const ok = (name, v) => check(name, !!v, true)

const TODAY = new Date('2026-11-03T08:00:00+02:00')
const full = (o = {}) => ({
  ...L.freshLetter(TODAY), debtor: 'Karoo Haulage', client: 'Sample Client', stmt: '27 October 2026', ref: 'KAROO',
  rows: [{ inv: 'INV-1', date: '1 Aug', ref: 'X', desc: 'Transport', amt: 'R106,000.00' }], ...o,
})

/* ------------------------------------------- money ------------------------------------------- */
check('amounts are read however they are typed', ['R106,000.00', '106000', '  R 1 234.50 ', '', 'abc', '-'].map(L.parseAmount), [106000, 106000, 1234.5, null, null, null])
check('...and written as Ryno wrote them', L.formatAmount(106000), 'R106,000.00')
check('the invoices add up in cents, not floating point', L.invoiceTotal(Array.from({ length: 30 }, () => ({ amt: '0.10' }))), 3)
check('the amount due is the invoices\' total', L.amountDue({ amount: '', rows: [{ amt: '100' }, { amt: '50.5' }] }), 150.5)
check('...unless one is typed, which wins', L.amountDue({ amount: 'R200', rows: [{ amt: '100' }] }), 200)
check('...and is nothing when nothing has an amount', L.amountDue({ amount: '', rows: [{ amt: '' }] }), null)
ok('a typed amount that differs from the invoices is said', /doesn’t match the invoice total of R100\.00/.test(L.amountMismatch({ amount: '200', rows: [{ amt: '100' }] }) ?? ''))
check('...and one that agrees is not', L.amountMismatch({ amount: 'R100.00', rows: [{ amt: '100' }] }), null)
check('days in words', [7, 14, 21, 30, 99, 100, 7.5].map(L.numberWord), ['seven', 'fourteen', 'twenty-one', 'thirty', 'ninety-nine', null, null])
check('the date is the firm\'s, as the letter prints it', L.letterDate(new Date('2026-11-02T23:30:00Z')), '3 November 2026')

/* ------------------------------------------- wording ------------------------------------------- */
{
  const v = L.fieldValues(full())
  const segs = L.wordingSegments('Pay {total} using **{ref}** by {nonsense}', v)
  check('the wording fills its fields and keeps its bold', segs.map((x) => [x.text, x.bold, x.field]),
    [['Pay ', false, null], ['R106,000.00', false, 'total'], [' using ', false, null], ['KAROO', true, 'ref'], [' by ', false, null], ['{nonsense}', false, null]])
  const empty = L.wordingSegments('dated {stmt}', L.fieldValues(full({ stmt: '' })))
  check('...an empty field prints in [brackets], marked empty', empty.map((x) => [x.text, x.empty]), [['dated ', false], ['[statement date]', true]])
  check('braces that name no field are found, so the form can say so', L.unknownFields({ ...L.STANDARD_WORDING, closing: 'Call {phone} or {ref}' }), ['phone'])
  check('the standard wording uses only fields Raptor knows', L.unknownFields(L.STANDARD_WORDING), [])
  ok('...and is Ryno\'s, word for word', /We hereby demand payment of the full outstanding amount of \{total\} within \{days\} \(\{daysWord\}\) calendar days of receipt of this letter\./.test(L.STANDARD_WORDING.demand))
}

/* ------------------------------------------- what is missing ------------------------------------------- */
check('a complete letter is missing nothing', L.missingFor('letter', full()), [])
check('a blank letter is missing everything, in the form\'s words', L.missingFor('letter', L.freshLetter(TODAY)),
  ['Debtor', 'Client', 'Statement date', 'Payment reference', 'Amount due', '1 invoice'])
check('the acknowledgement needs no statement date or invoices', L.missingFor('ack', full({ stmt: '', rows: [L.blankRow()], amount: '5' })), [])
check('an invoice with no number or no amount counts as missing', L.missingFor('letter', full({ rows: [{ inv: 'A', amt: '1' }, { inv: '', amt: '2' }, { inv: 'C', amt: '' }].map((r) => ({ ...L.blankRow(), ...r })) })), ['2 invoices'])
check('nothing goes to a debtor with a gap in it', L.sendBlockers(full({ stmt: '' })), ['Statement date'])
check('the file is named for the debtor and the date, safely', L.fileName('letter', { debtor: 'A/B: "C"', date: '3 November 2026' }), 'Letter of Demand - AB C - 3 November 2026.pdf')

/* ------------------------------------------- from an account ------------------------------------------- */
{
  const d = { id: 'a1', companyId: 'c1', accountNumber: 'SCL/00042', clientReference: 'INV-7781', debtorFirstName: null, debtorSurname: 'Karoo Haulage (Pty) Ltd',
    debtorKind: 'company', capitalHandedOver: 106000, balance: 112450.5 }
  const before = full({ stmt: '27 October 2026', services: 'transport services', amount: 'R1', wording: { ...L.STANDARD_WORDING, closing: 'Mine.' } })
  const after = L.fillFromAccount(before, d)
  check('an account fills the debtor, the reference and the link', [after.debtor, after.ref, after.accountId], ['Karoo Haulage (Pty) Ltd', 'SCL/00042', 'a1'])
  check('...one invoice line from the handover, at the balance', after.rows.map((r) => [r.inv, r.ref, r.amt]), [['INV-7781', 'SCL/00042', 'R112,450.50']])
  ok('...which says where it came from', /check against the client’s statement/.test(after.rows[0].desc))
  check('...clears a typed amount, so the line is what is demanded', [after.amount, L.amountDue(after)], ['', 112450.5])
  check('...and leaves the wording, the statement date and the services alone', [after.wording.closing, after.stmt, after.services, after.client], ['Mine.', '27 October 2026', 'transport services', 'Sample Client'])
  check('no balance worked out yet: the capital handed over', L.fillFromAccount(before, { ...d, balance: null }).rows[0].amt, 'R106,000.00')
  check('a person\'s name is first name and surname', L.debtorDisplayName({ debtorFirstName: 'Piet', debtorSurname: 'Smit', accountNumber: 'X' }), 'Piet Smit')
  check('a reference matches the account number or the client\'s reference exactly', [L.matchesReference(d, ' scl/00042 '), L.matchesReference(d, 'INV-7781'), L.matchesReference(d, 'SCL'), L.matchesReference(d, '')], [true, true, false, false])
}

/* ------------------------------------------- clients as you type ------------------------------------------- */
{
  const all = [{ name: 'Northbank Properties', code: 'NBP' }, { name: 'Bank of Nort', code: null }, { name: 'Karoo North', code: 'EN' }, { name: 'Sample Client', code: 'SCL' }]
  check('a name starting with it first, then a word starting with it, then anywhere', L.rankClients(all, 'nort').map((c) => c.name), ['Northbank Properties', 'Bank of Nort', 'Karoo North'])
  check('...the code counts', L.rankClients(all, 'scl').map((c) => c.name), ['Sample Client'])
  check('...nothing typed, nothing offered', L.rankClients(all, '  '), [])
}

/* ------------------------------------------- who sends from the central mailbox ------------------------------------------- */
check('the central mailbox: an Administrator and the client liaisons, nobody else',
  ['Administrator', 'Liaison', 'Liaison Manager', 'Agent', 'Sales Representative', 'Sales Manager', null].map(L.maySendFromCentral),
  [true, true, true, false, false, false, false])
{
  const src = readFileSync(new URL('../../api/_lib/email/send.ts', import.meta.url), 'utf8')
  const central = readFileSync(new URL('../../api/_lib/centralMailbox.ts', import.meta.url), 'utf8')
  ok('the server asks the same rule before it sends as the central mailbox', /if \(!maySendFromCentral\(\(me as \{ role\?: string \} \| null\)\?\.role\)\) \{\s*return \{ error:/.test(central))
  ok('...sends as the central mailbox only when asked', /if \(mailbox === 'central'\) \{\s*const central = await centralMailboxFor\(admin, caller\.id\)/.test(src))
  ok('...and files the Sent copy under the mailbox it went from', /user_id: senderId, folder: copy\.folder/.test(src))
  const status = readFileSync(new URL('../../api/_lib/email/status.ts', import.meta.url), 'utf8')
  ok('the status check names the central mailbox only to those who may use it', /req\.query\.mailbox === 'central'\) \{\s*const central = await centralMailboxFor\(admin, caller\.id\)/.test(status))
}

/* ------------------------------------------- the sheet reader ------------------------------------------- */
check('a run of text is drawn in the face it was set in', [
  P.fontKeyFor('"LOD Serif", Georgia, serif', '400'), P.fontKeyFor('"LOD Serif"', '600'), P.fontKeyFor('"LOD Serif"', '700'),
  P.fontKeyFor('"LOD Sans", Inter', '400'), P.fontKeyFor('"LOD Sans", Inter', '600'),
], ['NSR', 'NSSB', 'NSB', 'INR', 'INSB'])
check('colours are read, and transparent is nothing', [P.parseRgb('rgb(31, 46, 61)'), P.parseRgb('rgba(0, 0, 0, 0)'), P.parseRgb('rgba(1, 2, 3, 0.5)')], [[31, 46, 61], null, [1, 2, 3]])
{
  const src = readFileSync(new URL('../../src/lib/demandLetterPdf.ts', import.meta.url), 'utf8')
  ok('the sheet is read at its measured scale, so a shrunk preview cannot squeeze the words', /const k = sheet\.offsetWidth \? base\.width \/ sheet\.offsetWidth : 1/.test(src)
    && /const X = \(v: number\) => \(\(v - base\.left\) \/ k\) \* PT/.test(src))
  ok('...and the PDF is drawn without ligatures, as the sheet is set', /embedFont\(fonts\[k\], \{ features \}\)/.test(src) && /liga: false/.test(src))
  const css = readFileSync(new URL('../../src/pages/letters/letterOfDemand.css', import.meta.url), 'utf8')
  ok('...on the sheet too', /font-variant-ligatures: none/.test(css))
}

/* ------------------------------------------- the fonts can write Afrikaans ------------------------------------------- */
{
  /* A debtor called Dreyer-Coetzée or a client in Pretoria-Oos must print as typed: the faces carry Latin-1. */
  const cmap = (f) => {
    const b = readFileSync(new URL(`../../public/letters/demand/${f}`, import.meta.url))
    return b.length > 10000 && b.subarray(0, 4).toString('hex') === '00010000'
  }
  const fontkit = (await import('@pdf-lib/fontkit')).default
  const missing = ['NotoSerif-Regular.ttf', 'NotoSerif-Bold.ttf', 'Inter-Regular.ttf'].flatMap((f) => {
    const font = fontkit.create(readFileSync(new URL(`../../public/letters/demand/${f}`, import.meta.url)))
    return [...'êëéèôöïîûüáàÉÊËÔçñ–—“”‘’…'].filter((c) => !font.hasGlyphForCodePoint(c.codePointAt(0))).map((c) => `${f}:${c}`)
  })
  check('every face can write Afrikaans and the typographer\'s punctuation', missing, [])
  ok('the five faces and the letterhead are in place', ['NotoSerif-Regular.ttf', 'NotoSerif-SemiBold.ttf', 'NotoSerif-Bold.ttf', 'Inter-Regular.ttf', 'Inter-SemiBold.ttf'].every(cmap)
    && readFileSync(new URL('../../public/letters/demand/letterhead.jpg', import.meta.url)).subarray(0, 2).toString('hex') === 'ffd8')
}

console.log(`\ncheck-letter-demand: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
