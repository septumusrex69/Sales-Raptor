import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { inputClass } from '../../components/ui/Modal'
import { useAppStore } from '../../store/AppStore'
import {
  LEAVE_OUT_ROW, matchCarried, parseCarriedSheet, shortDay, type CarriedEntry, type CarriedSheetRow, type ClientChoice,
  type PersonOption,
} from '../../lib/clerkCommission.ts'
import {
  addCarried, fetchCarried, fetchCommissionStart, reverseCarried, saveCommissionStart,
} from '../../lib/peopleApi'
import { parseCsv } from '../../lib/csv'
import { readXlsx } from '../../lib/xlsx'
import { rand } from '../../lib/money'

/**
 * THE CLEAN CUT, AND WHAT THE OLD SYSTEM STILL OWED THE CLERKS (the firm, 23 Oct).
 *
 * THE FIRM: "we start on a clean cut. We're going to carry over which PTCs have not been paid out to
 * the clerks, because of old payments and clients that owe us money ... that will correspond with the
 * clients that owe the company money ... when those ones eventually get settled ... then we can pay
 * out the old commission ones."
 *
 * TWO THINGS, ONE PAGE, because they are one decision: the COMMISSION START DATE (payments before it
 * earn nothing in Raptor -- the old system paid them) and the CARRIED-OVER entries that stand in for
 * the PTC commission the old system had not yet paid. Each entry waits exactly like a PTC and is
 * released by the same payover rule (clerkCommission.ts, releaseOf).
 *
 * APPEND-ONLY: a mistake is put right by a reversing entry with a reason, never an edit, so a pay
 * day already paid still reads the same.
 *
 * THE SHEET IS READ HERE AND NEVER STORED -- it names clerks and clients, and this repository is
 * public. Matched like the brought-forward balances: exactly, or a person picks.
 */
export function CarriedOver() {
  const { users, companies, userById } = useAppStore()
  const [start, setStart] = useState<string | null>(null)
  const [startDraft, setStartDraft] = useState('')
  const [entries, setEntries] = useState<CarriedEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([fetchCommissionStart(), fetchCarried(null)])
      setStart(s); setStartDraft(s ?? ''); setEntries(e)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read the carried-over commission.') }
  }, [])
  useEffect(() => { void load() }, [load])

  const people: PersonOption[] = useMemo(() => users.map((u) => ({ id: u.id, name: u.name, email: u.email })), [users])
  const clients: ClientChoice[] = useMemo(() => companies.map((c) => ({ id: c.id, name: c.name, code: c.code ?? null })), [companies])
  const clientName = (id: string) => companies.find((c) => c.id === id)?.name ?? 'Client'

  async function saveStart() {
    setMsg(null)
    try { await saveCommissionStart(startDraft || null); setMsg('Commission start date saved.'); await load() }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Could not save.') }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">Carried over</h1>
        <span className="text-xs text-slate-400">The clean cut, and PTC commission the old system still owed</span>
      </div>
      {error && <Card className="p-4 text-sm text-negative-700 bg-negative-50 border-negative-100">{error}</Card>}

      <Card>
        <h2 className="text-[15px] font-semibold text-slate-800 mb-1">Commission start date</h2>
        <p className="text-[12px] text-slate-500 mb-3 max-w-2xl">
          Payments received before this day earn no commission in Raptor — they were paid in the old system. PTC commission the
          old system had not paid yet is entered below as carried over.
        </p>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="space-y-1"><span className="text-slate-500 text-[12px]">From</span>
            <input type="date" className={inputClass} value={startDraft} onChange={(e) => setStartDraft(e.target.value)} data-testid="commission-start" /></label>
          <Button variant="primary" onClick={() => void saveStart()} disabled={startDraft === (start ?? '')}>Save</Button>
          <span className="text-[12px] text-slate-500">{start ? `In force: ${shortDay(start)}` : 'Not set: every payment counts.'}</span>
          {msg && <span className="text-[12px] text-slate-500">{msg}</span>}
        </div>
      </Card>

      <AddByHand people={people} clients={clients} onSaved={load} />
      <ImportSheet people={people} clients={clients} onSaved={load} />

      {entries === null && !error ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-6"><Loader2 size={16} className="animate-spin" /> Reading…</div>
      ) : entries && (
        <Card className="overflow-hidden" padded={false}>
          <h2 className="px-4 pt-3 pb-2 text-[15px] font-semibold text-slate-800">Entries</h2>
          {entries.length === 0
            ? <p className="px-4 pb-3 text-sm text-slate-400">None yet.</p>
            : (
              <div className="overflow-x-auto">
                <table className="w-full list-table" data-testid="carried-entries">
                  <thead>
                    <tr className="bg-slate-50 text-slate-400">
                      <th className="text-left font-medium px-4 py-2">Clerk</th>
                      <th className="text-left font-medium px-4 py-2">Client</th>
                      <th className="text-right font-medium px-4 py-2">Amount</th>
                      <th className="text-left font-medium px-4 py-2">Note</th>
                      <th className="text-left font-medium px-4 py-2">From</th>
                      <th className="text-left font-medium px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <EntryRow key={e.id} e={e} clerk={userById(e.userId)?.name ?? 'Unknown'} client={e.client ?? clientName(e.companyId)} onSaved={load} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Card>
      )}
    </div>
  )
}

