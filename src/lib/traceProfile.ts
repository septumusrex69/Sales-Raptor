/**
 * Reading a credit bureau profile.
 *
 * A trace comes back as a PDF and the firm pays for every one of them under Annexure B item 4(c).
 * Until now that PDF was filed as a document and the facts inside it were retyped, or not typed
 * at all — which means the firm paid for a search and then kept the answer in a drawer.
 *
 * This turns the PDF's text into facts the account can hold. It takes TOKENS — the strings a PDF
 * reader hands back, in reading order — and nothing else, so every rule in here can be checked
 * without a PDF, a browser or a network. Pulling the tokens out of the file is pdfText.ts's job.
 *
 * TWO SHAPES OF REPORT, and the difference is the question the upload has to ask:
 *
 *   COMMERCIAL  a company. Carries its registration number, its status at CIPC, the judgments
 *               against it and the people who direct it.
 *   CONSUMER    a person. Carries their numbers, their addresses, where they work, the companies
 *               they direct and the judgments against them personally.
 *
 * A company account gets both kinds uploaded to it: one for the company, and one for each
 * director worth tracing. Which is why the upload asks.
 *
 * NOTHING HERE WRITES ANYTHING. It reads a document and says what it found; a person confirms it
 * before a single row is stored. A bureau profile is somebody else's record of a third party, and
 * it is wrong often enough — stale numbers, a namesake, an address from 2009 — that importing it
 * unread would put rubbish on an account nobody could later explain.
 */

import type { PractitionerKind } from './accountStanding.ts'

export type TraceKind = 'commercial' | 'consumer'

/**
 * A company status that means somebody else is now in charge of the debtor.
 *
 * THE MOST CONSEQUENTIAL LINE ON A COMMERCIAL PROFILE. "Final Liquidation" means the debt is
 * still owed and the company cannot be collected from: the claim is proved in the estate, and a
 * collector who rings the company instead has wasted the call at best.
 *
 * Read off the document and PROPOSED, never applied on its own. The firm asked for exactly that:
 * "I think the upload should propose it like this under liquidation. Add the practitioner or look
 * for the practitioner." Changing what an account reports to a client off a PDF nobody has
 * checked is the kind of automatic act that cannot be explained afterwards.
 */
export interface AdministrationReading {
  /** What the bureau printed, so the proposal can quote it back rather than paraphrase. */
  status: string
  /**
   * The sub-status to write, in the FIRM'S vocabulary and not the bureau's.
   *
   * The account's rung is derived from this string — see clientPosition — so it has to be wording
   * that derivation already knows. 'Final Liquidation' happens to match; something like
   * 'FINLIQ' would store cleanly and report as In progress.
   */
  subStatus: string
  /** The office that would have been appointed. Null where the status does not imply one. */
  practitionerKind: PractitionerKind | null
}

/*
 * Ordered, because a status can match twice: "Final Liquidation" contains neither the word
 * sequestration nor rescue, but a longer real-world status like "Business Rescue - Liquidation
 * Pending" contains both, and the first match should be the process actually running.
 */
const ADMINISTRATION: { match: RegExp; subStatus: string; practitionerKind: PractitionerKind | null }[] = [
  { match: /business\s*rescue/i, subStatus: 'Business Rescue', practitionerKind: 'business_rescue' },
  { match: /liquidat/i, subStatus: 'Liquidation/Sequestration', practitionerKind: 'liquidator' },
  { match: /sequestrat/i, subStatus: 'Liquidation/Sequestration', practitionerKind: 'trustee' },
  { match: /judicial\s*management|curator/i, subStatus: 'Under administration', practitionerKind: 'curator' },
  { match: /deceased|estate\s*late/i, subStatus: 'Deceased estate', practitionerKind: 'executor' },
  { match: /debt\s*review|debt\s*counsell/i, subStatus: 'Debt Review', practitionerKind: 'debt_counsellor' },
]

/**
 * Null for 'In Business', which is the overwhelming majority and must cost nothing.
 *
 * DEREGISTRATION IS DELIBERATELY NOT HERE. A deregistered company is a different problem — there
 * is no estate and no practitioner, the company simply no longer exists — and proposing a
 * practitioner for one would send a collector looking for somebody who was never appointed.
 */
