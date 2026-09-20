/**
 * WHAT ARRIVES ON THE CLIPBOARD, TURNED INTO A LETTER.
 *
 * The firm: "I try to paste something like this, you know, copy and paste. I think this is much
 * easier than just writing everything from scratch. So if someone, for example, makes something
 * in Claude, write something and you can just copy and paste it into the letterhead on the
 * system."
 *
 * WHAT WAS WRONG BEFORE. The page editor pasted as PLAIN TEXT, deliberately — the reasoning was
 * that keeping the page honest mattered more than keeping the markup. That was the wrong trade
 * for the way the firm actually works: a whole section 129 pasted in came out as forty lines of
 * body text with "1 YOUR DEFAULT" sitting in the middle of it, both tables flattened into loose
 * lines, and the list of what happens in court reading as one grey paragraph. Rebuilding that by
 * hand is most of the work of writing it again.
 *
 * SO THE STRUCTURE IS KEPT AND THE MARKUP IS STILL NOT. Everything here converts INTO the same
 * closed tag set `documentHtmlToBlocks` reads back — headings, paragraphs, lists, tables, and
 * the four marks — and drops the rest. A paste out of Word still arrives as words rather than as
 * a stylesheet; it just arrives as words that kept their shape. The honesty was never in the
 * plain text, it was in the closed set.
 *
 * TWO ROADS IN, because the two things people paste are not the same:
 *
 *   - RICH TEXT (`text/html`). Anything copied from a rendered page, a Word document or Claude's
 *     own answer carries an HTML flavour, and that flavour already knows what is a heading.
 *   - MARKDOWN (`text/plain` that looks like it). Copying out of a code block, a .md file, or
 *     anywhere the text itself is the markup gives `## Heading` and `- bullet` as literal
 *     characters. Pasted as text those hashes print on the letter.
 *
 * And a third case which is most pastes: a sentence. That has no structure to keep, so the caller
 * falls back to inserting it as text — see the null return.
 *
 * HAND-ROLLED, NO DOM, like `documentHtmlToBlocks` and the sanitiser beside it. The checks beside
 * this folder run in Node with no browser, and a conversion that can only be exercised in a
 * browser is one that gets exercised once.
 */

/** The only tags that may reach the page. Everything else contributes its text and nothing else. */
const KEEP = new Set([
  'h1', 'h2', 'h3', 'p', 'ul', 'ol', 'li', 'table', 'tbody', 'tr', 'td', 'th', 'b', 'i', 'u', 'br',
])

/** What a foreign tag becomes. Anything not here and not in KEEP is unwrapped. */
const RENAME: Record<string, string> = {
  /* Word and Google Docs both emit <div> where a paragraph was. */
  div: 'p',
  /* The model has three heading levels; a document with six collapses onto the deepest. */
  h4: 'h3', h5: 'h3', h6: 'h3',
  strong: 'b', em: 'i', ins: 'u',
  /* A heading cell and a body cell are both cells; <thead> is folded into the one <tbody>
     documentHtmlToBlocks expects, or its rows are dropped on the way back in. */
  thead: 'tbody', tfoot: 'tbody',
  /* Blockquotes and preformatted blocks have no shape here, but they are paragraphs of words. */
  blockquote: 'p', pre: 'p',
}

/** Tags whose CONTENTS are not text at all. Dropped whole — see editableHtmlToSpans. */
const MUTE = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'colgroup', 'col'])

const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'col', 'wbr', 'source'])

/**
 * Does this HTML carry any shape worth keeping?
 *
 * A clipboard almost always has an HTML flavour, and for a sentence copied out of a paragraph it
 * is `<span>a sentence</span>` — nothing this file can improve on. Asked so that the ordinary
 * paste still takes the plain-text road and behaves exactly as it always did.
 */
const hasShape = (html: string): boolean =>
  /<(h[1-6]|ul|ol|li|table|tr|td|th|p|div|br)\b/i.test(html)

/**
 * Bold, italic and underline hidden in a style attribute.
 *
 * GOOGLE DOCS DOES NOT EMIT <b>. It emits `<span style="font-weight:700">`, and Word does the
 * same for anything that was styled rather than typed bold. Dropping attributes without reading
 * them first loses every mark in a document written that way — which is most of them.
 */
function marksInStyle(attrs: string): string[] {
  const style = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/i.exec(attrs)?.slice(1).find(Boolean) ?? ''
  const out: string[] = []
  const weight = /(?:^|;)\s*font-weight\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim()
  if (weight && (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600)) out.push('b')
  if (/(?:^|;)\s*font-style\s*:\s*italic/i.test(style)) out.push('i')
  if (/(?:^|;)\s*text-decoration[^:]*:[^;]*underline/i.test(style)) out.push('u')
  return out
}

