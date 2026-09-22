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
 * of the project. scripts/handover-template.mjs already writes one this way in Node; what stops
 * that being shared is `Buffer` and `zlib` — neither exists here — so the shapes match and the
 * plumbing does not.
 *
 * STORED, NOT DEFLATED. The browser can deflate, through CompressionStream, but only
 * asynchronously and in a stream — which would make every caller async to save a few kilobytes
 * on a file that is a handful of rows. Method 0 is in the spec, every reader accepts it, and
 * zip.ts on the way back in already names it.
 *
 * EVERY CELL IS AN INLINE STRING, including the numbers. That is deliberate and it is the same
 * decision the generated template makes: a cell Excel reads as a number is a cell Excel may
 * reformat, and 40 of 42 "Cell Phone 2" values on the client's own sheet had already lost their
 * leading zero that way. A client correcting a sheet and sending it back must not have their
 * corrections eaten by the spreadsheet on the way.
 */

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

interface Entry { name: string; bytes: Uint8Array }

function zip(files: Entry[]): Uint8Array {
  const local: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const nameBytes = enc.encode(f.name)
    const crc = crc32(f.bytes)

    const head = new DataView(new ArrayBuffer(30))
    head.setUint32(0, 0x04034b50, true)
    head.setUint16(4, 20, true)   // version needed
    head.setUint16(6, 0, true)    // flags
    head.setUint16(8, 0, true)    // 0 = stored. See the note at the top.
    head.setUint32(10, 0, true)   // time + date, fixed so the same rows make the same file
    head.setUint32(14, crc, true)
    head.setUint32(18, f.bytes.length, true)
    head.setUint32(22, f.bytes.length, true)
    head.setUint16(26, nameBytes.length, true)
    local.push(new Uint8Array(head.buffer), nameBytes, f.bytes)

    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true)
    dir.setUint16(4, 20, true)
    dir.setUint16(6, 20, true)
    dir.setUint16(10, 0, true)
    dir.setUint32(16, crc, true)
    dir.setUint32(20, f.bytes.length, true)
    dir.setUint32(24, f.bytes.length, true)
    dir.setUint16(28, nameBytes.length, true)
    dir.setUint32(42, offset, true)
    central.push(new Uint8Array(dir.buffer), nameBytes)

    offset += 30 + nameBytes.length + f.bytes.length
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
 * One sheet of text, as .xlsx bytes.
 *
 * `rows[0]` is the header row like any other: this writes what it is given and decides nothing
 * about which row means what.
 */
export function buildXlsx(sheetName: string, rows: (string | null | undefined)[][]): Uint8Array {
  const body = rows.map((row, r) => {
    const cells = row.map((value, c) => {
      const text = (value ?? '').toString()
      if (!text) return ''
      /* `t="inlineStr"` rather than the shared-strings table: one fewer part in the zip, and
         nothing here repeats itself often enough for the table to pay for itself. */
      return `<c r="${columnName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">`
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
        + '</Relationships>'),
    },
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
 * downloadCsv next door -- a blob, an anchor, a click, and the URL revoked, because an object URL
 * left behind holds the bytes for the life of the tab.
 */
export function downloadBytes(filename: string, bytes: Uint8Array, contentType: string) {
  const blob = new Blob([bytes as BlobPart], { type: contentType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
