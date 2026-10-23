/**
 * THE HANDOVER SHEET THE FIRM HANDS A CLIENT, as .xlsx bytes -- the new one and the old one.
 *
 * THE FIRM (Stephan, 23 Oct): "Give me a copy of the handover template for the importer of the
 * handovers. That should go out on the welcome letter as well. And it should go out with the
 * mandate as well ... so that we can import clients directly from that ... Make it possible so
 * that we can download from where we say import handover ... export the new handover sheet or
 * export the old handover sheet."
 *
 * ONE WRITER, THREE CALLERS. The download on the import screen, the attachment on the mandate and
 * the welcome letter, and `scripts/handover-template.mjs` (which also fills a sheet in, to convert
 * a client off their old one) all come through `newHandoverSheet`. It used to live inside the
 * script, on `Buffer` and `zlib`, which the browser has neither of; a second copy for the browser
 * would have been a second sheet the importer reads differently the first time somebody changed
 * one and not the other. check-handover-template holds the script to this module by reading it.
 *
 * THE COLUMNS ARE NOT HERE. They live in handoverSheet.ts, which the importer reads too; this only
 * draws them. Change the list there and every copy that goes out after it is the new sheet.
 *
 * WHAT THE NEW SHEET DOES THAT THE OLD ONE DID NOT, and each one is a failure measured on the old
 * sheet's 45 rows rather than a preference:
 *
 *   - EVERY COLUMN OF DIGITS-THAT-ARE-NOT-A-QUANTITY IS FORMATTED AS TEXT. 40 of 42 "Cell Phone
 *     2" values in the old sheet had lost their leading zero, because Excel read 0129403445 as a
 *     number. Those numbers cannot be dialled. A text column is never converted.
 *   - DATES ARE A DATE FORMAT, dd/mm/yyyy, WHICH IS HOW SOUTH AFRICA WRITES THEM. A date-formatted
 *     cell stores a SERIAL NUMBER; the format is only what the person sees, so the dd/mm ambiguity
 *     never reaches the importer, and a South African bookkeeper is not shown an ISO date.
 *   - THE REQUIRED COLUMNS ARE COLOURED AND MARKED, so "the surname is missing" is visible while
 *     the file is being filled in rather than after 45 letters have gone out unaddressed.
 *   - A SECOND SHEET SAYS WHAT EACH COLUMN IS FOR in the firm's words, with one worked example.
 *     The example is on the notes sheet, NOT as a row in the data, because an example row left in
 *     by accident is a fictional debtor in the book.
 */
import { HANDOVER_COLUMNS, HANDOVER_GROUPS, type HandoverColumn, type ColumnKind } from './handoverSheet.ts'
import { columnName, toBase64, zipDeflated, XLSX_MIME } from './xlsxWrite.ts'

export { XLSX_MIME }

/* ---------------------------------------------------------------- the old sheet's headings */

/**
 * THE SWORDFISH-ERA SHEET, every heading, EXACTLY AS AND IN THE ORDER THEY APPEAR in the file the
 * firm sent (recorded in check-handover-sheet.mjs when the new sheet was designed from it, and
 * moved here so the file the firm downloads and the list the check holds are one list).
 *
 * HEADINGS ONLY. This repository is public, and the file it was read from held a client's real
 * debtors -- nothing but the 55 headings was ever written down, and nothing else may be.
 *
 * WHY HAND OUT THE OLD SHEET AT ALL, when the new one exists to replace it: "some clients could
 * possibly take it some time to change the import sheet". A client whose own system already
 * exports this shape is better served by an empty copy of it than by a new sheet they have to
 * re-key into -- and the importer reads it (aliasIndex), which check-handover-template holds.
 */
export const OLD_HANDOVER_HEADINGS: readonly string[] = [
  'Amount', 'Interruptor Before Handover Date', 'Date of Default', 'Capital on Default',
  'Interest Rate', 'Interest Date', 'Percentage', 'Swordfish Reference', 'Client Division',
  'Client Prefix', 'Client Reference', 'Debtor ID', 'Debtor Firstname', 'Debtor Second Name',
  'Debtor Surname', 'Debtor Initials', 'Debtor Title',
  'Home Phone 1', 'Home Phone 2', 'Home Phone 3', 'Home Phone 4',
  'Cell Phone 1', 'Cell Phone 2', 'Cell Phone 3', 'Cell Phone 4',
  'Work Phone 1', 'Work Phone 2', 'Work Phone 3', 'Work Phone 4',
  'Fax Number 1', 'Fax Number 2', 'Fax Number 3',
  'Email 1', 'Email 2', 'Email 3', 'Email 4',
  'Postal Address line 1', 'Postal Address line 2', 'Postal Address line 3',
  'Postal Address line 4', 'Postal code',
  'Street Address line 1', 'Street Address line 2', 'Street Address line 3',
  'Street Address line 4', 'Street postal code',
  'Occupation', 'Nationality', 'Passport number', 'Gender', 'Marital Status',
  'Number of Children', 'Next of Kin Number 1', 'Next of Kin Number 2', 'Next of Kin Number 3',
]

