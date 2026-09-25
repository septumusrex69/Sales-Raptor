/**
 * A LETTER, AS DATA.
 *
 * WHY NOT HTML, AND WHY NOT WORD. The firm asked for "basically recreating Word in Raptor", and
 * the honest answer is that a word processor is the wrong target for this in one specific way
 * that matters more than all the others put together: a section 129 notice is a STATUTORY DEMAND.
 * What the debtor receives has to be exactly what somebody approved, and a defective notice is a
 * defective demand — the credit provider cannot go to court on it. So the one thing this model
 * refuses to do is let the editor and the printed page disagree.
 *
 * That rules out free-form contenteditable HTML, which is what "a Word clone" usually becomes:
 * the browser will happily produce markup no renderer can be held to, and a merge field cut in
 * half by a stray <span> renders as braces on the firm's letterhead. So the document is a closed
 * list of blocks with a closed list of marks, and ONE renderer — letterToHtml below — draws it
 * for the screen, for print and for whatever eventually posts it. There is no second
 * implementation to drift.
 *
 * WHAT IT DOES CARRY, because the firm's own notice needs every one of them: headings with
 * automatic numbering, paragraphs, bulleted and numbered lists, tables (three of them in the
 * section 129 — the reference block, the legal-process table and the banking details), bold,
 * italic, underline, colour, size, alignment, spacing, and page breaks. What it deliberately does
 * NOT carry: floating images, columns, text boxes, styles galleries. None of those appear in a
 * demand letter, and each one is a way for the page to render differently somewhere else.
 *
 * MERGE FIELDS ARE PLAIN TEXT INSIDE A SPAN, resolved by renderTemplate from messageTemplates.ts
 * — the same closed vocabulary the SMS and email templates use. A letter that invented its own
 * field names would be a second thing to keep in step with the resolver.
 */
import { renderTemplate, spanWithoutOptional, unknownFields, type TemplateScope } from './messageTemplates.js'
import { CHARTER_STACK } from './charter.js'

/* ------------------------------------------------------------------ inline */

/**
 * A run of text with the marks that apply to it.
 *
 * Marks are optional and absent rather than false, so a plain sentence is `{ text }` and the
 * stored JSON of a long letter stays readable in a diff. Somebody WILL read that diff the day a
 * notice goes out wrong.
 */
export interface Span {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  /** A hex colour. Null or absent means the document's own colour. */
  colour?: string
  /** Points. Absent means the document's body size. */
  size?: number
}

export type Align = 'left' | 'center' | 'right' | 'justify'

/** Millimetres of space above and below a block. The firm's typography is in mm, not in "lines". */
export interface Spacing {
  before?: number
  after?: number
}

/* ------------------------------------------------------------------ blocks */

export interface HeadingBlock {
  kind: 'heading'
  /** 1 is the notice's own title; 2 is a numbered section; 3 is a run-in sub-heading. */
  level: 1 | 2 | 3
  spans: Span[]
  align?: Align
  spacing?: Spacing
  /**
   * Whether this heading takes the next number in the sequence.
   *
   * AUTOMATIC, NOT TYPED. The section 129 runs 1 YOUR DEFAULT, 2 YOUR RIGHTS, 3 HOW TO RESOLVE
   * THIS, 4 HOW TO PAY — and a fifth section inserted in the middle of a typed sequence is four
   * silent renumberings nobody makes. An unnumbered heading in between (the legal-process one)
   * simply does not take a number and does not consume one.
   */
  numbered?: boolean
}

export interface ParagraphBlock {
  kind: 'paragraph'
  spans: Span[]
  align?: Align
  spacing?: Spacing
  /**
   * Do not leave this paragraph at the foot of a page with what follows it overleaf.
   *
   * "Yours faithfully" is the reason it exists: it landed at the bottom of page two with the
   * signature on page three, which reads as a letter that ends without being signed. The firm
   * found the same fault one block earlier, on a heading — headings keep with what follows them
   * always, because a heading alone at the foot of a page tells the reader there is nothing
   * under it. A paragraph only does so when it is asked to.
   */
  keepWithNext?: boolean
}

export interface ListBlock {
  kind: 'list'
  ordered: boolean
  /** Each item is its own run of spans, so a single word inside a bullet can be bold. */
  items: Span[][]
  spacing?: Spacing
}

export interface TableCell {
  spans: Span[]
  align?: Align
}

export interface TableBlock {
  kind: 'table'
  rows: TableCell[][]
  /**
   * Column widths as percentages, or absent for equal columns.
   *
   * Percentages rather than millimetres: the same table is drawn on screen at whatever width the
   * pane happens to be and on paper at the letterhead's text width, and a table fixed in mm on
   * screen is a table that is wrong on one of the two.
   */
  widths?: number[]
  /** The first row is a heading row. */
  headerRow?: boolean
  /**
   * How much of a grid to draw. The section 129 uses all three: `none` for the date/reference
   * strip at the top, `rows` for the banking details, `all` for the legal-process table.
   */
  borders?: 'none' | 'rows' | 'all'
  spacing?: Spacing
}

/** Vertical air, in millimetres, where spacing on a block is not the honest way to say it. */
export interface SpacerBlock {
  kind: 'spacer'
  mm: number
}

/**
 * A ruled line to sign on, with what goes under it.
 *
 * At the firm's request: "signature has a small line in it, so you can like put a line in there."
 * Its own block rather than an underscored paragraph, because a row of underscores is a row of
 * characters that wraps, breaks across a page and prints at whatever width the font happens to
 * give it.
 */
export interface SignatureBlock {
  kind: 'signature'
  /** How wide the rule is, in millimetres. */
  widthMm?: number
  /** The lines under it: the name, the title, who they sign for. */
  spans: Span[]
  spacing?: Spacing
}

