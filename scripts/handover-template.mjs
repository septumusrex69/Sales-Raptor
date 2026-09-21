/**
 * Writes the handover sheet the firm sends to a client.
 *
 * WHY A SCRIPT AND NOT A FILE IN THE REPO. The columns will change -- the firm has already been
 * through one round of this -- and a spreadsheet checked in as a binary is a spreadsheet that
 * drifts from the importer reading it. The columns live in src/lib/handoverSheet.ts, which the
 * importer also reads, and this draws the .xlsx from them. Change the list, run this, send the
 * new sheet; the importer already knows about it.
 *
 * WHAT THE FILE DOES THAT THE OLD ONE DID NOT, and each one is a failure measured on the old
 * sheet's 45 rows rather than a preference:
 *
 *   - EVERY COLUMN OF DIGITS-THAT-ARE-NOT-A-QUANTITY IS FORMATTED AS TEXT. 40 of 42 "Cell Phone
 *     2" values in the old sheet had lost their leading zero, because Excel read 0129403445 as a
 *     number. Those numbers cannot be dialled. A text column is never converted.
 *   - DATES ARE A DATE FORMAT, dd/mm/yyyy, WHICH IS HOW SOUTH AFRICA WRITES THEM. This was
 *     yyyy-mm-dd first, to dodge "02/09/2024" meaning two different days -- but that was solving
 *     the wrong problem in the wrong place. A date-formatted cell stores a SERIAL NUMBER; the
 *     format is only what the person sees. So the ambiguity never reaches the importer either
 *     way, and showing a South African bookkeeper an ISO date buys nothing and reads as foreign.
 *     What a client types day-first into a date column on a South African machine is parsed
 *     day-first by Excel, and arrives here as a number that means one day.
 *   - THE REQUIRED COLUMNS ARE COLOURED AND MARKED, so "the surname is missing" is visible while
 *     the file is being filled in rather than after 45 letters have gone out unaddressed.
 *   - A SECOND SHEET SAYS WHAT EACH COLUMN IS FOR in the firm's words, with one worked example.
 *     The example is on the notes sheet, NOT as a row in the data, because an example row left in
 *     by accident is a fictional debtor in the book.
 *
 * IT ALSO FILLS THE SHEET IN, which is what converts a client off their old one.
 *
 * THE FIRM: "some clients could possibly take it some time to change the import sheet." A client
 * who has been sent the blank sheet still has a book in the old shape, and the one thing that
 * actually moves them across is being handed their own accounts back in the new columns. So the
 * rows can be supplied, and they are written through the same column list and the same cell
 * formats as the blank file -- there is no second writer to drift from this one.
 *
 * A CONVERSION SHIPS WITH ITS OWN ACCOUNT OF ITSELF. Reading an old sheet is never a pure rename:
 * a column lands somewhere different, a leading zero is put back, a value is left out because it
 * was not what its heading claimed. `notes` writes those onto a third sheet inside the workbook,
 * beside the data they describe, because a conversion explained in an email is a conversion
 * nobody can check a year later.
 *
 * Run: node scripts/handover-template.mjs [output.xlsx] [--rows rows.json]
 *
 * rows.json is { "rows": [ { <column key>: value } ], "notes": [ [heading, text] ] }. A date is
 * an ISO day, money is a number, everything else is a string; an absent key is an empty cell.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateRawSync, crc32 } from 'node:zlib'
import { HANDOVER_COLUMNS, HANDOVER_GROUPS } from '../src/lib/handoverSheet.ts'

/* ---------------------------------------------------------------- a zip, by hand */

/*
 * An .xlsx is a zip of XML and nothing here needs a zip library to say so. Deflate from zlib,
 * CRC-32 from zlib (node 20.15+), and the two headers written out -- about forty lines against a
 * dependency that would have to be kept current for the life of the project.
 */
