import { useState, type ReactNode } from 'react'
import { Download, ExternalLink, Loader2 } from 'lucide-react'
import { openPending, saveFile } from '../../lib/fileSave'

/**
 * A FILE, WITH OPEN AND DOWNLOAD BESIDE IT -- the firm, 19 Oct: "I should see an option to open it
 * or download it ... The same should work for every single document and PDF." See fileSave.ts for
 * what each press does and why an iPad needs it done that way.
 *
 * ONE COMPONENT FOR EVERY FILE, so the two words, their order and the iPad's second tap are the
 * same on a mail attachment, a filed mandate and a generated notice. A screen hands over how to get
 * the file and nothing else.
 *
 * `fetchFile` gets the bytes. `openUrl`, where given, is used for Open instead -- a signed storage
 * address the tab can load itself, so opening a large scan does not first pull it into the page.
 * `onOpen` / `onSave` run after a press succeeds, for what a screen records about it (a logged
 * download, say). Opening a file charges nothing: the perusal of documents fee was removed (S10).
 *
 * BOTH WORDS ALWAYS SHOWN, never on hover: the firm works on an iPad, where there is no hover, so a
 * hidden control does not exist for them.
 */
export function FileActions({
  name, label, fetchFile, openUrl, onOpen, onSave, compact = false, buttonsOnly = false, testId,
}: {
  name: string
  /** What to draw for the file; the name when absent. */
  label?: ReactNode
  fetchFile: () => Promise<Blob>
  openUrl?: () => Promise<string>
  onOpen?: () => void
  onSave?: () => void
  /** Icons only, for a dense row. The words stay in the title and the accessible name. */
  compact?: boolean
  /** The two buttons alone, for a row that already shows the file's name and details. */
  buttonsOnly?: boolean
  testId?: string
}) {
  const [busy, setBusy] = useState<'open' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  /* The file, in hand, waiting for the second tap Safari insists on (see fileSave.ts). */
  const [ready, setReady] = useState<Blob | null>(null)

  async function open() {
    setError(null)
    /* THE TAB FIRST, on the press, or Safari calls it a pop-up. */
    const tab = openPending()
    setBusy('open')
    try {
      if (openUrl) tab.showUrl(await openUrl())
      else tab.show(await fetchFile(), name)
      onOpen?.()
    } catch (e) {
      tab.fail()
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function save(blob?: Blob) {
    setError(null)
    setBusy('save')
    try {
      const file = blob ?? await fetchFile()
      const outcome = await saveFile(file, name, { fromTap: !!blob })
      if (outcome === 'needs-tap') { setReady(file); return }
      setReady(null)
      if (outcome === 'saved') onSave?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const btn = 'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-slate-500 hover:bg-slate-100 hover:text-brand-600 disabled:opacity-50'
  return (
    <span className="inline-flex max-w-full flex-col" data-testid={testId}>
      <span className={buttonsOnly
        ? 'inline-flex items-center gap-0.5'
        : 'inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-white py-0.5 pl-2 pr-0.5 text-xs text-slate-600'}>
        {!buttonsOnly && <span className="min-w-0 truncate" title={name}>{label ?? name}</span>}
        <button type="button" onClick={() => void open()} disabled={busy !== null}
          title={`Open ${name}`} aria-label={`Open ${name}`} data-action="open" className={btn}>
          {busy === 'open' ? <Loader2 size={11} className="animate-spin" /> : <ExternalLink size={11} />}
          {!compact && 'Open'}
        </button>
        <button type="button" onClick={() => void save()} disabled={busy !== null}
          title={`Download ${name}`} aria-label={`Download ${name}`} data-action="download" className={btn}>
          {busy === 'save' ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
          {!compact && 'Download'}
        </button>
      </span>
      {ready && (
        /* THE SECOND TAP, said as what it does. Safari would not open "Save to Files" this long
           after the first one, so the file waits here, fetched, for a tap of its own. */
        <button type="button" onClick={() => void save(ready)} data-action="save-ready"
          className="mt-1 self-start rounded-md bg-brand-600 px-2 py-1 text-[11.5px] font-medium text-white">
          Save {name}
        </button>
      )}
      {error && <span className="mt-1 text-[11px] text-negative-700">{error}</span>}
    </span>
  )
}
