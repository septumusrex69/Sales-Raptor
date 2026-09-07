import { Card, CardHeader } from '../ui/Card'
import { REJECTION_REASONS } from '../../lib/rejection'
import type { Deal, Lead, RejectionReason } from '../../types'

/**
 * Why business didn't happen, ranked.
 *
 * The dashboard could already say how much was lost and never why, which is the half that
 * tells you what to change: "too expensive" is a pricing problem, "went with another provider"
 * is a competitive one, and "no response" is a follow-up one. Leads and deals are counted
 * together because a reason is a reason whether it arrived before or after a deal was opened —
 * they are split out per row for the cases where that distinction matters.
 */
export function LossReasonsCard({ leads, deals, periodLabel }: { leads: Lead[]; deals: Deal[]; periodLabel: string }) {
  const rows = REJECTION_REASONS.map((reason: RejectionReason) => {
    const leadCount = leads.filter((l) => l.rejectionReason === reason).length
    const dealCount = deals.filter((d) => d.rejectionReason === reason).length
    return { reason, leadCount, dealCount, total: leadCount + dealCount }
  })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)

  const total = rows.reduce((sum, r) => sum + r.total, 0)
  const unexplained = leads.length + deals.length - total

  return (
    <Card>
      <CardHeader title="Why We Lost" subtitle={`${leads.length + deals.length} rejected · ${periodLabel}`} />
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing was rejected in this period.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.reason}>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className="text-[13px] text-slate-600 truncate">{r.reason}</span>
                <span className="text-[13px] font-semibold text-slate-700 tabular-nums shrink-0">
                  {r.total}
                  <span className="ml-1.5 text-[11px] font-normal text-slate-400">
                    {r.leadCount > 0 && r.dealCount > 0
                      ? `${r.leadCount} lead${r.leadCount > 1 ? 's' : ''} · ${r.dealCount} deal${r.dealCount > 1 ? 's' : ''}`
                      : r.dealCount > 0
                        ? `deal${r.dealCount > 1 ? 's' : ''}`
                        : `lead${r.leadCount > 1 ? 's' : ''}`}
                  </span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--tint-steel-alt)] overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${total > 0 ? (r.total / total) * 100 : 0}%`, backgroundColor: 'var(--outcome-rejected)' }}
                />
              </div>
            </div>
          ))}
          {unexplained > 0 && (
            <p className="text-[11.5px] text-slate-400 pt-1">
              {unexplained} rejected before a reason was recorded.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
