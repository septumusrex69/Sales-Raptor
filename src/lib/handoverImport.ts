/**
 * Reading a handover sheet back — whichever sheet it is.
 *
 * THE FIRM: "any import should work on the old import file from Swordfish and from this one that
 * I currently gave you ... I don't know if we have to indicate that it comes from Swordfish or
 * that it's a Raptor template."
 *
 * THE ANSWER IS THAT NOBODY DECLARES IT. The header row already says which sheet it is — every
 * heading either matches a column's current label or one of the headings that used to mean it,
 * and handoverSheet.ts holds both. Asking a person to pick the format is offering them a chance
 * to pick wrong, and picking wrong is silent: on the OLD sheet "Debtor Initials" holds the
 * surname, so a file declared new when it is old puts a surname in the initials column and
 * addresses forty-five notices to nobody. Detected, that cannot happen.
 *
 * WHAT IS SAID OUT LOUD INSTEAD: which sheet was recognised, what every column was mapped onto,
 * and which headings were not recognised at all. A heading nobody claims is REPORTED, never
 * guessed at by position or by similarity — the cost of a wrong guess here is a debtor's
 * telephone number in the ID field, which is precisely what the old sheet did on its own.
 *
 * NOTHING HERE WRITES. This plans; the screen shows the plan; writing is a separate, deliberate
 * act. That is the same shape as the Swordfish migration and for the same reason.
 */
import { HANDOVER_COLUMNS, aliasIndex, headingKey } from './handoverSheet.ts'

export type SheetKind = 'raptor' | 'swordfish' | 'mixed' | 'unknown'

export interface ColumnMatch {
  heading: string
  key: string
  label: string
  /**
   * How the heading was recognised, which is what says WHICH SHEET this is.
   *
   * 'label' — only the current sheet has this heading. 'was' — only an earlier sheet did.
   * 'either' — the heading is evidence of nothing, and there are two ways to be that:
   *
   *   - BOTH SHEETS USE IT. "Date of default" was worth keeping when the sheet was rewritten, so
   *     it appears on the new sheet and on the old one. Counted as current, every old sheet comes
   *     back a "mixture" on that column alone — which is what this was written wrong as first.
   *     Three columns are in this position: the default date, the postal code and occupation.
   *   - IT IS THE COLUMN'S INTERNAL NAME, which no client would type. `client_reference` reduces
   *     to the same thing as the old heading "Client Reference", so testing it first misfiled
   *     every old sheet in a second way.
   */
  via: 'label' | 'was' | 'either'
}

export interface RowProblem {
  level: 'refuse' | 'warn'
  message: string
}

export interface PlannedRow {
  /** The row as a person sees it in Excel: the header is 1, so the first debtor is 2. */
  line: number
  values: Record<string, string | null>
  capital: number | null
  problems: RowProblem[]
  refused: boolean
}

export interface HandoverPlan {
  kind: SheetKind
  /** One sentence for the screen, before anything is written. */
  note: string
  matched: ColumnMatch[]
  /** Headings nobody claimed. Reported, never guessed at. */
  unrecognised: string[]
  /** Required columns the sheet does not have at all. Any one of these refuses the whole file. */
  missingRequired: string[]
  rows: PlannedRow[]
  ready: PlannedRow[]
  refused: PlannedRow[]
  totalCapital: number
}

/* ---------------------------------------------------------------- reading a cell */

/**
 * "R 48 250,00", "48,250.00", "1 234.56" -> a number.
 *
 * THE SPACE IS THE INTERESTING ONE. en-ZA groups thousands with a NON-BREAKING space, so a figure
 * copied out of Raptor and back into a spreadsheet carries U+00A0 between the thousands. In
 * JavaScript `\s` DOES match it — which is worth writing down, because this was first written
 * with U+00A0 listed as well, and a redundant character in a class is the kind of thing a reader
 * removes along with the one that was load-bearing. Narrow this to a literal space and every
 * figure that came out of Raptor stops parsing.
 *
 * A comma is stripped as a separator, not read as a decimal point: a South African sheet that
 * writes 48,250.00 and one that writes 48 250,00 must not disagree by a factor of a hundred, so
 * the LAST separator with two digits after it wins.
 */
