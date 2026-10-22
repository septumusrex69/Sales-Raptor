import { useEffect, useState } from 'react'
import { FileUp, Upload } from 'lucide-react'
import { Card, CardHeader } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { parseCsv } from '../../lib/csv'
import { readXlsxRows } from '../../lib/xlsx'
import { PROSPECT_OUTCOMES, readProspectSheet, type ProspectOutcome, type ProspectRow } from '../../lib/prospectImport.ts'
import { importList, listLists, previewImport, type ImportPreview, type MarketingList } from '../../lib/marketingApi'

/**
 * IMPORT A PROSPECT LIST (S10, 22 Oct). The firm: "send out to prospective clients or new email lists
 * that we've had."
 *
 * Two presses, as every import in Raptor has: reading the file and counting what it would do is free
 * and repeatable, and writing is separate and deliberate. The counts are the SERVER's, from the same
 * plan it writes with (marketingLists.ts). The file never leaves the browser except as the rows in
 * it, and is never stored.
 *
 * WHAT HAPPENS NEXT IS SAID HERE, because it is the part people get wrong: the new leads can be sent
 * ONE introduction, and nothing more unless they press "Yes, keep me informed".
 */
const OUTCOME_WORDS: Record<ProspectOutcome, string> = {
  new: 'new',
  'already a lead': 'already a lead (earlier imports included)',
  'already a client': 'already a client — not a prospect',
  'bad email': 'address does not look right',
  'duplicate in file': 'in the file twice',
}

export function ImportListCard() {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [rows, setRows] = useState<ProspectRow[] | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [lists, setLists] = useState<MarketingList[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => { if (open) listLists().then(setLists).catch(() => setLists([])) }, [open])

  async function read(f: File) {
    setFile(f); setRows(null); setPreview(null); setError(null); setDone(null)
    if (!name) setName(f.name.replace(/\.(csv|xlsx|xlsm)$/i, ''))
    setBusy('read')
    try {
      const lower = f.name.toLowerCase()
      let table: string[][]
      if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
        table = await readXlsxRows(await f.arrayBuffer())
      } else if (lower.endsWith('.xls')) {
        throw new Error(`${f.name} is in the old Excel format. Open it and save it as .xlsx.`)
      } else {
        const parsed = parseCsv(await f.text())
        const header = Object.keys(parsed[0] ?? {})
        table = [header, ...parsed.map((r) => header.map((h) => r[h] ?? ''))]
      }
      const sheet = readProspectSheet(table)
      if (sheet.problem) throw new Error(sheet.problem)
      setRows(sheet.rows)
      setPreview(await previewImport(sheet.rows))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function write() {
    if (!rows || !preview) return
    setBusy('write'); setError(null)
    try {
      const out = await importList(rows, name, file?.name ?? null)
      setDone(`${out.written} new ${out.written === 1 ? 'lead' : 'leads'} added from “${name.trim()}”. They can now be sent one introduction.`)
      setRows(null); setPreview(null); setFile(null)
      setLists(await listLists())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (!open) {
    return (
      <div>
        <Button icon={<Upload size={15} />} onClick={() => setOpen(true)} data-testid="news-import-open">Import a prospect list</Button>
      </div>
    )
  }
  return (
    <Card>
      <div data-testid="news-import">
        <CardHeader title="Import a prospect list"
          subtitle="A spreadsheet (.csv or .xlsx) with a heading row: an Email column, and name, company and phone if you have them. Any other columns are kept as a note on the lead. Every new address becomes a lead, from the source “Imported list”." />
        <div className="flex flex-wrap items-end gap-3">
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 cursor-pointer hover:bg-slate-50">
            <FileUp size={15} /> {file ? file.name : 'Choose a file'}
            <input type="file" accept=".csv,.xlsx,.xlsm" className="sr-only" data-testid="news-import-file"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f) }} />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-500 mb-1">List name (campaigns find it by this)</span>
            <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm w-72" value={name} onChange={(e) => setName(e.target.value)} data-testid="news-import-name" />
          </label>
        </div>
        {busy === 'read' && <p className="mt-3 text-sm text-slate-500">Reading and checking against Raptor…</p>}
        {preview && (
          <div className="mt-4 space-y-2" data-testid="news-import-preview">
            <ul className="text-sm text-slate-700 space-y-0.5">
              {PROSPECT_OUTCOMES.map((o) => (
                <li key={o} data-testid={`news-import-${o.replace(/ /g, '-')}`}>
                  <b className="tabular-nums">{preview.counts[o]}</b> {OUTCOME_WORDS[o]}
                  {o !== 'new' && preview.examples[o].length > 0 && <span className="text-xs text-slate-400"> — {preview.examples[o].join(', ')}</span>}
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">
              Only the {preview.counts.new} new {preview.counts.new === 1 ? 'address is' : 'addresses are'} added. Each can be sent ONE introduction email with a “Yes, keep me informed” button; anybody who does not press it is never sent marketing again (POPIA s69).
            </p>
            <Button variant="primary" onClick={() => void write()} disabled={!preview.counts.new || !name.trim() || !!busy} data-testid="news-import-write">
              {busy === 'write' ? 'Adding…' : `Add ${preview.counts.new} ${preview.counts.new === 1 ? 'lead' : 'leads'}`}
            </Button>
          </div>
        )}
        {done && <p className="mt-3 text-sm text-emerald-700" data-testid="news-import-done">{done}</p>}
        {error && <p className="mt-3 text-sm text-red-600" data-testid="news-import-error">{error}</p>}
        {lists.length > 0 && (
          <div className="mt-5">
            <p className="text-xs font-medium text-slate-500 mb-1">Lists imported so far</p>
            <ul className="text-sm text-slate-600 divide-y divide-slate-100 border border-slate-100 rounded-lg" data-testid="news-import-lists">
              {lists.map((l) => (
                <li key={l.id} className="px-3 py-1.5 flex flex-wrap gap-x-3">
                  <span className="text-slate-800">{l.name}</span>
                  <span className="text-xs text-slate-400">{l.lead_count} leads · {l.file_name ?? 'no file name'} · {new Date(l.uploaded_at).toLocaleDateString('en-ZA')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}
