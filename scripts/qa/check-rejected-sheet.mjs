/**
 * The refused rows go back to the client as the sheet they sent.
 *
 * THE FIRM: "those ones that were rejected, they should be attached in the email sent to the
 * client liaison. Only the rejected ones. And it should also be downloaded automatically for the
 * user, should also be in the query ticket."
 *
 * A CLIENT SENT A LIST OF PROBLEMS HAS TO RETYPE THEIR FILE. The email's table says what is wrong
 * with row 7 and nothing about the other thirty-nine columns of row 7, so correcting it means
 * going back to the original spreadsheet and finding the row again.
 *
 * THE ONE ASSERTION THIS FILE EXISTS FOR IS THE ROUND TRIP. Bytes that open in Excel and bytes
 * the importer reads are not the same claim, and a writer nobody read back is a writer that
 * produces a file the client corrects and we then refuse. So the sheet is written, unzipped, and
 * parsed by the SAME reader the upload screen uses — and then planned by the same planner.
 */
import { readFileSync } from 'node:fs'
import { buildXlsx, columnName, toBase64 } from '../../src/lib/xlsxWrite.ts'
import { rejectedSheetName, rejectedSheetRows, WHAT_WE_NEED } from '../../src/lib/rejectedSheet.ts'
import { HANDOVER_COLUMNS } from '../../src/lib/handoverSheet.ts'
import { crc32 as zlibCrc32 } from 'node:zlib'
import { readZipEntries, readZipEntry } from '../../src/lib/zip.ts'

let pass = 0
const failures = []
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass += 1; return }
  failures.push(`${label}\n    expected ${e}\n    got      ${a}`)
}
const ok = (label, actual) => check(label, actual, true)

/* ---------- column letters ---------- */

check('the twenty-seventh column is AA', columnName(26), 'AA')
check('...and the twenty-sixth is Z', columnName(25), 'Z')
check('...and the first is A', columnName(0), 'A')
/* The sheet has forty columns, so AA is reached in anger rather than in theory. */
ok('the sheet is long enough to need two letters', HANDOVER_COLUMNS.length > 26)

/* ---------- what is in the sheet ---------- */

const REFUSED = [
  {
    values: {
      client_reference: 'BF-204', name: 'Molefe', first_name: 'Kagiso',
      capital: '640', default_date: '18/03/2026', debtor_kind: 'Person',
      email_1: 'kagiso.molefe.example.co.za', cell_1: '0828641711',
    },
    problems: [{ message: 'Email address is not an email address.' }],
  },
  {
    values: { client_reference: 'BF-301', name: 'Swanepoel', capital: '', default_date: '' },
    problems: [{ message: 'No handover amount.' }, { message: 'No date of default.' }],
  },
]

const rows = rejectedSheetRows(REFUSED)
check('a row per refusal, under one header', rows.length, REFUSED.length + 1)
/*
 * EVERY COLUMN OF THE SHEET, IN THE SHEET'S ORDER. A file carrying only the columns that were
 * wrong is not the sheet they sent -- it is a new form, and the import would refuse it for the
 * required columns it no longer has.
 */
check('the header is the sheet, plus one', rows[0].length, HANDOVER_COLUMNS.length + 1)
check('...in the sheet’s own order',
  rows[0].slice(0, HANDOVER_COLUMNS.length), HANDOVER_COLUMNS.map((c) => c.label))
check('...and the extra column is last', rows[0][rows[0].length - 1], WHAT_WE_NEED)
/* The values that were fine come too, or the client is retyping the row rather than fixing it. */
ok('a column with nothing wrong still carries its value', rows[1].includes('0828641711'))
ok('...and the one that was wrong carries what they typed',
  rows[1].includes('kagiso.molefe.example.co.za'))
/* EVERY problem, not the first: a row refused for two things fixed once comes straight back. */
ok('a row refused twice says both things',
  /No handover amount\./.test(rows[2][rows[2].length - 1])
  && /No date of default\./.test(rows[2][rows[2].length - 1]))

/* ---------- what it is called ---------- */

check('the file is named for their sheet', rejectedSheetName('handover 3 (refusals).xlsx'),
  'handover 3 (refusals) — to correct.xlsx')
/* Replaced, not appended: `.xlsx.xlsx` is a file Windows shows as `.xlsx` and Excel refuses. */
ok('...with one extension', (rejectedSheetName('a.xlsx').match(/\.xlsx/g) ?? []).length === 1)
check('...and a name even with none', rejectedSheetName(''), 'handover — to correct.xlsx')

/* ---------- the bytes are a zip a reader can open ---------- */

/*
 * UNZIPPED BY OUR OWN READER, cell values read straight out of the XML.
 *
 * NOT the whole round trip: readXlsxRows needs a DOMParser and this layer has no browser. The
 * true round trip -- the corrected file uploaded back into the import screen and read by the
 * importer -- is in e2e/upload-a-batch.mjs, because that is where the reader actually runs and a
 * writer nobody reads back produces a file the client corrects and we then refuse.
 */