export function administrationReading(companyStatus: string | null | undefined): AdministrationReading | null {
  const status = (companyStatus ?? '').trim()
  if (!status) return null
  const hit = ADMINISTRATION.find((a) => a.match.test(status))
  if (!hit) return null
  return { status, subStatus: hit.subStatus, practitionerKind: hit.practitionerKind }
}

export interface TraceDirector {
  idNumber: string | null
  fullName: string
  status: 'Active' | 'Resigned' | null
  appointedOn: string | null
}

export interface TraceJudgment {
  caseNumber: string
  caseType: string | null
  caseReason: string | null
  plaintiff: string | null
  filedOn: string | null
  /**
   * The row could not be split into its columns with any confidence.
   *
   * A consumer report prints its judgments as a TABLE whose cells wrap, so the words of the case
   * type, the reason and the plaintiff arrive as one run of tokens. Where the split is not
   * certain this carries the whole run and the screen shows it as found-but-unread, rather than
   * storing a plaintiff that is half a case reason.
   */
  unread: string | null
}

export interface TraceContact {
  kind: 'mobile' | 'work' | 'phone' | 'email'
  value: string
  /** How many other people the bureau has this number against. See rankContacts. */
  peopleLinked: number | null
  /** When the bureau last saw it. The single best guide to whether it will ring. */
  updatedOn: string | null
}

export interface TraceAddress {
  value: string
  province: string | null
  updatedOn: string | null
}

export interface TraceEmployment {
  employer: string
  designation: string | null
  updatedOn: string | null
}

export interface TraceProfile {
  kind: TraceKind
  /** The company or the person the report is about, as the bureau spells it. */
  subjectName: string | null
  /** Commercial only. See normaliseRegistration for why it is not stored raw. */
  registrationNumber: string | null
  /** Consumer only. */
  idNumber: string | null
  /** Commercial only: 'In Business', 'Final Liquidation', 'Deregistered'. */
  companyStatus: string | null
  /** The bureau's own two readings of a person. Not scores we compute — see BACKLOG. */
  contactScore: string | null
  riskScore: string | null
  enquiredOn: string | null
  directors: TraceDirector[]
  judgments: TraceJudgment[]
  contacts: TraceContact[]
  addresses: TraceAddress[]
  employment: TraceEmployment[]
  /** Consumer only: the companies this person directs. Context, not something we store. */
  directorships: { name: string; status: string | null; appointedOn: string | null }[]
}

/* ---------- small readers ---------- */

const DATE = /^(\d{1,2})-(\d{1,2})-(\d{4})$/

/** dd-mm-yyyy as the bureau prints it, to the yyyy-mm-dd everything else here speaks. */
export function traceDate(token: string | undefined): string | null {
  const m = DATE.exec((token ?? '').trim())
  if (!m) return null
  const [, d, mo, y] = m
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  /* A date the calendar does not have is a misread column, not a date. */
  const parsed = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null
  return iso
}

const isDate = (t: string | undefined) => traceDate(t) !== null

/**
 * A registration number the way the client's own system writes it.
 *
 * THE BUREAU PREFIXES A LETTER AND THE CLIENT DOES NOT. Two real handovers came in as
 * `nnnn/nnnnnn/07` while their profiles are filed under `Knnnn/nnnnnn/07`. Matched literally the
 * two never meet, which is how a trace uploaded to the right company lands as a mismatch — and
 * how a "wrong company" warning ends up firing on every single upload.
 *
 * The letter is the bureau's own source marker, not part of the number, so it comes off. Nothing
 * else is touched — the slashes and the leading zeros are the number.
 */
export function normaliseRegistration(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim().toUpperCase()
  if (!t || t === 'UNKNOWN') return null
  return t.replace(/^[A-Z](?=\d{4}\/)/, '')
}

/** Two registration numbers are the same company, whichever side wrote which. */
export const sameRegistration = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const x = normaliseRegistration(a), y = normaliseRegistration(b)
  return x !== null && y !== null && x === y
}

