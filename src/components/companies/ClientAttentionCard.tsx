import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2, Upload } from 'lucide-react'
import { Card } from '../ui/Card'
import { MANDATE_KIND, fetchClientDocuments, uploadClientDocument } from '../../lib/clientDocuments'
import { fetchQueriesForClient } from '../../lib/accountQueries'
import { clientSection } from '../../lib/disputeCategories'
import { fromSwordfish } from '../../lib/mandateRule'
import { ruleKind } from '../../lib/commissionRule'
import { formatDate } from '../../data/mockData'
import type { Company } from '../../types'

/**
 * WHAT NEEDS DOING ON THIS CLIENT, IN ONE CARD (S9, 19 Oct, after the firm's mock).
 *
 * THE FIRM, of the mandate: "it's important, but once the client is signed, you're not going to look
 * at the mandate every day. So now it's got a very high ranking up on this page." Right: the mandate
 * matters on the day something is MISSING from it, and not otherwise. So the gaps that used to be
 * amber lines inside separate cards -- the signed mandate not filed, no rate to bill on, a query
 * waiting on the client -- are gathered here, high on the page, and the cards they came from move
 * down to where reference material lives.
 *
 * ONLY WHAT IS WRONG. A warning that fires when nothing is wrong is worse than no warning, so an
 * empty list says so in one green line and nothing else.
 */
