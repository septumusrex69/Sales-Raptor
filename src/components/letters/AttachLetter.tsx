import { useEffect, useState } from 'react'
import { FileText, Loader2, Paperclip } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { fetchLibrary, type LibraryTemplate } from '../../lib/templateLibrary.ts'
import { defaultOf, fetchLetterheads, type Letterhead } from '../../lib/letterheads.ts'
import {
  canUseLetter, letterProblems, parseLetter, A4_LETTERHEAD,
} from '../../lib/letterDocument.ts'
import { letterFilename, letterToPdf, toBase64 } from '../../lib/letterPdf.ts'

export interface AttachedFile {
  filename: string
  contentType: string
  size: number
  content: string
}

/**
 * ATTACHING THE FIRM'S OWN LETTER TO AN EMAIL, AS A PDF.
 *
 * The firm: "we need to be able to send a PDF through the system through an email… the PDF
 * doesn't necessarily need to be saved to Raptor."
 *
 * So it is not. The bytes are made here, handed to the composer, and gone when the modal closes.
 * What survives is the email itself and the record of which template went out — which is smaller
 * than the PDF, and is the thing somebody asking "what did we send them?" actually wants, because
 * it can be regenerated against the same account.
 *
 * ONLY LETTERS THAT CAN ACTUALLY GO. A template asking for a field nothing can fill would post
 * "{{firm_bank}}" to a debtor over a director's name — letterProblems refuses those, and they are
 * shown greyed with the reason rather than hidden, because "why is the section 129 not in this
 * list" is a worse question than "why is it greyed out".
 */
export function AttachLetter({ values, reference, onAttached, onError }: {
  /**
   * The merge values for the account this is being sent about.
   *
   * RESOLVED BY THE CALLER. A letter is merged against an account, a balance and a date, and this
   * component has none of those — the page that opened the composer does.
   */
  values: Record<string, string>
  /** What the debtor knows the account by. Goes in the filename, not in the letter. */
  reference: string | null
  onAttached: (file: AttachedFile) => void
  onError: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<LibraryTemplate[] | null>(null)
  const [letterhead, setLetterhead] = useState<Letterhead | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!open || rows !== null) return
    let cancelled = false
    void (async () => {
      try {
        const [library, heads] = await Promise.all([fetchLibrary('collections'), fetchLetterheads()])
        if (cancelled) return
        setRows(library.filter((r) => r.kind === 'letter' && r.format === 'document' && r.active))
        setLetterhead(defaultOf(heads))
      } catch (e) {
        if (!cancelled) { setRows([]); onError(e instanceof Error ? e.message : String(e)) }
      }
    })()
    return () => { cancelled = true }
  }, [open, rows, onError])

  async function attach(row: LibraryTemplate) {
    const doc = parseLetter(row.body)
    if (!doc) { onError('That letter could not be read back, so nothing was attached.'); return }
    setBusy(row.id)
    try {
      /*
       * THE LETTERHEAD IS FETCHED AS BYTES, not pointed at. A PDF embeds its images; a URL in a
       * PDF is a picture that is only there while the reader is online, which a posted notice
       * cannot rely on and an emailed one should not.
       */
      let head: { bytes: Uint8Array; type: 'png' | 'jpg' } | null = null
      if (letterhead) {
        const res = await fetch(letterhead.url)
        if (res.ok) {
          head = {
            bytes: new Uint8Array(await res.arrayBuffer()),
            type: /\.jpe?g($|\?)/i.test(letterhead.url) ? 'jpg' : 'png',
          }
        }
      }
      const bytes = await letterToPdf({
        doc,
        page: letterhead?.page ?? A4_LETTERHEAD,
        /* Always filled. A notice posted with {{balance}} in it is not a notice. */
        filled: true,
        values,
        letterhead: head,
      })
      onAttached({
        filename: letterFilename(row.name, reference),
        contentType: 'application/pdf',
        size: bytes.length,
        content: toBase64(bytes),
      })
      setOpen(false)
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg
          border border-slate-200 text-slate-600 hover:border-[#c9a052] hover:bg-gold-50">
        <FileText size={13} /> Attach a letter
      </button>

      {open && (
        <Modal title="Attach a letter" width={560} onClose={() => setOpen(false)}
          subtitle={letterhead
            ? `On ${letterhead.name}`
            : 'On plain paper — no letterhead has been uploaded'}>
          {rows === null ? (
            <p className="text-[13px] text-slate-400 inline-flex items-center gap-1.5">
              <Loader2 size={13} className="animate-spin" /> Reading the library&hellip;
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nothing in the library is laid out as a letter yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 -my-1">
              {rows.map((row) => {
                const doc = parseLetter(row.body)
                const problems = doc ? letterProblems(doc, 'collections') : []
                const refusal = doc === null
                  ? 'This letter could not be read back.'
                  : canUseLetter(problems)
                    ? null
                    : problems.find((p) => p.level === 'refuse')?.message ?? null
                return (
                  <li key={row.id} className="py-2.5">
                    <button type="button" disabled={refusal !== null || busy !== null}
                      onClick={() => void attach(row)}
                      className="w-full text-left flex items-center gap-2.5 disabled:opacity-50
                        disabled:cursor-not-allowed">
                      {busy === row.id
                        ? <Loader2 size={14} className="animate-spin text-slate-400 shrink-0" />
                        : <Paperclip size={14} className="text-slate-400 shrink-0" />}
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-navy-950">{row.name}</span>
                        {/* The reason it cannot go, rather than a row that simply does nothing. */}
                        {refusal && <span className="block text-[11px] text-negative-700">{refusal}</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-4 text-[11px] text-slate-400">
            The PDF is made when you attach it and is not kept in Raptor. What is kept is the
            message and which letter went out, which is enough to produce it again.
          </p>
        </Modal>
      )}
    </>
  )
}