/**
 * A NAME, NOT A SHOUT. Bureau profiles are upper case throughout; an account screen is not.
 *
 * The particles stay lower case and the Scots and Irish prefixes keep their second capital, which
 * is the difference between a name and a field — "Mcdonald" is not how anybody writes their name.
 */
export function titleCase(raw: string): string {
  const small = new Set(['van', 'der', 'den', 'de', 'du', 'la', 'le', 'von', 'the', 'and', 'of'])
  /*
   * WORDS THAT ARE NOT WORDS. A case reason of "VAT" title-cased reads "Vat", which is not a tax
   * and looks like a typo on a client report. The list is short because it only has to cover what
   * the bureau actually prints in a name or a reason column.
   */
  const acronyms = new Set([
    'VAT', 'PAYE', 'UIF', 'SARS', 'CC', 'SA', 'RSA', 'CIPC', 'NCR',
  ])
  return raw.split(/\s+/).filter(Boolean).map((original, i) => {
    const bare = original.replace(/[^A-Za-z]/g, '')
    if (acronyms.has(bare.toUpperCase()) && original === original.toUpperCase()) return original
    const word = original.toLowerCase()
    if (i > 0 && small.has(word)) return word
    const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)
    if (/^(mc|mac)[a-z]{2,}/.test(word)) {
      const n = word.startsWith('mac') ? 3 : 2
      return cap(word.slice(0, n)) + cap(word.slice(n))
    }
    return word.split('-').map(cap).join('-')
  }).join(' ')
}

/** A South African ID number is thirteen digits. Anything else in that column is a misread. */
const isIdNumber = (t: string | undefined) => /^\d{13}$/.test((t ?? '').trim())

/* Page furniture the reader hands back with everything else. */
const NOISE = /^(page \d+ of \d+|type|summary|)$/i

/* ---------- the sections ---------- */

/**
 * Where each block starts, in the order the report prints them.
 *
 * Matched on their own token so a section heading cannot be found inside a company's name —
 * "ADDRESSES" is a heading, "2 ADDRESSES STREET" is not.
 */
const HEADINGS: { key: string; match: RegExp }[] = [
  { key: 'contacts', match: /^CONTACT INFORMATION$/i },
  { key: 'addresses', match: /^ADDRESSES$/i },
  { key: 'employment', match: /^EMPLOYMENT HISTORY$/i },
  { key: 'directorships', match: /^DIRECTORSHIP$/i },
  { key: 'judgments', match: /^(CONSUMER|COMMERCIAL) JUDGE?MENTS?$/i },
  { key: 'directors', match: /^DIRECTOR INFORMATION$/i },
  { key: 'directorDetail', match: /^DIRECTOR #\d+$/i },
  { key: 'enquiries', match: /^(ENQUIRY HISTORY|PREVIOUS ENQUIRIES)$/i },
]

/*
 * ONLY SECTIONS THAT ARE READ ARE LISTED, and the reason is a bug this cost.
 *
 * 'DEFAULTS' was in this list as a heading nothing consumed. A consumer report prints its case
 * type as a wrapped cell -- "JUDGEMENT BY" then "DEFAULT" on the next line -- so the word DEFAULT
 * arrives as a token of its own, matched as a heading, and closed the judgments block halfway
 * through a row. The judgment came out as unread with the text "JUDGEMENT BY".
 *
 * A heading pattern is a claim that no cell in the document contains that word alone. That claim
 * is not worth making for a section whose contents are thrown away.
 */

/** Split the token stream into the blocks the report is printed in. */
function sections(tokens: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let current: string | null = null
  for (const token of tokens) {
    const hit = HEADINGS.find((h) => h.match.test(token.trim()))
    if (hit) {
      current = hit.key
      /* A heading can appear once per page. Keep appending to the block it opened. */
      if (!out.has(current)) out.set(current, [])
      continue
    }
    if (current) out.get(current)?.push(token)
  }
  return out
}

/** The value printed under a label, anywhere in the report. */
function labelled(tokens: string[], label: string): string | null {
  const want = label.toLowerCase()
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (tokens[i].trim().toLowerCase().replace(/:$/, '') === want) {
      const v = tokens[i + 1].trim()
      if (!v || /^unknown$/i.test(v)) return null
      /* A label followed by the next label is a field the bureau left blank. */
      if (/:$/.test(v)) return null
      return v
    }
  }
  return null
}

