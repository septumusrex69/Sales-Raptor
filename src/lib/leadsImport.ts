import type {
  LeadClassification, LeadSource, LeadStatus, ProductService, RejectionReason,
} from '../types'

/**
 * The sales team's leads workbook, read into Raptor's `leads` table.
 *
 * The firm has kept its leads in one spreadsheet since February 2023 — a tab per sales month,
 * twenty-three of them and counting, roughly two thousand companies. This brings that across.
 *
 * TWO THINGS ABOUT THE WORKBOOK DECIDE THE SHAPE OF EVERYTHING BELOW.
 *
 * THE FIRST IS THAT THE TABS ARE NOT THE SAME SHAPE. They look identical opened side by side,
 * but over three years columns were inserted and removed — a "Lead - First contact" here, two
 * extra follow-up columns there — so "Client Name" is the eleventh column on eighteen tabs, the
 * tenth on three, and the twelfth on two. Reading by position would have quietly imported email
 * addresses into the company name field for a quarter of the book and nobody would have noticed
 * until somebody went looking for a client a year later. So every tab is read by its OWN header
 * row. The headers have stayed consistent in wording where the positions did not, including the
 * two spellings of "Unsuccessful" and "Rejection reason" versus plain "Reason".
 *
 * THE SECOND IS THAT THE COMPLETE LIST IS NOT COMPLETE. The "Complete Leads List" tab is missing
 * around six hundred leads that exist only on the monthly tabs, so reading it alone loses a third
 * of the book. Every tab is read and the result is de-duplicated on company, email and start
 * date, which is why the same lead appearing on the month it arrived and again on the month it
 * signed comes through once.
 *
 * WHAT IT REFUSES TO GUESS. A handover amount cell that holds more than one figure — "42 000-362
 * 000(810 000)" is a real one — is not a number and is not turned into one. The cell's own words
 * are kept in the lead's notes, flagged, and the amount is left empty for somebody to decide.
 * The alternative, stripping the punctuation and concatenating the digits, produces a book worth
 * sixty-five quadrillion rand, which is how this was found.
 */

export interface LeadsSheet {
  name: string
  /** Row 0 is the header. Everything is text, as both the .xlsx and the CSV readers produce. */
  rows: string[][]
}

/** One lead, ready to be written. Field names are the app's, not the spreadsheet's. */
export interface LeadsImportRow {
  /**
   * Company, email and start date, flattened. Stored on the row so a second run of the same
   * workbook updates what it already imported instead of doubling it.
   */
  legacyKey: string
  firstName: string
  lastName: string
  companyName: string
  email: string | null
  mobile: string | null
  source: LeadSource
  status: LeadStatus
  classification: LeadClassification | null
  estimatedHandoverAmount: number | null
  estimatedAccountsCount: number | null
  industry: string | null
  notes: string | null
  /** Whoever worked it on the spreadsheet. Kept as their name: none of them are Raptor users. */
  sourceMarketer: string | null
  createdAt: string | null
  rejectionReason: RejectionReason | null
  services: ProductService[]
  /** Where in the workbook this came from. For the report on screen; not written anywhere. */
  from: { sheet: string; row: number }
}

export interface LeadsSheetReport {
  name: string
  /** Data rows that held anything at all. */
  read: number
  /** Rows that were the same lead as one already taken. */
  duplicates: number
  /** Set when the tab could not be read, and why. */
  skipped: string | null
}

export interface LeadsImportPlan {
  rows: LeadsImportRow[]
  sheets: LeadsSheetReport[]
  /** Things a person should look at. Never fatal — the import runs regardless. */
  warnings: string[]
  counts: {
    total: number
    duplicates: number
    withEmail: number
    withMobile: number
    withAmount: number
    withDate: number
    amountsNeedingAHuman: number
  }
  byStatus: Record<string, number>
}

/* ------------------------------------------------------------------ reading cells */

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Text, or nothing. A lone dash is how the spreadsheet writes "not applicable". */
function text(v: string | undefined): string | null {
  const s = (v ?? '').trim()
  return s === '' || s === '-' ? null : s
}

/**
 * A date, or nothing.
 *
 * Both readers hand dates over as yyyy/mm/dd, but plenty of these cells were typed by hand and
 * hold things like "2026/0/21", which is not a date and is not worth a guess.
 */
export function isoDate(v: string | undefined): string | null {
  const m = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec((v ?? '').trim())
  if (!m) return null
  const [, y, mo, d] = m
  const month = Number(mo)
  const day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(Number(y), month - 1, day))
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString().slice(0, 10)
}

