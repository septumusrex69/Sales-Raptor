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
    /** Figures worked out from a range or a list rather than read straight off the cell. */
    amountsEstimated: number
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
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  /*
   * A year nobody meant. The workbook has a sign date typed as "0206/07/27" — 2026 with the
   * digits transposed — and without this it came through as a lead signed in the third century,
   * which sorts to the top of every list and reads as a bug in Raptor rather than a typo in a
   * cell. Anything outside living memory and the near future is somebody's slip.
   */
  if (year < 1990 || year > 2100) return null
  const date = new Date(Date.UTC(Number(y), month - 1, day))
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString().slice(0, 10)
}

/** Money, grouped the way South Africans write it, for a sentence on the lead. */
function rands(n: number): string {
  return `R${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`
}

/**
 * A number out of a cell that holds one, after the ways people write "about".
 *
 * "35 000+-", "40 000~", "Minimum 40 000", "8.5 m" and "17k" are all one figure with something
 * around it. None of them change what the figure is. Anything else — a dollar sign, a second
 * figure, a word — is not a number and comes back as nothing.
 */
export function loneAmount(part: string | undefined): number | null {
  let s = (part ?? '').trim()
    .replace(/^(minimum|min|approx\.?|approximately|about|circa|ca\.?|around|over|est\.?)\s+/i, '')
    .replace(/[~±]|\+-/g, '')
    // "100 000+" is at least a hundred thousand. Taking the figure is the conservative reading,
    // and the only one that does not invent a ceiling nobody wrote down.
    .replace(/\+$/, '')
    .trim()

  // 8.5m / 17k / 2 mil. The suffix multiplies; anything else with letters in it is not a number.
  const suffix = /^(.*?)\s*(k|m|mil|million)$/i.exec(s)
  let scale = 1
  if (suffix) {
    s = suffix[1].trim()
    scale = /^k$/i.test(suffix[2]) ? 1_000 : 1_000_000
  }

  /*
   * A comma is two different things in this book. In "1,300 000" it groups thousands, the same
   * as the space beside it. In "11 100,2800" it separates two amounts. The tell is the grouping:
   * every run after the first is exactly three digits, or it is not a grouped number at all.
   *
   *   is the non-breaking space Excel leaves behind when a number is pasted from elsewhere.
   */
  const cleaned = s.replace(/^R\s*/i, '').trim()
  const m = /^(\d{1,3}(?:[,\s\u00a0]\d{3})+|\d+)([.,]\d{1,2})?$/.exec(cleaned)
  if (!m) return null

  const whole = m[1].replace(/[,\s\u00a0]/g, '')
  const frac = (m[2] ?? '').replace(',', '.')
  const value = Number(whole + frac)
  return Number.isFinite(value) ? value * scale : null
}

/** "1 000-100 000" as its two ends, or nothing. */
function asRange(part: string): [number, number] | null {
  const m = /^(.+?)\s*[-–]\s*(.+)$/.exec(part.trim())
  if (!m) return null
  const low = loneAmount(m[1])
  const high = loneAmount(m[2])
  if (low === null || high === null || high < low) return null
  return [low, high]
}

export interface AmountReading {
  value: number | null
  /** How the figure was reached, for the lead's own notes. Null when the cell held one amount. */
  basis: string | null
}

/**
 * What the handover is worth, out of a cell that says it three different ways.
 *
 * 192 of the 1,818 cells hold more than one figure, and they do not all mean the same thing.
 * The notes the sales team wrote beside them settle it:
 *
 *   A DASH IS THE SIZE OF ONE ACCOUNT, not the size of the book. "20 acc from 500- 2 000" says
 *   so outright, and so does "Outstanding debt will range from R 1000 to R 20 000" against a
 *   count of two. So a range becomes the middle of itself, multiplied by however many accounts
 *   there are. Without that multiplication a 144-account book comes in at thirty thousand rand.
 *
 *   AN AMPERSAND OR A PLUS IS SEPARATE ACCOUNTS, and the handover is their total. "1500+2500"
 *   against a count of two is "two jobs two different people"; "60 000+30 000" against two is
 *   "2 rentals". Those are added, and NOT multiplied by anything — the figures already are the
 *   accounts, and multiplying would count them twice.
 *
 * WHAT IT STILL WILL NOT DO IS GUESS. A cell in dollars, a figure with a second one bracketed
 * inside it, "50 000-21.M" — those are left empty with their own words kept, because no reading
 * of them is obviously right and a wrong number is worse than a missing one.
 *
 * Any figure that is not simply the cell's own contents carries `basis`, a sentence saying how it
 * was reached, which goes onto the lead. Nobody should find a number in Raptor that is not in the
 * spreadsheet without being told where it came from.
 */
