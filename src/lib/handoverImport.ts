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
import { HANDOVER_COLUMNS, aliasIndex, headingKey, type HandoverColumn } from './handoverSheet.ts'
/* The same ID check the by-hand form uses. Two implementations of a Luhn checksum eventually
   disagree, and the one that disagrees is whichever a person is not looking at. */
import { isValidSaId, type NewDebtorInput } from './newDebtor.ts'

/* ---------------------------------------------------------------- what a field should look like */

/**
 * AN EMAIL ADDRESS, checked for the shape that stops it being deliverable rather than against
 * the RFC.
 *
 * A pattern strict enough to be correct rejects addresses that work, and an address rejected here
 * is a debtor the firm then cannot email at all. So: something, an @, something with a dot in it,
 * no spaces. What that catches is the real failure -- two addresses in one cell, a name where an
 * address should be, a trailing comma from a copy-paste.
 */
export const looksLikeEmail = (v: string): boolean =>
  /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i.test(v.trim())

/**
 * A South African telephone number.
 *
 * NINE DIGITS IS THE INTERESTING CASE and it is why this exists: 40 of 42 "Cell Phone 2" values in
 * the firm's own import file were nine digits, because Excel read 0129403445 as a number and
 * dropped the leading zero. Those numbers cannot be dialled, and nothing said so. A nine-digit
 * number is reported as exactly that rather than as "invalid", because the fix is to put the zero
 * back and the person needs to be told which zero.
 */
export type PhoneVerdict = 'ok' | 'lost-leading-zero' | 'wrong'

export function checkPhone(raw: string): PhoneVerdict {
  const s = raw.replace(/[\s()\-.]/g, '')
  if (/^\+27\d{9}$/.test(s)) return 'ok'
  if (/^0\d{9}$/.test(s)) return 'ok'
  /* Nine digits and no leading zero: Excel ate it. The first digit of a South African number
     after the zero is 1-8, which is what separates this from a short number typed wrong. */
  if (/^[1-8]\d{8}$/.test(s)) return 'lost-leading-zero'
  return 'wrong'
}

