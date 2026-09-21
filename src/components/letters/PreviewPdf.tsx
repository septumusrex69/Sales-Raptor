import { useEffect, useRef, useState } from 'react'
import { ExternalLink, FileText, Loader2 } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { letterPdfBytes } from '../../lib/letterAttachment.ts'
import type { LetterDocument } from '../../lib/letterDocument.ts'
import type { TemplateScope } from '../../lib/messageTemplates'

/**
 * THE LETTER AS THE PDF IT WILL ACTUALLY BE.
 *
 * The firm: "I think we should have an option to preview what the PDF would look like. Um, you
 * know, once you've done everything, like a, just a preview."
 *
 * WHY THE EDITOR IS NOT ALREADY THAT. The page editor shows a browser drawing the letter, and it
 * is close — same millimetres, same margins, same letterhead. But it is the BROWSER's idea of the
 * letter, in whatever face the screen has, paginated by measuring that. The PDF is built by
 * letterLayout in the metrics of the fourteen standard PDF faces, and near a page boundary the
 * two can differ by a line. This is the one that gets posted, so this is the one there has to be
 * a way to look at.
 *
 * AND IT IS THE ONLY VIEW THAT PAGINATES PROPERLY. The reading pane draws a single continuous
 * sheet with the letterhead painted once, so on a two-page notice its footer block lands across
 * the middle of the text — which is exactly what the firm sent a screenshot of.
 *
 * BUILT IN THE BROWSER AND KEPT NOWHERE. pdf-lib is already here for the attachment, `api/` is at
 * its twelve-function ceiling, and a preview that needed a round trip would be a preview nobody
 * waits for. The blob is revoked when the window closes.
 *
 * DRAWN PAGE BY PAGE WITH pdf.js, NOT PUT IN AN <iframe>. An iframe was the obvious way and it is
 * the wrong one: Safari on iOS refuses to render a PDF inside one, and the firm works on an iPad,
 * so the preview would have been a white rectangle on the only machine that matters. pdf.js is
 * already a dependency — the trace importer reads bureau PDFs with it — and drawing to a canvas
 * works the same everywhere. "Open it" is kept as well, because a real PDF viewer can zoom and
 * this cannot.
 */
