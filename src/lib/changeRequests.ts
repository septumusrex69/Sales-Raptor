import type { User } from '../types.js'

/**
 * "REQUEST A CHANGE" FROM INSIDE RAPTOR (S12, 26 Oct).
 *
 * THE FIRM: "As people are testing the software, I want them to ... queue things for me so that I
 * can code it ... You take a screenshot of what you need and then you put it in Raptor ... and a
 * description of what changes you want. And then it would flag on my side." Then: "Anyone can see
 * requests", and every night a session "can check for new requests ... and then show them to me in
 * the group list."
 *
 * Anybody sends one and sees them all; only an Administrator moves one along -- the database says so
 * (change_requests_update), and this file says the same in the browser. The night's review is a
 * Claude session writing one change_request_reviews row; it groups and asks, it never builds.
 *
 * PURE: no Supabase, no DOM, so check-change-requests can hold it. The browser's shrinking of a
 * picture is in RequestChangeModal; the database calls are in changeRequestsApi.
 */

export type RequestStatus = 'new' | 'accepted' | 'building' | 'done' | 'declined'
export type RequestPriority = 'low' | 'normal' | 'high'

export interface ChangeRequest {
  id: string
  number: number
  description: string
  page_path: string | null
  page_title: string | null
  /** The pane it was sent from (paneOf), stored as it was then. Null on the first few requests. */
  pane: string | null
  /** The department it is for, chosen by the sender. Null on the first few requests. */
  department: RequestDepartment | null
  status: RequestStatus
  priority: RequestPriority
  admin_note: string | null
  done_in: string | null
  created_by: string
  created_at: string
  decided_by: string | null
  decided_at: string | null
  closed_at: string | null
}

export interface RequestFileMeta {
  id: string
  request_id: string
  name: string
  mime: string
  bytes: number
  purged_at: string | null
}

export interface ReviewGroup {
  title: string
  request_numbers: number[]
  what: string
  questions: string[]
  size: 'small' | 'medium' | 'large' | null
}

export interface RequestReview {
  id: string
  created_at: string
  summary: string
  groups: ReviewGroup[]
}

/*
 * WHICH PANE, WHICH DEPARTMENT (the firm, 26 Oct): "it should be clear ... in which pane is it coming
 * from, to which department is it relevant ... is it in collections, is it in sales, is it in comms
 * ... or just an overall function." The pane is read off the address; the department is the
 * sender's choice, suggested from the pane, because a liaison asking about the Accounts screen may
 * be asking for the call centre or for herself. The database holds the same list
 * (change_requests_department_known).
 */
export const REQUEST_DEPARTMENTS = ['Call centre', 'Sales', 'Communications', 'Finance', 'Administration', 'Whole system'] as const
export type RequestDepartment = typeof REQUEST_DEPARTMENTS[number]
export const DEPARTMENT_HINT: Record<RequestDepartment, string> = {
  'Call centre': 'Collections: accounts, the diary, debtors, disputes',
  Sales: 'Leads, deals, contacts, proposals',
  Communications: 'Clients and their liaisons, handover sheets, news',
  Finance: 'Trust, payovers, the business account',
  Administration: 'People, leave, settings, the library',
  'Whole system': 'Something everywhere: menus, mail, search, speed',
}

/** Most specific first: /dashboard/collections must not be read as the Dashboard. */
const PANES: { test: RegExp; pane: string; department: RequestDepartment }[] = [
  { test: /^\/dashboard\/collections/, pane: 'Collections dashboard', department: 'Call centre' },
  { test: /^\/dashboard\/sales/, pane: 'Sales dashboard', department: 'Sales' },
  { test: /^\/accounts/, pane: 'Accounts', department: 'Call centre' },
  { test: /^\/diary/, pane: 'Diary', department: 'Call centre' },
  { test: /^\/performance/, pane: 'Collections', department: 'Call centre' },
  { test: /^\/queries/, pane: 'Disputes', department: 'Call centre' },
  { test: /^\/leads/, pane: 'Leads', department: 'Sales' },
  { test: /^\/deals/, pane: 'Deals', department: 'Sales' },
  { test: /^\/contacts/, pane: 'Contacts', department: 'Sales' },
  { test: /^\/reps/, pane: 'Rep performance', department: 'Sales' },
  { test: /^\/companies/, pane: 'Clients', department: 'Communications' },
  { test: /^\/(news|campaigns)/, pane: 'News & campaigns', department: 'Communications' },
  { test: /^\/trust/, pane: 'Trust', department: 'Finance' },
  { test: /^\/business/, pane: 'Business', department: 'Finance' },
  { test: /^\/people/, pane: 'People', department: 'Administration' },
  { test: /^\/settings/, pane: 'Settings', department: 'Administration' },
  { test: /^\/library/, pane: 'Library', department: 'Administration' },
  { test: /^\/reports/, pane: 'Reports', department: 'Whole system' },
  { test: /^\/mail/, pane: 'Mail', department: 'Whole system' },
  { test: /^\/(tasks|calendar|activities)/, pane: 'Tasks & calendar', department: 'Whole system' },
  { test: /^\/requests/, pane: 'Requests', department: 'Whole system' },
  { test: /^\/$/, pane: 'Dashboard', department: 'Whole system' },
]

