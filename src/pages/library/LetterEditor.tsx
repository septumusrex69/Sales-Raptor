import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronDown, ChevronUp, Columns3,
  Italic, List, ListOrdered, Minus, Plus, Rows3, SquareSplitVertical, Trash2, Underline,
} from 'lucide-react'
import {
  BLOCK_KINDS, editableHtmlToSpans, spansToEditableHtml,
  type Align, type Block, type LetterDocument, type Span, type TableBlock,
} from '../../lib/letterDocument.ts'

/**
 * WRITING A LETTER.
 *
 * THE FIRM ASKED FOR WORD — "font size, colour of font, adding a type of a tables, like bullets
 * and numbering... spacing, font, yada, yada. It's basically recreating Word in Raptor." This is
 * that, bounded by one rule that Word itself does not have to care about: a section 129 is a
 * STATUTORY DEMAND, so what the debtor receives has to be exactly what somebody approved. A
 * defective notice is a defective demand and the credit provider cannot go to court on it.
 *
 * So the editor is Word-like where Word is right and deliberately not Word where Word would hurt:
 *
 *  - Selecting words and pressing bold, italic, underline, a colour or a size works as expected,
 *    through contenteditable. That is the part people mean.
 *  - What is STORED is never the browser's markup. Every box is read back through
 *    editableHtmlToSpans into the block model, so a paste from Word arrives as forty tags of
 *    Office markup and lands as bold, italic, underline and the words. See letterDocument.ts.
 *  - Blocks are added, moved and deleted as blocks — a paragraph, a list, a table — rather than
 *    by pressing Return in a stream of text. It is the thing that makes "what you see is what
 *    prints" hold, and it is also how a table stops being a table the moment somebody hits Return
 *    inside one in a free editor.
 *  - Section numbers are COUNTED, not typed, so inserting a section renumbers the rest.
 *
 * document.execCommand is deprecated and is still the only thing every browser implements for
 * "make the selection bold". The alternative is hand-writing selection surgery, which is more
 * code and more ways to lose a caret. It is used only to mark up the box; the model comes from
 * the parse afterwards, so the day it disappears this file changes and the documents do not.
 */