/* ---------- directors, off a commercial report ---------- */

/**
 * The director table: ID number, name, status, appointment date, created date.
 *
 * Anchored on the ID NUMBER, not on position in the block. The table's own headings repeat at
 * every page break and a page footer lands in the middle of it, so counting five tokens at a time
 * from the top drifts one row into the next by the second page.
 */
export function readDirectors(tokens: string[]): TraceDirector[] {
  const out: TraceDirector[] = []
  const seen = new Set<string>()
  for (let i = 0; i < tokens.length; i += 1) {
    if (!isIdNumber(tokens[i])) continue
    const name = (tokens[i + 1] ?? '').trim()
    /* A thirteen-digit number followed by something that is not a name is a different table. */
    if (!name || !/[A-Za-z]{2}/.test(name) || isDate(name)) continue
    const rawStatus = (tokens[i + 2] ?? '').trim()
    const status = /^active$/i.test(rawStatus) ? 'Active'
      : /^resigned$/i.test(rawStatus) ? 'Resigned'
        : null
    const key = `${tokens[i].trim()}|${name.toUpperCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      idNumber: tokens[i].trim(),
      fullName: titleCase(name),
      status,
      appointedOn: traceDate(tokens[i + 3]),
    })
  }
  return out
}

/* ---------- judgments ---------- */

/*
 * The vocabulary the bureau prints, used to split a wrapped table row.
 *
 * A consumer report prints judgments as a table whose cells wrap, so "JUDGEMENT BY / DEFAULT /
 * CREDIT / AGREEMENT / <the creditor, over two more lines>" arrives as a run of tokens with no
 * marker for where one column ends. The case type and the case reason both come from short fixed
 * lists; the plaintiff is whatever is left. Matching the two known columns is what makes the
 * third one safe to store.
 *
 * Both spellings of "judgement" are here because the bureau uses one and the courts the other.
 */
const CASE_TYPES = [
  'JUDGEMENT BY DEFAULT', 'JUDGMENT BY DEFAULT',
  'CONSENT TO JUDGEMENT', 'CONSENT TO JUDGMENT',
  'DEFAULT JUDGEMENT', 'DEFAULT JUDGMENT',
  'SUMMARY JUDGEMENT', 'SUMMARY JUDGMENT',
  'ADMINISTRATION ORDER', 'ADMIN ORDER',
]

const CASE_REASONS = [
  'CREDIT AGREEMENT', 'GOODS SOLD AND DELIVERED', 'MONEY LENT AND ADVANCED',
  'SERVICES RENDERED', 'INCOME TAX', 'LEVIES', 'RENT', 'RENTAL', 'DAMAGES',
  'MAINTENANCE', 'VAT', 'PAYE', 'UIF', 'BOND', 'LEASE', 'LOAN',
]

const CASE_NUMBER = /^\d{1,7}\/\d{4}$/

/** Longest first, so 'JUDGEMENT BY DEFAULT' is not read as 'DEFAULT JUDGEMENT' reversed. */
const longestFirst = (list: string[]) => [...list].sort((a, b) => b.length - a.length)

/**
 * Split the middle of a judgment row into case type, case reason and plaintiff.
 *
 * Returns nulls and the raw run when it cannot: a plaintiff that is half a case reason is worse
 * than an honest "found, could not read it", because the first goes onto a client report.
 */
export function splitJudgmentRow(middle: string): {
  caseType: string | null; caseReason: string | null; plaintiff: string | null; unread: string | null
} {
  const text = middle.replace(/\s+/g, ' ').trim()
  if (!text) return { caseType: null, caseReason: null, plaintiff: null, unread: null }

  const type = longestFirst(CASE_TYPES).find((t) => text.toUpperCase().startsWith(t))
  const afterType = type ? text.slice(type.length).trim() : text

  const reason = longestFirst(CASE_REASONS).find((r) => afterType.toUpperCase().startsWith(r))
  if (!type || !reason) return { caseType: null, caseReason: null, plaintiff: null, unread: text }

  const plaintiff = afterType.slice(reason.length).trim()
  return {
    caseType: titleCase(type),
    caseReason: titleCase(reason),
    /* No plaintiff named is a blank column, not a failure to read one. */
    plaintiff: plaintiff ? plaintiff.replace(/\s+/g, ' ') : null,
    unread: null,
  }
}

/**
 * Judgments, off either shape of report.
 *
 * A commercial report prints them as label/value pairs, which read exactly. A consumer report
 * prints them as a wrapped table, which does not — see splitJudgmentRow.
 */
export function readJudgments(tokens: string[], kind: TraceKind): TraceJudgment[] {
  const out: TraceJudgment[] = []
  const seen = new Set<string>()
  const push = (j: TraceJudgment) => {
    if (seen.has(j.caseNumber)) return
    seen.add(j.caseNumber)
    out.push(j)
  }

  if (kind === 'commercial') {
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i].trim().toLowerCase() !== 'case number') continue
      const rest = tokens.slice(i, i + 14)
      const caseNumber = (rest[1] ?? '').trim()
      if (!CASE_NUMBER.test(caseNumber)) continue
      const type = labelled(rest, 'case type')
      const reason = labelled(rest, 'case reason')
      const plaintiff = labelled(rest, 'plaintiff name')
      push({
        caseNumber,
        caseType: type ? titleCase(type) : null,
        caseReason: reason ? titleCase(reason) : null,
        plaintiff: plaintiff ?? null,
        filedOn: traceDate(labelled(rest, 'case filing date') ?? undefined),
        unread: null,
      })
    }
    return out
  }

  /*
   * The consumer table. A row opens at a case number and closes at the second date in it: the
   * first is the filing date, the last is when the bureau loaded it. Everything between is the
   * three wrapped columns.
   */
  for (let i = 0; i < tokens.length; i += 1) {
    const caseNumber = tokens[i].trim()
    if (!CASE_NUMBER.test(caseNumber)) continue
    const filedOn = traceDate(tokens[i + 1])
    if (filedOn === null) continue
    const middle: string[] = []
    let j = i + 2
    while (j < tokens.length && !isDate(tokens[j]) && !CASE_NUMBER.test(tokens[j].trim())) {
      const t = tokens[j].trim()
      if (t && !NOISE.test(t) && !/^(case|plainttiff|plaintiff)\b/i.test(t)) middle.push(t)
      j += 1
    }
    push({ caseNumber, filedOn, ...splitJudgmentRow(middle.join(' ')) })
  }
  return out
}

/* ---------- contacts, off a consumer report ---------- */

const CONTACT_KIND: Record<string, TraceContact['kind']> = {
  cell: 'mobile', mobile: 'mobile', work: 'work', home: 'phone', fax: 'work', email: 'email',
}

/**
 * Every number the bureau holds, newest first.
 *
 * One real profile carries twenty-six of them going back to 2008. They are not equal and the
 * report says so in two columns a collector would otherwise have to read by eye: when the number
 * was last seen, and how many OTHER people the bureau has it against. See rankContacts.
 */
export function readContacts(tokens: string[]): TraceContact[] {
  const out: TraceContact[] = []
  const seen = new Set<string>()
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const kind = CONTACT_KIND[tokens[i].trim().toLowerCase()]
    if (!kind) continue
    const value = (tokens[i + 1] ?? '').trim()
    const looksRight = kind === 'email' ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) : /^\d[\d\s-]{6,}$/.test(value)
    if (!looksRight) continue
    const linked = /^\d{1,3}$/.test((tokens[i + 2] ?? '').trim()) ? Number(tokens[i + 2].trim()) : null
    const key = `${kind}|${value.replace(/\s/g, '')}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind, value: value.replace(/\s+/g, ''), peopleLinked: linked, updatedOn: traceDate(tokens[i + 3]) })
  }
  return out.sort((a, b) => (b.updatedOn ?? '').localeCompare(a.updatedOn ?? ''))
}

