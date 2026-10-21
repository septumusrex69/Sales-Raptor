import { useState } from 'react'
import { FileBarChart, Loader2, Mail } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { FileActions } from '../ui/FileActions'
import { RecordAction } from '../record/RecordShell'
import { ComposeEmailModal } from '../ComposeEmailModal'
import { clientReportFile } from '../../lib/clientReportData'
import { clientReportEmail, clientReportFilename } from '../../lib/clientReport'
import { toBase64 } from '../../lib/letterPdf'
import { clockToday } from '../../lib/clock'

type Attached = { filename: string; contentType: string; size: number; content: string }

/**
 * THE CLIENT REPORT, FROM THE CLIENT PAGE (S9, 19 Oct): the firm's Excel "Collection dashboard"
 * remade as a PDF the liaison can send -- the book at a glance, then month by month. See
 * clientReport.ts for what it fixes in the reference.
 *
 * A BOX WITH OPEN AND DOWNLOAD, like every other file in Raptor (FileActions): the report is drawn
 * when one of them is pressed, so it is today's, and on the iPad Download is the share sheet.
 *
 * AND EMAIL IT (S10). HANDOFF listed "sending it by email from Raptor" as not done: the report was
 * downloaded and attached by hand, so it left from somebody's own mail program and nothing of it
 * reached the client's timeline. Email it draws the same PDF and opens THE SAME COMPOSE BOX the
 * client page's Email opens, the way the mandate goes out (SendMandateModal): the file already on
 * the message, a short covering note the liaison can rewrite, and the client's address -- or an
 * empty To where the client has none, so the box asks rather than sending to nobody. The send is
 * logged by the caller exactly as the client page logs its other email.
 *
 * NOTHING IS CHARGED. Fees are charged on ACCOUNTS ONLY (CLAUDE.md); this is the sales side
 * writing to its client, not correspondence on a debtor's account. The box says so, because the
 * account page's box says R25 under item 1(a) and a liaison who has used both will wonder.
 */
export function ClientReportButton({ client, email, onEmailed }: {
  client: { id: string; name: string; code: string | null; accountIds: string[] }
  /** The client's own address, or null -- the compose box then opens with To empty. */
  email?: string | null
  /** Logs the sent email on the client's timeline, as the client page's other email does. */
  onEmailed?: (subject: string, bodyText: string) => void
}) {
  const [open, setOpen] = useState(false)
  /* Drawn once per opening and kept, so Open and then Download are the same document. */
  const [file, setFile] = useState<Promise<Blob> | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [compose, setCompose] = useState<{ subject: string; body: string; file: Attached } | null>(null)
  const fetchFile = () => {
    const f = file ?? clientReportFile(client).then((r) => r.blob)
    if (!file) setFile(f)
    /* A failed draw is not kept: the next press tries again. */
    f.catch(() => setFile(null))
    return f
  }

  /* The SAME drawn document as Open and Download, so what is opened to check is what is sent. */
  async function emailIt() {
    setPreparing(true); setError(null)
    try {
      const bytes = new Uint8Array(await (await fetchFile()).arrayBuffer())
      const today = clockToday()
      setCompose({
        ...clientReportEmail(client.name, today),
        file: { filename: clientReportFilename(client.name, today), contentType: 'application/pdf', size: bytes.length, content: toBase64(bytes) },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPreparing(false)
    }
  }

  return (
    <>
      <RecordAction icon={FileBarChart} label="Client report" onClick={() => { setFile(null); setError(null); setOpen(true) }}
        title="The client's collection report, as a PDF to send them" />
      {/* The compose box REPLACES the report's box rather than stacking on it: one window at a time,
          and the button stays in the action row behind it. */}
      {compose ? (
        <ComposeEmailModal
          title="Email the client report"
          to={email ?? ''}
          initialSubject={compose.subject}
          initialBody={compose.body}
          initialAttachments={[compose.file]}
          contextNote="The collection report is attached. Goes out from your connected mailbox and is filed on this client. Nothing is charged: fees are raised on debtor accounts only."
          onClose={() => { setCompose(null); setOpen(false) }}
          onSent={(subject, bodyText) => onEmailed?.(subject, bodyText)}
        />
      ) : open && (
        <Modal title="Client report" subtitle={client.name} onClose={() => setOpen(false)} width={440}>
          <div className="space-y-3" data-testid="client-report-box">
            <p className="text-sm text-slate-600">
              Their book at a glance, then their collections and handovers month by month for the last twelve months.
              Drawn today, from the same figures as this page. No commission and no fees: it is for the client.
            </p>
            <FileActions name={clientReportFilename(client.name, clockToday())} fetchFile={fetchFile} testId="client-report-pdf" />
            <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
              <button type="button" className="btn-primary inline-flex items-center gap-1.5" disabled={preparing}
                onClick={() => void emailIt()} data-testid="client-report-email">
                {preparing ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                {preparing ? 'Drawing the report…' : 'Email it'}
              </button>
              <span className="text-xs text-slate-500">
                {email ? `To ${email}, from your mailbox, with the PDF attached.` : 'No email address on this client: the box will ask for one.'}
              </span>
            </div>
            {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
          </div>
        </Modal>
      )}
    </>
  )
}
