import { isSendableEmail, normaliseEmail } from './marketing.js'

/**
 * IMPORTED PROSPECT LISTS (S10, 22 Oct).
 *
 * THE FIRM: "send out to prospective clients or new email lists that we've had." A list arrives as a
 * spreadsheet -- a trade fair's sign-ups, a directory, a list somebody kept -- and each row becomes a
 * LEAD with source "Imported list", so it is one of Raptor's own records from then on: on the leads
 * screen, on somebody's desk, and reached by campaigns through the same audience rules as every
 * other lead. A list is never a thing campaigns are sent to directly; the leads it brought in are.
 *
 * WHAT IT REFUSES TO BRING IN, counted on the screen before anything is written:
 *   - an address that does not look like one (one bad address fails a whole batch at Resend);
 *   - the same address twice in the file (the first row wins);
 *   - an address that is ALREADY A CLIENT'S -- a company's own, or a contact on one. "An existing
 *     client is not a prospect": they are reached as a client, under s69(3), and an introduction
 *     asking a client whether they would like to hear from us is the wrong letter;
 *   - an address that is ALREADY A LEAD, including one an earlier import brought in. Importing it
 *     again would make a second lead for one person, and -- the part that matters -- a second
 *     lead has no introduction on record, so it would hand the same person a second "first"
 *     approach. POPIA s69(2) allows one.
 *
 * PURE: the browser reads the file and shapes it here; the SERVER plans it again against every row
 * in the database and writes only what its own plan says is new. The counts the marketer approves
 * are the server's.
 */

export interface ProspectRow {
  firstName: string
  lastName: string
  email: string
  company: string
  phone: string
  /** Every column this does not know, kept as "Header: value" lines -- nothing in the file is lost. */
  note: string
  /** 1-based row in the file, header being row 1 -- for the screen's examples. */
  line: number
}

export interface ProspectSheet {
  rows: ProspectRow[]
  /** What each recognised column was read as, for the screen: "E-mail address → email". */
  columns: { header: string; as: keyof Omit<ProspectRow, 'line' | 'note'> | 'name' | 'note' }[]
  /** Set when the file cannot be read as a list at all, in words for the marketer. */
  problem: string | null
}

/** The most rows one upload may carry. Bigger lists go in parts -- and warm up for weeks anyway. */
export const MAX_PROSPECT_ROWS = 20_000

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z]/g, '')
const HEADERS: Record<string, 'email' | 'name' | 'firstName' | 'lastName' | 'company' | 'phone'> = {
  email: 'email', emailaddress: 'email', mail: 'email', emailaddr: 'email',
  name: 'name', fullname: 'name', contact: 'name', contactname: 'name', contactperson: 'name',
  firstname: 'firstName', first: 'firstName', givenname: 'firstName', name1: 'firstName',
  lastname: 'lastName', surname: 'lastName', last: 'lastName', familyname: 'lastName',
  company: 'company', companyname: 'company', business: 'company', businessname: 'company',
  organisation: 'company', organization: 'company', firm: 'company', employer: 'company',
  phone: 'phone', phonenumber: 'phone', mobile: 'phone', mobilenumber: 'phone', cell: 'phone',
  cellphone: 'phone', cellnumber: 'phone', telephone: 'phone', tel: 'phone', contactnumber: 'phone',
}

/**
 * A SHEET (header row first, as the CSV and .xlsx readers both give it) READ AS PEOPLE. By header,
 * never by position -- the lesson of the leads workbook, whose columns moved between tabs.
 */
