import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'

export interface AttentionItem {
  label: string
  /** What someone should do about it, in the words they'd use. */
  detail: string
  count: number
  to: string
}

/**
 * Everything that is going wrong, in one place, above the analysis.
 *
 * These were eight separate stat tiles competing with the eight that report performance, which
 * made the top of the page a wall of sixteen numbers with no hierarchy — the warnings looked
 * exactly like the achievements. Collapsed into one panel they read as a worklist: what is
 * unattended, how much of it, and a link straight to the filtered list.
 *
 * Sorted worst-first, and the clean ones fall to the bottom rather than disappearing, so the
 * absence of a problem is still visible rather than merely implied.
 */
export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  const sorted = [...items].sort((a, b) => b.count - a.count)
  const problems = sorted.filter((i) => i.count > 0)
  const clear = sorted.filter((i) => i.count === 0)
  const total = problems.reduce((s, i) => s + i.count, 0)

  return (
    <Card padded={false}>
      <div className="p-5 pb-3">
        <CardHeader
          title="Needs Attention"
          subtitle={
            total > 0
              ? `${total} ${total === 1 ? 'item is' : 'items are'} unattended right now`
              : 'Nothing unattended — every lead, deal and task has a next step'
          }
        />
      </div>

      {problems.length === 0 ? (
        <div className="px-5 pb-6 flex items-center gap-2.5 text-sm text-slate-500">
          <CheckCircle2 size={20} className="text-[var(--c-green)] shrink-0" />
          All clear. Nothing is sitting without a next action or past its date.
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {problems.map((item) => (
            <Link key={item.label} to={item.to} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/60 group">
              <AlertTriangle size={16} className="text-[var(--c-gold)] shrink-0" />
              <span className="w-11 text-lg font-extrabold text-slate-800 tabular-nums shrink-0">{item.count}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-slate-700 leading-snug">{item.label}</span>
                <span className="block text-[11.5px] text-slate-400">{item.detail}</span>
              </span>
              <ChevronRight size={15} className="text-slate-300 group-hover:text-brand-600 shrink-0" />
            </Link>
          ))}
        </div>
      )}

      {clear.length > 0 && problems.length > 0 && (
        <div className="px-5 py-3 border-t border-slate-50 flex flex-wrap gap-x-4 gap-y-1">
          {clear.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-400">
              <CheckCircle2 size={12} className="text-[var(--c-green)]" />
              {item.label}: none
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}
