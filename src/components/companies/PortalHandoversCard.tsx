import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderUp } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { formatDate } from '../../data/mockData'
import { uploadPathFor } from '../../lib/handoverUpload'
import { decideClientHandover, fetchClientHandovers, type ClientHandoverSubmission } from '../../lib/portalHandoverStaff'

/**
 * HANDED OVER IN THE PORTAL (S15, phase 2b). What this client sent from the client portal, newest first: the
 * ones waiting are worked from here -- OPEN IN THE IMPORT (the same screen as Upload a batch, with the files
 * already in it) or DECLINE with the reason the client will read. Shown only to somebody who may load this
 * client's accounts: the rows are read under that rule, and somebody else gets an empty list and no card.
 */
export function PortalHandoversCard({ clientId }: { clientId: string }) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<ClientHandoverSubmission[] | null>(null)
  const [declining, setDeclining] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = () => fetchClientHandovers(clientId).then(setRows).catch(() => setRows([]))
  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId])

  if (!rows || rows.length === 0) return null
  const waiting = rows.filter((r) => r.status === 'received').length
  return (
    <div data-testid="portal-handovers-card">
      <Card>
        <CardHeader title="Handed over in the portal"
          subtitle={waiting ? `${waiting} waiting for you. Open one in the import to check it and load it, or decline it and say why.` : 'Everything the client sent from the portal has been dealt with.'} />
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.id} className="py-2.5" data-testid="portal-handover-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {r.kind === 'single' ? `One account · ${r.fileName.replace(/\.csv$/i, '')}` : r.fileName}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDate(r.createdAt)} · {r.submittedBy}
                    {r.pdfNames.length ? ` · ${r.pdfNames.length} PDF${r.pdfNames.length === 1 ? '' : 's'}` : ''}
                    {r.status === 'loaded' ? ` · loaded${r.decidedByName ? ` by ${r.decidedByName}` : ''}` : ''}
                    {r.status === 'declined' ? ` · declined: ${r.declineReason}` : ''}
                  </p>
                  {r.note && <p className="text-xs text-slate-600 mt-0.5">“{r.note}”</p>}
                </div>
                {r.status === 'received' && (
                  <div className="flex gap-2">
                    <button type="button" data-testid="portal-handover-open"
                      onClick={() => navigate(`${uploadPathFor(clientId)}?submission=${r.id}`)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
                      <FolderUp size={13} /> Open in the import
                    </button>
                    <button type="button" onClick={() => { setDeclining(r.id); setReason(''); setError(null) }}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600">Decline</button>
                  </div>
                )}
              </div>
              {declining === r.id && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why -- the client reads this"
                    className="flex-1 min-w-[14rem] rounded-md border border-slate-200 px-2.5 py-1.5 text-sm" data-testid="portal-handover-reason" />
                  <button type="button" disabled={!reason.trim()} data-testid="portal-handover-decline"
                    onClick={async () => {
                      try { await decideClientHandover(r.id, 'declined', { reason }); setDeclining(null); await load() }
                      catch (e) { setError(e instanceof Error ? e.message : String(e)) }
                    }}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Decline it</button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
      </Card>
    </div>
  )
}