/** The pane an address belongs to, and the department it suggests. Unknown pages: the whole system. */
export function paneOf(path: string | null | undefined): { pane: string; department: RequestDepartment } {
  const p = (path ?? '').split(/[?#]/)[0] || '/'
  const hit = PANES.find((x) => x.test.test(p))
  return hit ? { pane: hit.pane, department: hit.department } : { pane: 'Other', department: 'Whole system' }
}

/** In the order a request travels, and the words the screen uses. */
export const STATUSES: RequestStatus[] = ['new', 'accepted', 'building', 'done', 'declined']
export const STATUS_LABEL: Record<RequestStatus, string> = {
  new: 'New', accepted: 'Accepted', building: 'Being built', done: 'Done', declined: 'Declined',
}
export const PRIORITY_LABEL: Record<RequestPriority, string> = { low: 'Low', normal: 'Normal', high: 'High' }

/** Open is everything still to be decided or built; the list opens on it. */
export function isOpen(s: RequestStatus): boolean {
  return s === 'new' || s === 'accepted' || s === 'building'
}

/** The firm decides what gets built: the role, as the database's policy writes it. */
export function mayDecide(user: Pick<User, 'role'> | null | undefined): boolean {
  return user?.role === 'Administrator'
}

/** The person who sent it may take it back while nobody has looked at it. */
export function mayWithdraw(user: Pick<User, 'id'> | null | undefined, r: Pick<ChangeRequest, 'created_by' | 'status'>): boolean {
  return !!user && r.created_by === user.id && r.status === 'new'
}

/** "R-12": what people say out loud, and what the night's review groups by. */
export function requestLabel(r: Pick<ChangeRequest, 'number'>): string {
  return `R-${r.number}`
}

/*
 * WHAT MAY BE ATTACHED, AND HOW BIG. A screenshot is shrunk in the browser to at most
 * PICTURE_MAX_SIDE on its longer side before it leaves (a phone photo's size), so these limits are
 * for what arrives AFTER that. The database holds the same numbers (change_request_files): a file
 * is a column there so a Claude session can read it, and Supabase ran out of room once already.
 */
export const PICTURE_MAX_SIDE = 1600
export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const MAX_FILES = 5
export const ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const

/** Why a file may not go, or null. Said before anything is sent. */
export function fileProblem(f: { name: string; type: string; size: number }): string | null {
  const isImage = f.type.startsWith('image/')
  if (!isImage && f.type !== 'application/pdf') return `${f.name} is not a picture or a PDF.`
  /* A picture is shrunk before it is measured, so only a PDF can be refused for size here. */
  if (!isImage && f.size > MAX_FILE_BYTES) return `${f.name} is ${(f.size / 1048576).toFixed(1)} MB; a PDF may be 5 MB at most.`
  return null
}

/** The size a picture is drawn at to fit PICTURE_MAX_SIDE, never enlarged. */
export function fitWithin(width: number, height: number, max = PICTURE_MAX_SIDE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** Base64 length -> bytes, for the row's `bytes`. */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad)
}

/**
 * THE NIGHT'S GROUPS, READ DEFENSIVELY. A session writes them as JSON through SQL; a missing field
 * or a number written as a string must not take the screen down, and a group with no title is not
 * a group. Anything unreadable is dropped rather than drawn half.
 */
export function parseReviewGroups(raw: unknown): ReviewGroup[] {
  if (!Array.isArray(raw)) return []
  const out: ReviewGroup[] = []
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue
    const o = g as Record<string, unknown>
    const title = typeof o.title === 'string' ? o.title.trim() : ''
    if (!title) continue
    const numbers = Array.isArray(o.request_numbers)
      ? o.request_numbers.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
      : []
    const size = o.size === 'small' || o.size === 'medium' || o.size === 'large' ? o.size : null
    out.push({
      title,
      request_numbers: [...new Set(numbers)],
      what: typeof o.what === 'string' ? o.what.trim() : '',
      questions: Array.isArray(o.questions) ? o.questions.filter((q): q is string => typeof q === 'string' && !!q.trim()).map((q) => q.trim()) : [],
      size,
    })
  }
  return out
}

/** Newest first, and within a day the high ones on top -- the order the list is read in. */
export function sortRequests<R extends Pick<ChangeRequest, 'created_at' | 'priority' | 'number'>>(rows: R[]): R[] {
  const weight: Record<RequestPriority, number> = { high: 0, normal: 1, low: 2 }
  return [...rows].sort((a, b) =>
    weight[a.priority] - weight[b.priority] || b.created_at.localeCompare(a.created_at) || b.number - a.number)
}
