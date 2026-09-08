/**
 * The Debtors Per Client export: the debtor themselves.
 *
 * The other five exports describe a debt — what was handed over, what was charged, what was
 * paid. None of them carries a phone number. This one does: on the migrated book of 735 it holds
 * 691 cellphones, 678 email addresses and 721 main comments, which is the difference between an
 * account someone can work and a row in a ledger.
 *
 * It ENRICHES rather than creates. The account spine still comes from the Client Account
 * Summary, and every financial figure still comes from the ledgers — this file deliberately
 * ignores the forty-odd money columns the export also carries, because two sources for one
 * number is how a balance starts disagreeing with itself.
 */
import { num, isoDate, text, type CsvRow } from './csv.ts'

export interface ContactRow {
  account_id: string
  kind: 'mobile' | 'phone' | 'work' | 'email' | 'address' | 'employer' | 'other'
  value: string
  label: string | null
  is_primary: boolean
  source: string
}

export interface PromiseRow {
  account_id: string
  amount: number
  due_on: string
  method: string | null
  origin: string | null
  status: 'open' | 'kept' | 'broken' | 'cancelled'
  notes: string | null
  source: string
  created_at: string
}

export interface NoteRow {
  account_id: string
  body: string
  author_name: string | null
  source: string
  created_at: string
}

/** What this export can add to an account row, once matched by Swordfish reference. */
export interface DebtorPatch {
  debtor_first_name?: string | null
  debtor_second_name?: string | null
  debtor_surname?: string | null
  debtor_id_number?: string | null
  debtor_title?: string | null
  debtor_initials?: string | null
  main_comment?: string | null
  main_comment_at?: string | null
  account_flags?: string | null
  account_rating?: number | null
  last_contact_method?: string | null
  ptp_success_ratio?: number | null
}

export interface DebtorImport {
  /** Keyed by Swordfish Reference, to be merged into the account rows built from the summary. */
  patches: Map<string, DebtorPatch>
  /** Keyed by Swordfish Reference; account_id is filled in once the account row is known. */
  contactsByRef: Map<string, Omit<ContactRow, 'account_id'>[]>
  promisesByRef: Map<string, Omit<PromiseRow, 'account_id'>[]>
  notesByRef: Map<string, Omit<NoteRow, 'account_id'>[]>
  problems: string[]
  notes: string[]
  stats: {
    rows: number
    contacts: number
    mobiles: number
    emails: number
    addresses: number
    promises: number
    mainComments: number
    importedNotes: number
    idsRejected: number
  }
}

/** A South African ID number is thirteen digits. Anything else in that column is not one. */
const isIdNumber = (v: string) => /^\d{13}$/.test(v)

/** Enough digits to dial. Guards against a stray "N/A" or a single character in a phone column. */
const looksLikePhone = (v: string) => v.replace(/\D/g, '').length >= 7

const looksLikeEmail = (v: string) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v)

/**
 * "2026/09/04" and "2026/08/24 08:57" both appear in this export. isoDate handles the date; the
 * time is dropped, which is all a due date needs.
 */
const dateOnly = (v: unknown) => isoDate(String(v ?? '').split(' ')[0])

/**
 * Swordfish's PTP status, in our terms.
 *
 * "Late" stays OPEN, not broken. A promise whose date has passed without payment has not been
 * judged by anybody yet, and marking 5 accounts broken on import would be this system inventing
 * a decision a collector never made. The account page already draws an open promise past its
 * date as overdue, which is the honest reading.
 */
function promiseStatus(raw: string): PromiseRow['status'] | null {
  switch (raw.trim()) {
    case 'Pending': return 'open'
    case 'Late': return 'open'
    case 'Failed': return 'broken'
    case 'No PTP': return null
    default: return null
  }
}