/** A hard page break. The section 129 does not force one; a two-page annexure would. */
export interface PageBreakBlock {
  kind: 'pagebreak'
}

export type Block =
  | HeadingBlock | ParagraphBlock | ListBlock | TableBlock | SpacerBlock | SignatureBlock
  | PageBreakBlock

export const BLOCK_KINDS: Record<Block['kind'], { label: string; hint: string }> = {
  heading: { label: 'Heading', hint: 'A section title, numbered or not' },
  paragraph: { label: 'Paragraph', hint: 'Ordinary text' },
  list: { label: 'List', hint: 'Bullets or numbers' },
  table: { label: 'Table', hint: 'Rows and columns' },
  spacer: { label: 'Space', hint: 'A gap, in millimetres' },
  signature: { label: 'Signature line', hint: 'A ruled line to sign above' },
  pagebreak: { label: 'Page break', hint: 'Start a new page here' },
}

/* ------------------------------------------------------------------ the document */

export interface LetterDocument {
  /**
   * What everything inherits unless it says otherwise.
   *
   * ONE PLACE, so that "make the whole letter a point smaller to fit" is one change rather than
   * two hundred. A span that sets its own size is an exception and reads as one.
   */
  defaults: {
    /** A CSS family list. Kept as the firm's own stack rather than a single name. */
    font: string
    /** Points. */
    size: number
    colour: string
    /** A multiple of the font size, as CSS line-height. */
    lineHeight: number
  }
  /**
   * The line that repeats at the FOOT of every page: "Section 129 notice · Ref ... · Page 1 of 2".
   *
   * AT THE BOTTOM, at the firm's instruction — "you can put that at the bottom like somewhere on
   * every page". It was at the top, where it competed with the letterhead's own logo for the eye
   * and pushed the date block down.
   *
   * NOT A BLOCK, because it is page furniture rather than content — it appears once in the
   * document and many times on paper, and a block that multiplied itself would have to know how
   * the text broke. `{{page}}` and `{{pages}}` are filled by the renderer, not by the merge
   * vocabulary, because nothing but a printer knows them.
   */
  runningFoot?: string
  blocks: Block[]
}

/** The A4 page and the letterhead's text frame, in millimetres. */
export interface PageSetup {
  widthMm: number
  heightMm: number
  marginTopMm: number
  marginRightMm: number
  marginBottomMm: number
  marginLeftMm: number
  /** The letterhead drawn behind the text, as a URL. Null prints on plain paper. */
  backgroundUrl?: string | null
}

/**
 * A4 with the firm's own letterhead frame.
 *
 * MEASURED FROM BF_Letterhead_Aug_2026, not guessed: its page setup is 37.5mm top and 20mm on the
 * other three. The bottom is the one number changed, to 24mm, because the letterhead's footer
 * block — the phone number, the email, the company and VAT numbers — starts at 279.8mm, so a 20mm
 * bottom margin lets body text run about three millimetres into it. That is invisible until the
 * day a paragraph happens to reach the bottom of the page, which on a two-page notice is often.
 */
export const A4_LETTERHEAD: PageSetup = {
  widthMm: 210,
  heightMm: 297,
  marginTopMm: 37.5,
  marginRightMm: 20,
  marginBottomMm: 24,
  marginLeftMm: 20,
  backgroundUrl: null,
}

/*
 * A NEW LETTER IS IN CHARTER. The firm asked for it by name off their own section 129 ("I think
 * we should use this font in our writing"), and it is the one face in the picker that prints as
 * itself rather than being drawn by the nearest of the fourteen standard PDF faces.
 *
 * LETTERS ALREADY WRITTEN KEEP THE FACE THEY WERE WRITTEN IN. The font is stored on the document,
 * so this changes nothing that exists -- a template is re-set in Charter by choosing it in the
 * editor, which is a decision about a notice the firm has approved and not one to sweep.
 */
export function blankLetter(): LetterDocument {
  return {
    defaults: { font: CHARTER_STACK, size: 10.5, colour: '#1f2937', lineHeight: 1.45 },
    blocks: [{ kind: 'paragraph', spans: [{ text: '' }] }],
  }
}

/* ------------------------------------------------------------------ reading it back */

/**
 * Parse a stored letter, or null if this is not one.
 *
 * NULL RATHER THAN A THROW, and rather than a half-built document. message_templates.body holds
 * plain text for an SMS and a JSON document for a letter, and the one thing that must not happen
 * is a letter opening as an empty editor that somebody then saves over the top of. The caller
 * shows the raw text instead and says it could not be read.
 */
export function parseLetter(body: string): LetterDocument | null {
  let raw: unknown
  try { raw = JSON.parse(body) } catch { return null }
  if (!raw || typeof raw !== 'object') return null
  const doc = raw as Partial<LetterDocument>
  if (!Array.isArray(doc.blocks)) return null
  if (!doc.defaults || typeof doc.defaults !== 'object') return null
  /* A document written before the running line moved to the foot carries it under the old key.
     Accepted and renamed rather than dropped -- losing a page's reference line silently is worse
     than carrying one legacy name. */
  const legacy = (raw as { runningHeader?: string }).runningHeader
  if (legacy && !doc.runningFoot) doc.runningFoot = legacy
  /* Every block has to be a kind we can draw. One unknown block is a letter with a hole in it,
     and a hole in a statutory notice is not something to render around quietly. */
  for (const b of doc.blocks) {
    if (!b || typeof b !== 'object' || !(String((b as Block).kind) in BLOCK_KINDS)) return null
  }
  return doc as LetterDocument
}