/**
 * Arbitrary HTML, reduced to the letter's own tag set.
 *
 * EVERY ATTRIBUTE IS DROPPED except where it carried a mark, because attributes are where Office
 * markup lives — `class=MsoNormal`, `lang=EN-ZA`, forty lines of `mso-` properties. The one thing
 * worth reading out of them is whether a span was bold.
 */
export function sanitiseToLetterHtml(html: string): string {
  /*
   * A SECTION NUMBER COPIED OUT OF THIS EDITOR IS NOT TEXT.
   *
   * The most likely paste of all is a copy from Raptor itself -- take a section, paste it lower
   * down. The renderer DRAWS the number into the heading as `<span class="ltr-n">2.</span>`, so
   * copying carries that digit as words. Sanitised naively it lands as "2.YOUR DEFAULT", and the
   * next render numbers THAT, giving "1. 2.YOUR DEFAULT" -- and every later section wrong.
   *
   * So the marker is kept and its contents are not: the empty span is what documentHtmlToBlocks
   * reads to know a heading is numbered, and the digit it used to hold is drawn afresh.
   */
  const source = html.replace(
    /<span[^>]*class\s*=\s*["']?[^"'>]*\bltr-n\b[^"'>]*["']?[^>]*>[\s\S]*?<\/span>/gi,
    '<span class="ltr-n"></span>',
  )
  const out: string[] = []
  /* Marks opened by a <span style> and owed a closing tag when that span ends. A stack, because
     a bold span can contain an italic one. */
  const spanMarks: string[][] = []
  let muted: string | null = null
  let depth = 0

  const re = /<(\/?)([a-z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/gi
  let at = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    if (muted === null) out.push(source.slice(at, m.index))
    at = m.index + m[0].length
    const closing = m[1] === '/'
    const raw = m[2].toLowerCase()

    /* Inside <style> or <script>, nothing is text — not even the words between the tags. */
    if (muted !== null) {
      if (closing && raw === muted) { muted = null; depth = Math.max(0, depth - 1) }
      continue
    }
    if (!closing && MUTE.has(raw)) {
      if (!VOID.has(raw) && m[4] !== '/') { muted = raw; depth += 1 }
      continue
    }
    if (closing && MUTE.has(raw)) continue

    const tag = RENAME[raw] ?? raw

    if (raw === 'span' || raw === 'font') {
      /* The numbering marker, put back untouched: it is the one span with meaning here. */
      /* The numbering marker, put back untouched: it is the one span with meaning here. */
      if (!closing && /\bltr-n\b/.test(m[3])) {
        out.push('<span class="ltr-n"></span>')
        spanMarks.push([])
        continue
      }
      /* Not a shape, but it may be carrying a mark. */
      if (closing) {
        for (const mk of (spanMarks.pop() ?? []).reverse()) out.push(`</${mk}>`)
      } else {
        const marks = m[4] === '/' ? [] : marksInStyle(m[3])
        if (m[4] !== '/') spanMarks.push(marks)
        for (const mk of marks) out.push(`<${mk}>`)
      }
      continue
    }

    if (!KEEP.has(tag)) continue  /* the tag goes, its text stays */
    if (VOID.has(tag)) { out.push(`<${tag}>`); continue }
    out.push(closing ? `</${tag}>` : `<${tag}>`)
  }
  if (muted === null) out.push(source.slice(at))

  /* Any span left open at the end of a fragment — a clipboard is often a fragment. */
  while (spanMarks.length > 0) {
    for (const mk of (spanMarks.pop() ?? []).reverse()) out.push(`</${mk}>`)
  }
  return tidy(out.join(''))
}

/**
 * Put the result into the shape documentHtmlToBlocks expects, and throw away what is now empty.
 *
 * THE EMPTY WRAPPERS ARE THE POINT. Unwrapping a `<section>` or a `<span>` leaves the tags that
 * were inside it, and a Word paste is full of `<p><span></span></p>` — which would come back as
 * a blank line for every one of them.
 */
function tidy(html: string): string {
  let s = html
  /* Tables carry the firm's own class, so a pasted one is drawn like a written one rather than
     as an unstyled grid. Rows between borders is the house style -- see letterCss. */
  s = s.replace(/<table>/g, '<table class="ltr-t ltr-b-rows">')
  /* Headings likewise, so a pasted section looks like a typed one. */
  s = s.replace(/<h([123])>/g, '<h$1 class="ltr-h$1">')
  /* Rows that ended up outside a tbody -- <table><tr> is legal to write and common to paste. */
  s = s.replace(/<table([^>]*)>(\s*)<tr>/g, '<table$1><tbody><tr>')
  s = s.replace(/<\/tr>(\s*)<\/table>/g, '</tr></tbody></table>')
  /* Adjacent tbodies, which is what folding <thead> into <tbody> produces. */
  s = s.replace(/<\/tbody>\s*<tbody>/g, '')
  /* Empty leftovers, repeatedly: emptying one can empty the one around it. */
  for (let i = 0; i < 4; i += 1) {
    const before = s
    s = s.replace(/<(b|i|u|p|li|td|th)>(\s|&nbsp;)*<\/\1>/g, '')
    if (s === before) break
  }
  return s.trim()
}

/* ------------------------------------------------------------------ markdown */

const esc = (s: string): string => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * `**bold**`, `*italic*`, `_italic_` — the marks, inside one line.
 *
 * BOLD BEFORE ITALIC, because `**x**` also matches the italic pattern and taking them the other
 * way round turns every bold word into an italic one wrapped in stray asterisks.
 */
function inlineMarkdown(line: string): string {
  let s = esc(line)
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  s = s.replace(/__([^_]+)__/g, '<b>$1</b>')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<i>$2</i>')
  /* `` `code` `` has no shape in a letter, so the backticks go and the words stay. */
  s = s.replace(/`([^`]+)`/g, '$1')
  return s
}

/** A `| a | b |` row split into its cells, with the outer pipes dropped. */
const tableCells = (line: string): string[] =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

/** The `|---|---|` line under a Markdown table's header. */
const isRule = (line: string): boolean => /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/.test(line) && line.includes('-')

/**
 * Does this plain text look like Markdown?
 *
 * ASKED BEFORE CONVERTING, so an ordinary sentence is still pasted as an ordinary sentence. A
 * converter that ran on everything would turn "3. Call them back" typed into a note into a
 * numbered list of one.
 */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.split(/\r?\n/)
  const structural = lines.filter((l) =>
    /^#{1,6}\s+\S/.test(l)
    || /^\s*[-*+]\s+\S/.test(l)
    || /^\s*\d+[.)]\s+\S/.test(l)
    || /^\s*\|.*\|\s*$/.test(l)).length
  /* TWO LINES, NOT ONE. A single "- " is a dash somebody typed; two is a list. One heading on its
     own is enough, though, because nothing else starts a line with a hash. */
  return structural >= 2 || lines.some((l) => /^#{1,6}\s+\S/.test(l))
}

/**
 * Markdown into the letter's tag set.
 *
 * LINE BY LINE, which is all Markdown needs for the shapes this model has. There is no nesting to
 * track: a letter has no list inside a list, and a section 129 has never needed one.
 */
export function markdownToLetterHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  let para: string[] = []

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null } }
  const closePara = () => {
    if (para.length === 0) return
    out.push(`<p>${para.join('<br>')}</p>`)
    para = []
  }
  const close = () => { closePara(); closeList() }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]

    if (line.trim() === '') { close(); continue }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      close()
      const level = Math.min(3, heading[1].length)
      out.push(`<h${level} class="ltr-h${level}">${inlineMarkdown(heading[2].trim())}</h${level}>`)
      continue
    }

    /* A table: this row, the rule under it, and every row after. Taken in one go because a table
       is the one shape here that spans lines. */
    if (/^\s*\|.*\|\s*$/.test(line) && isRule(lines[i + 1] ?? '')) {
      close()
      const head = tableCells(line)
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) {
        rows.push(tableCells(lines[j]))
        j += 1
      }
      const th = head.map((c) => `<th>${inlineMarkdown(c)}</th>`).join('')
      const body = rows
        .map((r) => `<tr>${r.map((c) => `<td>${inlineMarkdown(c)}</td>`).join('')}</tr>`)
        .join('')
      out.push(`<table class="ltr-t ltr-b-rows"><tbody><tr>${th}</tr>${body}</tbody></table>`)
      i = j - 1
      continue
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      closePara()
      const want = bullet ? 'ul' : 'ol'
      if (list !== want) { closeList(); out.push(`<${want}>`); list = want }
      out.push(`<li>${inlineMarkdown((bullet ?? numbered)![1])}</li>`)
      continue
    }

    closeList()
    /* A horizontal rule is a divider with nothing to say in a letter. */
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { closePara(); continue }
    para.push(inlineMarkdown(line.trim()))
  }
  close()
  return out.join('')
}

/* ------------------------------------------------------------------ the one the editor calls */

/**
 * What to insert for this paste, or null to insert the plain text unchanged.
 *
 * NULL IS THE ORDINARY ANSWER and is not a failure: most pastes are a sentence, a figure or a
 * reference number, and those have no shape to keep. Returning markup for them would be the
 * converter inventing structure that was never there.
 */
export function clipboardToLetterHtml(
  clip: { html: string; text: string },
): string | null {
  if (clip.html && hasShape(clip.html)) {
    const cleaned = sanitiseToLetterHtml(clip.html)
    /* Guarded, because a sanitise that came back with nothing means the flavour was shape without
       words -- and inserting an empty string would swallow the paste entirely. */
    if (cleaned.replace(/<[^>]*>/g, '').trim() !== '') return cleaned
  }
  if (clip.text && looksLikeMarkdown(clip.text)) return markdownToLetterHtml(clip.text)
  return null
}