/**
 * One amount, or nothing — and it says which.
 *
 * The pattern is deliberately strict. It accepts a single figure with the spaces South African
 * money is written with, optionally prefixed R and with cents, and nothing else. Anything with a
 * second figure in it comes back `messy`, which is not the same as empty: an empty cell is a lead
 * whose handover was never quoted, and a messy one is a lead whose handover was quoted three
 * different ways and needs a person.
 */
export function oneAmount(v: string | undefined): { value: number | null; messy: boolean } {
  const s = (v ?? '').trim()
  if (s === '' || s === '-') return { value: null, messy: false }
  //   is the non-breaking space Excel leaves behind when a number is pasted from elsewhere.
  const m = /^R?\s*(\d{1,3}(?:[\s ]\d{3})*|\d+)([.,]\d{1,2})?$/.exec(s)
  if (!m) return { value: null, messy: true }
  const whole = m[1].replace(/\D/g, '')
  const frac = (m[2] ?? '').replace(',', '.')
  const value = Number(whole + frac)
  return Number.isFinite(value) ? { value, messy: false } : { value: null, messy: true }
}

/**
 * A name, or nothing.
 *
 * A "Client Name" holding nothing but digits is somebody's stray keystroke in a spreadsheet
 * column, not a company — there is one in the current workbook and it would arrive as a lead
 * called "51" that nobody can act on and nobody will ever delete.
 */
function named(v: string | undefined): string | null {
  const s = text(v)
  return s && /[a-z]/i.test(s) ? s : null
}

/** How many accounts. "12", "12.0" and "12 accounts" all mean twelve. */
function accountsCount(v: string | undefined): number | null {
  const s = (v ?? '').trim().replace(/\.0$/, '')
  if (s === '' || s === '-') return null
  const m = /^\s*(\d+)/.exec(s)
  return m ? Number(m[1]) : null
}

/* ------------------------------------------------------------- the spreadsheet's vocabulary */

/**
 * The status codes, as the sales team types them.
 *
 * Clo is closed — signed, which is Raptor's "Converted". Gla is the mandate being out with the
 * client, which is as hot as a lead gets before it signs. Ped and Ref are both somebody still
 * talking to us. Ns and Nc are the same thing written two ways.
 */
const STATUS_CODES: Record<string, LeadStatus> = {
  clo: 'Converted',
  gla: 'Hot Lead',
  rej: 'Rejected',
  ns: 'No Contact Yet',
  nc: 'No Contact Yet',
  ped: 'Interested',
  ref: 'Interested',
}

export function statusFor(code: string | undefined): { status: LeadStatus; known: boolean } {
  const key = (code ?? '').trim().toLowerCase()
  const found = STATUS_CODES[key]
  if (found) return { status: found, known: true }
  // An unrecognised code is a lead nobody has classified, not a lead to throw away.
  return { status: 'No Contact Yet', known: key === '' }
}

/** Where it came from. The spreadsheet's wording is free text and has forty-odd spellings. */
export function sourceFor(v: string | undefined): LeadSource {
  const s = (v ?? '').toLowerCase()
  if (s.includes('google') && !s.includes('email')) return 'Google Ads'
  if (s.includes('refer')) return 'Referral'
  if (s.includes('email')) return 'Email'
  if (s.includes('cold') || s.includes('door')) return 'Direct'
  if (s.includes('gpt') || s.includes('chat')) return 'ChatGPT'
  if (s.includes('website') || s.includes('web')) return 'Website'
  if (s.includes('linkedin')) return 'LinkedIn'
  if (s.includes('facebook')) return 'Facebook'
  return 'Other'
}

/**
 * Why it was turned down, mapped onto the six reasons the app reports on.
 *
 * There are seventy-odd distinct sentences in this column. Anything that doesn't clearly land on
 * one of the five named reasons becomes 'Other' AND keeps its own words in the notes, so the
 * report stays honest and nothing anybody wrote is lost.
 */
export function rejectionFor(v: string | undefined): RejectionReason | null {
  const s = (v ?? '').toLowerCase().trim()
  if (!s) return null
  if (s.includes('rejected by us') || s.includes('declin')) return 'We declined them'
  if (s.includes('price') || s.includes('expensive') || s.includes('cost')) return 'Too expensive'
  if (s.includes('another provider') || s.includes('someone else') || s.includes('other provider')) {
    return 'Went with another provider'
  }
  if (s.includes('no response') || s.includes('no contact') || s.includes('no reply')) return 'No response'
  if (s.includes('not interested') || s.includes('not ready')) return 'Not interested anymore'
  return 'Other'
}

/**
 * A person's name out of one cell.
 *
 * The contact column is a person's full name where somebody filled it in and empty where they
 * did not, in which case the company stands in — a lead has to be called something, and
 * "Unknown Unknown" in a list of two thousand helps nobody find anything. The surname
 * placeholder is spelled out rather than left blank because the field is required and a blank
 * one reads as a bug.
 */
