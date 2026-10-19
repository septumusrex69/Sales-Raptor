/**
 * THE CLIENT REPORT, DRAWN (S9, 19 Oct).
 *
 * IN THE FIRM'S REPORT HAND, which is the remittance advice's: A4 landscape, the lockup top left, a
 * gold rule, navy headings, navy table heads and a navy TOTAL row, the figure that matters set white
 * on navy. A client who receives both should see one firm. The palette is the remittance advice's
 * own, written out again here rather than imported, because remittancePdf keeps it private and a
 * tax invoice's look should not move because a report wanted a colour.
 *
 * EVERY CHART SITS ON ITS OWN TABLE. The firm's reference drew rings and bars with nothing on them;
 * here a bar chart is a picture of the row of figures printed under it, so the client can read the
 * number rather than estimate it -- and a reader who prints in black and white loses nothing.
 *
 * Only the layout lives here. Every figure is one buildClientReport decided; the arithmetic in this
 * file is a TOTAL row (the sum of the column above it) and the height of a bar.
 *
 * WINDOWS-1252, like every PDF Raptor makes with the standard faces: a client name outside it is
 * reported, not substituted (winAnsi).
 */
import type { PDFFont, PDFImage, PDFPage } from 'pdf-lib'
import { printableForPdf, unprintableMessage } from './winAnsi.js'
import { amount as fmtAmount, rand } from './money.js'
import type { ClientReport } from './clientReport.ts'

const PW = 841.89
const PH = 595.28
const M = 36

const NAVY = '#111E2D'
const INK = '#1B2B3E'
const GOLD = '#C69F54'
const SLATE = '#5A6B80'
const FILL = '#EEF2F6'
const ZEBRA = '#F2F5F8'
const HAIR = '#D5DBE3'
const STATUS = '#3F5F86'
const LIGHT = '#AEBBCB'
const WHITE = '#FFFFFF'

