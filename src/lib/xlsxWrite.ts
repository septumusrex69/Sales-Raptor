/**
 * Just enough .xlsx to WRITE a flat sheet, in a browser.
 *
 * THE OTHER HALF OF xlsx.ts, and it exists because a rejected row has to go back to the client in
 * the file they sent it in. THE FIRM: "those ones that were rejected, they should be attached in
 * the email sent to the client liaison. Only the rejected ones." A client who is emailed a list
 * of what is wrong has to retype it; a client who is sent their own sheet back, with only the
 * rows that could not be opened, corrects it and sends it on.
 *
 * NO LIBRARY, for the same reason zip.ts has none: an .xlsx is a zip of XML and this is forty
 * lines of header-writing against a dependency that would have to be kept current for the life
 * of the project. scripts/handover-template.mjs used to write its own zip with `Buffer` and
 * `zlib`; it now goes through zipDeflated here (via handoverTemplate.ts), so the sheet a client is
 * emailed and the sheet the script writes are one writer rather than two that look alike.
 *
 * STORED, NOT DEFLATED. The browser can deflate, through CompressionStream, but only
 * asynchronously and in a stream — which would make every caller async to save a few kilobytes
 * on a file that is a handful of rows. Method 0 is in the spec, every reader accepts it, and
 * zip.ts on the way back in already names it. (The handover TEMPLATE is the exception, and
 * zipDeflated below says why: it is hundreds of formatted rows, and it rides on an email.)
 *
 * EVERY CELL IS AN INLINE STRING, including the numbers. That is deliberate and it is the same
 * decision the generated template makes: a cell Excel reads as a number is a cell Excel may
 * reformat, and 40 of 42 "Cell Phone 2" values on the client's own sheet had already lost their
 * leading zero that way. A client correcting a sheet and sending it back must not have their
 * corrections eaten by the spreadsheet on the way.
 */
import { saveFile } from './fileSave.ts'

const enc = new TextEncoder()

const esc = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 0 -> A, 25 -> Z, 26 -> AA. Base-26 with no zero, which is why this is not a division. */
export function columnName(i: number): string {
  let n = i + 1
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - r) / 26)
  }
  return out
}

/* CRC-32, table-free. Written out because the browser has no crc32 and pulling one in for a
   four-line loop would be the dependency this file exists to avoid. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    c ^= bytes[i]
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (c ^ 0xffffffff) >>> 0
}

interface Entry {
  name: string
  /** The file as it reads, which is what the CRC and the uncompressed size are taken over. */
  bytes: Uint8Array
  /** The same bytes deflated, when they were; absent means stored (method 0). */
  deflated?: Uint8Array
}

