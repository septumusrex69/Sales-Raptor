import { useState } from 'react'
import { Modal, FormField, inputClass } from '../ui/Modal'
import { formatCurrency, services } from '../../data/mockData'
import { leadServiceValueList } from './LeadOpportunityFields'
import { REJECTION_REASONS } from '../../lib/rejection'
import type { ConvertConfirmation, ConvertDealConfirmation, ConvertDealOutcome } from '../../store/AppStore'
import type { Deal, Lead, ProductService, RejectionReason } from '../../types'

const OUTCOMES: { value: ConvertDealOutcome; label: string; hint: string }[] = [
  { value: 'signed', label: 'Signed', hint: 'Confirmed and won at the values below' },
  { value: 'open', label: 'Still open', hint: 'Stays in the pipeline against the client' },
  { value: 'rejected', label: 'Rejected', hint: 'They turned this one down' },
]

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
      outcome: 'signed',
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
      outcome: 'signed',
      isDebtCollection: sv.service === 'Debt Collection',
    }))
  }

  return [
    {
      key: 'default',
      name: `${lead.companyName} Deal`,
      service: lead.serviceInterested,
      value: lead.estimatedValue,
      outcome: 'signed',
      isDebtCollection: lead.serviceInterested === 'Debt Collection',
    },
  ]
}

/**
 * Converting is the moment a lead becomes a client, so it's also the moment each piece of
 * business discussed with them gets an answer.
 *
 * It used to have only one answer: everything listed was marked Won. That holds only when a
 * client signs for all of it at once, which is not how it goes — the debt collection mandate
 * gets signed while a quotation for another service is still sitting with them, or has been
 * turned down. So each deal is settled on its own here, and only the signed ones take values.
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

  // Only signed business counts towards the total, and only signed business makes a client:
  // converting with nothing signed would put a company in the Clients list on the strength of
  // a quotation they haven't answered.
  const signed = rows.filter((r) => r.outcome === 'signed')
  const total = signed.reduce((sum, r) => sum + (r.isDebtCollection ? r.handoverAmount ?? 0 : r.value), 0)
  const missingReason = rows.some((r) => r.outcome === 'rejected' && !r.rejectionReason)
  const blocked = signed.length === 0 || missingReason

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
          {lead.companyName} becomes a client. Settle each deal below on its own — they don't all have to land at the same
          time. Anything left open stays on the board against the client and can be worked from there.
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
              {/* The outcome comes before the figures because it decides whether there are any:
                  a deal that wasn't signed has no value to confirm. */}
              <div className="inline-flex rounded-lg border border-slate-200 p-0.5 mb-2.5" role="group" aria-label="Outcome">
                {OUTCOMES.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    title={o.hint}
                    aria-pressed={row.outcome === o.value}
                    onClick={() => patchRow(row.key, { outcome: o.value })}
                    className={
                      row.outcome === o.value
                        ? 'text-[12px] font-semibold px-2.5 py-1 rounded-md bg-brand-600 text-white'
                        : 'text-[12px] font-medium px-2.5 py-1 rounded-md text-slate-500 hover:bg-slate-50'
                    }
                  >
                    {o.label}
                  </button>
                ))}
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

                {row.outcome === 'signed' &&
                  (row.isDebtCollection ? (
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
                  ))}

                {row.outcome === 'rejected' && (
                  <>
                    <FormField label="Reason" required>
                      <select
                        className={inputClass}
                        value={row.rejectionReason ?? ''}
                        onChange={(e) => patchRow(row.key, { rejectionReason: (e.target.value || undefined) as RejectionReason | undefined })}
                        required
                      >
                        <option value="">Select a reason…</option>
                        {REJECTION_REASONS.map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Note">
                      <input
                        className={inputClass}
                        value={row.rejectionNote ?? ''}
                        onChange={(e) => patchRow(row.key, { rejectionNote: e.target.value })}
                        placeholder="Optional"
                      />
                    </FormField>
                  </>
                )}
              </div>

              {row.outcome === 'open' && (
                <p className="text-[12px] text-slate-400">
                  {row.dealId
                    ? 'Keeps its current stage and moves to the client, so it stays on the board to be worked.'
                    : 'Opens as a new deal against the client, so it stays on the board to be worked.'}
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <FormField label="Service Start Date" required>
            <input type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </FormField>
          <div className="flex items-end pb-2">
            <p className="text-sm text-slate-500">
              Signed total: <span className="font-semibold text-slate-700">{formatCurrency(total)}</span>
            </p>
          </div>
        </div>

        {blocked && (
          <p className="text-[12px] text-[var(--c-rust-deep)] mt-3">
            {signed.length === 0
              ? 'Mark at least one deal as signed — a client is someone who signed for something.'
              : 'Give a reason for each rejected deal.'}
          </p>
        )}

        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={blocked}
            className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Convert to Client
          </button>
        </div>
      </form>
    </Modal>
  )
}