export const serialiseLetter = (doc: LetterDocument): string => JSON.stringify(doc)

/**
 * The two fields only a printer can answer.
 *
 * `{{page}}` and `{{pages}}` are filled when the letter is laid out on paper, not from the
 * account, so they are not in the merge vocabulary and must not be checked against it. They are
 * legal in the running header and NOWHERE ELSE: a paragraph in the body cannot know which page it
 * landed on, and one that asks would be a template that is correct in the editor and wrong on the
 * second page.
 */
export const PRINTER_FIELDS = ['page', 'pages'] as const

/** Every piece of text in the BODY, in order. The running header is checked separately. */
export function lettersText(doc: LetterDocument): string {
  const out: string[] = []
  for (const b of doc.blocks) {
    if (b.kind === 'heading' || b.kind === 'paragraph') out.push(spansText(b.spans))
    else if (b.kind === 'list') for (const item of b.items) out.push(spansText(item))
    else if (b.kind === 'signature') out.push(spansText(b.spans))
    else if (b.kind === 'table') for (const row of b.rows) for (const c of row) out.push(spansText(c.spans))
  }
  return out.join('\n')
}

const spansText = (spans: Span[]): string => spans.map((s) => s.text).join('')

/* ------------------------------------------------------------------ what is wrong with it */

export interface LetterProblem {
  level: 'refuse' | 'warn'
  message: string
  /** Which block, where the problem belongs to one. */
  index?: number
}

/**
 * What stands between this letter and being used.
 *
 * REFUSE vs WARN, and the line between them is whether the debtor would receive something wrong.
 * An empty paragraph is untidy and is nobody's business but the writer's. A merge field nothing
 * can fill posts "{{balance}}" to a debtor on the firm's letterhead, over a director's name, and
 * that is a refusal.
 */
export function letterProblems(doc: LetterDocument, scope: TemplateScope): LetterProblem[] {
  const out: LetterProblem[] = []
  /* The header may use the printer's two fields; the body may not. Subtracted from the header's
     unknowns rather than added to the vocabulary, so a paragraph asking for {{page}} is still
     caught -- which is the fault worth catching, because it renders in the editor and is wrong on
     paper. */
  const headerUnknown = unknownFields(scope, doc.runningFoot ?? '', null)
    .filter((f) => !(PRINTER_FIELDS as readonly string[]).includes(f))
  const unknown = [...new Set([...unknownFields(scope, lettersText(doc), null), ...headerUnknown])]
  if (unknown.length > 0) {
    out.push({
      level: 'refuse',
      message: unknown.length === 1
        ? `${unknown[0]} is not a field on this side, so it would be posted with the braces still in it.`
        : `${unknown.join(', ')} are not fields on this side, so they would be posted with the braces still in them.`,
    })
  }
  if (doc.blocks.length === 0) out.push({ level: 'refuse', message: 'The letter has nothing in it.' })
  doc.blocks.forEach((b, i) => {
    if (b.kind === 'table') {
      /* A ragged table is the one structural fault that renders as a page that looks fine and is
         missing a cell. Checked here rather than patched in the renderer, which would hide it. */
      const width = b.rows[0]?.length ?? 0
      if (b.rows.length === 0) {
        out.push({ level: 'refuse', message: 'A table has no rows.', index: i })
      } else if (b.rows.some((r) => r.length !== width)) {
        out.push({ level: 'refuse', message: 'A table has rows of different lengths.', index: i })
      }
      if (b.widths && b.widths.length !== width) {
        out.push({ level: 'refuse', message: 'A table has more column widths than columns.', index: i })
      }
    }
    if (b.kind === 'list' && b.items.length === 0) {
      out.push({ level: 'warn', message: 'A list has no items in it.', index: i })
    }
    if ((b.kind === 'heading' || b.kind === 'paragraph') && spansText(b.spans).trim() === ''
        && b.kind === 'heading') {
      out.push({ level: 'warn', message: 'A heading has no words in it.', index: i })
    }
  })
  return out
}

export const canUseLetter = (problems: LetterProblem[]): boolean =>
  !problems.some((p) => p.level === 'refuse')

/* ------------------------------------------------------------------ drawing it */

/**
 * HTML entity escaping.
 *
 * EVERY PIECE OF TEXT GOES THROUGH THIS, with no exception and no "this one is ours". A debtor's
 * surname is merged into this letter and a surname can contain an ampersand; a client's trading
 * name can contain anything at all. The renderer's output is handed to the browser as HTML, so
 * one unescaped field is a letter that renders wrong at best.
 */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  ))
}

/** Newlines inside a span become real breaks: an address is one paragraph on four lines. */
const withBreaks = (s: string): string => esc(s).replace(/\n/g, '<br>')

function spanHtml(span: Span, filled: boolean, values: Record<string, string>): string {
  const text = filled ? renderTemplate(span.text, values).text : span.text
  const style: string[] = []
  if (span.colour) style.push(`color:${cssColour(span.colour)}`)
  if (span.size) style.push(`font-size:${span.size}pt`)
  let html = withBreaks(text)
  if (span.bold) html = `<strong>${html}</strong>`
  if (span.italic) html = `<em>${html}</em>`
  if (span.underline) html = `<u>${html}</u>`
  return style.length > 0 ? `<span style="${style.join(';')}">${html}</span>` : html
}

/**
 * A colour the renderer will accept, or the body colour.
 *
 * A CLOSED SHAPE rather than whatever is in the field: the value ends up inside a style attribute,
 * and a style attribute is a place a string can do more than colour text. Hex only, three or six
 * digits, and anything else falls back rather than being passed through.
 */
function cssColour(value: string): string {
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value) ? value : 'inherit'
}

