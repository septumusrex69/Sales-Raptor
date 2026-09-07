import { Users, UserPlus, Flame, Trophy, Wallet, Banknote } from 'lucide-react'
import { Card } from '../ui/Card'
import { formatCurrency } from '../../data/mockData'

export interface LeadsKpiValues {
  totalLeads: number
  newLeads: number
  qualified: number
  converted: number
  estValueTotal: number
  handoverTotal: number
}

const TILES: {
  key: keyof LeadsKpiValues
  label: string
  icon: typeof Users
  chip: string
  format: (v: number) => string
}[] = [
  { key: 'totalLeads', label: 'Total Leads', icon: Users, chip: 'bg-[var(--tint-steel)] text-[var(--c-steel)]', format: (v) => String(v) },
  { key: 'newLeads', label: 'New', icon: UserPlus, chip: 'bg-[var(--tint-green)] text-[var(--c-green)]', format: (v) => String(v) },
  { key: 'qualified', label: 'Hot', icon: Flame, chip: 'bg-[var(--tint-rust)] text-[var(--c-rust-deep)]', format: (v) => String(v) },
  { key: 'converted', label: 'Converted', icon: Trophy, chip: 'bg-[var(--tint-gold)] text-[var(--c-gold-deep)]', format: (v) => String(v) },
  { key: 'estValueTotal', label: 'Est. Value', icon: Wallet, chip: 'bg-[var(--tint-steel)] text-[var(--c-navy)]', format: formatCurrency },
  { key: 'handoverTotal', label: 'Handover', icon: Banknote, chip: 'bg-[var(--tint-rust-deep)] text-[var(--c-rust-deep)]', format: formatCurrency },
]

/**
 * Six figures on one line instead of six cards.
 *
 * As cards these took a full band of the page — on an iPad the lead table, which is the entire
 * point of the page, started below the fold and showed two rows. They are supporting numbers,
 * not the subject, and they now read at a glance in a strip a fraction of the height.
 *
 * The "+100% vs previous period" line under each one is gone, and not only for space. It came
 * from dividing by a zero prior period, so it appeared on every figure in any month following
 * an empty one and meant nothing wherever it appeared — the third copy of that same bug in this
 * codebase. The honest comparison lives on the dashboard, where there is room to say "no prior
 * data" when that is the truth.
 */
export function LeadsKpiRow({ current }: { current: LeadsKpiValues }) {
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center divide-x divide-slate-100">
        {TILES.map((t) => {
          const Icon = t.icon
          return (
            <div key={t.key} className="flex items-center gap-2.5 px-4 py-2.5 flex-1 min-w-[140px]">
              <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${t.chip}`}>
                <Icon size={15} />
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] text-slate-400 leading-tight truncate">{t.label}</span>
                <span className="block text-base font-bold text-slate-800 leading-tight tabular-nums">{t.format(current[t.key])}</span>
              </span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