export function ClientAttentionCard({ company, canEdit, userId, userName, unallocated, onHandOut, onFiled }: {
  company: Company
  /** May file the mandate: the same rule as the mandate card (canEditOwned). */
  canEdit: boolean
  userId: string | null
  userName: string | null
  /** An account opened by hand and on nobody's desk -- the page's own note, when it has one. */
  unallocated?: string | null
  onHandOut?: () => void
  /** A mandate was filed from here, so the mandate card below can read its list again. */
  onFiled?: () => void
}) {
  const [hasMandateDoc, setHasMandateDoc] = useState<boolean | null>(null)
  const [waiting, setWaiting] = useState<{ queries: number; disputes: number } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    fetchClientDocuments(company.id)
      .then((docs) => { if (live) setHasMandateDoc(docs.some((d) => d.kind === MANDATE_KIND)) })
      .catch(() => { if (live) setHasMandateDoc(null) })
    /* THE SAME FILTER AS THE QUERIES AND DISPUTES SECTIONS: escalated to the liaison or the client,
       and still open. A dispute still inside collections is not the client's to hear about yet. */
    fetchQueriesForClient(company.parentCompanyId ?? company.id)
      .then((rows) => {
        if (!live) return
        const open = rows.filter((q) => (q.stage === 'liaison' || q.stage === 'client') && q.status === 'open')
        setWaiting({
          queries: open.filter((q) => clientSection(q.kind) === 'query').length,
          disputes: open.filter((q) => clientSection(q.kind) === 'dispute').length,
        })
      })
      .catch(() => { if (live) setWaiting(null) })
    return () => { live = false }
  }, [company.id, company.parentCompanyId])

  async function fileMandate(picked: FileList | null) {
    const f = picked?.[0]
    if (!f) return
    setUploading(true); setError(null)
    try {
      await uploadClientDocument({ companyId: company.id, file: f, kind: MANDATE_KIND, uploadedBy: userId, uploadedByName: userName })
      setHasMandateDoc(true)
      onFiled?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (file.current) file.current.value = ''
    }
  }

  type Item = { key: string; tone: 'red' | 'amber'; title: string; detail: string; action?: React.ReactNode }
  const items: Item[] = []
  const signed = company.mandateSignedAt
  if (!signed && !fromSwordfish(company)) {
    items.push({ key: 'no-mandate', tone: 'red', title: 'No mandate on record',
      detail: 'No handover can be imported for this client until the date it was signed is recorded.' })
  } else if (signed && hasMandateDoc === false) {
    items.push({
      key: 'mandate-not-filed', tone: 'amber', title: 'Signed mandate not uploaded',
      detail: `Mandate date recorded: ${formatDate(signed)}. The signed document is not on file.`,
      action: canEdit ? (
        <>
          <input ref={file} type="file" className="hidden" onChange={(e) => void fileMandate(e.target.files)} />
          <button type="button" onClick={() => file.current?.click()} disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-navy-950 disabled:opacity-50">
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Upload mandate
          </button>
        </>
      ) : undefined,
    })
  }
  const kind = ruleKind(company)
  if (kind === 'none') {
    items.push({ key: 'no-rate', tone: 'red', title: 'No commission rate',
      detail: 'An account opened for this client inherits no rate, so it would be invoiced at whatever is typed on the day.' })
  } else if (kind === 'scale_without_bands') {
    items.push({ key: 'no-bands', tone: 'amber', title: 'Commission scale boundaries not captured',
      detail: 'A new handover cannot be priced until the rand amount where each tier ends is entered from the mandate.' })
  }
  if (unallocated) {
    items.push({ key: 'unallocated', tone: 'amber', title: 'An account is on nobody’s desk',
      detail: 'It is open, but in nobody’s diary. An active account needs a clerk and a date.',
      action: onHandOut ? (
        <button type="button" onClick={onHandOut}
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700">Assign and refer</button>
      ) : undefined })
  }
  if (waiting && waiting.queries > 0) {
    items.push({ key: 'queries', tone: 'amber', title: `${waiting.queries} ${waiting.queries === 1 ? 'query' : 'queries'} open with this client`,
      detail: 'Listed under Queries on this page.' })
  }
  if (company.liaisonNeeded) {
    items.push({ key: 'liaison', tone: 'amber', title: 'Waiting for a liaison',
      detail: company.importBatchId
        ? 'From Swordfish with nobody on staff named as their liaison. Assign one under Assign a liaison.'
        : 'Signed online; Sales has not handed this client to a liaison yet.' })
  }

  return (
    <Card>
      <div data-testid="client-attention">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-2 font-semibold text-[15px] text-slate-800">
            <AlertTriangle size={16} className={items.length ? 'text-amber-500' : 'text-slate-300'} /> Attention required
          </h3>
          {items.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
              {items.length} {items.length === 1 ? 'issue' : 'issues'}
            </span>
          )}
        </div>
        {items.length === 0 ? (
          <p className="inline-flex items-center gap-2 text-sm text-slate-600" data-testid="client-attention-none">
            <CheckCircle2 size={16} className="text-emerald-600" /> Nothing needs attention on this client.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {items.map((it) => (
              <li key={it.key} data-testid={`client-attention-${it.key}`}
                className={`rounded-lg border p-3 ${it.tone === 'red' ? 'border-negative-100 bg-negative-50/60' : 'border-amber-100 bg-amber-50/60'}`}>
                <p className={`text-sm font-semibold ${it.tone === 'red' ? 'text-negative-700' : 'text-slate-800'}`}>{it.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-slate-600">{it.detail}</p>
                {it.action && <div className="mt-2">{it.action}</div>}
              </li>
            ))}
          </ul>
        )}
        {error && <p className="mt-2 text-xs text-negative-700">{error}</p>}
        {/* THE DISPUTES, ALWAYS SAID: "none escalated" is a steady state a liaison is glad to read. */}
        {waiting && (
          <Link to="#client-disputes" onClick={(e) => { e.preventDefault(); document.getElementById('client-disputes')?.scrollIntoView({ behavior: 'smooth' }) }}
            className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 text-sm text-slate-700 hover:text-brand-600">
            {waiting.disputes === 0
              ? <><CheckCircle2 size={16} className="text-emerald-600" /> No disputes escalated</>
              : <><AlertTriangle size={16} className="text-amber-500" /> {waiting.disputes} {waiting.disputes === 1 ? 'dispute' : 'disputes'} escalated</>}
            <ChevronRight size={14} className="ml-auto text-slate-400" />
          </Link>
        )}
      </div>
    </Card>
  )
}
