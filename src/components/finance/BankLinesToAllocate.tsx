import { useCallback, useEffect, useMemo, useState } from 'react'
import { ReturnedReceiptPicker } from './ReturnedReceiptPicker'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Card } from '../ui/Card'
import { controlClass } from '../ui/Modal'
import { rand } from '../../lib/money'
import { formatDate } from '../../data/mockData'
import { fetchFirmSettings } from '../../lib/firmSettings'
import {
  KIND_LABEL, KIND_NOTE, candidatesFor, kindsFor, lineNature, needsReason, needsTarget, suggestAllocation,
  type AllocationKind, type Candidate, type StatementLine,
} from '../../lib/bankLineAllocation'
import {
  allocateBankLine, fetchAllocationCandidates, fetchLinesToAllocate, matchPayoversByReference,
} from '../../lib/bankAllocationApi'

/**
 * EVERY LINE ON THE TRUST STATEMENT THAT IS NOT YET ACCOUNTED FOR (prompt 12).
 *
 * THE FIRM: "Every single payment going in or going out should be allocated and have a reason for
 * being there." Money paid out used to be "kept so the statement reconciles" and then tied to
 * nothing unless it happened to be a payover run of exactly its amount; a bank charge sat on the
 * statement with nothing on the ledger behind it, and the bank and the ledger disagreed by it for
 * ever. Until every line here is allocated, the trust overview's bank-against-ledger figure is not
 * nought -- this is the list that says why.
 *
 * SUGGESTED, NEVER DONE FOR YOU. Each line opens on the obvious answer where there is one (the
 * bank's own "##BANK CHARGE", the only run of exactly that amount), and nothing happens until
 * somebody presses Allocate -- each one writes a trust ledger entry that cannot be taken back.
 *
 * A DEBTOR'S PAYMENT IS NOT ALLOCATED HERE. Money in from a debtor is placed on their account
 * under Payments in, which is where the receipt is split; this offers only what money in can be
 * when it is NOT a debtor's.
 */
export function BankLinesToAllocate() {
  const [lines, setLines] = useState<StatementLine[] | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [business, setBusiness] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [matching, setMatching] = useState(false)
  const [matchNote, setMatchNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [l, c, firm] = await Promise.all([
        fetchLinesToAllocate(), fetchAllocationCandidates(), fetchFirmSettings().catch(() => null),
      ])
      setLines(l); setCandidates(c); setBusiness(firm?.businessAccountNumber ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the statement.')
      setLines([])
    }
  }, [])
  useEffect(() => { void load() }, [load])

  if (lines === null) {
    return (
      <Card className="flex items-center gap-2 text-sm text-slate-400">
        <Loader2 size={16} className="animate-spin" /> Reading the statement…
      </Card>
    )
  }
  const out = lines.filter((l) => l.direction === 'debit')
  const inn = lines.filter((l) => l.direction === 'credit')
  /* Debits that name a run (BF PO-...) -- the ones "Match by reference" can settle. */
  const naming = out.filter((l) => /PO-[A-Z0-9]+-\d{4}/i.test(`${l.reference ?? ''} ${l.description}`)).length

  /*
   * MATCH PAYOVERS BY THEIR REFERENCE FIRST (the firm, 10 Oct). The import already does this; the
   * button is for a run approved AFTER its statement was imported, and for anybody who wants to see
   * it happen. Only the exact amount is matched; the rest is said, and stays here for a person.
   */
  async function matchByReference() {
    setMatching(true); setMatchNote(null); setError(null)
    try {
      const m = await matchPayoversByReference()
      setMatchNote([
        `${m.matched} payover${m.matched === 1 ? '' : 's'} matched by the BF PO reference.`,
        ...m.notes.map((n) => `Not matched: ${n}`),
      ].join(' '))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not match by reference.')
    } finally { setMatching(false) }
  }

  return (
    <Card className="p-0 overflow-hidden" >
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-800" data-testid="lines-to-allocate-heading">
          Statement lines not yet allocated
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          {lines.length === 0
            ? 'Every line on the trust statement is accounted for.'
            : `${lines.length} line${lines.length === 1 ? '' : 's'} — ${rand(out.reduce((s, l) => s + Math.abs(l.amount), 0))} out, `
              + `${rand(inn.reduce((s, l) => s + l.amount, 0))} in. The trust ledger does not balance against the bank until each one is allocated.`}
        </p>
      </div>
      {naming > 0 && (
        <div className="px-4 py-2 border-b border-slate-100 flex flex-wrap items-center gap-2 text-[12.5px]">
          <button type="button" disabled={matching} onClick={() => void matchByReference()}
            data-testid="match-by-reference"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {matching && <Loader2 size={12} className="animate-spin" />} Match {naming} payover{naming === 1 ? '' : 's'} by reference
          </button>
          <span className="text-slate-500">A payment out carrying BF PO-… at the run’s exact amount settles that run.</span>
        </div>
      )}
      {matchNote && <p className="px-4 py-2 text-[12.5px] text-slate-600" data-testid="match-note">{matchNote}</p>}
      {error && <p className="px-4 py-3 text-sm text-negative-700">{error}</p>}
      <div className="divide-y divide-slate-100">
        {lines.map((l) => (
          <LineRow key={l.id} line={l} candidates={candidates} business={business} onDone={load} />
        ))}
      </div>
    </Card>
  )
}

