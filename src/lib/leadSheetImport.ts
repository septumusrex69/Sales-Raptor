import type {
  Company, Deal, DealStage, ID, Lead, LeadClassification, LeadSource, LeadStatus, ProductService, RejectionReason, User,
} from '../types'
import { DEAL_STAGE_PROBABILITY } from '../types'
import { kindForService } from './dealKind'
import { normaliseLanguage } from './languages'
import { CUSTOM, parseCommission, choiceFromTerms, termsFromChoice, type CommissionChoice } from './commissionPlans'

/**
 * Bringing a spreadsheet of leads into Raptor.
 *
 * Three steps, each one shown before anything is written:
 *
 *   1. Columns. Every column in the sheet is matched to a Raptor field, or sent to the lead's
 *      notes, or ignored. The match is guessed from the heading — the sales team's own leads
 *      sheet is matched completely — and the person importing can change any of it.
 *   2. Values. Each distinct status, source, rep, commission and rejection reason in the sheet is
 *      matched to Raptor's own vocabulary, again guessed and again changeable.
 *   3. The plan: every lead that would be added, and every lead skipped because Raptor already
 *      has it.
 *
 * The rule throughout is that nothing anyone wrote is thrown away. Whatever can be read into a
 * proper field is; whatever can't is kept, word for word, in the lead's notes.
 *
 * Pure: rows in, plan out. Nothing here touches the database (scripts/qa/check-lead-sheet.mjs).
 */

export const DEFAULT_SERVICE: ProductService = 'Debt Collection'

// ─── Reading values ──────────────────────────────────────────────────────────────────────────

const clean = (v: string | undefined): string => (v ?? '').replace(/\s+/g, ' ').trim()
/** "-" is how the sheet says "nothing here" in a few rows. */
const value = (v: string | undefined): string => {
  const s = clean(v)
  return s === '-' || s === '–' ? '' : s
}

/**
 * Every date written anywhere in a cell, in order.
 *
 * Follow-up cells hold several ("2026/10/12,2026/10/20") or a date plus a remark ("2026/10/22
 * (will speak to the bosses today)"), and a few are mistyped: "2026/1102", "2026//10/26". The
 * year has to be plausible and the month and day real, which keeps a phone number from reading
 * as a date. `today` caps it: "2029/10/29" is a slip of the finger, not a future meeting.
 */
export function sheetDates(v: string | undefined, today: string): string[] {
  const out: string[] = []
  const re = /(\d{4})\s*[/-]*\s*(\d{1,2})\s*[/-]*\s*(\d{1,2})(?!\d)/g
  for (const m of (v ?? '').matchAll(re)) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (y < 2015 || mo < 1 || mo > 12 || d < 1 || d > 31) continue
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (iso > today) continue
    out.push(iso)
  }
  return out
}

/** A date as a moment: nine in the morning in Pretoria, so it never slides to the day before. */
const atNine = (iso: string) => `${iso}T09:00:00+02:00`

/**
 * An amount as the sales team wrote it, read as a number.
 *
 * "18 000", "1,016,434.04", "42 186. 60", "1.2 M", "34K-1M", "Less than 50 000". A range takes
 * its lower end: an estimate is a forecast's raw material, and the low end is the one nobody has
 * to walk back. The text as written is kept beside it in the notes whenever it wasn't a plain
 * figure, so the range is never lost.
 */
export function sheetAmount(v: string | undefined): { amount?: number; plain: boolean } {
  const s = value(v).toLowerCase().replace(/^r\s*/, '').replace(/less\s+than|about|approx\.?|\+/g, '').trim()
  if (!s) return { plain: true }
  const parts = s.split(/\s*-\s*/).filter(Boolean)
  const first = parts[0]
  const m = /^([\d][\d\s,.]*)\s*([km])?/.exec(first)
  if (!m) return { plain: false }
  let digits = m[1].replace(/\s/g, '')
  // Commas are thousands separators here; a decimal comma never appears in this sheet.
  digits = digits.replace(/,/g, '')
  const n = Number(digits.replace(/\.$/, ''))
  if (!Number.isFinite(n)) return { plain: false }
  const factor = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1
  const amount = Math.round(n * factor * 100) / 100
  const plain = parts.length === 1 && !m[2] && /^[\d\s,.]+$/.test(s) && !/less/.test(value(v).toLowerCase())
  return { amount, plain }
}