/* The nine provinces, so the address column can be told from the one beside it. */
const PROVINCES = [
  'Gauteng', 'Western Cape', 'Eastern Cape', 'Northern Cape', 'Free State',
  'KwaZulu-Natal', 'Kwazulu Natal', 'Limpopo', 'Mpumalanga', 'North West',
]

/**
 * Addresses, newest first.
 *
 * A long address wraps across two tokens and the province column is often blank, so a row is read
 * backwards from its dates rather than forwards from its start: whatever sits before the two
 * dates is the province if it names one, and the rest is the address.
 */
export function readAddresses(tokens: string[]): TraceAddress[] {
  const out: TraceAddress[] = []
  const seen = new Set<string>()
  let buffer: string[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i].trim()
    if (NOISE.test(t) || /^(address|province|updated date|created date)$/i.test(t)) continue
    if (isDate(t)) {
      if (buffer.length) {
        let province: string | null = null
        const last = buffer[buffer.length - 1]
        if (PROVINCES.some((p) => p.toLowerCase() === last.toLowerCase())) {
          province = PROVINCES.find((p) => p.toLowerCase() === last.toLowerCase()) ?? null
          buffer = buffer.slice(0, -1)
        }
        const value = buffer.join(' ').replace(/\s+/g, ' ').replace(/,\s*$/, '').trim()
        const key = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
        if (value && !seen.has(key)) {
          seen.add(key)
          out.push({ value, province, updatedOn: traceDate(t) })
        }
      }
      buffer = []
      continue
    }
    buffer.push(t)
  }
  return out.sort((a, b) => (b.updatedOn ?? '').localeCompare(a.updatedOn ?? ''))
}

