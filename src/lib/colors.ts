import type { ActivityType, DealStage, LeadClassification, LeadSource, ProductService, TaskType } from '../types'

/**
 * Single source of truth for the navy/gold-minimal categorical palette
 * used across the Kanban board, funnel, charts, activity feed, and
 * calendar. Previously duplicated per-file; consolidated here so every
 * new dashboard chart agrees with the existing ones.
 */

export const STAGE_COLORS: Record<DealStage, string> = {
  'New Deal': 'var(--stage-new-deal)',
  'Quotation Sent': 'var(--stage-quotation-sent)',
  Won: 'var(--stage-won)',
  Rejected: 'var(--stage-rejected)',
}

export const SOURCE_COLORS: Record<LeadSource, string> = {
  Website: 'var(--c-steel-soft)',
  'Google Ads': 'var(--c-gold)',
  Referral: 'var(--c-green)',
  LinkedIn: 'var(--c-steel-pale)',
  Facebook: 'var(--c-gold-deep)',
  Direct: 'var(--c-steel-light)',
  Email: 'var(--c-rust)',
  'Existing Client': 'var(--c-rust-deep)',
  'Sales Rep': 'var(--c-steel-deep)',
  Event: 'var(--c-navy-slate)',
  ChatGPT: 'var(--c-green-muted)',
  Claude: 'var(--c-gold)',
  Gemini: 'var(--c-steel-deep)',
  Other: 'var(--c-grey-light)',
}

export const SERVICE_COLORS: Record<ProductService, string> = {
  'Debt Collection': 'var(--c-gold-deep)',
  Litigation: 'var(--c-navy-deep)',
  'Executive Listing': 'var(--c-steel)',
  iCollect: 'var(--c-gold)',
  'Contract Drafting': 'var(--c-steel-deep)',
  'In-Person Debt Collection': 'var(--c-rust-deep)',
  'Credit Check': 'var(--c-navy-mid)',
  Tracing: 'var(--c-green)',
  NovaCall: 'var(--c-navy)',
  'Labour Law': 'var(--c-rust)',
  Other: 'var(--c-grey)',
}

export const SERVICE_TAILWIND: Record<ProductService, string> = {
  'Debt Collection': 'bg-[var(--tint-gold-deep)] text-[var(--c-gold-deep)]',
  Litigation: 'bg-[var(--tint-steel)] text-[var(--c-navy-deep)]',
  'Executive Listing': 'bg-[var(--tint-steel)] text-[var(--c-steel)]',
  iCollect: 'bg-[var(--tint-gold)] text-[var(--c-gold)]',
  'Contract Drafting': 'bg-[var(--tint-steel)] text-[var(--c-steel-deep)]',
  'In-Person Debt Collection': 'bg-[var(--tint-rust-deep)] text-[var(--c-rust-deep)]',
  'Credit Check': 'bg-[var(--tint-steel)] text-[var(--c-navy-mid)]',
  Tracing: 'bg-[var(--tint-green)] text-[var(--c-green)]',
  NovaCall: 'bg-[var(--tint-steel)] text-[var(--c-navy)]',
  'Labour Law': 'bg-[var(--tint-rust)] text-[var(--c-rust)]',
  Other: 'bg-slate-100 text-slate-500',
}

export const ACTIVITY_TYPE_COLORS: Record<ActivityType, string> = {
  Call: 'var(--c-steel)',
  Email: 'var(--c-navy-mid)',
  WhatsApp: 'var(--c-green)',
  Meeting: 'var(--c-gold)',
  Note: 'var(--c-gold-dark)',
  Proposal: 'var(--c-navy-deep)',
  Task: 'var(--c-rust)',
  'Status change': 'var(--c-grey-light)',
  'Deal update': 'var(--c-grey-light)',
  'Deal Stage Change': 'var(--c-navy-mid)',
  'Deal Won': 'var(--c-green-bright)',
  'Deal Rejected': 'var(--c-rust-deep)',
  'Courtesy Call': 'var(--c-steel)',
  'Handover Received': 'var(--c-gold-deep)',
}

export const ACTIVITY_TYPE_TAILWIND: Record<ActivityType, string> = {
  Call: 'bg-[var(--tint-steel)] text-[var(--c-steel)]',
  Email: 'bg-[var(--tint-steel)] text-[var(--c-navy-mid)]',
  WhatsApp: 'bg-[var(--tint-green)] text-[var(--c-green)]',
  Meeting: 'bg-[var(--tint-gold)] text-[var(--c-gold)]',
  Note: 'bg-[var(--tint-gold-dark)] text-[var(--c-gold-dark)]',
  Proposal: 'bg-[var(--tint-steel)] text-[var(--c-navy-deep)]',
  Task: 'bg-[var(--tint-rust)] text-[var(--c-rust)]',
  'Status change': 'bg-slate-100 text-slate-500',
  'Deal update': 'bg-slate-100 text-slate-500',
  'Deal Stage Change': 'bg-[var(--tint-steel)] text-[var(--c-navy-mid)]',
  'Deal Won': 'bg-[var(--tint-green-bright)] text-[var(--c-green-bright)]',
  'Deal Rejected': 'bg-[var(--tint-rust-deep)] text-[var(--c-rust-deep)]',
  'Courtesy Call': 'bg-[var(--tint-steel)] text-[var(--c-steel)]',
  'Handover Received': 'bg-[var(--tint-gold-deep)] text-[var(--c-gold-deep)]',
}

export const TASK_TYPE_COLORS: Record<TaskType, string> = {
  Call: 'var(--c-steel)',
  'Follow-up': 'var(--c-navy-mid)',
  Email: 'var(--c-navy-deep)',
  Proposal: 'var(--c-gold)',
  Meeting: 'var(--c-green)',
  WhatsApp: 'var(--c-gold-deep)',
  Research: 'var(--c-grey)',
  'Internal task': 'var(--c-grey)',
  Other: 'var(--c-grey-light)',
}

export const CLASSIFICATION_COLORS: Record<LeadClassification, string> = {
  A: 'var(--c-gold-deep)',
  B: 'var(--c-steel)',
  C: 'var(--c-gold)',
  D: 'var(--c-grey)',
}

export const CLASSIFICATION_TAILWIND: Record<LeadClassification, string> = {
  A: 'bg-[var(--tint-gold-deep)] text-[var(--c-gold-deep)]',
  B: 'bg-[var(--tint-steel)] text-[var(--c-steel)]',
  C: 'bg-[var(--tint-gold)] text-[var(--c-gold)]',
  D: 'bg-slate-100 text-slate-500',
}

export const DEAL_CLOSE_EVENT_COLOR = 'var(--c-rust)'

/** The open-pipeline-through-Won stages, in funnel order (Rejected is shown separately). */
export const FUNNEL_STAGES: DealStage[] = ['New Deal', 'Quotation Sent', 'Won']
export const FUNNEL_COLORS: string[] = FUNNEL_STAGES.map((s) => STAGE_COLORS[s])

/** Semantic tokens for KPI deltas / positive-negative indicators (mirrors --color-positive/--color-negative in index.css). */
export const POSITIVE_HEX = 'var(--c-green)'
export const NEGATIVE_HEX = 'var(--c-rust-deep)'
/** "Still open / in progress" — the third state alongside Won/Rejected on the Win Rate donut. */
export const OPEN_HEX = 'var(--c-gold)'
