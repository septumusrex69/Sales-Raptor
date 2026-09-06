import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { LeadClassification, ProductService } from '../../types'
import { CLASSIFICATION_TAILWIND, SERVICE_TAILWIND } from '../../lib/colors'

const TONES = {
  slate: 'bg-slate-100 text-slate-600',
  new: 'bg-[var(--tint-steel)] text-[var(--c-steel)]',
  contacted: 'bg-[var(--tint-steel)] text-[var(--c-navy-mid)]',
  attempting: 'bg-[var(--tint-rust)] text-[var(--c-rust)]',
  qualified: 'bg-[var(--tint-green)] text-[var(--c-green)]',
  proposal: 'bg-[var(--tint-gold)] text-[var(--c-gold)]',
  negotiation: 'bg-[var(--tint-steel)] text-[var(--c-navy-deep)]',
  won: 'bg-[var(--tint-gold-deep)] text-[var(--c-gold-deep)]',
  lost: 'bg-[var(--tint-rust-deep)] text-[var(--c-rust-deep)]',
} as const

export type BadgeTone = keyof typeof TONES

export function Badge({ children, tone = 'slate', className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return <span className={clsx('badge', TONES[tone], className)}>{children}</span>
}

const LEAD_STATUS_TONE: Record<string, BadgeTone> = {
  'No Contact Yet': 'new',
  Interested: 'contacted',
  'Hot Lead': 'qualified',
  Converted: 'won',
  Rejected: 'lost',
}

const DEAL_STAGE_TONE: Record<string, BadgeTone> = {
  'New Deal': 'new',
  'Quotation Sent': 'proposal',
  Won: 'won',
  Rejected: 'lost',
}

const PRIORITY_TONE: Record<string, BadgeTone> = {
  Low: 'slate',
  Medium: 'new',
  High: 'attempting',
  Urgent: 'lost',
}

const TASK_STATUS_TONE: Record<string, BadgeTone> = {
  'Not Started': 'slate',
  'In Progress': 'new',
  Completed: 'won',
  Cancelled: 'lost',
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

export function ServiceBadge({ service, className }: { service: ProductService; className?: string }) {
  return <span className={clsx('badge', SERVICE_TAILWIND[service] ?? SERVICE_TAILWIND.Other, className)}>{service}</span>
}

export function ClassificationBadge({ classification, className }: { classification: LeadClassification; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0',
        CLASSIFICATION_TAILWIND[classification] ?? CLASSIFICATION_TAILWIND.D,
        className,
      )}
      title={`Class ${classification}`}
    >
      {classification}
    </span>
  )
}
