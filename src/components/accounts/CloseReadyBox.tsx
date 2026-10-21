import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { rand } from '../../lib/money'
import { closeReady, readyLabel, type ReadyToClose } from '../../lib/readyToClose'

/**
 * CLOSE THE ACCOUNTS WHOSE MONEY IS IN, ASKED AT THE MOMENT IT ARRIVES (the firm, 12 Oct: "when we
 * approve payments, for example, say that okay, it's been settled. You want to close this account").
 *
 * Opened by the approval queue straight after an approval that finished an account, and by Ready to
 * close. Every account is ticked -- closing is what the firm almost always wants -- and any can be
 * unticked. NOT done by itself: a paid-up account may still owe fees, and the person closing is the
 * one who can look. Each close is its own call, so one refused leaves the rest closed and is named.
 */
export function CloseReadyBox({ rows, intro, onClose, onDone }: {
  rows: ReadyToClose[]
  /** One line on why the box opened. */
  intro: string
  onClose: () => void
  onDone: () => void
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rows.map((r) => r.accountId)))
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])

  async function go() {
    if (busy) return
    setBusy(true); setProblems([])
    const chosen = rows.filter((r) => picked.has(r.accountId))
    const failed: string[] = []
    try {
      for (let i = 0; i < chosen.length; i += 1) {
        const r = chosen[i]
        setProgress(`Closing ${i + 1} of ${chosen.length} · ${r.accountNumber ?? r.caseNumber ?? ''}`)
        try { await closeReady(r) } catch (e) {
          failed.push(`${r.accountNumber ?? r.caseNumber}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    } finally {
      setBusy(false); setProgress(null)
    }
    if (failed.length) { setProblems(failed); return }
    onDone()
  }

  return (
    <Modal title={rows.length === 1 ? 'Close this account?' : `Close these ${rows.length} accounts?`}
      onClose={busy ? () => {} : onClose} width={560}>
      <div className="space-y-3" data-testid="close-ready-box">
        <p className="text-[13px] text-slate-600">{intro}</p>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {rows.map((r) => (
            <li key={r.accountId} className="flex items-start gap-2.5 px-3 py-2" data-testid="close-ready-row">
              <input type="checkbox" className="mt-1" checked={picked.has(r.accountId)} disabled={busy}
                aria-label={`Close ${r.accountNumber ?? r.caseNumber}`}
                onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(r.accountId)) n.delete(r.accountId); else n.add(r.accountId); return n })} />
              <div className="min-w-0 text-[13px]">
                <div className="font-medium text-slate-800">
                  <Link to={`/accounts/${r.accountId}`} className="hover:underline" onClick={onClose}>
                    {r.accountNumber ?? r.caseNumber}
                  </Link>
                  {r.debtor ? <span className="font-normal text-slate-500"> · {r.debtor}</span> : null}
                  {r.client ? <span className="font-normal text-slate-400"> · {r.client}</span> : null}
                </div>
                <div className="text-slate-500">{readyLabel(r, rand)}</div>
              </div>
            </li>
          ))}
        </ul>
        {problems.length > 0 && (
          <div className="rounded-lg bg-negative-50 px-3 py-2 text-[12.5px] text-negative-700" data-testid="close-ready-problems">
            {problems.map((p) => <div key={p}>{p}</div>)}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
          {progress && <span className="mr-auto text-[12.5px] text-slate-500">{progress}</span>}
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            {problems.length ? 'Done' : 'Not now'}
          </button>
          <button type="button" onClick={go} disabled={busy || picked.size === 0} data-testid="close-ready-go"
            className="rounded-lg bg-navy-950 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
            {busy ? <Loader2 size={15} className="animate-spin" /> : picked.size === 1 ? 'Close it' : `Close ${picked.size}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
