import { useState } from 'react'
import { FileBarChart } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { FileActions } from '../ui/FileActions'
import { RecordAction } from '../record/RecordShell'
import { clientReportFile } from '../../lib/clientReportData'
import { clientReportFilename } from '../../lib/clientReport'
import { clockToday } from '../../lib/clock'

/**
 * THE CLIENT REPORT, FROM THE CLIENT PAGE (S9, 19 Oct): the firm's Excel "Collection dashboard"
 * remade as a PDF the liaison can send -- the book at a glance, then month by month. See
 * clientReport.ts for what it fixes in the reference.
 *
 * A BOX WITH OPEN AND DOWNLOAD, like every other file in Raptor (FileActions): the report is drawn
 * when one of them is pressed, so it is today's, and on the iPad Download is the share sheet.
 */
export function ClientReportButton({ client }: { client: { id: string; name: string; code: string | null; accountIds: string[] } }) {
  const [open, setOpen] = useState(false)
  /* Drawn once per opening and kept, so Open and then Download are the same document. */
  const [file, setFile] = useState<Promise<Blob> | null>(null)
  const fetchFile = () => {
    const f = file ?? clientReportFile(client).then((r) => r.blob)
    if (!file) setFile(f)
    /* A failed draw is not kept: the next press tries again. */
    f.catch(() => setFile(null))
    return f
  }
  return (
    <>
      <RecordAction icon={FileBarChart} label="Client report" onClick={() => { setFile(null); setOpen(true) }}
        title="The client's collection report, as a PDF to send them" />
      {open && (
        <Modal title="Client report" subtitle={client.name} onClose={() => setOpen(false)} width={440}>
          <div className="space-y-3" data-testid="client-report-box">
            <p className="text-sm text-slate-600">
              Their book at a glance, then their collections and handovers month by month for the last twelve months.
              Drawn today, from the same figures as this page. No commission and no fees: it is for the client.
            </p>
            <FileActions name={clientReportFilename(client.name, clockToday())} fetchFile={fetchFile} testId="client-report-pdf" />
          </div>
        </Modal>
      )}
    </>
  )
}
