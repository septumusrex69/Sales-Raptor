import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { controlClass, inputClass } from '../../components/ui/Modal'
import { supabase } from '../../lib/supabase'
import { rand } from '../../lib/money'
import { readXlsxSheets } from '../../lib/xlsx'
import { useAuth } from '../../store/AuthContext'
import {
  DEFAULT_CUT_OVER, LEAVE_OUT, broughtForwardLabel, monthLabel, broughtForwardPayload, matchRows, parseTrustDebtors,
  summarise, type ClientOption, type MatchedRow, type RowState, type TrustDebtorsSheet,
} from '../../lib/broughtForward'
import { bringForwardBalances, fetchBroughtForward, type BroughtForwardResult } from '../../lib/payover'

/**
 * BALANCES BROUGHT FORWARD FROM SWORDFISH (HANDOFF §3a, go-live item 3).
 *
 * Camille's "Trust Debtors" workbook says, month by month, what each client owes the firm. At the
 * cut-over its NEWEST month comes in once: a positive figure is owed to the firm and comes off the
 * client's next payover; a negative one is the client in credit and is paid WITH it. Either way it
 * is the first line of that client's ledger.
 *
 * READ IN THE BROWSER, WRITTEN IN ONE TRANSACTION. The file never leaves this page -- it is client
 * data -- and nothing is written until a person has seen every row matched and pressed Bring
 * forward. The database writes all of it or none, and skips a client that already has a balance
 * brought forward, so the same file pressed twice adds nothing.
 *
 * NEVER A GUESSED CLIENT. A name matches exactly (ignoring case and spacing) or by the client's code,
 * else a person picks. A figure on the wrong client is that client's payover paid short.
 */

const STATE: Record<RowState, { label: string; tone: string }> = {
  matched: { label: 'Matched', tone: 'bg-positive-100 text-positive-700' },
  unmatched: { label: 'Pick a client', tone: 'bg-amber-100 text-amber-800' },
  left_out: { label: 'Left out', tone: 'bg-slate-100 text-slate-600' },
  zero: { label: 'Nothing owed', tone: 'bg-slate-100 text-slate-500' },
  no_name: { label: 'No client name', tone: 'bg-slate-100 text-slate-600' },
  unreadable: { label: 'Not an amount', tone: 'bg-negative-100 text-negative-700' },
  twice: { label: 'Same client twice', tone: 'bg-negative-100 text-negative-700' },
  already: { label: 'Already brought forward', tone: 'bg-slate-100 text-slate-600' },
}

/* Rows a person has to look at first; the zero rows are counted and folded away. */
const ORDER: RowState[] = ['unmatched', 'twice', 'unreadable', 'matched', 'already', 'left_out', 'no_name', 'zero']

