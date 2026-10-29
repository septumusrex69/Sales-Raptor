import { useEffect, useState } from 'react'
import { CheckCircle2, Download, FileUp, Loader2, Paperclip, UserPlus } from 'lucide-react'
import { HANDOVER_COLUMNS } from '../../lib/handoverSheet'
import { handoverSheetBytes, handoverSheetFilename, XLSX_MIME } from '../../lib/handoverTemplate'
import { downloadBytes } from '../../lib/xlsxWrite'
import {
  PORTAL_HANDOVER_MAX_BYTES, PORTAL_HANDOVER_SHEETS, type PortalHandover, type PortalSingleField,
} from '../../lib/clientPortal'
import {
  PortalSignedOut, fetchPortalHandovers, fileBase64, sendPortalHandoverSheet, sendPortalHandoverSingle,
} from '../../lib/portalApi'
import { PortalHeading, PortalLabel } from './portalStyle'

/**
 * HAND ACCOUNTS OVER (S15, Raptor · Handover 14 -- the portal's phase 2b). Stephan: "go ahead with handover
 * accounts". Two ways, as the firm takes them by email today: THE SHEET (ours, downloadable here, or the
 * client's own old one, with the PDFs beside it), or ONE ACCOUNT typed into a short form. Either waits for
 * the firm, who loads it through the same import as every other batch -- so the client is told it was
 * RECEIVED, and later LOADED or DECLINED with the reason, and nothing is promised before a person has looked.
 */
const day = (iso: string) => new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
const STATUS: Record<PortalHandover['status'], { label: string; tint: string }> = {
  received: { label: 'Received — waiting for us', tint: 'bg-[#C69F54]/15 text-[#7a5d23]' },
  loaded: { label: 'Loaded', tint: 'bg-emerald-50 text-emerald-700' },
  declined: { label: 'Declined', tint: 'bg-red-50 text-red-700' },
}