function zip(files: Entry[]): Uint8Array {
  const local: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const nameBytes = enc.encode(f.name)
    const crc = crc32(f.bytes)
    const body = f.deflated ?? f.bytes
    const method = f.deflated ? 8 : 0

    const head = new DataView(new ArrayBuffer(30))
    head.setUint32(0, 0x04034b50, true)
    head.setUint16(4, 20, true)   // version needed
    head.setUint16(6, 0, true)    // flags
    head.setUint16(8, method, true) // 0 = stored, 8 = deflate. See the note at the top.
    head.setUint32(10, 0, true)   // time + date, fixed so the same rows make the same file
    head.setUint32(14, crc, true)
    head.setUint32(18, body.length, true)
    head.setUint32(22, f.bytes.length, true)
    head.setUint16(26, nameBytes.length, true)
    local.push(new Uint8Array(head.buffer), nameBytes, body)

    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true)
    dir.setUint16(4, 20, true)
    dir.setUint16(6, 20, true)
    dir.setUint16(10, method, true)
    dir.setUint32(16, crc, true)
    dir.setUint32(20, body.length, true)
    dir.setUint32(24, f.bytes.length, true)
    dir.setUint16(28, nameBytes.length, true)
    dir.setUint32(42, offset, true)
    central.push(new Uint8Array(dir.buffer), nameBytes)

    offset += 30 + nameBytes.length + body.length
  }

  const dirBytes = central.reduce((n, c) => n + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, dirBytes, true)
  end.setUint32(16, offset, true)

  const parts = [...local, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/**
 * A whole workbook, from its parts as text, DEFLATED where the platform can.
 *
 * WHY THIS AND NOT buildXlsx. The handover sheet the firm sends a client is not a handful of rows:
 * it is five hundred empty rows that each CARRY a cell format, because a column format alone does
 * not stop every Excel eating a leading zero once a cell is typed into. That is about 400 kB of XML
 * stored, and it goes out attached to a mandate and a welcome letter -- deflated it is a few dozen
 * kilobytes. So this one is async and pays for it, and buildXlsx (a few rejected rows) stays sync.
 *
 * CompressionStream('deflate-raw') is in every browser the firm uses (Safari 16.4+) and in Node 18+,
 * which is what lets scripts/handover-template.mjs and the browser write THE SAME BYTES through one
 * function. Where it is missing the parts are stored instead -- a larger file, never a broken one.
 */
export async function zipDeflated(parts: { name: string; text: string }[]): Promise<Uint8Array> {
  const entries: Entry[] = []
  for (const p of parts) {
    const bytes = enc.encode(p.text)
    entries.push({ name: p.name, bytes, deflated: await deflateRaw(bytes) })
  }
  return zip(entries)
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  if (typeof CompressionStream === 'undefined') return undefined
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return undefined
  }
}

/**
 * One sheet of text, as .xlsx bytes.
 *
 * `rows[0]` is the header row like any other: this writes what it is given and decides nothing
 * about which row means what.
 */
/**
 * How a cell is drawn. Three, because three is what the sheet has to say.
 *
 * EXCEL'S OWN COLOURS, NOT OURS. 'bad' is the fill and text of Excel's built-in "Bad" style --
 * #FFC7CE on #9C0006 -- and 'head' is a plain grey. A client who lives in a spreadsheet already
 * reads light red as "this is the problem", and a colour we invented would have to be explained
 * in the covering email before it meant anything.
 *
 * DELIBERATELY NOT YELLOW for a problem. Excel's yellow is the "Neutral" style, which reads as
 * "have a look at this"; a cell on this sheet is not a suggestion, it is the reason an account
 * could not be opened.
 */
export type CellStyle = 'head' | 'bad'
/**
 * A cell is TEXT unless it says otherwise, and `{ n }` is how it says otherwise.
 *
 * The default exists for the rejected-rows sheet, where writing a number AS a number is the bug:
 * 40 of 42 "Cell Phone 2" values on the client's own sheet had already lost their leading zero to
 * Excel's reformatting, and a client correcting a sheet must not have the correction eaten on the
 * way back. So text it stays.
 *
 * THE REMITTANCE SCHEDULE WANTS THE OPPOSITE, and it is the same argument pointing the other way:
 * that sheet goes to a bookkeeper to sort and total, and a column of amounts Excel treats as text
 * cannot be summed without being converted first. Neither default is right for both jobs, so the
 * caller says which -- and the one that can quietly corrupt a client's data is the one that needs
 * no thought.
 */
export type Cell = string | null | undefined | { v: string; style?: CellStyle } | { n: number; style?: CellStyle }

const STYLE_INDEX: Record<CellStyle, number> = { head: 1, bad: 2 }

/**
 * The styles part.
 *
 * FILL 0 AND FILL 1 ARE FIXED BY THE FORMAT: Excel requires the first to be `none` and the
 * second `gray125`, and a workbook without them opens as corrupt. Everything real starts at 2.
 *
 * numFmtId STAYS 0 (General) ON EVERY STYLE, which matters more here than it looks. The reader in
 * xlsx.ts decides whether a cell is a DATE by looking up its style's number format -- so a style
 * carrying a date format would make a text cell come back as a date. Nothing here needs a format,
 * so nothing here has one.
 */
