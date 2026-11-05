/**
 * RUNNING AN EXPORT: read the accounts, read their ledgers, write the CSV. See accountExport.ts for
 * what a row says and why.
 *
 * BUILT FOR THE WHOLE BOOK, which is the case the firm named: "there's going to be about 100,000,
 * 200,000 accounts ... I don't know how realistic it is to export 100,000 accounts. But I guess it
 * should be possible." It is, and three things make it so:
 *
 *   - THE ACCOUNTS ARE PAGED A THOUSAND AT A TIME, because a thousand is PostgREST's max-rows and a
 *     bigger page is silently cut to it (the BPM0113 story in accountBook). The count is taken
 *     first and held against what arrived, and a difference is SAID, never swallowed -- an export
 *     short by a page looks exactly like a complete one.
 *   - THE LEDGERS ARE READ A HUNDRED ACCOUNTS AT A TIME, a few batches in flight, through the same
 *     fetchLedgerRows the list and the nightly job use, so every balance is computeBalance's.
 *   - IT CAN BE STOPPED, and it says how far it has got, because a whole-book export is minutes and
 *     a screen that sits still for minutes is a screen people reload.
 *
 * Nothing here writes. An export reads the book and changes nothing on it.
 */
import { computeBalance, type BalanceBreakdown } from './accountBalance.ts'
import { countAccounts, fetchAccounts, fetchAccountsByIds, type DebtorAccount } from './accountBook.ts'
import type { Selection } from './accountAllocation.ts'
import { CSV_BOM, CSV_EOL, exportColumns, headerLine, rowLine } from './accountExport.ts'
import { isWrittenOff } from './accountStatus.ts'
import { balanceInputFor } from './balanceInput.ts'
import { fetchLedgerRows } from './storedBalance.ts'
import { supabase } from './supabase'

/** PostgREST's max-rows. A page asked for bigger than this comes back this size and says nothing. */
export const EXPORT_PAGE = 1000
/** Accounts per ledger read, and how many of those run at once. */
const LEDGER_BATCH = 100
const LEDGER_PARALLEL = 4

export interface ExportProgress {
  phase: 'counting' | 'accounts' | 'money' | 'writing'
  done: number
  total: number
}

export interface ExportResult {
  blob: Blob
  rows: number
  /** How many the count said would come, where the selection was a filter. */
  expected: number
}

export class ExportCancelled extends Error {
  constructor() { super('Export stopped.'); this.name = 'ExportCancelled' }
}

export async function runAccountExport(input: {
  selection: Selection
  withMoney: boolean
  nameOf: (id: string) => string | null | undefined
  today: string
  onProgress?: (p: ExportProgress) => void
  signal?: AbortSignal
}): Promise<ExportResult> {
  const { selection, withMoney, nameOf, today, onProgress, signal } = input
  const stop = () => { if (signal?.aborted) throw new ExportCancelled() }

  /* ---------- the accounts ---------- */
  onProgress?.({ phase: 'counting', done: 0, total: 0 })
  let accounts: DebtorAccount[] = []
  let expected: number
  if (selection.kind === 'ids') {
    expected = selection.ids.length
    onProgress?.({ phase: 'accounts', done: 0, total: expected })
    accounts = await fetchAccountsByIds(selection.ids)
    onProgress?.({ phase: 'accounts', done: accounts.length, total: expected })
  } else {
    expected = await countAccounts(selection.query)
    stop()
    const seen = new Set<string>()
    for (let page = 0; page * EXPORT_PAGE < expected; page += 1) {
      onProgress?.({ phase: 'accounts', done: accounts.length, total: expected })
      const res = await fetchAccounts({ ...selection.query, page, pageSize: EXPORT_PAGE, countRows: false })
      stop()
      /* By id, like the list's Load more: a row that moves between pages mid-export is written once. */
      for (const a of res.accounts) if (!seen.has(a.id)) { seen.add(a.id); accounts.push(a) }
      if (res.accounts.length < EXPORT_PAGE) break
    }
    onProgress?.({ phase: 'accounts', done: accounts.length, total: expected })
  }

  /* ---------- what each one owes ---------- */
  const balances = new Map<string, BalanceBreakdown>()
  if (withMoney && accounts.length > 0) {
    const batches: DebtorAccount[][] = []
    for (let i = 0; i < accounts.length; i += LEDGER_BATCH) batches.push(accounts.slice(i, i + LEDGER_BATCH))
    let done = 0
    let next = 0
    onProgress?.({ phase: 'money', done, total: accounts.length })
    const worker = async () => {
      while (next < batches.length) {
        stop()
        const batch = batches[next++]
        const ledgers = await fetchLedgerRows(supabase, batch.map((a) => a.id))
        for (const a of batch) {
          const rows = ledgers.get(a.id)
          if (!rows) continue
          balances.set(a.id, computeBalance(balanceInputFor({
            account: {
              capitalHandedOver: a.capitalHandedOver,
              handoverDate: a.handoverDate,
              interestRateAnnual: a.interestRateAnnual,
              status: a.status,
              lastActionAt: a.lastActionAt,
              endedAs: a.endedAs, prescribed: a.prescribed, prescriptionDate: a.prescriptionDate,
              endedOn: a.endedOn,
            },
            ledgers: rows,
            today,
            writtenOff: isWrittenOff,
          })))
        }
        done += batch.length
        onProgress?.({ phase: 'money', done, total: accounts.length })
      }
    }
    await Promise.all(Array.from({ length: Math.min(LEDGER_PARALLEL, batches.length) }, worker))
    stop()
  }

  /* ---------- the file ---------- */
  onProgress?.({ phase: 'writing', done: 0, total: accounts.length })
  const columns = exportColumns(withMoney)
  const lines = [headerLine(columns)]
  for (const a of accounts) lines.push(rowLine(columns, a, { balance: balances.get(a.id) ?? null, nameOf }))
  const blob = new Blob([CSV_BOM, lines.join(CSV_EOL), CSV_EOL], { type: 'text/csv;charset=utf-8' })
  return { blob, rows: accounts.length, expected }
}