/**
 * How each old heading's cells are formatted, which is the one thing the old sheet is given that
 * the original did not have. The headings and their order are the client's; a leading zero eaten
 * by Excel is a fault, not a feature of the format, so the digit columns are text here too.
 * Everything not named is text: a name or an address loses nothing by being held as one.
 */
const OLD_KINDS: Record<string, ColumnKind> = {
  'Amount': 'money', 'Capital on Default': 'money',
  'Interruptor Before Handover Date': 'date', 'Date of Default': 'date', 'Interest Date': 'date',
  'Interest Rate': 'number', 'Percentage': 'number', 'Number of Children': 'number',
}

/* ---------------------------------------------------------------- filenames */

export type HandoverSheetFormat = 'new' | 'old'

/**
 * "Bredell Ferreira handover sheet.xlsx", or "(old format)". The firm's name off firm_settings
 * where the caller has it -- the file goes to a client, and is filed by them under whoever sent
 * it. Characters a filesystem refuses are dropped rather than the name.
 */
export function handoverSheetFilename(format: HandoverSheetFormat, firmName?: string | null): string {
  const firm = (firmName ?? '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Bredell Ferreira'
  return `${firm} handover sheet${format === 'old' ? ' (old format)' : ''}.xlsx`
}

/* ---------------------------------------------------------------- sheet plumbing */

const esc = (s: unknown) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/*
 * STYLES, in the order the cells below reference them.
 *
 * 0 plain · 1 group heading · 2 required heading · 3 optional heading · 4 text body ·
 * 5 date body · 6 money body · 7 notes heading · 8 wrapped note · 9 plain bold heading (the old
 * sheet's, which had no colours and is not given any)
 *
 * The body styles matter more than the headings do: style 4 is format 49, "@", which is Excel's
 * text format, and it is the whole reason a cell number keeps its leading zero.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>
<fonts count="5">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="12"/><color rgb="FF1B2A4A"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF1B2A4A"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
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
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

/** The style a column's DATA cells carry, which is what stops Excel reformatting what is typed. */
export const bodyStyle = (kind: ColumnKind): number =>
  (kind === 'date' ? 5 : kind === 'money' || kind === 'number' ? 6 : 4)

function inlineCell(ref: string, style: number, text: unknown): string {
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`
}

/*
 * A DATE CELL HOLDS A NUMBER, not the letters "17/09/2026". Excel's epoch is 1899-12-30 -- two
 * days behind the obvious one, because Lotus 1-2-3 believed in a 29 February 1900 and every
 * spreadsheet since has agreed to keep believing it. Written as text instead, the cell would
 * carry the same dd/mm/yyyy ambiguity into the importer that the date format exists to remove.
 */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)
function excelSerial(iso: unknown): number | null {
  const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(t)) return null
  return Math.round((t - EXCEL_EPOCH) / 86400000)
}

/** One filled cell, in the format its column is declared as. */
function valueCell(ref: string, column: HandoverColumn, value: unknown): string {
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
    /*
     * WORDS STAY WORDS. Stripping everything but digits turned "to be advised" into the empty
     * string, and Number('') is 0 -- which is finite, so the guard passed and the sheet was
     * written carrying an amount of nought that nobody had typed. A client who writes "to be
     * advised" in the amount column must have that read back to them, not silently valued at
     * zero: the importer has a refusal for each and they say different things.
     */
    const n = typeof value === 'number' ? value
      : (() => { const cleaned = String(value).replace(/[^0-9.-]/g, ''); return /\d/.test(cleaned) ? Number(cleaned) : NaN })()
    return Number.isFinite(n) ? `<c r="${ref}" s="${style}"><v>${n}</v></c>` : inlineCell(ref, 4, value)
  }
  /* Everything else inline, never as a number -- this is the whole point of the text format, and
     a phone written as <v>129403445</v> would be exactly the bug the sheet was rewritten over. */
  return inlineCell(ref, style, value)
}

/** Enough rows carrying the column formats that a client pasting a few hundred lines in still
 *  gets text columns. Beyond this Excel applies the column format, which is also set. */
export const FORMATTED_ROWS = 500

/*
 * EMPTY ROWS THAT NONETHELESS CARRY A FORMAT. A column format alone is not enough in every
 * version of Excel once a cell has been typed into, so the first few hundred rows are written out
 * with the style and no value. Deflated it costs a few kilobytes, and it is what keeps 082... as 082...
 */
function blankRows(kinds: ColumnKind[], from: number): string {
  let out = ''
  for (let n = from; n < from + FORMATTED_ROWS; n += 1) {
    out += `<row r="${n}">${kinds.map((k, i) => `<c r="${columnName(i)}${n}" s="${bodyStyle(k)}"/>`).join('')}</row>`
  }
  return out
}

function colsXml(labels: string[], kinds: ColumnKind[]): string {
  return labels.map((label, i) => {
    const width = Math.min(38, Math.max(13, label.length + 4))
    return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1" style="${bodyStyle(kinds[i])}"/>`
  }).join('')
}