export function parseMoney(raw: string | null | undefined): number | null {
  const s = (raw ?? '').replace(/[R\s]/g, '').trim()
  if (!s) return null
  /* A trailing ",00" or ".00" is the decimal; every other separator is grouping. */
  const m = /^(-?)([\d.,]*?)([.,](\d{1,2}))?$/.exec(s)
  if (!m) return null
  const whole = (m[2] ?? '').replace(/[.,]/g, '')
  if (!/^\d+$/.test(whole)) return null
  const n = Number(`${m[1]}${whole}.${(m[4] ?? '0').padEnd(2, '0')}`)
  return Number.isFinite(n) ? n : null
}

/** Excel counts days from 1899-12-30 — the offset absorbs its deliberate 1900 leap-year bug. */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

/**
 * A date, or null, and NEVER a guess between two readings.
 *
 * yyyy-mm-dd and an Excel serial both mean exactly one day. A slash date does not: 02/09/2024 is
 * 9 February to one person and 2 September to another, and nothing downstream can tell which was
 * meant — on a date of default that is the difference between a debt having prescribed and not.
 *
 * So a slash date is read ONLY where it can mean one thing: a first component above twelve can
 * only be a day. Anything still ambiguous comes back as null with the row refused, which is a
 * question asked once rather than a wrong answer written for ever.
 */
export function parseSheetDate(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number.isNaN(Date.parse(s)) ? null : s
  /* An Excel serial. Bounded so a reference number of six digits is not read as a date in 4500. */
  if (/^\d{1,5}(\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s))
    if (n < 1 || n > 80000) return null
    return new Date(EXCEL_EPOCH + n * 86400000).toISOString().slice(0, 10)
  }
  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (slash) {
    const [, a, b, y] = slash
    /* Above twelve it can only be a day; at or below it, the sheet means one of two days and we
       are not going to decide which. */
    if (Number(a) <= 12) return null
    const iso = `${y}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`
    return Number.isNaN(Date.parse(iso)) ? null : iso
  }
  return null
}

/* ---------------------------------------------------------------- the plan */

const REQUIRED = HANDOVER_COLUMNS.filter((c) => c.required)

/**
 * What this file would do, said before it does it.
 *
 * `rows` is the sheet as read — the first is the header. `existingReferences` is what the client
 * already has on the book, so a reference sent twice is caught here rather than opening a second
 * ledger for one debt.
 */
export function planHandover(input: {
  rows: (string | null)[][]
  existingReferences?: Set<string>
  today: string
}): HandoverPlan {
  const index = aliasIndex()
  const header = (input.rows[0] ?? []).map((h) => (h ?? '').trim())
  const matched: ColumnMatch[] = []
  const unrecognised: string[] = []
  /** heading position -> column key, so a row is read by position and named by key. */
  const at = new Map<number, string>()

  header.forEach((heading, i) => {
    if (!heading) return
    const col = index.get(headingKey(heading))
    if (!col) { unrecognised.push(heading); return }
    /* First heading wins a column: a sheet carrying both "Capital on Default" and "Handover
       amount" would otherwise have the second silently overwrite the first. */
    if (matched.some((m) => m.key === col.key)) { unrecognised.push(heading); return }
    at.set(i, col.key)
    const k = headingKey(heading)
    matched.push({
      heading,
      key: col.key,
      label: col.label,
      /* A heading both sheets use says nothing about which one this is — see the note on `via`. */
      via: (() => {
        const isLabel = k === headingKey(col.label)
        const isWas = (col.was ?? []).some((w) => headingKey(w) === k)
        if (isLabel && isWas) return 'either'
        return isLabel ? 'label' : isWas ? 'was' : 'either'
      })(),
    })
  })

  const viaWas = matched.filter((m) => m.via === 'was').length
  const viaLabel = matched.filter((m) => m.via === 'label').length
  const kind: SheetKind = matched.length === 0 ? 'unknown'
    : viaWas === 0 ? 'raptor'
      : viaLabel === 0 ? 'swordfish'
        : 'mixed'

  const missingRequired = REQUIRED
    .filter((c) => !matched.some((m) => m.key === c.key))
    .map((c) => c.label)

  const note = {
    raptor: `This is the firm's own handover sheet. ${matched.length} columns recognised.`,
    swordfish: `This is the older sheet. All ${matched.length} columns were recognised and mapped `
      + 'to what they mean now — nothing needs changing on the client’s side.',
    mixed: `A mixture of headings from both sheets. ${viaLabel} read as the current sheet and `
      + `${viaWas} as the older one; check the mapping below before importing.`,
    unknown: 'No heading in this file was recognised. Either it is not a handover sheet, or the '
      + 'header row is not the first row.',
  }[kind]

  const seen = new Set<string>()
  const rows: PlannedRow[] = []
  for (let r = 1; r < input.rows.length; r += 1) {
    const raw = input.rows[r] ?? []
    /* A wholly empty line is the blank rows under the data, not a debtor with nothing filled in. */
    if (raw.every((c) => (c ?? '').trim() === '')) continue
    const values: Record<string, string | null> = {}
    for (const [i, key] of at) values[key] = (raw[i] ?? '').trim() || null
    rows.push(readRow(values, r + 1, { seen, existing: input.existingReferences, today: input.today }))
  }

  const refused = rows.filter((x) => x.refused)
  const ready = rows.filter((x) => !x.refused)
  return {
    kind,
    note,
    matched,
    unrecognised,
    missingRequired,
    rows,
    ready,
    refused,
    totalCapital: ready.reduce((t, x) => t + (x.capital ?? 0), 0),
  }
}

