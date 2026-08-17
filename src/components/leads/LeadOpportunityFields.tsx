import { FormField, inputClass } from '../ui/Modal'
import { MultiSelectChips } from '../ui/MultiSelectChips'
import { countries, leadClassifications, provinces, services } from '../../data/mockData'
import type { Lead, LeadClassification, ProductService } from '../../types'

/**
 * Shared field set for the new location / products-services / opportunity
 * data introduced across Add Lead and Edit Lead, so the two forms can't
 * drift apart. Numeric inputs are kept as strings here (same convention
 * Add Lead already uses for estimatedValue) and converted at submit time.
 */
export interface LeadOpportunityFormValue {
  country: string
  province: string
  city: string
  services: ProductService[]
  otherServiceDetail: string
  classification: LeadClassification | ''
  estimatedProjectValue: string
  estimatedHandoverAmount: string
  estimatedAccountsCount: string
}

export function emptyLeadOpportunityValue(): LeadOpportunityFormValue {
  return {
    country: 'South Africa',
    province: '',
    city: '',
    services: [],
    otherServiceDetail: '',
    classification: '',
    estimatedProjectValue: '',
    estimatedHandoverAmount: '',
    estimatedAccountsCount: '',
  }
}

export function leadOpportunityValueFromLead(lead: Lead): LeadOpportunityFormValue {
  return {
    country: lead.country ?? 'South Africa',
    province: lead.province ?? '',
    city: lead.city ?? '',
    services: lead.services ?? [],
    otherServiceDetail: lead.otherServiceDetail ?? '',
    classification: lead.classification ?? '',
    estimatedProjectValue: lead.estimatedProjectValue != null ? String(lead.estimatedProjectValue) : '',
    estimatedHandoverAmount: lead.estimatedHandoverAmount != null ? String(lead.estimatedHandoverAmount) : '',
    estimatedAccountsCount: lead.estimatedAccountsCount != null ? String(lead.estimatedAccountsCount) : '',
  }
}

export function leadOpportunityPatch(value: LeadOpportunityFormValue): Partial<Lead> {
  const hasDebtCollection = value.services.includes('Debt Collection')
  const hasOther = value.services.includes('Other')
  return {
    country: value.country || undefined,
    province: value.province || undefined,
    city: value.city || undefined,
    services: value.services.length ? value.services : undefined,
    otherServiceDetail: hasOther && value.otherServiceDetail ? value.otherServiceDetail : undefined,
    classification: value.classification || undefined,
    estimatedProjectValue: value.estimatedProjectValue !== '' ? Number(value.estimatedProjectValue) : undefined,
    estimatedHandoverAmount: hasDebtCollection && value.estimatedHandoverAmount !== '' ? Number(value.estimatedHandoverAmount) : undefined,
    estimatedAccountsCount: hasDebtCollection && value.estimatedAccountsCount !== '' ? Number(value.estimatedAccountsCount) : undefined,
  }
}

export function estimatedProjectValueLabel(selectedServices: ProductService[]): string {
  if (selectedServices.includes('Litigation')) return 'Estimated Matter / Claim Value (R)'
  if (selectedServices.includes('NovaCall')) return 'Estimated Contract / Project Value (R)'
  return 'Estimated Project Value (R)'
}

export function LeadOpportunityFields({ value, onChange }: { value: LeadOpportunityFormValue; onChange: (next: LeadOpportunityFormValue) => void }) {
  const hasDebtCollection = value.services.includes('Debt Collection')
  const hasOther = value.services.includes('Other')

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

      <div className="grid grid-cols-2 gap-3">
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
        <FormField label={estimatedProjectValueLabel(value.services)}>
          <input
            type="number"
            className={inputClass}
            value={value.estimatedProjectValue}
            onChange={(e) => onChange({ ...value, estimatedProjectValue: e.target.value })}
          />
        </FormField>
      </div>

      {hasDebtCollection && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Estimated Handover Amount (R)">
            <input
              type="number"
              className={inputClass}
              value={value.estimatedHandoverAmount}
              onChange={(e) => onChange({ ...value, estimatedHandoverAmount: e.target.value })}
              placeholder="e.g. 850000"
            />
          </FormField>
          <FormField label="Estimated Number of Accounts / Matters">
            <input
              type="number"
              className={inputClass}
              value={value.estimatedAccountsCount}
              onChange={(e) => onChange({ ...value, estimatedAccountsCount: e.target.value })}
              placeholder="e.g. 40"
            />
          </FormField>
        </div>
      )}
    </>
  )
}
