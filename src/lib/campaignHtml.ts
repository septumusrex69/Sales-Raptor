/**
 * A CAMPAIGN WRITTEN LIKE AN OUTLOOK EMAIL, AND WHAT OF IT MAY LEAVE THE BUILDING (S13, 29 Oct).
 *
 * Ryno: the compose screen should "look exactly like Outlook ... at the top you have your ribbon and your
 * formatting ... then you can import your own signatures". So a campaign body may now be HTML, typed into a
 * contenteditable box. What the browser makes of a contenteditable -- and what Word and Outlook put on a
 * clipboard -- is not something to send to 2 800 clients as it stands: `<script>`, `onclick=`,
 * `javascript:` links, forty lines of `mso-` styles, `<o:p>`. So the body is reduced to a CLOSED SET of tags,
 * attributes and style properties every time it is saved, previewed or sent, by this one function, in the
 * browser and on the server alike (it is pure text processing: no DOM, so the server can run it).
 *
 * THE PROTECTION IS THE CLOSED SET, not a list of bad things: anything not named below is dropped, and its text
 * kept. The same lesson as letterPaste.ts.
 *
 * OLD CAMPAIGNS ARE TEXT and stay text. An HTML body starts with EMAIL_HTML_MARKER, so one column carries both
 * and nothing written before 29 Oct changes meaning.
 */

export const EMAIL_HTML_MARKER = '<!--raptor:html-->'

export const isHtmlBody = (body: string | null | undefined): boolean => (body ?? '').startsWith(EMAIL_HTML_MARKER)

