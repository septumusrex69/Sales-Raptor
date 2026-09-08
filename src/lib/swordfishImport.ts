/**
 * The Swordfish migration, as a pure transform.
 *
 * Lives here rather than in the migration script because it has two callers that must never
 * disagree: `scripts/swordfish/import.mjs` for a dry run at the terminal, and the Data Import
 * screen in Settings for the real thing. Two copies of this logic would mean the run you check
 * and the run you perform are different programs.
 *
 * Nothing here touches a network, a file or a clock beyond `now` — the whole thing is exports
 * in, rows out, so it can be checked without a database.
 *
 * Three rules it exists to enforce:
 *
 *   1. **It never invents money.** Where Swordfish's figure and ours differ, Swordfish's is
 *      written and the difference is reported — most of all for commission, where 60 Growthpoint
 *      accounts arrived on a rate their signed mandate does not allow. Correcting those silently
 *      would rewrite what a client has already been invoiced.
 *   2. **The opening position is the handover, not today.** The exports carry complete history
 *      from the day each account arrived, so the ledgers replay it and today's balance is
 *      derived. Opening at today's figures would be the one number nothing could ever check —
 *      and would double-count: an account paid in full would open owing its whole capital again.
 *   3. **Nothing is dropped silently.** An action nobody can price still imports as history; a
 *      client not in the configuration still imports, under its own name, loudly.
 */
import { num, isoDate, text, type CsvRow } from './csv.ts'
import { codeForLegacyName, isQuarantinedLegacyName } from './actionTariff.ts'
import { rateForCapital, type CommissionSchedule } from './commission.ts'
import { SWORDFISH_CLIENTS, type SwordfishClientSpec } from './swordfishClients.ts'
import { readDebtorsPerClient, type ContactRow, type NoteRow, type PromiseRow } from './swordfishDebtors.ts'

export interface SwordfishExports {
  accounts: CsvRow[]
  payments: CsvRow[]
  actions: CsvRow[]
  interest: CsvRow[]
  /**
   * The client register — the business's own record of who its clients are, one row per
   * Swordfish client record. Optional: without it the grouping falls back to the hand-written
   * judgements in swordfishClients.ts, which is how this worked before the register existed.
   */
  clients?: CsvRow[]
  /**
   * Debtors Per Client — the debtor themselves: phone numbers, email addresses, the main comment
   * and any promise they are on. Optional, because the first five exports were imported without
   * it; supplying it is what turns a ledger into an account someone can work.
   */
  debtors?: CsvRow[]
}

export interface CompanyRow {
  id: string
  name: string
  industry: string | null
  parent_company_id: string | null
  account_owner_id: string
  code: string | null
  commission_bands: { upTo: number | null; rate: number }[] | null
  commission_bands_source: string | null
  commission_rate: number | null
  registration_number: string | null
  vat_number: string | null
  banking_details: string | null
  contact_person: string | null
  bf_reference: string | null
  register_status: string | null
  liaison: string | null
  marketing_agent: string | null
  classification: string | null
  mandate_signed_at: string | null
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  account_count: number | null
  handover_amount: number | null
  payments_to_date: number | null
}

export interface HandoverRow {
  id: string
  company_id: string
  received_at: string
  capital_amount: number
  accounts_count: number
  reference: string | null
  notes: string
  logged_by: string
}

export interface DebtorAccountRow {
  id: string
  company_id: string
  handover_id: string | null
  swordfish_reference: string
  account_number: string
  client_reference: string | null
  legacy_reference: string | null
  debtor_first_name: string | null
  debtor_surname: string | null
  debtor_id_number: string | null
  capital_handed_over: number
  capital_outstanding: number
  in_duplum_ceiling: number
  commission_rate: number | null
  commission_rate_expected: number | null
  commission_rate_source: string | null
  interest_rate_annual: number
  interest_from: string | null
  prescribed: boolean
  prescription_date: string | null
  last_interrupted_at: string | null
  opening_as_at: string | null
  opening_capital: number
  opening_fees: number
  opening_interest: number
  status: string
  sub_status: string | null
  bucket: string | null
  assigned_to: string | null
  diary_date: string | null
  in_duplum: boolean
  write_off_reason: string | null
  handover_date: string | null
  handover_balance: number | null
  handover_interest: number | null
  handover_legal_fees: number | null
  payments_to_date: number | null
  swordfish_balance_at_import: number | null
  swordfish_fees_at_import: number | null
  swordfish_assigned_to: string | null
  current_legal_stage: string | null
  legal_stage_date: string | null
  last_action_at: string | null
  last_payment_at: string | null
  source: string
  imported_at: string
}

