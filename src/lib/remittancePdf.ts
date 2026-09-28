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
 * PAGE ONE CARRIES ONLY THE ANSWER, which is prompt 7 overriding prompt 4. Portrait A4, so it
 * reads on an iPad held upright, with the three figures a client actually opens the email for --
 * what we collected, what they were paid directly, and what is being transferred. The debtor-by-
 * debtor tables follow from page two in the same PDF, because they are part of the tax invoice,
 * and those pages are LANDSCAPE: eleven columns on a portrait page is a column of crushed text.
 *
 * THE REPERTOIRE IS WINDOWS-1252, because the fourteen standard PDF faces cannot draw anything
 * else. A debtor's name with a character outside it is reported rather than substituted -- a name
 * is a word, and the firm's own rule for a section 129 applies to an invoice too.
 */
import { printableForPdf, unprintableMessage } from './winAnsi.js'
import { ANNEXURE_B_FOOTNOTE, advDate, type RemittanceAdvice } from './remittanceAdvice.js'
import { amount as fmtAmount, rand } from './money.js'

const A4 = { w: 595.28, h: 841.89 }
const GOLD = { r: 0.718, g: 0.502, b: 0.122 }
const INK = { r: 0.078, g: 0.125, b: 0.227 }
const MUTED = { r: 0.29, g: 0.333, b: 0.439 }
const RULE = { r: 0.835, g: 0.859, b: 0.898 }
const RED = { r: 0.698, g: 0.227, b: 0.204 }

/*
 * THE MINUS IS A HYPHEN, DELIBERATELY. Windows-1252 has no MINUS SIGN (U+2212) and the fourteen
 * standard PDF faces can draw nothing else -- so a true minus is a character the document refuses
 * to print, which is what winAnsi reported the first time this ran. The screens may use whichever
 * glyph reads best; anything that reaches a PDF uses the hyphen-minus every encoding has.
 */

/** A cell as it will be drawn: the text, and whether it is a figure that lines up on the right. */
interface Col { head: string; width: number; right?: boolean }

export interface RemittancePdfResult {
  bytes: Uint8Array
  /** Characters no standard PDF face can draw. The caller refuses rather than substituting. */
  problem: string | null
}

