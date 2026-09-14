import { useCallback, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Upload } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { inputClass } from '../ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { useAppStore } from '../../store/AppStore'
import { supabase } from '../../lib/supabase'
import { parseCsv } from '../../lib/csv'
import { readXlsxSheets } from '../../lib/xlsx'
import {
  planLeadsImport, leadInsertRows, marketerCredits,
  type LeadsImportPlan, type LeadsSheet, type MarketerCredit,
} from '../../lib/leadsImport'
import { formatCurrency } from '../../data/mockData'

/**
 * Bringing the sales team's leads workbook into Raptor.
 *
 * Same shape as the Swordfish import beside it and for the same reason: reading the file and
 * showing what would happen is free and repeatable, and writing is a separate, deliberate press.
 *
 * The difference is that this one is meant to be run again. The workbook is a living document —
 * a tab per sales month, added to as the month closes — so every lead carries the workbook's own
 * identity for it and a second run updates what it already brought across rather than importing
 * the book twice. That is why there is no "delete everything first" here: there is nothing to
 * clear, because running it again is the normal case rather than the emergency one.
 */
export function LeadsImportCard() {
  const { currentUser } = useAuth()
  const { users } = useAppStore()
  const [file, setFile] = useState<File | undefined>()
  const [ownerId, setOwnerId] = useState(currentUser?.id ?? '')
  const [plan, setPlan] = useState<LeadsImportPlan | null>(null)
  /** Marketer name from the spreadsheet to the Raptor user their leads land on. */
  const [byMarketer, setByMarketer] = useState<Record<string, string>>({})
  const [reading, setReading] = useState(false)
  const [writing, setWriting] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const clear = () => { setPlan(null); setDone(null); setError(null); setByMarketer({}) }

  const read = useCallback(async () => {
    if (!file) return
    setError(null); setDone(null); setPlan(null); setReading(true)
    try {
      const name = file.name.toLowerCase()
      let sheets: LeadsSheet[]
      if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
        // Every tab, not the first: the tab called "Complete Leads List" is missing several
        // hundred leads that exist only on the monthly ones.
        sheets = await readXlsxSheets(await file.arrayBuffer())
      } else if (name.endsWith('.xls')) {
        throw new Error(`${file.name} is in the old Excel format. Open it and save it as .xlsx.`)
      } else {
        // A CSV is one tab by definition, which is fine — it just cannot be the whole book.
        const rows = parseCsv(await file.text())
        const header = Object.keys(rows[0] ?? {})
        sheets = [{ name: file.name, rows: [header, ...rows.map((r) => header.map((h) => r[h] ?? ''))] }]
      }
      // The page has just parsed a few megabytes of XML; let it paint before the mapping starts.
      await new Promise((r) => setTimeout(r, 0))
      const built = planLeadsImport(sheets)
      if (built.rows.length === 0) {
        throw new Error(
          'No leads were found in that file. Every tab needs a header row with a "Client Name" '
          + 'column — that is the one this reads to know it is looking at a leads list.',
        )
      }
      setPlan(built)
      /*
       * Offer a match where the name is plainly the same person, and leave the rest on the
       * fallback. Matching on the first word of the Raptor name is what makes "Barend" find
       * "Barend Ferreira" — the spreadsheet only ever wrote first names.
       */
      const guess: Record<string, string> = {}
      for (const credit of marketerCredits(built)) {
        const key = credit.name.toLowerCase()
        const match = users.find((u) => u.name.toLowerCase() === key
          || u.name.toLowerCase().split(' ')[0] === key)
        if (match) guess[credit.name] = match.id
      }
      setByMarketer(guess)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setReading(false)
    }
  }, [file, users])

  const write = useCallback(async () => {
    if (!plan || !ownerId) return
    setError(null); setDone(null)
    const rows = leadInsertRows(plan, { fallback: ownerId, byMarketer })
    setWriting({ done: 0, total: rows.length })
    try {
      let written = 0
      for (let i = 0; i < rows.length; i += 250) {
        const chunk = rows.slice(i, i + 250)
        /*
         * Upsert, not insert. Run the same workbook twice and the second run updates the leads
         * the first one brought across — which is the whole reason legacy_key exists. Leads
         * somebody typed into Raptor by hand have no legacy key and are never touched by this.
         */
        const { error: e } = await supabase.from('leads')
          .upsert(chunk, { onConflict: 'legacy_key' })
        if (e) throw new Error(explain(e.message, i))
        written += chunk.length
        setWriting({ done: written, total: rows.length })
      }
      setDone(`${written.toLocaleString('en-ZA')} leads are in.`)
      setPlan(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWriting(null)
    }
  }, [plan, ownerId, byMarketer])

  return (
    <Card>
      <CardHeader
        title="Import the leads workbook"
        subtitle="Reading it shows what would happen and writes nothing. Safe to run again on next month's file."
      />

      <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-brand-300 cursor-pointer">
        <input
          type="file"
          accept=".xlsx,.xlsm,.csv,text/csv"
          className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); clear() } }}
        />
        <span className={`shrink-0 w-8 h-8 rounded-lg grid place-items-center ${
          file ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}
        >
          {file ? <CheckCircle2 size={16} /> : <FileUp size={16} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-slate-700">Leads List</span>
          <span className="block text-xs text-slate-400 truncate">
            {file
              ? `${file.name} · ${(file.size / 1e6).toFixed(1)} MB`
              : 'The sales workbook — every tab is read, not just the first.'}
          </span>
        </span>
        <span className="text-xs font-medium text-brand-600 shrink-0">{file ? 'Change' : 'Choose'}</span>
      </label>

      <label className="block mt-4 max-w-sm">
        <span className="block text-xs font-medium text-slate-500 mb-1">
          Anyone not named below lands on
        </span>
        <select className={inputClass} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          {users.filter((u) => u.status === 'Active').map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <span className="block text-[11px] text-slate-400 mt-1">
          For leads whose Marketer cell is blank, or names somebody with nobody to map them to.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3 mt-4">
        <button
          onClick={read}
          disabled={!file || reading || !!writing}
          className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-brand-600 text-white disabled:opacity-40"
        >
          {reading ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
          {reading ? 'Reading…' : 'Read the workbook'}
        </button>
        {plan && (
          <button
            onClick={write}
            disabled={!!writing || !ownerId}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-40"
          >
            {writing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            Import {plan.counts.total.toLocaleString('en-ZA')} leads
          </button>
        )}
      </div>

      {writing && (
        <p className="text-sm text-slate-500 mt-3 tabular-nums">
          Writing — {writing.done.toLocaleString('en-ZA')} of {writing.total.toLocaleString('en-ZA')}
        </p>
      )}
      {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}
      {done && (
        <p className="text-sm text-positive-700 mt-3">
          {done}{' '}
          <button className="font-medium underline" onClick={() => window.location.reload()}>
            Reload to see them
          </button>
        </p>
      )}

      {plan && (
        <>
          <Marketers plan={plan} chosen={byMarketer} onChange={setByMarketer} fallback={ownerId} />
          <PlanReport plan={plan} />
        </>
      )}
    </Card>
  )
}


/**
 * Who worked these leads.
 *
 * The spreadsheet names the person in a column and Raptor needs a user, and the two do not line
 * up: some of the eight people named have left, and the ones who are here are written as first
 * names in forty-two different spellings. Landing three years of somebody else's work on
 * whoever happens to run the import loses the one thing the column was keeping.
 *
 * So the question is asked here rather than guessed at, and asked every time — next month's
 * workbook will name somebody new, and a screen that silently defaulted would never say so.
 * Names that plainly match a user are matched; the rest wait.
 */
function Marketers({ plan, chosen, onChange, fallback }: {
  plan: LeadsImportPlan
  chosen: Record<string, string>
  onChange: (next: Record<string, string>) => void
  fallback: string
}) {
  const { users } = useAppStore()
  const credits = useMemo(() => marketerCredits(plan), [plan])
  const unmapped = credits.filter((c) => !chosen[c.name])
  if (credits.length === 0) return null

  return (
    <div className="mt-5 pt-4 border-t border-slate-100">
      <p className="text-sm font-medium text-slate-700">Who worked these leads</p>
      <p className="text-xs text-slate-500 mt-0.5">
        {credits.length} named in the spreadsheet.
        {unmapped.length > 0 && (
          <>
            {' '}
            <span className="text-slate-600">
              {unmapped.length} with nobody to map to
            </span>
            {' '}— those land on the person above. Somebody who has left the firm can be added
            under Users as a record with no sign-in.
          </>
        )}
      </p>

      <div className="mt-3 space-y-1.5">
        {credits.map((c) => (
          <MarketerRow
            key={c.name}
            credit={c}
            users={users}
            value={chosen[c.name] ?? ''}
            fallback={fallback}
            onPick={(id) => {
              const next = { ...chosen }
              if (id) next[c.name] = id
              else delete next[c.name]
              onChange(next)
            }}
          />
        ))}
      </div>
    </div>
  )
}

function MarketerRow({ credit, users, value, fallback, onPick }: {
  credit: MarketerCredit
  users: ReturnType<typeof useAppStore>['users']
  value: string
  fallback: string
  onPick: (id: string) => void
}) {
  const fallbackName = users.find((u) => u.id === fallback)?.name ?? 'the person above'
  /*
   * Every other spelling of the same name, shown only where there is one. "Barend/felicia" and
   * "BarendRuben" are the shapes that want a person's eye on them, and they are invisible in a
   * count.
   */
  const others = credit.spellings.filter((sp) => sp !== credit.name)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
      <span className="min-w-0 flex-1">
        <span className="text-sm text-slate-700">{credit.name}</span>
        <span className="text-[11px] text-slate-400 ml-2 tabular-nums">
          {credit.leads.toLocaleString('en-ZA')} lead{credit.leads === 1 ? '' : 's'}
          {credit.shared > 0 && ` · ${credit.shared} shared`}
        </span>
        {others.length > 0 && (
          <span className="block text-[11px] text-slate-400 truncate" title={others.join(', ')}>
            also written {others.join(', ')}
          </span>
        )}
      </span>
      <select
        className="text-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 max-w-[14rem]"
        value={value}
        onChange={(e) => onPick(e.target.value)}
      >
        <option value="">— {fallbackName} —</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}{u.status === 'Inactive' ? ' (left)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Database errors, said in words. Only the two that actually happen here. */
function explain(message: string, from: number): string {
  if (/row-level security/i.test(message)) {
    return `Your account is not allowed to write leads. That is a permission gap in the database `
      + `rather than anything wrong with the file. Nothing after lead ${from} was written.`
  }
  if (/no unique or exclusion constraint/i.test(message)) {
    return `This database has not had the leads import migration applied, so there is nothing for `
      + `a re-run to match against. Nothing was written. (${message})`
  }
  return `Lead ${from}: ${message}`
}

function PlanReport({ plan }: { plan: LeadsImportPlan }) {
  const { counts } = plan
  const book = plan.rows.reduce((t, r) => t + (r.estimatedHandoverAmount ?? 0), 0)
  const read = plan.sheets.filter((s) => !s.skipped)

  return (
    <div className="mt-5 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Leads', value: counts.total.toLocaleString('en-ZA'), note: `${read.length} tabs read` },
          {
            label: 'Book value',
            value: formatCurrency(book),
            note: `${counts.withAmount.toLocaleString('en-ZA')} with an amount`,
          },
          {
            label: 'Contactable',
            value: counts.withMobile.toLocaleString('en-ZA'),
            note: `${counts.withEmail.toLocaleString('en-ZA')} with an email`,
          },
          {
            label: 'Seen twice',
            value: counts.duplicates.toLocaleString('en-ZA'),
            note: 'same lead on two tabs',
          },
        ].map((c) => (
          <div key={c.label} className="rounded-lg bg-slate-50 px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{c.label}</p>
            <p className="text-lg font-semibold text-slate-800 tabular-nums">{c.value}</p>
            <p className="text-[11px] text-slate-500">{c.note}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {Object.entries(plan.byStatus)
          .sort(([, a], [, b]) => b - a)
          .map(([status, n]) => (
            <span key={status}>
              <span className="font-medium tabular-nums text-slate-800">{n.toLocaleString('en-ZA')}</span>
              {' '}{status}
            </span>
          ))}
      </div>

      {plan.warnings.map((w) => (
        <p key={w} className="text-xs text-slate-600 flex gap-2">
          <AlertTriangle size={13} className="shrink-0 mt-0.5 text-gold-500" /> {w}
        </p>
      ))}

      {/*
        Tab by tab, because this is where a workbook that has quietly changed shape shows up. A
        month with forty rows on the spreadsheet and four leads here is not a quiet success.
      */}
      <details className="text-xs">
        <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
          Tab by tab ({plan.sheets.length})
        </summary>
        <div className="mt-2 space-y-1">
          {plan.sheets.map((s) => (
            <div key={s.name} className="flex items-baseline gap-2">
              <span className="text-slate-700 truncate flex-1 min-w-0">{s.name}</span>
              {s.skipped
                ? <span className="text-slate-400 shrink-0">{s.skipped}</span>
                : (
                  <span className="text-slate-500 shrink-0 tabular-nums">
                    {s.read - s.duplicates} new
                    {s.duplicates > 0 && <span className="text-slate-400"> · {s.duplicates} already seen</span>}
                  </span>
                )}
            </div>
          ))}
        </div>
      </details>

      <p className="text-xs text-slate-500">
        Nothing has been written yet. Importing adds these leads and updates any this same
        workbook brought across before — leads typed into Raptor by hand are left alone.
      </p>
    </div>
  )
}
