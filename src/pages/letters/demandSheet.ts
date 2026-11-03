import { PDFDocument, rgb as pdfRgb, setCharacterSpacing, type PDFFont, type PDFImage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { amountDue, cleanParagraph, fmtRand, numberWord, parseAmt, type LetterState } from '../../lib/letterOfDemand'
import { SHEETS_HTML, SHEET_CSS } from './demandMarkup'

/**
 * THE TWO SHEETS, DRAWN AND PRINTED -- Ryno's builder's own method, kept (Raptor · Handover 16, 3 Nov).
 *
 * His builder lays the letter out as an A4 page in the browser, paginates it there, and then PRINTS WHAT IS ON THE
 * SCREEN: every word's position and every coloured box are measured off the page and redrawn in a PDF, on his
 * letterhead, in the same two typefaces. So what was checked on screen is what goes, break for break. It is kept
 * as he wrote it, ported from jsPDF to pdf-lib (which Raptor already carries) and nothing else changed.
 *
 * AN ISLAND, NOT REACT. The sheets are plain DOM inside one host element that React never re-renders: pagination
 * inserts its own spacer and page-mark elements between paragraphs, and React reconciling around nodes it did not
 * make is how a page throws "insertBefore" on the fortieth keystroke. React owns the form; this owns the paper.
 *
 * THE PREVIEW IS PHOTOGRAPHED DOWN; THE WORDING EDITOR IS NOT. A preview may be `transform: scale()`d to fit the
 * column (CLAUDE.md), but a browser hit-tests the caret in unscaled coordinates, so "Edit the wording" draws the
 * sheet at full size and lets its column scroll sideways rather than leaving a caret that lands beside the click.
 */

const PT = 0.75
export const PH = 841.89
export const PW = 595.28
const TOP = 94
const BOT = 778
const ASC = { serif: 1069 / 1362, sans: 1984 / 2478 }
const PH_ROW: Record<string, string> = { inv: '[Invoice no.]', date: '[Date]', ref: '[Ref. no.]', desc: '[Description]', amt: '[Amount]' }
const FONT_FILES = {
  NSR: 'NotoSerif-Regular.ttf', NSSB: 'NotoSerif-SemiBold.ttf', NSB: 'NotoSerif-Bold.ttf', INR: 'Inter-Regular.ttf', INSB: 'Inter-SemiBold.ttf',
} as const
type FontKey = keyof typeof FONT_FILES
const ASSETS = '/letter-of-demand'

/* ---------- the faces on screen: loaded once per page load, as the builder did from its data: copies ---------- */
let screenFonts: Promise<void> | null = null
export function loadScreenFonts(): Promise<void> {
  if (screenFonts) return screenFonts
  const defs: [string, FontKey, string][] = [['BF Serif', 'NSR', '400'], ['BF Serif', 'NSSB', '600'], ['BF Serif', 'NSB', '700'], ['BF Sans', 'INR', '400'], ['BF Sans', 'INSB', '600']]
  screenFonts = Promise.all(defs.map(async ([fam, k, w]) => {
    try { const ff = new FontFace(fam, `url(${ASSETS}/fonts/${FONT_FILES[k]})`, { weight: w }); await ff.load(); document.fonts.add(ff) } catch { /* the sheet still draws, in Georgia */ }
  })).then(() => undefined)
  return screenFonts
}

let styleAdded = false
function addStyle() {
  if (styleAdded) return
  const st = document.createElement('style')
  st.dataset.lod = '1'
  st.textContent = SHEET_CSS
  document.head.appendChild(st)
  styleAdded = true
}

export type Which = 'letter' | 'ack'

export class DemandSheet {
  readonly island: HTMLElement
  private fit: HTMLElement
  private stack: HTMLElement
  private sheet: HTMLElement
  private ack: HTMLElement
  private rowsEl: HTMLElement
  private editing = false
  private raf = 0
  private observer: ResizeObserver | null = null

  constructor(host: HTMLElement) {
    addStyle()
    host.innerHTML = '<div class="lod-island"><section class="preview" aria-label="Preview"><div class="fit"><div class="stack"></div></div></section></div>'
    this.island = host.firstElementChild as HTMLElement
    this.fit = this.island.querySelector('.fit') as HTMLElement
    this.stack = this.island.querySelector('.stack') as HTMLElement
    this.stack.innerHTML = SHEETS_HTML
    this.sheet = this.stack.querySelector('#sheet') as HTMLElement
    this.ack = this.stack.querySelector('#ack') as HTMLElement
    this.rowsEl = this.stack.querySelector('#rows') as HTMLElement
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.rescale())
      this.observer.observe(this.island)
    }
    void loadScreenFonts().then(() => this.schedule())
  }

  destroy() { this.observer?.disconnect(); cancelAnimationFrame(this.raf) }

  /* ---------------------------------- drawing the state ---------------------------------- */

  render(s: LetterState) {
    const setCalc = (el: Element, val: string, ph: string) => {
      const empty = !String(val).trim()
      el.textContent = empty ? ph : val
      el.classList.toggle('empty', empty)
    }
    this.rowsEl.innerHTML = s.rows.map((_, i) => `<div class="row irow${i % 2 ? ' alt' : ''}">${['inv', 'date', 'ref', 'desc', 'amt']
      .map((k) => `<div><span class="calc" data-rk="${k}"></span></div>`).join('')}</div>`).join('')
    ;[...this.rowsEl.children].forEach((row, i) => row.querySelectorAll<HTMLElement>('[data-rk]').forEach((sp) => {
      const k = sp.dataset.rk as keyof LetterState['rows'][number]
      let v = s.rows[i][k]
      if (k === 'amt') { const n = parseAmt(v); v = n === null ? '' : fmtRand(n) }
      setCalc(sp, v, PH_ROW[k])
    }))
    const due = amountDue(s)
    const d = parseInt(s.days, 10)
    const vals: Record<string, [string, string]> = {
      total: [due === null ? '' : fmtRand(due), '[Amount]'],
      client: [s.client, '[Client]'], debtor: [s.debtor, '[Debtor]'], ref: [s.ref, '[Reference]'],
      days: [Number.isNaN(d) ? '' : String(d), '[7]'], daysWord: [numberWord(d) ?? '', '[seven]'],
      date: [s.date, '[Date]'], stmt: [s.stmt, '[statement date]'], services: [s.services, '[services]'],
      col3: [(s.col3 || '').toUpperCase(), 'REFERENCE'],
    }
    this.stack.querySelectorAll<HTMLElement>('.calc[data-c]').forEach((el) => {
      const v = vals[el.dataset.c ?? '']
      if (v) setCalc(el, v[0], v[1])
    })
    this.schedule()
  }

  /* ---------------------------------- the wording ---------------------------------- */

  /** Paragraphs as they are now -- the editable ones, keyed by data-p -- for a draft to keep. */
  paragraphs(): Record<string, string> {
    const out: Record<string, string> = {}
    this.stack.querySelectorAll<HTMLElement>('[data-p]').forEach((p) => { out[p.dataset.p as string] = cleanParagraph(p.innerHTML) })
    return out
  }

  /** Reworded paragraphs back onto the sheet, through the same closed set. Unknown keys are ignored. */
  applyParagraphs(edits: Record<string, string> | null | undefined) {
    if (!edits) return
    this.stack.querySelectorAll<HTMLElement>('[data-p]').forEach((p) => {
      const html = edits[p.dataset.p as string]
      if (typeof html === 'string' && html.trim()) p.innerHTML = cleanParagraph(html)
    })
  }

  /** Back to Ryno's own words. */
  resetParagraphs() {
    const tpl = document.createElement('div')
    tpl.innerHTML = SHEETS_HTML
    tpl.querySelectorAll<HTMLElement>('[data-p]').forEach((orig) => {
      const p = this.stack.querySelector<HTMLElement>(`[data-p="${orig.dataset.p}"]`)
      if (p) p.innerHTML = orig.innerHTML
    })
  }

  setEditable(on: boolean, onEdit?: () => void) {
    this.editing = on
    this.stack.querySelectorAll<HTMLElement>('[data-p]').forEach((p) => {
      if (on) {
        p.contentEditable = 'true'
        p.querySelectorAll<HTMLElement>('.calc').forEach((c) => { c.contentEditable = 'false' })
        p.oninput = () => { this.schedule(); onEdit?.() }
        /* A paste keeps its words, not its markup: Word's spans and styles have no place on the letter. */
        p.onpaste = (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '') }
        p.onkeydown = (e) => { if (e.key === 'Enter') e.preventDefault() }
      } else {
        p.removeAttribute('contenteditable')
        p.oninput = null; p.onpaste = null; p.onkeydown = null
      }
    })
    this.island.style.overflowX = on ? 'auto' : ''
    this.schedule()
  }

  /* ---------------------------------- size and pages ---------------------------------- */

  private scale() { return Number(this.stack.dataset.scale) || 1 }

  rescale() {
    const avail = this.island.clientWidth
    const w = PW / PT
    const s = this.editing ? 1 : Math.min(1, avail / w)
    this.stack.style.transform = s < 1 ? `scale(${s})` : ''
    this.fit.style.width = `${w * s}px`
    this.fit.style.height = `${this.stack.offsetHeight * s}px`
    this.stack.dataset.scale = String(s)
  }

  private ptTop(el: Element) { const sh = el.closest('.sheet') as Element; return (el.getBoundingClientRect().top - sh.getBoundingClientRect().top) / this.scale() * PT }
  private ptBot(el: Element) { const sh = el.closest('.sheet') as Element; return (el.getBoundingClientRect().bottom - sh.getBoundingClientRect().top) / this.scale() * PT }

  /** The same breaks on screen and in the PDF: a block that would cross the foot of a page starts the next. */
  private paginate(sh: HTMLElement): number {
    sh.querySelectorAll('.pgsp,.threp,.pgmark').forEach((e) => e.remove())
    sh.style.minHeight = ''
    const blocks = [...sh.querySelectorAll('.blk, .blk-th, .irow, #totrow')]
    for (let i = 0; i < blocks.length; i += 1) {
      const b = blocks[i]
      const top = this.ptTop(b)
      let bot = this.ptBot(b)
      if (b.classList.contains('blk-th') && blocks[i + 1]) bot = this.ptBot(blocks[i + 1])
      if (b.classList.contains('irow') && blocks[i + 1] && blocks[i + 1].id === 'totrow') bot = this.ptBot(blocks[i + 1])
      const page = Math.floor(top / PH)
      const limit = page * PH + BOT
      if (bot > limit && (bot - top) < (BOT - TOP)) {
        const target = (page + 1) * PH + TOP
        const sp = document.createElement('div')
        sp.className = 'pgsp'
        sp.style.height = `${target - top}pt`
        /* A table carried over to the next page repeats its heading there. */
        if ((b.classList.contains('irow') && b.previousElementSibling) || b.id === 'totrow') {
          const h = sh.querySelector('.blk-th')?.cloneNode(true) as HTMLElement | undefined
          if (h) {
            h.classList.remove('blk-th'); h.classList.add('threp')
            h.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'))
            b.before(sp, h)
          } else b.before(sp)
        } else b.before(sp)
      }
    }
    const last = sh.lastElementChild as Element
    const pages = Math.max(1, Math.floor((this.ptBot(last) - 1) / PH) + 1)
    sh.style.minHeight = `${pages * PH}pt`
    for (let p = 1; p < pages; p += 1) {
      const m = document.createElement('div')
      m.className = 'pgmark'
      m.style.top = `${p * PH}pt`
      m.innerHTML = `<span>PAGE ${p + 1}</span>`
      sh.appendChild(m)
    }
    return pages
  }

  paginateAll() { [this.sheet, this.ack].forEach((s) => this.paginate(s)); this.rescale() }
  schedule() { cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(() => this.paginateAll()) }

  pageCount(which: Which): number {
    const sh = which === 'ack' ? this.ack : this.sheet
    return Math.round(parseFloat(sh.style.minHeight) / PH) || 1
  }

  /* ---------------------------------- the PDF ---------------------------------- */

  /** Every word and box on one sheet, in PDF points from its top-left -- what the PDF redraws. */
  private collect(sh: HTMLElement) {
    const rgb = (c: string): [number, number, number] | null => {
      const m = c.match(/[\d.]+/g)
      if (!m) return null
      const a = m.length > 3 ? +m[3] : 1
      return a === 0 ? null : [+m[0], +m[1], +m[2]]
    }
    const fontKey = (cs: CSSStyleDeclaration): FontKey => {
      const sans = /BF Sans/.test(cs.fontFamily)
      const w = parseInt(cs.fontWeight, 10) || 400
      if (sans) return w >= 550 ? 'INSB' : 'INR'
      return w >= 650 ? 'NSB' : w >= 550 ? 'NSSB' : 'NSR'
    }
    const pages = Math.round(parseFloat(sh.style.minHeight) / PH) || 1
    const base = sh.getBoundingClientRect()
    const X = (v: number) => (v - base.left) * PT
    const Y = (v: number) => (v - base.top) * PT
    const boxes: { x: number; y: number; w: number; h: number; c: [number, number, number] }[] = []
    const words: { t: string; x: number; y: number; f: FontKey; s: number; c: [number, number, number]; cs: number }[] = []
    sh.querySelectorAll<HTMLElement>('*').forEach((el) => {
      if (el.closest('.ui') || el.closest('.pgmark')) return
      const cs = getComputedStyle(el)
      if (cs.display === 'none') return
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      const bg = rgb(cs.backgroundColor)
      if (bg && !(bg[0] === 255 && bg[1] === 255 && bg[2] === 255)) boxes.push({ x: X(r.left), y: Y(r.top), w: r.width * PT, h: r.height * PT, c: bg })
      for (const side of ['Top', 'Bottom', 'Left', 'Right'] as const) {
        const bw = parseFloat(cs.getPropertyValue(`border-${side.toLowerCase()}-width`))
        const bc = rgb(cs.getPropertyValue(`border-${side.toLowerCase()}-color`))
        if (!bw || !bc || cs.getPropertyValue(`border-${side.toLowerCase()}-style`) === 'none') continue
        const t = bw * PT
        if (side === 'Top') boxes.push({ x: X(r.left), y: Y(r.top), w: r.width * PT, h: t, c: bc })
        if (side === 'Bottom') boxes.push({ x: X(r.left), y: Y(r.bottom) - t, w: r.width * PT, h: t, c: bc })
        if (side === 'Left') boxes.push({ x: X(r.left), y: Y(r.top), w: t, h: r.height * PT, c: bc })
        if (side === 'Right') boxes.push({ x: X(r.right) - t, y: Y(r.top), w: t, h: r.height * PT, c: bc })
      }
    })
    const walker = document.createTreeWalker(sh, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      const p = n.parentElement
      if (!p || p.closest('.ui') || p.closest('.pgmark')) continue
      const cs = getComputedStyle(p)
      if (cs.display === 'none') continue
      const key = fontKey(cs)
      const size = parseFloat(cs.fontSize) * PT
      const col = rgb(cs.color) ?? [0, 0, 0]
      const ls = parseFloat(cs.letterSpacing)
      const cspace = Number.isFinite(ls) ? ls * PT : 0
      const asc = /BF Sans/.test(cs.fontFamily) ? ASC.sans : ASC.serif
      const re = /\S+/g
      let m: RegExpExecArray | null
      while ((m = re.exec(n.data))) {
        range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length)
        const rects = range.getClientRects()
        if (!rects.length) continue
        const rr = rects[0]
        words.push({ t: m[0], x: X(rr.left), y: Y(rr.top) + rr.height * PT * asc, f: key, s: size, c: col, cs: cspace })
      }
    }
    return { pages, boxes, words }
  }

  /**
   * ONE SHEET AS A PDF. Laid out at full size first (the preview's scale and the empty-field highlighting off),
   * measured, then put back. A character the letter's fonts cannot draw is REFUSED and named, never swapped:
   * substituting would change what the debtor is told (CLAUDE.md, the same rule as a section 129).
   */
  async pdf(which: Which, title: string): Promise<Uint8Array> {
    const target = which === 'ack' ? this.ack : this.sheet
    const was = this.editing
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    this.island.classList.add('exporting')
    this.stack.classList.add('exporting')
    this.editing = true
    try {
      this.paginateAll()
      const { pages, boxes, words } = this.collect(target)
      const [assets] = await Promise.all([pdfAssets()])
      const doc = await PDFDocument.create()
      doc.registerFontkit(fontkit)
      doc.setTitle(title)
      doc.setAuthor('Bredell Ferreira')
      doc.setCreator('Raptor')
      const fonts = {} as Record<FontKey, PDFFont>
      for (const k of Object.keys(FONT_FILES) as FontKey[]) fonts[k] = await doc.embedFont(assets.fonts[k], { subset: true })
      const can = new Map<FontKey, Set<number>>()
      for (const k of Object.keys(fonts) as FontKey[]) can.set(k, new Set(fonts[k].getCharacterSet()))
      const missing = new Set<string>()
      /* Invisible characters a paste brings are not words: dropped quietly, as winAnsi does for a tab. */
      const clean = (t: string) => t.replace(/[​-‍⁠﻿­]/g, '')
      for (const w of words) for (const ch of clean(w.t)) if (!can.get(w.f)?.has(ch.codePointAt(0) as number)) missing.add(ch)
      if (missing.size) throw new UnprintableError([...missing])
      const bg: PDFImage = await doc.embedJpg(assets.letterhead)
      for (let p = 0; p < pages; p += 1) {
        const page = doc.addPage([PW, PH])
        page.drawImage(bg, { x: 0, y: 0, width: PW, height: PH })
        const y0 = p * PH
        const onPage = (y: number) => y >= y0 && y < y0 + PH
        for (const b of boxes.filter((x) => onPage(x.y))) {
          page.drawRectangle({ x: b.x, y: PH - (b.y - y0) - b.h, width: b.w, height: b.h, color: pdfRgb(b.c[0] / 255, b.c[1] / 255, b.c[2] / 255) })
        }
        for (const w of words.filter((x) => onPage(x.y))) {
          const text = clean(w.t)
          if (!text) continue
          if (w.cs) page.pushOperators(setCharacterSpacing(w.cs))
          page.drawText(text, { x: w.x, y: PH - (w.y - y0), size: w.s, font: fonts[w.f], color: pdfRgb(w.c[0] / 255, w.c[1] / 255, w.c[2] / 255) })
          if (w.cs) page.pushOperators(setCharacterSpacing(0))
        }
      }
      return await doc.save()
    } finally {
      this.island.classList.remove('exporting')
      this.stack.classList.remove('exporting')
      this.editing = was
      this.paginateAll()
    }
  }
}

