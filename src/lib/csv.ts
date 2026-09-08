/**
 * A CSV reader that copes with what Swordfish actually exports.
 *
 * Written rather than installed because the requirement is small and exact: quoted fields
 * containing commas (client names all do), embedded newlines (action comments do), doubled
 * quotes as an escape, and a UTF-8 BOM on the first header. A dependency would bring more
 * behaviour than that, and this has to be auditable — the migration's numbers rest on it.
 */
export type CsvRow = Record<string, string>

export function parseCsv(text: string): CsvRow[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        quoted = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { quoted = true; i++; continue }
    if (ch === ',') { row.push(field); field = ''; i++; continue }
    if (ch === '\r') { i++; continue }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += ch; i++
  }
  // A file not ending in a newline still has a last row worth keeping.
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  if (rows.length === 0) return []
  const header = rows[0].map((h) => h.trim())
  return rows.slice(1)
    .filter((r) => r.length > 1 || (r[0] ?? '').trim() !== '')
    .map((r) => Object.fromEntries(header.map((h, n) => [h, r[n] ?? ''])))
}

/** Swordfish writes empty numerics as "", "N/A" and "-". All three mean "no figure", not zero. */
export function num(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  if (s === '' || s === 'N/A' || s === '-') return undefined
  const n = Number(s.replace(/[R\s,]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

/** Dates arrive as yyyy/mm/dd, sometimes with a time. Returns an ISO date or undefined. */
export function isoDate(v: unknown): string | undefined {
  const s = String(v ?? '').trim()
  if (!s) return undefined
  const m = /^(\d{4})[/-](\d{2})[/-](\d{2})/.exec(s)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined
}

/**
 * The same "no value" vocabulary for text. 571 accounts carry a Sub-status of literally "N/A";
 * storing that would put the string on screen wherever a sub-status is shown, and make
 * `sub_status is null` the wrong test forever.
 */
export function text(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s === '' || s === 'N/A' || s === '-' ? null : s
}
