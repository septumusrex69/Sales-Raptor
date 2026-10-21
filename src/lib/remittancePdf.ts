/**
 * THE REMITTANCE ADVICE, DRAWN.
 *
 * IN THE BROWSER, LIKE EVERY OTHER PDF RAPTOR MAKES, and for the same reason letterPdf gives:
 * Vercel's Hobby plan caps serverless functions at twelve and api/ is at exactly twelve, so a
 * renderer endpoint would mean deleting one. pdf-lib arrives by dynamic import, so the chunk is
 * only downloaded by somebody who actually produces a statement.
 *
 * NOTHING IS STORED. The bytes exist between pressing the button and the message leaving. What IS
 * kept is the run it was made from -- which is smaller, reproducible, and frozen the moment the
 * run is approved, so a statement regenerated in a year is the same statement.
 *
 * THE LAYOUT IS THE FIRM'S OWN MOCK-UP (10 Oct: "make the remittance advices look like this"):
 * A4 LANDSCAPE THROUGHOUT, four kinds of page. A cover with the photograph, the lockup and who it
 * is for; "Your collection summary", which carries the answer -- the three figures, the workings
 * and how to pay or be paid; then the debtor-by-debtor tables, which are part of the tax invoice.
 * The earlier portrait first page went with it: the firm drew every page the same way round, and a
 * client flicking from the summary to the table should not have to turn the iPad to do it.
 *
 * ONLY THE LAYOUT MOVED. Every figure on these pages is one `buildRemittanceAdvice` already
 * decided; the only arithmetic here is the TOTAL row under a table, which is the sum of the column
 * drawn above it, so the table can be ticked off by eye.
 *
 * THE REPERTOIRE IS WINDOWS-1252, because the fourteen standard PDF faces cannot draw anything
 * else. A debtor's name with a character outside it is reported rather than substituted -- a name
 * is a word, and the firm's own rule for a section 129 applies to an invoice too.
 */
import type { PDFFont, PDFImage, PDFPage } from 'pdf-lib'
import { printableForPdf, unprintableMessage } from './winAnsi.js'
import { ANNEXURE_B_FOOTNOTE, advDate, type RemittanceAdvice } from './remittanceAdvice.js'
import { paymentReference } from './paymentsOut.js'
import { amount as fmtAmount, rand } from './money.js'

/* A4 LANDSCAPE, the mock-up's page. */
const PW = 841.89
const PH = 595.28
const M = 36

/* The mock-up's palette, written out as it was given. */
const NAVY = '#111E2D'
const INK = '#1B2B3E'
const GOLD = '#C69F54'
const SLATE = '#5A6B80'
const FILL = '#EEF2F6'
const ZEBRA = '#F2F5F8'
const HAIR = '#D5DBE3'
const STATUS = '#3F5F86'
const LIGHT = '#AEBBCB'
const RED = '#B23A34'
const WHITE = '#FFFFFF'

/*
 * THE MINUS IS A HYPHEN, DELIBERATELY. Windows-1252 has no MINUS SIGN (U+2212) and the fourteen
 * standard PDF faces can draw nothing else -- so a true minus is a character the document refuses
 * to print, which is what winAnsi reported the first time this ran. The screens may use whichever
 * glyph reads best; anything that reaches a PDF uses the hyphen-minus every encoding has.
 */

/** A table column: its heading, its width in points, and whether it is a figure that lines up right. */
interface Col { head: string; width: number; right?: boolean }

export interface RemittancePdfResult {
  bytes: Uint8Array
  /** Characters no standard PDF face can draw. The caller refuses rather than substituting. */
  problem: string | null
}

export interface RemittancePdfOptions {
  /**
   * The two pictures, as bytes, where the caller already has them. The browser leaves this out and
   * they are fetched from /brand; a script in Node, where a relative fetch cannot work, passes the
   * files it read. Either way a missing picture is a fallback, never a failure.
   */
  images?: { cover?: Uint8Array; logo?: Uint8Array }
}

/**
 * A PICTURE IS DECORATION, AND DECORATION NEVER STOPS A TAX INVOICE. Offline, in a test, or with
 * the file renamed, the fetch fails -- and the client still has to be told what they were paid. So
 * every failure here is a null, and the drawing falls back to the firm's navy and its name in type.
 */