export function splitName(person: string | null, company: string | null): [string, string] {
  const whole = person ?? company ?? 'Unknown'
  const parts = whole.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ['Unknown', '(no surname)']
  return [parts[0], parts.slice(1).join(' ') || '(no surname)']
}

/* ------------------------------------------------------------------------- the header row */

/** Which spreadsheet column holds what. Built per tab, because the tabs disagree. */
export class SheetColumns {
  private readonly byName = new Map<string, number[]>()

  constructor(header: string[]) {
    header.forEach((h, i) => {
      const key = norm(h)
      if (!key) return
      const found = this.byName.get(key)
      if (found) found.push(i)
      else this.byName.set(key, [i])
    })
  }

  /**
   * The column under this heading, or -1.
   *
   * `nth` exists for one reason: "Status" appears twice on every tab. The first is the three
   * letter code the team works from; the second is a sentence about where the lead got to.
   */
  at(name: string, nth = 0): number {
    const found = this.byName.get(norm(name))
    return found && found.length > nth ? found[nth] : -1
  }

  /** The first of these headings that the tab actually has. For "Rejection reason" / "Reason". */
  either(...names: string[]): number {
    for (const n of names) {
      const i = this.at(n)
      if (i >= 0) return i
    }
    return -1
  }
}

const cell = (row: string[], i: number): string | undefined => (i < 0 ? undefined : row[i])

/* ------------------------------------------------------------------------------ the notes */

/**
 * Everything the spreadsheet knows that Raptor has no column for.
 *
 * Each line names the column it came from. That labelling is the whole point: an import that
 * dumps unlabelled fragments into a notes field produces something nobody can interpret two
 * years later, and getting a label one column out — the second Status column arriving as
 * "Rejection reason" — is a mistake that survives the import and misleads whoever reads it.
 */
function buildNotes(row: string[], c: SheetColumns, messyAmount: string | null): string | null {
  const lines: string[] = []
  const add = (label: string, value: string | null) => { if (value) lines.push(`${label}${value}`) }

  add('', text(cell(row, c.at('Introductory Notes'))))
  if (messyAmount) {
    lines.push(`Handover amount as written: "${messyAmount}" — more than one figure, `
      + `so not imported as a number.`)
  }
  add('Stage on the spreadsheet: ', text(cell(row, c.at('Status', 1))))

  const reasonCol = c.either('Rejection reason', 'Reason')
  const reasonText = text(cell(row, reasonCol))
  // Only where the reason didn't land on a named one — otherwise the note repeats the field.
  if (reasonText && rejectionFor(reasonText) === 'Other') {
    add('Rejection reason as written: ', reasonText)
  }

  add('Referred by: ', text(cell(row, c.at('Referred by'))))
  add('Other contact: ', text(cell(row, c.at('Email/Phone'))))
  add('Location: ', text(cell(row, c.at('Location'))))

  const commission = text(cell(row, c.at('Commission')))
  if (commission) {
    const n = Number(commission)
    // Stored as a fraction where it's a number and as typed where somebody wrote "15% + VAT".
    lines.push(`Commission quoted: ${Number.isFinite(n) && n > 0 && n < 1
      ? `${Number((n * 100).toFixed(4))}%`
      : commission}`)
  }

  const signed = isoDate(cell(row, c.at('Date signed')))
  if (signed) lines.push(`Signed ${signed}`)
  const rejected = isoDate(cell(row, c.at('Date Rejected')))
  if (rejected) lines.push(`Rejected ${rejected}`)

  return lines.length ? lines.join('\n') : null
}

/* ----------------------------------------------------------------------------- the plan */

/** The heading every tab must have. Without it there is no lead to import. */
const REQUIRED_HEADING = 'Client Name'

/**
 * Read the workbook. Writes nothing — this is the half that can be run as often as you like.
 */
