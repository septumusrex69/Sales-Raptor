/**
 * Just enough .xlsx to read a flat sheet.
 *
 * The client register is a spreadsheet somebody maintains by hand, so it arrives as .xlsx and
 * always will. Telling people to save it as CSV works, but it is a step to forget and it hands
 * Excel's regional date formatting a chance to change the answer — a sign date written
 * "02/09/2024" reads as 9 February in one locale and 2 September in another, and nothing
 * downstream can tell which was meant. Reading the file directly removes both problems.
 *
 * An .xlsx is a zip of XML, so this is a thin layer over zip.ts plus the browser's own parser.
 *
 * What it does NOT do: formulas (it reads the cached result, which is what `data_only` means
 * elsewhere), multiple sheets (the first is the one), merged cells, or anything about styling
 * beyond working out which numbers are dates.
 */
import { readZipEntries, readZipEntry } from './zip'

/** Excel counts days from 1899-12-30 — the offset absorbs its deliberate 1900 leap-year bug. */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

/**
 * The built-in number formats that mean "date", per the OOXML spec. 14-17 and 22 are dates,
 * 18-21 are times, 45-47 are durations. Anything custom is decided by looking at the format
 * string itself.
 */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57])

function parse(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml')
}

/** "BC" -> 55. Column letters are base-26 with no zero. */
function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/**
 * Rows from the first sheet, as arrays of strings.
 *
 * Everything comes back as text because that is what the CSV path produces and the callers
 * downstream already know how to read: `num()` and `isoDate()` do the interpreting. Dates are
 * rendered yyyy/mm/dd, which is the shape Swordfish's own exports use.
 */
export async function readXlsxRows(buffer: ArrayBuffer): Promise<string[][]> {
  const entries = readZipEntries(buffer)
  const text = async (name: string) => {
    const entry = entries.find((e) => e.name === name)
    if (!entry) return ''
    return new TextDecoder('utf-8').decode(await readZipEntry(buffer, entry))
  }

  // Strings are pooled across the workbook and referenced by index; a cell marked t="s" holds
  // a pointer into this table rather than its own text.
  const sharedStrings: string[] = []
  const sharedXml = await text('xl/sharedStrings.xml')
  if (sharedXml) {
    for (const si of parse(sharedXml).getElementsByTagName('si')) {
      // A string with mixed formatting is split into <r> runs; joining every <t> puts it back.
      sharedStrings.push([...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join(''))
    }
  }

  // Which style indexes are dates. A date cell is just a number plus a format that displays it
  // as one, so without this the sign dates arrive as 45537 and mean nothing.
  const dateStyles = new Set<number>()
  const stylesXml = await text('xl/styles.xml')
  if (stylesXml) {
    const doc = parse(stylesXml)
    const custom = new Map<number, string>()
    for (const f of doc.getElementsByTagName('numFmt')) {
      custom.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? '')
    }
    const cellXfs = doc.getElementsByTagName('cellXfs')[0]
    if (cellXfs) {
      [...cellXfs.getElementsByTagName('xf')].forEach((xf, i) => {
        const id = Number(xf.getAttribute('numFmtId') ?? 0)
        const code = custom.get(id)
        // A custom format is a date if it mentions days, months or years outside a literal.
        const looksLikeDate = code !== undefined
          && /[dmyh]/i.test(code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, ''))
        if (BUILTIN_DATE_FORMATS.has(id) || looksLikeDate) dateStyles.add(i)
      })
    }
  }

  // The first sheet, found through the workbook's relationships rather than assumed to be
  // sheet1.xml — a workbook whose first sheet was deleted and re-added does not match.
  const workbook = parse(await text('xl/workbook.xml'))
  const firstSheetRelId = workbook.getElementsByTagName('sheet')[0]?.getAttribute('r:id')
  const rels = parse(await text('xl/_rels/workbook.xml.rels'))
  let target = [...rels.getElementsByTagName('Relationship')]
    .find((r) => r.getAttribute('Id') === firstSheetRelId)?.getAttribute('Target')
  if (!target) target = 'worksheets/sheet1.xml'
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`

  const sheetXml = await text(sheetPath)
  if (!sheetXml) throw new Error('That spreadsheet has no readable first sheet.')

  const rows: string[][] = []
  for (const row of parse(sheetXml).getElementsByTagName('row')) {
    const cells: string[] = []
    for (const c of row.getElementsByTagName('c')) {
      const index = columnIndex(c.getAttribute('r') ?? '')
      // Gaps are real: an empty cell is often not written at all, so position comes from the
      // reference and the holes are filled rather than the row silently shifting left.
      while (cells.length < index) cells.push('')
      cells.push(cellText(c, sharedStrings, dateStyles))
    }
    rows.push(cells)
  }
  // Excel keeps trailing empty rows where someone once clicked.
  while (rows.length && rows[rows.length - 1].every((v) => v === '')) rows.pop()
  return rows
}

function cellText(c: Element, sharedStrings: string[], dateStyles: Set<number>): string {
  const type = c.getAttribute('t')
  if (type === 'inlineStr') {
    return [...c.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('')
  }
  const raw = c.getElementsByTagName('v')[0]?.textContent ?? ''
  if (raw === '') return ''
  if (type === 's') return sharedStrings[Number(raw)] ?? ''
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE'
  if (type === 'e') return ''

  const style = Number(c.getAttribute('s') ?? -1)
  if (dateStyles.has(style)) {
    const serial = Number(raw)
    if (Number.isFinite(serial) && serial > 0) {
      const d = new Date(EXCEL_EPOCH + Math.round(serial) * 86400000)
      const pad = (n: number) => String(n).padStart(2, '0')
      return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`
    }
  }
  return raw
}

/** The first sheet as objects keyed by its header row, matching what parseCsv returns. */
export async function readXlsx(buffer: ArrayBuffer): Promise<Record<string, string>[]> {
  const rows = await readXlsxRows(buffer)
  if (rows.length === 0) return []
  const header = rows[0].map((h) => h.trim())
  return rows.slice(1)
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}
