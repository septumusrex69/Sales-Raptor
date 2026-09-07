import { Link } from 'react-router-dom'
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'

export interface AttentionItem {
  label: string
  /** What someone should do about it, in the words they'd use. */
  detail: string
  count: number
  to: string
  /** 'late' is already past a date; 'unattended' is merely sitting with nothing scheduled. */
  severity?: 'late' | 'unattended'
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
  // Already-late work leads regardless of size. Sorting on count alone put three overdue
  // tasks behind thirteen deals that merely have nothing scheduled — the bigger number, but
  // not the more urgent one, and the red card ended up third.
  const rank = (i: AttentionItem) => (i.severity === 'late' ? 0 : 1)
  const sorted = [...items].sort((a, b) => rank(a) - rank(b) || b.count - a.count)
  const problems = sorted.filter((i) => i.count > 0)
  const clear = sorted.filter((i) => i.count === 0)

  return (
    <Card>
      <CardHeader title="Needs Attention" subtitle="Key items requiring your action" />

      {problems.length === 0 ? (
        <div className="flex items-center gap-2.5 text-sm text-slate-500">
          <CheckCircle2 size={20} className="text-[var(--c-green)] shrink-0" />
          All clear. Nothing is sitting without a next action or past its date.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {problems.map((item) => {
            // Overdue work is the only one of these that is already late rather than merely
            // unattended, so it is the only one that gets the red.
            const severe = item.severity === 'late'
            return (
              <Link
                key={item.label}
                to={item.to}
                title={item.detail}
                className="flex items-center gap-3 rounded-xl border border-slate-100 px-3.5 py-3 hover:bg-slate-50/60 hover:border-slate-200 group"
              >
                <span
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: severe ? 'var(--tint-rust)' : 'var(--tint-gold)' }}
                >
                  {severe ? (
                    <AlertCircle size={17} style={{ color: 'var(--c-rust-deep)' }} />
                  ) : (
                    <AlertTriangle size={16} style={{ color: 'var(--c-gold-deep)' }} />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-extrabold text-slate-800 leading-none tabular-nums">{item.count}</span>
                  <span className="block text-[11.5px] text-slate-500 leading-snug mt-1">{item.label}</span>
                </span>

                <span
                  className="text-[11px] font-semibold whitespace-nowrap shrink-0 inline-flex items-center gap-0.5"
                  style={{ color: severe ? 'var(--c-rust-deep)' : 'var(--c-gold-deep)' }}
                >
                  Review <ChevronRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
                </span>
              </Link>
            )
          })}
        </div>
      )}

      {clear.length > 0 && problems.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-50 flex flex-wrap gap-x-4 gap-y-1">
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
