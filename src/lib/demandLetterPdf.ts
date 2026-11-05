/**
 * THE LETTER OF DEMAND AS A PDF -- DRAWN FROM THE PAGE ITSELF (S13, Ryno's builder, 3 Nov).
 *
 * Ryno's own builder made its PDF by reading the A4 sheet on screen word by word -- where each word sits,
 * in which font, size and colour, and every filled box and rule -- and drawing exactly that onto his
 * letterhead. It is why his PDF matches his preview to the point: the line breaks are the browser's, so
 * there is no second layout to drift. The same approach here, with pdf-lib (already in Raptor, so nothing
 * new is installed) instead of the jsPDF his page carried.
 *
 * NOT src/lib/letterPdf.ts. That is the collections notices' renderer, which lays a template out itself
 * from a plan; this one has no plan, only the sheet. The two do different jobs and are kept apart.
 *
 * KEPT, UNLIKE THOSE NOTICES. letterPdf.ts makes its PDF and keeps nothing, because a notice can be drawn
 * again from its template and the account (the firm: "the PDF doesn't necessarily need to be saved").
 * This letter cannot: its invoices and wording were typed by a person and are nowhere else. So the page
 * files a copy on the client, and on the account where there is one -- the copy is the only record of
 * what was demanded (agreed with Ryno, 3 Nov).
 *
 * IN THE BROWSER: it reads the page's own measurements, and api/email/send already takes the bytes.
 */
import type { PDFFont, PDFPage } from 'pdf-lib'

/** A4 in points, and the sheet's own margins -- Ryno's numbers. */
export const PT = 0.75
export const PAGE_W = 595.28
export const PAGE_H = 841.89
export const BODY_TOP = 94
export const BODY_BOTTOM = 778

/** The faces the sheet is set in, by the family names the page loads them under. */
export const SERIF_FAMILY = 'LOD Serif'
export const SANS_FAMILY = 'LOD Sans'
export const FONT_FILES = {
  NSR: 'NotoSerif-Regular.ttf', NSSB: 'NotoSerif-SemiBold.ttf', NSB: 'NotoSerif-Bold.ttf',
  INR: 'Inter-Regular.ttf', INSB: 'Inter-SemiBold.ttf',
} as const
export type FontKey = keyof typeof FONT_FILES
export const ASSET_BASE = '/letters/demand/'
/** Ascent as a share of the line box, per face (Ryno's measurements), to put each word on its baseline. */
const ASCENT = { serif: 1069 / 1362, sans: 1984 / 2478 }

/** Which file a run of text is drawn in, from its computed style. */
export function fontKeyFor(fontFamily: string, fontWeight: string | number): FontKey {
  const w = typeof fontWeight === 'number' ? fontWeight : parseInt(fontWeight, 10) || 400
  if (fontFamily.includes(SANS_FAMILY)) return w >= 550 ? 'INSB' : 'INR'
  return w >= 650 ? 'NSB' : w >= 550 ? 'NSSB' : 'NSR'
}

/** "rgb(31, 46, 61)" -> [31, 46, 61]; transparent -> null. */
export function parseRgb(c: string): [number, number, number] | null {
  const m = c.match(/[\d.]+/g)
  if (!m || m.length < 3) return null
  if (m.length > 3 && Number(m[3]) === 0) return null
  return [Number(m[0]), Number(m[1]), Number(m[2])]
}

interface Box { x: number; y: number; w: number; h: number; c: [number, number, number] }
interface Word { t: string; x: number; y: number; f: FontKey; s: number; c: [number, number, number]; cs: number }
export interface SheetDrawing { pages: number; boxes: Box[]; words: Word[] }

/**
 * READ ONE SHEET OFF THE PAGE, in points from its top-left corner. The caller has already taken any scaling
 * off (the preview shrinks the sheet to fit an iPad), so a CSS pixel is 0.75pt here.
 */
