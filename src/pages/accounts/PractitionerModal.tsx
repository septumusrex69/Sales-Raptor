import { useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { PRACTITIONER_KINDS, type PractitionerKind } from '../../lib/accountStanding.ts'
import { savePractitioner } from '../../lib/accountStandingData.ts'
import type { DebtorAccount } from '../../lib/accountBook'

/**
 * Who to deal with when the debtor is no longer the person to ask.
 *
 * TYPED BY A PERSON, and it has to be. A bureau profile says a company is in final liquidation
 * and does not name the liquidator — one real report was checked end to end for it, and the only
 * thing under "Trustee Of" was a directorship field. The name comes from the Master's office, the
 * notice in the Gazette, or the client, and somebody has to go and get it.
 *
 * Which is why the upload PROPOSES this rather than filling it in: the account can be put on the
 * right rung from the document, and then this asks the one question the document cannot answer.
 */
export function PractitionerModal({ account, onClose, onDone, suggestKind }: {
  account: DebtorAccount
  onClose: () => void
  onDone: () => Promise<void>
  /**
   * The office the company's status implies — a liquidation implies a liquidator.
   *
   * Only used when the account has none recorded. An account that already names a trustee is not
   * overwritten by a guess made from a status line.
   */
  suggestKind?: PractitionerKind | null
}) {
  const [kind, setKind] = useState<PractitionerKind | ''>(account.practitionerKind ?? suggestKind ?? '')
  const [name, setName] = useState(account.practitionerName ?? '')
  const [firm, setFirm] = useState(account.practitionerFirm ?? '')
  const [reference, setReference] = useState(account.practitionerReference ?? '')
  const [phone, setPhone] = useState(account.practitionerPhone ?? '')
  const [email, setEmail] = useState(account.practitionerEmail ?? '')
  const [appointedOn, setAppointedOn] = useState(account.practitionerAppointedOn ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chosen = PRACTITIONER_KINDS.find((p) => p.kind === kind)

  async function save() {
    setBusy(true); setError(null)
    try {
      await savePractitioner(account.id, {
        kind: kind === '' ? null : kind,
        name, firm, reference, phone, email,
        appointedOn: appointedOn || null,
      })
      await onDone()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal title="Who is handling this estate?" onClose={onClose} width={520}>
      <FormField label="What have they been appointed as">
        <select value={kind} onChange={(e) => setKind(e.target.value as PractitionerKind | '')} className={inputClass}>
          <option value="">Nobody — the debtor is still the person to ask</option>
          {PRACTITIONER_KINDS.map((p) => (
            <option key={p.kind} value={p.kind}>{p.label}</option>
          ))}
        </select>
      </FormField>
      {chosen && <p className="-mt-2 mb-3.5 text-[11px] text-slate-500">{chosen.meaning}</p>}

      {kind !== '' && (
        <>
          <FormField label="Their name"><input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="The individual appointed" /></FormField>
          <FormField label="Their firm"><input value={firm} onChange={(e) => setFirm(e.target.value)} className={inputClass} /></FormField>
          {/* Every claim submission has to quote it back, so it is asked for in its own right. */}
          <FormField label="Their reference for the estate"><input value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} placeholder="e.g. T1234/2025" /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} /></FormField>
            <FormField label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={inputClass} /></FormField>
          </div>
          {/* Claims run on deadlines counted from the appointment, not from our handover. */}
          <FormField label="Appointed on"><input value={appointedOn} onChange={(e) => setAppointedOn(e.target.value)} type="date" className={inputClass} /></FormField>

          {/*
            WHERE TO GO AND LOOK, because the trace does not carry it and the firm asked for
            "add the practitioner or look for the practitioner". These are the two places the
            appointment is actually published.
          */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 mb-3.5">
            <p className="text-[11px] font-medium text-slate-600 mb-1">If you do not have the name yet</p>
            <p className="text-[11px] text-slate-500">
              An appointment is published before it reaches a bureau profile &mdash; a trace will not
              carry it. It is in the <em>Government Gazette</em> notice, or from the Master of the
              High Court for the district the estate sits in. The client often has it too: they were
              served.
            </p>
            <a href="https://www.gov.za/documents/government-gazette" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--c-steel)] hover:underline mt-1.5">
              Government Gazette <ExternalLink size={11} />
            </a>
          </div>
        </>
      )}

      {error && <p className="text-sm text-negative-700 mb-3">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        {busy && <Loader2 size={15} className="animate-spin text-slate-400" />}
        <button type="button" onClick={onClose} disabled={busy}
          className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50">Cancel</button>
        <button type="button" onClick={() => void save()} disabled={busy}
          className="text-sm font-medium px-3.5 py-2 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500 disabled:opacity-50">
          Save
        </button>
      </div>
    </Modal>
  )
}
