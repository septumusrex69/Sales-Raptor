/**
 * The parts of an account a person writes.
 *
 * accountBook.ts is the record of what the debt IS, and it is read-only: the ledgers are the
 * collections engine's to write. This is the record of what people DO about it — who they
 * reached, what was said, what was promised — and all of it is written by hand, by a collector,
 * during a call.
 *
 * Nothing here can change what is owed. That separation is the point: a collector can be wrong
 * about a phone number without being wrong about a balance.
 */
import { supabase } from './supabase'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come back as untyped JSON from PostgREST. */

export type ContactKind = 'mobile' | 'phone' | 'work' | 'email' | 'address' | 'employer' | 'other'

export const CONTACT_KINDS: { kind: ContactKind; label: string }[] = [
  { kind: 'mobile', label: 'Mobile' },
  { kind: 'phone', label: 'Home phone' },
  { kind: 'work', label: 'Work phone' },
  { kind: 'email', label: 'Email' },
  { kind: 'address', label: 'Address' },
  { kind: 'employer', label: 'Employer' },
  { kind: 'other', label: 'Other' },
]

export interface AccountContact {
  id: string
  accountId: string
  kind: ContactKind
  value: string
  label: string | null
  isPrimary: boolean
  verifiedAt: string | null
  retiredAt: string | null
  retiredReason: string | null
  notes: string | null
  createdAt: string
}

const toContact = (r: any): AccountContact => ({
  id: r.id,
  accountId: r.account_id,
  kind: r.kind,
  value: r.value,
  label: r.label,
  isPrimary: !!r.is_primary,
  verifiedAt: r.verified_at,
  retiredAt: r.retired_at,
  retiredReason: r.retired_reason,
  notes: r.notes,
  createdAt: r.created_at,
})

export interface AccountNote {
  id: string
  accountId: string
  body: string
  pinned: boolean
  authorName: string | null
  createdBy: string | null
  createdAt: string
}

const toNote = (r: any): AccountNote => ({
  id: r.id,
  accountId: r.account_id,
  body: r.body,
  pinned: !!r.pinned,
  authorName: r.author_name,
  createdBy: r.created_by,
  createdAt: r.created_at,
})

export type PromiseStatus = 'open' | 'kept' | 'broken' | 'cancelled'

export interface PromiseToPay {
  id: string
  accountId: string
  amount: number
  dueOn: string
  method: string | null
  status: PromiseStatus
  resolvedAt: string | null
  notes: string | null
  createdBy: string | null
  createdAt: string
}

const toPromise = (r: any): PromiseToPay => ({
  id: r.id,
  accountId: r.account_id,
  amount: Number(r.amount),
  dueOn: r.due_on,
  method: r.method,
  status: r.status,
  resolvedAt: r.resolved_at,
  notes: r.notes,
  createdBy: r.created_by,
  createdAt: r.created_at,
})

/**
 * An open promise whose date has passed.
 *
 * Not a status of its own, deliberately: overdue is a fact about today, and storing it would mean
 * a row whose truth depends on when it was last written. `status` records what a person decided;
 * this computes what the calendar says.
 */
export function isOverdue(p: PromiseToPay, today = new Date().toISOString().slice(0, 10)): boolean {
  return p.status === 'open' && p.dueOn < today
}

/** The one a collector is being judged on: the open promise falling due soonest. */
export function nextPromise(promises: PromiseToPay[]): PromiseToPay | undefined {
  return promises.filter((p) => p.status === 'open').sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0]
}

export interface Workspace {
  contacts: AccountContact[]
  notes: AccountNote[]
  promises: PromiseToPay[]
}

export async function fetchWorkspace(accountId: string): Promise<Workspace> {
  const [contacts, notes, promises] = await Promise.all([
    supabase.from('account_contacts').select('*').eq('account_id', accountId).order('is_primary', { ascending: false }),
    supabase.from('account_notes').select('*').eq('account_id', accountId).order('created_at', { ascending: false }),
    supabase.from('promises_to_pay').select('*').eq('account_id', accountId).order('due_on', { ascending: false }),
  ])
  for (const r of [contacts, notes, promises]) if (r.error) throw new Error(r.error.message)
  return {
    contacts: (contacts.data ?? []).map(toContact),
    notes: (notes.data ?? []).map(toNote),
    promises: (promises.data ?? []).map(toPromise),
  }
}

