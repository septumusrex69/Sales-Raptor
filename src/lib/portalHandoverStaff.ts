/**
 * THE FIRM'S SIDE OF A CLIENT'S PORTAL HANDOVER (S15, phase 2b). What a client sent from the portal waits on
 * the client's page; somebody who may load that client's accounts opens it in the import, or declines it with
 * a reason the client reads. Reads under client_handover_submissions' policy (may_load_accounts); the decision
 * is decide_client_handover, the only writer. See the portal_handovers migration.
 */
import { supabase } from './supabase'

export interface ClientHandoverSubmission {
  id: string
  companyId: string
  kind: 'sheet' | 'single'
  fileName: string
  filePath: string
  pdfPaths: string[]
  pdfNames: string[]
  accounts: number | null
  note: string | null
  status: 'received' | 'loaded' | 'declined'
  submittedBy: string
  createdAt: string
  decidedByName: string | null
  decidedAt: string | null
  declineReason: string | null
  handoverId: string | null
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const toSubmission = (r: any): ClientHandoverSubmission => ({
  id: r.id, companyId: r.company_id, kind: r.kind, fileName: r.file_name, filePath: r.file_path,
  pdfPaths: r.pdf_paths ?? [], pdfNames: r.pdf_names ?? [], accounts: r.accounts, note: r.note, status: r.status,
  submittedBy: r.submitted_by, createdAt: r.created_at, decidedByName: r.decided_by_name, decidedAt: r.decided_at,
  declineReason: r.decline_reason, handoverId: r.handover_id,
})

export async function fetchClientHandovers(companyId: string): Promise<ClientHandoverSubmission[]> {
  const { data, error } = await supabase.from('client_handover_submissions')
    .select('id, company_id, kind, file_name, file_path, pdf_paths, pdf_names, accounts, note, status, submitted_by, created_at, decided_by_name, decided_at, decline_reason, handover_id')
    .eq('company_id', companyId).order('created_at', { ascending: false }).limit(50)
  if (error) throw new Error(error.message)
  return (data ?? []).map(toSubmission)
}

export async function fetchClientHandover(id: string): Promise<ClientHandoverSubmission | null> {
  const { data, error } = await supabase.from('client_handover_submissions')
    .select('id, company_id, kind, file_name, file_path, pdf_paths, pdf_names, accounts, note, status, submitted_by, created_at, decided_by_name, decided_at, decline_reason, handover_id')
    .eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toSubmission(data) : null
}

/** The files exactly as the client sent them, as Files the import's own inputs would have given it. */
export async function clientHandoverFiles(s: ClientHandoverSubmission): Promise<{ sheet: File; pdfs: File[] }> {
  const store = supabase.storage.from('portal-handovers')
  const get = async (path: string, name: string) => {
    const { data, error } = await store.download(path)
    if (error || !data) throw new Error(`${name} could not be fetched: ${error?.message ?? 'not found'}`)
    return new File([data], name, { type: data.type })
  }
  const sheet = await get(s.filePath, s.fileName)
  const pdfs = await Promise.all(s.pdfPaths.map((p, i) => get(p, s.pdfNames[i] ?? p.split('/').pop() ?? 'document.pdf')))
  return { sheet, pdfs }
}

export async function decideClientHandover(id: string, status: 'loaded' | 'declined', opts: { handoverId?: string | null; reason?: string | null } = {}): Promise<void> {
  const { error } = await supabase.rpc('decide_client_handover', {
    p_submission: id, p_status: status, p_handover: opts.handoverId ?? null, p_reason: opts.reason ?? null,
  })
  if (error) throw new Error(error.message)
}