/** Case, spacing and punctuation removed, so "van der Westhuizen" and "Van Der Westhuizen" meet. */
const fold = (v: string | null | undefined) => (v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * The two ways one debt is recognised as another, and why it is only ever a WARNING.
 *
 * BOTH OF THEM NEED THE AMOUNT, and that is the firm's correction: "it is also possible for the
 * same debtor to be handed over twice ... the same ID number. You can create something called a
 * linked account." An ID arriving again is a person with a SECOND DEBT far more often than it is
 * a mistake, so the same ID for a different amount is not a duplicate at all — it is two
 * accounts for one debtor, which is what sameDebtor.ts is for and what the account page shows.
 *
 * WHAT IS LEFT IS THE SAME DEBT TWICE: one identifier, one figure. The identifier is an ID number
 * where there is one and a surname where there is not, because the sheet the firm actually sent
 * has no ID numbers at all — an ID-only rule would have found nothing on the only real file we
 * have. The amount alone is worthless in the other direction too: in that same file fourteen
 * accounts are for exactly R380.
 *
 * NEITHER REFUSES. The firm asked to be told, not stopped: "accept or discard".
 */
function signaturesOf(
  values: { id_number?: string | null; name?: string | null }, capital: number | null,
): string[] {
  /* No amount, nothing to compare: a row with no capital is already refused for that. */
  if (capital === null) return []
  const amount = capital.toFixed(2)
  const id = fold(values.id_number)
  /* Thirteen digits, because on the old sheet this column held a telephone number in every row --
     matching on those would report 45 duplicates of nothing. */
  if (id.length === 13) return [`id:${id}:${amount}`]
  const name = fold(values.name)
  return name ? [`name:${name}:${amount}`] : []
}

/**
 * A date as South Africa writes it, for showing back to a person.
 *
 * THE FIRM, looking at the draft table: "this date of default that it says is wrong, it's
 * actually in the right way -- first day, then month, then year. This is how we do it in South
 * Africa. So everything else is wrong, to be honest."
 *
 * And they were right about everything else. The table printed the raw cell, and `readXlsxRows`
 * renders a date cell as yyyy/mm/dd -- "the shape Swordfish's own exports use". So a sheet the
 * firm fills in day-first, read correctly, judged correctly, was displayed back to them
 * year-first: the app showing its own reader's internal format to the people whose convention the
 * whole file is built around.
 *
 * UNPARSEABLE COMES BACK UNTOUCHED, which is the other half of it. The one row they were
 * complaining about says 31/02/2026, and it has to keep saying that -- it is what the sheet
 * holds, it is what somebody has to correct, and reformatting it would hide the very thing that
 * is wrong with it.
 */
/**
 * WHY a date could not be read, which is not the same question as whether it could.
 *
 * THE FIRM, on "31/02/2026": "this date of default that it says is wrong, it's actually in the
 * right way -- first day, then month, then year." They are right, and the message told them
 * otherwise: it said the file's ORDER could not account for the date, which reads as Raptor not
 * understanding day/month/year. The actual problem is that February has no 31st, and saying so
 * is the difference between somebody checking their date and somebody checking our importer.
 *
 * Both cases really exist and they need opposite fixes, which is why they are told apart:
 * 31/02/2026 is a typo in the cell, 03/13/2026 is a file written the other way round.
 */
export type DateFault = 'ok' | 'empty' | 'no-such-day' | 'wrong-order' | 'unreadable'

export function dateFault(raw: string | null | undefined, order: DateOrder): DateFault {
  const s = (raw ?? '').trim()
  if (!s) return 'empty'
  if (parseSheetDate(s, order)) return 'ok'

  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (slash) {
    const [, a, b] = slash
    const [d, mo] = order === 'day-first' ? [a, b] : [b, a]
    /* A month outside 1-12 under this order is a file written the other way round -- and reading
       it the other way is a real date, which is what makes it worth saying so. */
    if (Number(mo) < 1 || Number(mo) > 12) return 'wrong-order'
    /* The order accounts for it and the day still does not exist: 31 February, 31 April. */
    if (Number(d) >= 1 && Number(d) <= 31) return 'no-such-day'
  }
  const ymd = /^(\d{4})[/.-](\d{2})[/.-](\d{2})$/.exec(s)
  if (ymd) return 'no-such-day'
  return 'unreadable'
}

/** The name of a month, for saying "there is no 31st of February" in those words. */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

/** The day and month somebody typed, as words. Null where it is not a date-shaped thing. */
export function spellDate(raw: string, order: DateOrder): string | null {
  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{4}$/.exec(raw.trim())
  if (slash) {
    const [, a, b] = slash
    const [d, mo] = order === 'day-first' ? [a, b] : [b, a]
    const name = MONTHS[Number(mo) - 1]
    return name ? `${Number(d)} ${name}` : null
  }
  const ymd = /^\d{4}[/.-](\d{2})[/.-](\d{2})$/.exec(raw.trim())
  if (ymd) {
    const name = MONTHS[Number(ymd[1]) - 1]
    return name ? `${Number(ymd[2])} ${name}` : null
  }
  return null
}

export function displayDate(raw: string | null | undefined, order: DateOrder = 'day-first'): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  const iso = parseSheetDate(s, order)
  if (!iso) return s
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

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
  /**
   * The column it is about, where it is about one.
   *
   * THE FIRM: "it should show which data is wrong." A list of sentences under a forty-column
   * table is a list nobody can trace back to a cell — the row number says which line and nothing
   * says which box. Null where the problem belongs to the row rather than to a field, such as a
   * reference that appears twice.
   */
  key: string | null
}

/**
 * An account already on this client's book, reduced to what a duplicate is recognised by.
 *
 * THE FIRM: "it's possible that a client can put the same data twice on the same sheet, or that
 * the same data has already been handed over for the same amount. So it should flag it and tell
 * you: here's a possible duplicate handover, accept or discard."
 */