const bytes = buildXlsx('To correct', rows)
ok('the file is a zip', bytes[0] === 0x50 && bytes[1] === 0x4b)
const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)
const entries = readZipEntries(ab)
const named = entries.map((e) => e.name)
for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
  'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml']) {
  ok(`the archive carries ${part}`, named.includes(part))
}
/* Stored, not deflated -- the browser can only deflate asynchronously and in a stream, which
   would make every caller async to save a few kilobytes on a file of a handful of rows. */
ok('...stored rather than deflated', entries.every((e) => e.method === 0))
/*
 * AND THE TWO HEADERS AGREE. A zip says its compression method twice -- once in the local header
 * and once in the central directory -- and readers pick one. zip.ts reads the central one, so a
 * local header claiming deflate over stored bytes read perfectly here and would have been
 * Excel's problem on the client's machine.
 */
const localMethod = (offset) => new DataView(ab).getUint16(offset + 8, true)
for (const e of entries) {
  check(`${e.name} says the same method in both headers`, localMethod(e.offset), e.method)
}

/*
 * THE CHECKSUMS, AGAINST SOMEBODY ELSE'S CRC-32.
 *
 * Neither reader here verifies one: zip.ts does not, and the browser's does not either -- so a
 * wrong CRC passes every other assertion in this file and in the browser, and fails in Excel, on
 * the client's machine, a day later. Compared against node's zlib.crc32, which is an independent
 * implementation of the same thing rather than ours checking itself.
 */
/* Read straight out of the local header, because ZipEntry does not carry it -- reading it back
   through our own writer's variable would be the writer checking itself. */
const localCrc = (offset) => new DataView(ab).getUint32(offset + 14, true) >>> 0
for (const e of entries) {
  const raw = await readZipEntry(ab, e)
  check(`${e.name} carries a correct checksum`, localCrc(e.offset), zlibCrc32(raw) >>> 0)
}

const sheetXml = new TextDecoder().decode(
  await readZipEntry(ab, entries.find((e) => e.name === 'xl/worksheets/sheet1.xml')))
check('every row is in the sheet', (sheetXml.match(/<row /g) ?? []).length, rows.length)
ok('...with the headings', sheetXml.includes('Your reference'))
ok('...and the values', sheetXml.includes('kagiso.molefe.example.co.za'))
/* A leading zero survives, which is the whole reason every cell is written as text. */
ok('...including a number that must keep its leading zero', sheetXml.includes('0828641711'))
ok('...and what we need said on the row', sheetXml.includes('No handover amount.'))
/* A client's own text may carry an ampersand or a bracket; unescaped, the file will not open. */
const hostile = buildXlsx('x', [['A & B <C>'], ['"quoted"']])
const hostileXml = new TextDecoder().decode(await (async () => {
  const hab = hostile.buffer.slice(hostile.byteOffset, hostile.byteOffset + hostile.length)
  const es = readZipEntries(hab)
  return readZipEntry(hab, es.find((e) => e.name === 'xl/worksheets/sheet1.xml'))
})())
ok('a value with an ampersand is escaped', hostileXml.includes('A &amp; B &lt;C&gt;'))
ok('...and the file still parses as XML',
  /^<\?xml/.test(hostileXml) && hostileXml.trim().endsWith('</worksheet>'))

/* ---------- base64, for the email ---------- */

const b64 = toBase64(bytes)
ok('the attachment is base64', /^[A-Za-z0-9+/]+={0,2}$/.test(b64))
check('...of the same bytes', Buffer.from(b64, 'base64').length, bytes.length)
/*
 * CHUNKED. String.fromCharCode(...bytes) on a whole file overflows the argument stack, and the
 * failure is a RangeError at some size nobody tested at rather than at every size -- so this is
 * run over something bigger than one chunk.
 */
const big = toBase64(new Uint8Array(70000).fill(65))
check('a file past one chunk still encodes', Buffer.from(big, 'base64').length, 70000)

const writer = readFileSync('src/lib/xlsxWrite.ts', 'utf8')
ok('...because it is chunked rather than spread in one call', /i \+= 8192/.test(writer))
/*
 * EVERY CELL IS AN INLINE STRING, numbers included. A cell Excel reads as a number is a cell
 * Excel may reformat, and 40 of 42 "Cell Phone 2" values on the client's own sheet had already
 * lost their leading zero that way. A client correcting a sheet must not have the correction
 * eaten by the spreadsheet on the way back.
 */
ok('cells are written as text', /t="inlineStr"/.test(writer))
ok('...and a leading zero survives being written',
  sheetXml.includes('>0828641711<'))

if (failures.length > 0) {
  console.log(`${pass} passed, ${failures.length} failed\n`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The rows that could not be opened go back to the client as their own sheet, every column in its
own place, with one extra saying what we need. Written and unzipped here; read back by the
importer itself in e2e/upload-a-batch, because a writer nobody reads back produces a file the
client corrects and we then refuse.`)
