import { saveFile } from './fileSave.ts'

function csvCell(value: unknown): string {
  const s = value === undefined || value === null ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const lines = [headers.join(','), ...rows.map((row) => headers.map((h) => csvCell(row[h])).join(','))]
  return lines.join('\n')
}

/** Client-side CSV download — no backend involved. */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const csv = toCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  /* THROUGH saveFile, so an iPad gets "Save to Files" rather than the sheet drawn over Raptor
     (the firm, 19 Oct). See fileSave.ts. */
  void saveFile(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`)
}
