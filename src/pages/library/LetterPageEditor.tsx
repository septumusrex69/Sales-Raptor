import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Italic, List, ListOrdered,
  PenLine, SquareSplitVertical, Table as TableIcon, Underline,
} from 'lucide-react'
import {
  A4_LETTERHEAD, documentHtmlToBlocks, letterCss, letterToHtml, runningFootHtml, serialiseLetter,
  type LetterDocument, type PageSetup,
} from '../../lib/letterDocument.ts'
import { defaultOf, fetchLetterheads } from '../../lib/letterheads'

/**
 * TYPING ON THE PAGE.
 *
 * The firm, after working with the block editor: "can't it be just like one page which you
 * immediately see how it would look like, and without having to do that? And then you don't even
 * have a preview." They are right, and the block editor was the wrong shape for the job — a stack
 * of cards is a form for describing a letter, not a letter.
 *
 * So this is the page itself: A4 at real millimetres, the firm's own letterhead behind it, the
 * firm's own margins, and the text editable in place. What you see IS the preview, because there
 * is only one thing on screen.
 *
 * THE PAGE IS AN INPUT SURFACE, NOT THE STORED DOCUMENT, and that bargain is the whole reason
 * this can be done safely. The HTML is drawn FROM the model by letterToHtml and read BACK into it
 * by documentHtmlToBlocks, against a closed list of shapes. Whatever the browser invents — a
 * `<font>` tag, forty tags of Office markup off the clipboard, a `<div>` where a `<p>` was —
 * contributes its text and nothing else. If the markup were what we kept, a section 129 would
 * print at the mercy of whatever Chrome felt like emitting, and a defective statutory demand is
 * one the credit provider cannot go to court on.
 *
 * WHAT IS NOT HERE YET, said plainly rather than left to be discovered: live page breaks. The
 * sheet scrolls as one continuous page, so where page two starts is shown by the PDF and not
 * here. Running the layout engine on every keystroke is the way to do it and it is the next
 * piece; holding this back for it would have been the wrong trade.
 */