/**
 * Spacing as CSS.
 *
 * ZERO IS EMITTED, not skipped. `after: 0` means "no gap here" and an ABSENT after means "the
 * usual gap" — three millimetres for a paragraph. Writing only truthy values made the two
 * identical on the way out, so a block deliberately set tight re-read as a block with default
 * spacing, and the letter grew three millimetres every time somebody opened it.
 */
const spacingStyle = (s?: Spacing): string =>
  [s?.before !== undefined ? `margin-top:${s.before}mm` : '',
    s?.after !== undefined ? `margin-bottom:${s.after}mm` : '']
    .filter(Boolean).join(';')

/**
 * The letter, drawn.
 *
 * ONE RENDERER for the editor's preview, for the print sheet and for anything that eventually
 * posts this. Two would drift, and the drift would be invisible until a debtor's copy differed
 * from the one the firm approved.
 *
 * `filled` is the same toggle the rest of the library has: the fields in braces are what you
 * edit, the same fields resolved are what the debtor reads, and neither answers the other's
 * question.
 */
/**
 * THE NOTICE WITH ITS UNANSWERABLE OPTIONAL LINES TAKEN OUT.
 *
 * THE FIRM'S FOUR LETTERS ALL CARRY ONE. Under the debtor's name, each of the section 129, the
 * final notice, the listing notice and the intended summons has a paragraph reading "Identity
 * number: {{debtor_id_masked}}" — and 97% of the book has no identity number. Leaving the field
 * standing prints braces on a statutory demand; blanking it prints "Identity number:" with
 * nothing after it, which reads as a fact somebody forgot to type; rendering the paragraph empty
 * leaves a gap in the middle of the notice. So the paragraph goes.
 *
 * APPLIED TO THE DOCUMENT, ONCE, BEFORE ANYTHING IS LAID OUT. Both renderers — this file for the
 * screen and letterLayout for the PDF — run it first, so the two cannot disagree about how many
 * paragraphs the notice has. Page breaks are measured after it, which is the only order that
 * works: a block removed after the breaks were planned moves every one of them.
 *
 * A BLOCK GOES ONLY IF IT IS EMPTY *BECAUSE* OF THE REMOVAL. An empty paragraph somebody typed as
 * a spacer is left exactly where it is — this is not a tidy-up pass, and a notice that quietly
 * loses the author's spacing is a notice they did not write.
 */
export function documentWithoutOptional(
  doc: LetterDocument,
  values: Record<string, string>,
): LetterDocument {
  /** The spans with the gaps cut out, and whether cutting them emptied the whole run. */
  const cut = (spans: Span[]): { spans: Span[]; emptied: boolean } => {
    const had = spans.some((s) => spanWithoutOptional(s.text, values) !== s.text)
    const next = spans.map((s) => ({ ...s, text: spanWithoutOptional(s.text, values) }))
    return { spans: next, emptied: had && next.every((s) => s.text.trim() === '') }
  }

  const blocks: LetterDocument['blocks'] = []
  for (const block of doc.blocks) {
    if (block.kind === 'table') {
      const rows = block.rows
        .map((row) => row.map((cell) => ({ cell, done: cut(cell.spans) })))
        .filter((row) => !row.every((c) => c.done.emptied))
        .map((row) => row.map(({ cell, done }) => ({ ...cell, spans: done.spans })))
      blocks.push({ ...block, rows })
      continue
    }
    if (block.kind === 'list') {
      const items = block.items.map((item) => cut(item)).filter((i) => !i.emptied).map((i) => i.spans)
      if (items.length > 0) blocks.push({ ...block, items })
      continue
    }
    const spans = (block as { spans?: Span[] }).spans
    if (!spans) { blocks.push(block); continue }
    const done = cut(spans)
    if (done.emptied) continue
    blocks.push({ ...block, spans: done.spans } as typeof block)
  }
  return { ...doc, blocks }
}

export function letterToHtml(doc: LetterDocument, input: {
  filled: boolean
  values: Record<string, string>
}): string {
  const { filled, values } = input
  /* The unanswerable optional lines go before anything is drawn — see documentWithoutOptional.
     Only when the letter is FILLED: unfilled is the editing view, where every field must stand. */
  if (filled) doc = documentWithoutOptional(doc, values)
  const inline = (spans: Span[]) => spans.map((s) => spanHtml(s, filled, values)).join('')
  /* The heading numbers are counted HERE rather than stored, so inserting a section renumbers the
     ones after it. A typed "3." left over from before an insertion is the classic letter fault. */
  let counter = 0
  const out: string[] = []

  for (const b of doc.blocks) {
    const align = 'align' in b && b.align ? `text-align:${b.align}` : ''
    const space = spacingStyle('spacing' in b ? b.spacing : undefined)
    const style = [align, space].filter(Boolean).join(';')
    const attr = style ? ` style="${style}"` : ''

    switch (b.kind) {
      case 'heading': {
        const n = b.numbered ? `${++counter}` : null
        const tag = `h${b.level}`
        /* "1." rather than "1", at the firm's request -- it is what makes a numbered section
           read as numbering rather than as a stray digit beside a heading. */
        const number = n === null ? '' : `<span class="ltr-n">${n}.</span>`
        out.push(`<${tag} class="ltr-h${b.level}"${attr}>${number}${inline(b.spans)}</${tag}>`)
        break
      }
      case 'paragraph':
        /*
         * `keepWithNext` TRAVELS AS DATA, because it has no appearance to be read back from. A
         * flag that only exists in the model is a flag that is lost the first time the page is
         * edited — "Yours faithfully" would quietly stop keeping with its signature, and nothing
         * would say so until a letter printed with the two on different pages.
         */
        out.push(`<p${attr}${b.keepWithNext ? ' data-keep="1"' : ''}>${inline(b.spans)}</p>`)
        break
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul'
        const items = b.items.map((it) => `<li>${inline(it)}</li>`).join('')
        out.push(`<${tag}${attr}>${items}</${tag}>`)
        break
      }
      case 'table': {
        const cols = (b.widths ?? []).map((w) => `<col style="width:${w}%">`).join('')
        const rows = b.rows.map((row, ri) => {
          const cells = row.map((c) => {
            const cs = c.align ? ` style="text-align:${c.align}"` : ''
            const t = b.headerRow && ri === 0 ? 'th' : 'td'
            return `<${t}${cs}>${inline(c.spans)}</${t}>`
          }).join('')
          return `<tr>${cells}</tr>`
        }).join('')
        out.push(`<table class="ltr-t ltr-b-${b.borders ?? 'none'}"${attr}>`
          + (cols ? `<colgroup>${cols}</colgroup>` : '') + `<tbody>${rows}</tbody></table>`)
        break
      }
      case 'spacer':
        out.push(`<div style="height:${b.mm}mm"></div>`)
        break
      case 'signature':
        out.push(`<div class="ltr-sig"${attr}>`
          + `<div class="ltr-rule" style="width:${b.widthMm ?? 70}mm"></div>`
          + `<div>${inline(b.spans)}</div></div>`)
        break
      case 'pagebreak':
        /* break-before on the NEXT thing rather than break-after on this one: an empty div with
           break-after produces a trailing blank page in every browser that has ever printed. */
        out.push('<div class="ltr-break"></div>')
        break
    }
  }
  return out.join('\n')
}

