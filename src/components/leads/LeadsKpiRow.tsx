import { Users, UserPlus, CheckCircle2, Trophy, Wallet, Banknote } from 'lucide-react'
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

function pctDelta(curr: number, prev: number): number {
  if (prev === 0) return curr === 0 ? 0 : 100
  return Math.round(((curr - prev) / prev) * 100)
}

const TILES: {
  key: keyof LeadsKpiValues
  label: string
  icon: typeof Users
  chip: string
  format: (v: number) => string
}[] = [
  { key: 'totalLeads', label: 'Total Leads', icon: Users, chip: 'bg-[var(--tint-steel)] text-[var(--c-steel)]', format: (v) => String(v) },
  { key: 'newLeads', label: 'New Leads', icon: UserPlus, chip: 'bg-[var(--tint-green)] text-[var(--c-green)]', format: (v) => String(v) },
  { key: 'qualified', label: 'Hot leads', icon: CheckCircle2, chip: 'bg-[var(--tint-gold)] text-[var(--c-gold)]', format: (v) => String(v) },
  { key: 'converted', label: 'Converted', icon: Trophy, chip: 'bg-[var(--tint-gold-deep)] text-[var(--c-gold-deep)]', format: (v) => String(v) },
  { key: 'estValueTotal', label: 'Estimated Value (Total)', icon: Wallet, chip: 'bg-[var(--tint-steel)] text-[var(--c-navy)]', format: formatCurrency },
  { key: 'handoverTotal', label: 'Handover Amount', icon: Banknote, chip: 'bg-[var(--tint-rust-deep)] text-[var(--c-rust-deep)]', format: formatCurrency },
]

export function LeadsKpiRow({ current, previous, compareLabel }: { current: LeadsKpiValues; previous?: LeadsKpiValues; compareLabel?: string }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {TILES.map((t) => {
        const Icon = t.icon
        const pctChange = previous ? pctDelta(current[t.key], previous[t.key]) : undefined
        const positive = pctChange !== undefined && pctChange >= 0
        return (
          <Card key={t.key} className="p-4">
            <div className="flex items-center gap-2.5">
              <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${t.chip}`}>
                <Icon size={17} />
              </span>
              <p className="text-xs text-slate-400 leading-tight">{t.label}</p>
            </div>
            <p className="text-xl font-bold text-slate-800 mt-2">{t.format(current[t.key])}</p>
            {pctChange !== undefined && (
              <p className={`text-xs font-medium mt-1 ${positive ? 'text-[var(--color-positive)]' : 'text-[var(--color-negative)]'}`}>
                {positive ? '+' : ''}
                {pctChange}% {compareLabel}
              </p>
            )}
          </Card>
        )
      })}
    </div>
  )
}