function EntryRow({ e, clerk, client, onSaved }: { e: CarriedEntry; clerk: string; client: string; onSaved: () => Promise<void> }) {
  const [reversing, setReversing] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function reverse() {
    setBusy(true); setErr(null)
    try { await reverseCarried(e.id, reason.trim(), e); await onSaved() }
    catch (x) { setErr(x instanceof Error ? x.message : 'Could not reverse it.') }
    finally { setBusy(false) }
  }
  return (
    <tr className="border-t border-slate-100 text-sm align-top">
      <td className="px-4 py-1.5">{clerk}</td>
      <td className="px-4 py-1.5">{client}</td>
      <td className={`px-4 py-1.5 text-right tabular-nums ${e.reversedOn ? 'line-through text-slate-400' : ''}`}>{rand(e.amount)}</td>
      <td className="px-4 py-1.5 text-slate-600">{e.note ?? ''}</td>
      <td className="px-4 py-1.5 text-slate-500 whitespace-nowrap">{e.source} · {shortDay(e.createdOn)}</td>
      <td className="px-4 py-1.5 text-right">
        {e.reversedOn ? (
          <span className="text-[12px] text-negative-700">Reversed {shortDay(e.reversedOn)}{e.reversalReason ? `: ${e.reversalReason}` : ''}</span>
        ) : reversing ? (
          <span className="inline-flex items-center gap-2">
            <input className={inputClass} placeholder="Why (required)" value={reason} onChange={(x) => setReason(x.target.value)} />
            <Button variant="primary" onClick={() => void reverse()} disabled={busy || reason.trim().length < 3}>Reverse</Button>
          </span>
        ) : (
          <button type="button" className="text-[12px] text-brand-700 hover:underline" onClick={() => setReversing(true)}>Reverse…</button>
        )}
        {err && <span className="block text-[11px] text-negative-700">{err}</span>}
      </td>
    </tr>
  )
}