/**
 * The running header, with the printer's own two fields filled in.
 *
 * Separate from letterToHtml because it is drawn once per PAGE and the body is drawn once per
 * DOCUMENT — the caller that knows how the text broke is the only thing that can say "2 of 3".
 */
export function runningFootHtml(doc: LetterDocument, input: {
  filled: boolean
  values: Record<string, string>
  page: number
  pages: number
}): string {
  if (!doc.runningFoot) return ''
  const withPages = doc.runningFoot
    .replace(/\{\{page\}\}/g, String(input.page))
    .replace(/\{\{pages\}\}/g, String(input.pages))
  const text = input.filled ? renderTemplate(withPages, input.values).text : withPages
  return `<div class="ltr-running">${esc(text)}</div>`
}

/**
 * The stylesheet the rendered HTML above needs, given a page.
 *
 * Handed out rather than hard-coded into a component, because the print sheet and the on-screen
 * preview must be styled by the same rules — the whole point of one renderer is lost if the two
 * are dressed differently.
 */
export function letterCss(doc: LetterDocument, page: PageSetup): string {
  const d = doc.defaults
  const textWidth = page.widthMm - page.marginLeftMm - page.marginRightMm
  return `
.ltr-page {
  width: ${page.widthMm}mm;
  min-height: ${page.heightMm}mm;
  padding: ${page.marginTopMm}mm ${page.marginRightMm}mm ${page.marginBottomMm}mm ${page.marginLeftMm}mm;
  box-sizing: border-box;
  background-color: #fff;
  ${page.backgroundUrl ? `background-image:url("${page.backgroundUrl}");` : ''}
  background-size: ${page.widthMm}mm ${page.heightMm}mm;
  background-repeat: no-repeat;
  background-position: top left;
  font-family: ${d.font};
  font-size: ${d.size}pt;
  line-height: ${d.lineHeight};
  color: ${cssColour(d.colour)};
}
.ltr-body { max-width: ${textWidth}mm; }
.ltr-body p { margin: 0 0 3mm; }
.ltr-h1 { font-size: ${(d.size * 1.15).toFixed(1)}pt; font-weight: 700; text-transform: uppercase;
  letter-spacing: .02em; margin: 0 0 4mm; }
.ltr-h2 { font-size: ${(d.size * 1.02).toFixed(1)}pt; font-weight: 700; text-transform: uppercase;
  letter-spacing: .04em; margin: 6mm 0 2.5mm; }
.ltr-h3 { font-size: ${d.size}pt; font-weight: 700; margin: 4mm 0 1.5mm; }
/* The number sits in the margin beside its heading rather than in the text, so a heading that
   wraps keeps its second line aligned with its first instead of under the digit. */
.ltr-h2 .ltr-n, .ltr-h1 .ltr-n, .ltr-h3 .ltr-n { display: inline-block; width: 7mm; }
.ltr-body ul, .ltr-body ol { margin: 0 0 3mm; padding-left: 6mm; }
.ltr-body li { margin-bottom: 1.5mm; }
.ltr-t { width: 100%; border-collapse: collapse; margin: 0 0 3mm; }
.ltr-t td, .ltr-t th { padding: 1.4mm 2mm 1.4mm 0; vertical-align: top; text-align: left; }
.ltr-t th { font-weight: 700; }
.ltr-b-rows td, .ltr-b-rows th { border-bottom: 0.2mm solid #d8dee6; padding-left: 0; }
.ltr-b-all td, .ltr-b-all th { border: 0.2mm solid #d8dee6; padding: 1.4mm 2mm; }
.ltr-break { break-before: page; page-break-before: always; }
.ltr-sig { margin: 0 0 3mm; }
.ltr-rule { border-bottom: 0.3mm solid #4b5563; height: 10mm; margin-bottom: 1.5mm; }
/* The running line sits BELOW the text, in the bottom margin, clear of the letterhead's own
   footer block. At the top it competed with the logo and pushed the date block down the page. */
.ltr-running { font-size: ${(d.size * 0.78).toFixed(1)}pt; color: #6b7280; letter-spacing: .02em;
  margin-top: 8mm; }
`.trim()
}