export function LetterPageEditor({ doc, onChange, readOnly, insertRef }: {
  doc: LetterDocument
  onChange: (next: LetterDocument) => void
  readOnly: boolean
  /**
   * Filled in with "drop this text where the caret is", so the merge-field buttons outside this
   * component can reach the caret inside it. Null while the sheet has not mounted.
   */
  insertRef?: { current: ((text: string) => void) | null }
}) {
  const sheet = useRef<HTMLDivElement>(null)
  /** Bumped to redraw the bar's pressed states as the caret moves. */
  const [, tick] = useState(0)

  /*
   * THE FIRM'S PAPER, not a blank rectangle. The margins are the letterhead's own — 37.5mm at the
   * top to clear the logo — so the text somebody types inside them is the text that prints inside
   * them. Falling back to plain A4 rather than refusing: a letter must stay editable on the day
   * somebody deletes the letterhead row, it just will not be showing the right paper.
   */
  const [fetched, setFetched] = useState<PageSetup | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const head = defaultOf(await fetchLetterheads())
        if (!cancelled && head) setFetched(head.page)
      } catch { /* the paper is decoration; the words are the letter. */ }
    })()
    return () => { cancelled = true }
  }, [])
  const sheetPage = fetched ?? A4_LETTERHEAD

  const saved = useRef<Range | null>(null)

  /*
   * THE HTML IS WRITTEN INTO THE PAGE ONLY WHEN THE DOCUMENT CAME FROM SOMEWHERE ELSE.
   *
   * React re-rendering a contenteditable under a cursor puts the caret back at the start on every
   * keystroke — the single most common way this component is got wrong, and invisible to anybody
   * who only clicks through a demo. The guard is the SERIALISED document rather than object
   * identity, because the one caller round-trips through serialiseLetter/parseLetter and hands
   * back a new object every render; identity would never match and the caret would jump for ever.
   */
  const emitted = useRef('')
  useEffect(() => {
    if (!sheet.current) return
    if (serialiseLetter(doc) === emitted.current) return
    sheet.current.innerHTML = letterToHtml(doc, { filled: false, values: {} })
    saved.current = null
  }, [doc])

  /*
   * WHERE THE CARET WAS. The two dropdowns in the bar take focus away from the sheet, and a
   * selection that has been dropped means "make THIS bold" arrives with nothing selected — the
   * command then either does nothing or, worse, applies to the whole paragraph. The icon buttons
   * hold the caret with preventDefault on mousedown; a native <select> cannot be held that way,
   * so the range is remembered and put back.
   */
  const remember = useCallback(() => {
    const s = window.getSelection()
    if (!s || s.rangeCount === 0 || !sheet.current) return
    const r = s.getRangeAt(0)
    /* Only when it is OURS. The bar's own boxes are selectable too, and remembering a caret in
       the running-foot field would put the next Bold somewhere nobody was looking. */
    if (sheet.current.contains(r.commonAncestorContainer)) saved.current = r.cloneRange()
  }, [])

  /*
   * THE SELECTION IS WATCHED, NOT SAMPLED ON KEYUP.
   *
   * The first cut of this remembered the caret from the sheet's own key and mouse events, and it
   * was wrong in both directions. A selection made any other way — dragged across a line and
   * released outside the sheet, set by the browser's own find, or chosen without a key or a
   * click — was never seen, so pressing Bold restored a STALE caret over a live selection and
   * quietly bolded nothing. And the bar's pressed states went with it: the caret would be inside
   * a heading with the Bold button still offering itself.
   *
   * selectionchange is the event that actually means "the selection moved", whoever moved it.
   */
  useEffect(() => {
    const onSelect = () => {
      const s = window.getSelection()
      if (!s || s.rangeCount === 0 || !sheet.current) return
      if (!sheet.current.contains(s.getRangeAt(0).commonAncestorContainer)) return
      remember()
      tick((n) => n + 1)
    }
    document.addEventListener('selectionchange', onSelect)
    return () => document.removeEventListener('selectionchange', onSelect)
  }, [remember])
  const restore = () => {
    const el = sheet.current
    if (!el) return
    el.focus()
    const s = window.getSelection()
    if (!s) return
    /* contains() is false for a range whose nodes were replaced by the effect above, which is
       exactly when falling through to the end of the letter is the right answer. */
    if (saved.current && el.contains(saved.current.commonAncestorContainer)) {
      s.removeAllRanges()
      s.addRange(saved.current)
      return
    }
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(false)
    s.removeAllRanges()
    s.addRange(r)
  }

  const read = useCallback(() => {
    if (!sheet.current) return
    const next = { ...doc, blocks: documentHtmlToBlocks(sheet.current.innerHTML) }
    emitted.current = serialiseLetter(next)
    onChange(next)
  }, [doc, onChange])

  /**
   * execCommand, which is deprecated and is still the only thing every browser implements for
   * "make this selection bold" and "turn this paragraph into a heading".
   *
   * It marks up the PAGE. The document comes from the parse in `read`, so the model never sees
   * whatever the browser chose to emit, and the day execCommand disappears this file changes and
   * the letters do not.
   */
  const run = (name: string, value?: string) => {
    if (readOnly || !sheet.current) return
    restore()
    document.execCommand(name, false, value)
    remember()
    read()
    tick((n) => n + 1)
  }

  /** Put an element where the caret is, then re-read. Used for the things execCommand cannot do. */
  const insert = (html: string) => {
    if (readOnly || !sheet.current) return
    restore()
    document.execCommand('insertHTML', false, html)
    remember()
    read()
    tick((n) => n + 1)
  }

  /*
   * THE HANDLE THE MERGE-FIELD BUTTONS REACH THROUGH. They live outside this component, beside
   * the other kinds of template, and the firm asked for both ways in: "you can type the merge
   * field or you can add the merge field." insertText rather than insertHTML, so a field name is
   * words on the page and cannot arrive carrying markup.
   */
  useEffect(() => {
    if (!insertRef) return
    insertRef.current = readOnly ? null : (text: string) => {
      if (!sheet.current) return
      restore()
      document.execCommand('insertText', false, text)
      remember()
      read()
    }
    return () => { insertRef.current = null }
  })

  return (
    <div className="space-y-3">
      <Toolbar readOnly={readOnly} run={run} insert={insert} doc={doc} onChange={onChange} />

      {/*
        THE SHEET. Scrollable, centred, on the grey of a desk so the paper reads as paper. At 1:1
        and never scaled: transform: scale() on a contenteditable moves the caret away from the
        pointer, because the browser hit-tests in unscaled coordinates. A preview may be
        photographed down (see LetterPage); a thing you type in may not.
      */}
      <div className="rounded-xl bg-slate-200/70 p-5 overflow-auto max-h-[calc(100vh-18rem)]">
        <div className="mx-auto shadow-lg" style={{ width: `${sheetPage.widthMm}mm` }}>
          <style>{letterCss(doc, sheetPage)}</style>
          <div className="ltr-page">
            <div
              ref={sheet}
              className="ltr-body outline-none"
              contentEditable={!readOnly}
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="The letter"
              data-letter-sheet
              onInput={() => { remember(); read() }}
              /*
               * PLAIN TEXT ON PASTE. documentHtmlToBlocks would survive the markup either way —
               * it drops what it does not recognise — but this keeps what is IN the page honest
               * too, so what somebody sees while typing is what they will get. A copy out of Word
               * arrives as words rather than as a stylesheet.
               */
              onPaste={(e) => {
                if (readOnly) return
                e.preventDefault()
                document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
                remember()
                read()
              }}
            />
            {/* Not editable: the running line is page furniture and is set in the bar above. */}
            <div contentEditable={false}
              dangerouslySetInnerHTML={{
                __html: runningFootHtml(doc, { filled: false, values: {}, page: 1, pages: 1 }),
              }} />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ the bar */

function Toolbar({ readOnly, run, insert, doc, onChange }: {
  readOnly: boolean
  run: (name: string, value?: string) => void
  insert: (html: string) => void
  doc: LetterDocument
  onChange: (next: LetterDocument) => void
}) {
  /** What the caret is sitting in, so the bar can show it pressed. */
  const on = (cmd: string) => {
    try { return document.queryCommandState(cmd) } catch { return false }
  }
  const block = (() => {
    try { return (document.queryCommandValue('formatBlock') || '').toLowerCase() } catch { return '' }
  })().replace(/[<>]/g, '')
  /*
   * BOLD IS REFUSED INSIDE A HEADING, and that is a correctness guard rather than tidiness.
   *
   * letterCss draws every heading at font-weight 700, so the browser reports the selection as
   * ALREADY BOLD and execCommand('bold') does the only thing left to it: takes the bold OFF,
   * emitting font-weight:normal. The model has no "not bold" for a heading, so the parse drops
   * it — and the writer is left looking at a word that went light on screen and will print bold.
   * Saying so is better than letting the page and the document disagree.
   */
  const inHeading = /^h[1-6]$/.test(block)

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 flex flex-wrap items-center gap-1.5">
      {/* ---------- what kind of thing this paragraph is ---------- */}
      <select className={sel} disabled={readOnly} value={block || 'p'}
        aria-label="Kind of paragraph"
        onChange={(e) => run('formatBlock', `<${e.target.value}>`)}>
        <option value="p">Body text</option>
        <option value="h1">Title</option>
        <option value="h2">Section</option>
        <option value="h3">Sub-heading</option>
      </select>

      <Sep />
      <Btn title={inHeading ? 'A heading is already bold' : 'Bold'} label="Bold"
        on={on('bold')} disabled={readOnly || inHeading}
        onClick={() => run('bold')}><Bold size={13} /></Btn>
      <Btn title="Italic" on={on('italic')} disabled={readOnly} onClick={() => run('italic')}><Italic size={13} /></Btn>
      <Btn title="Underline" on={on('underline')} disabled={readOnly} onClick={() => run('underline')}><Underline size={13} /></Btn>
      <input type="color" title="Colour of the selected words" aria-label="Colour of the selected words"
        defaultValue="#1f2937" disabled={readOnly}
        onChange={(e) => run('foreColor', e.target.value)}
        className="h-7 w-8 rounded border border-slate-200 bg-white p-0.5" />
      {/*
        POINTS, NOT execCommand's SEVEN SIZES. `fontSize` speaks in 1..7, which have nothing to do
        with points — the letter would store "size 4" and print at whatever that means. So the
        size is applied as a style the renderer and the PDF both already understand, through
        insertHTML rather than around the selection, so one code path owns putting markup on the
        page and the caret is put back the same way for every button in this bar.
      */}
      <select className={sel} disabled={readOnly} defaultValue="" aria-label="Size of the selected words"
        onChange={(e) => {
          const pt = e.target.value
          e.target.value = ''
          if (!pt) return
          const text = window.getSelection()?.toString() ?? ''
          if (!text) return
          insert(`<span style="font-size:${pt}pt">${escapeHtml(text)}</span>`)
        }}>
        <option value="">Size</option>
        {[8, 8.5, 9, 10, 10.5, 11, 12, 14, 18].map((n) => <option key={n} value={n}>{n} pt</option>)}
      </select>

      <Sep />
      <Btn title="Left" on={on('justifyLeft')} disabled={readOnly} onClick={() => run('justifyLeft')}><AlignLeft size={13} /></Btn>
      <Btn title="Centred" on={on('justifyCenter')} disabled={readOnly} onClick={() => run('justifyCenter')}><AlignCenter size={13} /></Btn>
      <Btn title="Right" on={on('justifyRight')} disabled={readOnly} onClick={() => run('justifyRight')}><AlignRight size={13} /></Btn>
      <Btn title="Justified" on={on('justifyFull')} disabled={readOnly} onClick={() => run('justifyFull')}><AlignJustify size={13} /></Btn>

      <Sep />
      <Btn title="Bullets" on={on('insertUnorderedList')} disabled={readOnly}
        onClick={() => run('insertUnorderedList')}><List size={13} /></Btn>
      <Btn title="Numbers" on={on('insertOrderedList')} disabled={readOnly}
        onClick={() => run('insertOrderedList')}><ListOrdered size={13} /></Btn>

      <Sep />
      {/*
        A TABLE IS INSERTED AS THE MARKUP THE RENDERER ALREADY DRAWS, so what lands on the page is
        the same shape documentHtmlToBlocks reads back. Building it any other way would mean two
        ideas of what a table is.
      */}
      <Btn title="Insert a table" disabled={readOnly} onClick={() => insert(blankTable())}>
        <TableIcon size={13} />
      </Btn>
      <Btn title="Insert a line to sign on" disabled={readOnly} onClick={() => insert(blankSignature())}>
        <PenLine size={13} />
      </Btn>
      <Btn title="Start a new page here" disabled={readOnly}
        onClick={() => insert('<div class="ltr-break"></div><p><br></p>')}>
        <SquareSplitVertical size={13} />
      </Btn>

      <Sep />
      {/* ---------- the page itself ---------- */}
      <select className={sel} disabled={readOnly} value={doc.defaults.font}
        title="The whole letter's typeface" aria-label="The whole letter's typeface"
        onChange={(e) => onChange({ ...doc, defaults: { ...doc.defaults, font: e.target.value } })}>
        {FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>
      <input type="number" step="0.5" min={6} max={24} className={`${sel} w-16`} disabled={readOnly}
        title="The whole letter's body size, in points" aria-label="The whole letter's body size"
        value={doc.defaults.size}
        onChange={(e) => onChange({ ...doc, defaults: { ...doc.defaults, size: Number(e.target.value) || 10.5 } })} />
      <select className={sel} disabled={readOnly} value={doc.defaults.lineHeight}
        title="Line spacing" aria-label="Line spacing"
        onChange={(e) => onChange({ ...doc, defaults: { ...doc.defaults, lineHeight: Number(e.target.value) } })}>
        {[1.15, 1.3, 1.45, 1.6, 2].map((n) => <option key={n} value={n}>{n === 2 ? 'Double' : n}</option>)}
      </select>

      {/*
        THE LINE AT THE FOOT OF EVERY PAGE. Set here rather than typed on the sheet, because it
        appears once in the document and many times on paper. {{page}} and {{pages}} are the
        printer's and are legal here and nowhere else.
      */}
      <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-400 ml-auto">
        Foot of each page
        <input className={`${sel} w-64 normal-case tracking-normal`} disabled={readOnly}
          value={doc.runningFoot ?? ''} placeholder="Nothing"
          onChange={(e) => onChange({ ...doc, runningFoot: e.target.value || undefined })} />
      </label>
    </div>
  )
}

/* ------------------------------------------------------------------ odds and ends */

/** For the one place a selection's own words are put back as markup. */
const escapeHtml = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const blankTable = () => (
  '<table class="ltr-t ltr-b-rows"><tbody>'
  + '<tr><td>&nbsp;</td><td>&nbsp;</td></tr>'
  + '<tr><td>&nbsp;</td><td>&nbsp;</td></tr>'
  + '</tbody></table><p><br></p>'
)

const blankSignature = () => (
  '<div class="ltr-sig"><div class="ltr-rule" style="width:70mm"></div>'
  + '<div>&nbsp;</div></div><p><br></p>'
)

const sel = 'rounded border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-700 outline-none focus:ring-2 focus:ring-gold-200 disabled:opacity-50'

const FONTS = [
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Calibri', value: 'Calibri, Candara, Segoe, Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
]

const Sep = () => <span className="w-px h-5 bg-slate-200 mx-0.5" />

function Btn({ title, label, on, disabled, onClick, children }: {
  title: string
  /** The name the button keeps whatever its tooltip is saying. Defaults to the tooltip. */
  label?: string
  on?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button type="button" title={title} aria-label={label ?? title} aria-pressed={on ?? undefined}
      disabled={disabled}
      /* The caret must not move when the bar is pressed, or "make THIS bold" has nothing selected
         by the time the command runs. */
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`p-1.5 rounded disabled:opacity-40 ${
        on ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-200'}`}>
      {children}
    </button>
  )
}