export function readDebtorsPerClient(rows: CsvRow[], now = new Date()): DebtorImport {
  const nowIso = now.toISOString()
  const out: DebtorImport = {
    patches: new Map(),
    contactsByRef: new Map(),
    promisesByRef: new Map(),
    notesByRef: new Map(),
    problems: [],
    notes: [],
    stats: {
      rows: 0, contacts: 0, mobiles: 0, emails: 0, addresses: 0,
      promises: 0, mainComments: 0, importedNotes: 0, idsRejected: 0,
    },
  }

  let missingRef = 0

  for (const r of rows) {
    const ref = text(r['Swordfish Reference'])
    if (!ref) { missingRef++; continue }
    out.stats.rows++

    /* ---------- the person ---------- */

    const rawId = (text(r['ID Number']) ?? '').replace(/\s/g, '')
    const idNumber = isIdNumber(rawId) ? rawId : null
    if (rawId && !idNumber) out.stats.idsRejected++

    const patch: DebtorPatch = {
      debtor_first_name: text(r['First Name']),
      debtor_second_name: text(r['Second Name']),
      debtor_surname: text(r['Surname']),
      debtor_title: text(r['Title']),
      debtor_initials: text(r['Initials']),
      main_comment: text(r['Main Comment']),
      main_comment_at: dateOnly(r['Main Comment Date']) ?? null,
      account_flags: text(r['Account Flags']),
      account_rating: num(r['Account Rating']) ?? null,
      last_contact_method: text(r['Last Contact Method on Account']),
      ptp_success_ratio: num(r['PTP Success Ratio']) ?? null,
    }
    // Only set the ID where it really is one. Leaving the account's existing value alone is
    // right: the summary export's ID column is the one we have been using, and overwriting it
    // with something we have just rejected would be worse than not touching it.
    if (idNumber) patch.debtor_id_number = idNumber
    if (patch.main_comment) out.stats.mainComments++
    out.patches.set(ref, patch)

    /* ---------- how to reach them ---------- */

    const contacts: Omit<ContactRow, 'account_id'>[] = []
    const seen = new Set<string>()
    const add = (kind: ContactRow['kind'], value: string | null, label: string | null, primary: boolean) => {
      const v = (value ?? '').trim()
      if (!v) return
      const key = `${kind}:${v.toLowerCase()}`
      // The same number appears twice in three rows of this export. One row, one contact.
      if (seen.has(key)) return
      seen.add(key)
      contacts.push({ kind, value: v, label, is_primary: primary, source: 'swordfish' })
    }

    const phoneCols: [ContactRow['kind'], string[]][] = [
      ['mobile', ['Cellphone', 'Cellphone 2', 'Cellphone 3', 'Cellphone 4']],
      ['phone', ['Home Phone', 'Home Phone 2', 'Home Phone 3', 'Home Phone 4']],
      ['work', ['Work Phone', 'Work Phone 2', 'Work Phone 3', 'Work Phone 4']],
    ]
    let firstPhone = true
    for (const [kind, cols] of phoneCols) {
      for (const col of cols) {
        const v = text(r[col])
        if (!v || !looksLikePhone(v)) continue
        // The first number found, in cellphone-then-home-then-work order, is the one to try.
        add(kind, v, null, firstPhone)
        firstPhone = false
      }
    }

    let firstEmail = true
    for (const col of ['Email', 'Email 2', 'Email 3', 'Email 4']) {
      const v = text(r[col])
      if (!v || !looksLikeEmail(v)) continue
      add('email', v, null, firstEmail)
      firstEmail = false
    }

    // Street first, then postal: an address you can knock on beats one you can post to.
    const joinParts = (parts: unknown[]) => parts.map((p) => text(p)).filter(Boolean).join(', ') || null
    const street = text(r['Combined Street'])
      ?? joinParts([r['Street Address 1'], r['Street Address 2'], r['Street Address 3'], r['Street Address 4'], r['Street Code']])
    add('address', street, 'Street', true)
    const postal = text(r['Combined Postal'])
      ?? joinParts([r['Postal Address 1'], r['Postal Address 2'], r['Postal Address 3'], r['Postal Address 4'], r['Postal Code']])
    add('address', postal, 'Postal', false)

    const employer = text(r['Employer Name'])
    if (employer) add('employer', employer, text(r['Occupation']), false)
    const employerPhone = text(r['Employer Contact'])
    if (employerPhone && looksLikePhone(employerPhone)) add('work', employerPhone, employer ?? 'Employer', false)

    if (contacts.length) {
      out.contactsByRef.set(ref, contacts)
      out.stats.contacts += contacts.length
      out.stats.mobiles += contacts.filter((c) => c.kind === 'mobile').length
      out.stats.emails += contacts.filter((c) => c.kind === 'email').length
      out.stats.addresses += contacts.filter((c) => c.kind === 'address').length
    }

    /* ---------- the promise they are on ---------- */

    const status = promiseStatus(String(r['PTP Status'] ?? ''))
    const amount = num(r['PTP Amount'])
    const dueOn = dateOnly(r['PTP Due Date'])
    if (status && amount && amount > 0 && dueOn) {
      const origin = text(r['PTP Origin'])
      out.promisesByRef.set(ref, [{
        amount,
        due_on: dueOn,
        method: null,
        origin: origin === 'N/A' ? null : origin,
        status,
        notes: null,
        source: 'swordfish',
        created_at: dateOnly(r['PTP Creation Date']) ? `${dateOnly(r['PTP Creation Date'])}T00:00:00Z` : nowIso,
      }])
      out.stats.promises++
    }

    /* ---------- what was last said ---------- */

    // Two single-value comment columns, each with its own date. Not the 58,192 action comments,
    // which are a separate export — these are the most recent thing said and the reason the
    // account sits at the sub-status it does, and they give a migrated timeline something to
    // show on day one.
    const notes: Omit<NoteRow, 'account_id'>[] = []
    const author = text(r['Assigned To'])
    const lastComment = text(r['Last Comment'])
    const lastCommentAt = dateOnly(r['Comment Date'])
    if (lastComment && lastCommentAt) {
      notes.push({ body: lastComment, author_name: author, source: 'swordfish', created_at: `${lastCommentAt}T00:00:00Z` })
    }
    const subComment = text(r['Sub-status Comment'])
    const subCommentAt = dateOnly(r['Sub-status date'])
    if (subComment && subComment !== lastComment) {
      const at = subCommentAt ?? lastCommentAt
      const sub = text(r['Sub-status'])
      notes.push({
        body: sub ? `${sub}: ${subComment}` : subComment,
        author_name: author,
        source: 'swordfish',
        created_at: at ? `${at}T00:00:00Z` : nowIso,
      })
    }
    if (notes.length) {
      out.notesByRef.set(ref, notes)
      out.stats.importedNotes += notes.length
    }
  }

  if (missingRef) out.problems.push(`${missingRef} rows had no Swordfish Reference and were skipped.`)
  if (out.stats.idsRejected) {
    out.notes.push(
      `${out.stats.idsRejected} ID Number values were not 13 digits — 22 of them are the debtor's `
      + `own cellphone number — so they were left off rather than stored as identity numbers.`,
    )
  }
  out.notes.push(
    `${out.stats.mobiles} mobile numbers, ${out.stats.emails} email addresses and `
    + `${out.stats.addresses} addresses across ${out.stats.rows} debtors.`,
  )
  if (out.stats.promises) out.notes.push(`${out.stats.promises} promises to pay were still open or broken in Swordfish.`)

  return out
}

