import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ArrowDownRight, Info } from 'lucide-react'
import clsx from 'clsx'
import { Card } from './Card'

export interface StatTileProps {
  label: string
  value: string
  /** e.g. "vs August" — shown after the % change */
  compareLabel?: string
  /**
   * `undefined` shows no comparison at all. `null` means a comparison was asked for and
   * genuinely cannot be computed — the prior period was zero — and says so in words rather
   * than reporting a fabricated 100% rise, which is what a zero base produces arithmetically
   * and what makes a dashboard stop being believed.
   */
  pctChange?: number | null
  absChange?: string
  /** renders the tile as a Link */
  to?: string
  onClick?: () => void
  size?: 'primary' | 'secondary'
  icon?: ReactNode
  /** Gold top border + gold value — for the one number on a page that matters most. Use sparingly. */
  accent?: 'gold'
  /** What this number actually counts, for the terms that aren't self-evident. */
  hint?: string
}

export function StatTile({ label, value, compareLabel, pctChange, absChange, to, onClick, size = 'primary', icon, accent, hint }: StatTileProps) {
  const interactive = Boolean(to || onClick)
  const positive = pctChange !== undefined && pctChange !== null && pctChange >= 0

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-400 flex items-center gap-1">
          {label}
          {hint && (
            <span title={hint} className="inline-flex text-slate-300 cursor-help" aria-label={hint}>
              <Info size={11} />
            </span>
          )}
        </p>
        {icon}
      </div>
      <p className={clsx('font-bold mt-1', size === 'primary' ? 'text-2xl' : 'text-xl', accent === 'gold' ? 'text-gold-600' : 'text-slate-800')}>{value}</p>
      {pctChange === null && (
        <p className="text-xs font-medium mt-1.5 text-slate-300">No prior data{compareLabel ? ` ${compareLabel}` : ''}</p>
      )}
      {pctChange !== undefined && pctChange !== null && (
        <p
          className={clsx(
            'flex items-center gap-1 text-xs font-medium mt-1.5',
            positive ? 'text-[var(--color-positive)]' : 'text-[var(--color-negative)]',
          )}
        >
          {positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
          {Math.abs(pctChange)}%
          {absChange && <span className="text-slate-400 font-normal">{absChange}</span>}
          {compareLabel && <span className="text-slate-400 font-normal">{compareLabel}</span>}
        </p>
      )}
    </>
  )

  const cardClassName = clsx(
    size === 'secondary' && 'p-4',
    interactive && 'transition-shadow hover:ring-2 hover:ring-brand-500/20',
    accent === 'gold' && 'border-t-[2.5px] border-t-gold-500',
  )

  if (to) {
    return (
      <Link to={to} className="block h-full">
        <Card className={cardClassName}>{body}</Card>
      </Link>
    )
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="block h-full w-full text-left">
        <Card className={cardClassName}>{body}</Card>
      </button>
    )
  }
  return <Card className={cardClassName || undefined}>{body}</Card>
}