async function loadImage(given: Uint8Array | undefined, path: string): Promise<Uint8Array | null> {
  if (given) return given
  try {
    if (typeof fetch !== 'function') return null
    const res = await fetch(path)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

export async function remittancePdf(adv: RemittanceAdvice, opts: RemittancePdfOptions = {}): Promise<RemittancePdfResult> {
  const {
    PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, rectangle, clip: clipPath, endPath,
  } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const sans = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const unprintable: string[] = []
  /** Everything drawn goes through here, so one unprintable name cannot slip onto an invoice. */
  const safe = (t: string): string => {
    const p = printableForPdf(t ?? '')
    if (p.unprintable.length) unprintable.push(...p.unprintable)
    return p.text
  }
  const hex = (h: string) => rgb(
    parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255,
  )

  doc.setTitle(`Remittance advice ${adv.run.invoiceNumber}`)
  doc.setSubject('Remittance advice and tax invoice')
  doc.setProducer('Raptor')

  const embed = async (bytes: Uint8Array | null): Promise<PDFImage | null> => {
    if (!bytes) return null
    try { return await doc.embedJpg(bytes) } catch { return null }
  }
  const [coverImg, logoImg] = await Promise.all([
    loadImage(opts.images?.cover, '/brand/remittance-cover.jpg').then(embed),
    loadImage(opts.images?.logo, '/brand/bf-lockup.jpg').then(embed),
  ])

  /* ---------------- drawing primitives ---------------- */

  type Pen = { size: number; font?: PDFFont; color?: string }
  const text = (pg: PDFPage, t: string, x: number, y: number, p: Pen) => {
    pg.drawText(safe(t), { x, y, size: p.size, font: p.font ?? sans, color: hex(p.color ?? INK) })
  }
  const width = (t: string, p: Pen) => (p.font ?? sans).widthOfTextAtSize(safe(t), p.size)
  const textRight = (pg: PDFPage, t: string, xr: number, y: number, p: Pen) => text(pg, t, xr - width(t, p), y, p)
  const box = (pg: PDFPage, x: number, y: number, w: number, h: number, color: string) => {
    pg.drawRectangle({ x, y, width: w, height: h, color: hex(color) })
  }
  /*
   * LETTER-SPACED CAPS, one glyph at a time. The lockup sets the firm's name tracked out, and the
   * standard faces have no tracking of their own; drawing per character keeps it inside drawText,
   * which is where safe() and the WinAnsi guard live.
   */
  const tracked = (pg: PDFPage, t: string, x: number, y: number, p: Pen, track: number, alignRight = false): number => {
    const s = safe(t)
    const f = p.font ?? sans
    const total = [...s].reduce((a, ch) => a + f.widthOfTextAtSize(ch, p.size) + track, 0) - track
    let cx = alignRight ? x - total : x
    for (const ch of s) {
      pg.drawText(ch, { x: cx, y, size: p.size, font: f, color: hex(p.color ?? INK) })
      cx += f.widthOfTextAtSize(ch, p.size) + track
    }
    return total
  }

  /** The lockup, or the firm's name in navy caps where the picture did not arrive. */
  const logo = (pg: PDFPage, x: number, yTop: number, w: number) => {
    const h = w / 4
    if (logoImg) {
      pg.drawImage(logoImg, { x, y: yTop - h, width: w, height: h })
    } else {
      tracked(pg, 'BREDELL FERREIRA', x + w * 0.04, yTop - h / 2 - w / 60, { size: w / 17, font: bold, color: NAVY }, w / 85)
    }
  }

  const period = `${advDate(adv.run.periodStart)} – ${advDate(adv.run.periodEnd)}`
  const issued = `Issued ${advDate(adv.run.issuedOn)}`
  const firmAddress = (adv.firm.address ?? '').split('\n').map((s) => s.trim()).filter(Boolean).join(', ')
  const reference = paymentReference(adv.run.invoiceNumber)

  /* ---------------- 1. the cover ---------------- */
  const cover = doc.addPage([PW, PH])
  const photoH = Math.round(PH * 0.52)
  const photoY = PH - photoH
  if (coverImg) {
    /*
     * COVER-CROPPED, as a browser's background-size: cover would. Scaled until it fills the band in
     * both directions, centred, and clipped to the band -- so a picture of another shape is trimmed
     * rather than stretched or left with a white strip down one side.
     */
    const scale = Math.max(PW / coverImg.width, photoH / coverImg.height)
    const w = coverImg.width * scale
    const h = coverImg.height * scale
    cover.pushOperators(pushGraphicsState(), rectangle(0, photoY, PW, photoH), clipPath(), endPath())
    cover.drawImage(coverImg, { x: (PW - w) / 2, y: photoY + (photoH - h) / 2, width: w, height: h })
    cover.pushOperators(popGraphicsState())
  } else {
    box(cover, 0, photoY, PW, photoH, NAVY)
    box(cover, 0, photoY, PW, 3, GOLD)
  }

  /*
   * TWO COLUMNS UNDER THE PHOTOGRAPH, both LEFT-aligned at fixed x, as the mock-up sets them: the
   * firm's side at the margin, the document's side from just past the middle of the page. Measured
   * off the firm's own PDF rather than guessed, because the cover is the page they will compare.
   */
  const CX = 43
  const CR = PW - 43
  const COL2 = 486
  logo(cover, CX - 4, photoY - 22, 340)
  text(cover, 'Remittance advice', COL2, photoY - 57, { size: 24, font: bold, color: NAVY })
  text(cover, '& tax invoice', COL2, photoY - 82, { size: 10, color: SLATE })
  box(cover, CX, photoY - 126, CR - CX, 1.2, GOLD)

  const cy = photoY - 150
  text(cover, adv.client.name, CX, cy, { size: 11, font: bold, color: INK })
  text(cover, period, CX, cy - 22, { size: 8.5, color: SLATE })
  text(cover, `${adv.run.invoiceNumber}  |  ${issued}`, CX, cy - 42, { size: 7, color: SLATE })
  tracked(cover, `PREPARED FOR ${adv.client.code ? `CLIENT ${adv.client.code}` : 'CLIENT'}`.toUpperCase(),
    COL2, cy, { size: 6.8, font: bold, color: SLATE }, 0.5)
  text(cover, adv.client.vatNumber ? `Your VAT no. ${adv.client.vatNumber}` : 'Your VAT no. not on file',
    COL2, cy - 22, { size: 8, color: SLATE })

  /* The navy band: who we are and how to reach us, on every client's first page. */
  const BAND = 60
  const COL3 = 648
  box(cover, 0, 0, PW, BAND, NAVY)
  tracked(cover, adv.firm.name.toUpperCase(), CX, 38, { size: 7.5, font: bold, color: WHITE }, 0.6)
  if (firmAddress) text(cover, clip(safe(firmAddress), sans, 6.8, COL3 - CX - 20), CX, 23, { size: 6.8, color: LIGHT })
  if (adv.firm.phone) text(cover, adv.firm.phone, COL3, 38, { size: 9, font: bold, color: WHITE })
  text(cover, adv.firm.vatNumber ? `VAT ${adv.firm.vatNumber}` : 'VAT number not on file', COL3, 23, { size: 6.8, color: LIGHT })

  /* ---------------- the inner pages' frame ---------------- */

  /** Header and title; returns the y below the subtitle, where the page's content starts. */
  const innerPage = (title: string, subtitle: string): { pg: PDFPage; y: number } => {
    const pg = doc.addPage([PW, PH])
    logo(pg, M - 4, PH - 26, 216)
    textRight(pg, adv.run.invoiceNumber, PW - M, PH - 46, { size: 9.5, font: bold, color: STATUS })
    textRight(pg, issued, PW - M, PH - 61, { size: 7, color: SLATE })
    box(pg, M, PH - 96, PW - 2 * M, 1.2, GOLD)
    text(pg, title, M, PH - 133, { size: 22, font: bold, color: NAVY })
    text(pg, subtitle, M, PH - 151, { size: 8.5, color: SLATE })
    return { pg, y: PH - 168 }
  }
  const FOOT = 40
  const clientLine = [adv.client.name, adv.client.code ? `Client ${adv.client.code}` : null].filter(Boolean).join('  |  ')

  /* ---------------- 2. your collection summary ---------------- */
  {
    const { pg, y: top } = innerPage('Your collection summary', `${clientLine}  |  ${period}`)

    /*
     * THE THREE FIGURES, SIDE BY SIDE. Prompt 7's own order, and the last one is the only figure
     * most clients will read -- so it is set on the firm's navy with the amount in white, which is
     * the one place on the document where emphasis is worth the ink. With nothing paid directly the
     * middle box is left out rather than drawn at nought: two boxes that each mean something read
     * better than three where one is a blank to explain.
     */
    const count = adv.headline.paidDirectly > 0 ? 3 : 2
    const GAP = 14
    const bw = (PW - 2 * M - GAP * (count - 1)) / count
    const BH = 91
    let slot = 0
    const figure = (label: string, value: string, note: string, invert = false) => {
      const x = M + slot * (bw + GAP)
      slot += 1
      box(pg, x, top - BH, bw, BH, invert ? NAVY : FILL)
      tracked(pg, label.toUpperCase(), x + 16, top - 20, { size: 6.8, font: bold, color: invert ? GOLD : STATUS }, 0.4)
      text(pg, value, x + 16, top - 50, { size: 22, font: bold, color: invert ? WHITE : NAVY })
      let ny = top - 66
      for (const l of wrap(safe(note), sans, 7, bw - 32).slice(0, 2)) {
        text(pg, l, x + 16, ny, { size: 7, color: invert ? LIGHT : SLATE })
        ny -= 9
      }
    }
    figure(
      'Collected by us',
      rand(adv.headline.collectedByBf),
      `${adv.headline.payments} ${adv.headline.payments === 1 ? 'payment' : 'payments'} into our trust account`,
    )
    if (adv.headline.paidDirectly > 0) {
      figure('Paid directly to you', rand(adv.headline.paidDirectly), adv.headline.directNote ?? '')
    }
    /* A run below nothing is the client owing the firm: its own words and a positive figure. */
    figure(adv.headline.netLabel, rand(Math.abs(adv.headline.net)), adv.headline.paidNote, true)

    /*
     * LEFT: HOW WE GOT THERE. The mock-up spaces four lines generously; a run with charges set off,
     * a balance brought forward and an overpayment released has seven, so the pitch closes up to
     * keep the net, the footnote and the address on this page rather than pushing the answer over.
     */
    const LW = 453
    const lines = adv.workings.filter((w) => !w.emphasis)
    const net = adv.workings.filter((w) => w.emphasis)
    const headY = top - BH - 30
    text(pg, 'Payover calculation', M, headY, { size: 11.5, font: bold, color: NAVY })
    let y = headY - 8
    const pitch = Math.min(27, Math.max(17, 140 / Math.max(1, lines.length)))
    const amt = (n: number) => (n < 0 ? `- ${rand(Math.abs(n))}` : rand(n))
    for (const w of lines) {
      text(pg, w.label, M, y - pitch + 8, { size: 8, color: INK })
      textRight(pg, amt(w.amount), M + LW, y - pitch + 8, { size: 8, color: INK })
      box(pg, M, y - pitch, LW, 0.5, HAIR)
      y -= pitch
    }
    y -= 10
    for (const w of net) {
      box(pg, M, y - 30, LW, 30, FILL)
      text(pg, w.label, M + 10, y - 19, { size: 9, font: bold, color: NAVY })
      textRight(pg, amt(w.amount), M + LW - 10, y - 19, { size: 11, font: bold, color: NAVY })
      y -= 30
    }

    /* RIGHT: how the money moves, and the two VAT numbers a tax invoice owes both parties. */
    const RX = M + LW + 40
    const RW = PW - M - RX
    const ptop = headY + 10
    box(pg, RX, y, RW, ptop - y, FILL)
    text(pg, 'Payment & invoice details', RX + 14, ptop - 22, { size: 9.5, font: bold, color: NAVY })
    const pair = (label: string, value: string, yy: number) => {
      text(pg, label, RX + 14, yy, { size: 6.5, color: SLATE })
      text(pg, value, RX + 14, yy - 11, { size: 8.5, font: bold, color: INK })
    }
    pair('EFT reference', reference ?? adv.run.invoiceNumber, ptop - 46)
    pair('Our VAT number', adv.firm.vatNumber ?? 'Not on file', ptop - 73)
    pair('Your VAT number', adv.client.vatNumber ?? 'Not on file', ptop - 100)

    /* Under both columns, the width of the page: the footnote, then where to find us. */
    y -= 20
    for (const l of wrap(safe(ANNEXURE_B_FOOTNOTE), sans, 6.8, PW - 2 * M)) {
      text(pg, l, M, y, { size: 6.8, color: SLATE })
      y -= 9
    }
    const contact = [firmAddress, adv.firm.phone].filter(Boolean).join('  |  ')
    if (contact) text(pg, clip(safe(contact), sans, 6.8, PW - 2 * M), M, Math.min(y - 12, 58), { size: 6.8, color: SLATE })
  }

  /* ---------------- 3, 4 and the released overpayments: the tables ---------------- */

  /*
   * COLUMNS SIZED TO THE PAGE, and each the mock-up's heading over the data the earlier tables
   * already carried. Capital outstanding is not on the firm's drawing and stays on the page as the
   * last column: it is what tells a client an account is not finished, and it is the column the
   * "Paid in full" rule is checked against -- dropping it would leave the status unanswerable.
   */
  const COLLECT: Col[] = [
    { head: 'Your ref', width: 52 }, { head: 'Our ref', width: 58 }, { head: 'Debtor', width: 148 },
    { head: 'Status', width: 80 }, { head: 'Handover', width: 58 },
    { head: 'Amount', width: 70, right: true }, { head: 'Paid', width: 62 },
    { head: 'Capital', width: 70, right: true }, { head: 'Comm.', width: 62, right: true },
    { head: 'VAT', width: 48, right: true }, { head: 'Outstanding', width: 70, right: true },
  ]
  const DIRECT: Col[] = [
    { head: 'Your ref', width: 52 }, { head: 'Our ref', width: 58 }, { head: 'Debtor', width: 170 },
    { head: 'Paid', width: 62 }, { head: 'Received', width: 72, right: true },
    { head: 'Annexure B', width: 72, right: true }, { head: 'Capital', width: 72, right: true },
    { head: 'Comm.', width: 66, right: true }, { head: 'Due to us', width: 72, right: true },
    { head: 'Outstanding', width: 82, right: true },
  ]

  interface Section {
    title: string
    cols: Col[]
    rows: (string | number)[][]
    /** Reversals: drawn in red, as negatives. */
    flags: boolean[]
    /** Which columns the TOTAL row sums; the rest are blank on it. */
    totals: number[]
    /** Column drawn in the status colour, if any. */
    statusCol?: number
    footnotes: string[]
    /** A small line under each row -- the collections' VAT sentence (the firm, 10 Oct). */
    subLines?: string[]
  }
  const sections: Section[] = []
  if (adv.collections.length) {
    const late = adv.collections.some((c) => c.lateCapture)
    sections.push({
      title: 'Collections by us',
      cols: COLLECT,
      /* A late capture's paid date carries the asterisk the footnote explains. */
      rows: adv.collections.map((c) => [
        c.yourRef, c.ourRef, c.debtor, c.status, c.handedOver, c.handoverAmount,
        c.lateCapture ? `${c.paid} *` : c.paid, c.capitalReceived, c.commission, c.vat, c.capitalOutstanding,
      ]),
      flags: adv.collections.map((c) => c.reversal),
      totals: [7, 8, 9],
      statusCol: 3,
      /* THE PER-LINE VAT SENTENCE, under each collection (the firm, 10 Oct: "the VAT also needs to
         be there"). The figures are the row's own, so the sentence and the columns cannot differ. */
      subLines: adv.collections.map((c) => c.vatLine),
      footnotes: [
        `${late ? '* Captured after the previous cut-off. ' : ''}Handover amount refers to the original account balance.`,
      ],
    })
  }
  if (adv.direct.length) {
    sections.push({
      title: 'Paid directly to you',
      cols: DIRECT,
      rows: adv.direct.map((d) => [
        d.yourRef, d.ourRef, d.debtor, d.paid, d.receivedByYou, d.annexureBFees,
        d.capitalPortion, d.commission, d.dueToUs, d.capitalOutstanding,
      ]),
      flags: adv.direct.map((d) => d.reversal),
      totals: [4, 5, 6, 7, 8],
      /* THE MOCK-UP'S TWO SENTENCES: what "due to us" is made of and where it goes, then what
         Annexure B is. The figures are this table's own totals, so the sentence and the row agree. */
      footnotes: [
        `The ${rand(sum(adv.direct.map((d) => d.dueToUs)))} due to us comprises `
          + `${rand(sum(adv.direct.map((d) => d.annexureBFees)))} in Annexure B fees and `
          + `${rand(sum(adv.direct.map((d) => d.commission)))} commission. This is set off against the `
          + 'funds collected through our trust account, in the payover calculation.',
        ANNEXURE_B_FOOTNOTE,
      ],
    })
  }
  if (adv.released.length) {
    sections.push({
      title: 'Overpayments paid over to you in full — no commission',
      cols: [
        { head: 'Your ref', width: 80 }, { head: 'Our ref', width: 90 }, { head: 'Debtor', width: 400 },
        { head: 'Paid', width: 88 }, { head: 'Overpayment', width: 120, right: true },
      ],
      rows: adv.released.map((r) => [r.yourRef, r.ourRef, r.debtor, r.paid, r.amount]),
      flags: adv.released.map(() => false),
      totals: [4],
      footnotes: ['Each debtor above paid more than the account owed. The excess is paid over to you in full, with no commission.'],
    })
  }

  const HEAD_H = 26
  const ROW_H = 24
  const PAD = 5
  const CELL = 7.5
  const subtitleFor = `${clientLine}  |  ${period}  |  All amounts in ZAR`

  const tableHead = (pg: PDFPage, cols: Col[], y: number): number => {
    box(pg, M, y - HEAD_H, PW - 2 * M, HEAD_H, NAVY)
    let x = M
    for (const c of cols) {
      const h = c.head.toUpperCase()
      const p = { size: 6.8, font: bold, color: WHITE }
      if (c.right) textRight(pg, h, x + c.width - PAD, y - 16, p)
      else text(pg, h, x + PAD, y - 16, p)
      x += c.width
    }
    return y - HEAD_H
  }
  /*
   * A FIGURE CARRIES ITS OWN SIGN. A reversal row is red, and its capital, commission and VAT are
   * negative because the advice made them so -- but its handover amount and capital outstanding are
   * facts about the account, not money moving back, and printing "- 21 206.20" beside them told a
   * client the account had been handed back.
   */
  const cellText = (raw: string | number): string => (typeof raw === 'number'
    ? (raw < 0 ? `- ${fmtAmount(Math.abs(raw))}` : fmtAmount(raw))
    : String(raw ?? ''))
  /** The widths above are proportions; the page decides the points. */
  const fitCols = (cols: Col[]): Col[] => {
    const sum = cols.reduce((a, c) => a + c.width, 0)
    return cols.map((c) => ({ ...c, width: (c.width * (PW - 2 * M)) / sum }))
  }

  for (const sec of sections) {
    sec.cols = fitCols(sec.cols)
    let { pg, y } = innerPage(sec.title, subtitleFor)
    y = tableHead(pg, sec.cols, y)
    const footH = 18 + sec.footnotes.reduce((a, f) => a + wrap(safe(f), sans, 7.5, PW - 2 * M).length * 9.5 + 8, 0)
    /* A row with a sentence under it is taller; the figures move up to make room. */
    const rowH = sec.subLines ? ROW_H + 9 : ROW_H
    const base = sec.subLines ? 13 : 15
    for (let i = 0; i < sec.rows.length; i += 1) {
      /*
       * ROOM FOR THIS ROW -- and the last row only goes where its TOTAL and footnotes fit under it.
       * Otherwise the last row moves over with them, so a total never sits on a page of its own
       * under a bare header, which is a page that reads as a second table with nothing in it.
       */
      const need = rowH + (i === sec.rows.length - 1 ? ROW_H + footH : 0)
      if (y - need < FOOT + 8) {
        ({ pg, y } = innerPage(`${sec.title} (continued)`, subtitleFor))
        y = tableHead(pg, sec.cols, y)
      }
      if (i % 2 === 0) box(pg, M, y - rowH, PW - 2 * M, rowH, ZEBRA)
      const red = sec.flags[i]
      let x = M
      for (let ci = 0; ci < sec.cols.length; ci += 1) {
        const c = sec.cols[ci]
        const raw = sec.rows[i][ci]
        const t = clip(safe(cellText(raw)), sans, CELL, c.width - 2 * PAD)
        const color = red ? RED : ci === sec.statusCol ? STATUS : INK
        const p = { size: CELL, color }
        if (c.right) textRight(pg, t, x + c.width - PAD, y - base, p)
        else text(pg, t, x + PAD, y - base, p)
        x += c.width
      }
      const sub = sec.subLines?.[i]
      if (sub) {
        /* Under the debtor and everything to its right: the refs stay clear, as on the mock-up. */
        const from = M + sec.cols[0].width + sec.cols[1].width + PAD
        text(pg, clip(safe(sub), sans, 6.4, PW - M - from - PAD), from, y - base - 10,
          { size: 6.4, color: red ? RED : SLATE })
      }
      y -= rowH
    }

    /* THE TOTAL ROW, the sum of what is drawn above it -- reversals included, as negatives. */
    box(pg, M, y - ROW_H, PW - 2 * M, ROW_H, NAVY)
    text(pg, 'TOTAL', M + PAD, y - 15, { size: CELL, font: bold, color: WHITE })
    let x = M
    for (let ci = 0; ci < sec.cols.length; ci += 1) {
      const c = sec.cols[ci]
      if (sec.totals.includes(ci)) {
        const total = sum(sec.rows.map((r) => (typeof r[ci] === 'number' ? (r[ci] as number) : 0)))
        textRight(pg, cellText(total), x + c.width - PAD, y - 15, { size: CELL, font: bold, color: WHITE })
      }
      x += c.width
    }
    y -= ROW_H + 18
    for (const f of sec.footnotes) {
      for (const l of wrap(safe(f), sans, 7.5, PW - 2 * M)) {
        text(pg, l, M, y, { size: 7.5, color: SLATE })
        y -= 9.5
      }
      y -= 8
    }
  }

  if (!sections.length) {
    const { pg, y } = innerPage('Collections by us', subtitleFor)
    text(pg, 'No payments were collected in this period.', M, y - 14, { size: 10, color: SLATE })
  }

  /* ---------------- the inner pages' footer, numbered once every page exists ---------------- */
  const pages = doc.getPages()
  pages.forEach((pg, i) => {
    if (i === 0) return
    box(pg, M, 32, PW - 2 * M, 0.5, HAIR)
    text(pg, `${adv.firm.name.toUpperCase()}  |  Confidential client report`, M, 20, { size: 7, color: SLATE })
    textRight(pg, `RAPTOR / ${String(i + 1).padStart(2, '0')}`, PW - M, 20, { size: 7, font: bold, color: SLATE })
  })

  const bytes = await doc.save()
  return {
    bytes,
    problem: unprintable.length ? unprintableMessage([...new Set(unprintable)]) : null,
  }
}

/** A column's total, to the cent, so a run of floating-point additions cannot print 0.30000000004. */
function sum(ns: number[]): number {
  return Math.round(ns.reduce((a, n) => a + n, 0) * 100) / 100
}

/** Break a paragraph to a width. Text arrives already through safe(), so it measures what draws. */
function wrap(text: string, font: { widthOfTextAtSize(t: string, s: number): number }, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = w } else { line = next }
  }
  if (line) out.push(line)
  return out
}

/**
 * A cell that will not fit is SHORTENED WITH AN ELLIPSIS, never allowed to run into the next one.
 *
 * Only ever a name or a reference: every figure is right-aligned in a column sized for the widest
 * amount the firm can produce, so a truncated NUMBER would be a bug rather than a squeeze. If one
 * ever appears, the column is too narrow and the fix is the column.
 */
function clip(text: string, font: { widthOfTextAtSize(t: string, s: number): number }, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text
  let t = text
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1)
  return `${t}…`
}