export interface ExistingAccount {
  reference: string | null
  idNumber: string | null
  name: string | null
  capital: number | null
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
  /** Which way round this file writes a text date, and whether it proved it. */
  dates: { order: DateOrder; proven: boolean; contradictory: boolean }
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

export type DateOrder = 'day-first' | 'month-first'

/**
 * Which way round a file writes its dates, decided ONCE from the whole file.
 *
 * THE FIRM: "South Africa reads the dates first the day, then the month, then the year." So
 * day-first is the answer unless the file itself proves otherwise — and a file can prove it,
 * because a component above twelve can only be one thing. 18/03/2026 can only be a day first;
 * 03/18/2026 can only be a month first.
 *
 * DECIDED FOR THE FILE AND NOT FOR THE ROW, which is the part that matters. Reading each row on
 * its own, a sheet written by an American-locale machine would come out with most rows read
 * day-first and the handful containing a day above twelve read month-first — every one of them
 * plausible, the file internally inconsistent, and nothing reporting it. One order, applied
 * throughout, is either right or visibly wrong.
 *
 * A file that proves BOTH is contradictory and is reported rather than resolved: something has
 * been pasted into it from somewhere else, and no order is safe.
 */
export function detectDateOrder(samples: (string | null | undefined)[]): {
  order: DateOrder
  /** True where the file contains dates that prove both orders. Nothing can be read safely. */
  contradictory: boolean
  /** True where the file proved its order rather than falling back to the South African default. */
  proven: boolean
} {
  let day = false
  let month = false
  for (const raw of samples) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{4}$/.exec((raw ?? '').trim())
    if (!m) continue
    if (Number(m[1]) > 12) day = true
    if (Number(m[2]) > 12) month = true
  }
  if (day && month) return { order: 'day-first', contradictory: true, proven: false }
  if (month) return { order: 'month-first', contradictory: false, proven: true }
  return { order: 'day-first', contradictory: false, proven: day }
}

/**
 * A date, or null.
 *
 * yyyy-mm-dd and an Excel serial each mean exactly one day and are read as they are — and the
 * serial is the ordinary case, because a date-formatted cell stores a number and the dd/mm/yyyy
 * the person sees is only how it is drawn.
 *
 * A YEAR-FIRST DATE IS TAKEN WITH ANY SEPARATOR, and this is not a nicety. `readXlsxRows` — the
 * reader this importer's own screen feeds it from — renders every date cell as yyyy/mm/dd,
 * "the shape Swordfish's own exports use". Matching only the hyphen refused every date in every
 * .xlsx that reached it: on the client sheet we were sent, 45 accounts out of 45 refused on a
 * date of default that had been read correctly out of the file and then not recognised. Nothing
 * about a four-digit leading component is ambiguous, so no order question arises.
 *
 * A slash date is TEXT, which happens when a sheet is saved as CSV or when somebody types into a
 * column that is not formatted as a date. It is read in the order the FILE uses — see
 * detectDateOrder — which is day-first for South Africa unless the file proves otherwise.
 */
