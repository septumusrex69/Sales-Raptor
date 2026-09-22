/**
 * Making a stranger's email readable without letting it do anything.
 *
 * WHY THIS EXISTS. Until now Raptor showed every message as plain text: the HTML was flattened on
 * the server and thrown away, on the reasoning that markup from outside the building has no
 * business in the page. That reasoning is still right about the PAGE. It was wrong about the
 * message — a newsletter read as a wall of unlinked headings, and the first person to hit it
 * reported exactly the two symptoms that follow from flattening: "it had pictures in it that I
 * didn't download, and there's links there that I should press on, but it doesn't work."
 *
 * So the HTML now crosses to the browser and is rendered — but inside a sandboxed iframe, never
 * in the app's own DOM. THAT is what changed. The markup is still treated as hostile; it is
 * simply given somewhere to be hostile where nothing is listening. Three layers, in order of how
 * much I trust them:
 *
 *  1. The iframe's sandbox has no `allow-scripts`. That is a browser-level hard block on every
 *     way HTML has of running code — inline scripts, event handlers, `javascript:` hrefs — and it
 *     does not depend on this file being correct.
 *  2. A `Content-Security-Policy` meta in the document, written below: `default-src 'none'`, and
 *     images limited to `data:` until the reader asks for more. This is the layer that actually
 *     keeps the promise about remote pictures, because it holds even where the scan misses a way
 *     of naming a URL.
 *  3. This scan, which removes the obvious dangers and rewrites the URLs. It is the layer that
 *     can be got wrong, which is why it is the one with the check script beside it.
 *
 * WHY REMOTE PICTURES ARE OFF UNTIL ASKED FOR. A picture fetched from somebody else's server tells
 * that server the message was opened, by whom and when. In debt collection that is not an abstract
 * privacy point: it tells a debtor's attorney the letter landed and was read at 14:12 on Tuesday.
 * The pictures the message was written WITH — signatures, logos — already cross as data: URIs and
 * are shown immediately, because they cost nobody anything. Only the ones that would need a
 * request wait for a person to press the button.
 *
 * Pure and dependency-free: a string in, a string out, no DOM. Not tidiness — it means the rules
 * can be broken on purpose and checked in a second, without a browser. See
 * scripts/qa/check-email-html.mjs.
 */

/** A picture that came with the message, carried inline. Mirrors InlineImage in userMail. */
export interface EmailPicture {
  cid: string
  filename: string
  dataUri: string
}

export interface SafeEmail {
  /** A whole document, ready for an iframe's srcdoc. */
  html: string
  /**
   * How many references to somebody else's server were refused.
   *
   * Used as a yes/no — the banner says pictures were not downloaded and does NOT put a number on
   * it, because one background-image in a stylesheet counts here and would not count to a reader.
   * A warning carrying a figure a person can see is wrong is worse than a warning with no figure.
   */
  blockedRemote: number
  /**
   * The cids the message actually drew into itself.
   *
   * The reading pane lists the message's pictures underneath it. Once the HTML is rendered, the
   * signature is already visible inside it, and listing it again underneath shows the same logo
   * twice. This is how the pane knows which ones the message did NOT place for itself.
   */
  usedCids: string[]
}

/* ------------------------------------------------------------------ *
 * Which elements survive.
 * ------------------------------------------------------------------ */

/**
 * Gone, and their contents with them.
 *
 * `title` is here because dropping only the tag would leave a newsletter's browser title sitting
 * at the top of the message as a stray line of prose. `svg` and `math` are here because both can
 * carry script and neither appears in real business mail — email clients barely support them.
 */
const DROP_WITH_CONTENT = new Set([
  'script', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'svg', 'math', 'template', 'title', 'form', 'button', 'select', 'textarea',
  'audio', 'video', 'canvas', 'map',
])

/**
 * Gone, but whatever was inside them stays.
 *
 * The document wrapper is rebuilt below, so the email's own `html`/`head`/`body`/`base`/`meta`
 * are dropped rather than nested inside ours — a second `<base>` would quietly beat the one that
 * sends links to a new tab.
 */
const DROP_TAG_ONLY = new Set([
  'html', 'head', 'body', 'base', 'meta', 'link', 'input', 'source', 'track', 'param', 'area',
])