/** "7", "10-15", "30+", "3 000", "2-3". The lower end, for the same reason as amounts. */
export function sheetCount(v: string | undefined): number | undefined {
  const s = value(v)
  const m = /^(\d[\d\s]*)/.exec(s.split('-')[0].trim())
  if (!m) return undefined
  const n = Number(m[1].replace(/\s/g, ''))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Email addresses in a cell, tidied: the sheet has stray "'" and ">" after some of them. */
export function sheetEmails(v: string | undefined): string[] {
  const found = (v ?? '').match(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi) ?? []
  return [...new Set(found.map((e) => e.toLowerCase()))]
}

/**
 * Phone numbers in a cell. Two in one cell is common ("063 990 1441.'083 408 3665"), as are
 * numbers that lost their leading zero when the sheet decided they were numbers (724647691).
 * Anything foreign is kept as written; only South African numbers are reshaped.
 */
export function sheetPhones(v: string | undefined): string[] {
  const out: string[] = []
  for (const chunk of (v ?? '').split(/[^\d+\s()-]+/)) {
    const raw = chunk.trim()
    const digits = raw.replace(/[^\d]/g, '')
    if (digits.length < 9) continue
    if (raw.startsWith('+') && !raw.startsWith('+27')) { out.push(raw.replace(/\s+/g, ' ')); continue }
    let local = digits
    if (local.startsWith('27') && local.length === 11) local = `0${local.slice(2)}`
    if (local.length === 9 && !local.startsWith('0')) local = `0${local}`
    if (local.length === 10 && local.startsWith('0')) out.push(local)
    else out.push(raw.replace(/\s+/g, ' '))
  }
  return [...new Set(out)]
}

/** Cellphones are 06x, 07x and 08x, except 086 and 087, which are fax-to-email and VoIP lines. */
export const isMobile = (phone: string) => /^0[678]/.test(phone) && !/^08[67]/.test(phone)

const SURNAME_PARTICLES = new Set(['van', 'de', 'der', 'den', 'du', 'le', 'la', 'von', 'da', 'di', 'ter', 'te', 'janse', 'jansen'])

/** "Youngman, Stacie" is surname-first; everything else is written first name first. */
export function splitName(v: string | undefined): { firstName: string; lastName: string } {
  const s = value(v).replace(/[.,]+$/, '')
  if (!s) return { firstName: '', lastName: '' }
  const comma = /^([^,]+),\s*(.+)$/.exec(s)
  if (comma) return { firstName: comma[2].trim(), lastName: comma[1].trim() }
  const words = s.split(' ')
  if (words.length === 1) return { firstName: words[0], lastName: '' }
  // Afrikaans and Dutch surnames carry their particle: Michelle *van Wyk*, Quintin *de Beer*.
  let at = words.length - 1
  while (at > 1 && SURNAME_PARTICLES.has(words[at - 1].toLowerCase())) at--
  return { firstName: words.slice(0, at).join(' '), lastName: words.slice(at).join(' ') }
}

/** Where the lead came from. The sheet's own wording goes into `campaign` whenever it says more. */
export function sheetSource(v: string | undefined): { source: LeadSource; campaign?: string } {
  const raw = value(v)
  const s = raw.toLowerCase()
  if (!s) return { source: 'Other' }
  if (s === 'google') return { source: 'Google Ads' }
  if (/^ref+er+al/.test(s)) return { source: 'Referral' }
  if (s.startsWith('email marketing')) return { source: 'Email', campaign: raw }
  if (s.startsWith('cold calling') || s.startsWith('self-generated')) return { source: 'Sales Rep', campaign: raw }
  if (/chat\s*gpt/.test(s)) return { source: 'ChatGPT' }
  if (/^g[ea]r?mini/.test(s)) return { source: 'Gemini' }
  if (s === 'claude') return { source: 'Claude' }
  if (s.includes('linkedin')) return { source: 'LinkedIn' }
  if (s.includes('facebook')) return { source: 'Facebook' }
  if (s.includes('website')) return { source: 'Website' }
  return { source: 'Other', campaign: raw }
}

/** "C", "C ", "A / B" — the first letter that is a grade. */
export function sheetRank(v: string | undefined): LeadClassification | undefined {
  const m = /[ABCD]/.exec(value(v).toUpperCase())
  return m ? (m[0] as LeadClassification) : undefined
}

/** The free-text reason, sorted into Raptor's six. The words themselves become the note. */
export function sheetRejection(v: string | undefined): RejectionReason {
  const s = value(v).toLowerCase()
  if (!s) return 'Other'
  if (/price|commission|expensive|too high|fee/.test(s)) return 'Too expensive'
  if (/rejected by us|declined/.test(s)) return 'We declined them'
  if (/another|someone else|other person|different route|free service|small claims|chose someone/.test(s)) {
    return 'Went with another provider'
  }
  if (/no response|no answer|unreachable/.test(s)) return 'No response'
  if (/changed their mind|no longer|not interested|chose not|not to go|wrote off|undecided|doesn.?t need|not to persue|not persue|not sufficient time/.test(s)) {
    return 'Not interested anymore'
  }
  return 'Other'
}

/**
 * The two Status columns, read together.
 *
 * The first is the sales team's code (Clo, Gla, Rej …); the second is where the conversation
 * got to (Mandate sent, Waiting for info …). The code decides how it ended; the second column
 * decides how far a live one has come. Rej wins over everything — a lead marked rejected whose
 * second column still says "Mandate sent" was sent a mandate and then said no.
 */
export function sheetOutcome(code: string, stage: string, contacted: boolean): {
  status: LeadStatus; dealStage: DealStage; referredOut?: boolean
} {
  const c = code.toLowerCase().trim()
  const s = stage.toLowerCase().trim()
  if (c === 'rej' || (!c && s === 'rejected')) return { status: 'Rejected', dealStage: 'Rejected' }
  if (c === 'clo') return { status: 'Converted', dealStage: 'Won' }
  // Passed on to someone else rather than taken on: it ends here, but not as a loss to anyone.
  if (s === 'referred') return { status: 'Rejected', dealStage: 'Rejected', referredOut: true }
  if (c === 'nc') return { status: 'No Contact Yet', dealStage: 'New Deal' }
  if (s.startsWith('mandate sent')) return { status: 'Hot Lead', dealStage: 'Mandate Sent' }
  if (s.startsWith('quoted')) return { status: 'Hot Lead', dealStage: 'Quotation Sent' }
  if (s.includes('meeting')) return { status: 'Hot Lead', dealStage: 'New Deal' }
  if (contacted || s.includes('info') || c === 'gla') return { status: 'Interested', dealStage: 'New Deal' }
  return { status: 'No Contact Yet', dealStage: 'New Deal' }
}

// ─── Step 1: columns ─────────────────────────────────────────────────────────────────────────

export type FieldKey =
  | 'sheetNumber' | 'clientName' | 'contactName' | 'email' | 'phone' | 'owner' | 'source' | 'status' | 'progress'
  | 'rank' | 'language' | 'handoverAmount' | 'accounts' | 'commission' | 'industry' | 'city' | 'createdDate' | 'contactDates'
  | 'signedDate' | 'rejectedDate' | 'handoverDate' | 'rejectionReason' | 'enquiry'

/** Where a column goes: a field, the lead's notes, or nowhere. */
export type ColumnTarget = FieldKey | 'notes' | 'ignore'

export interface FieldSpec {
  key: FieldKey
  label: string
  /** Several columns may feed it: both phone columns, every follow-up column. */
  multi?: boolean
  hint?: string
}

/** In the order the mapping screen lists them. */
export const FIELDS: FieldSpec[] = [
  { key: 'clientName', label: 'Client / company name' },
  { key: 'contactName', label: 'Contact person' },
  { key: 'email', label: 'Email', multi: true, hint: 'The first address found is the lead’s; the rest go to notes.' },
  { key: 'phone', label: 'Phone / cell', multi: true, hint: 'Cellphones and landlines are sorted into the right slots.' },
  { key: 'owner', label: 'Rep / owner' },
  { key: 'source', label: 'Source' },
  { key: 'status', label: 'Status' },
  { key: 'progress', label: 'Progress (second status)', hint: 'e.g. Mandate sent, Waiting for info.' },
  { key: 'rank', label: 'Classification (A–D)' },
  { key: 'handoverAmount', label: 'Handover amount / value' },
  { key: 'accounts', label: 'Number of accounts' },
  { key: 'commission', label: 'Commission' },
  { key: 'industry', label: 'Industry' },
  { key: 'language', label: 'Preferred language', hint: '"Zulu", "Afr" and the like are read as the language they mean.' },
  { key: 'city', label: 'City / location' },
  { key: 'createdDate', label: 'Date the lead came in' },
  { key: 'contactDates', label: 'Contact / follow-up dates', multi: true, hint: 'The latest date is the lead’s last contact; the text is kept in notes.' },
  { key: 'signedDate', label: 'Date signed' },
  { key: 'rejectedDate', label: 'Date rejected' },
  { key: 'handoverDate', label: 'Handover date' },
  { key: 'rejectionReason', label: 'Rejection reason' },
  { key: 'enquiry', label: 'Enquiry / introductory notes', multi: true },
  { key: 'sheetNumber', label: 'Row number on the sheet' },
]
export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f])) as Record<FieldKey, FieldSpec>