export function parseSheetDate(
  raw: string | null | undefined, order: DateOrder = 'day-first',
): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const ymd = /^(\d{4})[/.-](\d{2})[/.-](\d{2})$/.exec(s)
  if (ymd) {
    const iso = `${ymd[1]}-${ymd[2]}-${ymd[3]}`
    if (Number.isNaN(Date.parse(iso))) return null
    /* 2026-02-31 parses and rolls into March, same as the slash branch below. */
    return iso.slice(8) === String(new Date(iso).getUTCDate()).padStart(2, '0') ? iso : null
  }
  /* An Excel serial. Bounded so a reference number of six digits is not read as a date in 4500. */
  if (/^\d{1,5}(\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s))
    if (n < 1 || n > 80000) return null
    return new Date(EXCEL_EPOCH + n * 86400000).toISOString().slice(0, 10)
  }
  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (slash) {
    const [, a, b, y] = slash
    const [d, mo] = order === 'day-first' ? [a, b] : [b, a]
    /* A component the chosen order cannot account for: 13 as a month, or 32 as a day. Refused
       rather than wrapped round, because a wrapped date is a wrong date that looks like a date. */
    if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null
    const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
    if (Number.isNaN(Date.parse(iso))) return null
    /* Date.parse accepts 31 February and rolls it into March. A day that does not exist in its
       month is a typo, not a date. */
    return iso.slice(8) === String(new Date(iso).getUTCDate()).padStart(2, '0') ? iso : null
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
  /** What is already on this client's book, for the duplicate warning. */
  existingAccounts?: ExistingAccount[]
  today: string
}): HandoverPlan {
  const index = aliasIndex()
  const header = (input.rows[0] ?? []).map((h) => (h ?? '').trim())
  const matched: ColumnMatch[] = []
  const unrecognised: string[] = []
  /** heading position -> column key, so a row is read by position and named by key. */
  const at = new Map<number, string>()

  const claims: { i: number; heading: string; col: HandoverColumn }[] = []
  header.forEach((heading, i) => {
    if (!heading) return
    const col = index.get(headingKey(heading))
    if (!col) { unrecognised.push(heading); return }
    claims.push({ i, heading, col })
  })

  /*
   * WHEN TWO HEADINGS CLAIM ONE COLUMN, THE ONE WITH DATA IN IT WINS.
   *
   * Only one can be used — a sheet carrying both "Capital on Default" and "Handover amount" would
   * otherwise have the second silently overwrite the first — and this was decided by position
   * first, which is the wrong test and quietly the worst possible one.
   *
   * The client sheet we were sent carries "Debtor Surname" at column 15 and "Debtor Initials" at
   * column 16. Both map to the name. "Debtor Surname" is EMPTY in all 45 rows and "Debtor
   * Initials" holds all 45 surnames — so position-first took the empty column, and every account
   * refused for having no name while the names sat one column to the right. The same pair sits on
   * "Client Prefix" (empty) and "Client Reference" (BF-001…), which took the references with it.
   *
   * Counting is over the body, not the header, because the header is exactly what is lying.
   * A TIE KEEPS THE FIRST, which is the old behaviour and the right one when there is nothing to
   * choose on: two columns with the same amount of data are a question for a person, and the
   * loser is reported by name rather than dropped.
   */
  const body = input.rows.slice(1)
  const filled = (i: number) => body.reduce((n, row) => n + ((row[i] ?? '').trim() ? 1 : 0), 0)
  const winners = new Set<number>()
  for (const key of new Set(claims.map((c) => c.col.key))) {
    const group = claims.filter((c) => c.col.key === key)
    const best = group.reduce((a, b) => (filled(b.i) > filled(a.i) ? b : a))
    winners.add(best.i)
  }

  for (const { i, heading, col } of claims) {
    if (!winners.has(i)) { unrecognised.push(heading); continue }
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
  }

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

  /*
   * THE ORDER IS SETTLED BEFORE THE FIRST ROW IS READ, over every date column in the file. Read
   * row by row, an American-locale sheet comes out mostly day-first with a handful of rows
   * month-first, each one plausible on its own. One order for the file is either right or
   * visibly wrong.
   */
  const dateColumns = [...at].filter(([, key]) =>
    HANDOVER_COLUMNS.find((c) => c.key === key)?.kind === 'date').map(([i]) => i)
  const dates = detectDateOrder(
    input.rows.slice(1).flatMap((row) => dateColumns.map((i) => row[i])))

  /*
   * WHAT IS ALREADY ON THE BOOK, keyed the same way the rows are, so "the same data has already
   * been handed over" can be said with the reference somebody would go and look at.
   */
  const onBook = new Map<string, string>()
  for (const a of input.existingAccounts ?? []) {
    for (const sig of signaturesOf({ id_number: a.idNumber, name: a.name }, a.capital)) {
      if (!onBook.has(sig)) onBook.set(sig, a.reference ?? 'an account with no reference')
    }
  }

  const seen = new Set<string>()
  /** signature -> the line earlier in THIS file that already carried it. */
  const seenSignatures = new Map<string, number>()
  const rows: PlannedRow[] = []
  for (let r = 1; r < input.rows.length; r += 1) {
    const raw = input.rows[r] ?? []
    /* A wholly empty line is the blank rows under the data, not a debtor with nothing filled in. */
    if (raw.every((c) => (c ?? '').trim() === '')) continue
    const values: Record<string, string | null> = {}
    for (const [i, key] of at) values[key] = (raw[i] ?? '').trim() || null
    rows.push(readRow(values, r + 1, {
      seen, seenSignatures, onBook,
      existing: input.existingReferences, today: input.today, order: dates.order,
    }))
  }

  const refused = rows.filter((x) => x.refused)
  const ready = rows.filter((x) => !x.refused)
  return {
    kind,
    dates,
    note: dates.contradictory
      /* Said instead of the sheet note, not after it: an order nothing can settle is a bigger
         problem than which sheet this is, and both sentences in a row get read as one. */
      ? 'This file writes its dates both ways round — some can only be day/month, others can only '
        + 'be month/day. Nothing here can tell which was meant for the rest, so check the file '
        + 'before importing it.'
      : note,
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
 *
 * A DATE OF DEFAULT IN THE FUTURE MOVED ACROSS THAT LINE, at the firm's instruction. It reads
 * like a typo somebody can live with and it is not: three separate clocks are started from it.
 */
/**
 * What to say about a date of default that could not be read.
 *
 * THE FIRM: "this date of default that it says is wrong, it's actually in the right way -- first
 * day, then month, then year." Every word of that was true of 31/02/2026, and the message said
 * the file's ORDER could not account for it -- which reads as Raptor not understanding the way
 * South Africa writes a date, and sends somebody to check the importer instead of the cell.
 */
function dateMessage(raw: string | null | undefined, order: DateOrder): string {
  const s = (raw ?? '').trim()
  if (!s) return 'No date of default — in duplum runs from it.'
  switch (dateFault(s, order)) {
    case 'no-such-day': {
      const spelt = spellDate(s, order)
      return spelt
        ? `Date of default "${s}" — there is no ${spelt}. Check the day.`
        : `Date of default "${s}" is not a day that exists.`
    }
    /* Named as the ambiguity it is, because "invalid date" sends somebody to check a date that is
       perfectly valid and merely means two things. */
    case 'wrong-order':
      return `Date of default "${s}" is not a date this file's order can account for — it is `
        + `being read ${order === 'day-first' ? 'day/month/year' : 'month/day/year'}.`
    default:
      return `Date of default "${s}" could not be read as a date.`
  }
}

function readRow(
  values: Record<string, string | null>,
  line: number,
  ctx: {
    seen: Set<string>
    /** Signatures already met in this file, and the line each came from. */
    seenSignatures: Map<string, number>
    /** Signatures already on the client's book, and the reference each belongs to. */
    onBook: Map<string, string>
    existing?: Set<string>
    today: string
    order: DateOrder
  },
): PlannedRow {
  const problems: RowProblem[] = []
  const refuse = (key: string | null, message: string) =>
    problems.push({ level: 'refuse', message, key })
  const warn = (key: string | null, message: string) =>
    problems.push({ level: 'warn', message, key })

  if (!values.name) refuse('name', 'No surname or business name — every letter is addressed from it.')

  const capital = parseMoney(values.capital)
  if (capital === null) {
    refuse('capital', values.capital
      ? `Handover amount "${values.capital}" is not a number.` : 'No handover amount.')
  } else if (capital <= 0) {
    refuse('capital', 'The handover amount is nought or less.')
  }

  const defaulted = parseSheetDate(values.default_date, ctx.order)
  if (!defaulted) {
    refuse('default_date', dateMessage(values.default_date, ctx.order))
  } else if (defaulted > ctx.today) {
    /*
     * REFUSED, NOT WARNED, AT THE FIRM'S INSTRUCTION: "make it so that a date of default can't be
     * in the future for an import. It needs to be changed."
     *
     * It sits exactly on the line this file already draws -- a refusal is a row that cannot open
     * a correct ledger, "no date for in duplum to run from" -- because a day that has not arrived
     * is not one anything can run from. In duplum, prescription and interest are all measured
     * from this date, so an account opened on a future one is wrong from its first day and wrong
     * in three different directions.
     *
     * AND IT MAKES THE TWO DOORS AGREE. validateNewDebtor has always stopped the by-hand form on
     * this -- "A handover cannot be dated in the future" -- so the same fact was being answered
     * two ways depending on how the account arrived, and the door that lets it through is the one
     * that arrives forty-five rows at a time.
     */
    refuse('default_date',
      'The date of default is in the future — in duplum and prescription both run from it.')
  }

  const ref = values.client_reference
  if (!ref) {
    refuse('client_reference', 'No reference. It is what the debtor is told to quote when they pay.')
  } else if (ctx.seen.has(ref)) {
    refuse('client_reference', `Reference ${ref} appears twice in this file.`)
  } else {
    ctx.seen.add(ref)
    if (ctx.existing?.has(ref)) {
      refuse('client_reference', `Reference ${ref} is already on this client's book.`)
    }
  }

  if (values.debtor_kind && !/^(person|business)$/i.test(values.debtor_kind)) {
    warn('debtor_kind',
      `"${values.debtor_kind}" is neither Person nor Business; it will be read as a person.`)
  }

  /*
   * THE ID IS A WARNING AND NOT A REFUSAL, and the old sheet is the argument. Every one of its 45
   * rows had a cell phone in the ID column: refusing would have refused the whole book, and the
   * firm would have turned the check off. Named on the row, it gets fixed.
   *
   * TWO DIFFERENT WRONGS, SAID DIFFERENTLY. Thirteen digits that fail the checksum is a
   * transposed pair somebody can find and correct; anything else is not an ID at all and is the
   * wrong column. The same isValidSaId the by-hand form uses, so the two cannot drift.
   */
  const id = (values.id_number ?? '').replace(/\s/g, '')
  if (id && !isValidSaId(id)) {
    warn('id_number', /^\d{13}$/.test(id)
      ? `"${values.id_number}" is thirteen digits but not a valid ID number — check for a `
        + 'transposed pair.'
      : `"${values.id_number}" is not an ID number. Left empty rather than guessed at.`)
  }

  /*
   * EVERY NUMBER, AND THE ONE EXCEL BROKE. 40 of 42 "Cell Phone 2" values in the firm's own file
   * were nine digits because Excel read 0129403445 as a number. Reported as the missing zero it
   * is, not as "invalid" — the person needs to know what to put back.
   */
  for (const [key, label] of [['cell_1', 'Cell number 1'], ['cell_2', 'Cell number 2'],
    ['cell_3', 'Cell number 3'], ['home_phone', 'Home number'], ['work_phone', 'Work number'],
    ['next_of_kin_phone', 'Next of kin number'], ['next_of_kin_2_phone', 'Second next of kin number'],
    ['other_phone', 'Another number'], ['other_phone_2', 'Another number']] as const) {
    const v = values[key]
    if (!v) continue
    const verdict = checkPhone(v)
    if (verdict === 'lost-leading-zero') {
      warn(key, `${label} "${v}" is missing its leading zero — Excel read it as a number. It `
        + 'cannot be dialled as it stands.')
    } else if (verdict === 'wrong') {
      warn(key, `${label} "${v}" is not a telephone number.`)
    }
  }

  for (const [key, label] of [['email_1', 'Email address'], ['email_2', 'Second email address'],
    ['other_email', 'Another email address']] as const) {
    const v = values[key]
    if (v && !looksLikeEmail(v)) warn(key, `${label} "${v}" is not an email address.`)
  }

  const paid = values.last_payment_date
  if (paid && !parseSheetDate(paid, ctx.order)) {
    warn('last_payment_date', `Last date of payment "${paid}" could not be read.`)
  }

  if (!values.cell_1 && !values.home_phone && !values.work_phone && !values.email_1) {
    warn(null, 'No telephone number and no email address — nobody can be contacted.')
  }
  /*
   * THE NOTICE GOES BY EMAIL, SO THE EMAIL ADDRESS IS THE ONE THAT MATTERS.
   *
   * THE FIRM: "we will never be posting something. Never ever we will post a letter. We will send
   * everything via email." This warned about a missing STREET address instead, and said a section
   * 129 could not be POSTED -- wrong about the channel, and wrong about which empty box to name.
   *
   * The street address is no longer warned about at all. It was empty in all 45 rows of the file
   * the firm sent, so the screen printed the same sentence forty-five times under the table:
   * a warning that fires when nothing is wrong, which is what teaches people to stop reading
   * them. An empty box is now visible in the table itself, which says it better than a sentence.
   */
  if (!values.email_1 && !values.email_2) {
    warn('email_1', 'No email address — a section 129 is sent by email, so there is nowhere to '
      + 'send it.')
  }

  /*
   * POSSIBLE DUPLICATES, LAST, AND ONLY EVER AS A WARNING.
   *
   * THE FIRM: "it's possible that a client can put the same data twice on the same sheet, or that
   * the same data has already been handed over for the same amount. So it should flag it and tell
   * you: here's a possible duplicate handover, accept or discard."
   *
   * Said once per row rather than once per signature: a row matching on both the ID and the
   * name-and-amount is one duplicate, not two, and saying it twice reads as two different
   * accounts. The row is named so somebody can go and look, which is the whole point -- the
   * screen cannot know whether a debtor genuinely owes twice, and neither can we.
   */
  const signatures = signaturesOf(values, capital)
  const earlier = signatures.map((sig) => ctx.seenSignatures.get(sig)).find((l) => l !== undefined)
  if (earlier !== undefined) {
    warn('client_reference', `Possible duplicate of row ${earlier} — the same debtor and the same `
      + 'amount appear twice in this file. Accept it if they genuinely owe twice, or leave it out.')
  } else {
    const already = signatures.map((sig) => ctx.onBook.get(sig)).find((ref) => ref !== undefined)
    if (already !== undefined) {
      warn('client_reference', `Possible duplicate of ${already}, already on this client's book `
        + '— the same debtor for the same amount. Accept it if it is a second debt, or leave it out.')
    }
  }
  /* Recorded whether or not it was reported, so a third copy points at the FIRST one rather than
     at the second: "row 4 duplicates row 3, row 3 duplicates row 2" is a chain nobody unpicks. */
  for (const sig of signatures) if (!ctx.seenSignatures.has(sig)) ctx.seenSignatures.set(sig, line)

  return { line, values, capital, problems, refused: problems.some((p) => p.level === 'refuse') }
}

/**
 * A row as the by-hand form's input, so both ways of opening an account go through one path.
 *
 * PURE, AND HERE RATHER THAN BESIDE THE DRAFT, because the draft reaches the database and a check
 * that imports it cannot run at all — which is how this ended up in the wrong file first. The
 * mapping is the interesting part and it is the part worth testing.
 */
export function toDebtorInput(values: Record<string, string | null>): NewDebtorInput {
  const v = (k: string) => (values[k] ?? '').trim()
  return {
    accountNumber: v('account_number'),
    clientReference: v('client_reference'),
    firstName: v('first_name'),
    surname: v('name'),
    /* All three were on the sheet, read into the draft and shown in the table, and then went no
       further: toAccountRow had nowhere to put them. See NewDebtorInput. */
    title: v('title'),
    initials: v('initials'),
    secondName: v('second_name'),
    /*
     * PERSON OR COMPANY, which no import has ever written. Every account the sheet opened came
     * out as a person, including the ones a client filled in as a business -- the same state the
     * Swordfish import left the book in. Anything that is not plainly "business" is a person,
     * which is what the column defaults to and what the planner already warns about.
     */
    debtorKind: /^business/i.test(v('debtor_kind')) ? 'company' : 'individual',
    /*
     * ONE IDENTITY FIELD, TWO MEANINGS, told apart by debtorKind. The sheet asks a business for a
     * registration number in its own column and it was read by nothing, so a company handed over
     * on the new sheet opened with no identity at all -- nothing to trace on, nothing to put on a
     * summons, and no way to tell two Pty Ltds apart.
     */
    idNumber: v('id_number') || v('registration_number'),
    capital: v('capital'),
    handoverDate: v('default_date'),
    /* NOT ASKED FOR ON THE SHEET ANY MORE, at the firm's instruction -- the rate is in the
       agreement the firm already holds. toAccountRow needs a number, and an account opened at
       nought is one somebody notices; opened at a guessed 24% it is one nobody does. */
    interestRateAnnual: '0',
    mobile: v('cell_1'),
    workPhone: v('work_phone'),
    altNumber: v('cell_2'),
    email: v('email_1'),
    address: [v('street_1'), v('street_2'), v('suburb'), v('city'), v('street_code')]
      .filter(Boolean).join('\n'),
    employer: v('employer'),
    kin1Name: v('next_of_kin'),
    kin1Phone: v('next_of_kin_phone'),
    kin2Name: v('next_of_kin_2'),
    kin2Phone: v('next_of_kin_2_phone'),
  }
}
