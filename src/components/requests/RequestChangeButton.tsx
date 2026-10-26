import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { FileText, ImagePlus, Lightbulb, Loader2, X } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { DictateButton } from '../ui/Dictate'
import {
  ACCEPTED_MIME, DEPARTMENT_HINT, MAX_FILES, REQUEST_DEPARTMENTS, fileProblem, fitWithin, paneOf, type RequestDepartment,
} from '../../lib/changeRequests'
import { createRequest, type OutgoingFile } from '../../lib/changeRequestsApi'

/**
 * "REQUEST A CHANGE", ON EVERY PAGE (S12, changeRequests.ts).
 *
 * In the top bar beside the bell, because that is where somebody already looks while testing, and a
 * floating button would sit over the very thing they want to show. The page they are on is
 * captured for them -- "where was this?" is the first question a request leaves unanswered.
 */
export function RequestChangeButton({ title }: { title: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Request a change" aria-label="Request a change"
        data-testid="request-change-open" className="p-2 rounded-lg hover:bg-slate-100 text-slate-500">
        <Lightbulb size={18} />
      </button>
      {open && <RequestChangeModal pageTitle={title} onClose={() => setOpen(false)} />}
    </>
  )
}

interface Picked extends OutgoingFile { preview: string | null }

/**
 * A SCREENSHOT IS SHRUNK HERE, BEFORE IT LEAVES THE DEVICE. An iPad screenshot is 2 732 pixels wide
 * and a few megabytes; drawn at 1 600 as a JPEG it is a couple of hundred kilobytes and every word on
 * it is still readable. The database keeps these (so a Claude session can read them), so the size is
 * decided here rather than discovered in the Supabase bill.
 */
async function shrinkPicture(file: File): Promise<{ base64: string; mime: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error(`${file.name} could not be read as a picture.`))
      i.src = url
    })
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot shrink pictures.')
    /* White under a transparent PNG, or it turns black as a JPEG. */
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    return { base64: canvas.toDataURL('image/jpeg', 0.82).split(',')[1] ?? '', mime: 'image/jpeg' }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(new Error(`${file.name} could not be read.`))
    r.readAsDataURL(file)
  })
}

function RequestChangeModal({ pageTitle, onClose }: { pageTitle: string; onClose: () => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const page = `${location.pathname}${location.search}`
  /* The pane comes from the address; the department is suggested from it and theirs to change. */
  const { pane, department: suggested } = paneOf(location.pathname)
  const [department, setDepartment] = useState<RequestDepartment>(suggested)
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<Picked[]>([])
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ number: number; failedFiles: string[] } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function add(list: File[]) {
    setError(null)
    const room = MAX_FILES - files.length
    if (list.length > room) setError(`At most ${MAX_FILES} files on one request.`)
    setReading(true)
    const next: Picked[] = []
    for (const f of list.slice(0, Math.max(0, room))) {
      const problem = fileProblem({ name: f.name, type: f.type, size: f.size })
      if (problem) { setError(problem); continue }
      try {
        if (f.type.startsWith('image/')) {
          const { base64, mime } = await shrinkPicture(f)
          next.push({ name: f.name.replace(/\.[^.]+$/, '') + '.jpg', mime, base64, preview: `data:${mime};base64,${base64}` })
        } else {
          next.push({ name: f.name, mime: f.type, base64: await readBase64(f), preview: null })
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    setReading(false)
    setFiles((cur) => [...cur, ...next])
  }

  async function send() {
    setBusy(true); setError(null)
    try {
      setSent(await createRequest({ description, pagePath: page, pageTitle, pane, department, files: files.map(({ name, mime, base64 }) => ({ name, mime, base64 })) }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <Modal title="Request sent" onClose={onClose} footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { onClose(); navigate(`/requests?r=${sent.number}`) }}>See it</Button>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      }>
        <div data-testid="request-change-sent" className="space-y-2 text-sm text-slate-700">
          <p>Thank you. Your request is <strong>R-{sent.number}</strong>. The administrator has been told, and you will be told when it is done.</p>
          {sent.failedFiles.length > 0 && (
            <p className="text-red-700">{sent.failedFiles.join(', ')} did not go with it. Add it to a new request, or tell the administrator.</p>
          )}
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Request a change" subtitle="What should Raptor do differently? A screenshot helps." onClose={onClose} width={560}
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-slate-400 truncate" title={page} data-testid="request-change-pane">From the {pane} pane</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy || reading || !description.trim()} onClick={() => void send()} data-testid="request-change-send">
              {busy ? <Loader2 size={14} className="animate-spin" /> : null} Send request
            </Button>
          </div>
        </div>
      }>
      <div className="space-y-3" onPaste={(e) => {
        /* A screenshot pasted straight in (a laptop's copy-screenshot) is a file like any other. */
        const pasted = Array.from(e.clipboardData.files)
        if (pasted.length) { e.preventDefault(); void add(pasted) }
      }}>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="request-change-description" className="text-xs font-semibold text-slate-600">What should change?</label>
            {/* TALK IT IN (the firm, 26 Oct: "they should be able to dictate"). The same microphone as
                every other note in Raptor; the words land in the box as they are spoken. */}
            <DictateButton size="small" value={description} onChange={setDescription} />
          </div>
          <textarea id="request-change-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={5} autoFocus
            placeholder="Type, or press the microphone and say it. e.g. On this page the Paid column should show the date it was paid, not only the amount."
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" data-testid="request-change-description" />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">Which department is it for?</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Which department is it for?" data-testid="request-change-department">
            {REQUEST_DEPARTMENTS.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={department === d} title={DEPARTMENT_HINT[d]} onClick={() => setDepartment(d)}
                className={`rounded-full border px-2.5 py-1 text-xs ${department === d ? 'border-navy-900 bg-navy-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                {d}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">{DEPARTMENT_HINT[department]}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div key={i} className="relative h-20 w-28 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              {f.preview
                ? <img src={f.preview} alt={f.name} className="h-full w-full object-cover" />
                : <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center text-[11px] text-slate-500"><FileText size={18} /><span className="truncate w-full">{f.name}</span></div>}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                className="absolute right-1 top-1 rounded-full bg-white/90 p-0.5 text-slate-600 shadow"><X size={12} /></button>
            </div>
          ))}
          {files.length < MAX_FILES && (
            <button type="button" onClick={() => input.current?.click()} disabled={reading}
              className="flex h-20 w-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 hover:bg-slate-50">
              {reading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />} Screenshot or PDF
            </button>
          )}
          <input ref={input} type="file" multiple accept={[...ACCEPTED_MIME, 'image/*'].join(',')} className="hidden" data-testid="request-change-files"
            onChange={(e) => { void add(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        </div>
        <p className="text-xs text-slate-400">Everybody can see requests. The administrator decides what gets built, and you are told when yours is done.</p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}
