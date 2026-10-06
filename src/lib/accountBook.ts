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
import type { LedgerRows } from './balanceInput.ts'
import type { FrozenBy } from './clientPosition.ts'
import type { ViewCounts } from './accountViews.ts'
import type { PractitionerKind } from './accountStanding.ts'
import type { ExistingAccount } from './handoverImport.ts'
import { debtorKey, type OtherAccount } from './sameDebtor.ts'
import { isWrittenOff } from './accountStatus.ts'
import { fetchAllRows } from './fetchAll.ts'
import type { Book, BookChoice, ClosureKind, HoldReason } from './accountBooks.ts'
import type { ClientCommission } from './commissionRule.ts'
import type { CommissionBand } from './commission.ts'

export interface DebtorAccount {
  id: string
  companyId: string
  handoverId: string | null
  /**
   * RAPTOR'S OWN REFERENCE, and the one every notice quotes.
   *
   * The firm: "so that we can find them easily. If they use the client reference, it's more
   * difficult to find." The book agrees with a number -- the client's reference is used on more
   * than one account 5,013 times over, so 21% of the book cannot be identified by it, and a
   * debtor ringing in with theirs lands on several files at once. This one is unique and never
   * reused. `accountNumber` below is the CREDITOR's, off the client's handover sheet.
   */
  caseNumber: string
  accountNumber: string | null
  swordfishReference: string | null
  /*
   * WHEN THIS FILE CAME ACROSS FROM SWORDFISH, OR NULL IF IT IS A REAL HANDOVER.
   *
   * Carried into the browser because the screen has to be able to SAY why the handover sequence
   * did not run on it. The rule itself lives in the database -- workflow_start_on_allocation -- so
   * this is never the thing that decides, only the thing that explains.
   */
  importedAt: string | null
  /**
   * The client whose book this account is on, where the read embedded it.
   *
   * NULL MEANS NOT ASKED FOR, NOT "no client" -- every account has one, and the column is not
   * null in the database. Only the list embeds it; a single-account read does not, because the
   * account page already has the client from its own query.
   */
  companyName: string | null
  clientReference: string | null
  debtorFirstName: string | null
  debtorSurname: string | null
  debtorIdNumber: string | null
  /**
   * A person or a company, and almost everything a collector does turns on which.
   *
   * It also says how to read debtorIdNumber: an ID number for a person, a registration number for
   * a company. One field, two meanings, and this is the one that disambiguates them — which is
   * cheaper and less error-prone than two columns of which one is always null.
   */
  debtorKind: 'individual' | 'company'
  /**
   * A DUMMY ACCOUNT THE FIRM SIMULATES ON, which is the only thing that lets the test clock
   * rewrite its notice dates. Never true on a real debtor -- the clock sends real emails and SMSs.
   */
  isTestAccount: boolean
  capitalHandedOver: number
  capitalOutstanding: number
  inDuplum: boolean
  inDuplumCeiling: number
  commissionRate: number | null
  commissionRateExpected: number | null
  commissionRateSource: string | null
  /** The billed rate disagrees with the signed mandate. Computed in the database. */
  commissionDrift: boolean
  interestRateAnnual: number
  prescribed: boolean
  prescriptionDate: string | null
  status: string
  subStatus: string | null
  /**
   * Who to deal with when it is no longer the debtor.
   *
   * A liquidated company, a sequestrated estate, a deceased debtor, a debtor under debt review:
   * the debt is still owed, but the claim goes to an APPOINTED PRACTITIONER and ringing the
   * debtor is at best wasted time. The firm's sub-status already said the state
   * ('Liquidation/Sequestration') and never the name, so the only copy of who to write to lived
   * in a note or in somebody's head.
   *
   * Null means nobody is appointed and the debtor is still the person to ask.
   */
  practitionerKind: PractitionerKind | null
  practitionerName: string | null
  practitionerFirm: string | null
  /** Their reference for the estate. Every claim submission has to quote it back. */
  practitionerReference: string | null
  practitionerPhone: string | null
  practitionerEmail: string | null
  /** Claims run on deadlines counted from the appointment, not from our handover. */
  practitionerAppointedOn: string | null
  /*
   * THE ESTATE, WHICH IS WHAT THE ACCOUNT BECOMES WHEN THE DEBTOR DIES.
   *
   * THE EXECUTOR IS THE PRACTITIONER ABOVE -- practitioner_kind 'executor', with their name and
   * the estate number in practitioner_reference. These three are what that structure does not
   * hold, and the last of them is the one that costs the client money if it is missed: a claim
   * lodged after the period in the notice to creditors is lost. See estateClaimDeadline.
   */
  dateOfDeath: string | null
  masterOffice: string | null
  noticeToCreditorsOn: string | null
  /*
   * A freeze is three facts, not a label. Carried on the account because "why has this not
   * moved" is asked of a single account far more often than it is reported in bulk.
   */
  frozenBy: FrozenBy | null
  frozenReason: string | null
  frozenAt: string | null
  /*
   * HOW THE ACCOUNT ENDED, AND IT IS NOT `status`. `status` is Swordfish's and says how the row got
   * into the table; an ending is a fact the firm asserts, so it carries who said so and when.
   * Null while the account is still live, which is what clientPosition's `closed` input reads.
   */
  /** SETTLED IS A FOURTH ENDING, not a kind of write-off: both sides agreed and money changed
      hands. Folded in with written off it reads on every report as a debt nobody recovered. */
  endedAs: ClosureKind | null
  /**
   * WHICH BOOK, STRAIGHT OFF THE DATABASE'S OWN GENERATED COLUMN.
   *
   * Read, never computed up here: `bookOf` exists for a row held in memory, and the column is what
   * the list, the tiles and every bulk action narrow on. A screen that worked it out again would
   * be the second source of truth the firm said not to build.
   */
  book: Book
  /** Set only while the account is on hold, with the reason, the date to look again, and who. */
  holdReason: HoldReason | null
  holdNote: string | null
  holdReviewOn: string | null
  holdSince: string | null
  endedOn: string | null
  endedReason: string | null
  endedNote: string | null
  /** What the firm needs from the client before this account can move. Null = nothing owed. */
  clientActionAsk: string | null
  clientActionDue: string | null
  bucket: string | null
  writeOffReason: string | null
  handoverDate: string | null
  /** The three the listing notice is a record of. Null until the submission has actually gone. */
  listingDate: string | null
  listingReference: string | null
  bureausListed: string | null
  /**
   * When the ROW was written -- which for an imported account is the day the handover was
   * approved, and is not the same question as handoverDate.
   *
   * `handover_date` is the day the debt fell due; everything the account is measured by runs from
   * it. This is the day it reached Raptor. The timeline shows both, at the firm's asking: "on the
   * activity timeline it doesn't show which date it's imported -- date it handed over, and
   * imported."
   */
  createdAt: string | null
  paymentsToDate: number | null
  swordfishBalanceAtImport: number | null
  swordfishFeesAtImport: number | null
  swordfishAssignedTo: string | null
  /** Whose desk it is on now, as a profiles.id. Null is the unallocated pile. */
  assignedTo: string | null
  diaryDate: string | null
  lastActionAt: string | null
  lastPaymentAt: string | null
  mainComment: string | null
  mainCommentAt: string | null
  preferredLanguage: string | null
  contactPreference: string | null
  /**
   * The hours this debtor asked to be telephoned in, straight off the jsonb column.
   *
   * `unknown` ON PURPOSE. Everything else here is a scalar the database guarantees the shape of;
   * this one is jsonb, which holds whatever is put in it, and typing it as a window array here
   * would be the type system asserting something nobody checked. parseWindows is where it becomes
   * windows, and anything that is not a pair of times is simply not one.
   */
  contactWindows: unknown
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
  /* Named here like every other column: one missing from this mapper reads as undefined for ever
     and nothing fails -- diary_capacity sat in that state for months. */
  caseNumber: r.case_number,
  accountNumber: r.account_number,
  swordfishReference: r.swordfish_reference,
  importedAt: r.imported_at ?? null,
  /* THE EMBEDDED CLIENT, or null where the read did not ask for it. A single-account fetch does
     not embed, so this is absent rather than wrong there -- and the account page has the client
     from its own query. */
  companyName: (r.companies?.name as string | undefined) ?? null,
  clientReference: r.client_reference,
  debtorFirstName: r.debtor_first_name,
  debtorSurname: r.debtor_surname,
  debtorIdNumber: r.debtor_id_number,
  /* Defaulted here as well as in the database: an old row read before the migration is a person. */
  debtorKind: r.debtor_kind === 'company' ? 'company' : 'individual',
  /* MISSING FROM THIS MAPPER IT READS AS undefined FOR EVER AND NOTHING FAILS -- CLAUDE.md's own
     warning, and here it would silently take the test clock off every account again, which is the
     exact failure this column was added to fix. */
  isTestAccount: !!r.is_test_account,
  capitalHandedOver: Number(r.capital_handed_over ?? 0),
  capitalOutstanding: Number(r.capital_outstanding ?? 0),
  inDuplum: !!r.in_duplum,
  inDuplumCeiling: Number(r.in_duplum_ceiling ?? 0),
  commissionRate: r.commission_rate === null ? null : Number(r.commission_rate),
  commissionRateExpected: r.commission_rate_expected === null ? null : Number(r.commission_rate_expected),
  commissionRateSource: r.commission_rate_source,
  commissionDrift: !!r.commission_drift,
  interestRateAnnual: Number(r.interest_rate_annual ?? 0),
  prescribed: !!r.prescribed,
  prescriptionDate: r.prescription_date,
  status: r.status ?? '',
  subStatus: r.sub_status,
  practitionerKind: (r.practitioner_kind as PractitionerKind | null) ?? null,
  practitionerName: r.practitioner_name ?? null,
  practitionerFirm: r.practitioner_firm ?? null,
  practitionerReference: r.practitioner_reference ?? null,
  practitionerPhone: r.practitioner_phone ?? null,
  practitionerEmail: r.practitioner_email ?? null,
  practitionerAppointedOn: r.practitioner_appointed_on ?? null,
  dateOfDeath: r.date_of_death ?? null,
  masterOffice: r.master_office ?? null,
  noticeToCreditorsOn: r.notice_to_creditors_on ?? null,
  /*
   * THIS MAPPER IS HAND-WRITTEN, so a column added to debtor_accounts does not arrive here on
   * its own — it has to be listed. A field present in the database, in the type and in the
   * select, and missing from this list, reads as undefined forever and nothing fails. See the
   * same note in AuthContext, where diary_capacity sat in exactly that state for months.
   */
  frozenBy: (r.frozen_by as FrozenBy | null) ?? null,
  frozenReason: r.frozen_reason ?? null,
  frozenAt: r.frozen_at ?? null,
  endedAs: (r.ended_as as ClosureKind | null) ?? null,
  /* READ, NOT DERIVED. CLAUDE.md's own warning is about a column that reaches the row and not the
     mapper: it would read as undefined for ever and the list would quietly show the whole book. */
  book: (r.book as Book | null) ?? 'active',
  holdReason: (r.hold_reason as HoldReason | null) ?? null,
  holdNote: r.hold_note ?? null,
  holdReviewOn: r.hold_review_on ?? null,
  holdSince: r.hold_since ?? null,
  endedOn: r.ended_on ?? null,
  endedReason: r.ended_reason ?? null,
  endedNote: r.ended_note ?? null,
  clientActionAsk: r.client_action_ask ?? null,
  clientActionDue: r.client_action_due ?? null,
  bucket: r.bucket,
  writeOffReason: r.write_off_reason,
  handoverDate: r.handover_date,
  /* Named here like every other column -- one missing from this mapper reads as undefined for
     ever and the listing notice would quietly print a placeholder at a debtor. */
  listingDate: r.listing_date,
  listingReference: r.listing_reference,
  bureausListed: r.bureaus_listed,
  createdAt: (r.created_at as string | null) ?? null,
  paymentsToDate: r.payments_to_date === null ? null : Number(r.payments_to_date),
  swordfishBalanceAtImport: r.swordfish_balance_at_import === null ? null : Number(r.swordfish_balance_at_import),
  swordfishFeesAtImport: r.swordfish_fees_at_import === null ? null : Number(r.swordfish_fees_at_import),
  swordfishAssignedTo: r.swordfish_assigned_to,
  assignedTo: r.assigned_to ?? null,
  diaryDate: r.diary_date,
  lastActionAt: r.last_action_at,
  lastPaymentAt: r.last_payment_at,
  mainComment: r.main_comment ?? null,
  mainCommentAt: r.main_comment_at ?? null,
  preferredLanguage: r.preferred_language ?? null,
  contactPreference: r.contact_preference ?? null,
  /* Named here like every other column: one missing from this mapper reads as undefined for ever
     and nothing fails -- and an undefined here is an account that quietly forgets the hours a
     debtor asked to be rung in. */
  contactWindows: r.contact_windows ?? [],
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

/**
 * How the book is narrowed.
 *
 * EVERY ONE OF THESE IS A QUESTION SOMEBODY ASKS OUT LOUD, which is the test each had to pass to
 * be here. "Show me Nedbank's book" and "show me everything handed over in August" are obvious.
 * The ones worth explaining are the three that find neglect rather than accounts:
 *
 *   adrift       — active, and nobody is booked to ring it. 355 accounts arrived from Swordfish
 *                  in exactly that state. It is the firm's own problem, never a debtor's.
 *   neverWorked  — handed over and not one action logged against it since.
 *   quietSince   — nothing logged in N days.
 *
 * Applied in the database, not in the browser. This table reaches six figures, and a filter that
 * loads the book to count it is a filter that stops working the month it matters.
 */
export interface AccountQuery {
  companyId?: string
  /** Matches account number, client reference, or debtor surname. */
  search?: string
  status?: string
  /**
   * WHICH BOOK. The one filter that is on by default and the only one that is.
   *
   * 'whole' and undefined both mean every account; the screen says which it meant. Everything else
   * narrows on the generated column, which is one indexed equality rather than the four `or`s the
   * rule would be written out as -- and, more to the point, rather than a fifth copy of a rule the
   * database already holds.
   */
  book?: BookChoice
  /**
   * The three answers anybody actually gives to "which accounts".
   *
   * The stored status is five values, three of which begin "Active:" and differ only in how the
   * account got there. Nobody asks for "Active: Unfrozen". They ask for the live book, the
   * stopped ones, or the ones already back with the client.
   */
  statusGroup?: 'active' | 'frozen' | 'closed'
  /** The inherited Swordfish sub-status: 'Promise To Pay', 'Delinquent Payer', and so on. */
  subStatus?: string
  bucket?: string
  /** Whose desk it is on. 'nobody' finds the unallocated pile, which is its own kind of problem. */
  assignedTo?: string | 'nobody'
  /**
   * On any of these desks. What a team filter becomes.
   *
   * Resolved to member ids in the browser rather than joined in SQL: team membership lives on
   * profiles, which is a handful of rows the app already holds, and a join would make the
   * account query depend on a table it otherwise never touches.
   *
   * AN EMPTY ARRAY MATCHES NOTHING, on purpose. A team with no members has no accounts, and
   * treating "no members" as "no filter" would answer a question about one team with the whole
   * book — the most dangerous shape a filter can fail in.
   */
  assignedToAny?: string[]
  /**
   * The batch they arrived in.
   *
   * THE FIRM: "the moment after that, it should go into a state where it's ready to allocate and
   * refer the accounts to the clerks." This is what makes "these seven" a list somebody can act
   * on -- the accounts of one handover, filtered in the database like every other clause, so the
   * bulk allocate acts on exactly what was on the screen.
   */
  handoverId?: string
  /** Handed over on or after this date. */
  handedOverFrom?: string
  /** Handed over on or before this date. */
  handedOverTo?: string
  /**
   * ON HOLD AND DUE A LOOK. The manager's weekly queue.
   *
   * 'due' is a hold whose review date has passed -- somebody undertook to come back to it and has
   * not. 'unset' is an account on hold with NO review date at all, which is every frozen account
   * that came across from Swordfish: nobody has ever undertaken to look at it. They are different
   * problems and one list over both would flatten them.
   */
  review?: 'due' | 'unset'
  /** Today, in the firm's zone, for `review`. Passed in: this file has no clock. */
  today?: string
  /** Active, with no diary date: nobody is booked to ring it. */
  adrift?: boolean
  /** Handed over, and not one action logged since. */
  neverWorked?: boolean
  /** Nothing logged on or after this date. Includes accounts never worked at all. */
  quietSince?: string
  /** Prescribes on or before this date, and has not already. */
  prescribingBefore?: string
  /** Interest and fees have hit the in duplum ceiling. */
  inDuplum?: boolean
  /** Waiting on the client for something. The list a monthly report leads with. */
  waitingOnClient?: boolean
  /** Capital outstanding at or above this figure. */
  minOutstanding?: number
  /** Only accounts whose billed rate disagrees with their mandate. */
  commissionDriftOnly?: boolean
  page?: number
  pageSize?: number
  /**
   * WHETHER THE TOTAL IS WORTH WHAT IT COSTS.
   *
   * `count: 'exact'` is a SECOND pass over every row the filters match -- the page itself stops
   * after 50, but the count cannot stop at all. On the book that is the whole table, and the
   * database evaluates the row-level security policy on each row while it goes.
   *
   * THE LIST KEEPS IT, and should: the firm reads "1 to 50 of 735", and "50 shown" is the
   * difference between trusting the page and wondering what is missing. What was paying for it
   * and throwing it away were the SEARCH BOXES -- the mail page's debtor lookup counted every
   * matching account in the book on each keystroke to show eight of them, and never displayed
   * the number. Left null, `total` is simply how many rows came back.
   */
  countRows?: boolean
}

export interface AccountPage {
  accounts: DebtorAccount[]
  total: number
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the builder is generic over PostgREST's
   select and update builders, which do not share a public type. */
/**
 * An AccountQuery, as clauses.
 *
 * ONE PLACE, because two things ask this question and they must not get different answers. The
 * list asks "which accounts", and a bulk action asks "which accounts am I about to change".
 * Written twice, those drift, and the failure is not a wrong list — it is allocating two hundred
 * accounts somebody never saw.
 *
 * Everything here is applied in the database. This table reaches six figures and a filter that
 * loads the book to count it is a filter that stops working the month it matters.
 */
export function applyAccountFilters<T>(query: T, q: AccountQuery): T {
  let out = query as any

  if (q.companyId) out = out.eq('company_id', q.companyId)
  if (q.handoverId) out = out.eq('handover_id', q.handoverId)
  if (q.status) out = out.eq('status', q.status)
  /*
   * THE BOOK FIRST, because it is the one clause that is on unless somebody turned it off, and
   * because a shortcut narrowing inside it must not be able to reach a frozen or closed account.
   * 'whole' is the deliberate absence of this filter and is written out rather than left to a
   * missing value, so "the whole book" is a thing somebody asked for rather than a thing nobody set.
   */
  if (q.book && q.book !== 'whole') out = out.eq('book', q.book)
  /*
   * Prefix matching, not a list of the five values seen today. The import writes whatever
   * Swordfish sends, so 'Active: Reinstated' can arrive tomorrow and would silently fall out of
   * the live book if this were an `in` against values counted this afternoon.
   */
  if (q.statusGroup === 'active') out = out.ilike('status', 'Active%')
  else if (q.statusGroup === 'frozen') out = out.ilike('status', 'Frozen%')
  else if (q.statusGroup === 'closed') out = out.or('status.ilike.Written-off%,status.ilike.Closed%')

  if (q.subStatus) out = out.eq('sub_status', q.subStatus)
  if (q.bucket) out = out.eq('bucket', q.bucket)
  if (q.assignedTo === 'nobody') out = out.is('assigned_to', null)
  else if (q.assignedTo) out = out.eq('assigned_to', q.assignedTo)
  // See assignedToAny: an empty list narrows to nothing rather than to everything.
  if (q.assignedToAny) out = out.in('assigned_to', q.assignedToAny)

  if (q.handedOverFrom) out = out.gte('handover_date', q.handedOverFrom)
  if (q.handedOverTo) out = out.lte('handover_date', q.handedOverTo)

  /*
   * ON HOLD AND DUE A LOOK: the manager's weekly queue, and it is two queues. A date that has
   * passed is a promise to come back that nobody kept; no date at all is an account parked before
   * a date was required, which every frozen account off the import is.
   */
  if (q.review === 'due' && q.today) out = out.lte('hold_review_on', q.today)
  if (q.review === 'unset') out = out.is('hold_review_on', null)

  /*
   * ADRIFT. On the active book and nobody booked to ring it -- the hole the whole diary design
   * exists to close, and the one filter here that is about the firm rather than the debtor.
   *
   * IT CARRIES THE BOOK ITSELF rather than trusting the caller to have set it. The URL is the
   * state, so `?adrift=1&book=closed` is a thing somebody can type, and the answer to that must
   * not be a list of written-off accounts with no diary date. It used to say
   * `status ilike 'Active%'`, which is the same intention against the wrong column: an account
   * RAPTOR closed keeps whatever Swordfish status it was imported with, so a paid-up file still
   * read as Active and sat in the queue.
   */
  if (q.adrift) out = out.is('diary_date', null).eq('book', 'active')
  if (q.neverWorked) out = out.is('last_action_at', null)
  /*
   * QUIET. Nothing logged since the date given — and an account never worked at all is the
   * quietest of the lot, so a null counts rather than being filtered out. Without the `or` it
   * would silently exclude exactly the accounts most worth finding.
   */
  if (q.quietSince) out = out.or(`last_action_at.lt.${q.quietSince},last_action_at.is.null`)

  // Already prescribed is not "about to": it has happened, and it is a different conversation.
  if (q.prescribingBefore) out = out.lte('prescription_date', q.prescribingBefore).eq('prescribed', false)
  if (q.inDuplum) out = out.eq('in_duplum', true)
  if (q.waitingOnClient) out = out.not('client_action_ask', 'is', null)
  if (q.minOutstanding !== undefined) out = out.gte('capital_outstanding', q.minOutstanding)
  /*
   * Drift is a stored generated column now, so it narrows in SQL like everything else. It used
   * to be a .filter() over the page already fetched, which gave a list of four accounts under a
   * pager that still read "1–50 of 736" — the count came back before the filter ran.
   */
  if (q.commissionDriftOnly) out = out.eq('commission_drift', true)

  if (q.search?.trim()) {
    // % and , are PostgREST's own syntax inside an `or`, so a surname containing either would
    // otherwise be read as a pattern or a second clause rather than as a name.
    const s = q.search.trim().replace(/[%,]/g, '')
    /* The case number FIRST, because it is the one on every notice and therefore the one a
       debtor reads back down the phone. Searching without it would have left the clerk typing
       the number off their own letter into a box that could not find it. */
    out = out.or(`case_number.ilike.%${s}%,account_number.ilike.%${s}%,client_reference.ilike.%${s}%,debtor_surname.ilike.%${s}%`)
  }

  return out as T
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function fetchAccounts(q: AccountQuery = {}): Promise<AccountPage> {
  const pageSize = q.pageSize ?? 50
  const page = q.page ?? 0
  /*
   * count: 'exact' is what lets the list say "1 to 50 of 735" rather than "50 shown", which is
   * the difference between a person trusting the page and wondering what is missing -- so it is
   * the default and the list keeps it. It is not free: see countRows. A caller that never draws
   * the total asks for none, and the page stops at the rows it wanted.
   */
  const counted = q.countRows !== false
  const query = applyAccountFilters(
    supabase
      .from('debtor_accounts')
      /*
       * THE CLIENT'S NAME COMES WITH THE ROW, at the firm's asking: the book is read across every
       * client and a row that does not say whose it is cannot be acted on.
       *
       * A JOIN RATHER THAN A SECOND READ. The alternative is holding a map of companies in the
       * browser and looking each row up, which is a second copy of the client list that goes stale
       * the moment one is renamed -- and the book is paged in the database precisely so a list
       * never loads something to look something else up in.
       *
       * `*` STAYS. PostgREST takes the embed alongside it, so no column is lost from the row
       * itself -- and losing one here would be silent, because toAccount names every field by hand.
       */
      .select('*, companies(name)', counted ? { count: 'exact' } : undefined)
      .order('account_number')
      .range(page * pageSize, page * pageSize + pageSize - 1),
    q,
  )

  const { data, error, count } = await query
  if (error) throw new Error(error.message)
  const accounts = (data ?? []).map(toAccount)
  return { accounts, total: count ?? accounts.length }
}

/** How many accounts a filter actually matches. What a bulk action has to name before it runs. */
export async function countAccounts(q: AccountQuery): Promise<number> {
  const { count, error } = await applyAccountFilters(
    supabase.from('debtor_accounts').select('id', { count: 'exact', head: true }),
    q,
  )
  if (error) throw new Error(error.message)
  return count ?? 0
}

/**
 * Does the billed rate disagree with the signed mandate?
 *
 * Reads the stored column rather than recomputing. The database rounds to four decimals on both
 * sides and treats a missing rate as "unpriced" rather than "in drift" — a second definition
 * here would eventually disagree with the filter and the summary, and the screen would show a
 * warning triangle on a row the filter refuses to return.
 */
export function hasCommissionDrift(a: DebtorAccount): boolean {
  return a.commissionDrift
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
  /**
   * The receipt fee Swordfish actually charged on this payment, excluding VAT.
   *
   * Null on anything Raptor took in itself, and on payments migrated from the older export, which
   * did not carry it. Where it is present it is preferred over the computed figure: it is what
   * the debtor was billed and what the client's own records show.
   *
   * NAMED FOR WHAT IT IS, AS OF THE FINANCE MODULE. The column and this field were both called
   * "collection commission", which is what Swordfish's export calls it -- and it is not commission
   * at all. It is Annexure B item 9, the receipt fee, 10 per cent of the payment capped. Read as
   * commission by an allocation engine, it would pay a client a tenth of every payment they were
   * never owed. The doc comment here always said the right thing; the name did not.
   */
  receiptFeeLegacy: number | null
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
  /** Which Annexure B item the fee was raised under. '9' is the receipt fee on a payment. */
  annexureItem: string | null
  /** The payment an item 9 fee was raised on. Null on every other item. */
  paymentId: string | null
  /**
   * WHAT SWORDFISH CALLED THE ACTION -- 'Phone Call', 'SMS', 'Promise to Pay'. Null on anything
   * Raptor raised itself.
   *
   * IT IS HERE BECAUSE IT DECIDES WHETHER A CANCELLED FEE COMES OFF THE BALANCE. See `feeStands`
   * in accountBalance: on a Promise to Pay row, Swordfish's cancellation is the ARRANGEMENT ending
   * and not the charge being withdrawn, and the firm has said those charges stand.
   */
  legacyName: string | null
  /**
   * WHO RAISED IT: 'swordfish' is the import, 'raptor' and 'workflow' are ours.
   *
   * READ BY THE FINANCE HEALTH REPORT, which has to tell a fault we caused from one we inherited.
   * Run against the real book it finds 26 028 fees carrying no Annexure B item, every one of them
   * imported -- so without this column every one of those reads as ours and the handful that
   * actually are cannot be found. See `inherited` in financeHealth.
   */
  source: string | null
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
 * THE LEDGERS FOR A PAGE OF ACCOUNTS, so a list can show what each one actually owes.
 *
 * THE FIRM, of the accounts list: "in here, I want to see what the current balance is. Capital,
 * fees, interest, paid, balance."
 *
 * WHY THE WHOLE LEDGER AND NOT A SUM. There is a SQL side that looks ready to answer this in one
 * query -- `engine_balances` returns capital, interest and costs per account -- and it gives a
 * DIFFERENT NUMBER: R817,01 against the account page's R760,00 on RRC00005, because it applies the
 * in duplum ceiling to the interest only while computeBalance caps the aggregate. A list and an
 * account page disagreeing about one debtor is the failure CLAUDE.md names, so the list runs the
 * same function over the same rows instead. See balanceInput.ts for the whole of that argument.
 *
 * THREE QUERIES FOR THE PAGE, NEVER FOR THE BOOK. Fifty rows is three round trips rather than
 * fifty, and the volume is whatever ledger rows those fifty carry. The busiest account on the
 * inherited book has 822 fee rows; a page of fifty like that is the one case worth watching, and
 * the honest lever there is a smaller page rather than a second arithmetic.
 *
 * EMPTY IN, EMPTY OUT, with no request made at all -- `in` on an empty list is a round trip that
 * can only answer nothing.
 */
export async function fetchLedgersForAccounts(
  accountIds: readonly string[],
): Promise<Map<string, LedgerRows>> {
  const out = new Map<string, LedgerRows>()
  if (accountIds.length === 0) return out
  const ids = [...new Set(accountIds)]
  for (const id of ids) out.set(id, { payments: [], fees: [], accruals: [] })

  /* THE SAME COLUMNS fetchLedgers ASKS FOR, because the same function reads them. A shorter list
     here would be a balance computed from less than the account page had. */
  /*
   * PAGED, BECAUSE POSTGREST STOPS AT A THOUSAND ROWS AND SAYS NOTHING.
   *
   * This asked for all three ledgers of all fifty accounts in one request each and computed every
   * balance from what came back. `db-max-rows` is a thousand on Supabase: the request succeeds, the
   * thousand-and-first row is dropped, and there is no error and no flag. On the twenty-eight test
   * accounts, 2 281 fee rows went in and a thousand came out -- BPM0113 got 1 of its 52, BPM20038
   * 1 of 64, MSH4/20014 and MSH3/10107 none of their 136 and 139. Their fees drew as R 0.00 and
   * their balances were short by the whole fee ledger, on the screen the firm reads the book from.
   *
   * It is exactly the failure the comment above says this function exists to avoid: the account
   * page fetches ONE account, stays under the cap and was right, while the list beside it was
   * wrong. `fetchAllRows` reads until a short page comes back, and refuses rather than truncating.
   */
  const [payments, fees, accruals] = await Promise.all([
    fetchAllRows(() => supabase.from('account_payments')
      .select('account_id,id,received_at,amount,paid_to_client,reversed_at,receipt_fee_legacy')
      .in('account_id', ids).order('id'), { table: 'payments' }),
    fetchAllRows(() => supabase.from('account_fees')
      .select('account_id,incurred_at,description,amount_excl_vat,vat_amount,billed,segments,cancelled_at,annexure_item,payment_id,legacy_name')
      .in('account_id', ids).order('id'), { table: 'fees' }),
    fetchAllRows(() => supabase.from('account_interest_accruals')
      .select('account_id,accrued_on,days,amount_accrued')
      .in('account_id', ids).order('id'), { table: 'interest' }),
  ])

  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const r of (payments ?? []) as any[]) {
    out.get(r.account_id)?.payments.push({
      id: r.id,
      receivedAt: r.received_at,
      amount: Number(r.amount),
      paidToClient: !!r.paid_to_client,
      reversedAt: r.reversed_at,
      receiptFeeLegacy: r.receipt_fee_legacy === null || r.receipt_fee_legacy === undefined
        ? null : Number(r.receipt_fee_legacy),
    })
  }
  for (const r of (fees ?? []) as any[]) {
    out.get(r.account_id)?.fees.push({
      incurredAt: r.incurred_at,
      description: r.description ?? '',
      amountExclVat: Number(r.amount_excl_vat ?? 0),
      vatAmount: Number(r.vat_amount ?? 0),
      billed: r.billed !== false,
      segments: r.segments ?? undefined,
      annexureItem: r.annexure_item ?? null,
      paymentId: r.payment_id ?? null,
      cancelledAt: r.cancelled_at ?? null,
      legacyName: r.legacy_name ?? null,
    })
  }
  for (const r of (accruals ?? []) as any[]) {
    out.get(r.account_id)?.accruals.push({
      accruedOn: r.accrued_on,
      days: Number(r.days ?? 1),
      amountAccrued: Number(r.amount_accrued ?? 0),
    })
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return out
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
  /*
   * Named columns, not `*`.
   *
   * The busiest account's 822 fee rows are 510 kB of JSON with every column and 226 kB with the
   * ten the balance and the timeline actually read. The rest — created_at, legacy_name, vat_rate,
   * destination — is carried across the Atlantic on every page open and then thrown away.
   */
  /*
   * PAGED HERE TOO, for the same reason as fetchLedgersForAccounts. One account stays under the
   * thousand-row cap today -- the busiest on the inherited book has 822 fee rows -- which means
   * this is the half of the pair that happened to be right, not the half that was safe. 822 is
   * four fifths of the way to a silent wrong balance on a debtor's own statement.
   */
  const [payments, fees, accruals] = await Promise.all([
    fetchAllRows(() => supabase.from('account_payments')
      .select('id,received_at,amount,method,reference,details,paid_to_client,reversed_at,receipt_fee_legacy')
      .eq('account_id', accountId).order('received_at', { ascending: false }).order('id'),
      { table: 'payments' }),
    fetchAllRows(() => supabase.from('account_fees')
      .select('id,incurred_at,description,amount_excl_vat,vat_amount,billed,action_code,segments,cancelled_at,performed_by,annexure_item,payment_id,legacy_name,source')
      .eq('account_id', accountId).order('incurred_at', { ascending: false }).order('id'),
      { table: 'fees' }),
    fetchAllRows(() => supabase.from('account_interest_accruals')
      .select('id,accrued_on,days,amount_accrued,amount_recoverable')
      .eq('account_id', accountId).order('accrued_on', { ascending: false }).order('id'),
      { table: 'interest' }),
  ])

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const feeRows = (fees ?? []) as any[]
  return {
    payments: (payments ?? []).map((r: any) => ({
      id: r.id,
      receivedAt: r.received_at,
      amount: Number(r.amount),
      method: r.method,
      reference: r.reference,
      details: r.details,
      paidToClient: !!r.paid_to_client,
      reversedAt: r.reversed_at,
      receiptFeeLegacy: r.receipt_fee_legacy === null || r.receipt_fee_legacy === undefined
        ? null : Number(r.receipt_fee_legacy),
    })),
    fees: (fees ?? []).map((r: any) => ({
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
      /* WHICH ITEM, AND WHICH PAYMENT. Item 9 is the receipt fee and it is already a fee ROW --
         without these two the balance computed it a second time off the payment and added both.
         See splitFeeLedger in accountBalance. */
      annexureItem: r.annexure_item ?? null,
      paymentId: r.payment_id ?? null,
      /* AND WHAT THE OLD SYSTEM CALLED IT, which decides whether a CANCELLED fee is still owed --
         see feeStands. A column in the table, the select and the type but missing from this mapper
         reads as undefined for ever and nothing fails: CLAUDE.md's own warning, and here it would
         silently take R 8 802,11 of promise-to-pay charges off 118 accounts. */
      legacyName: r.legacy_name ?? null,
      /* AND WHO RAISED IT. Missing from this mapper it reads as undefined, the health report's
         `imported()` says false for everything, and 26 028 inherited findings are filed as ours. */
      source: r.source ?? null,
    })),
    accruals: (accruals ?? []).map((r: any) => ({
      id: r.id,
      accruedOn: r.accrued_on,
      days: Number(r.days ?? 1),
      amountAccrued: Number(r.amount_accrued ?? 0),
      amountRecoverable: Number(r.amount_recoverable ?? 0),
    })),
    totals: {
      paid: (payments ?? []).reduce((t: number, r: any) => t + Number(r.amount), 0),
      feesExclVat: feeRows.reduce((t, r) => t + Number(r.amount_excl_vat ?? 0), 0),
      feesInclVat: feeRows.reduce((t, r) => t + Number(r.amount_excl_vat ?? 0) + Number(r.vat_amount ?? 0), 0),
      interest: (accruals ?? []).reduce((t: number, r: any) => t + Number(r.amount_accrued ?? 0), 0),
      feeCount: feeRows.length,
    },
  }
}

export interface BookSummary {
  accounts: number
  capital: number
  /** What is still outstanding on them -- the stored column, not a recomputed balance. */
  outstanding: number
  clients: number
  commissionDrift: number
}

/** Headline figures for a client, or for the whole book when no client is given. */
/**
 * The tiles over the list, FOR THE BOOK THAT IS SHOWING.
 *
 * THE FIRM: "'Capital handed over R438 769' includes R71 287 on KIS0007, which is paid in full."
 * A figure about money nobody is collecting, added into the one the floor reads as what there is
 * to collect. 'whole' is passed as null, which is the deliberate absence of the filter.
 */
export async function fetchBookSummary(
  companyId?: string, book?: BookChoice,
): Promise<BookSummary> {
  const { data, error } = await supabase.rpc('book_summary', {
    p_company: companyId ?? null,
    p_book: !book || book === 'whole' ? null : book,
  })
  if (error) throw new Error(error.message)
  const row = (Array.isArray(data) ? data[0] : data) as
    { accounts: number; capital: number; outstanding: number
      clients: number; commission_drift: number } | undefined
  return {
    accounts: Number(row?.accounts ?? 0),
    capital: Number(row?.capital ?? 0),
    outstanding: Number(row?.outstanding ?? 0),
    clients: Number(row?.clients ?? 0),
    commissionDrift: Number(row?.commission_drift ?? 0),
  }
}

export async function createDebtorAccount(
  row: Record<string, unknown>,
  contacts: (accountId: string) => Record<string, unknown>[] = () => [],
): Promise<DebtorAccount> {
  const { data, error } = await supabase.from('debtor_accounts').insert(row).select('*').single()
  if (error) {
    // The reference is unique per client, and colliding with one is the mistake a person is most
    // likely to make here — so it is named rather than handed back as a constraint string.
    if (error.code === '23505') throw new Error('That reference is already used on another account.')
    throw new Error(error.message)
  }
  const account = toAccount(data)

  // Contacts are written after the account exists, because they hang off its id. A failure here
  // is reported but does not undo the account: an account with no numbers on it is a working
  // account somebody can add a number to, and throwing it away would lose the capital and the
  // handover date the person just typed.
  const rows = contacts(account.id)
  if (rows.length > 0) {
    const { error: contactError } = await supabase.from('account_contacts').insert(rows)
    if (contactError) throw new Error(`The account was created, but its contact details were not saved: ${contactError.message}`)
  }
  return account
}

/**
 * Every account number already on a client, so the next in their series can be proposed.
 *
 * PAGED, NOT `.limit(2000)`. A client limit above PostgREST's own `db-max-rows` does not raise it:
 * the request came back with a thousand rows and no complaint, so a client with more accounts than
 * that had the tail of their own series invisible -- and `suggestReference` would then propose a
 * number already in use, on the field CLAUDE.md calls the creditor's own reference.
 */
export async function fetchAccountReferences(companyId: string): Promise<string[]> {
  const data = await fetchAllRows<{ account_number: string | null }>(
    () => supabase.from('debtor_accounts').select('account_number')
      .eq('company_id', companyId).order('id'),
    { table: 'account numbers' },
  )
  return data.map((r) => r.account_number).filter((r): r is string => !!r)
}

/**
 * What is already on a client's book, reduced to what a duplicate is recognised by.
 *
 * THE FIRM: "the same data has already been handed over for the same amount. So it should flag
 * it." Four columns rather than the account, because this is read every time a handover is judged
 * and the book is hundreds of thousands of rows -- see CLAUDE.md on the two data paths. Scoped to
 * the one client, which is the only place a duplicate of theirs can be.
 *
 * `debtor_surname` rather than a built name: the duplicate rule folds it to letters and digits
 * and pairs it with the capital, and initials or a title would only add ways for two spellings of
 * one person to miss each other.
 */
export async function fetchExistingAccounts(companyId: string): Promise<ExistingAccount[]> {
  /*
   * ENOUGH TO DECIDE ON, not just enough to recognise a duplicate by.
   *
   * THE FIRM: "there might be another one, and that's the reference number for the client, and
   * the surname is Peter, and the account is currently being worked by Jennifer, or allocated to
   * Jennifer, or it's been withdrawn, or it's been settled. Then we can see who worked on that
   * account and allocate it to that person."
   *
   * So the status, the sub-status and the desk come back too -- the position a client is reported
   * on is DERIVED from the first two (clientPosition.ts) and cannot be worked out from a
   * reference. The holder's name is joined rather than looked up per row: forty rows each
   * resolving one profile is forty requests for a handful of distinct people.
   */
  /*
   * PAGED, NOT `.limit(5000)`. This is what an import checks a handover sheet against, and a
   * client limit above PostgREST's `db-max-rows` is not a limit at all -- a thousand rows came back
   * and the rest of the client's book was invisible to the duplicate check. The failure is an
   * account imported a second time under a new case number, which is two files on one debt.
   */
  const data = await fetchAllRows<{
    account_number: string | null
    client_reference: string | null
    debtor_id_number: string | null
    debtor_surname: string | null
    capital_handed_over: number | string | null
    status: string | null
    sub_status: string | null
    assigned_to: string | null
    assigned?: { name: string | null } | { name: string | null }[] | null
  }>(
    () => supabase
      .from('debtor_accounts')
      /* One literal, not a concatenation: supabase-js infers the row type FROM the select string,
         and a joined one infers nothing and lands on GenericStringError. */
      .select('account_number, client_reference, debtor_id_number, debtor_surname, capital_handed_over, status, sub_status, assigned_to, assigned:profiles!debtor_accounts_assigned_to_fkey(name)')
      .eq('company_id', companyId)
      .order('id'),
    { table: 'the client\u2019s accounts' },
  )
  return data.map((r: {
    account_number: string | null
    client_reference: string | null
    debtor_id_number: string | null
    debtor_surname: string | null
    capital_handed_over: number | string | null
    status: string | null
    sub_status: string | null
    assigned_to: string | null
    assigned?: { name: string | null } | { name: string | null }[] | null
  }) => ({
    reference: r.account_number,
    clientReference: r.client_reference,
    idNumber: r.debtor_id_number,
    name: r.debtor_surname,
    capital: r.capital_handed_over === null ? null : Number(r.capital_handed_over),
    status: r.status,
    subStatus: r.sub_status,
    heldBy: r.assigned_to,
    /* PostgREST gives an embedded row as an object or a one-element array depending on how it
       reads the relationship. Both, because the difference is invisible until a name is blank. */
    heldByName: Array.isArray(r.assigned) ? (r.assigned[0]?.name ?? null) : (r.assigned?.name ?? null),
  }))
}

/**
 * The debtor's other accounts, found by the identity number they share.
 *
 * THE FIRM: "it will indicate, when you're on an account, this debtor has other accounts, those
 * account numbers, and you would be able to click on that account number and it opens that
 * account ... and then you can go back to the original just by clicking on the other one."
 *
 * ACROSS EVERY CLIENT, not just this one. A debtor who owes two of the firm's clients is exactly
 * the person this is for -- one collector ringing about two debts should know about both, and a
 * payment arrangement made for one has to be affordable against the other. That is also why the
 * client's name comes back with each row: the reference alone would not say whose book it is on.
 *
 * `debtorKey` decides whether the identifier can be trusted at all; given nothing usable this is
 * never called, because an eq() on a telephone number would group strangers.
 */
export async function fetchOtherAccounts(
  accountId: string, idNumber: string, kind: 'individual' | 'company',
): Promise<OtherAccount[]> {
  if (!debtorKey(idNumber, kind)) return []
  const { data, error } = await supabase
    .from('debtor_accounts')
    .select('id, account_number, capital_outstanding, status, companies(name)')
    .eq('debtor_id_number', idNumber.replace(/\s/g, ''))
    .eq('debtor_kind', kind)
    .neq('id', accountId)
    .limit(50)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: {
    id: string
    account_number: string | null
    capital_outstanding: number | string | null
    status: string | null
    companies: { name: string | null } | { name: string | null }[] | null
  }) => ({
    id: r.id,
    reference: r.account_number,
    /* PostgREST hands an embedded row back as an object or as an array of one depending on how it
       reads the relationship; both shapes have been seen from this table. */
    clientName: Array.isArray(r.companies) ? r.companies[0]?.name ?? null : r.companies?.name ?? null,
    balance: r.capital_outstanding === null ? null : Number(r.capital_outstanding),
    status: r.status,
    /* THERE IS NO is_settled ON THIS TABLE, which is what check-select-columns caught: the book
       carries five statuses and `is_settled` is a generated column on `user_emails`, about a mail
       thread. isWrittenOff is the one place that decides a closed account. */
    writtenOff: isWrittenOff(r.status),
  }))
}

/**
 * THE CLIENT'S COMMISSION RULE, read at the moment accounts are opened (prompt 9).
 *
 * Read fresh rather than off the Company the app holds: commission is the client's, and a stale
 * copy is an account invoiced at the wrong rate for the rest of its life. It returns the RULE, not
 * a rate -- the old version returned the flat rate and null for a scale, and a null priced every
 * new account on a banded client at nothing. toAccountRow decides the rate per account, on that
 * account's capital, and handoverRateBlock refuses a client whose scale has no boundaries.
 */
export async function fetchClientCommission(companyId: string): Promise<ClientCommission & { name: string }> {
  const { data, error } = await supabase
    .from('companies').select('name, commission_rate, commission_bands, commission_tiers').eq('id', companyId).maybeSingle()
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as {
    name?: string; commission_rate?: number | string | null
    commission_bands?: CommissionBand[] | null; commission_tiers?: { prefix: string; rate: number }[] | null
  }
  return {
    name: r.name ?? 'This client',
    commissionRate: r.commission_rate === null || r.commission_rate === undefined ? null : Number(r.commission_rate),
    commissionBands: r.commission_bands ?? null,
    commissionTiers: r.commission_tiers ?? null,
  }
}

export interface BookFacets {
  /** The sub-statuses present in the book, busiest first. */
  subStatuses: { value: string; accounts: number }[]
  /** The Swordfish work buckets present, busiest first. */
  buckets: { value: string; accounts: number }[]
}

/**
 * What values the book actually holds, for the filter panel's dropdowns.
 *
 * Asked rather than hardcoded. The import writes whatever Swordfish sends, so a list of the
 * sub-statuses seen this afternoon is wrong the first time a new one arrives — and it is wrong
 * in the worst direction, because the accounts carrying it become unfindable rather than
 * conspicuous. Aggregated in the database: a dozen rows come back whatever the book's size.
 */
export async function fetchBookFacets(
  companyId?: string, book?: BookChoice,
): Promise<BookFacets> {
  /* THE FACETS FOLLOW THE BOOK TOO, or the filter panel offers a sub-status whose every account is
     closed and the list it opens is empty. */
  const { data, error } = await supabase.rpc('book_facets', {
    p_company: companyId ?? null,
    p_book: !book || book === 'whole' ? null : book,
  })
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as { kind: string; value: string; accounts: number }[]
  const of = (kind: string) => rows
    .filter((r) => r.kind === kind)
    .map((r) => ({ value: r.value, accounts: Number(r.accounts) }))
  return { subStatuses: of('sub_status'), buckets: of('bucket') }
}

/**
 * How much work each view holds.
 *
 * One request, not seven. The views row is only worth having if it says how many — "No diary
 * date" with no number beside it is a link somebody clicks once and stops clicking — but seven
 * separate head-counts before the first account appears is a screen that feels slow for the sake
 * of seven badges.
 */
export async function fetchViewCounts(input: {
  userId: string | null
  companyId?: string
  quietDays: number
}): Promise<ViewCounts> {
  const { data, error } = await supabase.rpc('account_view_counts', {
    p_user: input.userId,
    p_company: input.companyId ?? null,
    p_quiet_days: input.quietDays,
  })
  if (error) throw new Error(error.message)
  const row = (Array.isArray(data) ? data[0] : data) ?? {}
  const n = (k: string) => Number((row as Record<string, unknown>)[k] ?? 0)
  return {
    whole_book: n('whole_book'),
    active: n('active'),
    on_hold: n('on_hold'),
    closed: n('closed'),
    my_desk: n('my_desk'),
    unallocated: n('unallocated'),
    adrift: n('adrift'),
    broken_promises: n('broken_promises'),
    promises_due: n('promises_due'),
    gone_quiet: n('gone_quiet'),
  }
}

/**
 * A batch that was imported and never shared out.
 *
 * THE FIRM: "there should be a state where it's a warning that 12 accounts has not been
 * allocated. For example, if a system goes off in the middle of an import."
 */
export interface UnallocatedBatch {
  handoverId: string
  reference: string | null
  companyId: string | null
  companyName: string | null
  receivedAt: string
  /** Accounts from this batch still on nobody's desk. */
  unallocated: number
  /** How many the batch opened, so the warning can say "9 of 12". */
  total: number
}

/**
 * Recently imported batches with accounts still in the pile.
 *
 * BOUNDED BY DAYS ON PURPOSE, and that is the whole design of it. An account on nobody's desk is
 * not wrong -- most of the inherited book is exactly that and will be until somebody shares it
 * out -- so "how many unallocated accounts are there" is a number that would be large for ever
 * and read by nobody. What is worth a warning is the narrow case: a batch that came in this week
 * whose accounts never reached a desk, which is what an interrupted import leaves behind.
 *
 * NEVER FATAL. It decorates a screen; a screen that will not render because a warning could not
 * be counted is worse than the warning being missing.
 */
export async function fetchUnallocatedBatches(days = 14): Promise<UnallocatedBatch[]> {
  const { data, error } = await supabase.rpc('unallocated_batches', { p_days: days })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    handoverId: r.handover_id as string,
    reference: (r.reference as string | null) ?? null,
    companyId: (r.company_id as string | null) ?? null,
    companyName: (r.company_name as string | null) ?? null,
    receivedAt: r.received_at as string,
    unallocated: Number(r.unallocated ?? 0),
    total: Number(r.total ?? 0),
  }))
}
