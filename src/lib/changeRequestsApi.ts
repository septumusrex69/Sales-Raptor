import { supabase } from './supabase'
import {
  base64Bytes, parseReviewGroups,
  type ChangeRequest, type RequestDepartment, type RequestFileMeta, type RequestPriority, type RequestReview, type RequestStatus,
} from './changeRequests'

/**
 * THE DATABASE SIDE OF "REQUEST A CHANGE" (S12; the rules are in changeRequests.ts). Files are read
 * in two steps on purpose: the list fetches their names and sizes only, and a picture's base64 is
 * fetched when somebody opens that request -- a list of forty requests must not pull forty
 * screenshots to draw forty titles.
 */

const REQUEST_COLUMNS = 'id, number, description, page_path, page_title, pane, department, status, priority, admin_note, done_in, created_by, created_at, decided_by, decided_at, closed_at'

export async function listRequests(): Promise<ChangeRequest[]> {
  const { data, error } = await supabase.from('change_requests').select(REQUEST_COLUMNS).order('created_at', { ascending: false }).limit(500)
  if (error) throw new Error(error.message)
  return (data ?? []) as ChangeRequest[]
}

export async function listFiles(): Promise<RequestFileMeta[]> {
  const { data, error } = await supabase.from('change_request_files').select('id, request_id, name, mime, bytes, purged_at').order('created_at').limit(2000)
  if (error) throw new Error(error.message)
  return (data ?? []) as RequestFileMeta[]
}

/** One file's contents as a data: URL, or null once it was purged. */
export async function fileDataUrl(f: Pick<RequestFileMeta, 'id' | 'mime'>): Promise<string | null> {
  const { data, error } = await supabase.from('change_request_files').select('data').eq('id', f.id).maybeSingle()
  if (error) throw new Error(error.message)
  const b64 = (data as { data: string | null } | null)?.data
  return b64 ? `data:${f.mime};base64,${b64}` : null
}

export async function latestReview(): Promise<RequestReview | null> {
  const { data, error } = await supabase.from('change_request_reviews').select('id, created_at, summary, groups')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as { id: string; created_at: string; summary: string; groups: unknown }
  return { id: r.id, created_at: r.created_at, summary: r.summary, groups: parseReviewGroups(r.groups) }
}

export interface OutgoingFile { name: string; mime: string; base64: string }

/**
 * Send one. The request first, then its files; if a file is refused the request still stands --
 * the words are what matters, and the screen says which picture did not go.
 */
export async function createRequest(input: { description: string; pagePath: string; pageTitle: string; pane: string; department: RequestDepartment; files: OutgoingFile[] }):
Promise<{ number: number; failedFiles: string[] }> {
  const { data, error } = await supabase.from('change_requests')
    .insert({ description: input.description.trim(), page_path: input.pagePath, page_title: input.pageTitle || null, pane: input.pane, department: input.department })
    .select('id, number').single()
  if (error) throw new Error(error.message)
  const row = data as { id: string; number: number }
  const failedFiles: string[] = []
  for (const f of input.files) {
    const { error: fe } = await supabase.from('change_request_files')
      .insert({ request_id: row.id, name: f.name, mime: f.mime, bytes: base64Bytes(f.base64), data: f.base64 })
    if (fe) failedFiles.push(f.name)
  }
  return { number: row.number, failedFiles }
}

export async function updateRequest(id: string, patch: Partial<{ status: RequestStatus; priority: RequestPriority; admin_note: string | null; done_in: string | null }>): Promise<void> {
  const { error } = await supabase.from('change_requests').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function withdrawRequest(id: string): Promise<void> {
  const { error } = await supabase.from('change_requests').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
