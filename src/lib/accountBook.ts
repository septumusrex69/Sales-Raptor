/**
 * Reading the collections book.
 *
 * The account tables are not in AppStore: it holds the sales side, which is a few hundred rows a
 * person edits, while the book is hundreds of thousands of rows nobody edits by hand. Loading it
 * into a context on every page would make the whole app wait for data most screens never use.
 * So these are direct, paged queries against Supabase, called by the screens that need them.
 *
 * Everything here is read-only. Writing to the ledgers is the collections engine's job, and it
 * does not exist yet — with one deliberate exception: accountCharges.ts raises an Annexure B fee
 * when the app takes an action that the tariff prices, and it is the only place that does. The
 * boundary moved on purpose rather than eroding one call site at a time.
 */
import { supabase } from './supabase'

export interface DebtorAccount {
  id: string
  companyId: string
  handoverId: string | null
  accountNumber: string | null
  swordfishReference: string | null
  clientReference: string | null
  debtorFirstName: string | null
  debtorSurname: string | null
  debtorIdNumber: string | null
  capitalHandedOver: number
  capitalOutstanding: number
  inDuplum: boolean
  inDuplumCeiling: number
  commissionRate: number | null
  commissionRateExpected: number | null
  commissionRateSource: string | null
  interestRateAnnual: number
  prescribed: boolean
  prescriptionDate: string | null
  status: string
  subStatus: string | null
  bucket: string | null
  writeOffReason: string | null
  handoverDate: string | null
  paymentsToDate: number | null
  swordfishBalanceAtImport: number | null
  swordfishFeesAtImport: number | null
  swordfishAssignedTo: string | null
  diaryDate: string | null
  lastActionAt: string | null
  lastPaymentAt: string | null
  mainComment: string | null
  mainCommentAt: string | null
  preferredLanguage: string | null
  contactPreference: string | null
  consentStatus: string | null
  debtorTitle: string | null
  debtorInitials: string | null
  debtorSecondName: string | null
  /** Swordfish's own operational flags, semicolon-separated: "Debtor avoiding contact; ...". */
  accountFlags: string | null
  accountRating: number | null
  lastContactMethod: string | null
  ptpSuccessRatio: number | null
}

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come back as untyped JSON from PostgREST. */
const toAccount = (r: any): DebtorAccount => ({
  id: r.id,
  companyId: r.company_id,
  handoverId: r.handover_id,
  accountNumber: r.account_number,
  swordfishReference: r.swordfish_reference,
  clientReference: r.client_reference,
  debtorFirstName: r.debtor_first_name,
  debtorSurname: r.debtor_surname,
  debtorIdNumber: r.debtor_id_number,
  capitalHandedOver: Number(r.capital_handed_over ?? 0),
  capitalOutstanding: Number(r.capital_outstanding ?? 0),
  inDuplum: !!r.in_duplum,
  inDuplumCeiling: Number(r.in_duplum_ceiling ?? 0),
  commissionRate: r.commission_rate === null ? null : Number(r.commission_rate),
  commissionRateExpected: r.commission_rate_expected === null ? null : Number(r.commission_rate_expected),
  commissionRateSource: r.commission_rate_source,
  interestRateAnnual: Number(r.interest_rate_annual ?? 0),
  prescribed: !!r.prescribed,
  prescriptionDate: r.prescription_date,
  status: r.status ?? '',
  subStatus: r.sub_status,
  bucket: r.bucket,
  writeOffReason: r.write_off_reason,
  handoverDate: r.handover_date,
  paymentsToDate: r.payments_to_date === null ? null : Number(r.payments_to_date),
  swordfishBalanceAtImport: r.swordfish_balance_at_import === null ? null : Number(r.swordfish_balance_at_import),
  swordfishFeesAtImport: r.swordfish_fees_at_import === null ? null : Number(r.swordfish_fees_at_import),
  swordfishAssignedTo: r.swordfish_assigned_to,
  diaryDate: r.diary_date,
  lastActionAt: r.last_action_at,
  lastPaymentAt: r.last_payment_at,
  mainComment: r.main_comment ?? null,
  mainCommentAt: r.main_comment_at ?? null,
  preferredLanguage: r.preferred_language ?? null,
  contactPreference: r.contact_preference ?? null,
  consentStatus: r.consent_status ?? null,
  debtorTitle: r.debtor_title ?? null,
  debtorInitials: r.debtor_initials ?? null,
  debtorSecondName: r.debtor_second_name ?? null,
  accountFlags: r.account_flags ?? null,
  accountRating: r.account_rating === null || r.account_rating === undefined ? null : Number(r.account_rating),
  lastContactMethod: r.last_contact_method ?? null,
  ptpSuccessRatio: r.ptp_success_ratio === null || r.ptp_success_ratio === undefined ? null : Number(r.ptp_success_ratio),
})