/* ---------------------------------------------------------------- the parts of a workbook */

type Part = { name: string; text: string }

function packageParts(sheets: { name: string; xml: string }[]): Part[] {
  const overrides = sheets.map((_, i) => `
<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
  /* rId1..n are the sheets and styles comes after them, so adding a sheet never renumbers one. */
  const sheetEls = sheets.map((s, i) => `
<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
  const rels = sheets.map((_, i) => `
<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
  return [
    { name: '[Content_Types].xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>` },
    { name: '_rels/.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },
    { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheetEls}
</sheets>
</workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { name: 'xl/styles.xml', text: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: s.xml })),
  ]
}

/* ---------------------------------------------------------------- the new sheet */

/** What a filled-in sheet is filled with: rows by column key, and notes for "What we changed". */
export interface HandoverSheetFill {
  /** A date is an ISO day, money is a number, everything else a string; an absent key is empty. */
  rows?: Record<string, unknown>[]
  /** [heading, text] -- a conversion's account of itself. */
  notes?: [string, string][]
}

/** The worked example on the notes sheet. NOT a row in the data: see the top of the file. */
const EXAMPLE: [string, string][] = [
  ['Your reference', 'GPS3/10103'],
  ['Handover amount', '48250.00'],
  ['Date of default', '18/03/2026'],
  ['Person or business', 'Person'],
  ['Surname, or the business name', 'Van Der Westhuizen'],
  ['First name', 'Johannes'],
  ['ID number', '8503125009087'],
  ['Cell number 1', '082 123 4567'],
  ['Email address', 'johannes@example.co.za'],
  ['Street address 1', '14 Protea Street'],
]

