import { useEffect, useState } from 'react'
import { FileActions } from '../../components/ui/FileActions'
import { blobFromUrl } from '../../lib/fileSave'
import { rand } from '../../lib/money'
import { PortalSignedOut, fetchPortalBook, fetchPortalReports, portalReportFile, type PortalReport } from '../../lib/portalApi'
import { clockToday } from '../../lib/clock'
import type { PortalLine } from '../../lib/clientPortal'
import { progressPdf, progressSheet, type ProgressReport } from '../../lib/progressReport'

/**
 * THE CLIENT'S REPORTS (S15, Raptor · Handover 14). Stephan: "a section where you would see your previous
 * reports". Every remittance advice the firm has sent this client, newest first -- the PDF and the
 * spreadsheet EXACTLY as they were attached, never a statement rebuilt today, so what is here matches what
 * is in their inbox.
 *
 * AND, ABOVE THEM, THE MONTHLY PROGRESS REPORT (S16): one line per debtor as at today, drawn up when it is asked
 * for from the same `book` read as Accounts (progressReport.ts). It is not a kept copy -- it says so -- because a
 * position is today's fact; the monthly email, once switched on, is what will keep each month's.
 */
const day = (iso: string) => new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/* Every line of the book, open and finished, page by page (the server sends a hundred at a time). */
async function wholeBook(token: string): Promise<PortalLine[]> {
  const out: PortalLine[] = []
  for (let guard = 0; guard < 500; guard++) {
    const b = await fetchPortalBook(token, { search: '', includeClosed: true, offset: out.length })
    out.push(...b.lines)
    if (b.lines.length === 0 || out.length >= b.total) break
  }
  return out
}

export function PortalReports({ token, onSignedOut, clientName }: { token: string; onSignedOut: () => void; clientName: string }) {
  const today = clockToday()
  const month = `${MONTHS[Number(today.slice(5, 7)) - 1]} ${today.slice(0, 4)}`
  const report = async (): Promise<ProgressReport> => {
    try { return { client: clientName, asAt: today, month, lines: await wholeBook(token) } } catch (e) {
      if (e instanceof PortalSignedOut) onSignedOut()
      throw e
    }
  }
  const [reports, setReports] = useState<PortalReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetchPortalReports(token)
      .then((r) => { if (live) setReports(r.reports) })
      .catch((e) => { if (!live) return; if (e instanceof PortalSignedOut) onSignedOut(); else setError(e.message) })
    return () => { live = false }
  }, [token, onSignedOut])

  /* THE FIRM'S ONE OPEN-AND-DOWNLOAD (FileActions): the iPad's second tap and the pop-up rule are solved
     there once, and a client on an iPad is exactly who needs them. A fresh two-minute link per press. */
  const link = async (r: PortalReport, file: 'pdf' | 'xlsx') => {
    try { return (await portalReportFile(token, r.id, file)).url } catch (e) {
      if (e instanceof PortalSignedOut) onSignedOut()
      throw e
    }
  }
  const fileName = (r: PortalReport, file: 'pdf' | 'xlsx') =>
    `Remittance advice ${r.periodEnd ?? r.sentAt.slice(0, 10)}${r.version > 1 ? ` v${r.version}` : ''}.${file}`

  if (error && !reports) return <p className="text-sm text-red-700">{error}</p>
  if (!reports) return <p className="text-sm text-slate-400">Reading your reports…</p>

  return (
    <section className="bg-white rounded-2xl border border-[#D5DBE3]" data-testid="portal-reports">
      <div className="p-4">
        <h2 className="text-xl font-bold text-[#111E2D]">Your reports</h2>
        <p className="text-sm text-slate-500">This month's progress, and every remittance advice we have sent you, exactly as it was sent.</p>
      </div>
      <div className="mx-4 mb-4 rounded-xl border border-[#C69F54]/40 bg-[#C69F54]/[0.07] px-4 py-3 flex flex-wrap items-center justify-between gap-3" data-testid="portal-progress-report">
        <div className="min-w-0">
          <p className="text-slate-900 font-semibold">Monthly progress report, {month}</p>
          <p className="text-xs text-slate-500">Every account, where it stands and what has been paid -- drawn up now, as at {day(today)}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FileActions name={`Progress report ${today}.pdf`} label="PDF" testId="portal-progress-pdf"
            fetchFile={async () => new Blob([(await progressPdf(await report())) as BlobPart], { type: 'application/pdf' })} />
          <FileActions name={`Progress report ${today}.xlsx`} label="Spreadsheet" testId="portal-progress-xlsx"
            fetchFile={async () => new Blob([progressSheet(await report()) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })} />
        </div>
      </div>
      {reports.length === 0 ? (
        <p className="px-4 pb-5 text-sm text-slate-500" data-testid="portal-no-reports">No reports yet. Your first remittance advice will be here once it is sent.</p>
      ) : (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {reports.map((r) => (
            <li key={r.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3" data-testid="portal-report">
              <div className="min-w-0">
                <p className="text-slate-900">
                  Remittance advice{r.periodStart && r.periodEnd ? `, ${day(r.periodStart)} – ${day(r.periodEnd)}` : ''}
                  {r.version > 1 && <span className="ml-2 text-xs text-slate-500">revised (version {r.version})</span>}
                </p>
                <p className="text-xs text-slate-500">Sent {day(r.sentAt)}{r.client ? ` · ${r.client}` : ''} · paid over {rand(r.amount)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {r.hasPdf && (
                  <FileActions name={fileName(r, 'pdf')} label="PDF" testId="portal-report-pdf"
                    openUrl={() => link(r, 'pdf')} fetchFile={async () => blobFromUrl(await link(r, 'pdf'))} />
                )}
                {r.hasSheet && (
                  <FileActions name={fileName(r, 'xlsx')} label="Spreadsheet" testId="portal-report-xlsx"
                    openUrl={() => link(r, 'xlsx')} fetchFile={async () => blobFromUrl(await link(r, 'xlsx'))} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="px-4 pb-4 text-sm text-red-700">{error}</p>}
    </section>
  )
}
