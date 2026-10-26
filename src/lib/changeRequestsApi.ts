import { supabase } from './supabase'
import { clockNow } from './clock'
import {
  base64Bytes, parseReviewGroups,
  type ChangeRequest, type RequestDepartment, type RequestEvent, type RequestFileMeta, type RequestPriority, type RequestReview, type RequestStatus,
} from './changeRequests'

/**
 * THE DATABASE SIDE OF "REQUEST A CHANGE" (S12; the rules are in changeRequests.ts). Files are read
 * in two steps on purpose: the list fetches their names and sizes only, and a picture's base64 is
 * fetched when somebody opens that request -- a list of forty requests must not pull forty
 * screenshots to draw forty titles.
 */

const REQUEST_COLUMNS = 'id, number, description, page_path, page_title, pane, department, status, priority, admin_note, done_in, created_by, created_at, decided_by, decided_at, closed_at, tested_ok, tested_note, tested_at, tested_by, assigned_to, review_title, review_verdict, review_size, review_summary, review_questions, reviewed_at, build_requested_at, build_requested_by'

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

/** The nights' reviews, newest first -- they are kept, not replaced (the firm: "keep a review history"). */
export async function listReviews(): Promise<RequestReview[]> {
  const { data, error } = await supabase.from('change_request_reviews').select('id, created_at, summary, groups, request_ids')
    .order('created_at', { ascending: false }).limit(60)
  if (error) throw new Error(error.message)
  return ((data ?? []) as { id: string; created_at: string; summary: string; groups: unknown; request_ids: string[] | null }[])
    .map((r) => ({ id: r.id, created_at: r.created_at, summary: r.summary, groups: parseReviewGroups(r.groups), request_ids: r.request_ids ?? [] }))
}

/** One request's history, oldest first. */
export async function listEvents(requestId: string): Promise<RequestEvent[]> {
  const { data, error } = await supabase.from('change_request_events').select('id, request_id, kind, body, from_status, to_status, by_id, at')
    .eq('request_id', requestId).order('at')
  if (error) throw new Error(error.message)
  return (data ?? []) as RequestEvent[]
}

/** A comment, or (an Administrator's) question to the person who asked -- they are notified. */
export async function addEvent(requestId: string, kind: 'comment' | 'question', body: string, byId: string): Promise<void> {
  const { error } = await supabase.from('change_request_events').insert({ request_id: requestId, kind, body: body.trim(), by_id: byId })
  if (error) throw new Error(error.message)
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

export async function updateRequest(id: string, patch: Partial<{ status: RequestStatus; priority: RequestPriority; admin_note: string | null; done_in: string | null; assigned_to: string | null }>): Promise<void> {
  const { error } = await supabase.from('change_requests').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function withdrawRequest(id: string): Promise<void> {
  const { error } = await supabase.from('change_requests').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** The asker's answer once it is Done: it works, or it goes back with what is wrong. */
export async function answerTest(number: number, ok: boolean, note: string): Promise<void> {
  const { error } = await supabase.rpc('change_request_tested', { p_number: number, p_ok: ok, p_note: note.trim() || null })
  if (error) throw new Error(error.message)
}

/**
 * "CLAUDE, PLEASE DO THIS" (Raptor H12): put an approved request on the builder's queue, or take it
 * off. The scheduled builder session picks the oldest queued one, builds it, and is the only one that
 * moves it to In development and Released. Said on the request's history in the person's own name.
 */
export async function askClaude(r: Pick<ChangeRequest, 'id'>, me: { id: string } | null, on: boolean): Promise<void> {
  if (!me) throw new Error('Sign in again.')
  const { error } = await supabase.from('change_requests')
    .update(on ? { build_requested_at: clockNow().toISOString(), build_requested_by: me.id } : { build_requested_at: null, build_requested_by: null })
    .eq('id', r.id)
  if (error) throw new Error(error.message)
  await addEvent(r.id, 'comment', on ? 'Asked Claude to build this.' : 'Took it off Claude\u2019s queue.', me.id)
}