export async function addContact(input: {
  accountId: string
  kind: ContactKind
  value: string
  label?: string | null
  isPrimary?: boolean
}): Promise<AccountContact> {
  const { data, error } = await supabase
    .from('account_contacts')
    .insert({
      account_id: input.accountId,
      kind: input.kind,
      value: input.value.trim(),
      label: input.label?.trim() || null,
      is_primary: input.isPrimary ?? false,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return toContact(data)
}

/** Confirming a number reaches the debtor. Recorded with who and when, since it decays. */
export async function verifyContact(id: string, verifiedBy: string | null): Promise<AccountContact> {
  const { data, error } = await supabase
    .from('account_contacts')
    .update({ verified_at: new Date().toISOString(), verified_by: verifiedBy })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return toContact(data)
}

/**
 * A dead number is retired, never deleted — otherwise the next collector traces it again and
 * spends the same afternoon discovering the same disconnected line.
 */
export async function retireContact(id: string, reason: string): Promise<AccountContact> {
  const { data, error } = await supabase
    .from('account_contacts')
    .update({ retired_at: new Date().toISOString(), retired_reason: reason || null, is_primary: false })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return toContact(data)
}

export async function addNote(input: {
  accountId: string
  body: string
  authorName?: string | null
  createdBy?: string | null
}): Promise<AccountNote> {
  const { data, error } = await supabase
    .from('account_notes')
    .insert({
      account_id: input.accountId,
      body: input.body.trim(),
      author_name: input.authorName ?? null,
      created_by: input.createdBy ?? null,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return toNote(data)
}

export async function addPromise(input: {
  accountId: string
  amount: number
  dueOn: string
  method?: string | null
  notes?: string | null
  createdBy?: string | null
}): Promise<PromiseToPay> {
  const { data, error } = await supabase
    .from('promises_to_pay')
    .insert({
      account_id: input.accountId,
      amount: input.amount,
      due_on: input.dueOn,
      method: input.method?.trim() || null,
      notes: input.notes?.trim() || null,
      created_by: input.createdBy ?? null,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return toPromise(data)
}

/**
 * Closing a promise.
 *
 * A person does this, not a rule. Matching a promise against an incoming payment is the
 * collections engine's job and it does not exist yet — and a promise quietly marked kept by
 * logic nobody can see is worse than one somebody closed by hand.
 */
export async function resolvePromise(
  id: string,
  status: Exclude<PromiseStatus, 'open'>,
  resolvedBy: string | null,
): Promise<PromiseToPay> {
  const { data, error } = await supabase
    .from('promises_to_pay')
    .update({ status, resolved_at: new Date().toISOString(), resolved_by: resolvedBy })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return toPromise(data)
}

/* ---------- Documents ---------- */

export interface AccountDocument {
  id: string
  accountId: string
  name: string
  storagePath: string
  mimeType: string | null
  sizeBytes: number | null
  kind: string | null
  uploadedByName: string | null
  createdAt: string
}

const toDocument = (r: any): AccountDocument => ({
  id: r.id,
  accountId: r.account_id,
  name: r.name,
  storagePath: r.storage_path,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
  kind: r.kind,
  uploadedByName: r.uploaded_by_name,
  createdAt: r.created_at,
})

/** What kind of paper it is. A short list, because a long one gets ignored. */
export const DOCUMENT_KINDS = [
  'Mandate', 'Acknowledgement of Debt', 'Letter of Demand', 'Statement',
  'Proof of payment', 'Identity document', 'Court document', 'Correspondence', 'Other',
] as const

const BUCKET = 'account-documents'

export async function fetchDocuments(accountId: string): Promise<AccountDocument[]> {
  const { data, error } = await supabase
    .from('account_documents')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(toDocument)
}

/**
 * Upload, then record.
 *
 * In that order on purpose: a row pointing at a file that failed to upload is a broken link in
 * the list, while a file with no row is invisible clutter in a bucket. The first is the one a
 * person trips over.
 *
 * The stored path is prefixed with the account and a random id, so two people uploading
 * "statement.pdf" on the same account do not collide and neither can overwrite the other.
 */
export async function uploadDocument(input: {
  accountId: string
  file: File
  kind?: string | null
  uploadedBy?: string | null
  uploadedByName?: string | null
}): Promise<AccountDocument> {
  const safe = input.file.name.replace(/[^\w.\-() ]+/g, '_').slice(0, 120)
  const path = `${input.accountId}/${crypto.randomUUID()}-${safe}`

  const up = await supabase.storage.from(BUCKET).upload(path, input.file, {
    contentType: input.file.type || 'application/octet-stream',
    upsert: false,
  })
  if (up.error) throw new Error(up.error.message)

  const { data, error } = await supabase
    .from('account_documents')
    .insert({
      account_id: input.accountId,
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
  return toDocument(data)
}

/**
 * A short-lived URL to open one.
 *
 * The bucket is private, so there is no permanent address to link to. Sixty seconds is enough to
 * open a PDF and not enough for the URL to be worth passing on.
 */
export async function documentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60)
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Could not open that document.')
  return data.signedUrl
}

/** Managers only, enforced by RLS as well as here. Removes the file and then the row. */
export async function deleteDocument(doc: AccountDocument): Promise<void> {
  const rm = await supabase.storage.from(BUCKET).remove([doc.storagePath])
  if (rm.error) throw new Error(rm.error.message)
  const { error } = await supabase.from('account_documents').delete().eq('id', doc.id)
  if (error) throw new Error(error.message)
}

/* ---------- The account's own editable fields ---------- */

/**
 * The main comment: the current state of play, in a sentence or two.
 *
 * Rewritten rather than appended to, which is what separates it from a note. A note is dated
 * evidence of what was said on a day; this is what someone picking the account up needs to know
 * before they read any of it.
 */
export async function saveMainComment(accountId: string, text: string, byId: string | null): Promise<void> {
  const { error } = await supabase
    .from('debtor_accounts')
    .update({
      main_comment: text.trim() || null,
      main_comment_at: new Date().toISOString(),
      main_comment_by: byId,
    })
    .eq('id', accountId)
  if (error) throw new Error(error.message)
}

export async function saveDebtorPreferences(accountId: string, patch: {
  preferredLanguage?: string | null
  contactPreference?: string | null
  consentStatus?: string | null
}): Promise<void> {
  const row: Record<string, string | null> = {}
  if ('preferredLanguage' in patch) row.preferred_language = patch.preferredLanguage?.trim() || null
  if ('contactPreference' in patch) row.contact_preference = patch.contactPreference?.trim() || null
  if ('consentStatus' in patch) row.consent_status = patch.consentStatus?.trim() || null
  const { error } = await supabase.from('debtor_accounts').update(row).eq('id', accountId)
  if (error) throw new Error(error.message)
}
