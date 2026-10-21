/**
 * Is this debtor a person or a company, and what do we hold on them?
 *
 * THE FIRM'S OWN INSTRUCTION: "we will have to indicate on Raptor whether a debtor is a company
 * or an individual and distinguish between that. If there's a company, there should be a company
 * registration number and then the ID numbers of the directors should also be stored."
 *
 * WHY THE REGISTRATION NUMBER SHARES A FIELD WITH THE ID NUMBER, and does not get one of its own.
 * A debtor is a person or a company and never both, so the two can never collide — and the whole
 * account screen already switches on `debtorKind`: the panel is headed "Company details", the
 * field is labelled "Registration Number", the trace search key validates it as one. A second
 * column would mean two places to look for the one number a CIPC or bureau lookup is keyed on,
 * and the first time they disagreed nobody would know which was right. The field is the key; what
 * was missing is the flag that says how to read it.
 *
 * THE RULES ONLY. No queries and no imports, so every one of them can be checked without a
 * database — which matters because these decide what gets searched at a bureau, and a wrong key
 * pulls somebody else's report and bills the account for it.
 */

/**
 * A South African company registration number: 2016/210735/07.
 *
 * A bureau prefixes a letter of its own — K2016/210735/07 — and the firm's records do not, so the
 * letter is allowed and stripped. Spaces around the slashes are allowed because people type them.
 *
 * THE LAST PAIR IS THE ENTERPRISE TYPE, not a checksum: 07 a private company, 06 a close
 * corporation, 08 an incorporated, 23 an external company, 21 a non-profit. It is not validated
 * against a list here — the list changes, and refusing to store what a client actually sent helps
 * nobody. The shape is what is checked.
 */
const REGISTRATION = /^([A-Z]?)\s*(\d{4})\s*\/\s*(\d{4,7})\s*\/\s*(\d{2})$/i

/**
 * The number as the firm writes it, or null where it is not one.
 *
 * Normalised on the way in so that two spellings of one company — with the bureau's letter, with
 * spaces — are the same string in the database and a lookup keyed on it matches.
 */
export function normaliseRegistrationNumber(raw: string | null | undefined): string | null {
  const m = REGISTRATION.exec((raw ?? '').trim())
  if (!m) return null
  return `${m[2]}/${m[3]}/${m[4]}`
}

export function looksLikeRegistrationNumber(raw: string | null | undefined): boolean {
  return normaliseRegistrationNumber(raw) !== null
}

export type DebtorKind = 'individual' | 'company'

/**
 * What the number in the identity field says this debtor is.
 *
 * Only ever used to SUGGEST, never to overrule. A registration number in the field is strong
 * evidence — nobody types 2019/123456/07 for a person — but a company whose number was never
 * captured still looks like an individual here, and a book that marked those as people because
 * the field was empty would be worse than one that says nothing.
 */
export function kindFromIdentity(raw: string | null | undefined): DebtorKind | null {
  if (looksLikeRegistrationNumber(raw)) return 'company'
  return null
}

/**
 * What to say about the number in the identity field, if anything.
 *
 * SAID, NEVER ENFORCED. Some records are foreign passports, some clients send a VAT number by
 * mistake, and refusing to store what a collector was actually given loses the only thing anybody
 * has to work from. The warning names what it looks like instead — "not a valid ID" sends
 * somebody hunting for a typo; "it looks like a telephone number" says which field it belongs in,
 * and the book has two dozen of exactly that.
 */
export function identityProblem(kind: DebtorKind, raw: string | null | undefined): string | null {
  const found = (raw ?? '').trim()
  if (found === '') return null

  if (kind === 'company') {
    if (looksLikeRegistrationNumber(found)) return null
    if (/^\d{13}$/.test(found.replace(/\s/g, ''))) {
      return 'That is an ID number, not a registration number. Is this debtor a person?'
    }
    return 'That is not a registration number — it should look like 2016/210735/07.'
  }

  const digits = found.replace(/\s/g, '')
  if (looksLikeRegistrationNumber(found)) {
    return 'That is a company registration number. Mark this debtor as a company.'
  }
  if (!/^\d{13}$/.test(digits)) {
    /* Named, so it gets fixed rather than puzzled over. */
    if (/^0[1-8]\d{8}$/.test(digits)) return 'That looks like a telephone number, not an ID number.'
    return 'That is not 13 digits — check it against the ID.'
  }
  return null
}

/* ---------- the people who signed for a company ---------- */

export interface DirectorInput {
  fullName: string
  idNumber: string | null
  status: 'Active' | 'Resigned' | null
  appointedOn: string | null
}

/**
 * Whether a director can be saved, and what is wrong if not.
 *
 * A NAME IS REQUIRED AND AN ID NUMBER IS NOT, which is the opposite of what it looks like it
 * should be. The ID is the more useful of the two — it is what makes a director traceable in
 * their own right, and `account_directors.id_number` exists for exactly that — but a collector
 * reading a letterhead or a CIPC disclosure often has the names long before the numbers. Refusing
 * the name until the number turns up means the names never get captured at all.
 *
 * `validId` is passed in rather than imported so this file goes on importing nothing.
 */
export function directorProblem(
  input: DirectorInput,
  validId: (id: string) => boolean,
): string | null {
  if (input.fullName.trim() === '') return 'A director needs a name.'
  const id = (input.idNumber ?? '').replace(/\s/g, '')
  if (id === '') return null
  /*
   * LUHN-CHECKED, NOT MERELY THIRTEEN DIGITS. A transposed pair is the commonest way a number is
   * typed wrong and it is thirteen digits either way — so a length check passes exactly the
   * number that traces somebody else, at the firm's expense and on somebody else's record.
   */
  if (!validId(id)) {
    if (!/^\d{13}$/.test(id)) return 'A director’s ID number is 13 digits.'
    return 'That ID number does not check out — a digit is probably transposed.'
  }
  return null
}

/** The director as it should be stored: trimmed, and the ID without the spaces people type. */
export function cleanDirector(input: DirectorInput): DirectorInput {
  const id = (input.idNumber ?? '').replace(/\s/g, '')
  return {
    fullName: input.fullName.trim().replace(/\s+/g, ' '),
    idNumber: id === '' ? null : id,
    status: input.status,
    appointedOn: input.appointedOn || null,
  }
}