export function BroughtForward() {
  const { currentUser } = useAuth()
  const [clients, setClients] = useState<ClientOption[] | null>(null)
  const [already, setAlready] = useState<Set<string>>(new Set())
  const [fileName, setFileName] = useState<string | null>(null)
  const [sheet, setSheet] = useState<TrustDebtorsSheet | null>(null)
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [cutOver, setCutOver] = useState(DEFAULT_CUT_OVER)
  const [showZero, setShowZero] = useState(false)
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<BroughtForwardResult | null>(null)

  const loadExisting = useCallback(async () => {
    const [c, bf] = await Promise.all([
      supabase.from('companies').select('id, name, code').order('name'),
      fetchBroughtForward(),
    ])
    if (c.error) throw new Error(c.error.message)
    setClients(((c.data ?? []) as { id: string; name: string; code: string | null }[])
      .map((x) => ({ id: x.id, name: x.name, code: x.code })))
    setAlready(new Set(bf.map((b) => b.companyId)))
  }, [])

  useEffect(() => {
    loadExisting().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [loadExisting])

  const rows = useMemo(
    () => (sheet && clients ? matchRows(sheet, clients, picks, already) : []),
    [sheet, clients, picks, already],
  )
  const summary = useMemo(() => summarise(rows), [rows])
  const shown = useMemo(() => [...rows]
    .filter((r) => showZero || r.state !== 'zero')
    .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.row - b.row), [rows, showZero])
  const nameOf = useMemo(() => new Map((clients ?? []).map((c) => [c.id, c])), [clients])

  /* An Administrator with the trust tick; the route already asks for the tick, the function asks for both. */
  if (currentUser && currentUser.role !== 'Administrator') {
    return <Card className="p-5 text-sm text-slate-600">Bringing balances forward is for an Administrator.</Card>
  }

  const read = async (file: File) => {
    setError(null); setDone(null); setSheet(null); setPicks({}); setReading(true)
    try {
      const parsed = parseTrustDebtors(await readXlsxSheets(await file.arrayBuffer()))
      setFileName(file.name)
      setSheet(parsed)
    } catch (e) {
      setFileName(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally { setReading(false) }
  }

  const bring = async () => {
    if (!sheet || !fileName) return
    setSaving(true); setError(null)
    try {
      const result = await bringForwardBalances({
        source: fileName, month: sheet.month, cutOver, rows: broughtForwardPayload(rows),
      })
      setDone(result)
      await loadExisting()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  const pick = (ref: string, value: string) => setPicks((p) => {
    const next = { ...p }
    if (value === '') delete next[ref]; else next[ref] = value
    return next
  })

  return (
    <div className="space-y-5">
      <div>
        <Link to="/trust/settings" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-slate-500 hover:text-slate-700">
          <ArrowLeft size={13} /> Trust settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-800">Balances brought forward</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          What each client owed the firm, or was owed, in Swordfish at the cut-over, from Camille&rsquo;s
          Trust Debtors workbook. A balance owed comes off the client&rsquo;s next payover; a credit is paid
          with it. Each one is the first line of that client&rsquo;s ledger.
        </p>
      </div>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="text-[12.5px] font-medium text-slate-600">The workbook (.xlsx)</span>
            <input type="file" accept=".xlsx" data-testid="bf-file" className="mt-1 block text-sm"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f) }} />
          </label>
          <label className="block">
            <span className="text-[12.5px] font-medium text-slate-600">Brought forward on (the cut-over)</span>
            <input type="date" value={cutOver} onChange={(e) => setCutOver(e.target.value)} data-testid="bf-cutover"
              className={clsx(inputClass, 'mt-1 w-44')} />
          </label>
          {reading && <span className="flex items-center gap-1.5 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> Reading the sheet…</span>}
        </div>
        {sheet && (
          <p className="text-sm text-slate-600" data-testid="bf-month">
            Bringing forward <strong>{sheet.monthLabel}</strong>, the newest month on the {sheet.sheet} sheet (column {sheet.column}).
            Every line will read &ldquo;{broughtForwardLabel(sheet.month)}&rdquo;.
          </p>
        )}
      </Card>

      {/* A plain div, not Card: Card does not pass a test id through. */}
      {error && <div className="card bg-negative-50 p-4 text-sm text-negative-700" data-testid="bf-error">{error}</div>}

      {done && (
        <div className="card bg-positive-50 p-4 text-sm text-positive-800" data-testid="bf-done">
          Brought forward {done.added} {done.added === 1 ? 'balance' : 'balances'}: {rand(done.owed)} owed to the firm
          and {rand(done.credited)} owed to clients, dated {longDay(cutOver)}.
          {done.skipped > 0 && ` ${done.skipped} ${done.skipped === 1 ? 'client already had one' : 'clients already had one'} and ${done.skipped === 1 ? 'was' : 'were'} left as ${done.skipped === 1 ? 'it was' : 'they were'}.`}
        </div>
      )}

      {sheet && clients && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="bf-summary">
            <Tile label="Matched" value={String(summary.matched)} testid="bf-matched" />
            <Tile label="Need a client" value={String(summary.unmatched)} tone={summary.unmatched ? 'text-amber-700' : undefined} testid="bf-unmatched" />
            <Tile label="Nothing owed" value={String(summary.zero)} testid="bf-zero" />
            <Tile label="Owed to the firm" value={rand(summary.owed)} tone="text-negative-700" testid="bf-owed" />
            <Tile label="Credit to clients" value={rand(summary.credited)} tone="text-positive-700" testid="bf-credited" />
          </div>

          <Card padded={false} className="overflow-x-auto">
            <table className="w-full list-table whitespace-nowrap">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-400">
                  <th className="px-4 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">On the sheet</th>
                  <th className="px-3 py-2 text-right font-medium">{sheet.monthLabel}</th>
                  <th className="px-3 py-2 font-medium">Raptor client</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => <Row key={r.ref} r={r} clients={clients} nameOf={nameOf} value={picks[r.ref] ?? ''} onPick={pick} />)}
              </tbody>
            </table>
            {summary.zero > 0 && (
              <button type="button" onClick={() => setShowZero((v) => !v)}
                className="w-full border-t border-slate-100 px-4 py-2 text-left text-[12.5px] font-medium text-slate-500 hover:bg-slate-50">
                {showZero ? 'Hide' : 'Show'} the {summary.zero} {summary.zero === 1 ? 'row' : 'rows'} with nothing owed
              </button>
            )}
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-[12.5px] text-slate-500">
              {summary.ready
                ? `${summary.matched} ${summary.matched === 1 ? 'balance' : 'balances'} will be dated ${longDay(cutOver)} and set off against each client's next payover. Nothing on a debtor's account changes.`
                : summary.matched === 0
                  ? 'No row is matched to a client yet.'
                  : 'Pick a client, or leave the row out, for every row that needs one before bringing anything forward.'}
            </p>
            <button type="button" onClick={() => void bring()} disabled={!summary.ready || saving || !cutOver}
              data-testid="bf-bring"
              className="rounded-lg bg-gold-600 px-4 py-2 text-sm font-semibold text-white hover:bg-gold-700 disabled:opacity-50">
              {saving ? 'Bringing forward…' : `Bring forward ${summary.matched} ${summary.matched === 1 ? 'balance' : 'balances'}`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** "2026-12-10" -> "10 December 2026": the day a person reads, not the one an input stores. */
function longDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${monthLabel(`${y}-${String(m).padStart(2, '0')}-01`)}`
}

function Tile({ label, value, tone, testid }: { label: string; value: string; tone?: string; testid: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">{label}</div>
      <div className={clsx('mt-1 text-lg font-semibold tabular-nums', tone ?? 'text-slate-800')} data-testid={testid}>{value}</div>
    </Card>
  )
}

function Row({ r, clients, nameOf, value, onPick }: {
  r: MatchedRow
  clients: ClientOption[]
  nameOf: Map<string, ClientOption>
  value: string
  onPick: (ref: string, value: string) => void
}) {
  const meta = STATE[r.state]
  /* A picker wherever a client is the question: not on a row with nothing to bring forward. */
  const pickable = r.name !== '' && r.amount !== null && r.amount !== 0
  /* A cell that is not an amount can only be left out: there is no figure to put on a client. */
  const leaveOnly = r.name !== '' && r.amount === null && r.raw !== ''
  const matched = r.companyId ? nameOf.get(r.companyId) : undefined
  return (
    <tr className="border-b border-slate-50 text-sm" data-testid="bf-row" data-state={r.state}>
      <td className="px-4 py-1.5 tabular-nums text-slate-400">{r.ref.split('!')[1] ?? r.row}</td>
      <td className="px-3 py-1.5 text-slate-800">{r.name || <span className="text-slate-400">No name</span>}</td>
      <td className={clsx('px-3 py-1.5 text-right tabular-nums',
        r.amount && r.amount > 0 ? 'text-negative-700' : r.amount && r.amount < 0 ? 'text-positive-700' : 'text-slate-400')}>
        {r.amount === null ? (r.raw || '—') : r.amount === 0 ? '—'
          : `${rand(Math.abs(r.amount))} ${r.amount > 0 ? 'owed' : 'credit'}`}
      </td>
      <td className="px-3 py-1.5">
        {pickable ? (
          <select value={value} onChange={(e) => onPick(r.ref, e.target.value)} data-testid="bf-pick"
            className={clsx(controlClass, 'w-72 py-1 text-[13px]')}>
            <option value="">{matched && r.how !== 'picked' ? `${matched.name} (by ${r.how})` : 'Choose a client…'}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>)}
            <option value={LEAVE_OUT}>Leave this row out</option>
          </select>
        ) : leaveOnly ? (
          <select value={value} onChange={(e) => onPick(r.ref, e.target.value)} data-testid="bf-pick"
            className={clsx(controlClass, 'w-72 py-1 text-[13px]')}>
            <option value="">Not an amount</option>
            <option value={LEAVE_OUT}>Leave this row out</option>
          </select>
        ) : <span className="text-slate-400">—</span>}
      </td>
      <td className="px-4 py-1.5">
        <span className={clsx('rounded-full px-2 py-px text-[11px] font-medium', meta.tone)}>{meta.label}</span>
        {r.note && <span className="ml-2 text-[12px] text-slate-400">{r.note}</span>}
      </td>
    </tr>
  )
}