/** The flags as separate items. Swordfish exports them semicolon-separated in one column. */
export function accountFlagList(a: DebtorAccount): string[] {
  return (a.accountFlags ?? '').split(';').map((f) => f.trim()).filter(Boolean)
}

export interface AccountQuery {
  companyId?: string
  /** Matches account number, client reference, or debtor surname. */
  search?: string
  status?: string
  /** Only accounts whose billed rate disagrees with their mandate. */
  commissionDriftOnly?: boolean
  page?: number
  pageSize?: number
}

export interface AccountPage {
  accounts: DebtorAccount[]
  total: number
}

export async function fetchAccounts(q: AccountQuery = {}): Promise<AccountPage> {
  const pageSize = q.pageSize ?? 50
  const page = q.page ?? 0
  let query = supabase
    .from('debtor_accounts')
    // count: 'exact' is what lets the list say "1 to 50 of 735" rather than "50 shown", which is
    // the difference between a person trusting the page and wondering what is missing.
    .select('*', { count: 'exact' })
    .order('account_number')
    .range(page * pageSize, page * pageSize + pageSize - 1)

  if (q.companyId) query = query.eq('company_id', q.companyId)
  if (q.status) query = query.eq('status', q.status)
  if (q.search?.trim()) {
    const s = q.search.trim().replace(/[%,]/g, '')
    query = query.or(`account_number.ilike.%${s}%,client_reference.ilike.%${s}%,debtor_surname.ilike.%${s}%`)
  }

  const { data, error, count } = await query
  if (error) throw new Error(error.message)
  let accounts = (data ?? []).map(toAccount)
  // Filtered here rather than in SQL: PostgREST cannot compare two columns to each other, and a
  // database view for one screen's filter is more machinery than the question is worth.
  if (q.commissionDriftOnly) accounts = accounts.filter(hasCommissionDrift)
  return { accounts, total: count ?? accounts.length }
}

export function hasCommissionDrift(a: DebtorAccount): boolean {
  if (a.commissionRate === null || a.commissionRateExpected === null) return false
  return Math.round(a.commissionRate * 10000) !== Math.round(a.commissionRateExpected * 10000)
}

export async function fetchAccount(id: string): Promise<DebtorAccount | null> {
  const { data, error } = await supabase.from('debtor_accounts').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toAccount(data) : null
}

export interface LedgerPayment {
  id: string
  receivedAt: string
  amount: number
  method: string | null
  reference: string | null
  details: string | null
  paidToClient: boolean
  reversedAt: string | null
}

export interface LedgerFee {
  id: string
  incurredAt: string
  description: string
  amountExclVat: number
  vatAmount: number
  billed: boolean
  actionCode: string | null
  segments: number
  cancelledAt: string | null
  performedBy: string | null
}

export interface LedgerAccrual {
  id: string
  accruedOn: string
  days: number
  amountAccrued: number
  amountRecoverable: number
}