export class UnprintableError extends Error {
  readonly chars: string[]
  constructor(chars: string[]) {
    super(`The letter’s fonts cannot print ${chars.map((c) => `“${c}”`).join(', ')}. Retype ${chars.length === 1 ? 'it' : 'them'} with an ordinary character, or take ${chars.length === 1 ? 'it' : 'them'} out.`)
    this.chars = chars
  }
}

/* ---------- the letterhead and the five faces as bytes, fetched once ---------- */
let assetsPromise: Promise<{ letterhead: Uint8Array; fonts: Record<FontKey, Uint8Array> }> | null = null
function pdfAssets() {
  if (assetsPromise) return assetsPromise
  const bytes = async (path: string) => {
    const res = await fetch(`${ASSETS}/${path}`)
    if (!res.ok) throw new Error(`The letter’s ${path} could not be loaded (${res.status}). Reload the page and try again.`)
    return new Uint8Array(await res.arrayBuffer())
  }
  assetsPromise = (async () => {
    const keys = Object.keys(FONT_FILES) as FontKey[]
    const [letterhead, ...faces] = await Promise.all([bytes('letterhead.jpg'), ...keys.map((k) => bytes(`fonts/${FONT_FILES[k]}`))])
    return { letterhead, fonts: Object.fromEntries(keys.map((k, i) => [k, faces[i]])) as Record<FontKey, Uint8Array> }
  })().catch((e) => { assetsPromise = null; throw e })
  return assetsPromise
}