export interface PaymentRow {
  id: string
  account_id: string
  received_at: string
  amount: number
  method: string | null
  reference: string | null
  depositor_name: string | null
  details: string | null
  paid_to_client: boolean
  reversed_at: string | null
  reversal_reason: string | null
  source: string
}

export interface FeeRow {
  id: string
  account_id: string
  annexure_item: string | null
  tariff_effective_from: string | null
  description: string
  amount_excl_vat: number
  vat_rate: number
  vat_amount: number
  counts_toward_fee_cap: boolean
  incurred_at: string
  source: string
  payment_id: string | null
  action_code: string | null
  legacy_name: string | null
  segments: number
  billed: boolean
  expense_or_fee: string | null
  destination: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  performed_by: string | null
  swordfish_action_id: string | null
}

export interface AccrualRow {
  id: string
  account_id: string
  accrued_on: string
  days: number
  opening_balance: number
  daily_rate: number
  amount_accrued: number
  amount_recoverable: number
  capitalised: boolean
  source: string
}

export interface ImportPlan {
  companies: CompanyRow[]
  handovers: HandoverRow[]
  debtorAccounts: DebtorAccountRow[]
  payments: PaymentRow[]
  fees: FeeRow[]
  accruals: AccrualRow[]
  contacts: ContactRow[]
  promises: PromiseRow[]
  accountNotes: NoteRow[]
  /** Things that need a person's attention. A plan with problems still imports; it just says so. */
  problems: string[]
  /** Things worth knowing that are not faults. */
  notes: string[]
  stats: {
    capital: number
    paid: number
    paidToClient: number
    feesInclVat: number
    interest: number
    commissionDrift: number
    commissionUnknown: number
    feeCeilingHit: number
    freeBillableActions: number
    unbilledEvents: number
  }
}