export function readSheet(sheet: HTMLElement): SheetDrawing {
  const pages = Math.round(parseFloat(sheet.style.minHeight) / PAGE_H) || 1
  const base = sheet.getBoundingClientRect()
  /*
   * THE SHEET'S OWN SCALE, MEASURED, NOT ASSUMED. The preview shrinks the sheet to fit the screen, and React can
   * put that shrink back between the caller taking it off and this reading the page -- which drew every word at
   * nine tenths of its place in full-size type, and the spaces between words vanished. Dividing by what the
   * sheet actually measures against its own width makes the reading right at any scale.
   */
  const k = sheet.offsetWidth ? base.width / sheet.offsetWidth : 1
  const X = (v: number) => ((v - base.left) / k) * PT
  const Y = (v: number) => ((v - base.top) / k) * PT
  const skip = (el: Element) => !!el.closest('.ui') || !!el.closest('.pgmark')
  const boxes: Box[] = []
  const words: Word[] = []
  sheet.querySelectorAll<HTMLElement>('*').forEach((el) => {
    if (skip(el)) return
    const cs = getComputedStyle(el)
    if (cs.display === 'none') return
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return
    const bg = parseRgb(cs.backgroundColor)
    const W = (v: number) => (v / k) * PT
    if (bg && !(bg[0] === 255 && bg[1] === 255 && bg[2] === 255)) boxes.push({ x: X(r.left), y: Y(r.top), w: W(r.width), h: W(r.height), c: bg })
    for (const side of ['Top', 'Bottom', 'Left', 'Right'] as const) {
      const bw = parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`))
      const bc = parseRgb(cs.getPropertyValue(`border-${side.toLowerCase()}-color`))
      if (!bw || !bc || cs.getPropertyValue(`border-${side.toLowerCase()}-style`) === 'none') continue
      const t = bw * PT
      if (side === 'Top') boxes.push({ x: X(r.left), y: Y(r.top), w: W(r.width), h: t, c: bc })
      if (side === 'Bottom') boxes.push({ x: X(r.left), y: Y(r.bottom) - t, w: W(r.width), h: t, c: bc })
      if (side === 'Left') boxes.push({ x: X(r.left), y: Y(r.top), w: t, h: W(r.height), c: bc })
      if (side === 'Right') boxes.push({ x: X(r.right) - t, y: Y(r.top), w: t, h: W(r.height), c: bc })
    }
  })
  const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const p = n.parentElement
    if (!p || skip(p)) continue
    const cs = getComputedStyle(p)
    if (cs.display === 'none') continue
    const f = fontKeyFor(cs.fontFamily, cs.fontWeight)
    const size = parseFloat(cs.fontSize) * PT
    const c = parseRgb(cs.color) ?? [0, 0, 0]
    const ls = parseFloat(cs.letterSpacing)
    const asc = cs.fontFamily.includes(SANS_FAMILY) ? ASCENT.sans : ASCENT.serif
    for (const m of n.data.matchAll(/\S+/g)) {
      range.setStart(n, m.index ?? 0)
      range.setEnd(n, (m.index ?? 0) + m[0].length)
      const rr = range.getClientRects()[0]
      if (!rr) continue
      words.push({ t: m[0], x: X(rr.left), y: Y(rr.top) + (rr.height / k) * PT * asc, f, s: size, c, cs: Number.isFinite(ls) ? ls * PT : 0 })
    }
  }
  return { pages, boxes, words }
}

/** The fonts and the letterhead, fetched once and kept for the next PDF. */
let assets: Promise<{ fonts: Record<FontKey, ArrayBuffer>; letterhead: ArrayBuffer }> | null = null
function loadAssets() {
  assets ??= (async () => {
    const get = async (f: string) => {
      const r = await fetch(`${ASSET_BASE}${f}`)
      if (!r.ok) throw new Error(`The letter's ${f} could not be loaded.`)
      return r.arrayBuffer()
    }
    const keys = Object.keys(FONT_FILES) as FontKey[]
    const bytes = await Promise.all(keys.map((k) => get(FONT_FILES[k])))
    return { fonts: Object.fromEntries(keys.map((k, i) => [k, bytes[i]])) as Record<FontKey, ArrayBuffer>, letterhead: await get('letterhead.jpg') }
  })().catch((e) => { assets = null; throw e })
  return assets
}

/**
 * THE PDF, every page on the letterhead. Words are drawn one by one where the browser put them; a label
 * set with letter-spacing is drawn a character at a time, because pdf-lib has no character spacing of its own.
 */
export async function sheetToPdf(drawing: SheetDrawing, meta: { title: string }): Promise<Uint8Array> {
  const [{ PDFDocument, rgb }, fontkit, { fonts, letterhead }] = await Promise.all([
    import('pdf-lib'), import('@pdf-lib/fontkit').then((m) => m.default), loadAssets(),
  ])
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  pdf.setTitle(meta.title)
  pdf.setAuthor('Bredell Ferreira')
  pdf.setCreator('Raptor')
  const embedded = {} as Record<FontKey, PDFFont>
  /*
   * NO LIGATURES, here or on the sheet (letterOfDemand.css). Each word is drawn where the browser put it; a browser
   * that joined "fl" into one glyph and a PDF that did not (or the other way round) put "reflected on" down as
   * "refl ectedon". Whole fonts, not subsets: they are small, and fontkit's subsetting is the less tried path.
   */
  const features = { liga: false, clig: false, dlig: false, rlig: false, calt: false }
  for (const k of Object.keys(fonts) as FontKey[]) embedded[k] = await pdf.embedFont(fonts[k], { features })
  const bg = await pdf.embedJpg(letterhead)
  const colour = (c: [number, number, number]) => rgb(c[0] / 255, c[1] / 255, c[2] / 255)

  const drawWord = (page: PDFPage, w: Word, y: number) => {
    const font = embedded[w.f]
    if (!w.cs) { page.drawText(w.t, { x: w.x, y, size: w.s, font, color: colour(w.c) }); return }
    let x = w.x
    for (const ch of w.t) {
      page.drawText(ch, { x, y, size: w.s, font, color: colour(w.c) })
      x += font.widthOfTextAtSize(ch, w.s) + w.cs
    }
  }

  for (let p = 0; p < drawing.pages; p += 1) {
    const page = pdf.addPage([PAGE_W, PAGE_H])
    page.drawImage(bg, { x: 0, y: 0, width: PAGE_W, height: PAGE_H })
    const top = p * PAGE_H
    const onPage = (y: number) => y >= top && y < top + PAGE_H
    for (const b of drawing.boxes.filter((b) => onPage(b.y))) {
      page.drawRectangle({ x: b.x, y: PAGE_H - (b.y - top) - b.h, width: b.w, height: b.h, color: colour(b.c) })
    }
    for (const w of drawing.words.filter((w) => onPage(w.y))) drawWord(page, w, PAGE_H - (w.y - top))
  }
  return pdf.save()
}

/** Bytes to base64 for /api/email/send, in chunks so a long letter does not overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