function zip(files) {
  const chunks = []
  const central = []
  let offset = 0
  for (const [name, text] of files) {
    const data = Buffer.from(text, 'utf8')
    const body = deflateRawSync(data)
    const crc = crc32(data)
    const nameBuf = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)       // version needed
    local.writeUInt16LE(0, 6)        // flags
    local.writeUInt16LE(8, 8)        // deflate
    local.writeUInt32LE(0, 10)       // time + date, fixed so the file is reproducible
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    chunks.push(local, nameBuf, body)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(8, 10)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(body.length, 20)
    dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(nameBuf.length, 28)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, nameBuf)
    offset += local.length + nameBuf.length + body.length
  }
  const dirBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(dirBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, dirBuf, end])
}

/* ---------------------------------------------------------------- sheet plumbing */

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/** 0 -> A, 25 -> Z, 26 -> AA. */
function colName(i) {
  let n = i + 1
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/*
 * STYLES, in the order the cells below reference them.
 *
 * 0 plain · 1 group heading · 2 required heading · 3 optional heading · 4 text body ·
 * 5 date body · 6 money body · 7 notes heading · 8 wrapped note
 *
 * The body styles matter more than the headings do: style 4 is format 49, "@", which is Excel's
 * text format, and it is the whole reason a cell number keeps its leading zero.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="12"/><color rgb="FF1B2A4A"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF1B2A4A"/><name val="Calibri"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1B2A4A"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8D9A8"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1F3F7"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

/** The style a column's DATA cells carry, which is what stops Excel reformatting what is typed. */
const bodyStyle = (kind) => (kind === 'date' ? 5 : kind === 'money' || kind === 'number' ? 6 : 4)

function inlineCell(ref, style, text) {
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`
}

/*
 * A DATE CELL HOLDS A NUMBER, not the letters "17/09/2026". Excel's epoch is 1899-12-30 -- two
 * days behind the obvious one, because Lotus 1-2-3 believed in a 29 February 1900 and every
 * spreadsheet since has agreed to keep believing it. Written as text instead, the cell would
 * carry the same dd/mm/yyyy ambiguity into the importer that the date format exists to remove.
 */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)
function excelSerial(iso) {
  const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(t)) return null
  return Math.round((t - EXCEL_EPOCH) / 86400000)
}

/** One filled cell, in the format its column is declared as. */
function valueCell(ref, column, value) {
  const style = bodyStyle(column.kind)
  if (value === null || value === undefined || value === '') return `<c r="${ref}" s="${style}"/>`
  if (column.kind === 'date') {
    const serial = excelSerial(value)
    return serial === null
      /* An unparseable date is written as what it says rather than dropped: the importer reports
         it, and a person can see what was in the old file. Silently emptying a cell is the one
         outcome nobody can investigate. */
      ? inlineCell(ref, 4, value)
      : `<c r="${ref}" s="${style}"><v>${serial}</v></c>`
  }
  if (column.kind === 'money' || column.kind === 'number') {
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''))
    return Number.isFinite(n) ? `<c r="${ref}" s="${style}"><v>${n}</v></c>` : inlineCell(ref, 4, value)
  }
  /* Everything else inline, never as a number -- this is the whole point of the text format, and
     a phone written as <v>129403445</v> would be exactly the bug the sheet was rewritten over. */
  return inlineCell(ref, style, value)
}

/* ---------------------------------------------------------------- what to fill it with */

const args = process.argv.slice(2)
const rowsFlag = args.indexOf('--rows')
const supplied = rowsFlag === -1 ? { rows: [], notes: [] }
  : JSON.parse(readFileSync(args[rowsFlag + 1], 'utf8'))
const DATA = supplied.rows ?? []
const NOTES = supplied.notes ?? []
/* A key that matches no column would be written nowhere and noticed by nobody. */
{
  const known = new Set(HANDOVER_COLUMNS.map((c) => c.key))
  const stray = [...new Set(DATA.flatMap((r) => Object.keys(r)))].filter((k) => !known.has(k))
  if (stray.length) {
    console.error(`No such column: ${stray.join(', ')}`)
    process.exit(1)
  }
}

/* ---------------------------------------------------------------- sheet 1: the accounts */

const N = HANDOVER_COLUMNS.length
const LAST = colName(N - 1)
/* Enough rows carrying the column formats that a client pasting a thousand lines in still gets
   text columns. Beyond this Excel applies the column format, which is also set below. */
const FORMATTED_ROWS = 500

const headerRow = `<row r="1" ht="30" customHeight="1">${HANDOVER_COLUMNS.map((c, i) =>
  inlineCell(`${colName(i)}1`, c.required ? 2 : 3, c.required ? `${c.label} *` : c.label)).join('')}</row>`

/*
 * EMPTY ROWS THAT NONETHELESS CARRY A FORMAT. A column format alone is not enough in every
 * version of Excel once a cell has been typed into, so the first few hundred rows are written out
 * with the style and no value. It costs a few kilobytes and it is what keeps 082... as 082...
 */
const dataRows = DATA.map((row, r) =>
  `<row r="${r + 2}">${HANDOVER_COLUMNS.map((c, i) =>
    valueCell(`${colName(i)}${r + 2}`, c, row[c.key])).join('')}</row>`).join('')

/* The formatted-but-empty rows carry on BELOW whatever was filled in, so a converted file is
   still a file the client adds to -- the next account they type keeps its leading zero too. */
const blankRows = Array.from({ length: FORMATTED_ROWS }, (_, r) => r + 2 + DATA.length).map((n) =>
  `<row r="${n}">${HANDOVER_COLUMNS.map((c, i) =>
    `<c r="${colName(i)}${n}" s="${bodyStyle(c.kind)}"/>`).join('')}</row>`).join('')

const cols = HANDOVER_COLUMNS.map((c, i) => {
  const width = Math.min(38, Math.max(13, c.label.length + 4))
  return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1" style="${bodyStyle(c.kind)}"/>`
}).join('')

