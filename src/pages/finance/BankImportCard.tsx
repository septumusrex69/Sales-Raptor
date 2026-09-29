import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Banknote, Check, FileUp, Loader2, Upload } from 'lucide-react'
import { Card, CardHeader } from '../../components/ui/Card'
import { rand } from '../../lib/money'
import { parseBankStatement, summarise, type BankStatement } from '../../lib/bankStatement'
import {
  importBankLines, fetchBankImportHistory,
  type ImportOutcome, type BankImportHistory,
} from '../../lib/payover'

/**
 * UPLOADING THE BANK STATEMENT — where money enters the firm.
 *
 * THE FIRM ASKED WHERE TO IMPORT PAYMENTS and the honest answer was nowhere: the allocation
 * engine, the payover runs and the remittance advice were all built, and the only thing that
 * could write a payment was the Swordfish migration.
 *
 * PREVIEW BEFORE ANYTHING IS WRITTEN, AND THAT IS NOT A NICETY. `account_payments` has no update
 * or delete policy -- a receipt recorded is a receipt that can only be REVERSED, with a reason,
 * leaving both rows on the ledger for ever. So the file is read in the browser, counted, and
 * shown; nothing reaches the database until somebody has seen what it would do.
 *
 * THE COUNTS ARE THE POINT OF THE PREVIEW. A statement is not a list of payments -- roughly a
 * fifth of the firm's credits arrive with a depositor's name instead of an account number, and a
 * sixth of the lines are money going OUT. Showing "1 815 payments" would be three different
 * numbers wearing one label.
 */
