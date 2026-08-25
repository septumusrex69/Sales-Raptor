import type { ActivityType, DealStage, LeadClassification, LeadSource, ProductService, TaskType } from '../types'

/**
 * Single source of truth for the navy/gold-minimal categorical palette
 * used across the Kanban board, funnel, charts, activity feed, and
 * calendar. Previously duplicated per-file; consolidated here so every
 * new dashboard chart agrees with the existing ones.
 */

export const STAGE_COLORS: Record<DealStage, string> = {
  'New Lead': '#6086a9',
  Contacted: '#416281',
  Qualified: '#406d58',
  'Proposal Sent': '#b28e34',
  Negotiation: '#2b4055',
  Won: '#957323',
  Lost: '#794234',
}

export const SOURCE_COLORS: Record<LeadSource, string> = {
  Website: '#5f86ab',
  'Google Ads': '#b28e34',
  Referral: '#406d58',
  LinkedIn: '#a1b8ce',
  Facebook: '#957323',
  Direct: '#799ab9',
  Email: '#ad6452',
  'Existing Client': '#794234',
  'Sales Rep': '#4d7193',
  Event: '#30465a',
  ChatGPT: '#5c7d5f',
  Claude: '#b28e34',
  Gemini: '#4d7193',
  Other: '#94a3b8',
}

export const SERVICE_COLORS: Record<ProductService, string> = {
  'Debt Collection': '#957323',
  Litigation: '#2b4055',
  'Executive Listing': '#6086a9',
  iCollect: '#b28e34',
  'Contract Drafting': '#4d7193',
  'In-Person Debt Collection': '#794234',
  'Credit Check': '#416281',
  Tracing: '#406d58',
  NovaCall: '#355069',
  'Labour Law': '#ad6452',
  Other: '#64748b',
}

export const SERVICE_TAILWIND: Record<ProductService, string> = {
  'Debt Collection': 'bg-[#f7f3eb] text-[#957323]',
  Litigation: 'bg-[#edf1f5] text-[#2b4055]',
  'Executive Listing': 'bg-[#edf1f5] text-[#6086a9]',
  iCollect: 'bg-[#f7f4eb] text-[#b28e34]',
  'Contract Drafting': 'bg-[#edf1f5] text-[#4d7193]',
  'In-Person Debt Collection': 'bg-[#f6eeec] text-[#794234]',
  'Credit Check': 'bg-[#edf1f5] text-[#416281]',
  Tracing: 'bg-[#eef4f1] text-[#406d58]',
  NovaCall: 'bg-[#edf1f5] text-[#355069]',
  'Labour Law': 'bg-[#f5eeed] text-[#ad6452]',
  Other: 'bg-slate-100 text-slate-500',
}

export const ACTIVITY_TYPE_COLORS: Record<ActivityType, string> = {
  Call: '#6086a9',
  Email: '#416281',
  WhatsApp: '#406d58',
  Meeting: '#b28e34',
  Note: '#94a3b8',
  Proposal: '#2b4055',
  Task: '#ad6452',
  'Status change': '#94a3b8',
  'Deal update': '#94a3b8',
  'Deal Stage Change': '#416281',
  'Deal Won': '#957323',
  'Deal Lost': '#794234',
}

export const ACTIVITY_TYPE_TAILWIND: Record<ActivityType, string> = {
  Call: 'bg-[#edf1f5] text-[#6086a9]',
  Email: 'bg-[#edf1f5] text-[#416281]',
  WhatsApp: 'bg-[#eef4f1] text-[#406d58]',
  Meeting: 'bg-[#f7f4eb] text-[#b28e34]',
  Note: 'bg-slate-100 text-slate-500',
  Proposal: 'bg-[#edf1f5] text-[#2b4055]',
  Task: 'bg-[#f5eeed] text-[#ad6452]',
  'Status change': 'bg-slate-100 text-slate-500',
  'Deal update': 'bg-slate-100 text-slate-500',
  'Deal Stage Change': 'bg-[#edf1f5] text-[#416281]',
  'Deal Won': 'bg-[#f7f3eb] text-[#957323]',
  'Deal Lost': 'bg-[#f6eeec] text-[#794234]',
}

export const TASK_TYPE_COLORS: Record<TaskType, string> = {
  Call: '#6086a9',
  'Follow-up': '#416281',
  Email: '#2b4055',
  Proposal: '#b28e34',
  Meeting: '#406d58',
  WhatsApp: '#957323',
  Research: '#64748b',
  'Internal task': '#64748b',
  Other: '#94a3b8',
}

export const CLASSIFICATION_COLORS: Record<LeadClassification, string> = {
  A: '#957323',
  B: '#6086a9',
  C: '#b28e34',
  D: '#64748b',
}

export const CLASSIFICATION_TAILWIND: Record<LeadClassification, string> = {
  A: 'bg-[#f7f3eb] text-[#957323]',
  B: 'bg-[#edf1f5] text-[#6086a9]',
  C: 'bg-[#f7f4eb] text-[#b28e34]',
  D: 'bg-slate-100 text-slate-500',
}

export const DEAL_CLOSE_EVENT_COLOR = '#ad6452'

/** The 6 open-pipeline-through-Won stages, in funnel order (Lost is shown separately). */
export const FUNNEL_STAGES: DealStage[] = ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Negotiation', 'Won']
export const FUNNEL_COLORS: string[] = FUNNEL_STAGES.map((s) => STAGE_COLORS[s])

/** Semantic tokens for KPI deltas / positive-negative indicators (mirrors --color-positive/--color-negative in index.css). */
export const POSITIVE_HEX = '#406d58'
export const NEGATIVE_HEX = '#794234'
/** "Still open / in progress" — the third state alongside Won/Lost on the Win Rate donut. */
export const OPEN_HEX = '#b28e34'