const escapeText = (s: string) => s.replace(/&(?!#?[a-z0-9]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Tags kept, and the attributes each may keep. `style` is filtered property by property below. */
const ALLOWED: Record<string, readonly string[]> = {
  p: ['style', 'align'], div: ['style', 'align'], span: ['style'], br: [], hr: ['style'],
  b: [], strong: [], i: [], em: [], u: [], s: [], strike: [], sub: [], sup: [], small: [], font: ['color', 'size', 'face'],
  h1: ['style'], h2: ['style'], h3: ['style'], h4: ['style'], blockquote: ['style'],
  ul: ['style'], ol: ['style'], li: ['style'],
  a: ['href', 'style', 'title'],
  img: ['src', 'alt', 'width', 'height', 'style', 'align'],
  /* A signature out of Outlook is a table: a photograph in one cell, the words in the next. */
  table: ['style', 'width', 'cellpadding', 'cellspacing', 'border', 'align', 'role'],
  thead: [], tbody: [], tr: ['style'], td: ['style', 'width', 'valign', 'align', 'colspan', 'rowspan'], th: ['style', 'width', 'valign', 'align', 'colspan'],
}
const VOID = new Set(['br', 'hr', 'img'])
/* Their CONTENTS go too: the words inside a <style> are not words. */
const MUTE = new Set(['script', 'style', 'head', 'title', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'xml', 'form', 'select', 'textarea', 'button'])

/** Style properties an email may carry. Nothing positions, nothing loads a file. */
const STYLE_PROPS = new Set([
  'color', 'background-color', 'background', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration',
  'text-align', 'line-height', 'letter-spacing', 'vertical-align', 'width', 'max-width', 'height', 'margin', 'margin-top',
  'margin-bottom', 'margin-left', 'margin-right', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'border-collapse', 'border-radius', 'list-style-type',
])

export function cleanStyle(style: string): string {
  return style.split(';').map((d) => {
    const i = d.indexOf(':')
    if (i < 0) return ''
    const prop = d.slice(0, i).trim().toLowerCase()
    const value = d.slice(i + 1).trim()
    if (!STYLE_PROPS.has(prop) || !value) return ''
    /* A value that could fetch, run or escape the attribute is not a style. */
    if (/url\s*\(|expression|javascript:|@import|[<>"\\]/i.test(value)) return ''
    if (prop === 'background' && !/^#[0-9a-f]{3,8}$|^rgba?\([\d\s.,%]+\)$|^[a-z]+$/i.test(value)) return ''
    return `${prop}:${value}`
  }).filter(Boolean).join(';')
}

/** Only links a reader can safely follow: web, mail and phone. Anything else is dropped, its words kept. */
export function safeHref(raw: string): string | null {
  const v = raw.trim()
  if (/^https?:\/\/[^\s"<>]+$/i.test(v) || /^mailto:[^\s"<>]+$/i.test(v) || /^tel:[+\d\s()-]+$/i.test(v)) return v
  /* A merge field may stand for a link the server fills ({{unsubscribe}} is never one: it has its own footer). */
  if (/^\{\{\s*[a-z_]+\s*\}\}$/.test(v)) return v
  return null
}

/** Pictures from the web only. A pasted `data:` image or a file on somebody's own computer cannot be emailed. */
export function safeImgSrc(raw: string): string | null {
  const v = raw.trim()
  return /^https:\/\/[^\s"<>]+$/i.test(v) ? v : null
}

function decodeEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, '\u00a0').replace(/&amp;/g, '&')
}

/**
 * ANY HTML, REDUCED TO WHAT AN EMAIL MAY CARRY. Total: every piece of text in the input survives (bar the
 * contents of MUTE tags), every tag outside ALLOWED is dropped and its children kept, and every attribute is
 * rebuilt from scratch -- an attribute is never copied through, so nothing unnamed can ride along.
 */
export function sanitiseCampaignHtml(html: string): string {
  const src = (html ?? '').replace(EMAIL_HTML_MARKER, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<![^>]*>|<\?[^>]*>/g, '')
  const out: string[] = []
  const open: string[] = []
  let muted: string | null = null
  const re = /<(\/?)([a-z][a-z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/gi
  let at = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    if (muted === null) out.push(escapeText(src.slice(at, m.index)))
    at = m.index + m[0].length
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    if (muted !== null) { if (closing && tag === muted) muted = null; continue }
    if (MUTE.has(tag)) { if (!closing && m[4] !== '/') muted = tag; continue }
    const allowed = ALLOWED[tag]
    if (!allowed) continue
    if (closing) {
      if (VOID.has(tag)) continue
      /* Close it only if it is open, and everything opened inside it with it -- the output always nests. */
      const i = open.lastIndexOf(tag)
      if (i < 0) continue
      while (open.length > i) out.push(`</${open.pop()}>`)
      continue
    }
    const attrs: string[] = []
    const attrRe = /([a-z][a-z0-9-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/gi
    let a: RegExpExecArray | null
    while ((a = attrRe.exec(m[3])) !== null) {
      const name = a[1].toLowerCase()
      if (!allowed.includes(name)) continue
      const value = decodeEntities(a[3] ?? a[4] ?? a[5] ?? '')
      if (name === 'style') { const st = cleanStyle(value); if (st) attrs.push(`style="${escapeAttr(st)}"`); continue }
      if (name === 'href') { const h = safeHref(value); if (h) attrs.push(`href="${escapeAttr(h)}"`); continue }
      if (name === 'src') { const h = safeImgSrc(value); if (h) attrs.push(`src="${escapeAttr(h)}"`); continue }
      if (['width', 'height', 'cellpadding', 'cellspacing', 'border', 'colspan', 'rowspan', 'size'].includes(name)) {
        if (/^\d{1,4}%?$/.test(value)) attrs.push(`${name}="${value}"`)
        continue
      }
      if (name === 'color') { if (/^#[0-9a-f]{3,8}$|^[a-z]+$/i.test(value)) attrs.push(`color="${value}"`); continue }
      if (['align', 'valign'].includes(name)) { if (/^(left|right|center|top|middle|bottom|justify)$/i.test(value)) attrs.push(`${name}="${value.toLowerCase()}"`); continue }
      attrs.push(`${name}="${escapeAttr(value.slice(0, 200))}"`)
    }
    /* A picture with nothing safe to show is no picture. */
    if (tag === 'img' && !attrs.some((x) => x.startsWith('src='))) continue
    out.push(`<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`)
    if (!VOID.has(tag)) open.push(tag)
  }
  if (muted === null) out.push(escapeText(src.slice(at)))
  while (open.length) out.push(`</${open.pop()}>`)
  return out.join('').trim()
}

/** The body as stored: the marker and the sanitised HTML. */
export function storeHtmlBody(html: string): string {
  return `${EMAIL_HTML_MARKER}${sanitiseCampaignHtml(html)}`
}

/** An old plain-text body, turned into the editor's HTML once -- a blank line a paragraph, a newline a line. */
export function textToEmailHtml(text: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return (text ?? '').trim().split(/\n\s*\n/).filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>')}</p>`).join('')
}

/**
 * THE PLAIN-TEXT TWIN every bulk email must carry (a message with no text part reads as spam to the filters):
 * paragraphs and lines kept, links written out after their words.
 */
export function emailHtmlToText(html: string): string {
  return sanitiseCampaignHtml(html)
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, words: string) => {
      const w = words.replace(/<[^>]+>/g, '').trim()
      return w && w !== href ? `${w} (${href})` : href
    })
    .replace(/<br>/gi, '\n')
    .replace(/<\/(p|div|h[1-4]|li|tr|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<hr[^>]*>/gi, '\n----\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Paragraph spacing an inbox will honour. A <p> with no margin of its own is drawn with whatever each mail
 * client picks (Outlook: none), so the editor's paragraphs are given an explicit one on the way out -- the
 * emailStyle.ts lesson ("a blank line is a PARAGRAPH"), in HTML.
 */
export function withEmailParagraphs(html: string): string {
  return html.replace(/<p(?![^>]*style=)([^>]*)>/gi, '<p$1 style="margin:0 0 12pt">')
}

/**
 * WHETHER A BODY SAYS ANYTHING. An HTML body is never "" -- it carries the marker, and an emptied editor leaves
 * a `<p><br></p>` -- so "is there a body" is asked of its words and pictures, never of its length. The queue
 * refuses an empty one with this, on the server as on the screen.
 */
export function campaignBodyEmpty(body: string | null | undefined): boolean {
  if (!isHtmlBody(body)) return !(body ?? '').trim()
  const clean = sanitiseCampaignHtml(body ?? '')
  return !emailHtmlToText(clean).replace(/\u00a0/g, ' ').trim() && !/<img\b/i.test(clean)
}
