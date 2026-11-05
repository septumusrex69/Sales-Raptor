import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Download, Loader2 } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import type { AccountQuery } from '../../lib/accountBook'
import { exportFilename } from '../../lib/accountExport'
import { ExportCancelled, runAccountExport, type ExportProgress } from '../../lib/accountExportRun'
import { saveFile } from '../../lib/fileSave'
import { firmToday } from '../../lib/dateLabels'

/**
 * EXPORT TO CSV, from the Accounts screen (Raptor · Handover 17, S18).
 *
 * WHAT GOES OUT IS WHAT IS ON SCREEN, said in words before anything runs: the book, the client, the
 * filters, the search. The firm: "you can export anything that you want to ... use your filters".
 * So there is no second set of filters in here -- the screen IS the question, and this box only
 * asks which half of it: the ticked rows, or everything the filters match.
 *
 * EVERYTHING MATCHING IS NOT THE PAGE. It is read from the database a thousand at a time, so a
 * hundred rows on screen and "57 more" below them can never become an export of a hundred.
 */
export function ExportModal({ ticked, query, matching, scope, clientName, bookName, nameOf, onClose }: {
  /** The ticked rows; empty when nothing is ticked or the whole filter is selected. */
  ticked: string[]
  query: AccountQuery
  /** How many accounts the filters match. */
  matching: number
  /** The screen's question, in words. */
  scope: string[]
  clientName: string | null
  bookName: string
  nameOf: (id: string) => string | null | undefined
  onClose: () => void
}) {
  const [which, setWhich] = useState<'ticked' | 'matching'>(ticked.length > 0 ? 'ticked' : 'matching')
  const [withMoney, setWithMoney] = useState(true)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ rows: number; expected: number; name: string; blob: Blob; needsTap: boolean } | null>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const count = which === 'ticked' ? ticked.length : matching
  const running = progress !== null && !done && !error
  /* A ROUGH TIME, so a whole-book export is started knowing it is minutes, not seconds. Measured
     against the ledger reads, which are what cost: about four hundred accounts a second. */
  const seconds = Math.round(count / (withMoney ? 400 : 4000))

  async function start() {
    const ctl = new AbortController()
    abort.current = ctl
    setError(null); setDone(null)
    setProgress({ phase: 'counting', done: 0, total: count })
    const today = firmToday()
    try {
      const res = await runAccountExport({
        selection: which === 'ticked' ? { kind: 'ids', ids: ticked } : { kind: 'matching', query },
        withMoney,
        nameOf,
        today,
        onProgress: setProgress,
        signal: ctl.signal,
      })
      const name = exportFilename({ clientName, book: bookName, today })
      const outcome = await saveFile(res.blob, name)
      setDone({ ...res, name, blob: res.blob, needsTap: outcome === 'needs-tap' })
    } catch (e) {
      if (e instanceof ExportCancelled) { setProgress(null); return }
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0
  const phaseText = !progress ? '' : progress.phase === 'counting' ? 'Counting the accounts…'
    : progress.phase === 'accounts' ? `Reading accounts: ${progress.done.toLocaleString('en-ZA')} of ${progress.total.toLocaleString('en-ZA')}`
      : progress.phase === 'money' ? `Working out balances: ${progress.done.toLocaleString('en-ZA')} of ${progress.total.toLocaleString('en-ZA')}`
        : 'Writing the file…'

  return (
    <Modal title="Export to CSV" onClose={() => { abort.current?.abort(); onClose() }} width={520}
      footer={(
        <div className="flex items-center justify-end gap-2">
          {running ? (
            <button type="button" className="btn-secondary" onClick={() => abort.current?.abort()}>Stop</button>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={onClose}>{done ? 'Close' : 'Cancel'}</button>
              {!done && (
                <button type="button" className="btn-primary inline-flex items-center gap-1.5" data-testid="export-start"
                  disabled={count === 0} onClick={() => void start()}>
                  <Download size={14} /> Export {count.toLocaleString('en-ZA')} {count === 1 ? 'account' : 'accounts'}
                </button>
              )}
            </>
          )}
        </div>
      )}>
      <div className="space-y-4 text-sm">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">What is on screen</p>
          <p className="mt-1 text-slate-700" data-testid="export-scope">{scope.join(' · ')}</p>
        </div>

        <fieldset className="space-y-2" disabled={running}>
          {ticked.length > 0 && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="radio" name="export-which" className="mt-1 accent-brand-600"
                checked={which === 'ticked'} onChange={() => setWhich('ticked')} />
              <span>
                <span className="block text-slate-800">The {ticked.length.toLocaleString('en-ZA')} ticked {ticked.length === 1 ? 'account' : 'accounts'}</span>
              </span>
            </label>
          )}
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="export-which" className="mt-1 accent-brand-600" data-testid="export-matching"
              checked={which === 'matching'} onChange={() => setWhich('matching')} />
            <span>
              <span className="block text-slate-800">All {matching.toLocaleString('en-ZA')} {matching === 1 ? 'account' : 'accounts'} these filters match</span>
              <span className="block text-[12px] text-slate-400">Every one of them, not only the rows loaded on screen.</span>
            </span>
          </label>
        </fieldset>

        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" className="mt-1 accent-brand-600" checked={withMoney} disabled={running}
            onChange={(e) => setWithMoney(e.target.checked)} data-testid="export-money" />
          <span>
            <span className="block text-slate-800">Include interest, fees, receipt fees, paid and balance</span>
            <span className="block text-[12px] text-slate-400">
              The same figures as the account page. They are worked out from each account's ledger, which
              takes longer on a big export. Capital is always included.
            </span>
          </span>
        </label>

        <p className="text-[12px] text-slate-500">
          Also in the file: case and account numbers, client reference, debtor and ID, client, handover date,
          interest rate, book, position, status and sub-status, how it ended, who is working it, when it was
          last worked, diary date, last payment and prescription date.
        </p>

        {!running && !done && seconds >= 30 && (
          <p className="flex items-start gap-2 text-[12.5px] text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>
              That is {count.toLocaleString('en-ZA')} accounts, roughly {seconds >= 90 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`}.
              Keep this window open until the file is saved.
            </span>
          </p>
        )}

        {running && (
          <div data-testid="export-progress">
            <div className="flex items-center gap-2 text-slate-600">
              <Loader2 size={14} className="animate-spin" /> {phaseText}
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {error && (
          <p className="flex items-start gap-2 text-rose-700 bg-rose-50 rounded-lg px-3 py-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>The export did not finish: {error}</span>
          </p>
        )}

        {done && (
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800" data-testid="export-done">
            <p>{done.rows.toLocaleString('en-ZA')} {done.rows === 1 ? 'account' : 'accounts'} exported to {done.name}.</p>
            {/* SAID, NEVER SWALLOWED: a file short of what the count promised looks exactly like a
                complete one. Accounts handed over or closed while it ran are the usual reason. */}
            {done.rows !== done.expected && (
              <p className="mt-1 text-amber-800">
                {done.expected.toLocaleString('en-ZA')} matched when it started. The book changed while the
                export ran — run it again if the file has to be exact.
              </p>
            )}
            {done.needsTap && (
              <button type="button" className="btn-secondary mt-2" onClick={() => void saveFile(done.blob, done.name, { fromTap: true })}>
                Save {done.name}
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