export interface ClientReportPdfResult { bytes: Uint8Array; problem: string | null }

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "19 Oct 2026". Written out rather than toLocaleDateString, whose en-ZA prints September as "Sept". */
export function reportDate(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${d} ${MON[m - 1]} ${y}`
}
/** Whole rands, for the month tables: twelve columns of cents do not fit a page and are not read. */
const wholeRand = (n: number) => fmtAmount(Math.round(n)).replace(/[.,]00$/, '')

async function loadImage(path: string): Promise<Uint8Array | null> {
  try {
    if (typeof fetch !== 'function') return null
    const res = await fetch(path)
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
  } catch {
    return null
  }
}

export async function clientReportPdf(
  report: ClientReport,
  firm: { name: string; phone: string | null; address: string | null },
  opts: { logo?: Uint8Array } = {},
): Promise<ClientReportPdfResult> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const sans = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const unprintable: string[] = []
  const safe = (t: string): string => {
    const p = printableForPdf(t ?? '')
    if (p.unprintable.length) unprintable.push(...p.unprintable)
    return p.text
  }
  const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)

  doc.setTitle(`${report.client.name}: collection report`)
  doc.setSubject('Collection report')
  doc.setProducer('Raptor')

  let logoImg: PDFImage | null = null
  const logoBytes = opts.logo ?? await loadImage('/brand/bf-lockup.jpg')
  if (logoBytes) { try { logoImg = await doc.embedJpg(logoBytes) } catch { logoImg = null } }

  type Pen = { size: number; font?: PDFFont; color?: string }
  const text = (pg: PDFPage, t: string, x: number, y: number, p: Pen) => {
    pg.drawText(safe(t), { x, y, size: p.size, font: p.font ?? sans, color: hex(p.color ?? INK) })
  }
  const width = (t: string, p: Pen) => (p.font ?? sans).widthOfTextAtSize(safe(t), p.size)
  const textRight = (pg: PDFPage, t: string, xr: number, y: number, p: Pen) => text(pg, t, xr - width(t, p), y, p)
  const textMid = (pg: PDFPage, t: string, xc: number, y: number, p: Pen) => text(pg, t, xc - width(t, p) / 2, y, p)
  const box = (pg: PDFPage, x: number, y: number, w: number, h: number, color: string) => {
    pg.drawRectangle({ x, y, width: w, height: h, color: hex(color) })
  }
  const tracked = (pg: PDFPage, t: string, x: number, y: number, p: Pen, track: number) => {
    const f = p.font ?? sans
    let cx = x
    for (const ch of safe(t)) {
      pg.drawText(ch, { x: cx, y, size: p.size, font: f, color: hex(p.color ?? INK) })
      cx += f.widthOfTextAtSize(ch, p.size) + track
    }
  }
  const logo = (pg: PDFPage, x: number, yTop: number, w: number) => {
    const h = w / 4
    if (logoImg) pg.drawImage(logoImg, { x, y: yTop - h, width: w, height: h })
    else tracked(pg, firm.name.toUpperCase(), x + w * 0.04, yTop - h / 2 - w / 60, { size: w / 17, font: bold, color: NAVY }, w / 85)
  }

  const issued = `Issued ${reportDate(report.issuedOn)}`
  const clientLine = [report.client.name, report.client.code ? `Client ${report.client.code}` : null].filter(Boolean).join('  |  ')
  const since = report.since ? `Accounts handed over since ${reportDate(report.since)}` : 'No accounts handed over yet'

  /** Header and title; returns where the content starts. */
  const page = (title: string, subtitle: string): { pg: PDFPage; y: number } => {
    const pg = doc.addPage([PW, PH])
    logo(pg, M - 4, PH - 26, 216)
    textRight(pg, 'Collection report', PW - M, PH - 46, { size: 9.5, font: bold, color: STATUS })
    textRight(pg, issued, PW - M, PH - 61, { size: 7, color: SLATE })
    box(pg, M, PH - 96, PW - 2 * M, 1.2, GOLD)
    text(pg, title, M, PH - 128, { size: 20, font: bold, color: NAVY })
    text(pg, subtitle, M, PH - 145, { size: 8.5, color: SLATE })
    return { pg, y: PH - 160 }
  }

  /* ---------------- a table: navy head, zebra rows, navy TOTAL ---------------- */
  interface Col { head: string; width: number; right?: boolean }
  const ROW = 16
  const HEAD = 20
  const PAD = 5
  const table = (pg: PDFPage, x: number, y: number, cols: Col[], rows: string[][], total: string[] | null): number => {
    const w = cols.reduce((a, c) => a + c.width, 0)
    box(pg, x, y - HEAD, w, HEAD, NAVY)
    let cx = x
    for (const c of cols) {
      const p = { size: 6.6, font: bold, color: WHITE }
      if (c.right) textRight(pg, c.head.toUpperCase(), cx + c.width - PAD, y - 13, p)
      else text(pg, c.head.toUpperCase(), cx + PAD, y - 13, p)
      cx += c.width
    }
    y -= HEAD
    rows.forEach((r, i) => {
      if (i % 2 === 0) box(pg, x, y - ROW, w, ROW, ZEBRA)
      let rx = x
      cols.forEach((c, ci) => {
        const p = { size: 7.6, color: INK }
        if (c.right) textRight(pg, r[ci] ?? '', rx + c.width - PAD, y - 11, p)
        else text(pg, r[ci] ?? '', rx + PAD, y - 11, p)
        rx += c.width
      })
      y -= ROW
    })
    if (total) {
      box(pg, x, y - ROW - 2, w, ROW + 2, NAVY)
      let rx = x
      cols.forEach((c, ci) => {
        const p = { size: 7.6, font: bold, color: WHITE }
        const t = total[ci] ?? ''
        if (c.right) textRight(pg, t, rx + c.width - PAD, y - 12, p)
        else text(pg, t, rx + PAD, y - 12, p)
        rx += c.width
      })
      y -= ROW + 2
    }
    return y
  }
  const pct = (n: number) => `${n.toFixed(1)}%`

  /* ================= PAGE 1: the book at a glance ================= */
  {
    const { pg, y: top } = page('Your book at a glance', `${clientLine}  |  ${since}  |  Withdrawn accounts are left out`)
    const g = report.glance

    /* FOUR FIGURES, the last on navy: the recovery rate is the one a client reads. */
    const GAP = 12
    const BW = (PW - 2 * M - GAP * 3) / 4
    const BH = 78
    const figure = (i: number, label: string, value: string, note: string, invert = false) => {
      const x = M + i * (BW + GAP)
      box(pg, x, top - BH, BW, BH, invert ? NAVY : FILL)
      tracked(pg, label.toUpperCase(), x + 14, top - 18, { size: 6.6, font: bold, color: invert ? GOLD : STATUS }, 0.4)
      text(pg, value, x + 14, top - 46, { size: 19, font: bold, color: invert ? WHITE : NAVY })
      text(pg, note, x + 14, top - 62, { size: 7, color: invert ? LIGHT : SLATE })
    }
    figure(0, 'Accounts handed over', fmtAmount(g.accounts).replace(/[.,]00$/, ''), `${g.recovered} recovered, ${g.active} active, ${g.closed} closed`)
    figure(1, 'Capital handed over', rand(g.capital), 'The original balances of those accounts')
    figure(2, 'Collected', rand(g.collected), 'Everything paid on them, reversals out')
    figure(3, 'Recovery rate', g.recoveryRate === null ? '—' : pct(g.recoveryRate), 'Collected, over capital handed over', true)

    /* LEFT: what became of the accounts. RIGHT: where the active ones stand. */
    const headY = top - BH - 26
    const LW = 330
    text(pg, 'What became of the accounts', M, headY, { size: 11, font: bold, color: NAVY })
    const outCols: Col[] = [{ head: 'Outcome', width: 90 }, { head: 'Accounts', width: 56, right: true }, { head: 'Share', width: 50, right: true }, { head: 'Capital', width: 134 / 2 + 1, right: true }, { head: 'Collected', width: 134 / 2 - 1, right: true }]
    const outRows = report.outcomes.map((o) => [o.label, String(o.accounts), pct(o.pct), wholeRand(o.capital), wholeRand(o.collected)])
    let ly = table(pg, M, headY - 8, outCols, outRows, [
      'TOTAL', String(report.outcomes.reduce((t, o) => t + o.accounts, 0)),
      report.outcomes.some((o) => o.accounts > 0) ? pct(report.outcomes.reduce((t, o) => t + o.pct, 0)) : '',
      wholeRand(report.outcomes.reduce((t, o) => t + o.capital, 0)), wholeRand(report.outcomes.reduce((t, o) => t + o.collected, 0)),
    ])
    ly -= 14
    for (const l of [
      'Recovered: paid up or settled. Active: still being worked, including accounts on hold.',
      'Closed: ended any other way. Amounts in rand, rounded to the rand.',
    ]) { text(pg, l, M, ly, { size: 6.8, color: SLATE }); ly -= 9 }

    const RX = M + LW + 36
    text(pg, 'Where the active accounts stand', RX, headY, { size: 11, font: bold, color: NAVY })
    const RW = PW - M - RX
    const posCols: Col[] = [{ head: 'Position', width: RW - 56 - 50 - 110 }, { head: 'Accounts', width: 56, right: true }, { head: 'Share', width: 50, right: true }, { head: 'Capital', width: 110, right: true }]
    if (report.positions.length === 0) {
      text(pg, 'No active accounts.', RX, headY - 24, { size: 9, color: SLATE })
    } else {
      table(pg, RX, headY - 8, posCols, report.positions.map((p) => [p.label, String(p.accounts), pct(p.pct), wholeRand(p.capital)]),
        ['TOTAL', String(report.positionsTotal.accounts), pct(report.positions.reduce((t, p) => t + p.pct, 0)), wholeRand(report.positionsTotal.capital)])
    }
  }

  /* ================= PAGE 2: month by month ================= */
  {
    const { pg, y: top } = page('Month by month', `${clientLine}  |  Months run from the 11th to the 10th, named for the month they end in`)
    const LABEL_W = 92
    const chartX = M + LABEL_W
    const chartW = PW - M - chartX
    const CH = 84

    /** Bars over a row of figures; an optional line (the rate) on its own scale on the right. */
    const section = (y: number, title: string, note: string, labels: string[], bars: number[], barLabel: string,
      rows: { label: string; values: string[] }[], line?: { values: (number | null)[]; label: string }): number => {
      text(pg, title, M, y, { size: 11, font: bold, color: NAVY })
      text(pg, note, M, y - 13, { size: 7, color: SLATE })
      const base = y - 22 - CH
      const n = Math.max(1, labels.length)
      const slot = chartW / n
      const max = Math.max(1, ...bars)
      /* Three light gridlines: a reader's eye wants somewhere to measure from. */
      for (let k = 0; k <= 3; k += 1) box(pg, chartX, base + (CH * k) / 3, chartW, 0.4, HAIR)
      textRight(pg, barLabel, chartX - 6, base + CH - 3, { size: 6.2, color: SLATE })
      bars.forEach((v, i) => {
        const h = (v / max) * (CH - 4)
        if (h > 0) box(pg, chartX + i * slot + slot * 0.2, base, slot * 0.6, h, NAVY)
      })
      if (line) {
        const lmax = Math.max(1, ...line.values.map((v) => v ?? 0))
        let prev: { x: number; y: number } | null = null
        line.values.forEach((v, i) => {
          if (v === null) { prev = null; return }
          const pt = { x: chartX + i * slot + slot / 2, y: base + (v / lmax) * (CH - 4) }
          if (prev) pg.drawLine({ start: prev, end: pt, thickness: 1.4, color: hex(GOLD) })
          pg.drawCircle({ x: pt.x, y: pt.y, size: 1.8, color: hex(GOLD) })
          prev = pt
        })
        text(pg, line.label, chartX - LABEL_W + 0, base + CH - 14, { size: 6.2, color: GOLD, font: bold })
      }
      /* The months under the bars, then the figures, one row each -- the chart's own numbers. */
      let ry = base - 4
      box(pg, M, ry - 14, PW - 2 * M, 14, NAVY)
      text(pg, 'MONTH', M + PAD, ry - 10, { size: 6.4, font: bold, color: WHITE })
      labels.forEach((l, i) => textMid(pg, l.toUpperCase(), chartX + i * slot + slot / 2, ry - 10, { size: 6.4, font: bold, color: WHITE }))
      ry -= 14
      rows.forEach((r, ri) => {
        if (ri % 2 === 0) box(pg, M, ry - 13, PW - 2 * M, 13, ZEBRA)
        text(pg, r.label, M + PAD, ry - 9.5, { size: 6.8, color: SLATE })
        r.values.forEach((v, i) => textMid(pg, v, chartX + i * slot + slot / 2, ry - 9.5, { size: 6.8, color: INK }))
        ry -= 13
      })
      return ry
    }

    const c = report.collections
    let y = section(top - 4, 'Collections', 'What was collected on your accounts each month, and the recovery rate of the whole book at each month’s end.',
      c.map((m) => m.label), c.map((m) => m.collected), 'Collected',
      [
        { label: 'Collected (R)', values: c.map((m) => wholeRand(m.collected)) },
        { label: 'Recovery rate', values: c.map((m) => (m.rate === null ? '—' : pct(m.rate))) },
      ],
      { values: c.map((m) => m.rate), label: 'Recovery rate' })
    if (c.some((m) => m.current)) {
      text(pg, `${c[c.length - 1].label} is still running: its figures are to ${reportDate(report.issuedOn)}.`, M, y - 10, { size: 6.8, color: SLATE })
    }
    y -= 34

    const h = report.handovers
    section(y, 'Handovers', 'The accounts you handed over each month, and their capital.',
      h.map((m) => m.label), h.map((m) => m.capital), 'Capital',
      [
        { label: 'Accounts', values: h.map((m) => String(m.accounts)) },
        { label: 'Capital (R)', values: h.map((m) => wholeRand(m.capital)) },
      ])
  }

  /* ---------------- the footer, numbered once every page exists ---------------- */
  const pages = doc.getPages()
  pages.forEach((pg, i) => {
    box(pg, M, 32, PW - 2 * M, 0.5, HAIR)
    const contact = [firm.name.toUpperCase(), firm.phone].filter(Boolean).join('  |  ')
    text(pg, `${contact}  |  Confidential client report`, M, 20, { size: 7, color: SLATE })
    textRight(pg, `${i + 1} of ${pages.length}`, PW - M, 20, { size: 7, font: bold, color: SLATE })
  })

  const bytes = await doc.save()
  return { bytes, problem: unprintable.length ? unprintableMessage([...new Set(unprintable)]) : null }
}
