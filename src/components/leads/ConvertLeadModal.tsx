import { useState } from 'react'
import { Modal, FormField, inputClass } from '../ui/Modal'
import { formatCurrency, services } from '../../data/mockData'
import { leadServiceValueList } from './LeadOpportunityFields'
import type { ConvertConfirmation, ConvertDealConfirmation } from '../../store/AppStore'
import type { Deal, Lead, ProductService } from '../../types'

interface Row extends ConvertDealConfirmation {
  key: string
  isDebtCollection: boolean
}

/** Deals already opened against this lead come first; anything they were interested in but never opened a deal for is offered alongside. */
function initialRows(lead: Lead, openDeals: Deal[]): Row[] {
  if (openDeals.length > 0) {
    return openDeals.map((d) => ({
      key: d.id,
      dealId: d.id,
      name: d.name,
      service: d.service,
      value: d.value,
      handoverAmount: d.handoverAmount,
      accountsCount: d.accountsCount,
      isDebtCollection: d.service === 'Debt Collection',
    }))
  }

  const fromServices = leadServiceValueList(lead)
  if (fromServices.length > 0) {
    return fromServices.map((sv) => ({
      key: sv.service,
      name: `${lead.companyName} — ${sv.service}`,
      service: sv.service,
      value: (sv.service === 'Debt Collection' ? sv.handoverAmount : sv.value) ?? 0,
      handoverAmount: sv.service === 'Debt Collection' ? sv.handoverAmount : undefined,
      accountsCount: sv.service === 'Debt Collection' ? sv.accountsCount : undefined,
      isDebtCollection: sv.service === 'Debt Collection',
    }))
  }

  return [
    {
      key: 'default',
      name: `${lead.companyName} Deal`,
      service: lead.serviceInterested,
      value: lead.estimatedValue,
      isDebtCollection: lead.serviceInterested === 'Debt Collection',
    },
  ]
}

/**
 * Converting is the moment a lead becomes a client, so it's also the moment the business
 * they signed for gets confirmed. Everything listed here is marked Won at the values entered —
 * which is what puts them in the Clients list and starts the handover — so the numbers are
 * checked once, here, rather than being inherited from an estimate nobody revisited.
 */
export function ConvertLeadModal({
  lead,
  openDeals,
  onClose,
  onConfirm,
}: {
  lead: Lead
  openDeals: Deal[]
  onClose: () => void
  onConfirm: (confirmation: ConvertConfirmation) => void
}) {
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [rows, setRows] = useState<Row[]>(() => initialRows(lead, openDeals))

  function patchRow(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const total = rows.reduce((sum, r) => sum + (r.isDebtCollection ? r.handoverAmount ?? 0 : r.value), 0)

  return (
    <Modal title="Convert to Client" onClose={onClose} width={560}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onConfirm({
            startDate: new Date(startDate).toISOString(),
            deals: rows.map(({ key: _key, isDebtCollection, ...deal }) => ({
              ...deal,
              value: isDebtCollection ? deal.handoverAmount ?? 0 : deal.value,
            })),
          })
          onClose()
        }}
      >
        <p className="text-sm text-slate-500 mb-4">
          {lead.companyName} becomes a client and the handover starts. Confirm what they signed for — each deal below is
          marked Won at the value you enter here.
        </p>

        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.key} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <input
                  className="text-sm font-medium text-slate-700 bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-brand-400 focus:outline-none flex-1 min-w-0"
                  value={row.name}
                  onChange={(e) => patchRow(row.key, { name: e.target.value })}
                  required
                />
                <span className="text-[11px] uppercase tracking-wide text-slate-400 shrink-0">
                  {row.dealId ? 'Existing deal' : 'New deal'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {!row.dealId && (
                  <FormField label="Service">
                    <select
                      className={inputClass}
                      value={row.service ?? ''}
                      onChange={(e) =>
                        patchRow(row.key, { service: e.target.value, isDebtCollection: e.target.value === 'Debt Collection' })
                      }
                    >
                      <option value="">—</option>
                      {services.map((s: ProductService) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </FormField>
                )}
                {row.isDebtCollection ? (
                  <>
                    <FormField label="Handover Amount (R)">
                      <input
                        type="number"
                        className={inputClass}
                        value={row.handoverAmount ?? ''}
                        onChange={(e) => patchRow(row.key, { handoverAmount: e.target.value === '' ? undefined : Number(e.target.value) })}
                      />
                    </FormField>
                    <FormField label="Number of Accounts">
                      <input
                        type="number"
                        className={inputClass}
                        value={row.accountsCount ?? ''}
                        onChange={(e) => patchRow(row.key, { accountsCount: e.target.value === '' ? undefined : Number(e.target.value) })}
                      />
                    </FormField>
                  </>
                ) : (
                  <FormField label="Value (R)">
                    <input
                      type="number"
                      className={inputClass}
                      value={row.value || ''}
                      onChange={(e) => patchRow(row.key, { value: Number(e.target.value) || 0 })}
                    />
                  </FormField>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <FormField label="Service Start Date" required>
            <input type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </FormField>
          <div className="flex items-end pb-2">
            <p className="text-sm text-slate-500">
              Total confirmed: <span className="font-semibold text-slate-700">{formatCurrency(total)}</span>
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Convert to Client
          </button>
        </div>
      </form>
    </Modal>
  )
}
