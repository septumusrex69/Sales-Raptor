import { FormField, inputClass } from '../ui/Modal'
import { MultiSelectChips } from '../ui/MultiSelectChips'
import { countries, leadClassifications, provinces, services } from '../../data/mockData'
import type { Lead, LeadClassification, LeadServiceValue, ProductService } from '../../types'

/**
 * Shared field set for the new location / products-services / opportunity
 * data introduced across Add Lead and Edit Lead, so the two forms can't
 * drift apart. Numeric inputs are kept as strings here (same convention
 * Add Lead already uses for estimatedValue) and converted at submit time.
 */
export interface LeadServiceFormValue {
  /** Standard services */
  value: string
  /** Debt Collection only */
  handoverAmount: string
  /** Debt Collection only */
  accountsCount: string
}

export interface LeadOpportunityFormValue {
  country: string
  province: string
  city: string
  services: ProductService[]
  otherServiceDetail: string
  classification: LeadClassification | ''
  /** Each selected service gets its own value entry, keyed by service name. */
  serviceValues: Partial<Record<ProductService, LeadServiceFormValue>>
}

const emptyServiceFormValue: LeadServiceFormValue = { value: '', handoverAmount: '', accountsCount: '' }

export function emptyLeadOpportunityValue(): LeadOpportunityFormValue {
  return {
    country: 'South Africa',
    province: '',
    city: '',
    services: [],
    otherServiceDetail: '',
    classification: '',
    serviceValues: {},
  }
}

export function leadOpportunityValueFromLead(lead: Lead): LeadOpportunityFormValue {
  const serviceValues: LeadOpportunityFormValue['serviceValues'] = {}

  if (lead.serviceValues && lead.serviceValues.length > 0) {
    for (const sv of lead.serviceValues) {
      serviceValues[sv.service] = {
        value: sv.value != null ? String(sv.value) : '',
        handoverAmount: sv.handoverAmount != null ? String(sv.handoverAmount) : '',
        accountsCount: sv.accountsCount != null ? String(sv.accountsCount) : '',
      }
    }
  } else {
    // Legacy fallback: leads saved before per-service values existed only
    // have the shared aggregate fields. Synthesize entries from those so
    // editing an old lead doesn't lose its data. The old estimatedProjectValue
    // was one shared number across every non-Debt-Collection service, so it's
    // assigned to only the first such service here rather than duplicated
    // into all of them (which would inflate the total on next save).
    let assignedProjectValue = false
    for (const service of lead.services ?? []) {
      if (service === 'Debt Collection') {
        serviceValues[service] = {
          value: '',
          handoverAmount: lead.estimatedHandoverAmount != null ? String(lead.estimatedHandoverAmount) : '',
          accountsCount: lead.estimatedAccountsCount != null ? String(lead.estimatedAccountsCount) : '',
        }
      } else {
        const useProjectValue = !assignedProjectValue && lead.estimatedProjectValue != null
        serviceValues[service] = { value: useProjectValue ? String(lead.estimatedProjectValue) : '', handoverAmount: '', accountsCount: '' }
        if (useProjectValue) assignedProjectValue = true
      }
    }
  }

  return {
    country: lead.country ?? 'South Africa',
    province: lead.province ?? '',
    city: lead.city ?? '',
    services: lead.services ?? [],
    otherServiceDetail: lead.otherServiceDetail ?? '',
    classification: lead.classification ?? '',
    serviceValues,
  }
}

export function leadOpportunityPatch(value: LeadOpportunityFormValue): Partial<Lead> {
  const hasOther = value.services.includes('Other')

  const serviceValues: LeadServiceValue[] = value.services.map((service) => {
    const entry = value.serviceValues[service] ?? emptyServiceFormValue
    if (service === 'Debt Collection') {
      return {
        service,
        handoverAmount: entry.handoverAmount !== '' ? Number(entry.handoverAmount) : undefined,
        accountsCount: entry.accountsCount !== '' ? Number(entry.accountsCount) : undefined,
      }
    }
    return { service, value: entry.value !== '' ? Number(entry.value) : undefined }
  })

  const estimatedProjectValue = serviceValues.reduce((sum, sv) => sum + (sv.value ?? 0), 0)
  const debtCollectionEntry = serviceValues.find((sv) => sv.service === 'Debt Collection')
  // The lead's single headline number — unlike estimatedProjectValue (which
  // excludes handover amounts to keep that concept distinct), this is what
  // Lead.estimatedValue now derives from everywhere it's shown (LeadsList
  // column, LeadDetail header, Reports fallback), so removing the old
  // standalone Estimated Value input doesn't lose that figure.
  const estimatedValue = serviceValues.reduce((sum, sv) => sum + (sv.value ?? 0) + (sv.handoverAmount ?? 0), 0)

  return {
    country: value.country || undefined,
    province: value.province || undefined,
    city: value.city || undefined,
    services: value.services.length ? value.services : undefined,
    otherServiceDetail: hasOther && value.otherServiceDetail ? value.otherServiceDetail : undefined,
    classification: value.classification || undefined,
    serviceValues: serviceValues.length ? serviceValues : undefined,
    estimatedValue,
    estimatedProjectValue: estimatedProjectValue > 0 ? estimatedProjectValue : undefined,
    estimatedHandoverAmount: debtCollectionEntry?.handoverAmount,
    estimatedAccountsCount: debtCollectionEntry?.accountsCount,
  }
}

