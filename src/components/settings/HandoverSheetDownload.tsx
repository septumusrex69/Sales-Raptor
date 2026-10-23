import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { fetchFirmSettings } from '../../lib/firmSettings'
import { handoverSheetBytes, handoverSheetFilename, XLSX_MIME, type HandoverSheetFormat } from '../../lib/handoverTemplate'
import { downloadBytes } from '../../lib/xlsxWrite'

/**
 * "DOWNLOAD THE HANDOVER SHEET", WHERE THE HANDOVER IS IMPORTED.
 *
 * THE FIRM (Stephan, 23 Oct): "Make it possible so that we can download from the where we say
 * import handover, so that there's an option where we can export that sheet. Export the new
 * handover sheet or export the old handover sheet."
 *
 * HERE, beside the file input, because this is where somebody notices a client has no sheet to
 * fill in -- and "Upload a batch" on a client's page lands on this same card, so both doors have it.
 *
 * TWO CHOICES, AND THE NEW ONE SAYS IT IS THE ONE TO SEND. The old sheet is offered because a client
 * whose own system already writes that shape is better served by an empty copy of it, and the
 * importer reads it; but it is the sheet that ate 40 of 42 leading zeros, so it is not the default.
 *
 * Both are drawn in the browser by handoverTemplate.ts -- the same writer as the attachment on the
 * mandate and the welcome letter -- so there is no stored file to fall behind the importer.
 * Self-contained on purpose: one line drops it into HandoverImportCard.
 */
export function HandoverSheetDownload() {
  const [firmName, setFirmName] = useState<string | null>(null)
  const [busy, setBusy] = useState<HandoverSheetFormat | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetchFirmSettings().then((s) => { if (live) setFirmName(s.firmName) }).catch(() => {})
    return () => { live = false }
  }, [])

  async function download(format: HandoverSheetFormat) {
    setBusy(format); setError(null)
    try {
      downloadBytes(handoverSheetFilename(format, firmName), await handoverSheetBytes(format), XLSX_MIME)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const button = (format: HandoverSheetFormat, label: string) => (
    <button type="button" onClick={() => void download(format)} disabled={!!busy}
      data-testid={`handover-sheet-${format}`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-brand-300 disabled:opacity-50">
      {busy === format ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
      {label}
    </button>
  )

  return (
    <div className="mb-4 rounded-lg border border-dashed border-slate-200 p-3" data-testid="handover-sheet-download">
      <p className="text-sm font-medium text-slate-700">Download the handover sheet</p>
      <p className="mb-2 text-xs text-slate-500">
        An empty sheet for a client to fill in. The new one keeps leading zeros and marks what must be filled in.
      </p>
      <div className="flex flex-wrap gap-2">
        {button('new', 'New handover sheet (recommended)')}
        {button('old', 'Old handover sheet')}
      </div>
      {error && <p className="mt-2 text-xs text-rose-600" role="alert">{error}</p>}
    </div>
  )
}
