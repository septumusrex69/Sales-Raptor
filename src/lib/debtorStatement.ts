import { buildStatement, type Statement } from './accountBalance.js'
import { accountMergeValues, type ContactLike } from './accountMergeValues.js'
import { statementOfAccount } from './accountSummaryLetter.js'
import { balanceInputFor, type LedgerRows } from './balanceInput.js'
import { balanceAccountFromRow } from './storedBalance.js'
import type { FirmSettings } from './firmSettings.js'
import { PRINTER_FIELDS, type LetterDocument } from './letterDocument.js'
import { MERGE_FIELDS, UNASSIGNED_NAME, type Person } from './messageTemplates.js'

/**
 * THE DEBTOR PORTAL'S STATEMENT, ASSEMBLED (Raptor H16, part 2) -- in one place so the server that draws it and the
 * check that proves it can be drawn run the same lines. Its own file, not debtorPortal.ts, because the debtor's page
 * imports that one and has no business carrying the statement engine to a phone.
 *
 * NOTHING NEW IS WORKED OUT HERE: buildStatement over the account page's ledgers, accountMergeValues as the morning run
 * builds them, statementOfAccount as the collector's Documents button draws it. The portal hands a debtor the same PDF.
 */
export interface DebtorStatementAccount {
  [column: string]: unknown
  case_number: string | null
  capital_handed_over: number | string | null
}

export interface DebtorLetterInput {
  account: DebtorStatementAccount
  ledgers: LedgerRows
  firm: FirmSettings
  contacts: ContactLike[]
  collector: Person | null
  liaison: Person | null
  clientName: string | null
  today: string
  money: (n: number) => string
}

/**
 * THE MERGE VALUES FOR A DOCUMENT THE PORTAL HANDS A DEBTOR -- the statement, and the affordability assessment an
 * application carries -- built the way the morning run builds them, over the account's own statement, ONCE. Two
 * builders would answer {{balance}} two ways on two documents the same debtor holds.
 */
/** Who signs where nobody holds the account: the fallback accountMergeValues applies to every document (UNASSIGNED_NAME). */
export const UNASSIGNED_SIGNER: Person = { name: UNASSIGNED_NAME }

export function debtorLetterValues(input: DebtorLetterInput): { values: Record<string, string>; statement: Statement } {
  const a = input.account as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const st = buildStatement(balanceInputFor({ account: balanceAccountFromRow(a), ledgers: input.ledgers, today: input.today }))
  const values = accountMergeValues({
    account: {
      caseNumber: a.case_number ?? null, handoverDate: a.handover_date ?? a.opening_as_at ?? null,
      capitalHandedOver: Number(a.capital_handed_over ?? 0), paymentsToDate: st.breakdown.payments,
      listingDate: a.listing_date ?? null, listingReference: a.listing_reference ?? null, bureausListed: a.bureaus_listed ?? null,
      debtorKind: a.debtor_kind === 'company' ? 'company' : 'individual', debtorTitle: a.debtor_title ?? null,
      debtorFirstName: a.debtor_first_name ?? null, debtorSurname: a.debtor_surname ?? null,
      accountNumber: a.account_number ?? null, clientReference: a.client_reference ?? null,
      capitalOutstanding: Number(a.capital_outstanding ?? 0), preferredLanguage: a.preferred_language ?? null,
    },
    balance: st.breakdown.balance,
    clientName: input.clientName,
    /* Nobody at a keyboard, as on the morning run: the collector on the account is who the document names. */
    agent: input.collector, collector: input.collector, liaison: input.liaison,
    debtorIdNumber: a.debtor_id_number ?? null,
    contacts: input.contacts,
    firm: input.firm,
    today: input.today,
    money: input.money,
  })
  return { values, statement: st }
}

/**
 * THE STATEMENT DOCUMENT FROM A STATEMENT ALREADY BUILT -- the one place it is laid out, for the portal's download and
 * for the arrangement reminder that carries it (Stephan, 4 Nov: "Yeah, that's the statement to the reminder"). Two
 * builders would one day show the debtor two statements of one account.
 */
export function statementDocument(st: Statement, handedOver: number, today: string, money: (n: number) => string): LetterDocument {
  return statementOfAccount({ breakdown: st.breakdown, handedOver, asAt: today, money, lines: st.lines, status: null })
}

export function debtorStatement(input: DebtorLetterInput): { doc: LetterDocument; values: Record<string, string>; fileName: string } {
  const a = input.account as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const { values, statement: st } = debtorLetterValues(input)
  const doc = statementDocument(st, Number(a.capital_handed_over ?? 0), input.today, input.money)
  return { doc, values, fileName: `Statement ${a.case_number ?? ''} ${input.today}.pdf`.replace(/\s+/g, ' ') }
}

/**
 * THE FIELDS THIS ACCOUNT CANNOT FILL, so the server can refuse BEFORE drawing. letterToPdf does not check -- it would
 * print "{{case_number}}" on the page -- and the browser's letterPdfBytes checks only that a letter's fields are
 * allowed for collections, not that this account has a value for each. A statement with braces on it is worse than
 * "call us": it is the firm writing to a debtor about money and visibly not knowing the figures.
 *
 * THE WHOLE DOCUMENT IS READ, tables and running foot included (the bank details sit in a table); the printer's own
 * page numbers are never the account's to fill, and an OPTIONAL field (the identity number) takes its line with it
 * when empty, which is the firm's rule for the 97% of the book that has none.
 */
export function unfilledFields(doc: LetterDocument, values: Record<string, string>): string[] {
  const optional = new Set(MERGE_FIELDS.collections.filter((f) => f.optional).map((f) => f.key))
  const printer = new Set<string>(PRINTER_FIELDS)
  const used = new Set([...JSON.stringify(doc).matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/g)].map((m) => m[1]))
  return [...used].filter((k) => !printer.has(k) && !optional.has(k) && !(values[k] ?? '').trim()).sort()
}