export interface AccountLedgers {
  payments: LedgerPayment[]
  fees: LedgerFee[]
  accruals: LedgerAccrual[]
  /** Totals over the whole ledger, not just the rows fetched. */
  totals: { paid: number; feesExclVat: number; feesInclVat: number; interest: number; feeCount: number }
}

/**
 * An account's three ledgers, complete.
 *
 * Everything, not a page of it: the balance is computed from these rows, and a balance derived
 * from the most recent few hundred of anything is a wrong number wearing a confident face. The
 * busiest account in the migrated book carries 822 actions, 28 payments and 56 accrual periods,
 * which is a single unremarkable request.
 *
 * Only 77 of those 822 were ever charged. The rest are contact attempts made past the Annexure B
 * ceiling — real history, no money — so the statement stays short while the activity timeline
 * does not.
 */
export async function fetchLedgers(accountId: string): Promise<AccountLedgers> {
  const [payments, fees, accruals] = await Promise.all([
    supabase.from('account_payments').select('*').eq('account_id', accountId).order('received_at', { ascending: false }),
    supabase.from('account_fees').select('*').eq('account_id', accountId).order('incurred_at', { ascending: false }),
    supabase.from('account_interest_accruals').select('*').eq('account_id', accountId).order('accrued_on', { ascending: false }),
  ])
  for (const r of [payments, fees, accruals]) if (r.error) throw new Error(r.error.message)

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const feeRows = (fees.data ?? []) as any[]
  return {
    payments: (payments.data ?? []).map((r: any) => ({
      id: r.id,
      receivedAt: r.received_at,
      amount: Number(r.amount),
      method: r.method,
      reference: r.reference,
      details: r.details,
      paidToClient: !!r.paid_to_client,
      reversedAt: r.reversed_at,
    })),
    fees: (fees.data ?? []).map((r: any) => ({
      id: r.id,
      incurredAt: r.incurred_at,
      description: r.description,
      amountExclVat: Number(r.amount_excl_vat ?? 0),
      vatAmount: Number(r.vat_amount ?? 0),
      billed: !!r.billed,
      actionCode: r.action_code,
      segments: Number(r.segments ?? 1),
      cancelledAt: r.cancelled_at,
      performedBy: r.performed_by,
    })),
    accruals: (accruals.data ?? []).map((r: any) => ({
      id: r.id,
      accruedOn: r.accrued_on,
      days: Number(r.days ?? 1),
      amountAccrued: Number(r.amount_accrued ?? 0),
      amountRecoverable: Number(r.amount_recoverable ?? 0),
    })),
    totals: {
      paid: (payments.data ?? []).reduce((t: number, r: any) => t + Number(r.amount), 0),
      feesExclVat: feeRows.reduce((t, r) => t + Number(r.amount_excl_vat ?? 0), 0),
      feesInclVat: feeRows.reduce((t, r) => t + Number(r.amount_excl_vat ?? 0) + Number(r.vat_amount ?? 0), 0),
      interest: (accruals.data ?? []).reduce((t: number, r: any) => t + Number(r.amount_accrued ?? 0), 0),
      feeCount: feeRows.length,
    },
  }
}

export interface BookSummary {
  accounts: number
  capital: number
  clients: number
  commissionDrift: number
}

/** Headline figures for a client, or for the whole book when no client is given. */
export async function fetchBookSummary(companyId?: string): Promise<BookSummary> {
  let q = supabase.from('debtor_accounts').select('capital_handed_over,commission_rate,commission_rate_expected,company_id')
  if (companyId) q = q.eq('company_id', companyId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows = (data ?? []) as any[]
  return {
    accounts: rows.length,
    capital: rows.reduce((t, r) => t + Number(r.capital_handed_over ?? 0), 0),
    clients: new Set(rows.map((r) => r.company_id)).size,
    commissionDrift: rows.filter((r) =>
      r.commission_rate !== null && r.commission_rate_expected !== null
      && Math.round(Number(r.commission_rate) * 10000) !== Math.round(Number(r.commission_rate_expected) * 10000)).length,
  }
}