/** Friendlier label for a single service's value field. */
export function serviceValueLabel(service: ProductService): string {
  if (service === 'Litigation') return 'Estimated Matter / Claim Value (R)'
  if (service === 'NovaCall') return 'Estimated Contract / Project Value (R)'
  return 'Estimated Value (R)'
}

/**
 * Read-only per-service breakdown for display (e.g. LeadDetail). Uses
 * lead.serviceValues when present; falls back to synthesizing entries from
 * the legacy aggregate fields for leads saved before this existed, using
 * the same assignment rule as leadOpportunityValueFromLead above.
 */
export function leadServiceValueList(lead: Lead): LeadServiceValue[] {
  if (lead.serviceValues && lead.serviceValues.length > 0) return lead.serviceValues

  const result: LeadServiceValue[] = []
  let assignedProjectValue = false
  for (const service of lead.services ?? []) {
    if (service === 'Debt Collection') {
      result.push({ service, handoverAmount: lead.estimatedHandoverAmount, accountsCount: lead.estimatedAccountsCount })
    } else {
      const useProjectValue = !assignedProjectValue && lead.estimatedProjectValue != null
      result.push({ service, value: useProjectValue ? lead.estimatedProjectValue : undefined })
      if (useProjectValue) assignedProjectValue = true
    }
  }
  return result
}

export function LeadOpportunityFields({ value, onChange }: { value: LeadOpportunityFormValue; onChange: (next: LeadOpportunityFormValue) => void }) {
  const hasOther = value.services.includes('Other')

  function updateServiceValue(service: ProductService, patch: Partial<LeadServiceFormValue>) {
    const current = value.serviceValues[service] ?? emptyServiceFormValue
    onChange({ ...value, serviceValues: { ...value.serviceValues, [service]: { ...current, ...patch } } })
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <FormField label="Country">
          <input list="lead-countries" className={inputClass} value={value.country} onChange={(e) => onChange({ ...value, country: e.target.value })} />
          <datalist id="lead-countries">
            {countries.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </FormField>
        <FormField label="Province">
          <select className={inputClass} value={value.province} onChange={(e) => onChange({ ...value, province: e.target.value })}>
            <option value="">—</option>
            {provinces.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </FormField>
        <FormField label="City / Town">
          <input className={inputClass} value={value.city} onChange={(e) => onChange({ ...value, city: e.target.value })} />
        </FormField>
      </div>

      <FormField label="Products / Services Interested In">
        <MultiSelectChips
          options={services}
          value={value.services}
          onChange={(next) => onChange({ ...value, services: next })}
        />
      </FormField>

      {hasOther && (
        <FormField label="Please specify">
          <input
            className={inputClass}
            value={value.otherServiceDetail}
            onChange={(e) => onChange({ ...value, otherServiceDetail: e.target.value })}
            placeholder="Describe the other service"
          />
        </FormField>
      )}

      <FormField label="Lead Classification">
        <select className={inputClass} value={value.classification} onChange={(e) => onChange({ ...value, classification: e.target.value as LeadClassification | '' })}>
          <option value="">—</option>
          {leadClassifications.map((c) => (
            <option key={c} value={c}>
              Class {c}
            </option>
          ))}
        </select>
      </FormField>

      {value.services.length > 0 && (
        <div className="space-y-3">
          {value.services.map((service) => {
            const entry = value.serviceValues[service] ?? emptyServiceFormValue
            if (service === 'Debt Collection') {
              return (
                <div key={service} className="grid grid-cols-2 gap-3">
                  <FormField label="Estimated Handover Amount (R)">
                    <input
                      type="number"
                      className={inputClass}
                      value={entry.handoverAmount}
                      onChange={(e) => updateServiceValue(service, { handoverAmount: e.target.value })}
                      placeholder="e.g. 850000"
                    />
                  </FormField>
                  <FormField label="Estimated Number of Accounts / Matters">
                    <input
                      type="number"
                      className={inputClass}
                      value={entry.accountsCount}
                      onChange={(e) => updateServiceValue(service, { accountsCount: e.target.value })}
                      placeholder="e.g. 40"
                    />
                  </FormField>
                </div>
              )
            }
            const label = value.services.length > 1 ? `${service} — ${serviceValueLabel(service)}` : serviceValueLabel(service)
            return (
              <FormField key={service} label={label}>
                <input type="number" className={inputClass} value={entry.value} onChange={(e) => updateServiceValue(service, { value: e.target.value })} />
              </FormField>
            )
          })}
        </div>
      )}
    </>
  )
}