export function PreviewPdf({ doc, scope, values, name, label }: {
  /** The live document, so a draft that has never been saved can be looked at. */
  doc: LetterDocument
  scope: TemplateScope
  /** What the merge fields are filled with when the filled view is chosen. */
  values: Record<string, string>
  /** Only for the filename offered when it is opened in its own tab. */
  name: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  /*
   * FILLED OR NOT, the same two views the reading pane offers and for the same reason: the fields
   * in braces are what you edit, the same words filled in are what the debtor reads, and neither
   * answers the other's question. Opens on the braces, because somebody pressing Preview from an
   * editor is looking at their own wording.
   */
  const [filled, setFilled] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sheets = useRef<HTMLDivElement>(null)
  /* Held so it can be revoked: a blob URL keeps the whole PDF alive in memory until it is. */
  const made = useRef<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const bytes = await letterPdfBytes({ doc, scope, values, filled, name })
        if (cancelled) return
        /*
         * Copied into a fresh ArrayBuffer rather than handed the view directly: the bytes may sit
         * in a larger buffer, and a Blob built from the view alone has been known to carry the
         * whole of it.
         */
        const blob = new Blob([new Uint8Array(bytes).slice().buffer], { type: 'application/pdf' })
        const next = URL.createObjectURL(blob)
        if (made.current) URL.revokeObjectURL(made.current)
        made.current = next
        setUrl(next)
        await drawPages(bytes, sheets, () => cancelled)
      } catch (e) {
        if (!cancelled) { setUrl(null); setError(e instanceof Error ? e.message : String(e)) }
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, doc, scope, values, filled, name])

  /* Revoked when the window closes, and on the way out of the screen entirely. */
  useEffect(() => () => { if (made.current) URL.revokeObjectURL(made.current) }, [])
  function close() {
    setOpen(false)
    if (made.current) { URL.revokeObjectURL(made.current); made.current = null }
    setUrl(null)
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg
          border border-slate-200 text-slate-600 hover:border-[#c9a052] hover:bg-gold-50">
        <FileText size={13} /> {label ?? 'Preview the PDF'}
      </button>

      {open && (
        <Modal title="The letter as it will print" onClose={close} width={860} padded={false}
          headerRight={
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-slate-200 p-0.5">
                {([[false, 'Merge fields'], [true, 'Example data']] as const).map(([id, text]) => (
                  <button key={text} type="button" onClick={() => setFilled(id)}
                    aria-pressed={filled === id}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      filled === id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-700'
                    }`}>
                    {text}
                  </button>
                ))}
              </div>
              {/*
                OPEN IN ITS OWN TAB, and this is not a nicety. Safari on an iPad will not draw a
                PDF inside an iframe at all, and the firm works on one — so the embedded view
                below is the convenience and this is the thing that always works.
              */}
              {url && (
                <a href={url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5
                    rounded-lg border border-slate-200 text-slate-600 hover:border-[#c9a052]
                    hover:bg-gold-50">
                  <ExternalLink size={12} /> Open it
                </a>
              )}
            </div>
          }>
          <div className="bg-slate-200/70" style={{ height: '72vh' }}>
            {busy && (
              <p className="flex items-center gap-2 p-5 text-sm text-slate-500">
                <Loader2 size={14} className="animate-spin" /> Drawing the letter&hellip;
              </p>
            )}
            {error && (
              <div className="p-5">
                <p className="text-sm text-negative-700">{error}</p>
                <p className="text-xs text-slate-500 mt-2">
                  Nothing has been changed. Fix it in the letter and try again.
                </p>
              </div>
            )}
            {/*
              THE PAGES THEMSELVES. Kept mounted whatever the state, because pdf.js draws into it
              and a node that React has not put on the page yet is a node with nothing to draw on.
            */}
            <div ref={sheets} data-pdf-pages
              className={`h-full overflow-auto p-5 space-y-5 ${busy || error ? 'hidden' : ''}`} />
          </div>
        </Modal>
      )}
    </>
  )
}

/**
 * Draw every page of a PDF into the pane, at a size a person can read.
 *
 * pdf.js RATHER THAN THE BROWSER'S OWN VIEWER, for the reason given above: Safari on iOS will not
 * draw a PDF inside an iframe, and that is the machine the firm works on. Loaded on demand — it
 * is a large library and most people never open a preview — which is the same bargain the trace
 * importer makes with it.
 *
 * `isStale` IS ASKED BETWEEN PAGES, not only at the start. A three-page notice takes long enough
 * to draw that somebody can close the window or flip to the filled view in the middle of it, and
 * drawing the rest into a pane that has been thrown away is the classic way this leaks.
 */
async function drawPages(
  bytes: Uint8Array,
  host: React.RefObject<HTMLDivElement | null>,
  isStale: () => boolean,
): Promise<void> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  /* Copied, because pdf.js takes ownership of the buffer it is given and the caller still wants
     these bytes for the blob behind "Open it". */
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true })
  const file = await task.promise
  /* THE LOADING TASK OWNS THE WORKER, not the document -- pdfText.ts records the same thing.
     Destroying the document alone leaves a worker thread behind, one per preview opened. */
  if (isStale() || !host.current) { void task.destroy(); return }
  host.current.replaceChildren()

  for (let n = 1; n <= file.numPages; n += 1) {
    if (isStale() || !host.current) break
    const page = await file.getPage(n)
    /* Twice the natural size, drawn into a canvas shown at half: a page rendered at 1:1 is
       unreadable on a high-density screen, which is every screen the firm owns. */
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.className = 'block mx-auto shadow-lg bg-white rounded-[2px] max-w-full h-auto'
    canvas.style.width = `${viewport.width / 2}px`
    const context = canvas.getContext('2d')
    if (!context) break
    await page.render({ canvas, canvasContext: context, viewport }).promise
    if (isStale() || !host.current) break
    host.current.appendChild(canvas)
  }
  file.cleanup()
  void task.destroy()
}