/* ------------------------------------------------------------------ editing a run of text */

/**
 * Spans out to the HTML a contenteditable box understands, and back again.
 *
 * WHY THIS ROUND TRIP EXISTS. The firm asked for Word, and the nearest honest thing a browser
 * offers is contenteditable — you select a word and press bold. What must NOT happen is that the
 * browser's markup becomes the stored document: then the letter is whatever Chrome felt like
 * emitting, a merge field can be cut in half by a stray <span>, and the printed page is at the
 * mercy of a rendering engine nobody controls.
 *
 * So contenteditable is an INPUT METHOD and the block model stays the truth. Text goes out as
 * this tiny tag set, and whatever comes back is parsed against the same tiny tag set with
 * everything else dropped. A paste from Word arrives as fifty tags of Office markup and leaves as
 * bold, italic, underline and the words.
 *
 * HAND-ROLLED, like sanitizeEmailHtml beside it, so the parse is the same in Node as in a browser
 * — the checks run with no DOM, and a round trip that can only be tested in a browser is a round
 * trip that gets tested once.
 */
export function spansToEditableHtml(spans: Span[]): string {
  return spans.map((s) => {
    let html = withBreaks(s.text)
    if (s.bold) html = `<b>${html}</b>`
    if (s.italic) html = `<i>${html}</i>`
    if (s.underline) html = `<u>${html}</u>`
    const style = [
      s.colour ? `color:${cssColour(s.colour)}` : '',
      s.size ? `font-size:${s.size}pt` : '',
    ].filter(Boolean).join(';')
    return style ? `<span style="${style}">${html}</span>` : html
  }).join('') || '<br>'
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ', '#160': ' ',
}
const unesc = (s: string): string =>
  s.replace(/&(#?\w+);/g, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)

/**
 * The marks a tag turns on. Everything not in here is IGNORED rather than kept — its text still
 * comes through, which is the behaviour somebody pasting from Word wants: the words survive and
 * the forty tags of Office markup do not.
 */
const MARK_TAGS: Record<string, keyof Span> = {
  b: 'bold', strong: 'bold', i: 'italic', em: 'italic', u: 'underline',
}

/** Parse `style="color:#123456;font-size:9pt"` for the two properties a span may carry. */
function readStyle(attrs: string): { colour?: string; size?: number } {
  const style = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/i.exec(attrs)?.slice(1).find(Boolean) ?? ''
  const out: { colour?: string; size?: number } = {}
  const colour = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim()
  /* Hex only, and rgb() converted rather than passed through: a browser normalises #1f2937 to
     rgb(31, 41, 55) on its way out, so refusing rgb() would silently lose every colour the
     moment it was read back. */
  if (colour) {
    const hex = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(colour) ? colour : rgbToHex(colour)
    if (hex) out.colour = hex
  }
  const size = /(?:^|;)\s*font-size\s*:\s*([\d.]+)pt/i.exec(style)?.[1]
  if (size) out.size = Number(size)
  return out
}

function rgbToHex(value: string): string | null {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value)
  if (!m) return null
  return '#' + [m[1], m[2], m[3]]
    .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')
}

export function editableHtmlToSpans(html: string): Span[] {
  const out: Span[] = []
  /* A stack of the marks currently open. Nesting rather than a flat flag, because <b>a<i>b</i>c</b>
     has to come back as bold / bold+italic / bold, and a flag cleared by </i> would lose the
     bold on "c". */
  const stack: Partial<Span>[] = []
  const current = (): Partial<Span> => Object.assign({}, ...stack)

  const push = (text: string) => {
    if (text === '') return
    const marks = current()
    const last = out[out.length - 1]
    /* Runs with identical marks are joined, or typing one character at a time in a browser that
       wraps each keystroke produces a document of one-letter spans. */
    if (last && last.bold === marks.bold && last.italic === marks.italic
        && last.underline === marks.underline && last.colour === marks.colour
        && last.size === marks.size) {
      last.text += text
      return
    }
    out.push({ text, ...marks })
  }

  const re = /<\/?([a-z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi
  let at = 0
  let m: RegExpExecArray | null
  /*
   * WHAT IS INSIDE <script> AND <style> IS NOT TEXT. Dropping the tags alone leaves their
   * CONTENTS behind as words, so pasting a block copied off a web page drops a stylesheet into
   * the middle of a statutory notice. Not a security hole -- every character is escaped on the
   * way out -- but it is a notice with CSS printed in it, which is worse in its own way because
   * it looks like a mistake the firm made.
   */
  let muted: string | null = null
  while ((m = re.exec(html)) !== null) {
    if (muted === null) push(unesc(html.slice(at, m.index)))
    at = m.index + m[0].length
    const tag = m[1].toLowerCase()
    const closing = m[0].startsWith('</')
    if (muted !== null) { if (closing && tag === muted) muted = null; continue }
    if (!closing && (tag === 'script' || tag === 'style')) { muted = tag; continue }
    if (tag === 'br') { push('\n'); continue }
    /* A block tag inside a run means the browser split the line; treated as a break rather than
       dropped, or two paragraphs of a pasted letter run together into one sentence. */
    if (!closing && (tag === 'div' || tag === 'p')) { if (out.length > 0) push('\n'); continue }
    if (tag in MARK_TAGS) {
      if (closing) { for (let i = stack.length - 1; i >= 0; i--) { if (MARK_TAGS[tag] in stack[i]) { stack.splice(i, 1); break } } }
      else stack.push({ [MARK_TAGS[tag]]: true })
      continue
    }
    if (tag === 'span') {
      if (closing) { for (let i = stack.length - 1; i >= 0; i--) { if ('colour' in stack[i] || 'size' in stack[i]) { stack.splice(i, 1); break } } }
      else {
        const s = readStyle(m[2])
        /* Pushed even when empty, so the matching </span> pops something. A stack that only
           sometimes grows is a stack that pops the wrong entry. */
        stack.push(s)
      }
      continue
    }
    /* Everything else: the tag goes, the text inside it stays. */
  }
  if (muted === null) push(unesc(html.slice(at)))
  return out.length > 0 ? out : [{ text: '' }]
}

/* ------------------------------------------------------------------ editing the whole page */

/**
 * READING A WHOLE EDITED PAGE BACK INTO BLOCKS.
 *
 * WHY THIS IS THE PIECE EVERYTHING ELSE HANGS ON. The firm asked to type on the page rather than
 * fill in a stack of block cards: "can't it be just like one page which you immediately see how
 * it would look like". That is the right shape — but the page must stay an INPUT SURFACE and not
 * become the stored document. If the browser's markup were what we kept, the letter would be
 * whatever Chrome felt like emitting that day, and a statutory demand would print at the mercy of
 * a rendering engine nobody controls.
 *
 * So the same bargain as `editableHtmlToSpans`, one level up: the page is drawn from the model,
 * edited freely, and read back against a closed list of shapes. Anything the browser invents that
 * this does not recognise contributes its TEXT and nothing else — which is what a paste from Word
 * should do, and what a stray `<font>` tag from a 2003 template should do too.
 *
 * HAND-ROLLED, like the sanitiser beside it, so the parse is identical in Node and in a browser.
 * A round trip that can only be exercised in a browser is a round trip that gets exercised once.
 */

/** Tags that never have a closing partner, so they must not open a depth. */
const VOID_TAGS = new Set(['br', 'img', 'hr', 'col', 'input', 'wbr', 'source'])

interface RawBlock { tag: string; attrs: string; inner: string }

/**
 * Split HTML into its TOP-LEVEL elements, each with its attributes and its inner HTML.
 *
 * Text sitting loose between elements — which is what a browser leaves when somebody presses
 * Return at the very end of a document — comes back as a synthetic `p`, so a sentence typed
 * outside any block is kept rather than dropped.
 */
function topLevelBlocks(html: string): RawBlock[] {
  const out: RawBlock[] = []
  const re = /<(\/?)([a-z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/gi
  let depth = 0
  let openAt = -1
  let openTag = ''
  let openAttrs = ''
  let textFrom = 0
  let m: RegExpExecArray | null

  const loose = (upTo: number) => {
    const text = html.slice(textFrom, upTo)
    if (text.trim() !== '') out.push({ tag: 'p', attrs: '', inner: text })
  }

  while ((m = re.exec(html)) !== null) {
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    const selfClosing = m[4] === '/' || VOID_TAGS.has(tag)
    if (selfClosing) continue
    if (!closing) {
      if (depth === 0) {
        loose(m.index)
        openAt = m.index + m[0].length
        openTag = tag
        openAttrs = m[3]
      }
      depth += 1
    } else {
      depth -= 1
      if (depth === 0 && openAt !== -1) {
        out.push({ tag: openTag, attrs: openAttrs, inner: html.slice(openAt, m.index) })
        textFrom = m.index + m[0].length
        openAt = -1
      }
      /*
       * A closing tag with nothing open is a browser leaving debris. Ignored rather than allowed
       * to drive the depth negative, which would swallow everything after it — and CONSUMED, so
       * the tag itself is not later collected as loose text. Any real words before it still are:
       * `words</div>` is a sentence somebody typed followed by rubbish, not rubbish.
       */
      if (depth < 0) {
        depth = 0
        loose(m.index)
        textFrom = m.index + m[0].length
      }
    }
  }
  loose(html.length)
  return out
}

/** One CSS property out of a style attribute. */
function styleProp(attrs: string, prop: string): string | null {
  const style = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/i.exec(attrs)?.slice(1).find(Boolean) ?? ''
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i')
  return re.exec(style)?.[1]?.trim() ?? null
}

const classOf = (attrs: string): string =>
  (/class\s*=\s*"([^"]*)"|class\s*=\s*'([^']*)'/i.exec(attrs)?.slice(1).find(Boolean) ?? '')

function alignOf(attrs: string): Align | undefined {
  const a = styleProp(attrs, 'text-align')
  return a === 'center' || a === 'right' || a === 'justify' || a === 'left' ? a : undefined
}

/** "6mm" out of a margin, in millimetres. Browsers hand these back in px, which is not ours. */
function mmOf(value: string | null): number | undefined {
  if (!value) return undefined
  const m = /^([\d.]+)\s*mm$/i.exec(value.trim())
  return m ? Number(m[1]) : undefined
}

function spacingOf(attrs: string): Spacing | undefined {
  const before = mmOf(styleProp(attrs, 'margin-top'))
  const after = mmOf(styleProp(attrs, 'margin-bottom'))
  if (before === undefined && after === undefined) return undefined
  const out: Spacing = {}
  if (before !== undefined) out.before = before
  if (after !== undefined) out.after = after
  return out
}

/** The `<li>` elements of a list, or the `<tr>`/`<td>` of a table — one level down. */
const childrenOf = (inner: string, tags: string[]): RawBlock[] =>
  topLevelBlocks(inner).filter((b) => tags.includes(b.tag))

/**
 * A whole edited page, back as blocks.
 *
 * NEVER RETURNS AN EMPTY DOCUMENT FOR A NON-EMPTY PAGE. An empty result would be saved over a
 * notice the attorney settled, so a page that parses to nothing comes back as one empty
 * paragraph and the caller can tell the difference between that and a real edit.
 */
export function documentHtmlToBlocks(html: string): Block[] {
  const out: Block[] = []

  for (const raw of topLevelBlocks(html)) {
    const cls = classOf(raw.attrs)
    const align = alignOf(raw.attrs)
    const spacing = spacingOf(raw.attrs)

    /*
     * WHAT IS INSIDE <script> AND <style> IS NOT TEXT, and dropping only the TAG is worse than
     * useless: the contents are then loose words, so a block copied off a web page drops a
     * stylesheet into the middle of a statutory notice. editableHtmlToSpans guards this for a run
     * of text; the element has to be refused a block of its own here, before it gets one.
     */
    if (raw.tag === 'script' || raw.tag === 'style') continue

    /* A hard page break, which the renderer draws as an empty div. */
    if (cls.includes('ltr-break')) { out.push({ kind: 'pagebreak' }); continue }

    /* A spacer is an empty div with a height. Anything else empty is debris and is dropped. */
    if (raw.tag === 'div' && !cls.includes('ltr-sig')) {
      const h = mmOf(styleProp(raw.attrs, 'height'))
      if (h !== undefined && raw.inner.trim() === '') { out.push({ kind: 'spacer', mm: h }); continue }
    }

    if (cls.includes('ltr-sig')) {
      const rule = topLevelBlocks(raw.inner).find((b) => classOf(b.attrs).includes('ltr-rule'))
      const rest = topLevelBlocks(raw.inner).filter((b) => !classOf(b.attrs).includes('ltr-rule'))
      const widthPc = styleProp(rule?.attrs ?? '', 'width')
      out.push({
        kind: 'signature',
        widthMm: mmOf(widthPc) ?? 70,
        spans: editableHtmlToSpans(rest.map((b) => b.inner).join('')),
        ...(spacing ? { spacing } : {}),
      })
      continue
    }

    const heading = /^h([123])$/i.exec(raw.tag)
    if (heading) {
      /*
       * THE SECTION NUMBER IS DRAWN BY THE RENDERER, so it comes back as a span in the text and
       * must be taken OUT again — otherwise every save bakes the current number into the words,
       * and inserting a section leaves the old digits behind for ever. Its presence is what says
       * the heading is numbered.
       */
      const numbered = /class="ltr-n"/.test(raw.inner)
      const inner = raw.inner.replace(/<span class="ltr-n">[\s\S]*?<\/span>/g, '')
      out.push({
        kind: 'heading',
        level: Number(heading[1]) as 1 | 2 | 3,
        spans: editableHtmlToSpans(inner),
        ...(numbered ? { numbered: true } : {}),
        ...(align ? { align } : {}),
        ...(spacing ? { spacing } : {}),
      })
      continue
    }

    if (raw.tag === 'ul' || raw.tag === 'ol') {
      out.push({
        kind: 'list',
        ordered: raw.tag === 'ol',
        items: childrenOf(raw.inner, ['li']).map((li) => editableHtmlToSpans(li.inner)),
        ...(spacing ? { spacing } : {}),
      })
      continue
    }

    if (raw.tag === 'table') {
      const widths: number[] = []
      for (const col of raw.inner.matchAll(/<col\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
        const pc = /^([\d.]+)%$/.exec(styleProp(col[1], 'width') ?? '')
        if (pc) widths.push(Number(pc[1]))
      }
      /* The rows may sit inside a tbody or not, depending on what the browser decided. Found by
         asking for `tr` at whatever depth rather than assuming either shape. */
      const body = topLevelBlocks(raw.inner).find((b) => b.tag === 'tbody')
      const rows = childrenOf(body ? body.inner : raw.inner, ['tr']).map((tr) =>
        childrenOf(tr.inner, ['td', 'th']).map((cell) => ({
          spans: editableHtmlToSpans(cell.inner),
          ...(alignOf(cell.attrs) ? { align: alignOf(cell.attrs)! } : {}),
        })))
      const borders = /ltr-b-(none|rows|all)/.exec(cls)?.[1] as TableBlock['borders'] | undefined
      const headerRow = /<th\b/i.test(raw.inner)
      out.push({
        kind: 'table',
        rows,
        ...(widths.length > 0 ? { widths } : {}),
        ...(headerRow ? { headerRow: true } : {}),
        ...(borders ? { borders } : {}),
        ...(spacing ? { spacing } : {}),
      })
      continue
    }

    /*
     * Everything else is a paragraph, including anything the browser invented. Its text survives;
     * its tag does not.
     *
     * AN EMPTY PARAGRAPH IS KEPT, and that is a change of mind worth recording. The block editor
     * dropped them as debris, which was right when a block was a card in a form — nobody adds an
     * empty card. On a page you type on it is wrong: pressing Return twice IS how a blank line is
     * made, and it arrives as exactly the same <p><br></p>. Dropped, the line stays on screen
     * (nothing redraws the sheet under a cursor) and is gone when the letter is next opened —
     * the page and the document quietly disagreeing, which is the one thing this model exists to
     * prevent. A stray blank line is visible and costs a keystroke; a lost one is not.
     */
    const spans = editableHtmlToSpans(raw.inner)
    out.push({
      kind: 'paragraph',
      spans,
      ...(align ? { align } : {}),
      ...(spacing ? { spacing } : {}),
      ...(/\bdata-keep\b/.test(raw.attrs) ? { keepWithNext: true } : {}),
    })
  }

  return out.length > 0 ? out : [{ kind: 'paragraph', spans: [{ text: '' }] }]
}