/** Attributes that are a request, a handler or a target by another name. */
const DROP_ATTRS = new Set([
  'srcset', 'ping', 'formaction', 'background', 'dynsrc', 'lowsrc', 'usemap', 'action',
  'method', 'target', 'rel', 'nonce', 'integrity', 'srcdoc', 'poster', 'data',
  'xlink:href', 'xmlns:xlink', 'http-equiv',
])

/**
 * One transparent pixel, used to stand in for a picture that was not fetched.
 *
 * A src-less `<img>` draws the browser's own broken-picture glyph and its alt text, which says
 * "this page is faulty" rather than "you have not asked for this yet". A transparent pixel in a
 * box drawn by the stylesheet says the second thing.
 */
const NOTHING = 'data:image/gif;base64,'
  + 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/**
 * Is this remote picture too small to be a picture?
 *
 * A 1x1 on somebody else's server is a tracking pixel — its entire job is to report that the
 * message was opened. It is dropped outright rather than blocked, and it is NOT counted towards
 * the banner, for two separate reasons. A dashed placeholder box drawn where a 1x1 was is a
 * warning about something the reader cannot see and would not care about. And counting it would
 * put "pictures were not downloaded" on a message whose only remote picture is invisible — a
 * warning that fires when nothing is wrong, which is how people learn to stop reading warnings.
 *
 * Dropped even when pictures HAVE been asked for: somebody asking to see the pictures is not
 * asking for the sender to be told they read it.
 */
function isTracker(tag: TagToken): boolean {
  const size = (name: string): number | null => {
    const raw = tag.attrs.find((a) => a.name === name)?.value
    const n = raw === undefined || raw === null ? NaN : Number(raw.replace(/px$/i, '').trim())
    return Number.isFinite(n) ? n : null
  }
  const w = size('width')
  const h = size('height')
  return (w !== null && w <= 4) || (h !== null && h <= 4)
}

/** Schemes a link may point at. Everything else — `javascript:`, `data:`, `vbscript:` — is dropped. */
const LINK_SCHEME = /^(?:https?:|mailto:|tel:|#)/

/* ------------------------------------------------------------------ *
 * Reading the markup.
 * ------------------------------------------------------------------ */

/**
 * Undo the entity forms a URL can hide a scheme behind.
 *
 * `java&#115;cript:` is the same string to a browser and a different string to a regular
 * expression, so the scheme test below runs on the decoded value. Only the numeric forms and the
 * five named entities matter here; anything else cannot spell a scheme.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

/**
 * The form of a URL that a scheme test can be trusted against: entities undone, control
 * characters and whitespace removed (a browser ignores a tab inside `java\tscript:`), lowercased.
 */
function normaliseUrl(value: string): string {
  // eslint-disable-next-line no-control-regex
  return decodeEntities(value).replace(/[\u0000- \u007f]/g, '').toLowerCase()
}

/** Put a value back into an attribute. `&` is left alone so `?a=1&amp;b=2` survives a round trip. */
const quoteAttr = (value: string): string => value.replace(/"/g, '&quot;').replace(/</g, '&lt;')

interface Attr { name: string; value: string | null }

interface TagToken {
  kind: 'tag'
  name: string
  closing: boolean
  attrs: Attr[]
  selfClosing: boolean
}

type Token = { kind: 'text'; text: string } | TagToken

/**
 * Split markup into text and tags.
 *
 * Hand-rolled rather than `/<[^>]+>/`, and that is the whole point of it: a `>` inside a quoted
 * attribute value ends the tag as far as that regular expression is concerned, which is the
 * oldest way there is of smuggling an attribute past a scan. Quotes are tracked here, so
 * `<img src="a>b" onerror="...">` is one tag with two attributes and the handler is found.
 */
function tokenise(html: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt < 0) { out.push({ kind: 'text', text: html.slice(i) }); break }
    if (lt > i) out.push({ kind: 'text', text: html.slice(i, lt) })

    // Comments go, including the conditional kind, which exists to hide markup from some readers
    // and show it to others — a shape there is never a good reason to carry forward.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      i = end < 0 ? html.length : end + 3
      continue
    }
    // Doctype and processing instructions: nothing to keep, and the wrapper writes its own.
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt)
      i = end < 0 ? html.length : end + 1
      continue
    }
    const nameMatch = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt))
    if (!nameMatch) {
      // A bare `<` in prose — "5 < 6". Text, not a tag.
      out.push({ kind: 'text', text: '<' })
      i = lt + 1
      continue
    }
    const closing = nameMatch[1] === '/'
    const name = nameMatch[2].toLowerCase()
    let j = lt + nameMatch[0].length
    const attrs: Attr[] = []
    let selfClosing = false
    while (j < html.length) {
      while (j < html.length && /\s/.test(html[j])) j += 1
      if (html[j] === '>') { j += 1; break }
      if (html[j] === '/' && html[j + 1] === '>') { selfClosing = true; j += 2; break }
      if (j >= html.length) break
      const start = j
      while (j < html.length && !/[\s=>/]/.test(html[j])) j += 1
      if (j === start) { j += 1; continue }
      const attrName = html.slice(start, j).toLowerCase()
      while (j < html.length && /\s/.test(html[j])) j += 1
      let value: string | null = null
      if (html[j] === '=') {
        j += 1
        while (j < html.length && /\s/.test(html[j])) j += 1
        const quote = html[j]
        if (quote === '"' || quote === "'") {
          const end = html.indexOf(quote, j + 1)
          value = html.slice(j + 1, end < 0 ? html.length : end)
          j = end < 0 ? html.length : end + 1
        } else {
          const vs = j
          while (j < html.length && !/[\s>]/.test(html[j])) j += 1
          value = html.slice(vs, j)
        }
      }
      attrs.push({ name: attrName, value })
    }
    out.push({ kind: 'tag', name, closing, attrs, selfClosing })
    i = j
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Rewriting what the message points at.
 * ------------------------------------------------------------------ */

