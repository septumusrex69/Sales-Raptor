import { useCallback, useEffect, useRef, useState } from 'react'
import { FileImage, Loader2, Star, Trash2, Upload } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { inputClass } from '../../components/ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { canEditLibrary } from '../../lib/permissions'
import {
  deleteLetterhead, fetchLetterheads, makeDefault, saveLetterhead, uploadLetterhead,
  type Letterhead,
} from '../../lib/letterheads.ts'
import { A4_LETTERHEAD, blankLetter, type PageSetup } from '../../lib/letterDocument.ts'
import { LetterPage } from '../../components/letters/LetterPage'

/**
 * THE PAPER THE FIRM WRITES ON.
 *
 * The firm asked for it directly — "I think there needs to be a place where you upload your
 * letterhead, no?" — and the answer is yes, with one thing that is easy to leave out and is the
 * whole point: THE MARGINS COME WITH IT.
 *
 * BF_Letterhead_Aug_2026 is a full-page A4 image with no text of its own. The logo, the rule down
 * the side and the footer block with the phone number and the VAT number are all drawn into the
 * picture, and nothing in the picture stops body text landing on top of them. The only thing that
 * does is the four margins, so they are stored with the file and previewed against it here, where
 * an overlap is a thing you can see rather than a thing you find out about after the post.
 */