/*
 * A DROPDOWN WHERE THE ANSWER IS A CLOSED LIST. "Person or business" typed freehand comes back as
 * Individual, indiv, P, natural person and a blank -- and the difference decides whether a letter
 * says "Dear Mr" at all.
 */
const validations = HANDOVER_COLUMNS
  .map((c, i) => [c, i])
  .filter(([c]) => c.kind === 'choice')
  .map(([c, i]) => `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"`
    + ` sqref="${colName(i)}2:${colName(i)}${FORMATTED_ROWS + DATA.length + 1}">`
    + `<formula1>"${c.choices.join(',')}"</formula1></dataValidation>`).join('')

const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><tabColor rgb="FF1B2A4A"/></sheetPr>
<dimension ref="A1:${LAST}${FORMATTED_ROWS + DATA.length + 1}"/>
<sheetViews><sheetView tabSelected="1" workbookViewId="0">
<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>
</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${headerRow}${dataRows}${blankRows}</sheetData>
${validations ? `<dataValidations count="${(validations.match(/<dataValidation /g) || []).length}">${validations}</dataValidations>` : ''}
</worksheet>`

/* ---------------------------------------------------------------- sheet 2: what to put in */

const EXAMPLE = [
  ['Your reference', 'GPS3/10103'],
  ['Capital outstanding', '48250.00'],
  ['Date of default', '18/03/2026'],
  ['Interest rate (% a year)', '24'],
  ['Person or business', 'Person'],
  ['Surname, or the business name', 'Van Der Westhuizen'],
  ['First name', 'Johannes'],
  ['ID number', '8503125009087'],
  ['Cell number 1', '082 123 4567'],
  ['Street address 1', '14 Protea Street'],
]

let r = 0
const rows2 = []
const put = (cells, height) => {
  r += 1
  rows2.push(`<row r="${r}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells}</row>`)
}

