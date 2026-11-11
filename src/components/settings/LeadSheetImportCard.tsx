import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, FileUp, Info, Loader2, RotateCcw, Upload } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { inputClass } from '../ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { useAppStore } from '../../store/AppStore'
import { supabase } from '../../lib/supabase'
import { parseCsvRows } from '../../lib/csv'
import { readXlsxRows } from '../../lib/xlsx'
import {
  FIELDS, FIELD_BY_KEY, OUTCOMES, guessMapping, guessValues, mappingConflicts, mergeValueMaps, planLeadSheet, readSheet,
  type ColumnTarget, type LeadSheetPlan, type OutcomeId, type PlannedLead, type Sheet, type ValueMaps,
} from '../../lib/leadSheetImport'
import { COMMISSION_OPTIONS, CUSTOM, commissionLabel } from '../../lib/commissionPlans'
import { REJECTION_REASONS } from '../../lib/rejection'
import { formatCurrency, leadSources, services } from '../../data/mockData'
import type { LeadSource, ProductService, RejectionReason } from '../../types'
import { FilePicker } from './FilePicker'

/**
 * Importing a spreadsheet of leads.
 *
 * Same shape as the Swordfish import beside it: everything up to the last button is reading and
 * choosing, and writes nothing. It only ever adds — a lead Raptor already has (same email, or
 * same client name) is left alone — so it can be run again as a sheet keeps growing.
 *
 * Choices are remembered per sheet layout (its headings), in this browser, so the second import
 * of the same sheet is the file and one button.
 */

type Phase = { step: string; done: number; total: number } | null

/** Same mapping the app's own store uses on the way to Postgres. */
function toRow(record: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(record)) out[key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)] = v === undefined ? null : v
  return out
}

async function readGrid(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return readXlsxRows(await file.arrayBuffer())
  if (name.endsWith('.xls')) throw new Error(`${file.name} is in the old Excel format. Download it as .xlsx or .csv instead.`)
  return parseCsvRows(await file.text())
}

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' })
const CHUNK = 50
const EMPTY_MAPS: ValueMaps = { outcome: {}, source: {}, owner: {}, commission: {}, rejection: {} }

/** Browser storage can be missing or full; remembering is a convenience, never a requirement. */
const memoryKey = (sheet: Sheet) => `raptor.leadImport.${sheet.headers.join('|').toLowerCase()}`
function recall(sheet: Sheet): { mapping: ColumnTarget[]; maps: ValueMaps; service?: ProductService } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(memoryKey(sheet)) ?? 'null')
    return saved && Array.isArray(saved.mapping) && saved.mapping.length === sheet.headers.length ? saved : null
  } catch { return null }
}
function remember(sheet: Sheet, value: { mapping: ColumnTarget[]; maps: ValueMaps; service: ProductService }) {
  try { localStorage.setItem(memoryKey(sheet), JSON.stringify(value)) } catch { /* not worth interrupting for */ }
}

