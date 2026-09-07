import type { Deal, DealKind, ProductService } from '../types'

/**
 * The services we're paid on recovery rather than on delivery.
 *
 * Only debt collection: iCollect and In-Person Debt Collection are quoted and invoiced like
 * any other service, despite the names.
 */
const HANDOVER_SERVICES: string[] = ['Debt Collection']

export function isHandoverService(service?: string): boolean {
  return Boolean(service && HANDOVER_SERVICES.includes(service))
}

/** Deals created before the distinction existed carry no kind, so it's read off the service. */
export function dealKind(deal: Pick<Deal, 'kind' | 'service'>): DealKind {
  return deal.kind ?? (isHandoverService(deal.service) ? 'Handover' : 'Service')
}

export function kindForService(service?: ProductService | string): DealKind {
  return isHandoverService(service) ? 'Handover' : 'Service'
}

/**
 * What the middle stage is called on a particular deal. One column on the board, the right
 * word on each card — a debt-collection client is sent a mandate, not a quotation, and a deal
 * that needed both says so.
 */
export function dealStageLabel(deal: Pick<Deal, 'kind' | 'service' | 'stage' | 'quotationSentAt' | 'mandateSentAt'>): string {
  // Mandate Sent is a stage in its own right now, so the label is simply the stage. The one
  // case worth spelling out is a service deal that has had both documents go out.
  if (deal.stage === 'Quotation Sent' && deal.quotationSentAt && deal.mandateSentAt) return 'Quotation & Mandate Sent'
  return deal.stage
}

/** Kept as a seam for headings that once had to cover two kinds at once; they no longer do. */
export function stageColumnLabel(stage: Deal['stage']): string {
  return stage
}

/**
 * Which open stage a deal of this kind belongs in.
 *
 * A service deal goes out for quotation; a handover goes out for mandate. They are different
 * documents asking for different things, and now different columns.
 */
export function openStageForDeal(deal: Pick<Deal, 'kind' | 'service'>): Deal['stage'] {
  return dealKind(deal) === 'Handover' ? 'Mandate Sent' : 'Quotation Sent'
}

/** A handover earns nothing at signature, so it has no deal value to show — only a book. */
export function hasDealValue(deal: Pick<Deal, 'kind' | 'service'>): boolean {
  return dealKind(deal) === 'Service'
}
