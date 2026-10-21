/**
 * Reading the client's answer back out of their reply.
 *
 * THE FIRM asked for a column the client fills in: "forward this email back to us or respond to
 * this email, but fill in this block on the right hand side, the information we require." That
 * got them somewhere to write. This is the other half — taking what they wrote and putting it
 * against the right field on the right account, instead of somebody reading a reply and
 * retyping it into forty columns.
 *
 * NOTHING IS APPLIED HERE. It reads, it matches, it checks each answer against the same rule the
 * importer used, and it stops. The firm's standing instruction is that corrections are "the
 * firm's decision, made case by case, never a migration that sweeps" — so this produces a list
 * somebody accepts, and a wrong answer typed by a client is caught before it is written rather
 * than after.
 *
 * HAND-ROLLED, NO DOM, like documentHtmlToBlocks and the sanitiser beside it: the parse has to be
 * identical in Node and in a browser, because the checks run in Node and the screen runs in a
 * browser, and a parser that only exists in one of them is a parser nobody can test.
 *
 * WHAT MAKES THIS HARD IS NOT THE TABLE, IT IS WHAT A MAIL CLIENT DOES TO IT. The reply that
 * comes back is our markup after Outlook, Gmail or Apple Mail has re-serialised it: cells wrapped
 * in <div> and <p>, styles rewritten, `&nbsp;` everywhere, the whole thing nested inside two
 * <blockquote>s, and often the original quoted underneath the answered copy. So this reads
 * structure — a header row that names our columns — and never positions or styling.
 */
import { HANDOVER_COLUMNS } from './handoverSheet.ts'
import { ANSWER_COLUMN } from './importCorrections.ts'
import { checkPhone, looksLikeEmail, parseMoney, parseSheetDate } from './handoverImport.ts'
import { isValidSaId } from './newDebtor.ts'

/** The two headings that identify one of our tables. Both, because either alone is a common word. */
const REFERENCE_HEADING = 'Your reference'
const FIELD_HEADING = 'Field'

export interface ReplyAnswer {
  /** The client's own reference for the account, as it stood in the table. */
  reference: string | null
  /** Which column the answer is for, as a handover sheet key. Null when the heading is unknown. */
  key: string | null
  /** The heading as it appeared, so an unmatched one can be shown rather than swallowed. */
  fieldLabel: string
  /** What their sheet said, carried through so a person can see what is being replaced. */
  given: string
  /** What they typed. Never empty: a blank answer is not an answer and is dropped. */
  answer: string
  /**
   * What is still wrong with it, or null.
   *
   * CHECKED WITH THE SAME RULES THE IMPORT USED, because the commonest reply to "this is not an
   * ID number" is another thing that is not an ID number. Caught here, it is a sentence on a
   * screen; caught later it is a statutory demand addressed to a stranger.
   */
  problem: string | null
}

/* ------------------------------------------------------------------ *
 * Just enough HTML.
 * ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
}

function decode(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const n = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

/**
 * A cell's words.
 *
 * Every kind of space collapses to one, INCLUDING the non-breaking kind. Our own empty cell is an
 * `&nbsp;` — put there so Outlook does not collapse the box to a sliver — so a cell nobody typed
 * in arrives as a single non-breaking space and has to read as empty here, or every unanswered
 * row would come back as an answer of " ".
 */
const clean = (raw: string): string =>
  /* An alternation rather than a character class: a zero-width joiner sitting beside its
     neighbours inside `[...]` reads to a linter as a deliberate emoji sequence, which is the one
     thing it is not. */
  decode(raw).replace(/(?:\s|\u00a0|\u200b|\u200c|\u200d|\ufeff)+/g, ' ').trim()

/** Case- and space-insensitive, because a mail client may re-case nothing but a person may. */
const same = (a: string, b: string) => a.toLowerCase().replace(/\s+/g, ' ').trim()
  === b.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Every table in the markup, as rows of cell text.
 *
 * NESTING IS TRACKED because mail clients wrap tables in tables — Outlook in particular lays a
 * quoted message out inside one. A row belongs to the innermost table open at the time, which is
 * the only reading under which our five columns stay five columns.
 */
