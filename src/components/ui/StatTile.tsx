import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'
import clsx from 'clsx'
import { Card } from './Card'

export interface StatTileProps {
  label: string
  value: string
  /** e.g. "vs August" — shown after the % change */
  compareLabel?: string
  pctChange?: number
  absChange?: string
  /** renders the tile as a Link */
  to?: string
  onClick?: () => void
  size?: 'primary' | 'secondary'
  icon?: ReactNode
}

export function StatTile({ label, value, compareLabel, pctChange, absChange, to, onClick, size = 'primary', icon }: StatTileProps) {
  const interactive = Boolean(to || onClick)
  const positive = pctChange !== undefined && pctChange >= 0

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-400">{label}</p>
        {icon}
      </div>
      <p className={clsx('font-bold text-slate-800 mt-1', size === 'primary' ? 'text-2xl' : 'text-xl')}>{value}</p>
      {pctChange !== undefined && (
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

  const cardClassName = clsx(size === 'secondary' && 'p-4', interactive && 'transition-shadow hover:ring-2 hover:ring-brand-500/20')

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
  return <Card className={size === 'secondary' ? 'p-4' : undefined}>{body}</Card>
}
