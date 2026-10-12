import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { CloseReadyBox } from '../../components/accounts/CloseReadyBox'
import { formatDate } from '../../data/mockData'
import { rand } from '../../lib/money'
import { fetchReadyToClose, type ReadyToClose as Row } from '../../lib/readyToClose'
import { useAuth } from '../../store/AuthContext'
import { canRecordPayment } from '../../lib/permissions'

/**
 * READY TO CLOSE: EVERY ACCOUNT WHOSE MONEY IS IN AND NOBODY CLOSED IT (the firm, 12 Oct, on
 * HTH/4004: "I'm sure it's somewhere flagged to be closed").
 *
 * The approval queue offers the close the moment a payment finishes an account; this is the net
 * under it, for the ones somebody said "not now" to, or that finished some other way. It belongs
 * with the BOOK, not with trust: closing is a collections decision about a file, and the money has
 * already moved. Read from `accounts_ready_to_close`, the same function the queue asks.
 */
export function ReadyToClose() {
  const { currentUser } = useAuth()
  const mayClose = canRecordPayment(currentUser)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [closing, setClosing] = useState<Row[] | null>(null)

  const load = useCallback(async () => {
    try { setRows(await fetchReadyToClose()); setError(null) }
    catch (e) { setError(e instanceof Error ? e.message : 'The list could not be read.') }
  }, [])
  useEffect(() => { void load() }, [load])

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="space-y-4" data-testid="ready-to-close">
      <Link to="/accounts" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> All accounts
      </Link>
      <div>
        <h1 className="text-lg font-semibold text-slate-800">Ready to close</h1>
        <p className="text-[13px] text-slate-500">
          The money is in and the account is still open: a settlement paid in full, or the capital paid off.
          A settlement closes as settled and the rest is waived by the client; a paid-up account may still
          have interest or fees behind it, so open it if unsure.
        </p>
      </div>
      <Card padded={false}>
        {error ? (
          <p className="px-4 py-3 text-[13px] text-negative-700">{error}</p>
        ) : !rows ? (
          <div className="py-8 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-400" /></div>
        ) : rows.length === 0 ? (
          <div className="flex items-start gap-3 px-5 py-4" data-testid="ready-to-close-empty">
            <Check size={20} className="mt-0.5 shrink-0 text-[var(--c-steel)]" />
            <p className="text-[14px] text-slate-700">Nothing is waiting to be closed.</p>
          </div>
        ) : (
          <>
            {mayClose && (
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                <span className="text-[12.5px] text-slate-500">{rows.length} {rows.length === 1 ? 'account' : 'accounts'}</span>
                <button type="button" disabled={picked.size === 0}
                  onClick={() => setClosing(rows.filter((r) => picked.has(r.accountId)))}
                  className="rounded-lg bg-navy-950 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
                  {picked.size === 0 ? 'Close selected' : `Close ${picked.size}`}
                </button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full list-table whitespace-nowrap">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400">
                    {mayClose && <th className="w-8 px-3 py-1.5" />}
                    <th className="px-3 py-1.5 text-left font-medium">Account</th>
                    <th className="px-2 py-1.5 text-left font-medium">Debtor</th>
                    <th className="px-2 py-1.5 text-left font-medium">Client</th>
                    <th className="px-2 py-1.5 text-left font-medium">Ends as</th>
                    <th className="px-2 py-1.5 text-left font-medium">Last payment</th>
                    {mayClose && <th className="px-3 py-1.5" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.accountId} className="border-b border-slate-50 last:border-0" data-testid="ready-row">
                      {mayClose && (
                        <td className="px-3 py-1.5">
                          <input type="checkbox" checked={picked.has(r.accountId)} onChange={() => toggle(r.accountId)}
                            aria-label={`Pick ${r.accountNumber ?? r.caseNumber}`} />
                        </td>
                      )}
                      <td className="px-3 py-1.5">
                        <Link to={`/accounts/${r.accountId}`} className="font-medium text-slate-800 hover:underline">
                          {r.accountNumber ?? r.caseNumber}
                        </Link>
                        {r.caseNumber && r.accountNumber && <div className="text-[11.5px] text-slate-400">{r.caseNumber}</div>}
                      </td>
                      <td className="px-2 py-1.5 text-slate-600">{r.debtor ?? '—'}</td>
                      <td className="px-2 py-1.5 text-slate-500">{r.client ?? '—'}</td>
                      <td className="px-2 py-1.5 text-slate-600">
                        {r.kind === 'settled'
                          ? `Settled · ${rand(r.settlementAmount ?? 0)} paid`
                          : 'Paid up · capital nil'}
                      </td>
                      <td className="px-2 py-1.5 text-slate-500">{r.lastPaidOn ? formatDate(r.lastPaidOn) : '—'}</td>
                      {mayClose && (
                        <td className="px-3 py-1.5 text-right">
                          <button type="button" onClick={() => setClosing([r])} data-testid="ready-close-one"
                            className="rounded-md border border-slate-200 px-2 py-0.5 text-[11.5px] font-medium text-slate-600 hover:bg-slate-100">
                            Close
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
      {closing && (
        <CloseReadyBox rows={closing}
          intro={closing.length === 1 ? 'Its money is in.' : 'Their money is in.'}
          onClose={() => setClosing(null)}
          onDone={() => { setClosing(null); setPicked(new Set()); void load() }} />
      )}
    </div>
  )
}
