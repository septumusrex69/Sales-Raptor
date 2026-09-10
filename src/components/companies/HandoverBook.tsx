import { Card, CardHeader } from '../ui/Card'
import { formatCurrency, formatDate } from '../../data/mockData'
import { useAppStore } from '../../store/AppStore'
import type { Company, Handover } from '../../types'

const DAY = 24 * 60 * 60 * 1000

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY)
}

/**
 * What a client signed for against what they've actually sent.
 *
 * The signed figure is a claim — clients say a million and send fifty thousand — so it's shown
 * as what it is and never scored against. What matters is the arrivals: books come in
 * instalments over months, so a client at 20% two months into a ten-month drip is on schedule,
 * not failing. That's why there's no traffic light on the fill percentage.
 *
 * The number actually worth acting on is the last one: a client with book outstanding who has
 * gone quiet is somebody to phone, and nothing else on the page says that.
 */
export function HandoverBook({ company, onLog }: { company: Company; onLog: () => void }) {
  const { handovers, deals } = useAppStore()

  const rows = handovers
    .filter((h) => h.companyId === company.id)
    .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())

  // What they signed for, taken from the mandates themselves rather than the signup estimate,
  // so it follows any correction made on the deal.
  const signedBook = deals
    .filter((d) => d.companyId === company.id && d.stage === 'Won' && d.handoverAmount != null)
    .reduce((sum, d) => sum + (d.handoverAmount ?? 0), 0)

  const received = rows.reduce((sum, h) => sum + h.capitalAmount, 0)
  const accounts = rows.reduce((sum, h) => sum + (h.accountsCount ?? 0), 0)
  const outstanding = Math.max(signedBook - received, 0)
  const fill = signedBook > 0 ? Math.round((received / signedBook) * 100) : null
  const quietDays = rows.length > 0 ? daysSince(rows[0].receivedAt) : null

  if (signedBook === 0 && rows.length === 0) return null

  return (
    <Card>
      <CardHeader
        title="Handover Book"
        subtitle={rows.length === 1 ? '1 batch received' : `${rows.length} batches received`}
        action={
          <button onClick={onLog} className="text-xs font-medium text-brand-600 hover:underline">
            Import Handover
          </button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 mb-4">
        <Figure label="Signed Book" value={formatCurrency(signedBook)} hint="What they signed for" />
        <Figure label="Received" value={formatCurrency(received)} hint={accounts > 0 ? `${accounts.toLocaleString()} accounts` : undefined} />
        <Figure label="Outstanding" value={formatCurrency(outstanding)} hint={fill !== null ? `${fill}% received` : undefined} />
        <Figure
          label="Last Batch"
          value={quietDays === null ? '—' : quietDays === 0 ? 'Today' : `${quietDays}d ago`}
          hint={outstanding > 0 && quietDays !== null && quietDays > 60 ? 'Gone quiet — worth a call' : undefined}
          alert={outstanding > 0 && quietDays !== null && quietDays > 60}
        />
      </div>

      {fill !== null && (
        <div className="h-2 rounded-full bg-[var(--tint-steel-alt)] overflow-hidden mb-4">
          <div className="h-full rounded-full" style={{ width: `${Math.min(fill, 100)}%`, backgroundColor: 'var(--outcome-won)' }} />
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing handed over yet.</p>
      ) : (
        <div className="divide-y divide-slate-100 -mx-1">
          {rows.map((h: Handover) => (
            <div key={h.id} className="flex items-baseline justify-between gap-3 px-1 py-2">
              <span className="min-w-0">
                <span className="text-[13.5px] text-slate-700">{formatCurrency(h.capitalAmount)}</span>
                {h.accountsCount != null && <span className="text-[12px] text-slate-400 ml-2">{h.accountsCount} accounts</span>}
                {h.reference && <span className="text-[12px] text-slate-400 ml-2 truncate">{h.reference}</span>}
              </span>
              <span className="text-[11.5px] text-slate-400 shrink-0 tabular-nums">{formatDate(h.receivedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function Figure({ label, value, hint, alert }: { label: string; value: string; hint?: string; alert?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 mb-1">{label}</p>
      <p className={`text-lg font-bold ${alert ? 'text-[var(--c-rust-deep)]' : 'text-slate-800'}`}>{value}</p>
      {hint && <p className={`text-[11.5px] mt-0.5 ${alert ? 'text-[var(--c-rust-deep)]' : 'text-slate-400'}`}>{hint}</p>}
    </div>
  )
}