/** The new sheet's parts, as XML text. Pure: the check reads these without unzipping anything. */
export function newHandoverSheetParts(fill: HandoverSheetFill = {}): Part[] {
  const DATA = fill.rows ?? []
  const NOTES = fill.notes ?? []
  /* A key that matches no column would be written nowhere and noticed by nobody. */
  const known = new Set(HANDOVER_COLUMNS.map((c) => c.key))
  const stray = [...new Set(DATA.flatMap((r) => Object.keys(r)))].filter((k) => !known.has(k))
  if (stray.length) throw new Error(`No such column: ${stray.join(', ')}`)

  const kinds = HANDOVER_COLUMNS.map((c) => c.kind)
  const last = FORMATTED_ROWS + DATA.length + 1

  /* ---- sheet 1: the accounts */
  const headerRow = `<row r="1" ht="30" customHeight="1">${HANDOVER_COLUMNS.map((c, i) =>
    inlineCell(`${columnName(i)}1`, c.required ? 2 : 3, c.required ? `${c.label} *` : c.label)).join('')}</row>`
  const dataRows = DATA.map((row, r) =>
    `<row r="${r + 2}">${HANDOVER_COLUMNS.map((c, i) =>
      valueCell(`${columnName(i)}${r + 2}`, c, row[c.key])).join('')}</row>`).join('')
  /*
   * A DROPDOWN WHERE THE ANSWER IS A CLOSED LIST. "Person or business" typed freehand comes back as
   * Individual, indiv, P, natural person and a blank -- and the difference decides whether a letter
   * says "Dear Mr" at all.
   */
  const validations = HANDOVER_COLUMNS
    .map((c, i) => [c, i] as const)
    .filter(([c]) => c.kind === 'choice')
    .map(([c, i]) => `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"`
      + ` sqref="${columnName(i)}2:${columnName(i)}${last}">`
      + `<formula1>"${esc((c.choices ?? []).join(','))}"</formula1></dataValidation>`)
  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><tabColor rgb="FF1B2A4A"/></sheetPr>
<dimension ref="A1:${columnName(HANDOVER_COLUMNS.length - 1)}${last}"/>
<sheetViews><sheetView tabSelected="1" workbookViewId="0">
<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>
</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${colsXml(HANDOVER_COLUMNS.map((c) => c.label), kinds)}</cols>
<sheetData>${headerRow}${dataRows}${blankRows(kinds, DATA.length + 2)}</sheetData>
${validations.length ? `<dataValidations count="${validations.length}">${validations.join('')}</dataValidations>` : ''}
</worksheet>`

  /* ---- sheet 2: what to put in */
  let r = 0
  const rows2: string[] = []
  const put = (cells: string, height?: number) => {
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

  const sheets = [{ name: 'Accounts', xml: sheet1 }, { name: 'How to fill it in', xml: sheet2 }]

  /*
   * ---- sheet 3: what was changed. ONLY WHEN THERE IS SOMETHING TO SAY. A blank sheet has no
   * conversion behind it, and a tab headed "What we changed" on a file nobody converted invites
   * somebody to go looking for the change. A warning that fires when nothing is wrong is worse
   * than no warning.
   */
  if (NOTES.length) {
    let r3 = 0
    const rows3: string[] = []
    const put3 = (cells: string, height?: number) => {
      r3 += 1
      rows3.push(`<row r="${r3}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells}</row>`)
    }
    put3(inlineCell('A1', 1, 'What we changed reading your old sheet'))
    put3(inlineCell('A2', 8, 'Every difference between the file you sent and this one. Nothing here '
      + 'was corrected on your behalf — where a value looked wrong it was left as it was and '
      + 'written down.'), 30)
    put3('')
    for (const [heading, text] of NOTES) {
      put3(inlineCell(`A${r3 + 1}`, 7, heading) + inlineCell(`B${r3 + 1}`, 7, ''))
      put3(inlineCell(`A${r3 + 1}`, 8, '') + inlineCell(`B${r3 + 1}`, 8, text), 46)
    }
    sheets.push({ name: 'What we changed', xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:B${Math.max(r3, 1)}"/>
<sheetViews><sheetView workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols><col min="1" max="1" width="40" customWidth="1"/><col min="2" max="2" width="104" customWidth="1"/></cols>
<sheetData>${rows3.join('')}</sheetData>
</worksheet>` })
  }

  return packageParts(sheets)
}

/** The new sheet as .xlsx bytes -- blank, or filled in to convert a client off their old one. */
export function newHandoverSheet(fill: HandoverSheetFill = {}): Promise<Uint8Array> {
  return zipDeflated(newHandoverSheetParts(fill))
}

/* ---------------------------------------------------------------- the old sheet */

/** The format the old sheet's column at this heading is given. Exported for the check. */
export const oldHeadingKind = (h: string): ColumnKind => OLD_KINDS[h] ?? 'text'

/**
 * The old sheet's parts: one sheet, its 55 headings in their order, bold and nothing else, and
 * the formatted rows under them. No notes sheet -- the old file had none, and a client asking
 * for it is asking for the shape their own system already writes.
 */
export function oldHandoverSheetParts(): Part[] {
  const kinds = OLD_HANDOVER_HEADINGS.map(oldHeadingKind)
  const header = `<row r="1">${OLD_HANDOVER_HEADINGS.map((h, i) => inlineCell(`${columnName(i)}1`, 9, h)).join('')}</row>`
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${columnName(OLD_HANDOVER_HEADINGS.length - 1)}${FORMATTED_ROWS + 1}"/>
<sheetViews><sheetView tabSelected="1" workbookViewId="0">
<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>
</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${colsXml([...OLD_HANDOVER_HEADINGS], kinds)}</cols>
<sheetData>${header}${blankRows(kinds, 2)}</sheetData>
</worksheet>`
  return packageParts([{ name: 'Handover', xml: sheet }])
}

/** The old sheet as .xlsx bytes. Headings only -- never a row. */
export function oldHandoverSheet(): Promise<Uint8Array> {
  return zipDeflated(oldHandoverSheetParts())
}

/** Either sheet, by format. */
export function handoverSheetBytes(format: HandoverSheetFormat): Promise<Uint8Array> {
  return format === 'old' ? oldHandoverSheet() : newHandoverSheet()
}

/* ---------------------------------------------------------------- as an email attachment */

/**
 * The NEW sheet, shaped the way /api/email/send and the welcome route take an attachment.
 *
 * THE FIRM: "That should go out on the welcome letter as well. And it should go out with the
 * mandate as well ... so that we can import clients directly from that." Always the new sheet: the
 * old one is offered on the import screen for a client who asks for it, never sent unasked.
 *
 * Built in the browser and sent as base64, because both emails already travel that way and api/
 * is at Vercel Hobby's twelve functions -- the server does not need a second copy of the writer.
 */
export async function handoverSheetAttachment(firmName?: string | null): Promise<{
  filename: string; contentType: string; size: number; content: string
}> {
  const bytes = await newHandoverSheet()
  return { filename: handoverSheetFilename('new', firmName), contentType: XLSX_MIME, size: bytes.length, content: toBase64(bytes) }
}