/* ================= Applying this export to a book that is already loaded ================= */

export interface AccountRef {
  id: string
  swordfishReference: string | null
  accountNumber: string | null
}

export interface EnrichPlan {
  /** Only the columns this export supplies, plus the id to write them to. */
  patches: (Record<string, unknown> & { id: string })[]
  contacts: ContactRow[]
  promises: PromiseRow[]
  notes: NoteRow[]
  matched: number
  /** References in the file with no account in the book. */
  unmatched: string[]
  /** Accounts in the book the file says nothing about. */
  untouched: number
  problems: string[]
  remarks: string[]
  stats: ReturnType<typeof readDebtorsPerClient>['stats']
}

export function planEnrichment(rows: CsvRow[], accounts: AccountRef[]): EnrichPlan {
  const d = readDebtorsPerClient(rows)

  // Matched on the Swordfish reference, falling back to the account number — they are the same
  // string on every migrated row, but an account created by hand may only have the latter.
  const byRef = new Map<string, AccountRef>()
  for (const a of accounts) {
    if (a.swordfishReference) byRef.set(a.swordfishReference, a)
    else if (a.accountNumber) byRef.set(a.accountNumber, a)
  }

  const plan: EnrichPlan = {
    patches: [], contacts: [], promises: [], notes: [],
    matched: 0, unmatched: [], untouched: 0,
    problems: [...d.problems], remarks: [...d.notes], stats: d.stats,
  }

  const seen = new Set<string>()
  for (const [ref, patch] of d.patches) {
    const account = byRef.get(ref)
    if (!account) { plan.unmatched.push(ref); continue }
    plan.matched++
    seen.add(account.id)

    // Only what this export actually has. A blank column must not erase a name that is already
    // on the account — the other exports supplied some of these fields first.
    const row: Record<string, unknown> & { id: string } = { id: account.id }
    for (const [k, v] of Object.entries(patch)) if (v !== null && v !== undefined) row[k] = v
    if (Object.keys(row).length > 1) plan.patches.push(row)

    for (const c of d.contactsByRef.get(ref) ?? []) plan.contacts.push({ ...c, account_id: account.id })
    for (const p of d.promisesByRef.get(ref) ?? []) plan.promises.push({ ...p, account_id: account.id })
    for (const n of d.notesByRef.get(ref) ?? []) plan.notes.push({ ...n, account_id: account.id })
  }

  plan.untouched = accounts.length - seen.size

  if (plan.unmatched.length) {
    plan.problems.push(
      `${plan.unmatched.length} debtors in this file have no account in the book `
      + `(${plan.unmatched.slice(0, 5).join(', ')}${plan.unmatched.length > 5 ? ', …' : ''}). `
      + `They are skipped — this updates accounts, it does not create them.`,
    )
  }
  if (plan.untouched > 0) {
    plan.remarks.push(`${plan.untouched.toLocaleString('en-ZA')} accounts are not in this file and are left alone.`)
  }
  return plan
}
