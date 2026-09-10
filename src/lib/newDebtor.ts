/**
 * Taking a debtor account by hand.
 *
 * Almost every account in the book arrived through a Swordfish handover file. Some do not: a
 * client phones one in, or sends a single account by email, and until now there was no way to get
 * it into Raptor at all — the only door was a bulk import of the whole book.
 *
 * This is the validation for that door, kept apart from the database so it can be tested without
 * one. What it guards is narrow but it is the part that matters: an account opens a ledger, and a
 * ledger opened on a wrong capital or a wrong date is wrong in every figure it ever produces.
 */

export interface NewDebtorInput {
  /** Our reference. Optional — suggestReference proposes the next in the client's series. */
  accountNumber: string
  /** The client's own reference for this debtor. */
  clientReference: string
  firstName: string
  surname: string
  /** South African ID. Optional, but checked when given. */
  idNumber: string
  /** Capital as at handover. The account opens here and everything else is movement. */
  capital: string
  handoverDate: string
  /** Percent a year. 24 is standard but negotiable per client and per account. */
  interestRateAnnual: string
  /** Percent of collections. Blank means "not resolved", which is not the same as zero. */
  commissionRate: string
}

export interface Problem {
  field: keyof NewDebtorInput
  message: string
}

const num = (v: string): number | null => {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t.replace(/[\s,]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Whether a South African ID number is real, not merely thirteen digits long.
 *
 * The last digit is a Luhn check over the first twelve, so a transposed pair — the commonest way
 * a number gets typed wrong — fails it. Worth doing: the ID is how a debtor is matched to a trace,
 * a credit bureau record and every other account they hold, and a wrong one matches somebody else.
 */
export function isValidSaId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false
  const month = Number(id.slice(2, 4))
  const day = Number(id.slice(4, 6))
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  let sum = 0
  for (let i = 0; i < 13; i++) {
    let d = Number(id[i])
    // Luhn doubles every second digit counting from the right, which on a 13-digit number is
    // every even-indexed digit from the left.
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

/**
 * The next reference in a client's own series.
 *
 * Each client's accounts run in one numbered series with a fixed prefix — ACF10085, GPS3/10103,
 * APM20097 — and a hand-added account that breaks the pattern is a nuisance forever after: it
 * sorts wrong, it does not match the client's own paperwork, and the next import may collide with
 * it. So the series is read off what is already there rather than left to whoever is typing.
 *
 * Returns null where there is nothing to learn from, and the field stays free text.
 */
export function suggestReference(existing: string[]): string | null {
  const parsed: { prefix: string; digits: string }[] = []
  for (const ref of existing) {
    const m = /^(.*?)(\d+)$/.exec(ref.trim())
    if (m && m[2]) parsed.push({ prefix: m[1], digits: m[2] })
  }
  if (parsed.length === 0) return null

  // The commonest prefix, not the first: a client with a stray legacy reference should not have
  // the whole series renamed after it.
  const counts = new Map<string, number>()
  for (const p of parsed) counts.set(p.prefix, (counts.get(p.prefix) ?? 0) + 1)
  let prefix = ''
  let best = 0
  for (const [k, n] of counts) if (n > best) { prefix = k; best = n }

  const mine = parsed.filter((p) => p.prefix === prefix)
  const width = Math.max(...mine.map((p) => p.digits.length))
  const highest = Math.max(...mine.map((p) => Number(p.digits)))
  return `${prefix}${String(highest + 1).padStart(width, '0')}`
}

/**
 * What is wrong with this account, in the order a person reading the form would meet it.
 *
 * An empty list means it can be saved. Nothing here is a warning — a field either stops the save
 * or it does not, because a form that saves through a warning teaches people to ignore warnings.
 */
export function validateNewDebtor(input: NewDebtorInput, today: string): Problem[] {
  const problems: Problem[] = []

  if (!input.surname.trim()) {
    problems.push({ field: 'surname', message: 'A surname is needed — an account has to be about somebody.' })
  }

  const id = input.idNumber.trim()
  if (id && !isValidSaId(id)) {
    problems.push({
      field: 'idNumber',
      message: /^\d{13}$/.test(id)
        ? 'That is thirteen digits but not a valid ID number — check for a transposed pair.'
        : 'A South African ID number is thirteen digits.',
    })
  }

  const capital = num(input.capital)
  if (capital === null) problems.push({ field: 'capital', message: 'Capital handed over is required.' })
  else if (capital <= 0) problems.push({ field: 'capital', message: 'Capital must be more than nothing.' })

  if (!input.handoverDate) {
    problems.push({ field: 'handoverDate', message: 'The handover date is required — interest runs from it.' })
  } else if (input.handoverDate > today) {
    problems.push({ field: 'handoverDate', message: 'A handover cannot be dated in the future.' })
  }

  const rate = num(input.interestRateAnnual)
  if (rate === null) problems.push({ field: 'interestRateAnnual', message: 'An interest rate is required. Enter 0 if none is charged.' })
  else if (rate < 0) problems.push({ field: 'interestRateAnnual', message: 'An interest rate cannot be negative.' })
  else if (rate > 100) problems.push({ field: 'interestRateAnnual', message: 'That reads as a rate over 100% a year. Check it.' })

  // Blank is allowed and means "not resolved". Zero means "we charge nothing", which is a
  // different fact, and the schema keeps them apart deliberately.
  const commission = num(input.commissionRate)
  if (input.commissionRate.trim() !== '') {
    if (commission === null) problems.push({ field: 'commissionRate', message: 'Commission has to be a number, or blank.' })
    else if (commission < 0 || commission > 100) problems.push({ field: 'commissionRate', message: 'Commission is a percentage between 0 and 100.' })
  }

  return problems
}

/** The row to write, once it validates. Kept here so the shape is tested with the rules. */
export function toAccountRow(input: NewDebtorInput, companyId: string, handoverId: string | null) {
  const capital = num(input.capital) ?? 0
  return {
    company_id: companyId,
    handover_id: handoverId,
    account_number: input.accountNumber.trim() || null,
    client_reference: input.clientReference.trim() || null,
    debtor_first_name: input.firstName.trim() || null,
    debtor_surname: input.surname.trim(),
    debtor_id_number: input.idNumber.trim() || null,
    capital_handed_over: capital,
    capital_outstanding: capital,
    // In duplum is fixed at handover and never recalculated as the balance falls, so it is
    // stamped now rather than derived later.
    in_duplum_ceiling: capital,
    handover_date: input.handoverDate,
    handover_balance: capital,
    opening_capital: capital,
    opening_interest: 0,
    opening_fees: 0,
    opening_as_at: input.handoverDate,
    // Interest runs from the handover, which is what the date is for.
    interest_rate_annual: num(input.interestRateAnnual) ?? 0,
    interest_from: input.handoverDate,
    commission_rate: input.commissionRate.trim() === '' ? null : num(input.commissionRate),
    status: 'Active: Activated',
    source: 'manual',
  }
}