interface Context {
  pictures: Map<string, string>
  showPictures: boolean
  blocked: { count: number }
  used: Set<string>
}

/**
 * What one `src` or `url()` should become.
 *
 * `null` means "there is nothing safe to point at" — the caller drops the attribute rather than
 * leaving a dead one behind. A `cid:` reference is the picture the message carried with it, so it
 * is swapped for the bytes already in hand; that is the case that makes a signature appear
 * without anybody asking permission, because it costs no request.
 */
function resolveSource(raw: string, ctx: Context): string | null {
  const url = normaliseUrl(raw)
  if (url.startsWith('cid:')) {
    const key = url.slice(4).replace(/^<|>$/g, '')
    const hit = ctx.pictures.get(key)
    if (!hit) return null
    ctx.used.add(key)
    return hit
  }
  if (url.startsWith('data:image/')) return raw.trim()
  if (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('//')) {
    if (ctx.showPictures) return raw.trim()
    ctx.blocked.count += 1
    return null
  }
  return null
}

/**
 * Clean one piece of CSS, whether it came from a `style` attribute or a `<style>` block.
 *
 * Stylesheets are kept rather than thrown away, because table-and-inline-style mail is what bulk
 * senders write and stripping the CSS turns a newsletter into a column of stacked cells. Inside an
 * iframe a stylesheet can do nothing to the app around it — the containment is free — so all that
 * is left to deal with is the handful of CSS constructs that make a REQUEST or run code.
 */
function sanitiseCss(css: string, ctx: Context): string {
  return css
    // `@import` is a stylesheet fetch, and no stylesheet from outside is wanted at any point.
    .replace(/@import[^;]*;?/gi, '')
    // Ancient IE, but free to close: both of these run script from a declaration.
    .replace(/expression\s*\(/gi, 'void(')
    .replace(/-moz-binding\s*:[^;]*/gi, '')
    .replace(/behaviou?r\s*:[^;]*/gi, '')
    .replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (_m, _q, raw: string) => {
      const resolved = resolveSource(raw, ctx)
      // about:blank rather than removing the declaration: a cell that was a background image keeps
      // its size, so the layout does not collapse around the gap.
      return `url("${resolved ? resolved.replace(/"/g, '%22') : 'about:blank'}")`
    })
}