export function readProspectSheet(table: string[][]): ProspectSheet {
  const header = (table[0] ?? []).map((h) => String(h ?? '').trim())
  const roles = header.map((h) => HEADERS[norm(h)] ?? null)
  const columns: ProspectSheet['columns'] = header.map((h, i) => ({ header: h, as: roles[i] ?? 'note' }))
    .filter((c) => c.header)
  if (!roles.includes('email')) {
    return { rows: [], columns, problem: 'No email column was found. The first row must be headings, with one called "Email".' }
  }
  const first = (role: string) => roles.indexOf(role as never)
  const rows: ProspectRow[] = []
  table.slice(1).forEach((cells, i) => {
    const cell = (idx: number) => (idx >= 0 ? String(cells[idx] ?? '').trim() : '')
    if (!cells.some((c) => String(c ?? '').trim())) return
    let firstName = cell(first('firstName'))
    let lastName = cell(first('lastName'))
    const full = cell(first('name'))
    if (!firstName && !lastName && full) {
      const parts = full.split(/\s+/)
      firstName = parts[0] ?? ''
      lastName = parts.slice(1).join(' ')
    }
    const note = header
      .map((h, idx) => (roles[idx] === null && h && cell(idx) ? `${h}: ${cell(idx)}` : ''))
      .filter(Boolean).join('\n')
    rows.push({
      firstName, lastName, email: cell(first('email')), company: cell(first('company')), phone: cell(first('phone')),
      note, line: i + 2,
    })
  })
  if (!rows.length) return { rows, columns, problem: 'The file has headings but no rows under them.' }
  if (rows.length > MAX_PROSPECT_ROWS) {
    return { rows: [], columns, problem: `The file has ${rows.length.toLocaleString('en-ZA')} rows; one upload takes at most ${MAX_PROSPECT_ROWS.toLocaleString('en-ZA')}. Split it and upload it in parts.` }
  }
  return { rows, columns, problem: null }
}

export type ProspectOutcome = 'new' | 'already a lead' | 'already a client' | 'bad email' | 'duplicate in file'
export const PROSPECT_OUTCOMES: ProspectOutcome[] = ['new', 'already a lead', 'already a client', 'bad email', 'duplicate in file']

export interface ProspectPlan {
  fresh: (ProspectRow & { email: string })[]
  counts: Record<ProspectOutcome, number>
  /** A few addresses (or row numbers) per outcome, for the screen. */
  examples: Record<ProspectOutcome, string[]>
}

export interface KnownAddresses {
  /** Every lead's address, imported or typed. */
  leadEmails: Set<string>
  /** Every client's: companies' own and contacts on a company. */
  clientEmails: Set<string>
}

/**
 * WHAT AN UPLOAD WOULD DO, row by row. The order of the tests is the order of the reasons: an address
 * that is both a client's and a lead's is counted as a client's, because that is the basis it is
 * reached on.
 */
export function planProspectImport(rows: ProspectRow[], known: KnownAddresses): ProspectPlan {
  const counts = Object.fromEntries(PROSPECT_OUTCOMES.map((o) => [o, 0])) as Record<ProspectOutcome, number>
  const examples = Object.fromEntries(PROSPECT_OUTCOMES.map((o) => [o, [] as string[]])) as Record<ProspectOutcome, string[]>
  const fresh: ProspectPlan['fresh'] = []
  const seen = new Set<string>()
  const note = (o: ProspectOutcome, what: string) => {
    counts[o] += 1
    if (examples[o].length < 5) examples[o].push(what)
  }
  for (const r of rows) {
    const email = normaliseEmail(r.email)
    if (!email || !isSendableEmail(email)) { note('bad email', r.email ? `${r.email} (row ${r.line})` : `row ${r.line}, no address`); continue }
    if (seen.has(email)) { note('duplicate in file', `${email} (row ${r.line})`); continue }
    seen.add(email)
    if (known.clientEmails.has(email)) { note('already a client', email); continue }
    if (known.leadEmails.has(email)) { note('already a lead', email); continue }
    note('new', email)
    fresh.push({ ...r, email })
  }
  return { fresh, counts, examples }
}

/**
 * ONE NEW LEAD, as the row the server writes. Every row carries exactly the same keys -- a bulk insert
 * fills a missing key with NULL, not the column default (leadsImport.ts learned that at row 1,000).
 */
export function prospectLeadRow(r: ProspectPlan['fresh'][number], ctx: { ownerId: string; listId: string; listName: string; fileName: string | null }) {
  const from = `Imported from the list “${ctx.listName}”${ctx.fileName ? ` (${ctx.fileName})` : ''}.`
  return {
    first_name: r.firstName.slice(0, 200),
    last_name: r.lastName.slice(0, 200),
    company_name: r.company.slice(0, 300),
    /* An imported row with no company is a person, not a business -- the lead form's own distinction. */
    party: r.company ? 'company' : 'individual',
    email: r.email,
    mobile: r.phone || null,
    source: 'Imported list',
    status: 'No Contact Yet',
    owner_id: ctx.ownerId,
    notes: r.note ? `${from}\n${r.note}`.slice(0, 4000) : from,
    marketing_list_id: ctx.listId,
  }
}