export function LeadSheetImportCard() {
  const { currentUser } = useAuth()
  const { users, leads, companies } = useAppStore()
  const [file, setFile] = useState<File | undefined>()
  const [ownerId, setOwnerId] = useState(currentUser?.id ?? '')
  const [service, setService] = useState<ProductService>('Debt Collection')
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [mapping, setMapping] = useState<ColumnTarget[]>([])
  const [maps, setMaps] = useState<ValueMaps>(EMPTY_MAPS)
  const [reading, setReading] = useState(false)
  const [phase, setPhase] = useState<Phase>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [remembered, setRemembered] = useState(false)

  const read = useCallback(async () => {
    if (!file) return
    setError(null); setDone(null); setSheet(null); setReading(true)
    try {
      const s = readSheet(await readGrid(file))
      if (s.headers.length === 0) throw new Error('That file is empty.')
      const saved = recall(s)
      const m = saved?.mapping ?? guessMapping(s)
      setSheet(s)
      setMapping(m)
      setMaps(mergeValueMaps(saved?.maps ?? EMPTY_MAPS, guessValues(s, m, users, ownerId).maps))
      if (saved?.service) setService(saved.service)
      setRemembered(!!saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setReading(false)
    }
  }, [file, users, ownerId])

  // A column moved changes which values exist; what was already chosen for a value stays chosen.
  const guessed = useMemo(() => (sheet ? guessValues(sheet, mapping, users, ownerId) : null), [sheet, mapping, users, ownerId])
  useEffect(() => {
    if (guessed) setMaps((prev) => mergeValueMaps(prev, guessed.maps))
  }, [guessed])

  const plan: LeadSheetPlan | null = useMemo(
    () => (sheet ? planLeadSheet(sheet, mapping, maps, { leads, companies, users }, { defaultOwnerId: ownerId, today: today(), service }) : null),
    [sheet, mapping, maps, leads, companies, users, ownerId, service],
  )

  const startOver = () => {
    if (!sheet) return
    const m = guessMapping(sheet)
    setMapping(m)
    setMaps(guessValues(sheet, m, users, ownerId).maps)
    setRemembered(false)
  }

  const write = useCallback(async () => {
    if (!plan || !sheet) return
    setError(null); setDone(null)
    remember(sheet, { mapping, maps, service })
    const all = plan.leads
    try {
      setPhase({ step: 'Checking the database is ready', done: 0, total: 0 })
      for (const table of ['companies', 'leads', 'deals']) {
        const { error: e } = await supabase.from(table).select('id').limit(1)
        if (e) throw new Error(`Can't reach "${table}" (${e.message}). Nothing has been written.`)
      }
      // The commission and language columns are new. Checked up front so a database that hasn't had them added
      // fails here, cleanly, rather than after the client records are already in.
      const { error: ce } = await supabase.from('leads').select('commission_rate, commission_scale, preferred_language').limit(1)
      const { error: le2 } = await supabase.from('companies').select('preferred_language').limit(1)
      if (ce || le2) {
        throw new Error(
          'This database doesn’t have the new commission and language columns yet. Run the "commission quoted '
          + 'on a debt collection lead" and "language" blocks from supabase/schema.sql first. Nothing has been written.',
        )
      }

      // Clients first: leads and deals both point at them.
      const newCompanies = all.flatMap((p) => (p.newCompany ? [p.newCompany] : []))
      for (let i = 0; i < newCompanies.length; i += CHUNK) {
        setPhase({ step: 'Creating client records', done: i, total: newCompanies.length })
        const { error: e } = await supabase.from('companies').insert(newCompanies.slice(i, i + CHUNK).map(toRow))
        if (e) throw new Error(`Creating client records: ${e.message}. No leads have been written yet.`)
      }
      for (const p of all.filter((x) => x.existingCompanyId && x.companyPatch)) {
        const { error: e } = await supabase.from('companies').update(toRow(p.companyPatch!)).eq('id', p.existingCompanyId!)
        if (e) throw new Error(`Recording ${p.lead.companyName}'s signed mandate: ${e.message}`)
      }

      // Then leads and their deals, a batch at a time and in date order, so the database numbers
      // them in the order they came in. A batch whose deals fail takes its leads back out with it
      // (deals cascade from leads), so running it again picks up exactly where this stopped.
      let written = 0
      for (let i = 0; i < all.length; i += CHUNK) {
        const batch: PlannedLead[] = all.slice(i, i + CHUNK)
        setPhase({ step: 'Writing leads', done: written, total: all.length })
        const { error: le } = await supabase.from('leads').insert(batch.map((p) => toRow(p.lead)))
        if (le) throw new Error(`Writing leads (from ${batch[0].lead.companyName}): ${le.message}. ${written} were written before this; run it again to add the rest.`)
        const { error: de } = await supabase.from('deals').insert(batch.map((p) => toRow(p.deal)))
        if (de) {
          await supabase.from('leads').delete().in('id', batch.map((p) => p.lead.id))
          throw new Error(`Writing deals (from ${batch[0].lead.companyName}): ${de.message}. ${written} leads were written before this; run it again to add the rest.`)
        }
        written += batch.length
      }
      setDone(`Imported ${written} leads, each with its ${service.toLowerCase()} deal.`)
      setSheet(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPhase(null)
    }
  }, [plan, sheet, mapping, maps, service])

  const activeUsers = users.filter((u) => u.status === 'Active')

  return (
    <Card>
      <CardHeader
        title="Import leads from a spreadsheet"
        subtitle="Download the sheet as .xlsx or .csv. You match its columns and values to Raptor's, see every lead before it's added, and nothing is written until the last button. Leads already in Raptor are skipped."
      />

      <FilePicker
        label="Leads spreadsheet"
        hint="Any sheet with one lead per row and a heading on each column."
        file={file}
        onPick={(f) => { setFile(f); setSheet(null); setDone(null); setError(null) }}
      />

      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Leads with no matching rep go to</span>
          <select className={inputClass} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {activeUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Service these leads are for</span>
          <select className={inputClass} value={service} onChange={(e) => setService(e.target.value as ProductService)}>
            {services.map((s) => <option key={s}>{s}</option>)}
          </select>
          <span className="block text-[11px] text-slate-400 mt-1">Every lead gets one deal for this service, as Add Lead does.</span>
        </label>
      </div>

      <button className="btn-primary mt-4 inline-flex items-center gap-2" disabled={!file || reading || !!phase} onClick={read}>
        {reading ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
        {reading ? 'Reading…' : sheet ? 'Read it again' : 'Read the sheet'}
      </button>

      {error && <p className="text-sm text-negative-700 mt-3 flex gap-2"><AlertTriangle size={15} className="shrink-0 mt-0.5" />{error}</p>}
      {done && (
        <div className="text-sm text-positive-700 mt-3 flex gap-2 items-start">
          <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
          <span>{done} <button className="underline font-medium" onClick={() => window.location.reload()}>Reload to see them</button></span>
        </div>
      )}

      {sheet && guessed && plan && (
        <div className="mt-6 space-y-6">
          {remembered && (
            <p className="text-xs text-slate-500 flex items-center gap-2">
              <Info size={13} /> Using the choices from the last import of a sheet laid out like this one.
              <button className="inline-flex items-center gap-1 underline" onClick={startOver}><RotateCcw size={11} /> Start from fresh guesses</button>
            </p>
          )}

          <Step n={1} title="Match the columns" subtitle="Each column of the sheet, and where it goes in Raptor. Anything sent to Notes is kept on the lead word for word, under its heading.">
            <ColumnsTable sheet={sheet} mapping={mapping} onChange={setMapping} />
          </Step>

          <Step n={2} title="Match the values" subtitle="Every different value in those columns, and what it means in Raptor. The number is how many leads have it.">
            <ValuesTables maps={maps} counts={guessed.counts} onChange={setMaps} users={activeUsers} />
          </Step>

          <Step n={3} title="Check, then import" subtitle="Nothing has been written yet.">
            <LeadSheetReview plan={plan} />
            {plan.leads.length > 0 && (
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={write}
                  disabled={!!phase}
                  className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-40"
                >
                  <Upload size={15} /> Import {plan.leads.length.toLocaleString('en-ZA')} leads
                </button>
                {phase && (
                  <span className="text-sm text-slate-500 flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    {phase.step}{phase.total > 0 && <> — {phase.done} of {phase.total}</>}
                  </span>
                )}
              </div>
            )}
          </Step>
        </div>
      )}
    </Card>
  )
}

function Step({ n, title, subtitle, children }: { n: number; title: string; subtitle: string; children: ReactNode }) {
  return (
    <section>
      <div className="flex items-start gap-2.5 mb-3">
        <span className="shrink-0 w-6 h-6 rounded-full bg-brand-50 text-brand-700 text-xs font-semibold grid place-items-center">{n}</span>
        <div>
          <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function ColumnsTable({ sheet, mapping, onChange }: { sheet: Sheet; mapping: ColumnTarget[]; onChange: (m: ColumnTarget[]) => void }) {
  const conflicts = new Set(mappingConflicts(mapping))
  const samples = (i: number) => sheet.rows.map((r) => (r.cells[i] ?? '').replace(/\s+/g, ' ').trim()).filter((v) => v && v !== '-').slice(0, 3)
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="text-left font-medium px-3 py-2">Column on the sheet</th>
            <th className="text-left font-medium px-3 py-2">What's in it</th>
            <th className="text-left font-medium px-3 py-2 w-64">Goes to</th>
          </tr>
        </thead>
        <tbody>
          {sheet.headers.map((h, i) => {
            const target = mapping[i]
            const clash = target !== 'notes' && target !== 'ignore' && conflicts.has(target)
            return (
              <tr key={i} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2 font-medium text-slate-700">{h || <span className="text-slate-400 italic">no heading</span>}</td>
                <td className="px-3 py-2 text-slate-500 max-w-md">
                  <span className="line-clamp-2">{samples(i).join(' · ') || <span className="italic text-slate-400">empty</span>}</span>
                </td>
                <td className="px-3 py-1.5">
                  <select
                    className={`${inputClass} !py-1 text-xs ${clash ? '!border-negative-500' : ''}`}
                    value={target}
                    onChange={(e) => onChange(mapping.map((t, j) => (j === i ? (e.target.value as ColumnTarget) : t)))}
                  >
                    {FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    <option value="notes">Notes</option>
                    <option value="ignore">Leave out</option>
                  </select>
                  {clash && <p className="text-[11px] text-negative-700 mt-1">Another column is also going here.</p>}
                  {!clash && target !== 'notes' && target !== 'ignore' && FIELD_BY_KEY[target].hint && (
                    <p className="text-[11px] text-slate-400 mt-1">{FIELD_BY_KEY[target].hint}</p>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ValuesTables({ maps, counts, onChange, users }: {
  maps: ValueMaps
  counts: Record<keyof ValueMaps, Record<string, number>>
  onChange: (m: ValueMaps) => void
  users: { id: string; name: string }[]
}) {
  const set = <K extends keyof ValueMaps>(k: K, key: string, v: ValueMaps[K][string]) => onChange({ ...maps, [k]: { ...maps[k], [key]: v } })
  const sorted = (k: keyof ValueMaps) => Object.keys(maps[k]).sort((a, b) => (counts[k][b] ?? 0) - (counts[k][a] ?? 0))
  const box = 'rounded-lg border border-slate-200 p-3'

  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <ValueList title="Status → Raptor status" className={`${box} lg:col-span-2`} keys={sorted('outcome')} counts={counts.outcome}>
        {(k) => (
          <select className={`${inputClass} !py-1 text-xs`} value={maps.outcome[k]} onChange={(e) => set('outcome', k, e.target.value as OutcomeId)}>
            {OUTCOMES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
      </ValueList>
      <ValueList title="Source → Raptor source" className={box} keys={sorted('source')} counts={counts.source}
        note="Where the sheet says more than Raptor's source does, its wording is kept as the campaign.">
        {(k) => (
          <select className={`${inputClass} !py-1 text-xs`} value={maps.source[k]} onChange={(e) => set('source', k, e.target.value as LeadSource)}>
            {leadSources.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
      </ValueList>
      <ValueList title="Rep → owner" className={box} keys={sorted('owner')} counts={counts.owner}>
        {(k) => (
          <select className={`${inputClass} !py-1 text-xs`} value={maps.owner[k]} onChange={(e) => set('owner', k, e.target.value)}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </ValueList>
      {sorted('commission').length > 0 && (
        <ValueList title="Commission → Raptor commission" className={box} keys={sorted('commission')} counts={counts.commission}
          note="Left as — , the text is kept in the lead's notes instead.">
          {(k) => {
            const v = maps.commission[k]
            return (
              <div className="flex gap-1.5">
                <select className={`${inputClass} !py-1 text-xs`} value={v.choice} onChange={(e) => set('commission', k, { ...v, choice: e.target.value })}>
                  <option value="">—</option>
                  {COMMISSION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {v.choice === CUSTOM && (
                  <input className={`${inputClass} !py-1 text-xs w-20`} value={v.custom} placeholder="%" onChange={(e) => set('commission', k, { ...v, custom: e.target.value })} />
                )}
              </div>
            )
          }}
        </ValueList>
      )}
      {sorted('rejection').length > 0 && (
        <ValueList title="Rejection reason → Raptor reason" className={box} keys={sorted('rejection')} counts={counts.rejection}
          note="The sheet's own words are kept as the rejection note.">
          {(k) => (
            <select className={`${inputClass} !py-1 text-xs`} value={maps.rejection[k]} onChange={(e) => set('rejection', k, e.target.value as RejectionReason)}>
              {REJECTION_REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          )}
        </ValueList>
      )}
    </div>
  )
}

function ValueList({ title, keys, counts, note, className, children }: {
  title: string; keys: string[]; counts: Record<string, number>; note?: string; className: string; children: (key: string) => ReactNode
}) {
  return (
    <div className={className}>
      <p className="text-xs font-medium text-slate-500 mb-2">{title}</p>
      <ul className="space-y-1.5 max-h-80 overflow-y-auto">
        {keys.map((k) => (
          <li key={k} className="grid grid-cols-[1fr_auto_minmax(0,14rem)] gap-2 items-center text-xs">
            <span className="text-slate-700 truncate" title={k}>{k || <span className="italic text-slate-400">blank</span>}</span>
            <span className="text-slate-400 tabular-nums">×{counts[k] ?? 0}</span>
            {children(k)}
          </li>
        ))}
      </ul>
      {note && <p className="text-[11px] text-slate-400 mt-2">{note}</p>}
    </div>
  )
}

function LeadSheetReview({ plan }: { plan: LeadSheetPlan }) {
  const tiles = useMemo(() => {
    const status = (s: string) => plan.leads.filter((p) => p.lead.status === s).length
    const book = plan.leads.reduce((t, p) => t + (p.lead.estimatedValue ?? 0), 0)
    return [
      { label: 'New leads', value: plan.leads.length, note: `${formatCurrency(book)} estimated` },
      { label: 'Signed', value: status('Converted'), note: 'converted, deal won' },
      { label: 'Hot', value: status('Hot Lead'), note: '' },
      { label: 'Interested', value: status('Interested'), note: '' },
      { label: 'No contact yet', value: status('No Contact Yet'), note: '' },
      { label: 'Rejected', value: status('Rejected'), note: '' },
      { label: 'Skipped', value: plan.skipped.length, note: 'already in Raptor' },
    ]
  }, [plan])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg bg-slate-50 px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{t.label}</p>
            <p className="text-lg font-semibold text-slate-800 tabular-nums">{t.value.toLocaleString('en-ZA')}</p>
            {t.note && <p className="text-[11px] text-slate-500">{t.note}</p>}
          </div>
        ))}
      </div>

      {plan.problems.length > 0 && (
        <ul className="space-y-1">
          {plan.problems.map((p) => (
            <li key={p} className="text-xs text-amber-800 flex gap-2"><AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-500" />{p}</li>
          ))}
        </ul>
      )}

      {plan.leads.length > 0 && (
        <div className="max-h-96 overflow-auto border border-slate-200 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 sticky top-0">
              <tr>
                {['#', 'Client', 'Contact', 'Phone', 'Email', 'Owner', 'Status', 'Deal', 'Amount', 'Commission', 'Came in'].map((h) => (
                  <th key={h} className="text-left font-medium px-2 py-1.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plan.leads.map((p) => (
                <tr key={p.lead.id} className="border-t border-slate-100">
                  <td className="px-2 py-1 text-slate-400 tabular-nums">{p.sheetNumber}</td>
                  <td className="px-2 py-1 text-slate-800 font-medium">{p.lead.companyName}</td>
                  <td className="px-2 py-1">{`${p.lead.firstName} ${p.lead.lastName}`.trim() || '—'}</td>
                  <td className="px-2 py-1 tabular-nums whitespace-nowrap">{p.lead.mobile ?? p.lead.phone ?? '—'}</td>
                  <td className="px-2 py-1">{p.lead.email ?? '—'}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{p.ownerName}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{p.lead.status}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{p.deal.stage}</td>
                  <td className="px-2 py-1 tabular-nums whitespace-nowrap">{p.lead.estimatedValue ? formatCurrency(p.lead.estimatedValue) : '—'}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{commissionLabel(p.lead) ?? '—'}</td>
                  <td className="px-2 py-1 tabular-nums whitespace-nowrap">{p.lead.createdAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-slate-400">
        Amounts written as ranges import at their low end; the range itself is kept in the notes.
      </p>

      {plan.skipped.length > 0 && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer font-medium">{plan.skipped.length} skipped</summary>
          <ul className="mt-1.5 space-y-0.5 pl-4">
            {plan.skipped.map((s) => <li key={s.line}>Row {s.line}, {s.name}: {s.reason}</li>)}
          </ul>
        </details>
      )}
      {(plan.remarks.length > 0 || plan.skippedBlank > 0) && (
        <ul className="space-y-1">
          {plan.skippedBlank > 0 && (
            <li className="text-xs text-slate-500 flex gap-2"><Info size={13} className="shrink-0 mt-0.5" />
              {plan.skippedBlank} {plan.skippedBlank === 1 ? 'row has' : 'rows have'} a date but no client, contact, email or number, and {plan.skippedBlank === 1 ? 'is' : 'are'} left out.
            </li>
          )}
          {plan.remarks.map((r) => <li key={r} className="text-xs text-slate-500 flex gap-2"><Info size={13} className="shrink-0 mt-0.5" />{r}</li>)}
        </ul>
      )}
    </div>
  )
}