export async function remittancePdf(adv: RemittanceAdvice): Promise<RemittancePdfResult> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const body = await doc.embedFont(StandardFonts.TimesRoman)
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold)
  const sans = await doc.embedFont(StandardFonts.Helvetica)
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold)

  const unprintable: string[] = []
  /** Everything drawn goes through here, so one unprintable name cannot slip onto an invoice. */
  const safe = (t: string): string => {
    const p = printableForPdf(t ?? '')
    if (p.unprintable.length) unprintable.push(...p.unprintable)
    return p.text
  }

  doc.setTitle(`Remittance advice ${adv.run.invoiceNumber}`)
  doc.setSubject('Remittance advice and tax invoice')
  doc.setProducer('Raptor')

  /* ---------------- page one ---------------- */
  const p1 = doc.addPage([A4.w, A4.h])
  const M = 48
  let y = A4.h - M

  p1.drawText(safe(adv.firm.name.toUpperCase()), {
    x: M, y: y - 16, size: 17, font: bold, color: rgb(INK.r, INK.g, INK.b),
  })
  const firmLine = [
    adv.firm.vatNumber ? `VAT ${adv.firm.vatNumber}` : null,
    adv.firm.phone,
  ].filter(Boolean).join('  ·  ')
  p1.drawText(safe(firmLine), { x: M, y: y - 30, size: 8.5, font: sans, color: rgb(MUTED.r, MUTED.g, MUTED.b) })

  const right = (text: string, yy: number, size = 8.5, f = sans, col = MUTED) => {
    const w = f.widthOfTextAtSize(safe(text), size)
    p1.drawText(safe(text), { x: A4.w - M - w, y: yy, size, font: f, color: rgb(col.r, col.g, col.b) })
  }
  right('REMITTANCE ADVICE · TAX INVOICE', y - 14, 9.5, sansBold, INK)
  right(`${adv.run.invoiceNumber} · issued ${advDate(adv.run.issuedOn)}`, y - 28)

  y -= 44
  p1.drawRectangle({ x: M, y, width: A4.w - 2 * M, height: 2, color: rgb(GOLD.r, GOLD.g, GOLD.b) })
  y -= 22

  p1.drawText(safe(adv.client.name), { x: M, y, size: 11.5, font: bold, color: rgb(INK.r, INK.g, INK.b) })
  right(adv.client.vatNumber ? `Your VAT no: ${adv.client.vatNumber}` : 'Your VAT no: not on file', y)
  y -= 14
  p1.drawText(
    safe(`${adv.client.code ? `Client ${adv.client.code}  ·  ` : ''}Collections ${advDate(adv.run.periodStart)} – ${advDate(adv.run.periodEnd)}`),
    { x: M, y, size: 9, font: sans, color: rgb(MUTED.r, MUTED.g, MUTED.b) },
  )
  y -= 28

  /*
   * THE THREE FIGURES, STACKED. Prompt 7's own order, and the last one is the only figure most
   * clients will read -- so it is set on the firm's navy with the amount in white, which is the
   * one place on the document where emphasis is worth the ink.
   */
  const figure = (label: string, value: string, note: string, invert = false) => {
    const h = note ? 62 : 50
    y -= h
    if (invert) {
      p1.drawRectangle({ x: M, y, width: A4.w - 2 * M, height: h, color: rgb(INK.r, INK.g, INK.b) })
    } else {
      p1.drawRectangle({
        x: M, y, width: A4.w - 2 * M, height: h,
        borderColor: rgb(RULE.r, RULE.g, RULE.b), borderWidth: 1,
      })
    }
    const lab = invert ? { r: 0.878, g: 0.706, b: 0.369 } : GOLD
    const val = invert ? { r: 1, g: 1, b: 1 } : INK
    const nte = invert ? { r: 0.788, g: 0.824, b: 0.890 } : MUTED
    p1.drawText(safe(label.toUpperCase()), {
      x: M + 12, y: y + h - 17, size: 7.8, font: sansBold, color: rgb(lab.r, lab.g, lab.b),
    })
    p1.drawText(safe(value), {
      x: M + 12, y: y + (note ? 24 : 12), size: invert ? 22 : 19, font: bold, color: rgb(val.r, val.g, val.b),
    })
    if (note) {
      p1.drawText(safe(note), {
        x: M + 12, y: y + 10, size: 8.5, font: sans, color: rgb(nte.r, nte.g, nte.b),
      })
    }
    y -= 10
  }

  figure(
    'Collected by us',
    rand(adv.headline.collectedByBf),
    `${adv.headline.payments} ${adv.headline.payments === 1 ? 'payment' : 'payments'} into our trust account`,
  )
  if (adv.headline.paidDirectly > 0) {
    figure('Paid directly to you', rand(adv.headline.paidDirectly), adv.headline.directNote ?? '')
  }
  figure('Net amount we are paying you', rand(adv.headline.net), adv.headline.paidNote, true)

  y -= 14
  p1.drawText('HOW WE GOT THERE', { x: M, y, size: 8, font: sansBold, color: rgb(INK.r, INK.g, INK.b) })
  y -= 6
  for (const w of adv.workings) {
    y -= 16
    p1.drawText(safe(w.label), {
      x: M, y, size: 9.5, font: w.emphasis ? bold : body, color: rgb(w.emphasis ? INK.r : MUTED.r, w.emphasis ? INK.g : MUTED.g, w.emphasis ? INK.b : MUTED.b),
    })
    const txt = w.amount < 0 ? `- ${rand(Math.abs(w.amount))}` : rand(w.amount)
    const f = w.emphasis ? bold : body
    const tw = f.widthOfTextAtSize(safe(txt), 9.5)
    p1.drawText(safe(txt), { x: A4.w - M - tw, y, size: 9.5, font: f, color: rgb(INK.r, INK.g, INK.b) })
    if (w.emphasis) {
      p1.drawRectangle({ x: M, y: y + 13, width: A4.w - 2 * M, height: 0.8, color: rgb(INK.r, INK.g, INK.b) })
    }
  }

  y -= 34
  for (const line of wrap(ANNEXURE_B_FOOTNOTE, body, 8, A4.w - 2 * M)) {
    p1.drawText(safe(line), { x: M, y, size: 8, font: body, color: rgb(MUTED.r, MUTED.g, MUTED.b) })
    y -= 10
  }
  if (adv.firm.address) {
    y -= 6
    p1.drawText(safe(adv.firm.address.split('\n').join(', ')), {
      x: M, y, size: 7.5, font: sans, color: rgb(MUTED.r, MUTED.g, MUTED.b),
    })
  }

  /* ---------------- the detail, landscape from page two ---------------- */
  const COLLECT: Col[] = [
    { head: 'Your ref', width: 58 }, { head: 'Our ref', width: 68 }, { head: 'Debtor', width: 150 },
    { head: 'Status', width: 84 }, { head: 'Handed over', width: 62 },
    { head: 'Handover amount', width: 76, right: true }, { head: 'Paid', width: 58 },
    { head: 'Capital received', width: 72, right: true }, { head: 'Commission', width: 62, right: true },
    { head: 'VAT', width: 48, right: true }, { head: 'Capital outstanding', width: 78, right: true },
  ]
  const DIRECT: Col[] = [
    { head: 'Your ref', width: 58 }, { head: 'Our ref', width: 68 }, { head: 'Debtor', width: 170 },
    { head: 'Paid', width: 58 }, { head: 'Received by you', width: 76, right: true },
    { head: 'Annexure B fees', width: 76, right: true }, { head: 'Capital portion', width: 74, right: true },
    { head: 'Commission', width: 64, right: true }, { head: 'Due to us', width: 64, right: true },
    { head: 'Capital outstanding', width: 78, right: true },
  ]

  const sections: { title: string; cols: Col[]; rows: (string | number)[][]; flags: boolean[]; notes: (string | null)[] }[] = []
  if (adv.collections.length) {
    sections.push({
      title: 'Collections by us',
      cols: COLLECT,
      rows: adv.collections.map((c) => [
        c.yourRef, c.ourRef, c.debtor, c.status, c.handedOver, c.handoverAmount,
        c.paid, c.capitalReceived, c.commission, c.vat, c.capitalOutstanding,
      ]),
      flags: adv.collections.map((c) => c.reversal),
      notes: adv.collections.map((c) => (c.lateCapture ? 'captured after previous cut-off' : null)),
    })
  }
  if (adv.direct.length) {
    sections.push({
      title: 'Paid to you directly',
      cols: DIRECT,
      rows: adv.direct.map((d) => [
        d.yourRef, d.ourRef, d.debtor, d.paid, d.receivedByYou, d.annexureBFees,
        d.capitalPortion, d.commission, d.dueToUs, d.capitalOutstanding,
      ]),
      flags: adv.direct.map((d) => d.reversal),
      notes: adv.direct.map(() => null),
    })
  }

  const LW = A4.h
  const LH = A4.w
  let page = null as ReturnType<typeof doc.addPage> | null
  let ty = 0
  const newLandscape = () => {
    page = doc.addPage([LW, LH])
    ty = LH - 40
    page.drawText(safe(`${adv.client.name} · ${adv.run.invoiceNumber}`), {
      x: 32, y: LH - 26, size: 8, font: sans, color: rgb(MUTED.r, MUTED.g, MUTED.b),
    })
    const t = `${advDate(adv.run.periodStart)} – ${advDate(adv.run.periodEnd)}`
    const tw = sans.widthOfTextAtSize(safe(t), 8)
    page.drawText(safe(t), { x: LW - 32 - tw, y: LH - 26, size: 8, font: sans, color: rgb(MUTED.r, MUTED.g, MUTED.b) })
  }

  for (const sec of sections) {
    newLandscape()
    const drawHead = () => {
      const pg = page!
      pg.drawText(safe(sec.title.toUpperCase()), {
        x: 32, y: ty, size: 9, font: sansBold, color: rgb(INK.r, INK.g, INK.b),
      })
      ty -= 16
      let x = 32
      for (const c of sec.cols) {
        const w = sans.widthOfTextAtSize(safe(c.head), 6.8)
        pg.drawText(safe(c.head.toUpperCase()), {
          x: c.right ? x + c.width - w : x, y: ty, size: 6.8, font: sansBold, color: rgb(MUTED.r, MUTED.g, MUTED.b),
        })
        x += c.width + 6
      }
      ty -= 5
      pg.drawRectangle({ x: 32, y: ty, width: LW - 64, height: 0.6, color: rgb(RULE.r, RULE.g, RULE.b) })
      ty -= 12
    }
    drawHead()

    for (let i = 0; i < sec.rows.length; i += 1) {
      if (ty < 44) { newLandscape(); drawHead() }
      const pg = page!
      const red = sec.flags[i]
      const col = red ? RED : INK
      let x = 32
      for (let ci = 0; ci < sec.cols.length; ci += 1) {
        const c = sec.cols[ci]
        const raw = sec.rows[i][ci]
        let txt = typeof raw === 'number'
          ? (red ? `- ${fmtAmount(Math.abs(raw))}` : fmtAmount(raw))
          : String(raw ?? '')
        txt = safe(txt)
        txt = clip(txt, body, 7.4, c.width)
        const w = body.widthOfTextAtSize(txt, 7.4)
        pg.drawText(txt, {
          x: c.right ? x + c.width - w : x, y: ty, size: 7.4, font: body, color: rgb(col.r, col.g, col.b),
        })
        x += c.width + 6
      }
      const note = sec.notes[i]
      if (note) {
        ty -= 8.5
        pg.drawText(safe(note), { x: 32, y: ty, size: 6.4, font: sans, color: rgb(MUTED.r, MUTED.g, MUTED.b) })
      }
      ty -= 13
    }
  }

  if (!sections.length) {
    newLandscape()
    page!.drawText('No payments were collected in this period.', {
      x: 32, y: ty, size: 9, font: body, color: rgb(MUTED.r, MUTED.g, MUTED.b),
    })
  }

  const bytes = await doc.save()
  return {
    bytes,
    problem: unprintable.length ? unprintableMessage([...new Set(unprintable)]) : null,
  }
}

/** Break a paragraph to a width. The only wrapping on the document; everything else is a cell. */
function wrap(text: string, font: { widthOfTextAtSize(t: string, s: number): number }, size: number, width: number): string[] {
  const words = text.split(/\s+/)
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