function tablesIn(html: string): string[][][] {
  const tables: string[][][] = []
  /** The stack of open tables. The last is the one rows land in. */
  const open: string[][][] = []
  let row: string[] | null = null
  let cell: string | null = null

  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt < 0) {
      if (cell !== null) cell += html.slice(i)
      break
    }
    if (cell !== null) cell += html.slice(i, lt)

    /* Comments, doctypes and processing instructions carry nothing and may contain '>'. */
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      i = end < 0 ? html.length : end + 3
      continue
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt)
      i = end < 0 ? html.length : end + 1
      continue
    }
    const head = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt))
    if (!head) {
      /* A bare '<' in prose — "5 < 6". Text, not a tag. */
      if (cell !== null) cell += '<'
      i = lt + 1
      continue
    }

    /*
     * The end of the tag, with quoted attribute values tracked. A '>' inside an attribute does
     * not end a tag, and a style attribute in re-serialised mail is full of them.
     */
    let j = lt + head[0].length
    let quote: string | null = null
    while (j < html.length) {
      const ch = html[j]
      if (quote) { if (ch === quote) quote = null }
      else if (ch === '"' || ch === "'") quote = ch
      else if (ch === '>') break
      j += 1
    }
    const closing = head[1] === '/'
    const name = head[2].toLowerCase()

    if (name === 'table') {
      if (closing) {
        /*
         * THE LAST ROW IS FLUSHED FIRST. Gmail and Outlook both drop closing </td> and </tr>
         * tags -- both are legal HTML -- so the final row of a quoted table is still open when
         * </table> arrives. Closed without this, every answer in the last row was silently lost,
         * and the table above it parsed perfectly, which is what made it look like it worked.
         */
        if (cell !== null && row) { row.push(cell) }
        if (row && row.length > 0 && open.length > 0) open[open.length - 1].push(row)
        row = null; cell = null
        const done = open.pop()
        if (done) tables.push(done)
      } else {
        open.push([])
        row = null; cell = null
      }
    } else if (name === 'tr' && open.length > 0) {
      if (closing) {
        if (cell !== null && row) { row.push(cell); cell = null }
        if (row) open[open.length - 1].push(row)
        row = null
      } else {
        /* An unclosed <tr> before this one still counts: mail clients drop closing tags. */
        if (cell !== null && row) { row.push(cell); cell = null }
        if (row) open[open.length - 1].push(row)
        row = []
      }
    } else if ((name === 'td' || name === 'th') && open.length > 0) {
      if (closing) {
        if (row && cell !== null) row.push(cell)
        cell = null
      } else {
        if (row && cell !== null) row.push(cell)
        if (!row) row = []
        cell = ''
      }
    } else if (cell !== null && (name === 'br' || name === 'p' || name === 'div')) {
      /* A cell whose text was split across <div>s must not run together into one word. */
      cell += ' '
    }

    i = j + 1
  }
  /* A table the client's mail never closed still has its rows. */
  while (open.length > 0) {
    if (cell !== null && row) { row.push(cell); cell = null }
    if (row) { open[open.length - 1].push(row); row = null }
    const done = open.pop()
    if (done) tables.push(done)
  }
  return tables
}

/* ------------------------------------------------------------------ *
 * What the answer is for.
 * ------------------------------------------------------------------ */

/** A heading back to a sheet key. Null rather than a guess: a wrong column is a wrong write. */
export function keyForLabel(label: string): string | null {
  const hit = HANDOVER_COLUMNS.find((c) => same(c.label, label)
    /* The labels the sheet used to carry, because the email that went out may be an old one and
       a client may be answering a table sent a year ago. */
    || (c.was ?? []).some((w) => same(w, label)))
  return hit?.key ?? null
}

/**
 * Is this answer any better than what they sent the first time?
 *
 * The same rules the importer applied, so a client who answers "this is not an ID number" with
 * another thing that is not an ID number is told here rather than after a statutory demand has
 * gone to a stranger. Returns null when there is nothing wrong with it.
 */
