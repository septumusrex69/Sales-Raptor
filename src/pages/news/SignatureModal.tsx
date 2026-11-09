import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../store/AuthContext'
import { sanitiseCampaignHtml } from '../../lib/campaignHtml'
import { saveSenderSignature, uploadEmailPicture } from '../../lib/marketingApi'
import { RichEditor } from './RichEditor'
import { errorText } from './shared'

/**
 * ONE ADDRESS'S SIGNATURE (S13, 29 Oct): "then you can import your own signatures and everything". Written in
 * the same ribbon editor as an email, or IMPORTED: Outlook keeps each signature as an .htm file (on Windows in
 * %APPDATA%\Microsoft\Signatures), so the file is read and put through the email's closed set. Pictures in it
 * that pointed at files on somebody's own computer cannot be emailed and are left out -- the screen says so,
 * rather than sending a broken picture to every client.
 */
export function SignatureModal({ address, displayName, initial, onClose, onSaved }: {
  address: string; displayName: string; initial: string; onClose: () => void; onSaved: (html: string) => void
}) {
  const { currentUser } = useAuth()
  const [html, setHtml] = useState(initial)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  async function importFile(f: File) {
    setError(null); setNote(null)
    if (f.size > 2 * 1024 * 1024) { setError('That file is larger than 2 MB, which no signature is. Is it the right one?'); return }
    const raw = await f.text()
    const clean = sanitiseCampaignHtml(raw.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, ''))
    const dropped = (raw.match(/<img\b/gi) ?? []).length - (clean.match(/<img\b/gi) ?? []).length
    setHtml(clean)
    setNote(dropped > 0
      ? `Imported. ${dropped} ${dropped === 1 ? 'picture was' : 'pictures were'} on your own computer and could not come along: add ${dropped === 1 ? 'it' : 'them'} again with Insert → Picture.`
      : 'Imported. Check it below and press Save.')
  }

  return (
    <Modal title={`Signature for ${address}`} subtitle="{{signature}} in an email is filled with the signature of the address that email goes from." onClose={onClose} width={820}
      footer={(
        <div className="flex items-center gap-2 justify-end">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} data-testid="news-signature-save"
            onClick={() => void (async () => {
              setBusy(true); setError(null)
              try { const clean = sanitiseCampaignHtml(html); await saveSenderSignature(address, displayName, clean); onSaved(clean) } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
            })()}>Save</Button>
        </div>
      )}>
      <div className="space-y-3" data-testid="news-signature">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={<FileUp size={14} />} onClick={() => file.current?.click()} data-testid="news-signature-import">Import from Outlook (.htm)</Button>
          <span className="text-xs text-slate-500">Or paste one in from an email, or type it below.</span>
          <input ref={file} type="file" accept=".htm,.html,text/html" className="hidden" data-testid="news-signature-file"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f) }} />
        </div>
        {note && <p className="text-xs text-slate-600" data-testid="news-signature-note">{note}</p>}
        <RichEditor value={html} onChange={setHtml} minHeight="10rem" testid="news-signature-editor"
          onPicture={currentUser ? (f) => uploadEmailPicture(currentUser.id, f) : undefined} />
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}