/** Headings that mean each field. Exact match after lower-casing and squashing spaces. */
const HEADINGS: [FieldKey, RegExp][] = [
  ['sheetNumber', /^(#|no\.?|nr\.?|number)?$/],
  ['clientName', /^(client( name)?|company( name)?|business( name)?|organisation|organization)$/],
  ['contactName', /^(contact person|contact name|contact|name|full name)$/],
  ['email', /^(e-?mail( address)?)$/],
  ['phone', /^(cell|cell ?phone|mobile|phone|tel(ephone)?|contact number|cell number|email\/phone|phone\/email)$/],
  ['owner', /^(marketer|rep|sales ?rep|owner|assigned to|agent|consultant)$/],
  ['source', /^(lead )?source$/],
  ['status', /^(lead )?status$/],
  ['progress', /^(stage|progress|sub-?status)$/],
  ['rank', /^(rank|class|classification|grade)$/],
  ['handoverAmount', /^(handover amount|amount|value|estimated value|debt amount)$/],
  ['accounts', /^(no\.? of acc\.?|no\.? of accounts|accounts|number of accounts)$/],
  ['commission', /^(commission( %| rate)?|rate)$/],
  ['industry', /^(industry|sector)$/],
  ['language', /^((preferred )?language|lang\.?)$/],
  ['city', /^(location|city|town|area)$/],
  ['createdDate', /^(lead - start date|start date|date|date received|created|date created)$/],
  ['contactDates', /(follow[ -]?up|first contact|last contact|unsuccessful)/],
  ['signedDate', /^(date signed|signed( date)?)$/],
  ['rejectedDate', /^(date rejected|rejected( date)?)$/],
  ['handoverDate', /^handover date$/],
  ['rejectionReason', /^(rejection reason|reason lost|lost reason|reason)$/],
  ['enquiry', /^(introductory notes|enquiry|inquiry|message|description)$/],
]

export interface Sheet {
  headers: string[]
  /** Data rows only, header and anything above it dropped. `line` is the sheet's own row number. */
  rows: { line: number; cells: string[] }[]
}

/** The header row is the first row with at least three headings Raptor recognises. */
export function readSheet(grid: string[][]): Sheet {
  const score = (r: string[]) => r.filter((c) => {
    const h = normHeader(c)
    return h !== '' && HEADINGS.some(([k, re]) => k !== 'sheetNumber' && re.test(h))
  }).length
  let at = grid.findIndex((r) => score(r) >= 3)
  if (at < 0) at = grid.findIndex((r) => r.some((c) => clean(c)))
  if (at < 0) return { headers: [], rows: [] }
  const width = Math.max(...grid.slice(at).map((r) => r.length))
  const headers = Array.from({ length: width }, (_, i) => clean(grid[at][i]))
  return {
    headers,
    rows: grid.slice(at + 1).map((cells, i) => ({ line: at + i + 2, cells })),
  }
}

const normHeader = (h: string | undefined) => clean(h).toLowerCase()

/**
 * The first guess at where every column goes.
 *
 * A heading used twice takes the next unclaimed field it could mean — which is how the leads
 * sheet's two "Status" columns become Status and then Progress. A column with a heading Raptor
 * doesn't know goes to the notes, so it isn't lost; one with no heading and nothing in it is
 * ignored.
 */
export function guessMapping(sheet: Sheet): ColumnTarget[] {
  const taken = new Set<FieldKey>()
  return sheet.headers.map((raw, i) => {
    const h = normHeader(raw)
    const filled = sheet.rows.some((r) => value(r.cells[i]))
    if (h === 'status' && taken.has('status') && !taken.has('progress')) { taken.add('progress'); return 'progress' }
    for (const [key, re] of HEADINGS) {
      if (!re.test(h)) continue
      if (key === 'sheetNumber' && (i !== 0 || !filled)) continue
      if (!FIELD_BY_KEY[key].multi && taken.has(key)) continue
      taken.add(key)
      return key
    }
    return filled ? 'notes' : 'ignore'
  })
}

/** Single fields claimed by more than one column. The screen asks for one of them to change. */
export function mappingConflicts(mapping: ColumnTarget[]): FieldKey[] {
  const seen = new Map<FieldKey, number>()
  for (const t of mapping) if (t !== 'notes' && t !== 'ignore') seen.set(t, (seen.get(t) ?? 0) + 1)
  return [...seen].filter(([k, n]) => n > 1 && !FIELD_BY_KEY[k].multi).map(([k]) => k)
}

/** One row, read through the mapping. */
interface MappedRow {
  line: number
  one: (key: FieldKey) => string
  all: (key: FieldKey) => { header: string; text: string }[]
  notes: { header: string; text: string }[]
}

function mapRows(sheet: Sheet, mapping: ColumnTarget[]): MappedRow[] {
  return sheet.rows.map(({ line, cells }) => {
    const all = (key: ColumnTarget) => mapping.flatMap((t, i) => (t === key ? [{ header: sheet.headers[i] || `Column ${i + 1}`, text: cells[i] ?? '' }] : []))
    return {
      line,
      all: (key) => all(key).filter((c) => value(c.text)),
      one: (key) => all(key).map((c) => c.text).find((t) => value(t)) ?? '',
      notes: all('notes').filter((c) => value(c.text)),
    }
  })
}

/**
 * Someone: a client, a person, an address or a number. The totals block at the foot of the
 * sheet, and rows with only a rep's name and a date filled in, are neither.
 */
const isSomebody = (r: MappedRow) => ['clientName', 'contactName', 'email', 'phone'].some((k) => r.all(k as FieldKey).length > 0)

// ─── Step 2: values ──────────────────────────────────────────────────────────────────────────

export type OutcomeId = 'auto' | 'none' | 'interested' | 'hot' | 'hot-quote' | 'hot-mandate' | 'signed' | 'rejected'

export const OUTCOMES: { id: OutcomeId; label: string; status?: LeadStatus; stage?: DealStage }[] = [
  { id: 'auto', label: 'Interested once contacted' },
  { id: 'none', label: 'No contact yet', status: 'No Contact Yet', stage: 'New Deal' },
  { id: 'interested', label: 'Interested', status: 'Interested', stage: 'New Deal' },
  { id: 'hot', label: 'Hot lead', status: 'Hot Lead', stage: 'New Deal' },
  { id: 'hot-quote', label: 'Hot lead — quotation sent', status: 'Hot Lead', stage: 'Quotation Sent' },
  { id: 'hot-mandate', label: 'Hot lead — mandate sent', status: 'Hot Lead', stage: 'Mandate Sent' },
  { id: 'signed', label: 'Signed — converted, deal won', status: 'Converted', stage: 'Won' },
  { id: 'rejected', label: 'Rejected', status: 'Rejected', stage: 'Rejected' },
]

export interface ValueMaps {
  /** Keyed "status · progress" as written, e.g. "Gla · Mandate sent". */
  outcome: Record<string, OutcomeId>
  source: Record<string, LeadSource>
  owner: Record<string, ID>
  commission: Record<string, { choice: CommissionChoice; custom: string }>
  rejection: Record<string, RejectionReason>
}

export const outcomeKey = (status: string, progress: string) => `${value(status) || '(blank)'} · ${value(progress) || '(blank)'}`

function outcomeGuess(status: string, progress: string): OutcomeId {
  const code = value(status).toLowerCase()
  const stage = value(progress).toLowerCase()
  // Words a sheet might use in place of the sales team's codes.
  if (/^(won|signed|closed|converted|client)$/.test(code)) return 'signed'
  if (/^(lost|rejected|dead|declined)$/.test(code)) return 'rejected'
  if (/^(new|no contact)$/.test(code)) return 'none'
  const known = ['clo', 'gla', 'rej', 'ns', 'nc', 'ref', 'ped', ''].includes(code)
  if (!known) return stage ? outcomeGuess('', progress) : 'auto'
  const o = sheetOutcome(code, stage, true)
  if (o.status === 'Converted') return 'signed'
  if (o.status === 'Rejected') return 'rejected'
  if (o.status === 'No Contact Yet') return 'none'
  if (o.status === 'Hot Lead') return o.dealStage === 'Mandate Sent' ? 'hot-mandate' : o.dealStage === 'Quotation Sent' ? 'hot-quote' : 'hot'
  // A blank or unknown "good lead" depends on whether anyone has spoken to them yet.
  return code === 'gla' && stage ? 'interested' : 'auto'
}

/** Every distinct value in the mapped columns, with a first guess for each, and how often it occurs. */
export function guessValues(
  sheet: Sheet, mapping: ColumnTarget[], users: Pick<User, 'id' | 'name' | 'status'>[], defaultOwnerId: ID,
): { maps: ValueMaps; counts: Record<keyof ValueMaps, Record<string, number>> } {
  const rows = mapRows(sheet, mapping).filter(isSomebody)
  const maps: ValueMaps = { outcome: {}, source: {}, owner: {}, commission: {}, rejection: {} }
  const counts: Record<keyof ValueMaps, Record<string, number>> = { outcome: {}, source: {}, owner: {}, commission: {}, rejection: {} }
  const tally = (k: keyof ValueMaps, v: string) => { counts[k][v] = (counts[k][v] ?? 0) + 1 }
  const byFirstName = firstNameIndex(users)

  for (const r of rows) {
    const ok = outcomeKey(r.one('status'), r.one('progress'))
    tally('outcome', ok)
    maps.outcome[ok] ??= outcomeGuess(r.one('status'), r.one('progress'))

    const src = value(r.one('source'))
    tally('source', src)
    maps.source[src] ??= sheetSource(src).source

    const rep = value(r.one('owner'))
    tally('owner', rep)
    if (!(rep in maps.owner)) {
      const hits = rep ? byFirstName.get(rep.split(/\s+/)[0].toLowerCase()) ?? [] : []
      maps.owner[rep] = hits.length === 1 ? hits[0].id : defaultOwnerId
    }

    const com = value(r.one('commission'))
    if (com) {
      tally('commission', com)
      if (!(com in maps.commission)) {
        const terms = parseCommission(com)
        maps.commission[com] = terms ? choiceFromTerms(terms) : { choice: '', custom: '' }
      }
    }

    const why = value(r.one('rejectionReason'))
    if (why) {
      tally('rejection', why)
      maps.rejection[why] ??= sheetRejection(why)
    }
  }
  return { maps, counts }
}

/** Keeps what the person already chose; fills in guesses only for values not seen before. */
export function mergeValueMaps(chosen: ValueMaps, guessed: ValueMaps): ValueMaps {
  const merge = <T>(a: Record<string, T>, b: Record<string, T>) => Object.fromEntries(Object.keys(b).map((k) => [k, k in a ? a[k] : b[k]]))
  return {
    outcome: merge(chosen.outcome, guessed.outcome),
    source: merge(chosen.source, guessed.source),
    owner: merge(chosen.owner, guessed.owner),
    commission: merge(chosen.commission, guessed.commission),
    rejection: merge(chosen.rejection, guessed.rejection),
  }
}

function firstNameIndex(users: Pick<User, 'id' | 'name' | 'status'>[]) {
  const byFirstName = new Map<string, Pick<User, 'id' | 'name'>[]>()
  for (const u of users.filter((x) => x.status === 'Active')) {
    const first = u.name.trim().split(/\s+/)[0].toLowerCase()
    byFirstName.set(first, [...(byFirstName.get(first) ?? []), u])
  }
  return byFirstName
}

// ─── Step 3: the plan ────────────────────────────────────────────────────────────────────────

export interface ExistingRefs {
  leads: Pick<Lead, 'id' | 'leadNumber' | 'companyName' | 'email' | 'phone' | 'mobile'>[]
  companies: Pick<Company, 'id' | 'name'>[]
  users: Pick<User, 'id' | 'name' | 'status'>[]
}

export interface PlannedLead {
  line: number
  sheetNumber: string
  lead: Omit<Lead, 'leadNumber'>
  deal: Deal
  /** Undefined when an existing client of the same name is reused, or an earlier row already creates it. */
  newCompany?: Company
  existingCompanyId?: ID
  /** Company patch for a reused client whose mandate this import records as signed. */
  companyPatch?: Partial<Company>
  ownerName: string
}

export interface SkippedLead { line: number; sheetNumber: string; name: string; reason: string }

export interface LeadSheetPlan {
  leads: PlannedLead[]
  skipped: SkippedLead[]
  problems: string[]
  remarks: string[]
  /** Rows with something in them but nobody to import: no client, contact, email or number. */
  skippedBlank: number
}

export interface PlanOptions {
  defaultOwnerId: ID
  today: string
  service?: ProductService
  newId?: () => string
}

const companyKey = (s: string) => s.toLowerCase().replace(/\(pty\)|pty|ltd|\bcc\b|\binc\b|[^a-z0-9]/g, '')

export function planLeadSheet(
  sheet: Sheet, mapping: ColumnTarget[], maps: ValueMaps, existing: ExistingRefs, options: PlanOptions,
): LeadSheetPlan {
  const newId = options.newId ?? (() => crypto.randomUUID())
  const service = options.service ?? DEFAULT_SERVICE
  const isHandover = kindForService(service) === 'Handover'
  const today = options.today
  const plan: LeadSheetPlan = { leads: [], skipped: [], problems: [], remarks: [], skippedBlank: 0 }

  const conflicts = mappingConflicts(mapping)
  if (conflicts.length) {
    plan.problems.push(`More than one column is going to ${conflicts.map((k) => `"${FIELD_BY_KEY[k].label}"`).join(', ')}. Choose one.`)
    return plan
  }
  if (!mapping.some((t) => t === 'clientName' || t === 'contactName' || t === 'email' || t === 'phone')) {
    plan.problems.push('No column is going to the client name, contact person, email or phone, so there is nobody to import. Match at least one.')
    return plan
  }

  const usersById = new Map(existing.users.map((u) => [u.id, u]))
  if (!usersById.has(options.defaultOwnerId)) {
    plan.problems.push('Choose who leads without a matching rep go to.')
    return plan
  }

  // What's already in Raptor, so running this twice — or after someone typed a few leads in by
  // hand — adds nothing twice.
  const seenEmail = new Map<string, string>()
  const seenCompany = new Map<string, string>()
  const seenPhone = new Map<string, string>()
  for (const l of existing.leads) {
    const label = `lead ${String(l.leadNumber).padStart(5, '0')} (${l.companyName})`
    if (l.email) seenEmail.set(l.email.toLowerCase(), label)
    if (l.companyName) seenCompany.set(companyKey(l.companyName), label)
    for (const p of [l.phone, l.mobile]) for (const n of sheetPhones(p)) seenPhone.set(n, label)
  }
  const clientByKey = new Map(existing.companies.map((c) => [companyKey(c.name), c.id]))
  const plannedCompanyByKey = new Map<string, Company>()
  // Within the sheet a shared email is not enough: two practices with one accounts clerk are
  // two leads. Same client *and* same address is the same row entered twice.
  const inSheet = new Map<string, string>()
  const emailRow = new Map<string, number>()

  for (const r of mapRows(sheet, mapping)) {
    if (!isSomebody(r)) {
      if (r.notes.length + FIELDS.filter((f) => r.all(f.key).length).length > 0 && value(r.one('createdDate'))) plan.skippedBlank++
      continue
    }
    const sheetNumber = value(r.one('sheetNumber'))
    const emailCols = r.all('email').map((c) => c.text)
    const phoneCols = r.all('phone').map((c) => c.text)
    const emails = [...new Set([...emailCols, ...phoneCols, r.one('city')].flatMap(sheetEmails))]
    const phones = [...new Set([...phoneCols, ...emailCols].flatMap(sheetPhones))]
    const contactRaw = r.one('contactName')
    const contact = splitName(contactRaw)
    const clientName = value(r.one('clientName'))
    const companyName = clientName || value(contactRaw) || emails[0] || phones[0] || 'Unnamed lead'
    const label = `Row ${r.line}${sheetNumber ? ` (#${sheetNumber})` : ''}, ${companyName}`

    // ─ duplicates
    const sheetKey = `${companyKey(companyName)}|${emails[0] ?? ''}`
    const dupInSheet = inSheet.get(sheetKey)
    const dupExisting = (emails[0] && seenEmail.get(emails[0]))
      || (clientName && seenCompany.get(companyKey(clientName)))
      || (!emails[0] && !clientName && phones.map((p) => seenPhone.get(p)).find(Boolean))
    if (dupInSheet || dupExisting) {
      plan.skipped.push({
        line: r.line, sheetNumber, name: companyName,
        reason: dupInSheet ? `the same client and email as ${dupInSheet}` : `already in Raptor as ${dupExisting}`,
      })
      continue
    }
    inSheet.set(sheetKey, `row ${r.line}`)
    const sharedWith = emails[0] ? emailRow.get(emails[0]) : undefined
    if (sharedWith) plan.remarks.push(`${label}: same email address as row ${sharedWith} — imported as a separate lead because the client is different.`)
    else if (emails[0]) emailRow.set(emails[0], r.line)

    // ─ dates
    const startRaw = r.one('createdDate')
    const start = sheetDates(startRaw, today)[0]
    const contactCols = r.all('contactDates')
    const contactDates = contactCols.flatMap((c) => sheetDates(c.text, today)).sort()
    const signedRaw = r.one('signedDate')
    const signed = sheetDates(signedRaw, today)[0]
    const rejectedOn = sheetDates(r.one('rejectedDate'), today)[0]
    const handoverOn = sheetDates(r.one('handoverDate'), today)[0]
    const allDates = [start, ...contactDates, signed, rejectedOn].filter(Boolean).sort() as string[]
    const created = start ?? allDates[0] ?? today
    if (!start) plan.problems.push(`${label}: no readable date it came in${value(startRaw) ? ` ("${value(startRaw)}")` : ''} — dated ${created} instead.`)
    const lastContact = contactDates.at(-1)
    const latest = allDates.at(-1) ?? created
    for (const [col, raw] of [...contactCols.map((c) => [c.header, c.text] as const), ['Date signed', signedRaw] as const, ['Start date', startRaw] as const]) {
      for (const m of raw.matchAll(/(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/g)) {
        if (`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` > today) {
          plan.problems.push(`${label}: ${col} "${value(raw)}" is in the future — taken to be a typo and ignored.`)
        }
      }
    }

    // ─ how far it got, where from, whose
    const statusRaw = value(r.one('status'))
    const progressRaw = value(r.one('progress'))
    const chosen = maps.outcome[outcomeKey(statusRaw, progressRaw)] ?? 'auto'
    const outcome = chosen === 'auto'
      ? (contactDates.length > 0 ? OUTCOMES.find((o) => o.id === 'interested')! : OUTCOMES.find((o) => o.id === 'none')!)
      : OUTCOMES.find((o) => o.id === chosen)!
    const status = outcome.status!
    const dealStage = outcome.stage!
    const referredOut = status === 'Rejected' && progressRaw.toLowerCase() === 'referred'

    const sourceRaw = value(r.one('source'))
    const source = maps.source[sourceRaw] ?? 'Other'
    const campaign = sourceRaw && sourceRaw.toLowerCase() !== source.toLowerCase()
      && !(sourceRaw.toLowerCase() === 'google' && source === 'Google Ads')
      && !/^ref+er+al$/i.test(sourceRaw) && !/^chat\s*gpt$/i.test(sourceRaw) && !/^g[ea]r?mini$/i.test(sourceRaw)
      ? sourceRaw : undefined

    const rep = value(r.one('owner'))
    const ownerId = maps.owner[rep] ?? options.defaultOwnerId
    const owner = usersById.get(ownerId) ?? usersById.get(options.defaultOwnerId)!
    const repMatches = rep && owner.name.split(/\s+/)[0].toLowerCase() === rep.split(/\s+/)[0].toLowerCase()

    // ─ money
    const amountRaw = r.one('handoverAmount')
    const amount = sheetAmount(amountRaw)
    const accountsRaw = r.one('accounts')
    const accounts = sheetCount(accountsRaw)
    if (value(amountRaw) && amount.amount === undefined) {
      plan.problems.push(`${label}: amount "${value(amountRaw)}" can't be read as a figure — kept in the notes only.`)
    }
    const commissionRaw = value(r.one('commission'))
    const commissionChoice = commissionRaw ? maps.commission[commissionRaw] : undefined
    const commission = commissionChoice && isHandover
      ? termsFromChoice(commissionChoice.choice, commissionChoice.custom)
      : { commissionRate: undefined, commissionScale: undefined }
    const commissionKept = !commission.commissionRate && !commission.commissionScale

    // ─ phones and emails into the two slots a lead has; the rest into notes
    const mobiles = phones.filter(isMobile)
    const landlines = phones.filter((p) => !isMobile(p))
    const mobile = mobiles[0]
    const phone = landlines[0] ?? mobiles[1]
    const extraPhones = phones.filter((p) => p !== mobile && p !== phone)
    const unreadablePhones = r.all('phone').filter((c) => sheetPhones(c.text).length === 0 && sheetEmails(c.text).length === 0)
    for (const c of unreadablePhones) {
      if (!/no contact/i.test(c.text) && sheetDates(c.text, '9999-12-31').length === 0) {
        plan.problems.push(`${label}: ${c.header} "${value(c.text)}" isn't a number Raptor can dial — kept in the notes.`)
      }
    }

    // An Industry cell holding an email address is a slip, not an industry.
    const industryRaw = value(r.one('industry'))
    const industry = industryRaw && !/@/.test(industryRaw) && !/^\d+$/.test(industryRaw) ? industryRaw : undefined
    const cityRaw = value(r.one('city'))
    const city = cityRaw && !/@/.test(cityRaw) ? cityRaw : undefined

    // ─ notes: everything the sheet said that no field holds
    const history: string[] = []
    const add = (name: string, v: string | undefined) => { const s = value(v); if (s) history.push(`${name}: ${s}`) }
    history.push(`Sheet status: ${[statusRaw, progressRaw].filter(Boolean).join(' · ') || '(blank)'}`)
    if (rep && !repMatches) add('Rep on the sheet', rep)
    if (!amount.plain) add('Amount as written', amountRaw)
    if (value(accountsRaw) && !/^\d+$/.test(value(accountsRaw))) add('Number of accounts as written', accountsRaw)
    if (commissionRaw && commissionKept) add('Commission as written', commissionRaw)
    for (const c of contactCols) add(c.header, c.text)
    add('Date signed', signedRaw)
    add('Date rejected', r.one('rejectedDate'))
    add('Handover date', r.one('handoverDate'))
    add('Rejection reason', r.one('rejectionReason'))
    if (cityRaw && !city) add('Location', cityRaw)
    if (industryRaw && !industry) add('Industry column', industryRaw)
    for (const c of r.notes) add(c.header, c.text)
    if (emails.length > 1) history.push(`Other email addresses: ${emails.slice(1).join(', ')}`)
    if (extraPhones.length) history.push(`Other numbers: ${extraPhones.join(', ')}`)
    for (const c of unreadablePhones) add(c.header, c.text)
    const enquiry = r.all('enquiry').map((c) => c.text.trim().replace(/\n{3,}/g, '\n\n')).filter(Boolean).join('\n\n')
    const notes = [
      enquiry ? `Enquiry: ${enquiry}` : '',
      `Imported from the leads sheet, row ${r.line}${sheetNumber ? ` (#${sheetNumber})` : ''}:\n${history.map((h) => `• ${h}`).join('\n')}`,
    ].filter(Boolean).join('\n\n')

    // ─ client record: the existing one if Raptor already knows them, otherwise a new one that
    //   stays out of the Clients list until its deal is Won, exactly as Add Lead behaves.
    const key = companyKey(companyName)
    const existingCompanyId = clientByKey.get(key)
    let newCompany = existingCompanyId ? undefined : plannedCompanyByKey.get(key)
    const reusesPlanned = !!newCompany
    if (!existingCompanyId && !newCompany) {
      newCompany = {
        id: newId(), name: companyName, industry, city, preferredLanguage: normaliseLanguage(r.one('language')),
        accountOwnerId: owner.id, createdAt: atNine(created),
      }
      plannedCompanyByKey.set(key, newCompany)
    }
    const companyId = existingCompanyId ?? newCompany!.id

    const leadId = newId()
    const dealId = newId()
    const won = dealStage === 'Won'
    const wonOn = signed ?? lastContact ?? created
    if (won && !signed) plan.remarks.push(`${label}: signed without a sign date — dated ${wonOn}, its last contact.`)
    const endedOn = rejectedOn ?? lastContact ?? latest
    const rejectionText = value(r.one('rejectionReason'))
    const rejectionReason: RejectionReason | undefined = status === 'Rejected'
      ? referredOut ? 'Other' : rejectionText ? maps.rejection[rejectionText] ?? 'Other' : 'Other'
      : undefined
    const rejectionNote = status === 'Rejected'
      ? (referredOut ? `Referred elsewhere. ${contactCols.map((c) => value(c.text)).join(' ')}`.trim() : rejectionText || undefined)
      : undefined

    // When the mandate (or quotation) went out isn't a column, but it went out by the last contact
    // before signing — the closest honest date the sheet gives. Without one, Raptor offers to send
    // a mandate that has already gone.
    const docSent = dealStage === 'Mandate Sent' || dealStage === 'Quotation Sent'
      || (/^mandate sent|^quoted/i.test(progressRaw) && (won || status === 'Rejected'))
    const docSentOn = docSent ? contactDates.filter((d) => d <= (signed ?? today)).at(-1) ?? created : undefined
    const isQuote = dealStage === 'Quotation Sent' || /^quoted/i.test(progressRaw)

    const lead: Omit<Lead, 'leadNumber'> = {
      id: leadId,
      firstName: contact.firstName,
      lastName: contact.lastName,
      companyId,
      companyName,
      phone,
      mobile,
      email: emails[0],
      source,
      campaign,
      status,
      score: 10,
      estimatedValue: amount.amount ?? 0,
      ownerId: owner.id,
      industry,
      city,
      preferredLanguage: normaliseLanguage(r.one('language')),
      services: [service],
      classification: sheetRank(r.one('rank')),
      estimatedHandoverAmount: isHandover ? amount.amount : undefined,
      estimatedAccountsCount: isHandover ? accounts : undefined,
      estimatedProjectValue: isHandover ? undefined : amount.amount,
      serviceValues: [isHandover
        ? { service, handoverAmount: amount.amount, accountsCount: accounts }
        : { service, value: amount.amount }],
      commissionRate: commission.commissionRate,
      commissionScale: commission.commissionScale,
      notes,
      lastContactAt: lastContact ? atNine(lastContact) : undefined,
      createdAt: atNine(created),
      updatedAt: atNine(latest),
      convertedDealId: won ? dealId : undefined,
      rejectionReason,
      rejectionNote,
    }

    const deal: Deal = {
      id: dealId,
      name: `${companyName} — ${service}`,
      companyId,
      ownerId: owner.id,
      stage: dealStage,
      kind: isHandover ? 'Handover' : 'Service',
      // A handover earns nothing at signature; its size lives in handoverAmount (see markDealWon).
      value: isHandover ? 0 : amount.amount ?? 0,
      probability: DEAL_STAGE_PROBABILITY[dealStage],
      expectedCloseDate: atNine(won ? wonOn : addDays(created, 30)),
      service,
      source,
      mandateSentAt: docSentOn && !isQuote && isHandover ? atNine(docSentOn) : undefined,
      quotationSentAt: docSentOn && (isQuote || !isHandover) ? atNine(docSentOn) : undefined,
      handoverAmount: isHandover ? amount.amount : undefined,
      accountsCount: isHandover ? accounts : undefined,
      createdAt: atNine(created),
      leadId,
      wonAt: won ? atNine(wonOn) : undefined,
      contractStartDate: won ? handoverOn : undefined,
      rejectedAt: dealStage === 'Rejected' ? atNine(endedOn) : undefined,
      rejectionReason,
      rejectionNote,
    }

    // A signed mandate carries the estimate across to the client, as conversion does in the app.
    const signedPatch: Partial<Company> | undefined = won && isHandover
      ? {
          mandateSignedAt: atNine(wonOn),
          estimatedHandoverAmount: amount.amount,
          estimatedAccountsCount: accounts,
          estimatedAtConversion: atNine(wonOn),
          classification: sheetRank(r.one('rank')),
        }
      : undefined
    if (signedPatch && newCompany && !reusesPlanned) Object.assign(newCompany, signedPatch)
    if (existingCompanyId) plan.remarks.push(`${label}: Raptor already has a client called this — the lead is attached to it.`)
    if (reusesPlanned) plan.remarks.push(`${label}: shares its client record with an earlier row of the same name.`)

    plan.leads.push({
      line: r.line,
      sheetNumber,
      lead,
      deal,
      newCompany: reusesPlanned ? undefined : newCompany,
      existingCompanyId,
      companyPatch: existingCompanyId ? signedPatch : undefined,
      ownerName: owner.name,
    })
  }

  // Lead numbers are handed out by the database in the order rows arrive. Sorted by the date
  // they came in, the old leads number in the order they actually happened.
  plan.leads.sort((a, b) => a.lead.createdAt.localeCompare(b.lead.createdAt) || a.line - b.line)
  if (sheet.rows.length && plan.leads.length === 0 && plan.skipped.length === 0) {
    plan.problems.push('No leads could be read from this sheet with the columns matched as they are.')
  }
  return plan
}

export { CUSTOM }

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