/** Rebuild one opening tag with only the attributes that survive, or '' to drop it. */
function renderTag(tag: TagToken, ctx: Context): string {
  if (tag.name === 'img') {
    const raw = tag.attrs.find((a) => a.name === 'src')?.value ?? ''
    const url = normaliseUrl(raw)
    const remote = url.startsWith('http:') || url.startsWith('https:') || url.startsWith('//')
    if (remote && isTracker(tag)) return ''
  }
  const kept: string[] = []
  for (const attr of tag.attrs) {
    const { name } = attr
    // Every event handler there is, by shape rather than by list — `onerror`, `onload`, and the
    // one added to HTML next year.
    if (name.startsWith('on')) continue
    if (DROP_ATTRS.has(name)) continue
    if (attr.value === null) { kept.push(name); continue }

    if (name === 'href') {
      if (!LINK_SCHEME.test(normaliseUrl(attr.value))) continue
      kept.push(`href="${quoteAttr(attr.value.trim())}"`)
      continue
    }
    if (name === 'src') {
      const resolved = resolveSource(attr.value, ctx)
      /*
       * A transparent pixel and a mark, rather than no src at all. The stylesheet draws the hole
       * where the picture would be; leaving the src off draws the browser's broken-picture glyph
       * instead, which reads as a fault in Raptor rather than as a decision the reader has not
       * taken yet.
       */
      if (!resolved) { kept.push(`src="${NOTHING}"`, 'data-blocked="1"'); continue }
      kept.push(`src="${quoteAttr(resolved)}"`)
      continue
    }
    if (name === 'style') {
      kept.push(`style="${quoteAttr(sanitiseCss(attr.value, ctx))}"`)
      continue
    }
    kept.push(`${name}="${quoteAttr(attr.value)}"`)
  }
  /*
   * EVERY LINK LEAVES. Raptor is a single-page app: a link that navigated in place would throw
   * away whatever the collector had on screen, and inside the frame it would replace the message
   * with somebody else's website. `rel` is forced for the same reason it always is — the opened
   * page must not get a handle on the window that opened it, nor the address it came from.
   */
  if (tag.name === 'a') {
    kept.push('target="_blank"', 'rel="noopener noreferrer"')
  }
  return `<${tag.name}${kept.length ? ` ${kept.join(' ')}` : ''}>`
}

/* ------------------------------------------------------------------ *
 * The document that goes into the frame.
 * ------------------------------------------------------------------ */

/**
 * The layer that does not depend on this file being right.
 *
 * `default-src 'none'` means the document may not fetch anything at all: no script, no font, no
 * stylesheet, no frame. Pictures are allowed from `data:` — the ones that came with the message —
 * and from `https:` only once a person has pressed the button. Inline style is allowed because
 * that is how mail is written and a stylesheet cannot make a request once `url()` has been dealt
 * with above.
 */
const policy = (showPictures: boolean): string => [
  "default-src 'none'",
  `img-src data:${showPictures ? ' https: http:' : ''}`,
  "style-src 'unsafe-inline'",
  "font-src data:",
  // Not a fetch — where a link may point when somebody presses it.
  'form-action \'none\'',
].join('; ')

/**
 * A plain reading style for the frame.
 *
 * Deliberately light. The message is meant to look like the message; this sets a readable default
 * for mail that brings no styling of its own and stops a fixed-width newsletter pushing the
 * reading pane sideways.
 */
const FRAME_CSS = `
html,body{margin:0;padding:0;background:#fff;}
body{font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#334155;
  word-break:break-word;overflow-wrap:anywhere;}
img{max-width:100%;height:auto;}
table{max-width:100%;}
a{color:#0f766e;}
blockquote{margin:0 0 0 12px;padding-left:10px;border-left:2px solid #e2e8f0;color:#64748b;}
/* A hole the size of the column, not the size of the picture: the picture's own height is
   unknown until it is fetched, and a 1x1 stand-in stretched to the declared width would reserve
   a square the height of the reading pane. */
img[data-blocked]{height:88px;max-height:88px;background:#f1f5f9;
  border:1px dashed #cbd5e1;border-radius:3px;}
`.trim()

/* ------------------------------------------------------------------ *
 * The one exported job.
 * ------------------------------------------------------------------ */

/**
 * Turn a message's HTML into a document safe to put in a sandboxed frame.
 *
 * `showPictures` is the reader's own decision and defaults to no. Nothing here fetches anything:
 * the pictures that arrive are the ones that came in the message.
 */