const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="3">'
  + '<font><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="11"/><name val="Calibri"/></font>'
  + '<font><color rgb="FF9C0006"/><sz val="11"/><name val="Calibri"/></font>'
  + '</fonts>'
  + '<fills count="4">'
  + '<fill><patternFill patternType="none"/></fill>'
  + '<fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill>'
  + '</fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="3">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
  + '<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>'

export function buildXlsx(sheetName: string, rows: Cell[][]): Uint8Array {
  const body = rows.map((row, r) => {
    const cells = row.map((cell, c) => {
      const isObject = typeof cell === 'object' && cell !== null
      const isNumber = isObject && 'n' in cell && Number.isFinite(cell.n)
      const text = isObject ? ('n' in cell ? String(cell.n) : cell.v) : (cell ?? '').toString()
      const style = isObject ? cell.style : undefined
      /*
       * AN EMPTY CELL IS STILL WRITTEN WHEN IT IS COLOURED, and that is the case that matters
       * here: a row refused for a MISSING value has nothing in the box, and the box is exactly
       * what the client has to fill in. Skipped as empty, the one cell they need to find would be
       * the only one on the sheet with no colour on it.
       */
      if (!text && !style) return ''
      const s = style ? ` s="${STYLE_INDEX[style]}"` : ''
      if (!text) return `<c r="${columnName(c)}${r + 1}"${s}/>`
      /* A NUMBER HAS NO `t`, which is what makes Excel treat it as one. No number FORMAT either:
         the reader in xlsx.ts decides a cell is a date by looking up its style's format, so a
         format here would make an amount come back as a date. General is right. */
      if (isNumber) return `<c r="${columnName(c)}${r + 1}"${s}><v>${text}</v></c>`
      /* `t="inlineStr"` rather than the shared-strings table: one fewer part in the zip, and
         nothing here repeats itself often enough for the table to pay for itself. */
      return `<c r="${columnName(c)}${r + 1}"${s} t="inlineStr"><is><t xml:space="preserve">`
        + `${esc(text)}</t></is></c>`
    }).join('')
    return `<row r="${r + 1}">${cells}</row>`
  }).join('')

  const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<sheetData>${body}</sheetData></worksheet>`

  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets><sheet name="${esc(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets>`
    + '</workbook>'

  const files: Entry[] = [
    {
      name: '[Content_Types].xml',
      bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + '</Types>'),
    },
    {
      name: '_rels/.rels',
      bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '</Relationships>'),
    },
    { name: 'xl/workbook.xml', bytes: enc.encode(workbook) },
    {
      name: 'xl/_rels/workbook.xml.rels',
      bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        + '</Relationships>'),
    },
    { name: 'xl/styles.xml', bytes: enc.encode(STYLES) },
    { name: 'xl/worksheets/sheet1.xml', bytes: enc.encode(sheet) },
  ]
  return zip(files)
}

/** The bytes as base64, which is how /api/email/send takes an attachment. */
export function toBase64(bytes: Uint8Array): string {
  let s = ''
  /* In chunks: String.fromCharCode(...bytes) on a whole file overflows the argument stack, and
     the failure is a RangeError at some size nobody tested at rather than at every size. */
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(s)
}

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Hand a file straight to the person, with no server in it.
 *
 * THE FIRM: "it should also be downloaded automatically for the user." The same shape as
 * downloadCsv next door: both hand the file to saveFile (fileSave.ts), which is an ordinary download
 * on a computer and the share sheet's "Save to Files" on an iPad.
 */
export function downloadBytes(filename: string, bytes: Uint8Array, contentType: string) {
  /* THROUGH saveFile, so an iPad gets "Save to Files" rather than the file drawn over Raptor
     (the firm, 19 Oct). See fileSave.ts. */
  void saveFile(new Blob([bytes as BlobPart], { type: contentType }), filename)
}