export function BankImportCard({ onImported }: { onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [statement, setStatement] = useState<BankStatement | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<BankImportHistory[]>([])

  const loadHistory = useCallback(async () => {
    try { setHistory(await fetchBankImportHistory()) } catch { /* the card still works without it */ }
  }, [])
  useEffect(() => { void loadHistory() }, [loadHistory])

  async function read(file: File) {
    setError(null); setOutcome(null); setFileName(file.name)
    try {
      const parsed = parseBankStatement(await file.text())
      if (parsed.lines.length === 0) {
        setStatement(null)
        setError('No transactions in that file. Export the account history from the bank as CSV.')
        return
      }
      setStatement(parsed)
    } catch (e) {
      setStatement(null)
      setError(e instanceof Error ? e.message : 'That file could not be read.')
    }
  }

  async function commit() {
    if (!statement || busy) return
    setBusy(true); setError(null)
    try {
      const result = await importBankLines({
        bankAccount: statement.accountNumber ?? 'unknown',
        bankAccountLabel: statement.accountLabel,
        lines: statement.lines,
      })
      setOutcome(result)
      setStatement(null)
      if (fileRef.current) fileRef.current.value = ''
      await loadHistory()
      onImported()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The statement could not be imported.')
    } finally { setBusy(false) }
  }

  const sum = statement ? summarise(statement.lines) : null

  return (
    <Card>
      <CardHeader title="Import a bank statement"
        subtitle="The account history from the bank, as CSV. Nothing is written until you confirm." />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f) }} />
        <button type="button" onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg
            border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500">
          <FileUp size={14} /> Choose a statement
        </button>
        {fileName && <span className="text-[13px] text-slate-500">{fileName}</span>}
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-negative-50 px-3 py-2 text-[13px] text-negative-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {/* ---- what the file would do ---- */}
      {statement && sum && (
        <div className="mt-4 space-y-3">
          <p className="text-[13px] text-slate-600">
            {statement.accountLabel ?? 'Account'} {statement.accountNumber}
            {statement.accountName ? ` · ${statement.accountName}` : ''} ·{' '}
            {statement.lines.length.toLocaleString('en-ZA')} lines
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile label="Received" value={rand(sum.creditTotal)} note={`${sum.credits} receipts`} tone="good" />
            <Tile label="With a reference" value={sum.withReference.toLocaleString('en-ZA')}
              note="matched to an account where the number is known" />
            <Tile label="For you to place" value={sum.withoutReference.toLocaleString('en-ZA')}
              note="a depositor's name, not an account number" tone={sum.withoutReference ? 'warn' : undefined} />
            <Tile label="Paid out" value={rand(sum.debitTotal)} note={`${sum.debits} payments out — not imported`} />
          </div>

          {/*
            SAID BEFORE IT IS PRESSED, because a payment cannot be deleted afterwards. The three
            sentences are the three things that will happen, in the order they happen.
          */}
          <p className="text-[12px] text-slate-500 leading-relaxed">
            Receipts whose reference names exactly one account become payments, and each one is
            split immediately — receipt fee, interest, costs, capital, commission. The rest wait in
            the list below for you to place. Money paid out is kept so the statement reconciles,
            but nothing is imported from it until you tie it to a payover run.
            {sum.notes > 0 && ` ${sum.notes} zero-amount line${sum.notes === 1 ? '' : 's'} ignored.`}
          </p>

          {statement.problems.length > 0 && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              <p className="font-medium">{statement.problems.length} line(s) could not be read:</p>
              <ul className="mt-1 space-y-0.5">
                {statement.problems.slice(0, 5).map((p) => <li key={p}>{p}</li>)}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void commit()} disabled={busy}
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg
                bg-brand-600 text-white disabled:opacity-40">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {busy ? 'Importing…' : 'Import this statement'}
            </button>
            <button type="button" onClick={() => { setStatement(null); setFileName(null) }}
              className="text-sm text-slate-600 hover:text-slate-800 px-2">Cancel</button>
          </div>
        </div>
      )}

      {/* ---- what the last upload did ---- */}
      {outcome && (
        <div className="mt-4 rounded-lg bg-positive-50 px-3 py-3 text-[13px] text-positive-800">
          <p className="flex items-center gap-1.5 font-medium">
            <Check size={14} /> {outcome.allocated.toLocaleString('en-ZA')} payments recorded and split.
          </p>
          <ul className="mt-1.5 space-y-0.5 text-[12px] text-slate-600">
            {outcome.unallocated > 0 && (
              <li>{outcome.unallocated.toLocaleString('en-ZA')} receipts are waiting for you to place.</li>
            )}
            {/*
              A DUPLICATE IS NOT A FAILURE AND IS WORTH SAYING. Statements overlap at month ends,
              so re-uploading September plus a week of October is the ordinary case -- and a person
              who is not told will think the import lost the lines.
            */}
            {outcome.duplicates > 0 && (
              <li>{outcome.duplicates.toLocaleString('en-ZA')} lines were already imported and were left alone.</li>
            )}
            {outcome.debits > 0 && <li>{outcome.debits.toLocaleString('en-ZA')} payments out are waiting to be tied to a run.</li>}
            {/*
              AMBIGUOUS IS ITS OWN LINE, because it is the one that needs a decision rather than a
              search: the reference matched more than one account, and both look right.
            */}
            {outcome.ambiguous > 0 && (
              <li className="text-amber-800">
                {outcome.ambiguous} reference(s) matched more than one account and were not placed.
              </li>
            )}
          </ul>
        </div>
      )}

      {/* ---- and what is already in ---- */}
      {history.length > 0 && !statement && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          {history.map((h) => (
            <div key={h.bankAccount} className="flex flex-wrap items-baseline justify-between gap-2 text-[12px]">
              <span className="text-slate-600">
                <Banknote size={12} className="inline mr-1 text-slate-400" />
                {h.bankAccountLabel ?? 'Account'} {h.bankAccount} · {h.firstTxn} to {h.lastTxn}
              </span>
              <span className="text-slate-500 tabular-nums">
                {h.lines.toLocaleString('en-ZA')} lines · {rand(h.received)} in · {rand(h.paidOut)} out
                {h.unallocated > 0 ? ` · ${h.unallocated} unplaced` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function Tile({ label, value, note, tone }: {
  label: string; value: string; note?: string; tone?: 'good' | 'warn'
}) {
  const skin = tone === 'good' ? 'text-[var(--c-green)]'
    : tone === 'warn' ? 'text-amber-700' : 'text-navy-950'
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-[15px] font-semibold tabular-nums ${skin}`}>{value}</p>
      {note && <p className="text-[11px] text-slate-400 leading-snug mt-0.5">{note}</p>}
    </div>
  )
}