export function sanitizeEmailHtml(
  html: string,
  options: { images?: EmailPicture[]; showPictures?: boolean } = {},
): SafeEmail {
  const { body, ctx } = sanitiseBody(html, options)

  return {
    html: [
      '<!doctype html><html><head><meta charset="utf-8">',
      `<meta http-equiv="Content-Security-Policy" content="${policy(ctx.showPictures)}">`,
      // Somebody else's server learns nothing about where the picture was being read.
      '<meta name="referrer" content="no-referrer">',
      '<base target="_blank">',
      `<style>${FRAME_CSS}</style>`,
      '</head><body>',
      body,
      '</body></html>',
    ].join(''),
    blockedRemote: ctx.blocked.count,
    usedCids: [...ctx.used],
  }
}

/**
 * The same cleaning, WITHOUT the document around it.
 *
 * FOR A FORWARD, where the original has to go inside a message we are sending rather than into a
 * frame we are showing. THE FIRM: "I forwarded this email from Raptor and this is what it looks
 * like" -- a table of corrections arriving at a client as a column of stacked lines.
 *
 * A forward quoted the message's PLAIN TEXT part, which for a table is every cell on its own
 * line. That was a deliberate choice and the reasoning is still right for a REPLY, where the
 * quote is prose; it is wrong for a forward, where the thing being sent on may be the table
 * itself.
 *
 * The wrapper cannot come with it: the frame's document carries a Content-Security-Policy meta,
 * a `<base target="_blank">` and a stylesheet meant for an iframe, and a whole second `<html>`
 * inside a mail body is what mail clients strip -- which would put the table straight back where
 * it started. So the body alone, cleaned by the same pass.
 */
export function sanitizeEmailFragment(
  html: string,
  options: { images?: EmailPicture[]; showPictures?: boolean } = {},
): { html: string; blockedRemote: number; usedCids: string[] } {
  const { body, ctx } = sanitiseBody(html, options)
  return { html: body, blockedRemote: ctx.blocked.count, usedCids: [...ctx.used] }
}

/** The token loop both of the above share. Everything dangerous is refused here, once. */
function sanitiseBody(
  html: string,
  options: { images?: EmailPicture[]; showPictures?: boolean },
): { body: string; ctx: Context } {
  const ctx: Context = {
    pictures: new Map(
      (options.images ?? [])
        .filter((img) => img.cid)
        // A cid is written `<abc@host>` in the header and `cid:abc@host` in the markup; the
        // brackets are not part of it and the two sides have to agree or nothing matches.
        .map((img) => [img.cid.replace(/^<|>$/g, '').toLowerCase(), img.dataUri] as const),
    ),
    showPictures: options.showPictures === true,
    blocked: { count: 0 },
    used: new Set<string>(),
  }

  const out: string[] = []
  /* A stack rather than a flag: `<script>` inside `<form>` inside `<svg>` all close in turn, and
     one boolean would let the first `</svg>` turn the text back on. */
  let skipping: string[] = []
  let inStyle = false

  for (const token of tokenise(html)) {
    if (token.kind === 'text') {
      if (skipping.length) continue
      out.push(inStyle ? sanitiseCss(token.text, ctx) : token.text)
      continue
    }
    if (DROP_WITH_CONTENT.has(token.name)) {
      if (token.closing) {
        const at = skipping.lastIndexOf(token.name)
        if (at >= 0) skipping = skipping.slice(0, at)
      } else if (!token.selfClosing) {
        skipping.push(token.name)
      }
      continue
    }
    if (skipping.length) continue
    if (DROP_TAG_ONLY.has(token.name)) continue
    /*
     * The stylesheet the message brought is KEPT, with its URLs rewritten above.
     *
     * Bulk mail is written as tables and stylesheets and throwing the stylesheet away turns a
     * newsletter into a column of stacked cells — which is a different way of failing to show
     * somebody their message, not a fix for it. Inside the frame a stylesheet reaches nothing:
     * the containment is free, so the only question was whether it could make a REQUEST, and
     * sanitiseCss is where that is answered.
     */
    if (token.name === 'style') {
      inStyle = !token.closing
      out.push(token.closing ? '</style>' : '<style>')
      continue
    }
    out.push(token.closing ? `</${token.name}>` : renderTag(token, ctx))
  }

  return { body: out.join(''), ctx }
}