function LineRow({ line, candidates, business, onDone }: {
  line: StatementLine; candidates: Candidate[]; business: string | null; onDone: () => void
}) {
  const suggestion = useMemo(() => suggestAllocation(line, candidates, business), [line, candidates, business])
  /* 'returned' is not an allocation kind in the database: it is a receipt coming back unpaid, done by
     return_bounced_receipt (prompt 12). Chosen for the line when the bank's own words say so. */
  const [kind, setKind] = useState<AllocationKind | 'returned' | ''>(
    lineNature(line.description, line.direction) === 'returned_debit' ? 'returned' : suggestion?.kind ?? '')
  const [target, setTarget] = useState<string>(suggestion?.targetId ?? '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const realKind = kind === 'returned' ? '' : kind
  const options = realKind ? candidatesFor(line, realKind, candidates) : []
  const ready = !!realKind && (!needsTarget(realKind) || !!target) && (!needsReason(realKind) || reason.trim().length > 0)

  async function go() {
    if (!realKind) return
    setBusy(true); setError(null)
    try { await allocateBankLine(line.id, realKind, reason.trim() || null, target || null); onDone() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="px-4 py-3 space-y-2" data-testid="line-to-allocate">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-sm text-slate-800 break-words">{line.description || 'No description on the statement'}</p>
          <p className="text-[11px] text-slate-400">
            {formatDate(line.txnDate)} · {line.direction === 'debit' ? 'Paid out' : 'Received'}
            {line.bankAccountLabel ? ` · ${line.bankAccountLabel}` : ''}
          </p>
        </div>
        <span className={`tabular-nums text-sm font-medium ${line.direction === 'debit' ? 'text-slate-900' : 'text-emerald-700'}`}>
          {line.direction === 'debit' ? '−' : ''}{rand(Math.abs(line.amount))}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="What this line was" value={kind}
          onChange={(e) => { const k = e.target.value as AllocationKind | 'returned' | ''; setKind(k); setTarget(k && k === suggestion?.kind ? suggestion.targetId ?? '' : '') }}
          className="text-sm rounded-lg border border-slate-200 px-2 py-1.5 bg-white">
          <option value="">{line.direction === 'credit' ? 'Not a debtor’s payment? Choose…' : 'Choose what it was…'}</option>
          {kindsFor(line.direction).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          {line.direction === 'debit' && <option value="returned">Returned / unpaid receipt</option>}
        </select>
        {kind === 'returned' && <ReturnedReceiptPicker lineId={line.id} onDone={onDone} />}
        {realKind && needsTarget(realKind) && (
          <select aria-label="Which one it settles" value={target} onChange={(e) => setTarget(e.target.value)}
            className="text-sm rounded-lg border border-slate-200 px-2 py-1.5 bg-white">
            <option value="">{options.length ? 'Which one…' : 'Nothing open of exactly this amount'}</option>
            {options.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        )}
        {kind === 'business_transfer' && candidatesFor(line, kind, candidates).length > 0 && (
          <select aria-label="The drawing it was" value={target} onChange={(e) => setTarget(e.target.value)}
            className="text-sm rounded-lg border border-slate-200 px-2 py-1.5 bg-white">
            <option value="">A new drawing</option>
            {candidatesFor(line, kind, candidates).map((c) => <option key={c.id} value={c.id}>Already recorded: {c.label}</option>)}
          </select>
        )}
        {realKind && (needsReason(realKind) || realKind === 'business_transfer' || realKind === 'business_transfer_in') && (
          <input className={`${controlClass} w-64`} value={reason} onChange={(e) => setReason(e.target.value)}
            aria-label="Reason" placeholder={needsReason(realKind) ? 'What was it? (required)' : 'Reference (optional)'} />
        )}
        {kind !== 'returned' && <button type="button" disabled={!ready || busy} onClick={go}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-navy-950 text-white disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy && <Loader2 size={13} className="animate-spin" />}
          {/* Says what it will do: a new drawing is a record of the firm's money leaving, not a tick. */}
          {realKind === 'business_transfer' && !target ? 'Record it as BF’s drawing' : 'Allocate'}
        </button>}
        {/* PLACE IT ON AN ACCOUNT -- the way back for a receipt rejected off a closed file (prompt
            11). Placed on SBB/2006 and approved, it is held whole as the debtor's credit and refunded
            from there; a credit line is never refunded directly, so the money always has an owner
            while it waits. */}
        {line.direction === 'credit' && (
          <Link to="/trust/payments#needs-an-account" data-testid="place-on-account"
            title="A debtor's payment, including one rejected off a closed account: place it on the account under Payments in, Needs an account. On a closed account it is held as the debtor's credit."
            className="text-xs font-medium text-[var(--c-steel)] hover:underline">
            Place on an account
          </Link>
        )}
      </div>
      {realKind && <p className="text-[11px] text-slate-400">{KIND_NOTE[realKind]}</p>}
      {kind === 'returned' && (
        <p className="text-[11px] text-slate-400">A debtor&rsquo;s payment the bank took back. The receipt is reversed (no receipt fee, the capital goes back on the account) and both statement lines close against each other.</p>
      )}
      {suggestion && kind === suggestion.kind && (
        <p className="text-[11px] text-slate-500">Suggested: {suggestion.why}</p>
      )}
      {error && <p className="text-xs text-negative-700">{error}</p>}
    </div>
  )
}