export interface BuildOptions {
  /** The Raptor user who will own every imported client. Never defaulted — see the UI. */
  ownerId: string
  /** Restrict to clients whose Swordfish name contains this. For a trial run on real data. */
  only?: string
  now?: Date
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : // Node 18 and jsdom both have randomUUID; this is only a guard so the module never throws.
      `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`

function* walk(specs: SwordfishClientSpec[]): Generator<SwordfishClientSpec> {
  for (const s of specs) { yield s; if (s.children) yield* walk(s.children) }
}

export function buildImportPlan(exports: SwordfishExports, options: BuildOptions): ImportPlan {
  const { ownerId, only: onlyRaw, now = new Date() } = options
  const only = onlyRaw?.toLowerCase()
  const nowIso = now.toISOString()
  const today = nowIso.slice(0, 10)

  const problems: string[] = []
  const notes: string[] = []
  const problem = (m: string) => problems.push(m)

  const specs = SWORDFISH_CLIENTS
  const accounts = only
    ? exports.accounts.filter((r) => (r['Client'] ?? '').toLowerCase().includes(only))
    : exports.accounts

  /* ---------------------------------------------------------------- clients */

  /*
   * Swordfish's Client field conflates three things: the client, the sub-entity and the handover
   * batch. Growthpoint appears four times and is one client; Adowa appears twice and is one
   * parent with two properties that each keep their own book. swordfishClients.json holds those
   * judgements as reviewable data rather than as code — see its own header for why.
   */
  const companies: CompanyRow[] = []
  const companyBySwordfishName = new Map<string, string>()

  const uniqueRate = (byPrefix?: Record<string, number>) => {
    const rates = [...new Set(Object.values(byPrefix ?? {}))]
    return rates.length === 1 ? rates[0] : null
  }

  function addCompany(spec: SwordfishClientSpec, parentId?: string): string {
    const id = newId()
    companies.push({
      id,
      name: spec.name,
      industry: spec.industry ?? null,
      parent_company_id: parentId ?? null,
      account_owner_id: ownerId,
      code: Object.keys(spec.commissionByPrefix ?? {})[0]?.split('/')[0] ?? null,
      commission_bands: spec.commissionBands?.bands ?? null,
      commission_bands_source: spec.commissionBands?.source ?? null,
      // A single rate only where there is genuinely one. A client on a scale has no flat rate,
      // and writing the first band's rate here would read as a fact when it is a guess.
      commission_rate: uniqueRate(spec.commissionByPrefix),
      registration_number: null,
      vat_number: null,
      banking_details: null,
      contact_person: null,
      bf_reference: null,
      register_status: null,
      liaison: null,
      marketing_agent: null,
      classification: null,
      mandate_signed_at: null,
      phone: null,
      email: null,
      address: null,
      city: null,
      account_count: null,
      handover_amount: null,
      payments_to_date: null,
    })
    for (const sw of spec.swordfish ?? []) companyBySwordfishName.set(sw, id)
    for (const child of spec.children ?? []) addCompany(child, id)
    return id
  }

  /* ------------------------------------------------ clients, from the register */

  /*
   * Where the register is supplied it wins, because it is the business's own record rather than
   * a judgement I made from naming conventions.
   *
   * The identity is the **company registration number**. That is what proves four rows named
   * "ABSTO ... -1" through "-4" are one company. The BF reference cannot do that job: ABSTO's
   * four rows share CLIENTS0591, but Agri Saad's three commission tiers carry three different
   * references while sharing one registration number. A legal identity holds where a filing
   * convention does not.
   *
   * Each row is one commission tier, keyed by Swordfish's prefix. Collected across a company's
   * rows they are its scale — and the register knows about tiers no account has reached yet, so
   * this is the only place the full scale is visible. Accelerate Fitness reads as a flat 30%
   * from the accounts alone; the register shows 30 / 25 / 20 / 15.
   */
  function buildFromRegister(rows: CsvRow[]) {
    const byRegistration = new Map<string, CsvRow[]>()
    for (const r of rows) {
      const name = text(r['Client'])
      if (!name) continue
      // Falling back to the name keeps a row with no registration number rather than dropping a
      // client on a blank cell — it just cannot be grouped with its siblings.
      const key = text(r['COMPANY REG/ID']) ?? text(r['VAT NO']) ?? name
      if (!byRegistration.has(key)) byRegistration.set(key, [])
      byRegistration.get(key)!.push(r)
    }

    for (const [key, group] of byRegistration) {
      /*
       * One registration number is one legal entity, but not always one book.
       *
       * Within the group, rows are sub-grouped by their base name — the Swordfish name with the
       * commission-tier suffix and the handover year stripped off. Where that leaves one name,
       * the rows are tiers of a single client. Where it leaves several, they are genuinely
       * different sub-entities and become children of a parent.
       *
       * That distinction is the difference between Agri Saad and Adowa. "Agri Saad -1..-3" all
       * reduce to "Agri Saad" — three commission tiers, one book, even though the register gives
       * each its own BF reference. Adowa's two rows reduce to "Ellis Park" and "Frederick
       * Street" — one company, two properties, each with its own book, which is how the business
       * asked for them.
       */
      const subGroups = new Map<string, CsvRow[]>()
      for (const r of group) {
        const base = baseName(text(r['Client']) ?? '')
        if (!subGroups.has(base)) subGroups.set(base, [])
        subGroups.get(base)!.push(r)
      }

      if (subGroups.size > 1) {
        // The parent carries the identity and the totals; the children carry the books. Named by
        // what the sub-entities have in common, so "Adowa Property Managers (Pty) Ltd - Ellis
        // Park" and "... -Frederick Street" give a parent called "Adowa Property Managers".
        const parentId = addRegisterCompany(commonPrefix([...subGroups.keys()]) || key, group, null, false)
        for (const [subName, rows] of subGroups) addRegisterCompany(subName, rows, parentId)
      } else {
        addRegisterCompany([...subGroups.keys()][0] || key, group, null)
      }
    }
  }

  /**
   * A Swordfish client name with the bits that are filing conventions taken off: the trailing
   * commission-tier suffix ("-1", " - 2") and then a handover year. What is left is the client.
   */
  function baseName(raw: string): string {
    return raw
      .replace(/\s*[-–]\s*\d+\s*$/, '')
      .replace(/\s+(19|20)\d{2}\s*$/, '')
      .trim()
  }

  /** The longest leading run of whole words every name shares. */
  function commonPrefix(names: string[]): string {
    if (names.length === 0) return ''
    const split = names.map((n) => n.split(/\s+/))
    const words: string[] = []
    for (let i = 0; i < split[0].length; i++) {
      const w = split[0][i]
      if (!split.every((parts) => parts[i] === w)) break
      words.push(w)
    }
    return words.join(' ').replace(/[-–,]\s*$/, '').trim()
  }

  function addRegisterCompany(
    name: string,
    group: CsvRow[],
    parentId: string | null,
    holdsAccounts = true,
  ): string {
    {
      const first = group[0]

      // Tiers, ordered as the register orders them: highest rate first, which is the smallest
      // debt. Only rates that actually differ make a scale.
      const tiers = group
        .map((r) => ({ prefix: text(r['Prefix']), rate: num(r['PERCENTAGE']) }))
        .filter((t): t is { prefix: string; rate: number } => !!t.prefix && t.rate !== undefined)
      const rates = [...new Set(tiers.map((t) => t.rate))]

      const id = newId()
      companies.push({
        id,
        name,
        industry: null,
        parent_company_id: parentId,
        account_owner_id: ownerId,
        code: tiers[0]?.prefix.split('/')[0] ?? null,
        // The register gives rates but not the capital boundaries between them — those are in
        // the signed mandate. So the scale is recorded as a flat rate only where there is
        // genuinely one, and the bands come from the mandate below.
        commission_bands: null,
        commission_bands_source: null,
        commission_rate: rates.length === 1 ? rates[0] : null,
        registration_number: text(first['COMPANY REG/ID']),
        vat_number: text(first['VAT NO']),
        banking_details: text(first['BANKING DETAILS']),
        contact_person: text(first['CONTACT PERSON']),
        bf_reference: text(first['BF Reference']),
        register_status: text(first['Active / Dormant']),
        // "Assigned To" is filled on a client's first row and "Assigned Dup" on the rest, so
        // either can be the one that carries the name.
        liaison: group.map((r) => text(r['Assigned To']) ?? text(r['Assigned Dup'])).find(Boolean) ?? null,
        marketing_agent: text(first['Source']),
        classification: ['A', 'B', 'C', 'D'].includes(text(first['Ranking']) ?? '') ? text(first['Ranking']) : null,
        mandate_signed_at: group.map((r) => isoDate(r['Sign Date'])).find(Boolean) ?? null,
        phone: text(first['CONTACT NO']),
        email: text(first['EMAIL']),
        address: [text(first['ADDRESS 1']), text(first['ADDRESS 2'])].filter(Boolean).join(', ') || null,
        city: text(first['ADDRESS 3']),
        // Summed across the tiers: they are one client's book however it is filed.
        account_count: sumOf(group, 'Qty Handed Over Accounts'),
        handover_amount: sumOf(group, 'Sum of Capital on Default'),
        payments_to_date: sumOf(group, 'Sum of Payments To Date'),
      })

      // A parent holds no accounts of its own; its children do. Pointing Swordfish's names at
      // the parent too would put every account on the parent and leave the children empty.
      if (holdsAccounts) {
        for (const r of group) {
          const sw = text(r['Client'])
          if (sw) companyBySwordfishName.set(sw, id)
        }
      }
      for (const t of tiers) registerRateByPrefix.set(t.prefix, t.rate)

      // The mandate's bands, matched to this client by name. The register cannot express them —
      // it has rates but not the capital boundaries they apply at — so this is the one thing
      // the hand-written configuration is still needed for.
      const spec = [...walk(specs)].find((x) => x.commissionBands
        && (x.swordfish ?? []).some((n) => group.some((r) => text(r['Client']) === n)))
      if (spec?.commissionBands) {
        const c = companies[companies.length - 1]
        c.commission_bands = spec.commissionBands.bands
        c.commission_bands_source = spec.commissionBands.source
      }
      return id
    }
  }

  const sumOf = (rows: CsvRow[], column: string) => {
    const values = rows.map((r) => num(r[column])).filter((v): v is number => v !== undefined)
    return values.length ? values.reduce((t, v) => t + v, 0) : null
  }

  const registerRateByPrefix = new Map<string, number>()
  if (exports.clients?.length) buildFromRegister(exports.clients)

  const present = new Set(accounts.map((r) => (r['Client'] ?? '').trim()))
  const inSlice = (spec: SwordfishClientSpec): boolean =>
    (spec.swordfish ?? []).some((n) => present.has(n)) || (spec.children ?? []).some(inSlice)
  if (!exports.clients?.length) for (const spec of specs) if (!only || inSlice(spec)) addCompany(spec)

  // Anything Swordfish names that the configuration has not decided about. Imported under its own
  // name rather than dropped — losing accounts is worse than a client record somebody has to
  // merge — but reported loudly, because an unplanned client is usually a stale export.
  for (const name of present) {
    if (!name || companyBySwordfishName.has(name)) continue
    companyBySwordfishName.set(name, addCompany({ name, swordfish: [name] }))
    problem(`"${name}" is not in the client configuration — imported as its own client. Check whether it belongs under an existing one.`)
  }

  const companyById = new Map(companies.map((c) => [c.id, c]))
  const scheduleFor = (companyId: string): CommissionSchedule | undefined => {
    const c = companyById.get(companyId)
    return c?.commission_bands ? { source: c.commission_bands_source ?? '', bands: c.commission_bands } : undefined
  }
  const rateForPrefix = (prefix: string): number | undefined => {
    // The register is the business's own record of what each tier charges, so it outranks the
    // rates transcribed by hand.
    const fromRegister = registerRateByPrefix.get(prefix)
    if (fromRegister !== undefined) return fromRegister
    for (const spec of walk(specs)) {
      const r = spec.commissionByPrefix?.[prefix]
      if (r !== undefined) return r
    }
    return undefined
  }

  /* -------------------------------------------------------------- handovers */

  /*
   * A handover is a batch the client actually sent: one client, one date. Keyed on the *real*
   * client, not the Swordfish record — Growthpoint's GPS3/1 and GPS3/2 rows dated 2024/05/14 are
   * one delivery of 67 accounts, split by commission tier for Swordfish's convenience and for no
   * reason that survives the migration.
   */
  const handovers: HandoverRow[] = []
  const handoverByKey = new Map<string, HandoverRow>()
  for (const r of accounts) {
    const companyId = companyBySwordfishName.get((r['Client'] ?? '').trim())
    const when = isoDate(r['Load Date'])
    if (!companyId || !when) continue
    const key = `${companyId}|${when}`
    let h = handoverByKey.get(key)
    if (!h) {
      h = {
        id: newId(),
        company_id: companyId,
        received_at: `${when}T00:00:00Z`,
        capital_amount: 0,
        accounts_count: 0,
        reference: null,
        notes: 'Migrated from Swordfish.',
        logged_by: ownerId,
      }
      handovers.push(h)
      handoverByKey.set(key, h)
    }
    h.accounts_count++
    h.capital_amount += num(r['Capital on Default']) ?? num(r['Handover Balance']) ?? 0
  }

  /* --------------------------------------------------------------- accounts */

  const debtorAccounts: DebtorAccountRow[] = []
  const accountByRef = new Map<string, DebtorAccountRow>()
  let commissionDrift = 0
  let commissionUnknown = 0

  for (const r of accounts) {
    const ref = (r['Swordfish Reference'] ?? '').trim()
    if (!ref) { problem('An account row has no Swordfish Reference and was skipped.'); continue }
    if (accountByRef.has(ref)) { problem(`${ref} appears twice in the summary; the second row was skipped.`); continue }

    const companyId = companyBySwordfishName.get((r['Client'] ?? '').trim())
    if (!companyId) { problem(`${ref} has no client and was skipped.`); continue }

    const loadDate = isoDate(r['Load Date']) ?? null
    const capital = num(r['Capital on Default']) ?? num(r['Handover Balance'])
    if (capital === undefined) problem(`${ref} has no capital figure. Imported at zero — it will read as a settled account until someone corrects it.`)

    // The rate Swordfish billed, read off the client record it was filed under.
    const prefix = (r['Client Prefix'] ?? '').trim()
    const billedRate = rateForPrefix(prefix)
    if (billedRate === undefined) {
      commissionUnknown++
      problem(`${ref}: prefix "${prefix}" has no rate in the client configuration — commission left unresolved.`)
    }

    // What the mandate calls for. Reported, never applied: see rule 1 in the header.
    const schedule = scheduleFor(companyId)
    const expected = schedule && capital !== undefined ? rateForCapital(capital, schedule) : undefined
    if (expected !== undefined && billedRate !== undefined
      && Math.round(expected * 10000) !== Math.round(billedRate * 10000)) commissionDrift++

    // Prescription: Swordfish gives days remaining rather than the date.
    const days = num(r['Days To Prescription'])
    let prescriptionDate: string | null = null
    if (days !== undefined) {
      const d = new Date(`${today}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + Math.round(days))
      prescriptionDate = d.toISOString().slice(0, 10)
    }

    const a: DebtorAccountRow = {
      id: newId(),
      company_id: companyId,
      handover_id: loadDate ? handoverByKey.get(`${companyId}|${loadDate}`)?.id ?? null : null,
      swordfish_reference: ref,
      account_number: ref,
      client_reference: text(r['Client Reference']),
      legacy_reference: text(r['Old Client Reference']) ?? text(r['Previous Swordfish Reference']),

      debtor_first_name: text(r['First Name']),
      debtor_surname: text(r['Surname']),
      debtor_id_number: text(r['ID Number']),

      capital_handed_over: capital ?? 0,
      // At the opening position — the handover — capital outstanding is the capital handed over,
      // by definition. The payment ledger reduces it from there.
      capital_outstanding: capital ?? 0,
      // In duplum caps non-capital at the capital outstanding when the debt was handed over, so
      // the ceiling is that capital, not twice it — the *balance* may reach twice capital, which
      // is the same rule stated about a different number. Fixed here and never recalculated.
      in_duplum_ceiling: capital ?? 0,

      commission_rate: billedRate ?? null,
      commission_rate_expected: expected ?? null,
      commission_rate_source: schedule?.source ?? null,

      interest_rate_annual: num(r['Current Interest Rate']) ?? 24,
      interest_from: isoDate(r['Initial Interest Date']) ?? loadDate,

      prescribed: r['Is Prescribed'] === 'Yes',
      prescription_date: prescriptionDate,
      last_interrupted_at: null,

      // See rule 2 in the header: the opening position is the handover.
      opening_as_at: loadDate,
      opening_capital: capital ?? 0,
      opening_fees: 0,
      opening_interest: 0,

      status: text(r['Status']) ?? 'Active',
      sub_status: text(r['Sub-status']),
      bucket: text(r['Account Bucket']),
      assigned_to: null,
      diary_date: isoDate(r['Diary Date']) ?? null,

      in_duplum: r['In Duplum'] === 'Yes',
      write_off_reason: text(r['Write Off Reason']),
      handover_date: loadDate,
      handover_balance: num(r['Handover Balance']) ?? null,
      handover_interest: num(r['Interest Portion']) ?? null,
      handover_legal_fees: num(r['Legal Fee Portion']) ?? null,
      payments_to_date: num(r['Payments To Date']) ?? null,
      // Swordfish's closing position, kept so the replayed ledgers can be checked against the
      // system they came from. Never used as a balance — only to prove one.
      swordfish_balance_at_import: num(r['Current Balance']) ?? null,
      swordfish_fees_at_import: num(r['All Fees (inc VAT + FCC)']) ?? null,
      swordfish_assigned_to: text(r['Assigned To']),
      current_legal_stage: text(r['Current Legal Stage']),
      legal_stage_date: isoDate(r['Date of Current Legal Stage']) ?? null,
      last_action_at: isoDate(r['Last Action Date']) ?? null,
      last_payment_at: isoDate(r['Last Payment Date']) ?? null,
      source: 'swordfish',
      imported_at: nowIso,
    }
    debtorAccounts.push(a)
    accountByRef.set(ref, a)
  }

  /* --------------------------------------------------------------- payments */

  const payments: PaymentRow[] = []
  let orphanPayments = 0
  for (const p of exports.payments) {
    const acc = accountByRef.get((p['Swordfish Reference'] ?? '').trim())
    if (!acc) { orphanPayments++; continue }
    const when = isoDate(p['Payment Date'])
    const amount = num(p['Payment Amount'])
    if (!when || amount === undefined) {
      problem(`A payment on ${p['Swordfish Reference']} has no date or amount and was skipped.`)
      continue
    }
    const type = (p['Payment Type'] ?? '').trim()
    const reversed = isoDate(p['Reversal Date'])
    payments.push({
      id: newId(),
      account_id: acc.id,
      received_at: `${when}T00:00:00Z`,
      amount,
      method: type || null,
      reference: text(p['Bank Reference']) ?? text(p['Voucher Number']),
      depositor_name: text(p['Payment Depositor Name']),
      details: text(p['Payment Details']),
      // The client took the money directly and owes us our share. Still a full payment on the
      // account; it settles in the month-end reconciliation rather than arriving in our trust
      // account. Read off Payment Type, which states it, rather than matched out of the free-text
      // details, which merely tend to mention it.
      paid_to_client: type === 'Client Direct',
      // No reversals in the migrated data, but a reversal is a fact about a payment and has to
      // survive the import if one ever appears in a later export.
      reversed_at: reversed ? `${reversed}T00:00:00Z` : null,
      reversal_reason: text(p['Reversal Reason']),
      source: 'swordfish',
    })
  }

  /* ------------------------------------------------------------------- fees */

  const fees: FeeRow[] = []
  let orphanActions = 0
  let unbilledEvents = 0
  let quarantined = 0
  let quarantinedValue = 0
  const unmappedCharged = new Map<string, { n: number; total: number }>()

  for (const a of exports.actions) {
    const acc = accountByRef.get((a['Swordfish Reference'] ?? '').trim())
    if (!acc) { orphanActions++; continue }
    const when = isoDate(a['Action Date'])
    if (!when) continue

    const name = (a['Action Name'] ?? '').trim()
    const excl = num(a['Action Cost (excl VAT)']) ?? 0
    const code = codeForLegacyName(name)

    // Most of what Swordfish records are audit events — a file uploaded, a sub-status changed.
    // They belong in the account's history but were never billable, so they import as fees of
    // zero rather than being dropped: the history is the point, not the money.
    if (!code && excl === 0) unbilledEvents++

    // A name nobody can classify keeps its history but not its money — a fee filed under a
    // guessed Annexure B item is a wrong statement waiting to be reissued.
    const held = isQuarantinedLegacyName(name)
    if (held) { quarantined++; quarantinedValue += excl }
    if (!code && excl > 0 && !held) {
      const cur = unmappedCharged.get(name) ?? { n: 0, total: 0 }
      cur.n++; cur.total += excl
      unmappedCharged.set(name, cur)
    }

    const cancelled = isoDate(a['Cancel Date']) ?? null
    fees.push({
      id: newId(),
      account_id: acc.id,
      annexure_item: null,
      tariff_effective_from: null,
      description: name || 'Action',
      amount_excl_vat: excl,
      vat_rate: num(a['Action VAT Rate']) ?? 15,
      vat_amount: num(a['Action VAT Charged']) ?? 0,
      // A held fee stays visible but out of the recoverable total until it is classified.
      counts_toward_fee_cap: !held,
      incurred_at: `${when}T00:00:00Z`,
      source: 'swordfish',
      payment_id: null,
      action_code: code ?? null,
      legacy_name: name || null,
      segments: Math.max(1, Math.round(num(a['SMS Count']) ?? 1)),
      // False for an action taken past the Annexure B ceiling, or one that was never chargeable.
      // Both are real history; neither is revenue.
      billed: excl > 0,
      expense_or_fee: text(a['Expense or Fee']),
      destination: text(a['Action Destination']),
      cancelled_at: cancelled,
      cancel_reason: text(a['Cancel Reason']),
      performed_by: text(a['User']),
      swordfish_action_id: text(a['Action ID']),
    })
  }
  for (const [name, v] of unmappedCharged) {
    problem(`${v.n} charged actions named "${name}" (R${v.total.toFixed(2)} excl VAT) have no catalogue entry. Imported at their charged price with no action code.`)
  }

  /* --------------------------------------------------------------- interest */

  const accruals: AccrualRow[] = []
  let orphanInterest = 0
  const seenPeriod = new Set<string>()
  for (const r of exports.interest) {
    const acc = accountByRef.get((r['Swordfish Reference'] ?? '').trim())
    if (!acc) { orphanInterest++; continue }
    const from = isoDate(r['Date From'])
    const to = isoDate(r['Date To'])
    if (!from || !to) continue
    const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000))
    // The unique key is (account, start, days). Concurrent accrual streams legitimately share a
    // start date — 804 accounts do — but an identical period twice would double-count.
    const key = `${acc.id}|${from}|${days}`
    if (seenPeriod.has(key)) {
      problem(`${r['Swordfish Reference']}: the period ${from}..${to} appears twice; the second was skipped.`)
      continue
    }
    seenPeriod.add(key)
    const amount = num(r['Interest Added']) ?? 0
    accruals.push({
      id: newId(),
      account_id: acc.id,
      accrued_on: from,
      days,
      opening_balance: 0,
      daily_rate: 0,
      amount_accrued: amount,
      // Swordfish's figure is already the recoverable one: it stops accruing at the in duplum
      // ceiling rather than accruing and then writing back. So the two are equal on import and
      // diverge only once Raptor's own engine starts accruing.
      amount_recoverable: amount,
      capitalised: true,
      source: 'swordfish',
    })
  }

  /* ----------------------------------------------------------------- report */

  const orphanMessage = (n: number, what: string) =>
    `${n} ${what} belong to accounts not in this import and were skipped.`
  for (const [n, what] of [[orphanPayments, 'payments'], [orphanActions, 'actions'], [orphanInterest, 'interest periods']] as const) {
    if (!n) continue
    // On a slice that is the rest of the book, which is the point of a slice, not a fault.
    ;(only ? notes : problems).push(orphanMessage(n, what))
  }
  if (unbilledEvents) notes.push(`${unbilledEvents} actions were audit events with no charge. Imported as history at zero.`)
  if (quarantined) notes.push(`${quarantined} fees totalling R${quarantinedValue.toFixed(2)} excl VAT are held out of the recoverable total pending classification.`)

  /*
   * A client the register puts on a scale but whose mandate we do not hold.
   *
   * The register gives the rates; only the mandate gives the capital boundaries between them.
   * Without those, an account's expected rate cannot be computed and the drift check is blind
   * for that client — so this names exactly which mandates are worth digging out of the filing
   * cabinet, rather than leaving the gap silent.
   */
  const scaledWithoutBands = companies.filter((c) => c.commission_rate === null && !c.commission_bands
    && [...registerRateByPrefix.keys()].some((p) => p.startsWith(c.code ?? '\u0000')))
  for (const c of scaledWithoutBands) {
    notes.push(`${c.name} is on a commission scale in the register but has no signed mandate on file, so the capital boundaries between its rates are unknown. Its accounts import at the rate they were billed and cannot be checked against a mandate.`)
  }

  const oddIds = debtorAccounts.filter((a) => a.debtor_id_number && !/^\d{13}$/.test(a.debtor_id_number)).length
  if (oddIds) notes.push(`${oddIds} accounts have something other than a 13-digit ID in the ID field. Imported as found — it is Swordfish's data, not a mapping fault.`)

  const chargedPerAccount = new Map<string, number>()
  for (const f of fees) chargedPerAccount.set(f.account_id, (chargedPerAccount.get(f.account_id) ?? 0) + f.amount_excl_vat)
  const ceiling = Math.max(0, ...chargedPerAccount.values())
  const feeCeilingHit = [...chargedPerAccount.values()].filter((v) => v >= ceiling * 0.75).length

  /* ------------------------------------------------- debtors per client */

  /*
   * The sixth export, applied last because it enriches accounts the other five built.
   *
   * It is matched on Swordfish Reference, and a row that matches nothing is REPORTED rather than
   * dropped in silence: a debtor whose account is missing means the two exports were taken at
   * different times, which is worth knowing before anybody works from the result.
   */
  const contacts: ContactRow[] = []
  const promises: PromiseRow[] = []
  const accountNotes: NoteRow[] = []

  if (exports.debtors?.length) {
    const d = readDebtorsPerClient(exports.debtors, now)
    problems.push(...d.problems)
    notes.push(...d.notes)

    let matched = 0
    let unmatched = 0
    for (const [ref, patch] of d.patches) {
      const account = accountByRef.get(ref)
      if (!account) { unmatched++; continue }
      matched++
      // Only overwrite where this export actually has something. A blank column here must not
      // erase a name the account summary supplied.
      for (const [k, v] of Object.entries(patch)) {
        if (v !== null && v !== undefined) (account as unknown as Record<string, unknown>)[k] = v
      }
      for (const c of d.contactsByRef.get(ref) ?? []) contacts.push({ ...c, account_id: account.id })
      for (const p of d.promisesByRef.get(ref) ?? []) promises.push({ ...p, account_id: account.id })
      for (const n of d.notesByRef.get(ref) ?? []) accountNotes.push({ ...n, account_id: account.id })
    }

    notes.push(`Debtor details matched ${matched.toLocaleString('en-ZA')} of ${d.stats.rows.toLocaleString('en-ZA')} rows.`)
    if (unmatched) {
      problems.push(
        `${unmatched} debtors in Debtors Per Client have no matching account in the Client Account `
        + `Summary. The two exports were probably taken at different times.`,
      )
    }
    const withoutDetails = debtorAccounts.length - matched
    if (withoutDetails > 0) {
      notes.push(`${withoutDetails.toLocaleString('en-ZA')} accounts got no debtor details — they are not in that export.`)
    }
  }

  return {
    companies,
    handovers,
    debtorAccounts,
    payments,
    fees,
    accruals,
    contacts,
    promises,
    accountNotes,
    problems,
    notes,
    stats: {
      capital: debtorAccounts.reduce((t, a) => t + a.capital_handed_over, 0),
      paid: payments.reduce((t, p) => t + p.amount, 0),
      paidToClient: payments.filter((p) => p.paid_to_client).length,
      feesInclVat: fees.reduce((t, f) => t + f.amount_excl_vat + f.vat_amount, 0),
      interest: accruals.reduce((t, i) => t + i.amount_accrued, 0),
      commissionDrift,
      commissionUnknown,
      feeCeilingHit,
      freeBillableActions: fees.filter((f) => f.action_code && !f.billed).length,
      unbilledEvents,
    },
  }
}

/**
 * The tables an import writes, in dependency order. Exported so the writer and the wipe agree
 * about what an import consists of, rather than each keeping its own list.
 */
export const IMPORT_TABLES = [
  'companies', 'handovers', 'debtor_accounts', 'account_payments', 'account_fees',
  'account_interest_accruals', 'account_contacts', 'promises_to_pay', 'account_notes',
] as const

/**
 * What a wipe clears, in reverse dependency order.
 *
 * Deliberately an explicit list rather than every table: profiles, teams and targets are
 * configuration a person set up by hand, and an import must never be the thing that deletes them.
 */
export const WIPE_TABLES = [
  'account_documents', 'account_notes', 'promises_to_pay', 'account_contacts',
  'account_interest_accruals', 'account_fees', 'payment_allocations', 'account_payments',
  'debtor_accounts', 'handovers', 'notifications', 'activities', 'tasks', 'proposals',
  'deals', 'contacts', 'leads', 'companies',
] as const

export function planRows(plan: ImportPlan): Record<(typeof IMPORT_TABLES)[number], object[]> {
  return {
    companies: plan.companies,
    handovers: plan.handovers,
    debtor_accounts: plan.debtorAccounts,
    account_payments: plan.payments,
    account_fees: plan.fees,
    account_interest_accruals: plan.accruals,
    account_contacts: plan.contacts,
    promises_to_pay: plan.promises,
    account_notes: plan.accountNotes,
  }
}