export function LetterheadSettings() {
  const { currentUser } = useAuth()
  const mayEdit = canEditLibrary(currentUser?.role)
  const [rows, setRows] = useState<Letterhead[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setError(null)
    try { setRows(await fetchLetterheads()) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function act(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try { await fn(); await load() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    /*
     * SIZE CHECKED HERE RATHER THAN LEFT TO THE BUCKET. A letterhead is a page of artwork —
     * the firm's own is 55 KB — and somebody reaching for a phone photograph of a printed
     * letterhead is making a mistake worth naming before the upload, not after it.
     */
    if (f.size > 4 * 1024 * 1024) {
      setError('That file is 4 MB or more. A letterhead is a page of artwork, not a photograph of one.')
      return
    }
    await act(() => uploadLetterhead(f, {
      name: f.name.replace(/\.[^.]+$/, ''),
      page: {
        widthMm: A4_LETTERHEAD.widthMm,
        heightMm: A4_LETTERHEAD.heightMm,
        marginTopMm: A4_LETTERHEAD.marginTopMm,
        marginRightMm: A4_LETTERHEAD.marginRightMm,
        marginBottomMm: A4_LETTERHEAD.marginBottomMm,
        marginLeftMm: A4_LETTERHEAD.marginLeftMm,
      },
      /* The first one uploaded is the default, because a firm with one letterhead and no default
         is a firm whose letters print on plain paper for no reason they can see. */
      isDefault: (rows ?? []).length === 0,
      active: true,
    }))
  }

  return (
    <Card padded={false}>
      <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-navy-950">Letterhead</h3>
          <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
            The page every letter is printed on, and the margins that keep the words off the logo
            and out of the footer. A full-page image, exported from the firm&rsquo;s letterhead
            file at A4.
          </p>
        </div>
        {mayEdit && (
          <>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
              onChange={(e) => void onPick(e)} />
            <button type="button" disabled={busy} onClick={() => file.current?.click()}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg
                border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500 disabled:opacity-40">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Upload a letterhead
            </button>
          </>
        )}
      </div>

      {error && <p className="px-5 py-3 text-sm text-negative-700">{error}</p>}

      {rows === null ? (
        <p className="px-5 py-6 text-[13px] text-slate-400 inline-flex items-center gap-1.5">
          <Loader2 size={13} className="animate-spin" /> Reading&hellip;
        </p>
      ) : rows.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <FileImage size={22} className="mx-auto text-slate-300" />
          <p className="text-sm text-slate-600 mt-3 font-medium">No letterhead yet.</p>
          <p className="text-xs text-slate-400 mt-1.5 max-w-md mx-auto">
            Letters print on plain paper until one is uploaded. Export the firm&rsquo;s letterhead
            as a full-page A4 image &mdash; the whole sheet, including the footer block.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => (
            <li key={row.id}>
              <div className="px-5 py-3 flex flex-wrap items-center gap-3">
                <img src={row.url} alt="" className="w-10 h-14 object-cover rounded border border-slate-200" />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-navy-950 flex items-center gap-1.5">
                    {row.name}
                    {row.isDefault && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gold-50 text-[var(--c-gold-deep)]">
                        Default
                      </span>
                    )}
                    {!row.active && <span className="text-[10px] text-slate-400">retired</span>}
                  </p>
                  <p className="text-[11px] text-slate-400 tabular-nums">
                    {row.page.widthMm} &times; {row.page.heightMm} mm &middot; margins{' '}
                    {row.page.marginTopMm} / {row.page.marginRightMm} / {row.page.marginBottomMm} /{' '}
                    {row.page.marginLeftMm}
                  </p>
                </div>
                <span className="ml-auto flex items-center gap-1.5">
                  <button type="button"
                    onClick={() => setOpenId(openId === row.id ? null : row.id)}
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                    {openId === row.id ? 'Done' : 'Margins'}
                  </button>
                  {mayEdit && !row.isDefault && (
                    <button type="button" disabled={busy} onClick={() => void act(() => makeDefault(row.id))}
                      title="Letters open on this one"
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                      <Star size={12} /> Make default
                    </button>
                  )}
                  {mayEdit && (
                    <button type="button" disabled={busy} title="Delete this letterhead"
                      aria-label="Delete this letterhead"
                      onClick={() => void act(() => deleteLetterhead(row))}
                      className="p-1.5 rounded-lg text-negative-600 hover:bg-negative-50 disabled:opacity-40">
                      <Trash2 size={13} />
                    </button>
                  )}
                </span>
              </div>

              {openId === row.id && (
                <MarginEditor row={row} readOnly={!mayEdit} busy={busy}
                  onSave={(page) => void act(() => saveLetterhead(row.id, {
                    name: row.name, page, isDefault: row.isDefault, active: row.active,
                  }))} />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/**
 * The four margins, against a live page.
 *
 * THE PREVIEW IS THE POINT. Four numbers in four boxes tell nobody whether the last line clears
 * the footer; the same four numbers with the letterhead behind a page of real text answer it in a
 * glance. The sample text is deliberately long enough to reach the bottom of the page, because a
 * margin that is wrong is only wrong at the bottom.
 */
function MarginEditor({ row, onSave, readOnly, busy }: {
  row: Letterhead
  onSave: (page: Omit<PageSetup, 'backgroundUrl'>) => void
  readOnly: boolean
  busy: boolean
}) {
  const [page, setPage] = useState({
    widthMm: row.page.widthMm,
    heightMm: row.page.heightMm,
    marginTopMm: row.page.marginTopMm,
    marginRightMm: row.page.marginRightMm,
    marginBottomMm: row.page.marginBottomMm,
    marginLeftMm: row.page.marginLeftMm,
  })
  const dirty = JSON.stringify(page) !== JSON.stringify({
    widthMm: row.page.widthMm, heightMm: row.page.heightMm,
    marginTopMm: row.page.marginTopMm, marginRightMm: row.page.marginRightMm,
    marginBottomMm: row.page.marginBottomMm, marginLeftMm: row.page.marginLeftMm,
  })
  const num = (k: keyof typeof page) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setPage((p) => ({ ...p, [k]: Number(e.target.value) || 0 }))

  return (
    <div className="px-5 pb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] items-start bg-slate-50/60">
      <div className="pt-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {([
            ['marginTopMm', 'Top'], ['marginRightMm', 'Right'],
            ['marginBottomMm', 'Bottom'], ['marginLeftMm', 'Left'],
          ] as const).map(([k, label]) => (
            <label key={k} className="block">
              <span className="block text-[10px] uppercase tracking-wide text-slate-400 mb-1">
                {label} (mm)
              </span>
              <input type="number" step="0.5" min={0} max={100} disabled={readOnly}
                className={inputClass} value={page[k]} onChange={num(k)} />
            </label>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-2.5 max-w-lg">
          The firm&rsquo;s own file is set to 37.5 / 20 / 20 / 20. The bottom is 24 here rather
          than 20 because the footer block starts 279.8&thinsp;mm down the page, so 20 lets the
          last line of a full page run into it.
        </p>
        {!readOnly && (
          <button type="button" disabled={!dirty || busy} onClick={() => onSave(page)}
            className="mt-3 text-sm font-medium px-3.5 py-2 rounded-lg border border-gold-500
              bg-gold-400 text-navy-950 hover:bg-gold-500 disabled:opacity-40">
            Save the margins
          </button>
        )}
      </div>

      <LetterPage doc={SAMPLE} scale={0.42} filled={false} values={{}}
        page={{ ...page, backgroundUrl: row.url }} />
    </div>
  )
}

/**
 * A page of text that reaches the bottom.
 *
 * NOT LOREM AND NOT A SHORT PARAGRAPH. The margin being checked is the bottom one, and a sample
 * that stops halfway down proves nothing about it — the whole reason to look is to see whether
 * the last line clears the footer block.
 */
const SAMPLE = (() => {
  const doc = blankLetter()
  const line = 'The quick brown fox jumps over the lazy dog, and the last line of this page is '
    + 'here to show where the words stop and the letterhead begins. '
  doc.blocks = [
    { kind: 'heading', level: 1, spans: [{ text: 'SAMPLE PAGE' }] },
    ...Array.from({ length: 14 }, () => ({
      kind: 'paragraph' as const, spans: [{ text: line.repeat(2) }],
    })),
  ]
  return doc
})()
