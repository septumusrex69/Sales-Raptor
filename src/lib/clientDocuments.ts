/**
 * The paperwork a CLIENT signed, starting with the mandate.
 *
 * THE FIRM, stopped on the import screen: "it tells me I can't upload this handover sheet because
 * there's no contract signed. However, there was no option where I can upload a contract... there
 * should be a function inside the client section where it says upload a mandate."
 *
 * They were right twice over. `companies.mandate_signed_at` has gated every handover import since
 * it was written, and the only screen that could ever SET it was the form that creates the client
 * — which deliberately does not insist on it, because a client is usually loaded while the mandate
 * is still in the post. So the ordinary path produced a client nothing could unblock. And the
 * signed mandate itself had nowhere to live at all: the date was on record, the paper was not.
 *
 * WHY THIS IS NOT accountWorkspace.uploadDocument WITH A `companyId` BRANCH, which is the shorter
 * version of the same code. That function raises Annexure B item 3 — perusal of documents, once a
 * day — on the account it is given. CLAUDE.md states the rule as law: fees are charged on ACCOUNTS
 * ONLY, never on leads or deals, and the sales side raises nothing. A client's own mandate is the
 * firm's file, not a debtor's, and a branch inside a function whose whole purpose is to charge is
 * one careless edit away from putting a client's paperwork on a debtor's bill.
 *
 * NOTHING HERE IMPORTS accountCharges, and check-client-mandate asserts that it never does.
 *
 * The bucket is private and separate from `account-documents` for the second half of the same
 * reason: a signed mandate carries the firm's commercial terms with that client, and every
 * collector on the floor can read the account bucket.
 */
import { supabase } from './supabase'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come back as untyped JSON from PostgREST. */

export interface ClientDocument {
  id: string
  companyId: string
  name: string
  storagePath: string
  mimeType: string | null
  sizeBytes: number | null
  kind: string | null
  uploadedByName: string | null
  createdAt: string
}

const toDocument = (r: any): ClientDocument => ({
  id: r.id,
  companyId: r.company_id,
  name: r.name,
  storagePath: r.storage_path,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
  kind: r.kind,
  uploadedByName: r.uploaded_by_name,
  createdAt: r.created_at,
})

/**
 * What a client signs. A short list, because a long one gets ignored.
 *
 * MANDATE IS FIRST AND IS THE ONE WITH A RULE BEHIND IT — it is the authority the firm collects
 * on, and the only kind the handover import cares about. The rest are here so that the other
 * paper a client sends has somewhere to go rather than being filed as a mandate because that was
 * the only option on the list.
 */
export const MANDATE_KIND = 'Mandate'

export const CLIENT_DOCUMENT_KINDS = [
  MANDATE_KIND, 'Service agreement', 'Rate schedule', 'FICA', 'Correspondence', 'Other',
] as const

const BUCKET = 'client-documents'

export async function fetchClientDocuments(companyId: string): Promise<ClientDocument[]> {
  const { data, error } = await supabase
    .from('client_documents')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(toDocument)
}

/**
 * Upload, then record — the same order as an account's documents, for the same reason: a row
 * pointing at a file that failed to upload is a broken link in the list, while a file with no row
 * is invisible clutter in a bucket, and the first is the one a person trips over.
 *
 * The path is prefixed with the client and a random id, so two people uploading "mandate.pdf" on
 * the same client neither collide nor overwrite each other.
 */
export async function uploadClientDocument(input: {
  companyId: string
  file: File
  kind?: string | null
  uploadedBy?: string | null
  uploadedByName?: string | null
}): Promise<ClientDocument> {
  const safe = input.file.name.replace(/[^\w.\-() ]+/g, '_').slice(0, 120)
  const path = `${input.companyId}/${crypto.randomUUID()}-${safe}`

  const up = await supabase.storage.from(BUCKET).upload(path, input.file, {
    contentType: input.file.type || 'application/octet-stream',
    upsert: false,
  })
  if (up.error) throw new Error(up.error.message)

  const { data, error } = await supabase
    .from('client_documents')
    .insert({
      company_id: input.companyId,
      name: input.file.name,
      storage_path: path,
      mime_type: input.file.type || null,
      size_bytes: input.file.size,
      kind: input.kind ?? null,
      uploaded_by: input.uploadedBy ?? null,
      uploaded_by_name: input.uploadedByName ?? null,
    })
    .select('*')
    .single()
  if (error) {
    // The row failed, so the file is an orphan. Remove it rather than leave a private bucket
    // quietly filling with files nothing points at.
    await supabase.storage.from(BUCKET).remove([path])
    throw new Error(error.message)
  }
  /* AND NO FEE. See the note at the top: this is the client's own paper, and the sales side
     raises nothing. There is deliberately no chargePerusal call here to forget to remove. */
  return toDocument(data)
}

/**
 * A short-lived URL to open one.
 *
 * The bucket is private, so there is no permanent address to link to. Sixty seconds is enough to
 * open a PDF and not enough for the URL to be worth passing on.
 */
export async function clientDocumentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60)
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Could not open that document.')
  return data.signedUrl
}

/**
 * Managers only, enforced by RLS as well as here. Removes the file and then the row.
 *
 * NOBODY QUIETLY REMOVES THE MANDATE: it is the authority the firm is collecting on, and the
 * handover it let through is already open.
 */
export async function deleteClientDocument(doc: ClientDocument): Promise<void> {
  const rm = await supabase.storage.from(BUCKET).remove([doc.storagePath])
  if (rm.error) throw new Error(rm.error.message)
  const { error } = await supabase.from('client_documents').delete().eq('id', doc.id)
  if (error) throw new Error(error.message)
}