/**
 * One row, judged.
 *
 * REFUSE AND WARN ARE DIFFERENT THINGS AND THE LINE BETWEEN THEM IS NOT TASTE. A refusal is
 * something that cannot open a correct ledger — no name to address, no capital to owe, no date
 * for in duplum to run from. A warning is something the firm can work without and would rather
 * know: an ID that is not an ID, a debtor with no telephone number, nowhere to post a section
 * 129. A warning that refused the row would stop a client handing over work; a refusal demoted
 * to a warning would open a ledger that is wrong for ever.
 */
function readRow(
  values: Record<string, string | null>,
  line: number,
  ctx: { seen: Set<string>; existing?: Set<string>; today: string },
): PlannedRow {
  const problems: RowProblem[] = []
  const refuse = (message: string) => problems.push({ level: 'refuse', message })
  const warn = (message: string) => problems.push({ level: 'warn', message })

  if (!values.name) refuse('No surname or business name — every letter is addressed from it.')

  const capital = parseMoney(values.capital)
  if (capital === null) {
    refuse(values.capital ? `Handover amount "${values.capital}" is not a number.` : 'No handover amount.')
  } else if (capital <= 0) {
    refuse('The handover amount is nought or less.')
  }

  const defaulted = parseSheetDate(values.default_date)
  if (!defaulted) {
    refuse(values.default_date
      /* Named as the ambiguity it is, because "invalid date" sends somebody to check a date that
         is perfectly valid and merely means two things. */
      ? `Date of default "${values.default_date}" could be two different days. Write it as `
        + 'yyyy-mm-dd.'
      : 'No date of default — in duplum runs from it.')
  } else if (defaulted > ctx.today) {
    warn('The date of default is in the future.')
  }

  const ref = values.client_reference
  if (!ref) {
    refuse('No reference. It is what the debtor is told to quote when they pay.')
  } else if (ctx.seen.has(ref)) {
    refuse(`Reference ${ref} appears twice in this file.`)
  } else {
    ctx.seen.add(ref)
    if (ctx.existing?.has(ref)) refuse(`Reference ${ref} is already on this client's book.`)
  }

  if (values.debtor_kind && !/^(person|business)$/i.test(values.debtor_kind)) {
    warn(`"${values.debtor_kind}" is neither Person nor Business; it will be read as a person.`)
  }

  /*
   * THE ID IS A WARNING AND NOT A REFUSAL, and the old sheet is the argument. Every one of its 45
   * rows had a cell phone in the ID column: refusing would have refused the whole book, and the
   * firm would have turned the check off. Named on the row, it gets fixed.
   */
  const id = values.id_number
  if (id && !/^\d{13}$/.test(id.replace(/\s/g, ''))) {
    warn(`"${id}" is not a 13-digit ID number. Left empty rather than guessed at.`)
  }

  const paid = values.last_payment_date
  if (paid && !parseSheetDate(paid)) warn(`Last date of payment "${paid}" could not be read.`)

  if (!values.cell_1 && !values.home_phone && !values.work_phone && !values.email_1) {
    warn('No telephone number and no email address — nobody can be contacted.')
  }
  if (!values.street_1) warn('No street address — a section 129 cannot be posted.')

  return { line, values, capital, problems, refused: problems.some((p) => p.level === 'refuse') }
}