export function readAmount(raw: string | undefined, accounts: number | null): AmountReading {
  const s = (raw ?? '').trim()
  if (s === '' || s === '-') return { value: null, basis: null }

  // One plain figure, however it was decorated. Much the commonest case, and it says nothing.
  const single = loneAmount(s)
  if (single !== null) return { value: single, basis: null }

  // A range on its own: the size of one account, so the book is that times however many.
  const range = asRange(s)
  if (range) {
    const middle = (range[0] + range[1]) / 2
    const many = accounts && accounts > 1 ? accounts : 1
    const value = Math.round(middle * many)
    return {
      value,
      basis: many > 1
        ? `Handover estimated at ${rands(value)}: the spreadsheet said "${s}" per account across `
          + `${many} accounts, so this is the middle of that range times ${many}.`
        : `Handover estimated at ${rands(value)}: the spreadsheet said "${s}", so this is the `
          + `middle of that range.`,
    }
  }

  /*
   * A list — separate accounts, added up. Split on the separators people actually used, then
   * allow each part to be an amount or a range of its own ("8 000&1000-3000"). The comma is only
   * a separator where it is not grouping thousands.
   */
  const parts = s.split(/[&+/]|\band\b|,(?!\d{3}(?:\D|$))/i).map((p) => p.trim()).filter(Boolean)
  if (parts.length > 1) {
    let total = 0
    for (const part of parts) {
      const one = loneAmount(part)
      if (one !== null) { total += one; continue }
      const r = asRange(part)
      if (!r) return { value: null, basis: null }
      total += (r[0] + r[1]) / 2
    }
    const value = Math.round(total)
    return {
      value,
      basis: `Handover ${rands(value)}: the spreadsheet said "${s}" — ${parts.length} separate `
        + `amounts, added together.`,
    }
  }

  return { value: null, basis: null }
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

/**
 * A phone number that can actually be dialled.
 *
 * Excel stores a number typed as digits as a NUMBER, and a number has no leading zero. So a
 * mobile entered as 0825550182 comes back as 825550182 — nine digits, and useless: dial it and
 * nothing happens. It is 627 of the 1,706 numbers in the leads workbook, more than a third of
 * the book, and the only symptom is a collector saying the number does not work.
 *
 * Nine digits is the tell, and it is unambiguous: no South African number is nine digits long.
 * Local ones are ten with the zero, and an international one carries its country code and is
 * longer — 263 774 555 012 is a real Zimbabwean number in this book and is left alone, as is
 * anything that already starts with a zero or a plus.
 *
 * Spacing is kept exactly as somebody typed it. This restores a digit Excel removed; it does not
 * tidy anybody's formatting.
 */
export function phoneNumber(v: string | undefined): string | null {
  const s = text(v)
  if (!s) return null
  const digits = s.replace(/\D/g, '')
  // "No number", "n/a", "ask reception" — a phone field with no phone in it.
  if (digits === '') return null
  if (digits.length === 9 && !s.trim().startsWith('+')) return `0${s.trim()}`
  return s
}

/**
 * How many accounts.
 *
 * "12", "12.0" and "12 accounts" all mean twelve, and "20-30" and "10+" both mean twenty and ten
 * — the lower end, which is the figure somebody actually committed to.
 *
 * THE SPACE MATTERS. A count is written "2 000" as readily as an amount is, and reading only the
 * first run of digits turned a two-thousand-account medical practice into a two-account one.
 * That count multiplies a range into a handover value, so being out by a thousand there is out
 * by a thousand on the value of the lead.
 */
function accountsCount(v: string | undefined): number | null {
  const s = (v ?? '').trim().replace(/\.0$/, '')
  if (s === '' || s === '-') return null
  const m = /^\s*(\d[\d\s\u00a0]*)/.exec(s)
  if (!m) return null
  const n = Number(m[1].replace(/[\s\u00a0]/g, ''))
  return Number.isFinite(n) ? n : null
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

/**
 * Raptor's own words for the same thing.
 *
 * The cleaned sheet writes "Converted" where the original writes "Clo", because a sheet somebody
 * is being asked to check should say what it means. Reading both back means the tidy sheet and
 * the firm's own workbook are interchangeable, and a person correcting a status in Excel can
 * write either one.
 */
const STATUS_WORDS: LeadStatus[] = ['No Contact Yet', 'Interested', 'Hot Lead', 'Converted', 'Rejected']

export function statusFor(code: string | undefined): { status: LeadStatus; known: boolean } {
  const key = (code ?? '').trim().toLowerCase()
  const found = STATUS_CODES[key]
  if (found) return { status: found, known: true }
  const word = STATUS_WORDS.find((w) => w.toLowerCase() === key)
  if (word) return { status: word, known: true }
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
function buildNotes(row: string[], c: SheetColumns, amount: AmountReading & { raw: string }): string | null {
  const lines: string[] = []
  const add = (label: string, value: string | null) => { if (value) lines.push(`${label}${value}`) }

  add('', text(cell(row, c.at('Introductory Notes'))))
  /*
   * The cell's own words, wherever they are.
   *
   * In the firm's workbook they are in the Handover Amount cell itself, which is why it did not
   * parse. On the tidy sheet that cell holds a number or nothing and the original wording sits
   * in a column beside it, so somebody can put one figure in without losing what was there. Read
   * both, or the tidy sheet would be the one version of this file that quietly drops it.
   */
  /*
   * Where the figure is not simply what the cell said, the lead says so. Three ways in:
   *
   * A range or a list read straight off the firm's own workbook explains itself in full.
   *
   * A tidied sheet has already done that arithmetic, so its Handover Amount column holds a plain
   * number and the cell's original wording sits in a column beside it. Without this, 172 worked-
   * out figures would arrive looking exactly like quoted ones — which is the whole thing this
   * was meant to prevent.
   *
   * And a cell nobody could read keeps its own words and no number.
   */
  const asWritten = text(cell(row, c.at('Handover Amount as written')))
  if (amount.basis) {
    lines.push(amount.basis)
  } else if (amount.value !== null) {
    if (asWritten) {
      lines.push(`Handover amount ${rands(amount.value)}. The spreadsheet had `
        + `"${asWritten}" — this figure was worked out from it, not quoted.`)
    }
  } else {
    const unread = (amount.raw !== '' && amount.raw !== '-' ? amount.raw : null) ?? asWritten
    if (unread) {
      lines.push(`Handover amount as written: "${unread}" — no reading of it is obviously `
        + `right, so it was left for a person rather than guessed at.`)
    }
  }
  add('Stage on the spreadsheet: ',
    text(cell(row, c.at('Status', 1))) ?? text(cell(row, c.at('Stage'))))

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
 * Headings a leads list has. Used only to tell a renamed leads tab — worth shouting about —
 * from a covering note, which is not.
 */
const KNOWN_HEADINGS = [
  'Status', 'Lead - Start Date', 'Source', 'Marketer', 'Rank', 'Handover Amount', 'Commission',
  'No. of Acc.', 'Industry', 'Contact Person', 'Email', 'Cell', 'Location', 'Date signed',
  'Introductory Notes',
]

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
  let estimated = 0
  let unknownCodes = 0

  for (const sheet of sheets) {
    if (sheet.rows.length < 2) {
      reports.push({ name: sheet.name, read: 0, duplicates: 0, skipped: 'no rows' })
      continue
    }
    const columns = new SheetColumns(sheet.rows[0])
    const nameCol = columns.at(REQUIRED_HEADING)
    if (nameCol < 0) {
      /*
       * Two different things, and only one is worth interrupting somebody about.
       *
       * A tab carrying Handover Amount, Rank, Industry and no Client Name is a leads list that
       * has had its key column renamed, and importing the workbook without it would lose a
       * month quietly. That is a warning.
       *
       * A tab that is a covering note, or a summary, has none of those headings and was never
       * going to be a leads list. Warning about it trains people to ignore the warnings.
       */
      const looksLikeLeads = KNOWN_HEADINGS.filter((h) => columns.at(h) >= 0).length >= 3
      const skipped = looksLikeLeads
        ? `no "${REQUIRED_HEADING}" column, but this looks like a leads list — has it been renamed?`
        : 'not a leads list'
      reports.push({ name: sheet.name, read: 0, duplicates: 0, skipped })
      if (looksLikeLeads) warnings.push(`Tab "${sheet.name}" was skipped: ${skipped}`)
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

      const counted = accountsCount(cell(row, columns.at('No. of Acc.')))
      const rawAmount = (cell(row, columns.at('Handover Amount')) ?? '').trim()
      const reading = readAmount(rawAmount, counted)
      const amount = reading.value
      // Only the cells nobody could read. A range turned into a figure is not one of them.
      if (amount === null && rawAmount !== '' && rawAmount !== '-') messyAmounts += 1
      if (reading.basis) estimated += 1

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
        mobile: phoneNumber(cell(row, columns.at('Cell'))),
        source: sourceFor(cell(row, columns.at('Source'))),
        status,
        classification: rank ? (rank[1].toUpperCase() as LeadClassification) : null,
        estimatedHandoverAmount: amount,
        estimatedAccountsCount: counted,
        industry: text(cell(row, columns.at('Industry'))),
        notes: buildNotes(row, columns, { ...reading, raw: rawAmount }),
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

  if (estimated) {
    warnings.push(`${estimated} handover amounts were written as a range or as several amounts. `
      + `A range is the size of one account, so it becomes the middle of that range times the `
      + `number of accounts; several amounts are added up. Each lead's notes says which was done `
      + `and quotes the cell.`)
  }
  if (messyAmounts) {
    warnings.push(`${messyAmounts} handover amounts could not be read as a figure at all — a `
      + `foreign currency, or a figure with another one bracketed inside it. Those are empty, `
      + `with the cell kept word for word in the lead's notes.`)
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
      amountsEstimated: estimated,
    },
    byStatus,
  }
}

/* ------------------------------------------------------------------------ who worked them */

/** One person named in the Marketer column, and how much of the book they touched. */
export interface MarketerCredit {
  /** The spelling to show, which is whichever one the spreadsheet used most often. */
  name: string
  /** Every spelling that resolved to this person, so an odd one is visible rather than hidden. */
  spellings: string[]
  /** Leads naming them, alone or alongside somebody else. */
  leads: number
  /** Of those, the ones they share with somebody else. */
  shared: number
  /** Leads where they are named first, which is what decides who the lead lands on. */
  owns: number
}

/**
 * The people named in the Marketer column, split out of the cells that name several.
 *
 * Three years of a shared spreadsheet produce forty-two distinct spellings of eight people.
 * "Barend/Destiny", "Felicia / Barend" and "Barend/ Stephan/ Zian / Destiny" are all several
 * people in one cell; "zian" and "Barend/felicia" are the same people in lower case.
 *
 * WHAT THIS DOES NOT DO IS CORRECT ANYBODY'S SPELLING. "Baren/Ruben" and "BarendRuben" are
 * almost certainly Barend, but almost is not a basis for reassigning somebody's work. They come
 * back as their own names, carrying one lead each, where they are visible on the screen and
 * somebody who knows can say so. Guessing would move a lead onto a person quietly and there
 * would be nothing on the screen to notice.
 */
export function splitMarketers(cell: string | null): string[] {
  if (!cell) return []
  return cell.split('/').map((s) => s.trim()).filter(Boolean)
}

/** Case-insensitively the same person. Used to gather spellings, never to correct them. */
const samePerson = (name: string): string => name.toLowerCase().replace(/\s+/g, ' ')

export function marketerCredits(plan: LeadsImportPlan): MarketerCredit[] {
  const found = new Map<string, {
    spellings: Map<string, number>; leads: number; shared: number; owns: number
  }>()

  for (const row of plan.rows) {
    const named = splitMarketers(row.sourceMarketer)
    named.forEach((name, i) => {
      const key = samePerson(name)
      const entry = found.get(key) ?? { spellings: new Map(), leads: 0, shared: 0, owns: 0 }
      entry.spellings.set(name, (entry.spellings.get(name) ?? 0) + 1)
      entry.leads += 1
      if (named.length > 1) entry.shared += 1
      if (i === 0) entry.owns += 1
      found.set(key, entry)
    })
  }

  return [...found.values()]
    .map((e) => ({
      // The commonest spelling wins the label: it is the one the firm will recognise.
      name: [...e.spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      spellings: [...e.spellings.keys()].sort(),
      leads: e.leads,
      shared: e.shared,
      owns: e.owns,
    }))
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name))
}

/** Who each lead lands on: a Raptor user per marketer, and somebody for everything else. */
export interface LeadOwners {
  /** Used for a lead whose marketer is blank, or is not mapped to anybody. */
  fallback: string
  /** Marketer name (any spelling) to a Raptor user id. */
  byMarketer?: Record<string, string>
}

/**
 * Whose lead it is.
 *
 * The first person named owns it. Where two people worked one lead the spreadsheet writes them
 * in the order they were involved, and a lead has one owner — but nothing is lost by choosing,
 * because source_marketer keeps the cell exactly as it was written, both names and all.
 */
export function ownerFor(row: LeadsImportRow, owners: LeadOwners): string {
  // Keyed case-insensitively at both ends: the screen offers "Nomsa" and the spreadsheet also
  // says "nomsa", and which of the two somebody happened to map should not decide anything.
  const map = new Map(
    Object.entries(owners.byMarketer ?? {}).map(([name, id]) => [samePerson(name), id]),
  )
  for (const name of splitMarketers(row.sourceMarketer)) {
    const found = map.get(samePerson(name))
    if (found) return found
  }
  return owners.fallback
}

/**
 * The rows as the database wants them.
 *
 * `score` and `estimated_value` are left to their column defaults: the spreadsheet has no
 * opinion on either, and a made-up score is worse than the default one.
 */
export function leadInsertRows(
  plan: LeadsImportPlan,
  owners: LeadOwners | string,
  /**
   * For the handful of leads whose start date the spreadsheet never had. Passed in rather than
   * read from the clock so this function stays pure and the tests stay deterministic.
   */
  undated: string = new Date().toISOString(),
): Record<string, unknown>[] {
  const resolved: LeadOwners = typeof owners === 'string' ? { fallback: owners } : owners
  return plan.rows.map((r) => ({
    legacy_key: r.legacyKey,
    first_name: r.firstName,
    last_name: r.lastName,
    company_name: r.companyName,
    email: r.email,
    mobile: r.mobile,
    source: r.source,
    status: r.status,
    owner_id: ownerFor(r, resolved),
    industry: r.industry,
    classification: r.classification,
    estimated_handover_amount: r.estimatedHandoverAmount,
    estimated_accounts_count: r.estimatedAccountsCount,
    services: r.services,
    notes: r.notes,
    source_marketer: r.sourceMarketer,
    /*
     * ALWAYS PRESENT, even when there is no date — and that is the whole point of the line.
     *
     * This used to spread the key in only when the spreadsheet had a date, leaving the column
     * default (now()) to cover the rest. That reads correctly and is wrong, because these rows
     * are written in bulk: PostgREST takes the union of the keys across the batch and fills
     * every row that lacks one with NULL, not with the default. created_at is NOT NULL, so the
     * three undated leads in a book of 1,818 killed the insert — and killed it a thousand rows
     * in, because that is where the first of them happened to sit.
     *
     * An optional key in a bulk write is a landmine generally, which is why the tests now assert
     * that every row carries exactly the same keys rather than only checking this one.
     *
     * The value for an undated lead is the current time, which is what the column default would
     * have given it anyway. It is not a real date and nothing pretends it is.
     */
    created_at: r.createdAt ?? undated,
    rejection_reason: r.rejectionReason,
  }))
}
