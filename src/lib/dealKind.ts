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
  if (deal.stage !== 'Quotation Sent') return deal.stage
  const quoted = Boolean(deal.quotationSentAt)
  const mandated = Boolean(deal.mandateSentAt)
  if (quoted && mandated) return 'Quotation & Mandate Sent'
  if (mandated) return 'Mandate Sent'
  if (quoted) return 'Quotation Sent'
  return dealKind(deal) === 'Handover' ? 'Mandate Sent' : 'Quotation Sent'
}

/** The heading for that stage's column, which has to cover both kinds at once. */
export function stageColumnLabel(stage: Deal['stage']): string {
  return stage === 'Quotation Sent' ? 'Quotation / Mandate Sent' : stage
}

/** A handover earns nothing at signature, so it has no deal value to show — only a book. */
export function hasDealValue(deal: Pick<Deal, 'kind' | 'service'>): boolean {
  return dealKind(deal) === 'Service'
}