export function problemWithAnswer(key: string | null, answer: string): string | null {
  if (!key) return null
  const v = answer.trim()
  if (!v) return null
  const column = HANDOVER_COLUMNS.find((c) => c.key === key)
  switch (key) {
    case 'id_number':
      return isValidSaId(v) ? null
        : (/^\d{13}$/.test(v)
          ? 'Thirteen digits, but not a valid ID number — check for a transposed pair.'
          : 'A South African ID number is thirteen digits.')
    case 'email_1': case 'email_2': case 'other_email':
      return looksLikeEmail(v) ? null : `"${v}" is not an email address.`
    default: break
  }
  if (column?.kind === 'date') {
    /* Day-first, because that is how South Africa writes one and how the sheet asks for it. */
    return parseSheetDate(v, 'day-first') ? null
      : `"${v}" could not be read as a date. Day/month/year, please.`
  }
  if (column?.kind === 'money') {
    const n = parseMoney(v)
    if (n === null) return `"${v}" is not a number.`
    return n > 0 ? null : 'The amount is nought or less.'
  }
  if (/^(cell_|home_phone|work_phone|other_phone)|phone$/.test(key)) {
    switch (checkPhone(v)) {
      /* The one Excel causes rather than a person: 40 of 42 "Cell Phone 2" values on the client's
         own sheet arrived nine digits long, and a client retyping into a spreadsheet can do it
         again in the answer. Named as what it is, because "not a number" sends them hunting. */
      case 'lost-leading-zero':
        return `"${v}" is missing its leading zero — it cannot be dialled as it stands.`
      case 'wrong': return `"${v}" is not a telephone number.`
      default: return null
    }
  }
  return null
}

/**
 * Everything the client filled in, in the order it appears.
 *
 * THE FIRST OCCURRENCE WINS. A reply carries the answered copy and, underneath it, the original
 * quoted — and in every client the firm uses the newest is at the top. Keyed on reference and
 * field, so the same account answered for two different fields is two answers and the same field
 * answered twice is one.
 */
export function parseCorrectionReply(html: string): ReplyAnswer[] {
  const out: ReplyAnswer[] = []
  const seen = new Set<string>()

  for (const table of tablesIn(html)) {
    const cells = table.map((r) => r.map(clean))
    /*
     * FOUND BY ITS HEADINGS, never by position. A reply may carry other tables — a signature
     * block is one, and so is the layout table Outlook wraps the quote in — and the columns of
     * ours may have been re-ordered by a client who dragged one.
     */
    const headerAt = cells.findIndex((r) =>
      r.some((c) => same(c, REFERENCE_HEADING))
      && r.some((c) => same(c, FIELD_HEADING))
      && r.some((c) => same(c, ANSWER_COLUMN)))
    if (headerAt < 0) continue

    const header = cells[headerAt]
    const refCol = header.findIndex((c) => same(c, REFERENCE_HEADING))
    const fieldCol = header.findIndex((c) => same(c, FIELD_HEADING))
    const answerCol = header.findIndex((c) => same(c, ANSWER_COLUMN))
    const givenCol = header.findIndex((c) => same(c, 'What your sheet says'))

    for (const row of cells.slice(headerAt + 1)) {
      /* A row shorter than the header is a spacer or a mangled one: there is nothing to read. */
      if (row.length <= answerCol) continue
      const answer = row[answerCol] ?? ''
      /* AN EMPTY BOX IS NOT AN ANSWER. Ours goes out holding a non-breaking space, so this is
         the ordinary case rather than the odd one. */
      if (!answer) continue

      const fieldLabel = row[fieldCol] ?? ''
      const reference = (row[refCol] ?? '') || null
      const key = keyForLabel(fieldLabel)
      const id = `${reference ?? ''}|${key ?? fieldLabel}`
      if (seen.has(id)) continue
      seen.add(id)

      out.push({
        reference,
        key,
        fieldLabel,
        given: givenCol >= 0 ? (row[givenCol] ?? '') : '',
        answer,
        problem: problemWithAnswer(key, answer),
      })
    }
  }
  return out
}