export function LetterEditor({ doc, onChange, readOnly }: {
  doc: LetterDocument
  onChange: (next: LetterDocument) => void
  readOnly: boolean
}) {
  const [selected, setSelected] = useState<number | null>(null)

  const setBlocks = (blocks: Block[]) => onChange({ ...doc, blocks })
  const setBlock = (i: number, b: Block) =>
    setBlocks(doc.blocks.map((old, j) => (j === i ? b : old)))

  function addBlock(kind: Block['kind'], at: number) {
    const fresh = newBlock(kind)
    const blocks = [...doc.blocks]
    blocks.splice(at, 0, fresh)
    setBlocks(blocks)
    setSelected(at)
  }

  function move(i: number, by: -1 | 1) {
    const to = i + by
    if (to < 0 || to >= doc.blocks.length) return
    const blocks = [...doc.blocks]
    ;[blocks[i], blocks[to]] = [blocks[to], blocks[i]]
    setBlocks(blocks)
    setSelected(to)
  }

  return (
    <div className="space-y-3">
      {/* ---------- the page itself ---------- */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 flex flex-wrap items-end gap-3">
        <Field label="Font">
          <select className={sel} disabled={readOnly} value={doc.defaults.font}
            onChange={(e) => onChange({ ...doc, defaults: { ...doc.defaults, font: e.target.value } })}>
            {FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </Field>
        <Field label="Size">
          <input type="number" step="0.5" min={6} max={24} className={`${sel} w-20`} disabled={readOnly}
            value={doc.defaults.size}
            onChange={(e) => onChange({ ...doc, defaults: { ...doc.defaults, size: Number(e.target.value) || 10.5 } })} />
        </Field>
        <Field label="Line spacing">
          <select className={sel} disabled={readOnly} value={doc.defaults.lineHeight}
            onChange={(e) => onChange({ ...doc, defaults: { ...doc.defaults, lineHeight: Number(e.target.value) } })}>
            {[1.15, 1.3, 1.45, 1.6, 2].map((n) => <option key={n} value={n}>{n === 2 ? 'Double' : n}</option>)}
          </select>
        </Field>
        <Field label="Text colour">
          <input type="color" className="h-8 w-12 rounded border border-slate-200 bg-white p-0.5"
            disabled={readOnly} value={doc.defaults.colour}
            onChange={(e) => onChange({ ...doc, defaults: { ...doc.defaults, colour: e.target.value } })} />
        </Field>
        {/*
          THE LINE THAT REPEATS ON EVERY PAGE. {{page}} and {{pages}} are the printer's, not the
          account's — nothing but a printer knows them — so they are legal here and refused in the
          body, where a paragraph cannot know which page it landed on.
        */}
        <Field label="Running header — {{page}} and {{pages}} allowed here only">
          <input className={`${sel} w-[22rem]`} disabled={readOnly} value={doc.runningHeader ?? ''}
            placeholder="Nothing repeated at the top of each page"
            onChange={(e) => onChange({ ...doc, runningHeader: e.target.value || undefined })} />
        </Field>
      </div>

      {/* ---------- the blocks ---------- */}
      {doc.blocks.map((block, i) => (
        <BlockCard key={i} block={block} index={i} selected={selected === i} readOnly={readOnly}
          onSelect={() => setSelected(i)}
          onChange={(b) => setBlock(i, b)}
          onMove={(by) => move(i, by)}
          onDelete={() => {
            setBlocks(doc.blocks.filter((_, j) => j !== i))
            setSelected(null)
          }}
          onAddAfter={(kind) => addBlock(kind, i + 1)} />
      ))}

      {!readOnly && (
        <div className="rounded-lg border border-dashed border-slate-300 px-3 py-2.5">
          <AddRow label="Add to the end" onAdd={(k) => addBlock(k, doc.blocks.length)} />
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ one block */

function BlockCard({ block, index, selected, readOnly, onSelect, onChange, onMove, onDelete, onAddAfter }: {
  block: Block
  index: number
  selected: boolean
  readOnly: boolean
  onSelect: () => void
  onChange: (b: Block) => void
  onMove: (by: -1 | 1) => void
  onDelete: () => void
  onAddAfter: (kind: Block['kind']) => void
}) {
  return (
    <div onFocus={onSelect} onClick={onSelect}
      className={`rounded-lg border bg-white transition ${
        selected ? 'border-gold-400 ring-2 ring-gold-100' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 border-b border-slate-100">
        <span className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mr-1">
          {BLOCK_KINDS[block.kind].label}
        </span>
        {!readOnly && <BlockControls block={block} onChange={onChange} />}
        <span className="ml-auto flex items-center gap-0.5">
          {!readOnly && (
            <>
              <IconBtn title="Move up" onClick={() => onMove(-1)}><ChevronUp size={13} /></IconBtn>
              <IconBtn title="Move down" onClick={() => onMove(1)}><ChevronDown size={13} /></IconBtn>
              <IconBtn title="Delete this block" onClick={onDelete} danger><Trash2 size={13} /></IconBtn>
            </>
          )}
        </span>
      </div>

      <div className="px-3 py-2.5">
        <BlockBody block={block} onChange={onChange} readOnly={readOnly} index={index} />
      </div>

      {!readOnly && (
        <div className="px-2.5 pb-2">
          <AddRow label="Add below" onAdd={onAddAfter} />
        </div>
      )}
    </div>
  )
}

/** The controls that belong to this KIND of block, and to no other. */
function BlockControls({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  if (block.kind === 'spacer') {
    return (
      <label className="text-[11px] text-slate-500 inline-flex items-center gap-1.5">
        <input type="number" min={1} max={100} className={`${sel} w-16 py-0.5`} value={block.mm}
          onChange={(e) => onChange({ ...block, mm: Number(e.target.value) || 1 })} />
        mm
      </label>
    )
  }
  if (block.kind === 'pagebreak') {
    return <span className="text-[11px] text-slate-400">Everything after this starts a new page.</span>
  }
  if (block.kind === 'list') {
    return (
      <>
        <Toggle on={!block.ordered} title="Bullets"
          onClick={() => onChange({ ...block, ordered: false })}><List size={13} /></Toggle>
        <Toggle on={block.ordered} title="Numbers"
          onClick={() => onChange({ ...block, ordered: true })}><ListOrdered size={13} /></Toggle>
        <IconBtn title="Add an item"
          onClick={() => onChange({ ...block, items: [...block.items, [{ text: '' }]] })}>
          <Plus size={13} />
        </IconBtn>
      </>
    )
  }
  if (block.kind === 'table') return <TableControls block={block} onChange={onChange} />
  return (
    <>
      {block.kind === 'heading' && (
        <>
          <select className={`${sel} py-0.5 text-[11px]`} value={block.level}
            onChange={(e) => onChange({ ...block, level: Number(e.target.value) as 1 | 2 | 3 })}>
            <option value={1}>Title</option>
            <option value={2}>Section</option>
            <option value={3}>Sub-heading</option>
          </select>
          {/*
            NUMBERED IS A SWITCH, NOT A TYPED DIGIT. The section 129 runs 1, 2, 3, then an
            unnumbered heading, then 4 — and a fifth section inserted into typed numbering is four
            silent renumberings nobody makes.
          */}
          <label className="text-[11px] text-slate-500 inline-flex items-center gap-1 ml-0.5">
            <input type="checkbox" checked={block.numbered ?? false}
              onChange={(e) => onChange({ ...block, numbered: e.target.checked || undefined })} />
            Numbered
          </label>
        </>
      )}
      <AlignControls value={'align' in block ? block.align : undefined}
        onChange={(align) => onChange({ ...block, align } as Block)} />
    </>
  )
}

function TableControls({ block, onChange }: { block: TableBlock; onChange: (b: Block) => void }) {
  const cols = block.rows[0]?.length ?? 0
  const addRow = () => onChange({
    ...block,
    rows: [...block.rows, Array.from({ length: cols }, () => ({ spans: [{ text: '' }] }))],
  })
  /* A column is added to EVERY row at once. A table with rows of different lengths renders as a
     page that looks fine and is missing a cell, which letterProblems refuses for that reason. */
  const addCol = () => onChange({
    ...block,
    rows: block.rows.map((r) => [...r, { spans: [{ text: '' }] }]),
    widths: undefined,
  })
  return (
    <>
      <IconBtn title="Add a row" onClick={addRow}><Rows3 size={13} /></IconBtn>
      <IconBtn title="Add a column" onClick={addCol}><Columns3 size={13} /></IconBtn>
      <select className={`${sel} py-0.5 text-[11px]`} value={block.borders ?? 'none'}
        onChange={(e) => onChange({ ...block, borders: e.target.value as TableBlock['borders'] })}>
        <option value="none">No lines</option>
        <option value="rows">Lines between rows</option>
        <option value="all">Full grid</option>
      </select>
      <label className="text-[11px] text-slate-500 inline-flex items-center gap-1">
        <input type="checkbox" checked={block.headerRow ?? false}
          onChange={(e) => onChange({ ...block, headerRow: e.target.checked || undefined })} />
        Heading row
      </label>
    </>
  )
}

function AlignControls({ value, onChange }: { value?: Align; onChange: (a: Align | undefined) => void }) {
  const opts: [Align, React.ReactNode, string][] = [
    ['left', <AlignLeft size={13} />, 'Left'],
    ['center', <AlignCenter size={13} />, 'Centred'],
    ['right', <AlignRight size={13} />, 'Right'],
    ['justify', <AlignJustify size={13} />, 'Justified'],
  ]
  return (
    <>
      {opts.map(([a, icon, title]) => (
        <Toggle key={a} on={(value ?? 'left') === a} title={title}
          onClick={() => onChange(a === 'left' ? undefined : a)}>{icon}</Toggle>
      ))}
    </>
  )
}

function BlockBody({ block, onChange, readOnly }: {
  block: Block
  index: number
  onChange: (b: Block) => void
  readOnly: boolean
}) {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      return (
        <RichText spans={block.spans} readOnly={readOnly}
          heading={block.kind === 'heading'}
          onChange={(spans) => onChange({ ...block, spans })} />
      )
    case 'list':
      return (
        <div className="space-y-1.5">
          {block.items.map((item, k) => (
            <div key={k} className="flex items-start gap-2">
              <span className="text-slate-300 text-xs pt-1.5 w-4 shrink-0 text-right">
                {block.ordered ? `${k + 1}.` : '•'}
              </span>
              <div className="flex-1 min-w-0">
                <RichText spans={item} readOnly={readOnly}
                  onChange={(spans) => onChange({
                    ...block, items: block.items.map((old, j) => (j === k ? spans : old)),
                  })} />
              </div>
              {!readOnly && (
                <IconBtn title="Remove this item"
                  onClick={() => onChange({ ...block, items: block.items.filter((_, j) => j !== k) })}>
                  <Minus size={12} />
                </IconBtn>
              )}
            </div>
          ))}
        </div>
      )
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border border-slate-200 align-top p-1">
                      <RichText spans={cell.spans} readOnly={readOnly}
                        heading={block.headerRow === true && r === 0}
                        onChange={(spans) => onChange({
                          ...block,
                          rows: block.rows.map((rr, ri) => (ri !== r ? rr
                            : rr.map((cc, ci) => (ci === c ? { ...cc, spans } : cc)))),
                        })} />
                    </td>
                  ))}
                  {!readOnly && (
                    <td className="w-7 align-middle">
                      <IconBtn title="Remove this row"
                        onClick={() => onChange({ ...block, rows: block.rows.filter((_, ri) => ri !== r) })}>
                        <Minus size={12} />
                      </IconBtn>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'spacer':
      return <div className="text-[11px] text-slate-400">{block.mm} mm of space.</div>
    case 'pagebreak':
      return (
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <SquareSplitVertical size={13} /> A new page starts here.
        </div>
      )
  }
}

/* ------------------------------------------------------------------ the editable box */

/**
 * One run of text, edited the way people expect and stored the way the printer needs.
 *
 * THE INNER HTML IS SET ONCE PER BLOCK AND NEVER WHILE FOCUSED. React re-rendering a
 * contenteditable under a cursor puts the caret back at the start on every keystroke, which is
 * the single most common way this component is got wrong — and it is only noticeable to somebody
 * typing a sentence, never to somebody clicking through a demo.
 */
function RichText({ spans, onChange, readOnly, heading }: {
  spans: Span[]
  onChange: (spans: Span[]) => void
  readOnly: boolean
  /**
   * A heading or a heading cell, drawn a little larger.
   *
   * NOT DRAWN BOLD, AND THAT IS NOT A COSMETIC CHOICE. It was, and the Bold button then did
   * nothing at all on a heading: the box was styled font-semibold, so Chromium read the selection
   * as ALREADY BOLD and execCommand toggled it off, emitting `font-weight: normal` — which is not
   * a mark this model carries, so it was parsed away and the press vanished. The heading's weight
   * is a property of how it PRINTS (letterCss sets it), not of the marks on its words, and
   * showing it here was a lie the toolbar then believed.
   */
  heading?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const focused = useRef(false)
  const [, force] = useState(0)

  useEffect(() => {
    if (!ref.current || focused.current) return
    const html = spansToEditableHtml(spans)
    if (ref.current.innerHTML !== html) ref.current.innerHTML = html
  }, [spans])

  const read = useCallback(() => {
    if (!ref.current) return
    onChange(editableHtmlToSpans(ref.current.innerHTML))
  }, [onChange])

  /**
   * Bold, italic and underline over the current selection.
   *
   * execCommand is deprecated and is still the only thing every browser implements for this. It
   * marks up the BOX; the document comes from the parse in `read`, so the model never sees
   * whatever the browser chose to emit.
   */
  const command = (name: string, value?: string) => {
    if (readOnly || !ref.current) return
    ref.current.focus()
    document.execCommand(name, false, value)
    read()
    force((n) => n + 1)
  }

  return (
    <div>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-0.5 mb-1 opacity-60 hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <IconBtn title="Bold" onClick={() => command('bold')}><Bold size={12} /></IconBtn>
          <IconBtn title="Italic" onClick={() => command('italic')}><Italic size={12} /></IconBtn>
          <IconBtn title="Underline" onClick={() => command('underline')}><Underline size={12} /></IconBtn>
          {/* Applied to the SELECTION, which is what makes "a number in red" possible without
              making the whole paragraph red. */}
          <input type="color" title="Colour of the selected words" defaultValue="#1f2937"
            onChange={(e) => command('foreColor', e.target.value)}
            className="h-5 w-6 rounded border border-slate-200 bg-white p-0.5 ml-0.5" />
          <select title="Size of the selected words" defaultValue=""
            onChange={(e) => { if (e.target.value) sizeSelection(ref.current, Number(e.target.value), read) }}
            className="text-[10px] rounded border border-slate-200 bg-white px-1 py-0.5 text-slate-500">
            <option value="">Size</option>
            {[8, 8.5, 9, 10, 10.5, 11, 12, 14, 18].map((n) => <option key={n} value={n}>{n} pt</option>)}
          </select>
        </div>
      )}
      <div
        ref={ref}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        onFocus={() => { focused.current = true }}
        onBlur={() => { focused.current = false; read() }}
        onInput={read}
        /* Plain text on paste, so a copy out of Word arrives as words rather than as a stylesheet.
           editableHtmlToSpans would survive the markup either way; this keeps what is IN the box
           honest too, so what somebody sees while typing is what they will get. */
        onPaste={(e) => {
          if (readOnly) return
          e.preventDefault()
          const text = e.clipboardData.getData('text/plain')
          document.execCommand('insertText', false, text)
          read()
        }}
        className={`min-h-[1.6rem] rounded px-2 py-1 text-[13px] leading-relaxed outline-none
          ${readOnly ? 'bg-transparent' : 'bg-slate-50 focus:bg-white focus:ring-2 focus:ring-gold-200'}
          ${heading ? 'text-[14px] tracking-wide' : ''}`}
      />
    </div>
  )
}

/**
 * Wrap the selection in a span at a given point size.
 *
 * execCommand('fontSize') only speaks in the seven HTML font sizes, which have nothing to do with
 * points — so the letter would store "size 4" and print at whatever that means. This writes the
 * point size the model actually carries.
 */
function sizeSelection(box: HTMLDivElement | null, pt: number, read: () => void) {
  const sel = window.getSelection()
  if (!box || !sel || sel.rangeCount === 0 || sel.isCollapsed) return
  const range = sel.getRangeAt(0)
  if (!box.contains(range.commonAncestorContainer)) return
  const span = document.createElement('span')
  span.style.fontSize = `${pt}pt`
  try { range.surroundContents(span) } catch {
    /* surroundContents refuses a selection that crosses a tag boundary. Extracting and
       re-inserting handles that case, and is only reached when it has to be. */
    const contents = range.extractContents()
    span.appendChild(contents)
    range.insertNode(span)
  }
  sel.removeAllRanges()
  read()
}

/* ------------------------------------------------------------------ small parts */

const sel = 'rounded border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-700 outline-none focus:ring-2 focus:ring-gold-200'

const FONTS = [
  { label: 'Georgia (serif)', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Calibri', value: 'Calibri, Candara, Segoe, Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
]

function newBlock(kind: Block['kind']): Block {
  switch (kind) {
    case 'heading': return { kind, level: 2, spans: [{ text: 'New section' }], numbered: true }
    case 'list': return { kind, ordered: false, items: [[{ text: '' }]] }
    case 'table': return {
      kind,
      rows: [
        [{ spans: [{ text: '' }] }, { spans: [{ text: '' }] }],
        [{ spans: [{ text: '' }] }, { spans: [{ text: '' }] }],
      ],
      borders: 'rows',
    }
    case 'spacer': return { kind, mm: 6 }
    case 'pagebreak': return { kind }
    default: return { kind: 'paragraph', spans: [{ text: '' }] }
  }
}

function AddRow({ label, onAdd }: { label: string; onAdd: (k: Block['kind']) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
      {(Object.keys(BLOCK_KINDS) as Block['kind'][]).map((k) => (
        <button key={k} type="button" onClick={() => onAdd(k)} title={BLOCK_KINDS[k].hint}
          className="text-[11px] px-2 py-0.5 rounded border border-slate-200 text-slate-600
            hover:border-[#c9a052] hover:bg-gold-50">
          {BLOCK_KINDS[k].label}
        </button>
      ))}
    </div>
  )
}

function IconBtn({ title, onClick, children, danger }: {
  title: string; onClick: () => void; children: React.ReactNode; danger?: boolean
}) {
  return (
    <button type="button" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`p-1 rounded hover:bg-slate-100 ${danger ? 'text-negative-500 hover:bg-negative-50' : 'text-slate-500'}`}>
      {children}
    </button>
  )
}

function Toggle({ on, title, onClick, children }: {
  on: boolean; title: string; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button type="button" title={title} aria-label={title} aria-pressed={on}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={`p-1 rounded ${on ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
      {children}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wide text-slate-400 mb-1">{label}</span>
      {children}
    </label>
  )
}