/** Where they work: employer, what they do there, when the bureau last saw it. */
export function readEmployment(tokens: string[]): TraceEmployment[] {
  const out: TraceEmployment[] = []
  const seen = new Set<string>()
  for (let i = 0; i < tokens.length - 3; i += 1) {
    const employer = tokens[i].trim()
    if (!employer || NOISE.test(employer) || isDate(employer)) continue
    if (/^(commercial name|designation|updated date|created date)$/i.test(employer)) continue
    const designation = (tokens[i + 1] ?? '').trim()
    /*
     * BOTH DATES, AND THAT IS WHAT MAKES A ROW A ROW.
     *
     * The row is four columns: employer, designation, updated, created. Requiring only the third
     * to be a date let the loop start again on the SECOND column -- where the designation stands
     * where the employer should, the updated date where the designation should, and the created
     * date is still a date. Every job was read twice: once correctly, and once with the job title
     * standing in as the company. "Financial Controller" came out as a place somebody worked.
     *
     * There is deliberately no jump past a matched row. It would hide this: with the row skipped,
     * the second column is never reached and a check for it passes on code that cannot read.
     */
    if (!isDate(tokens[i + 2]) || !isDate(tokens[i + 3])) continue
    const key = `${employer.toUpperCase()}|${designation.toUpperCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      employer: titleCase(employer),
      designation: designation && !/^na$/i.test(designation) ? titleCase(designation) : null,
      updatedOn: traceDate(tokens[i + 2]),
    })
  }
  return out
}

/**
 * Which numbers to offer as already ticked.
 *
 * A collector confirming twenty-six numbers ticks none of them and takes the first one on the
 * list, so the choice has to be made properly here or it is not made at all. Two facts decide it,
 * and both are printed on the report:
 *
 *   HOW RECENTLY the bureau saw it. A number last updated in 2011 is not a number.
 *   HOW MANY PEOPLE it is linked to. A number the bureau has against ten people is a switchboard
 *   or a number that has been reassigned twice; it is not this debtor's phone.
 *
 * So: seen in the last two years, against no more than three people, and at most one of each kind
 * — a mobile, a work number, a landline and an email is a list somebody will actually work
 * through. Everything else stays on the screen, unticked, for the collector who wants it.
 */
export function rankContacts(contacts: TraceContact[], today: string): TraceContact[] {
  const cutoff = new Date(`${today}T00:00:00Z`)
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2)
  const since = cutoff.toISOString().slice(0, 10)
  const taken = new Set<TraceContact['kind']>()
  /*
   * ONE NUMBER, OFFERED ONCE. The bureau files the same number under more than one type -- one
   * real profile carries 083 555 0178 as a Cell, a Home and a Work number, all updated within a
   * month of each other. Ticked by kind alone the collector is handed the same number three
   * times and no second number at all.
   */
  const already = new Set<string>()
  const picked: TraceContact[] = []
  for (const c of contacts) {
    if (taken.has(c.kind) || already.has(c.value)) continue
    if (c.updatedOn === null || c.updatedOn < since) continue
    if (c.peopleLinked !== null && c.peopleLinked > 3) continue
    taken.add(c.kind)
    already.add(c.value)
    picked.push(c)
  }
  return picked
}

/* ---------- the whole report ---------- */

/**
 * What kind of report this is, read off the document rather than asked.
 *
 * The upload still ASKS — the firm's own words, "the trace would ask you, is this for the company,
 * or is this for a director?" — but it asks with the answer already filled in. A collector who has
 * just uploaded six PDFs should be confirming, not classifying.
 */
export function traceKind(tokens: string[]): TraceKind | null {
  for (const t of tokens.slice(0, 40)) {
    if (/^COMMERCIAL REPORT/i.test(t.trim())) return 'commercial'
    if (/^CONSUMER REPORT/i.test(t.trim())) return 'consumer'
  }
  return null
}

/** The whole profile. Null when the document is not a bureau report at all. */
export function parseTrace(tokens: string[]): TraceProfile | null {
  /*
   * NORMALISED HERE, ONCE, FOR EVERY READER.
   *
   * The bureau pads its table cells with runs of spaces -- "MANAGER  ALL TYPES", "481  MOKABA
   * MOKABA STREET". pdf.js collapses those and a reader that works from the file's own bytes does
   * not, so the same document produced two slightly different tokens depending on which reader
   * ran -- and the same job was recorded twice, because its dedupe key differed by one space.
   *
   * Doing it at the door means the two readers cannot drift, and it is right on its own terms: a
   * double space inside a company name is how the PDF was laid out, not a fact about the company.
   */
  const clean = tokens
    .map((t) => t.replace(/ /g, ' ').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 0)
  const kind = traceKind(clean)
  if (kind === null) return null
  const block = sections(clean)

  const subject = kind === 'commercial'
    ? labelled(clean, 'company name')
    : /* A consumer report's title line is "CONSUMER REPORT - NAME, ID". */
      (/^CONSUMER REPORT\s*-\s*(.+?),\s*\d{13}\s*$/i.exec(clean[0] ?? '')?.[1] ?? null)

  return {
    kind,
    subjectName: subject ? titleCase(subject) : null,
    registrationNumber: kind === 'commercial' ? normaliseRegistration(labelled(clean, 'registration number')) : null,
    idNumber: kind === 'consumer' ? labelled(clean, 'id number') : null,
    companyStatus: kind === 'commercial' ? labelled(clean, 'status code of company') : null,
    contactScore: labelled(clean, 'contact score'),
    riskScore: labelled(clean, 'risk score'),
    enquiredOn: (() => {
      const raw = labelled(clean, 'enquiry date')
      if (!raw) return null
      /* The header prints a single-digit month: 16-9-2026. traceDate pads it. */
      return traceDate(raw)
    })(),
    directors: readDirectors(block.get('directors') ?? []),
    judgments: readJudgments(block.get('judgments') ?? [], kind),
    contacts: readContacts(block.get('contacts') ?? []),
    addresses: readAddresses(block.get('addresses') ?? []),
    employment: readEmployment(block.get('employment') ?? []),
    directorships: (() => {
      const t = block.get('directorships') ?? []
      const out: { name: string; status: string | null; appointedOn: string | null }[] = []
      for (let i = 0; i < t.length - 2; i += 1) {
        const name = t[i].trim()
        if (!name || isDate(name) || NOISE.test(name)) continue
        if (/^(commercial name|status|appointment date|created date)$/i.test(name)) continue
        const status = (t[i + 1] ?? '').trim()
        if (!/^(active|resigned)$/i.test(status)) continue
        out.push({
          name: titleCase(name),
          status: status.charAt(0).toUpperCase() + status.slice(1).toLowerCase(),
          appointedOn: traceDate(t[i + 2]),
        })
      }
      return out
    })(),
  }
}