export function PortalHandovers({ token, onSignedOut }: { token: string; onSignedOut: () => void }) {
  const [list, setList] = useState<PortalHandover[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [sent, setSent] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetchPortalHandovers(token)
      .then((r) => { if (live) setList(r.handovers) })
      .catch((e) => { if (!live) return; if (e instanceof PortalSignedOut) onSignedOut(); else setError(e.message) })
    return () => { live = false }
  }, [token, onSignedOut, reload])

  const done = (what: string) => { setSent(what); setReload((n) => n + 1) }
  const failed = (e: unknown) => { if (e instanceof PortalSignedOut) onSignedOut(); else throw e }

  return (
    <div className="space-y-6" data-testid="portal-handovers">
      {sent && <p className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-2.5 text-sm text-emerald-800" data-testid="portal-handover-sent">{sent}</p>}
      <div className="grid xl:grid-cols-2 gap-6">
        <SheetCard token={token} onSent={() => done('Your sheet is with us. We check it and load it, and it shows here when it is done.')} onError={failed} />
        <SingleCard token={token} onSent={() => done('The account is with us. We check it and load it, and it shows here when it is done.')} onError={failed} />
      </div>

      <section className="rounded-2xl bg-white border border-[#D5DBE3] overflow-hidden">
        <div className="p-5"><PortalHeading title="What you have handed over" subtitle="Newest first. Each one is checked by a person before it is loaded." /></div>
        {error ? <p className="px-5 pb-5 text-sm text-red-700">{error}</p>
          : !list ? <p className="px-5 pb-5 text-sm text-[#5A6B80]">Reading…</p>
            : list.length === 0 ? <p className="px-5 pb-5 text-sm text-[#5A6B80]" data-testid="portal-no-handovers">Nothing handed over here yet.</p>
              : (
                <ul data-testid="portal-handover-list">
                  {list.map((h, i) => (
                    <li key={h.id} className={`px-5 py-3 flex flex-wrap items-center justify-between gap-3 ${i % 2 ? '' : 'bg-[#F2F5F8]'}`} data-testid="portal-handover">
                      <div className="min-w-0">
                        <p className="text-[#111E2D] font-medium truncate">{h.kind === 'single' ? `One account · ${h.fileName.replace(/\.csv$/i, '')}` : h.fileName}</p>
                        <p className="text-xs text-[#5A6B80]">
                          Sent {day(h.createdAt)} by {h.submittedBy}
                          {h.accounts !== null && h.kind === 'sheet' ? ` · about ${h.accounts} account${h.accounts === 1 ? '' : 's'}` : ''}
                          {h.pdfs ? ` · ${h.pdfs} PDF${h.pdfs === 1 ? '' : 's'}` : ''}
                        </p>
                        {h.status === 'declined' && h.declineReason && (
                          <p className="text-xs text-red-700 mt-0.5">Why: {h.declineReason}</p>
                        )}
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS[h.status].tint}`}>
                        {STATUS[h.status].label}{h.decidedAt && h.status !== 'received' ? ` · ${day(h.decidedAt)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
      </section>
    </div>
  )
}

function SheetCard({ token, onSent, onError }: { token: string; onSent: () => void; onError: (e: unknown) => void }) {
  const [sheet, setSheet] = useState<File | null>(null)
  const [pdfs, setPdfs] = useState<File[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const size = (sheet?.size ?? 0) + pdfs.reduce((n, f) => n + f.size, 0)
  const tooBig = size > PORTAL_HANDOVER_MAX_BYTES

  async function send() {
    if (!sheet) return
    setBusy(true); setError(null)
    try {
      await sendPortalHandoverSheet(token, {
        fileName: sheet.name, content: await fileBase64(sheet), note,
        pdfs: await Promise.all(pdfs.map(async (f) => ({ name: f.name, content: await fileBase64(f) }))),
      })
      setSheet(null); setPdfs([]); setNote('')
      onSent()
    } catch (e) {
      try { onError(e) } catch (x) { setError(x instanceof Error ? x.message : String(x)) }
    } finally { setBusy(false) }
  }

  return (
    <section className="rounded-2xl bg-white border border-[#D5DBE3] p-5 space-y-4" data-testid="portal-handover-sheet">
      <PortalHeading title="Send a sheet" subtitle="Many accounts at once. Our sheet keeps leading zeros; your old one works too." />
      <button type="button" data-testid="portal-template"
        onClick={async () => downloadBytes(handoverSheetFilename('new'), await handoverSheetBytes('new'), XLSX_MIME)}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#3F5F86] hover:underline">
        <Download size={15} /> Download our handover sheet
      </button>
      <label className="flex items-center gap-3 p-3 rounded-xl border border-[#D5DBE3] cursor-pointer hover:border-[#C69F54]">
        <input type="file" accept={PORTAL_HANDOVER_SHEETS.join(',')} className="sr-only" data-testid="portal-sheet-file"
          onChange={(e) => setSheet(e.target.files?.[0] ?? null)} />
        <span className={`w-9 h-9 rounded-lg grid place-items-center ${sheet ? 'bg-emerald-50 text-emerald-600' : 'bg-[#EEF2F6] text-[#5A6B80]'}`}>
          {sheet ? <CheckCircle2 size={17} /> : <FileUp size={17} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-[#111E2D]">The sheet</span>
          <span className="block text-xs text-[#5A6B80] truncate">{sheet ? sheet.name : 'Excel (.xlsx) or CSV'}</span>
        </span>
      </label>
      <label className="flex items-center gap-3 p-3 rounded-xl border border-[#D5DBE3] cursor-pointer hover:border-[#C69F54]">
        <input type="file" accept=".pdf" multiple className="sr-only" data-testid="portal-sheet-pdfs"
          onChange={(e) => setPdfs([...(e.target.files ?? [])])} />
        <span className="w-9 h-9 rounded-lg grid place-items-center bg-[#EEF2F6] text-[#5A6B80]"><Paperclip size={17} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-[#111E2D]">The PDFs, if you have them</span>
          <span className="block text-xs text-[#5A6B80] truncate">{pdfs.length ? `${pdfs.length} files` : 'Statements, agreements — named with your reference.'}</span>
        </span>
      </label>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000}
        placeholder="Anything we should know about this batch (optional)"
        className="w-full rounded-lg border border-[#D5DBE3] px-3 py-2 text-sm" />
      {tooBig && <p className="text-sm text-red-700">That is too large to send here. Send the sheet on its own, or email the documents to your liaison.</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button type="button" onClick={() => void send()} disabled={!sheet || busy || tooBig} data-testid="portal-sheet-send"
        className="inline-flex items-center gap-2 rounded-lg bg-[#111E2D] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy && <Loader2 size={15} className="animate-spin" />} Send the sheet
      </button>
    </section>
  )
}

/* THE SHORT FORM'S FIELDS, labelled with the sheet's own words so the two never disagree. */
const FORM: { key: PortalSingleField; wide?: boolean; type?: string; placeholder?: string }[] = [
  { key: 'client_reference' }, { key: 'account_number' },
  { key: 'first_name' }, { key: 'name' },
  { key: 'id_number' }, { key: 'registration_number' },
  { key: 'capital', placeholder: '12 500.00' }, { key: 'default_date', type: 'date' },
  { key: 'last_payment_date', type: 'date' }, { key: 'cell_1', type: 'tel' },
  { key: 'email_1', type: 'email' }, { key: 'employer' },
  { key: 'street_1', wide: true }, { key: 'suburb' }, { key: 'city' }, { key: 'street_code' },
  { key: 'notes', wide: true },
]
const REQUIRED = new Set<PortalSingleField>(['client_reference', 'name', 'capital', 'default_date'])
const labelOf = (k: PortalSingleField) => HANDOVER_COLUMNS.find((c) => c.key === k)?.label ?? k

function SingleCard({ token, onSent, onError }: { token: string; onSent: () => void; onError: (e: unknown) => void }) {
  const [v, setV] = useState<Record<string, string>>({ debtor_kind: 'Person' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = [...REQUIRED].every((k) => (v[k] ?? '').trim())

  async function send() {
    setBusy(true); setError(null)
    try {
      /* The date box gives yyyy-mm-dd; the sheet reads day/month/year, which is what a client would type. */
      const out = { ...v }
      for (const k of ['default_date', 'last_payment_date']) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(out[k] ?? '')
        if (m) out[k] = `${m[3]}/${m[2]}/${m[1]}`
      }
      await sendPortalHandoverSingle(token, out)
      setV({ debtor_kind: 'Person' })
      onSent()
    } catch (e) {
      try { onError(e) } catch (x) { setError(x instanceof Error ? x.message : String(x)) }
    } finally { setBusy(false) }
  }

  const business = v.debtor_kind === 'Business'
  return (
    <section className="rounded-2xl bg-white border border-[#D5DBE3] p-5 space-y-4" data-testid="portal-handover-single">
      <PortalHeading title="Hand over one account" subtitle="Type it in. The starred fields are the ones we need." />
      <div className="inline-flex rounded-lg border border-[#D5DBE3] p-0.5" role="radiogroup">
        {(['Person', 'Business'] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={v.debtor_kind === k} onClick={() => setV({ ...v, debtor_kind: k })}
            className={`px-3 py-1 rounded-md text-sm ${v.debtor_kind === k ? 'bg-[#111E2D] text-white' : 'text-[#5A6B80]'}`}>
            {k === 'Person' ? 'A person' : 'A business'}
          </button>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {FORM.filter((f) => !(business && (f.key === 'first_name' || f.key === 'id_number')) && !(!business && f.key === 'registration_number'))
          .map((f) => (
            <label key={f.key} className={`text-sm text-[#1B2B3E] ${f.wide ? 'sm:col-span-2' : ''}`}>
              <PortalLabel>{labelOf(f.key)}{REQUIRED.has(f.key) ? ' *' : ''}</PortalLabel>
              <input type={f.type ?? 'text'} value={v[f.key] ?? ''} placeholder={f.placeholder}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })} data-testid={`portal-single-${f.key}`}
                className="mt-1 w-full rounded-lg border border-[#D5DBE3] px-3 py-2" />
            </label>
          ))}
      </div>
      {error && <p className="text-sm text-red-700" data-testid="portal-single-error">{error}</p>}
      <button type="button" onClick={() => void send()} disabled={!ready || busy} data-testid="portal-single-send"
        className="inline-flex items-center gap-2 rounded-lg bg-[#111E2D] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} Hand it over
      </button>
    </section>
  )
}
