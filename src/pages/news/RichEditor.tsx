import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlignCenter, AlignLeft, AlignRight, Bold, Eraser, Highlighter, ImagePlus, IndentDecrease, IndentIncrease, Italic, Link2, List,
  ListOrdered, Minus, PenLine, Redo2, Strikethrough, Underline, Undo2, UserRound,
} from 'lucide-react'
import { sanitiseCampaignHtml } from '../../lib/campaignHtml'

/**
 * THE OUTLOOK-STYLE EDITOR (S13, 29 Oct). Ryno: "a dummy screen of how it looks like in Outlook ... at the top
 * you have your ribbon and your formatting, your text and tools ... then you can import your own signatures."
 *
 * A contenteditable box under a ribbon of three tabs, as Outlook's: Message (the text), Insert (link, picture,
 * line, signature, a client's name) and Format (clear formatting). The browser does the editing; what it makes
 * is NEVER sent as it stands -- every change and every paste goes through sanitiseCampaignHtml, the closed set of
 * tags an email may carry, and the server runs the same function again when it sends.
 *
 * Fonts are the ones every inbox has. A font the reader's computer lacks is drawn as something else, so the
 * list is short on purpose; Georgia first, the firm's email face (CLAUDE.md: Charter asked for, Georgia drawn).
 */
const FONTS = [
  ['Georgia, serif', 'Georgia'], ['Arial, Helvetica, sans-serif', 'Arial'], ['Calibri, Arial, sans-serif', 'Calibri'],
  ['Verdana, Geneva, sans-serif', 'Verdana'], ['"Times New Roman", Times, serif', 'Times New Roman'], ['Tahoma, Geneva, sans-serif', 'Tahoma'],
] as const
/* execCommand's sizes 1-7, named as Outlook names them in points. */
const SIZES = [['2', '10'], ['3', '12'], ['4', '14'], ['5', '18'], ['6', '24'], ['7', '36']] as const
const COLOURS = ['#000000', '#1e3a5f', '#355069', '#c69f54', '#b91c1c', '#15803d', '#1d4ed8', '#6b7280']

type RibbonTab = 'message' | 'insert' | 'format'

export interface RichEditorProps {
  value: string
  onChange: (html: string) => void
  disabled?: boolean
  /** Upload a picture and give back its https address; absent, Picture asks for an address instead. */
  onPicture?: (file: File) => Promise<string>
  /** Offered on Insert. */
  fields?: { token: string; label: string }[]
  /** Inserted where the signature goes; the email fills it per sender. */
  minHeight?: string
  testid?: string
  /** Extra buttons on the right of the ribbon (Save as template, and the like). */
  ribbonRight?: ReactNode
  /** Between the ribbon and the body, as Outlook puts From, To and Subject. */
  header?: ReactNode
}