function AddByHand({ people, clients, onSaved }: { people: PersonOption[]; clients: ClientChoice[]; onSaved: () => Promise<void> }) {
  const [userId, setUserId] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const value = Number(amount.replace(/[\s,]/g, ''))
  const ready = !!userId && !!companyId && Number.isFinite(value) && value > 0
  async function save() {
    setBusy(true); setMsg(null)
    try {
      await addCarried([{ userId, companyId, amount: Math.round(value * 100) / 100, note: note.trim() || null, source: 'Typed in' }])
      setAmount(''); setNote(''); setMsg('Added.')
      await onSaved()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not add it.') }
    finally { setBusy(false) }
  }
  return (
    <Card>
      <h2 className="text-[15px] font-semibold text-slate-800 mb-3">Add one by hand</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <label className="space-y-1"><span className="text-slate-500 text-[12px]">Clerk</span>
          <select className={inputClass} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choose…</option>
            {[...people].sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        <label className="space-y-1"><span className="text-slate-500 text-[12px]">Client</span>
          <select className={inputClass} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">Choose…</option>
            {[...clients].sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <label className="space-y-1"><span className="text-slate-500 text-[12px]">Commission owed (R)</span>
          <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-slate-500 text-[12px]">Note</span>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" onClick={() => void save()} disabled={busy || !ready}>Add</Button>
        {msg && <span className="text-[12px] text-slate-500">{msg}</span>}
      </div>
    </Card>
  )
}

function ImportSheet({ people, clients, onSaved }: { people: PersonOption[]; clients: ClientChoice[]; onSaved: () => Promise<void> }) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<CarriedSheetRow[] | null>(null)
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const matched = useMemo(() => (rows ? matchCarried(rows, people, clients, picks) : []), [rows, people, clients, picks])
  const ready = matched.filter((r) => r.state === 'ready')
  const blocking = matched.filter((r) => r.state === 'pick' || r.state === 'not_an_amount')

  async function read(f: File) {
    setMsg(null); setRows(null); setPicks({})
    try {
      const records = /\.xlsx$/i.test(f.name) ? await readXlsx(await f.arrayBuffer()) : parseCsv(await f.text())
      setRows(parseCarriedSheet(records)); setFileName(f.name)
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not read that file.') }
  }
  async function write() {
    if (!fileName) return
    setBusy(true); setMsg(null)
    try {
      await addCarried(ready.map((r) => ({
        userId: r.userId as string, companyId: r.companyId as string, amount: r.amount as number, note: r.note, source: fileName,
      })))
      setMsg(`${ready.length} entr${ready.length === 1 ? 'y' : 'ies'} added from ${fileName}.`)
      setRows(null); setFileName(null)
      await onSaved()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not add them.') }
    finally { setBusy(false) }
  }
  const pick = (k: string, v: string) => setPicks((p) => { const n = { ...p }; if (v) n[k] = v; else delete n[k]; return n })

  return (
    <Card>
      <h2 className="text-[15px] font-semibold text-slate-800 mb-1">Import from a sheet</h2>
      <p className="text-[12px] text-slate-500 mb-3 max-w-2xl">
        A .csv or .xlsx with a Clerk column (name or email), a Client column (name or code) and an Amount column; a Note column
        is kept if there is one. Matched exactly, or you pick. Nothing is written until you press Add, and the file is not kept.
      </p>
      <input type="file" accept=".csv,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f) }} />
      {msg && <p className="mt-2 text-[12px] text-slate-600">{msg}</p>}
      {rows && (
        <div className="mt-3 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full list-table text-sm" data-testid="carried-preview">
              <thead>
                <tr className="bg-slate-50 text-slate-400">
                  <th className="text-left font-medium px-3 py-2">Row</th>
                  <th className="text-left font-medium px-3 py-2">Clerk</th>
                  <th className="text-left font-medium px-3 py-2">Client</th>
                  <th className="text-right font-medium px-3 py-2">Amount</th>
                  <th className="text-left font-medium px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {matched.map((r) => (
                  <tr key={r.row} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-1.5 text-slate-400">{r.row}</td>
                    <td className="px-3 py-1.5">
                      {r.clerk}
                      {r.state !== 'left_out' && (
                        <select className={`${inputClass} mt-1`} value={picks[`${r.row}:clerk`] ?? r.userId ?? ''} onChange={(e) => pick(`${r.row}:clerk`, e.target.value)}>
                          <option value="">Pick the clerk…</option>
                          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {r.client}
                      {r.state !== 'left_out' && (
                        <select className={`${inputClass} mt-1`} value={picks[`${r.row}:client`] ?? r.companyId ?? ''} onChange={(e) => pick(`${r.row}:client`, e.target.value)}>
                          <option value="">Pick the client…</option>
                          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.amount === null ? r.raw : rand(r.amount)}</td>
                    <td className="px-3 py-1.5 text-[12px]">
                      {r.state === 'ready' ? <span className="text-positive-700">Ready</span>
                        : r.state === 'left_out' ? <span className="text-slate-400">Left out</span>
                          : <span className="text-amber-800">{r.why}</span>}
                      <button type="button" className="block text-[11px] text-slate-500 hover:underline"
                        onClick={() => pick(`${r.row}`, r.state === 'left_out' ? '' : LEAVE_OUT_ROW)}>
                        {r.state === 'left_out' ? 'Put back' : 'Leave out'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={() => void write()} disabled={busy || ready.length === 0 || blocking.length > 0}>
              Add {ready.length} entr{ready.length === 1 ? 'y' : 'ies'}
            </Button>
            <span className="text-[12px] text-slate-500">
              Total {rand(ready.reduce((s, r) => s + (r.amount ?? 0), 0))}
              {blocking.length > 0 && ` · ${blocking.length} row${blocking.length === 1 ? '' : 's'} still need a person`}
            </span>
          </div>
        </div>
      )}
    </Card>
  )
}