export function planLeadsImport(sheets: LeadsSheet[]): LeadsImportPlan {
  const rows: LeadsImportRow[] = []
  const reports: LeadsSheetReport[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  let duplicates = 0
  let messyAmounts = 0
  let unknownCodes = 0

  for (const sheet of sheets) {
    if (sheet.rows.length < 2) {
      reports.push({ name: sheet.name, read: 0, duplicates: 0, skipped: 'no rows' })
      continue
    }
    const columns = new SheetColumns(sheet.rows[0])
    const nameCol = columns.at(REQUIRED_HEADING)
    if (nameCol < 0) {
      const skipped = `no "${REQUIRED_HEADING}" column — this tab is not a leads list`
      reports.push({ name: sheet.name, read: 0, duplicates: 0, skipped })
      warnings.push(`Tab "${sheet.name}" was skipped: ${skipped}.`)
      continue
    }

    const startCol = columns.at('Lead - Start Date')
    const emailCol = columns.at('Email')
    let read = 0
    let dupes = 0

    for (let r = 1; r < sheet.rows.length; r += 1) {
      const row = sheet.rows[r]
      if (!row.some((v) => (v ?? '').trim() !== '')) continue
      read += 1

      const company = named(cell(row, nameCol)) ?? named(cell(row, columns.at('Contact Person')))
      if (!company) continue

      const rawEmail = text(cell(row, emailCol))
      const started = isoDate(cell(row, startCol))
      const key = `${norm(company)}|${norm(rawEmail ?? '')}|${started ?? ''}`
      if (seen.has(key)) { dupes += 1; duplicates += 1; continue }
      seen.add(key)

      const code = (text(cell(row, columns.at('Status'))) ?? '').toLowerCase()
      const { status, known } = statusFor(code)
      if (!known) unknownCodes += 1

      const rawAmount = cell(row, columns.at('Handover Amount'))
      const { value: amount, messy } = oneAmount(rawAmount)
      if (messy) messyAmounts += 1

      const rank = /^([ABCD])$/i.exec((text(cell(row, columns.at('Rank'))) ?? ''))
      const [firstName, lastName] = splitName(text(cell(row, columns.at('Contact Person'))), company)
      const reasonText = text(cell(row, columns.either('Rejection reason', 'Reason')))

      rows.push({
        legacyKey: key,
        firstName,
        lastName,
        companyName: company,
        // A cell holding a phone number under an "Email" heading is not an email address.
        email: rawEmail && rawEmail.includes('@') ? rawEmail : null,
        mobile: text(cell(row, columns.at('Cell'))),
        source: sourceFor(cell(row, columns.at('Source'))),
        status,
        classification: rank ? (rank[1].toUpperCase() as LeadClassification) : null,
        estimatedHandoverAmount: amount,
        estimatedAccountsCount: accountsCount(cell(row, columns.at('No. of Acc.'))),
        industry: text(cell(row, columns.at('Industry'))),
        notes: buildNotes(row, columns, messy ? (rawAmount ?? '').trim() : null),
        sourceMarketer: text(cell(row, columns.at('Marketer'))),
        createdAt: started,
        // Only where the lead was actually turned down. A reason against a live lead is a note.
        rejectionReason: status === 'Rejected' ? rejectionFor(reasonText ?? undefined) : null,
        services: ['Debt Collection'],
        from: { sheet: sheet.name, row: r + 1 },
      })
    }

    reports.push({ name: sheet.name, read, duplicates: dupes, skipped: null })
  }

  if (messyAmounts) {
    warnings.push(`${messyAmounts} handover amounts hold more than one figure and were not `
      + `imported as numbers. Each lead's notes keeps the cell exactly as it was written.`)
  }
  if (unknownCodes) {
    warnings.push(`${unknownCodes} leads have a status code this importer does not recognise `
      + `and come in as "No Contact Yet".`)
  }

  const byStatus: Record<string, number> = {}
  for (const row of rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1

  return {
    rows,
    sheets: reports,
    warnings,
    counts: {
      total: rows.length,
      duplicates,
      withEmail: rows.filter((r) => r.email).length,
      withMobile: rows.filter((r) => r.mobile).length,
      withAmount: rows.filter((r) => r.estimatedHandoverAmount !== null).length,
      withDate: rows.filter((r) => r.createdAt).length,
      amountsNeedingAHuman: messyAmounts,
    },
    byStatus,
  }
}

/**
 * The rows as the database wants them.
 *
 * `score` and `estimated_value` are left to their column defaults: the spreadsheet has no
 * opinion on either, and a made-up score is worse than the default one.
 */
export function leadInsertRows(plan: LeadsImportPlan, ownerId: string): Record<string, unknown>[] {
  return plan.rows.map((r) => ({
    legacy_key: r.legacyKey,
    first_name: r.firstName,
    last_name: r.lastName,
    company_name: r.companyName,
    email: r.email,
    mobile: r.mobile,
    source: r.source,
    status: r.status,
    owner_id: ownerId,
    industry: r.industry,
    classification: r.classification,
    estimated_handover_amount: r.estimatedHandoverAmount,
    estimated_accounts_count: r.estimatedAccountsCount,
    services: r.services,
    notes: r.notes,
    source_marketer: r.sourceMarketer,
    // Where the spreadsheet knows when the lead arrived, that is when it arrived. Otherwise the
    // column default stands, which is now — wrong, but not inventing a date.
    ...(r.createdAt ? { created_at: r.createdAt } : {}),
    rejection_reason: r.rejectionReason,
  }))
}
