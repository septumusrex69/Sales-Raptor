import type { ReactNode } from 'react'
import clsx from 'clsx'

const TONES = {
  slate: 'bg-slate-100 text-slate-600',
  blue: 'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-600',
  green: 'bg-emerald-50 text-emerald-600',
  red: 'bg-red-50 text-red-600',
  purple: 'bg-purple-50 text-purple-600',
  gold: 'bg-amber-100 text-amber-700',
} as const

export type BadgeTone = keyof typeof TONES

export function Badge({ children, tone = 'slate', className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return <span className={clsx('badge', TONES[tone], className)}>{children}</span>
}

const LEAD_STATUS_TONE: Record<string, BadgeTone> = {
  New: 'blue',
  'Attempting Contact': 'amber',
  Contacted: 'amber',
  Qualified: 'green',
  Unqualified: 'slate',
  'Proposal Required': 'purple',
  Converted: 'green',
  Lost: 'red',
}

const DEAL_STAGE_TONE: Record<string, BadgeTone> = {
  'New Lead': 'blue',
  Contacted: 'amber',
  Qualified: 'green',
  'Proposal Sent': 'purple',
  Negotiation: 'gold',
  Won: 'green',
  Lost: 'red',
}

const PRIORITY_TONE: Record<string, BadgeTone> = {
  Low: 'slate',
  Medium: 'blue',
  High: 'amber',
  Urgent: 'red',
}

const TASK_STATUS_TONE: Record<string, BadgeTone> = {
  'Not Started': 'slate',
  'In Progress': 'blue',
  Completed: 'green',
  Cancelled: 'red',
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={LEAD_STATUS_TONE[status] ?? 'slate'}>{status}</Badge>
}

export function StageBadge({ stage }: { stage: string }) {
  return <Badge tone={DEAL_STAGE_TONE[stage] ?? 'slate'}>{stage}</Badge>
}

export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge tone={PRIORITY_TONE[priority] ?? 'slate'}>{priority}</Badge>
}

export function TaskStatusBadge({ status }: { status: string }) {
  return <Badge tone={TASK_STATUS_TONE[status] ?? 'slate'}>{status}</Badge>
}