put(inlineCell('A1', 1, 'How to fill in this sheet'))
put(inlineCell('A2', 8, 'One row per account. A column marked * must be filled in — the rest help and are not refused.'), 20)
put('')
for (const group of HANDOVER_GROUPS) {
  put(inlineCell(`A${r + 1}`, 7, group) + inlineCell(`B${r + 1}`, 7, '') + inlineCell(`C${r + 1}`, 7, ''))
  for (const c of HANDOVER_COLUMNS.filter((x) => x.group === group)) {
    put(inlineCell(`A${r + 1}`, 4, c.label)
      + inlineCell(`B${r + 1}`, 4, c.required ? 'Must be filled in' : '')
      + inlineCell(`C${r + 1}`, 8, c.choices ? `${c.note} One of: ${c.choices.join(', ')}.` : c.note), 30)
  }
  put('')
}
put(inlineCell(`A${r + 1}`, 1, 'One row, filled in'))
put(inlineCell(`A${r + 1}`, 8, 'Copy the shape of this, not the values.'))
for (const [label, value] of EXAMPLE) {
  put(inlineCell(`A${r + 1}`, 4, label) + inlineCell(`B${r + 1}`, 4, value))
}

const sheet2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:C${r}"/>
<sheetViews><sheetView workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols><col min="1" max="1" width="34" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="3" width="86" customWidth="1"/></cols>
<sheetData>${rows2.join('')}</sheetData>
</worksheet>`

/* ---------------------------------------------------------------- sheet 3: what was changed */

/*
 * ONLY WHEN THERE IS SOMETHING TO SAY. A blank sheet has no conversion behind it, and a tab
 * headed "What we changed" on a file nobody converted invites somebody to go looking for the
 * change. CLAUDE.md: a warning that fires when nothing is wrong is worse than no warning.
 */
let r3 = 0
const rows3 = []
const put3 = (cells, height) => {
  r3 += 1
  rows3.push(`<row r="${r3}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells}</row>`)
}
if (NOTES.length) {
  put3(inlineCell('A1', 1, 'What we changed reading your old sheet'))
  put3(inlineCell('A2', 8, 'Every difference between the file you sent and this one. Nothing here '
    + 'was corrected on your behalf \u2014 where a value looked wrong it was left as it was and '
    + 'written down.'), 30)
  put3('')
  for (const [heading, text] of NOTES) {
    put3(inlineCell(`A${r3 + 1}`, 7, heading) + inlineCell(`B${r3 + 1}`, 7, ''))
    put3(inlineCell(`A${r3 + 1}`, 8, '') + inlineCell(`B${r3 + 1}`, 8, text), 46)
  }
}

const sheet3 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:B${Math.max(r3, 1)}"/>
<sheetViews><sheetView workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols><col min="1" max="1" width="40" customWidth="1"/><col min="2" max="2" width="104" customWidth="1"/></cols>
<sheetData>${rows3.join('')}</sheetData>
</worksheet>`

/* ---------------------------------------------------------------- the workbook */

const out = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--rows')
  ?? 'Bredell Ferreira - handover sheet.xlsx'
writeFileSync(out, zip([
  ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${NOTES.length ? `
<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` : ''}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`],
  ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`],
  ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
<sheet name="Accounts" sheetId="1" r:id="rId1"/>
<sheet name="How to fill it in" sheetId="2" r:id="rId2"/>${NOTES.length ? `
<sheet name="What we changed" sheetId="3" r:id="rId4"/>` : ''}
</sheets>
</workbook>`],
  ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${NOTES.length ? `
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>` : ''}
</Relationships>`],
  ['xl/styles.xml', STYLES],
  ['xl/worksheets/sheet1.xml', sheet1],
  ['xl/worksheets/sheet2.xml', sheet2],
  ...(NOTES.length ? [['xl/worksheets/sheet3.xml', sheet3]] : []),
]))

const required = HANDOVER_COLUMNS.filter((c) => c.required).length
console.log(`${out}`)
console.log(`${N} columns, ${required} of them required, across ${HANDOVER_GROUPS.length} groups.`)
console.log(`${HANDOVER_COLUMNS.filter((c) => c.kind === 'text').length} formatted as text, so no leading zero is eaten.`)
if (DATA.length) console.log(`${DATA.length} accounts filled in, and ${FORMATTED_ROWS} formatted rows below them.`)
if (NOTES.length) console.log(`${NOTES.length} notes on "What we changed".`)