export function RichEditor({ value, onChange, disabled, onPicture, fields = [], minHeight = '22rem', testid = 'news-rich', ribbonRight, header }: RichEditorProps) {
  const box = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)
  /* What this box last reported, so an outside change (a template, a reload) redraws it and our own typing does not. */
  const last = useRef<string | null>(null)
  const [tab, setTab] = useState<RibbonTab>('message')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el || value === last.current) return
    el.innerHTML = sanitiseCampaignHtml(value)
    last.current = value
  }, [value])

  const emit = () => {
    const el = box.current
    if (!el) return
    const html = sanitiseCampaignHtml(el.innerHTML)
    last.current = html
    onChange(html)
  }
  const run = (cmd: string, arg?: string) => {
    if (disabled) return
    box.current?.focus()
    /* execCommand is old and still the one editing API every browser shares; its output is sanitised in emit. */
    document.execCommand('styleWithCSS', false, 'true')
    document.execCommand(cmd, false, arg)
    emit()
  }
  const insertHtml = (html: string) => run('insertHTML', sanitiseCampaignHtml(html))

  const link = () => {
    const url = window.prompt('Link to (https://…, or mailto:someone@…)', 'https://')
    if (!url || url === 'https://') return
    if (!/^(https?:\/\/|mailto:)/i.test(url.trim())) { setError('A link must start with https:// or mailto:'); return }
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) run('createLink', url.trim())
    else insertHtml(`<a href="${url.trim().replace(/"/g, '&quot;')}">${url.trim().replace(/</g, '&lt;')}</a>`)
  }
  const picture = async (f: File) => {
    setError(null)
    try {
      const url = await onPicture!(f)
      insertHtml(`<img src="${url}" alt="" style="max-width:100%;height:auto">`)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const pictureByAddress = () => {
    const url = window.prompt('The picture’s web address (https://…)', 'https://')
    if (!url || !/^https:\/\//.test(url.trim())) return
    insertHtml(`<img src="${url.trim().replace(/"/g, '&quot;')}" alt="" style="max-width:100%;height:auto">`)
  }

  const Btn = ({ on, title, children, active }: { on: () => void; title: string; children: ReactNode; active?: boolean }) => (
    <button type="button" title={title} aria-label={title} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={on}
      className={`h-8 min-w-8 px-1.5 grid place-items-center rounded-md text-slate-700 hover:bg-slate-200/70 disabled:opacity-40 ${active ? 'bg-slate-200' : ''}`}>
      {children}
    </button>
  )
  const Group = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="flex flex-col items-center px-2 border-r border-slate-200 last:border-r-0">
      <div className="flex flex-wrap items-center gap-0.5">{children}</div>
      <span className="text-[10px] text-slate-400 mt-0.5">{label}</span>
    </div>
  )

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden" data-testid={testid}>
      {/* THE RIBBON: tabs as Outlook has them, then the groups of the tab that is open. */}
      <div className="bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-1 px-2 pt-1.5">
          {([['message', 'Message'], ['insert', 'Insert'], ['format', 'Format text']] as [RibbonTab, string][]).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} data-testid={`${testid}-tab-${k}`}
              className={`px-3 py-1 text-xs font-medium rounded-t-md ${tab === k ? 'bg-white border border-b-white border-slate-200 text-brand-700 -mb-px' : 'text-slate-500 hover:text-slate-800'}`}>
              {label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1 pb-1">{ribbonRight}</div>
        </div>
        <div className="flex flex-wrap items-stretch gap-y-1 bg-white border-t border-slate-200 px-1 py-1.5" data-testid={`${testid}-ribbon`}>
          {tab === 'message' && (
            <>
              <Group label="Undo">
                <Btn title="Undo" on={() => run('undo')}><Undo2 size={15} /></Btn>
                <Btn title="Redo" on={() => run('redo')}><Redo2 size={15} /></Btn>
              </Group>
              <Group label="Basic text">
                <select title="Font" aria-label="Font" disabled={disabled} className="h-8 rounded-md border border-slate-200 bg-white text-xs px-1 w-28"
                  onChange={(e) => { run('fontName', e.target.value); e.target.selectedIndex = 0 }} defaultValue="">
                  <option value="" disabled>Font</option>
                  {FONTS.map(([v, l]) => <option key={l} value={v}>{l}</option>)}
                </select>
                <select title="Size" aria-label="Size" disabled={disabled} className="h-8 rounded-md border border-slate-200 bg-white text-xs px-1 w-16"
                  onChange={(e) => { run('fontSize', e.target.value); e.target.selectedIndex = 0 }} defaultValue="">
                  <option value="" disabled>Size</option>
                  {SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <Btn title="Bold" on={() => run('bold')}><Bold size={15} /></Btn>
                <Btn title="Italic" on={() => run('italic')}><Italic size={15} /></Btn>
                <Btn title="Underline" on={() => run('underline')}><Underline size={15} /></Btn>
                <Btn title="Strikethrough" on={() => run('strikeThrough')}><Strikethrough size={15} /></Btn>
                <span className="inline-flex items-center gap-0.5" title="Font colour">
                  {COLOURS.map((c) => (
                    <button key={c} type="button" aria-label={`Colour ${c}`} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => run('foreColor', c)}
                      className="h-4 w-4 rounded-sm border border-slate-300" style={{ background: c }} />
                  ))}
                </span>
                <Btn title="Highlight" on={() => run('hiliteColor', '#fff3a3')}><Highlighter size={15} /></Btn>
              </Group>
              <Group label="Paragraph">
                <Btn title="Bullets" on={() => run('insertUnorderedList')}><List size={15} /></Btn>
                <Btn title="Numbering" on={() => run('insertOrderedList')}><ListOrdered size={15} /></Btn>
                <Btn title="Decrease indent" on={() => run('outdent')}><IndentDecrease size={15} /></Btn>
                <Btn title="Increase indent" on={() => run('indent')}><IndentIncrease size={15} /></Btn>
                <Btn title="Align left" on={() => run('justifyLeft')}><AlignLeft size={15} /></Btn>
                <Btn title="Centre" on={() => run('justifyCenter')}><AlignCenter size={15} /></Btn>
                <Btn title="Align right" on={() => run('justifyRight')}><AlignRight size={15} /></Btn>
              </Group>
            </>
          )}
          {tab === 'insert' && (
            <>
              <Group label="Links">
                <Btn title="Link" on={link}><Link2 size={15} /><span className="sr-only">Link</span></Btn>
              </Group>
              <Group label="Pictures">
                <Btn title="Picture from this computer" on={() => (onPicture ? file.current?.click() : pictureByAddress())}><ImagePlus size={15} /></Btn>
                <button type="button" className="text-xs text-slate-600 hover:underline px-1" onClick={pictureByAddress} disabled={disabled}>From a web address</button>
                <input ref={file} type="file" accept="image/png,image/jpeg,image/gif" className="hidden" data-testid={`${testid}-picture`}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void picture(f) }} />
              </Group>
              <Group label="Layout">
                <Btn title="Horizontal line" on={() => insertHtml('<hr style="border:0;border-top:1px solid #d1d5db;margin:16px 0">')}><Minus size={15} /></Btn>
              </Group>
              {fields.length > 0 && (
                <Group label="Personalise">
                  {fields.map((f) => (
                    <button key={f.token} type="button" disabled={disabled} onMouseDown={(e) => e.preventDefault()} data-testid={`${testid}-field-${f.token}`}
                      onClick={() => run('insertText', `{{${f.token}}}`)}
                      className="h-8 px-2 inline-flex items-center gap-1 rounded-md text-xs text-slate-700 hover:bg-slate-200/70">
                      {f.token === 'signature' ? <PenLine size={14} /> : <UserRound size={14} />}{f.label}
                    </button>
                  ))}
                </Group>
              )}
            </>
          )}
          {tab === 'format' && (
            <Group label="Clean up">
              <Btn title="Clear formatting" on={() => run('removeFormat')}><Eraser size={15} /><span className="text-xs ml-1">Clear formatting</span></Btn>
            </Group>
          )}
        </div>
      </div>
      {header}
      <div ref={box} contentEditable={!disabled} suppressContentEditableWarning data-testid={`${testid}-body`}
        className="px-5 py-4 outline-none font-[Georgia,serif] text-[15px] leading-relaxed text-slate-900 [&_a]:text-blue-700 [&_a]:underline [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-3 [&_img]:inline-block"
        style={{ minHeight }}
        onInput={emit}
        onBlur={emit}
        onPaste={(e) => {
          /* A paste from Word or Outlook keeps its shape and loses its markup: the closed set, here as on send. */
          const html = e.clipboardData.getData('text/html')
          if (!html) return
          e.preventDefault()
          insertHtml(html)
        }} />
      {error && <p className="px-4 pb-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}
