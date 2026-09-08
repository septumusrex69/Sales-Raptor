import { useCallback, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, Database, FileUp, Info, Loader2, Upload } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { inputClass } from '../ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { useAppStore } from '../../store/AppStore'
import { supabase } from '../../lib/supabase'
import { parseCsv, type CsvRow } from '../../lib/csv'
import { readSingleCsvFromZip } from '../../lib/zip'
import { readXlsx } from '../../lib/xlsx'
import {
  buildImportPlan, planRows, IMPORT_TABLES, WIPE_TABLES, type ImportPlan,
} from '../../lib/swordfishImport'
import {
  applyEnrichment, fetchAccountRefs, planEnrichment, type EnrichPlan,
} from '../../lib/accountEnrich'
import { formatCurrency } from '../../data/mockData'

/**
 * Which database this app is actually pointed at.
 *
 * Shown because the person about to press a button labelled "delete everything" deserves to know
 * which database they are deleting everything from, and because a deployment's environment
 * variables are not something you can check from inside the deployment without being told.
 */
/**
 * Whatever they actually have, read as rows.
 *
 * A CSV, a zipped CSV, or a spreadsheet. Swordfish's action report is forty-six megabytes, so it
 * arrives zipped roughly every time, and the client register is a spreadsheet somebody maintains
 * by hand. Insisting on plain CSV meant a conversion step before every import — one more thing to
 * forget, and one that lets Excel's regional date formatting change what a sign date means.
 */
/**
 * Database errors, said in words.
 *
 * "new row violates row-level security policy" is precise and tells the person reading it
 * nothing about what to do. The two that have actually happened during this migration get an
 * explanation; everything else is passed through unchanged rather than guessed at.
 */
function explain(table: string, row: number, message: string): string {
  const where = `${table.replace(/_/g, ' ')}, row ${row}`
  if (/row-level security/i.test(message)) {
    return `${where}: your account is not allowed to write to this table. That is a permission `
      + `gap in the database rather than anything wrong with the files — send this message on `
      + `and it can be fixed in a minute. Nothing after this point was written.`
  }
  if (/duplicate key value/i.test(message)) {
    return `${where}: two rows are claiming to be the same record (${message}). Either the import `
      + `has already been run without clearing first, or the exports contain a genuine duplicate.`
  }
  return `${where}: ${message}`
}

async function readTable(file: File): Promise<CsvRow[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.zip')) return parseCsv(await readSingleCsvFromZip(await file.arrayBuffer()))
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return readXlsx(await file.arrayBuffer())
  if (name.endsWith('.xls')) {
    // The pre-2007 binary format is a different thing entirely and not worth carrying.
    throw new Error(`${file.name} is in the old Excel format. Open it and save it as .xlsx or .csv.`)
  }
  return parseCsv(await file.text())
}

const DATABASE_HOST = (() => {
  try { return new URL(import.meta.env.VITE_SUPABASE_URL as string).hostname } catch { return 'unknown' }
})()

/**
 * Bringing the book across from Swordfish.
 *
 * This exists as a screen rather than only as a script for a plain reason: the script needs a
 * service-role key, and handing that around is worse than the problem it solves. Signed in here,
 * the person doing the migration already has exactly the permission the import needs and no more.
 *
 * The shape is deliberate. Reading the four exports and *showing what would happen* is free and
 * repeatable; writing is a separate, deliberate act behind a typed confirmation. Nobody should be
 * able to destroy the book by clicking the wrong thing once.
 */

/** The four exports, in the order the migration needs them. Named as Swordfish names them. */
/*
 * In the order the import thinks about them: the clients first, then their accounts, then what
 * happened on those accounts. The register is read first for the same reason it is listed first —
 * it decides who every account belongs to, so everything after it depends on it.
 *
 * It is not strictly required, because there is a fallback, but the fallback is a set of
 * judgements made by reading client names. Where the register exists it is the business's own
 * record and it wins.
 */
const SOURCES = [
  {
    key: 'clients',
    label: 'Client register',
    hint: 'Who the clients are: registration numbers, commission tiers, banking and contacts.',
    required: false,
  },
  {
    key: 'debtors',
    label: 'Debtors Per Client',
    hint: 'The debtor themselves: phone numbers, email addresses, the main comment, promises to pay.',
    required: false,
  },
  { key: 'accounts', label: 'Client Account Summary', hint: 'One row per debtor account. The spine of the import.', required: true },
  { key: 'payments', label: 'All Payments per Client', hint: 'Every payment received, including client-direct.', required: true },
  { key: 'actions', label: 'Actions performed per Client', hint: 'Every action and what it cost. The largest file by far.', required: true },
  { key: 'interest', label: 'Interest per Period', hint: 'Interest as accrued, one row per period.', required: true },
] as const

type SourceKey = (typeof SOURCES)[number]['key']
type Files = Partial<Record<SourceKey, File>>
type Phase = { step: string; done: number; total: number } | null

export function DataImportTab() {
  const { currentUser } = useAuth()
  const { users } = useAppStore()
  const [files, setFiles] = useState<Files>({})
  const [ownerId, setOwnerId] = useState(currentUser?.id ?? '')
  const [only, setOnly] = useState('')
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [reading, setReading] = useState(false)
  const [phase, setPhase] = useState<Phase>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [wipe, setWipe] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const abort = useRef(false)

  const isAdmin = currentUser?.role === 'Administrator'
  // The register is optional: without it the clients come from the configuration in the repo,
  // which is how this worked before the register existed.
  const ready = SOURCES.filter((s) => s.required).every((s) => files[s.key])

  const readPlan = useCallback(async () => {
    setError(null); setDone(null); setPlan(null); setReading(true)
    try {
      const parsed: Record<string, CsvRow[]> = {}
      for (const s of SOURCES) {
        const file = files[s.key]
        if (!file) continue
        setPhase({ step: `Reading ${s.label}`, done: 0, total: 0 })
        // Yield to the browser between files: the actions export is tens of megabytes, and
        // parsing it without letting the page breathe looks exactly like a crash.
        await new Promise((r) => setTimeout(r, 0))
        parsed[s.key] = await readTable(file)
      }
      setPhase({ step: 'Working out what would change', done: 0, total: 0 })
      await new Promise((r) => setTimeout(r, 0))
      setPlan(buildImportPlan(
        {
          accounts: parsed.accounts,
          payments: parsed.payments,
          actions: parsed.actions,
          interest: parsed.interest,
          clients: parsed.clients,
          debtors: parsed.debtors,
        },
        { ownerId, only: only.trim() || undefined },
      ))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setReading(false); setPhase(null)
    }
  }, [files, ownerId, only])

  const runImport = useCallback(async () => {
    if (!plan) return
    setError(null); setDone(null); abort.current = false
    const rows = planRows(plan)
    const totalRows = IMPORT_TABLES.reduce((t, k) => t + rows[k].length, 0)
    try {
      /*
       * Before deleting anything, prove the destination can actually receive the import. A
       * database without the collections tables is one the migration never reached — half-wiping
       * it and then failing on the first insert leaves a mess that looks like data loss, because
       * it is. The read is cheap and the alternative is unrecoverable by the person clicking.
       */
      setPhase({ step: 'Checking the database is ready', done: 0, total: 0 })
      for (const table of IMPORT_TABLES) {
        const { error: e } = await supabase.from(table).select('id').limit(1)
        if (e) {
          throw new Error(
            `This database is missing "${table}" (${e.message}). It has not had the collections `
            + `migration applied, so nothing has been changed. Check you are pointed at the right `
            + `database — this app is connected to ${DATABASE_HOST}.`,
          )
        }
      }

      if (wipe) {
        for (const [i, table] of WIPE_TABLES.entries()) {
          setPhase({ step: `Clearing ${table.replace(/_/g, ' ')}`, done: i, total: WIPE_TABLES.length })
          // PostgREST requires a filter before it will delete in bulk; this one matches every row.
          const { error: e } = await supabase.from(table).delete().not('id', 'is', null)
          if (e) throw new Error(`Clearing ${table}: ${e.message}`)
        }
      }
      let written = 0
      for (const table of IMPORT_TABLES) {
        const all = rows[table]
        for (let i = 0; i < all.length; i += 500) {
          if (abort.current) throw new Error('Stopped. The import is partial — run it again with "delete everything" ticked.')
          const chunk = all.slice(i, i + 500)
          const { error: e } = await supabase.from(table).insert(chunk)
          if (e) throw new Error(explain(table, i, e.message))
          written += chunk.length
          setPhase({ step: `Writing ${table.replace(/_/g, ' ')}`, done: written, total: totalRows })
        }
      }
      setDone(`Imported ${totalRows.toLocaleString('en-ZA')} rows.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPhase(null)
    }
  }, [plan, wipe])

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader title="Data Import" />
        <p className="text-sm text-slate-500">
          Only an Administrator can import the book. Ask one to run this.
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <DebtorDetailsCard />

      <Card>
        <CardHeader
          title="Import from Swordfish"
          subtitle="Reading the exports shows what would change and writes nothing. Importing is a separate step."
        />

        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-slate-50 text-sm">
          <Database size={15} className="text-slate-400 shrink-0" />
          <span className="text-slate-600">
            Connected to <span className="font-mono font-medium text-slate-800">{DATABASE_HOST}</span>
          </span>
        </div>

        <div className="space-y-3">
          {SOURCES.map((s) => (
            <FilePicker
              key={s.key}
              label={s.label}
              badge={s.required ? undefined : 'Recommended'}
              hint={s.hint}
              file={files[s.key]}
              onPick={(f) => { setFiles((prev) => ({ ...prev, [s.key]: f })); setPlan(null) }}
            />
          ))}
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mt-5">
          <label className="block">
            <span className="block text-xs font-medium text-slate-500 mb-1">Clients land on</span>
            <select className={inputClass} value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setPlan(null) }}>
              {users.filter((u) => u.status === 'Active').map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <span className="block text-[11px] text-slate-400 mt-1">
              Every imported client is assigned to this person. Reassign individually afterwards.
            </span>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-500 mb-1">Only these clients (optional)</span>
            <input
              className={inputClass}
              value={only}
              placeholder="e.g. Agri Saad"
              onChange={(e) => { setOnly(e.target.value); setPlan(null) }}
            />
            <span className="block text-[11px] text-slate-400 mt-1">
              A trial run on real data. Leave empty to import the whole book.
            </span>
          </label>
        </div>

        <button
          className="btn-primary mt-5 inline-flex items-center gap-2"
          disabled={!ready || reading || !!phase}
          onClick={readPlan}
        >
          {reading ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
          {reading ? 'Reading…' : 'Read the exports'}
        </button>
        {!ready && (
          <p className="text-xs text-slate-400 mt-2">
            The four account exports are needed — balances cannot be checked without them. Without the
            client register the clients are worked out from their names instead, which is a guess where
            the register is a record. Without Debtors Per Client there are no phone numbers, no email
            addresses and no main comments: the book imports, but nobody can be phoned.
          </p>
        )}
      </Card>

      {phase && (
        <Card>
          <div className="flex items-center gap-3">
            <Loader2 size={16} className="animate-spin text-brand-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-700">{phase.step}</p>
              {phase.total > 0 && (
                <>
                  <div className="h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
                    <div className="h-full bg-brand-500 rounded-full transition-[width]" style={{ width: `${(100 * phase.done) / phase.total}%` }} />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 tabular-nums">
                    {phase.done.toLocaleString('en-ZA')} of {phase.total.toLocaleString('en-ZA')}
                  </p>
                </>
              )}
            </div>
          </div>
        </Card>
      )}

      {error && (
        <Card className="border-rose-200 bg-rose-50/50">
          <div className="flex gap-3">
            <AlertTriangle size={16} className="text-rose-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-rose-800">The import stopped</p>
              <p className="text-sm text-rose-700 mt-1">{error}</p>
            </div>
          </div>
        </Card>
      )}

      {done && (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <div className="flex gap-3">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-emerald-800">{done}</p>
              {/* The app is holding the book it loaded before the import — after a wipe that is
                  every record it knows about. Reloading is the honest way to show the new one. */}
              <button className="text-sm font-medium text-emerald-700 underline mt-1" onClick={() => window.location.reload()}>
                Reload to see it
              </button>
            </div>
          </div>
        </Card>
      )}

      {plan && <PlanReview plan={plan} />}

      {plan && !done && (
        <Card>
          <CardHeader title="Write it" subtitle="Nothing above has touched the database yet." />
          <label className="flex items-start gap-2.5 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={wipe} onChange={(e) => { setWipe(e.target.checked); setConfirmText('') }} />
            <span>
              Delete everything first — every client, lead, deal, contact, task, activity and account.
              <span className="block text-[11px] text-slate-400 mt-0.5">
                People, teams and targets are kept. Without this, the import adds to whatever is already there.
              </span>
              <span className="block text-[11px] text-slate-500 mt-1">
                On <span className="font-mono font-medium">{DATABASE_HOST}</span>.
              </span>
            </span>
          </label>

          {wipe && (
            <div className="mt-3 pl-6">
              <p className="text-xs text-slate-500 mb-1.5">
                Type <span className="font-mono font-semibold text-slate-700">delete everything</span> to confirm.
              </p>
              <input className={`${inputClass} max-w-xs`} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            </div>
          )}

          <button
            className="btn-primary mt-5 inline-flex items-center gap-2"
            disabled={!!phase || (wipe && confirmText.trim().toLowerCase() !== 'delete everything')}
            onClick={runImport}
          >
            <Upload size={15} />
            Import {plan.debtorAccounts.length.toLocaleString('en-ZA')} accounts
          </button>
        </Card>
      )}
    </div>
  )
}

/**
 * Updating debtor details on their own.
 *
 * Separate from the import above, and deliberately so: that one clears the ledgers and rebuilds
 * them, which needs every export and destroys what is there. This one adds phone numbers, email
 * addresses, comments and promises to accounts already in the book. It deletes nothing except
 * what a previous run of itself wrote, so it can be run whenever a fresh export arrives.
 */
function DebtorDetailsCard() {
  const [file, setFile] = useState<File | undefined>()
  const [plan, setPlan] = useState<EnrichPlan | null>(null)
  const [phase, setPhase] = useState<Phase>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const read = useCallback(async () => {
    if (!file) return
    setError(null); setDone(null); setPlan(null); setReading(true)
    try {
      setPhase({ step: 'Reading the export', done: 0, total: 0 })
      const rows = await readTable(file)
      setPhase({ step: 'Matching against the book', done: 0, total: 0 })
      const accounts = await fetchAccountRefs()
      if (accounts.length === 0) {
        throw new Error(
          'There are no accounts in this database yet, so there is nothing to add details to. '
          + 'Run the full import first.',
        )
      }
      setPlan(planEnrichment(rows, accounts))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setReading(false); setPhase(null)
    }
  }, [file])

  const apply = useCallback(async () => {
    if (!plan) return
    setError(null); setDone(null)
    try {
      const r = await applyEnrichment(plan, setPhase)
      setDone(
        `Updated ${r.accounts.toLocaleString('en-ZA')} accounts: `
        + `${r.contacts.toLocaleString('en-ZA')} contact details, `
        + `${r.promises.toLocaleString('en-ZA')} promises, `
        + `${r.notes.toLocaleString('en-ZA')} comments.`,
      )
      setPlan(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPhase(null)
    }
  }, [plan])

  return (
    <Card>
      <CardHeader
        title="Update debtor details"
        subtitle="Debtors Per Client on its own, applied to accounts already in the book. Nothing is cleared."
      />

      <FilePicker
        label="Debtors Per Client"
        hint="Phone numbers, email addresses, the main comment, promises to pay."
        file={file}
        onPick={(f) => { setFile(f); setPlan(null); setDone(null); setError(null) }}
      />

      <div className="flex flex-wrap items-center gap-3 mt-4">
        <button
          onClick={read}
          disabled={!file || reading || !!phase}
          className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-brand-600 text-white disabled:opacity-40"
        >
          {reading ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
          {reading ? 'Reading…' : 'Read the file'}
        </button>
        {plan && (
          <button
            onClick={apply}
            disabled={!!phase || plan.matched === 0}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-gold-400 text-navy-950 border border-gold-500 disabled:opacity-40"
          >
            <Check size={15} />
            Apply to {plan.matched.toLocaleString('en-ZA')} accounts
          </button>
        )}
      </div>

      {phase && (
        <p className="text-sm text-slate-500 mt-3">
          {phase.step}
          {phase.total > 0 && <> — {phase.done.toLocaleString('en-ZA')} of {phase.total.toLocaleString('en-ZA')}</>}
        </p>
      )}
      {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}
      {done && <p className="text-sm text-positive-700 mt-3">{done}</p>}

      {plan && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Accounts matched', value: plan.matched, note: plan.untouched ? `${plan.untouched} left alone` : 'the whole book' },
              { label: 'Contact details', value: plan.contacts.length, note: `${plan.stats.mobiles} mobile · ${plan.stats.emails} email` },
              { label: 'Promises to pay', value: plan.promises.length, note: 'open or broken' },
              { label: 'Comments', value: plan.notes.length, note: 'last and sub-status' },
            ].map((c) => (
              <div key={c.label} className="rounded-lg bg-slate-50 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">{c.label}</p>
                <p className="text-lg font-semibold text-slate-800 tabular-nums">{c.value.toLocaleString('en-ZA')}</p>
                <p className="text-[11px] text-slate-500">{c.note}</p>
              </div>
            ))}
          </div>

          {/* Said before the button is pressed, not discovered after. */}
          <p className="text-xs text-slate-500">
            Running this replaces the contact details, promises and comments a previous run of this
            same file wrote. Anything typed in by hand on an account is left exactly as it is.
          </p>

          {plan.problems.map((p) => (
            <p key={p} className="text-xs text-negative-700 flex gap-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {p}
            </p>
          ))}
          {plan.remarks.map((n) => <p key={n} className="text-xs text-slate-400">{n}</p>)}
        </div>
      )}
    </Card>
  )
}

function FilePicker({ label, hint, badge, file, onPick }: {
  label: string; hint: string; badge?: string; file?: File; onPick: (f: File) => void
}) {
  return (
    <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-brand-300 cursor-pointer">
      <input
        type="file"
        accept=".csv,.zip,.xlsx,.xlsm,text/csv,application/zip"
        className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f) }}
      />
      <span className={`shrink-0 w-8 h-8 rounded-lg grid place-items-center ${file ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
        {file ? <CheckCircle2 size={16} /> : <FileUp size={16} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-700">
          {label}
          {badge && (
            <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-brand-600 bg-brand-50 rounded-full px-1.5 py-0.5">
              {badge}
            </span>
          )}
        </span>
        <span className="block text-xs text-slate-400 truncate">
          {file ? `${file.name} · ${(file.size / 1e6).toFixed(1)} MB` : hint}
        </span>
      </span>
      <span className="text-xs font-medium text-brand-600 shrink-0">{file ? 'Change' : 'Choose'}</span>
    </label>
  )
}

function PlanReview({ plan }: { plan: ImportPlan }) {
  const { stats } = plan
  const counts = useMemo(() => ([
    { label: 'Clients', value: plan.companies.length.toLocaleString('en-ZA'), note: `${plan.companies.filter((c) => c.parent_company_id).length} as children` },
    { label: 'Handover batches', value: plan.handovers.length.toLocaleString('en-ZA') },
    { label: 'Debtor accounts', value: plan.debtorAccounts.length.toLocaleString('en-ZA'), note: `${formatCurrency(stats.capital)} capital` },
    { label: 'Payments', value: plan.payments.length.toLocaleString('en-ZA'), note: `${formatCurrency(stats.paid)}${stats.paidToClient ? ` · ${stats.paidToClient} paid to client` : ''}` },
    { label: 'Fees', value: plan.fees.length.toLocaleString('en-ZA'), note: `${formatCurrency(stats.feesInclVat)} incl VAT` },
    { label: 'Interest accruals', value: plan.accruals.length.toLocaleString('en-ZA'), note: formatCurrency(stats.interest) },
    {
      label: 'Contact details',
      value: plan.contacts.length.toLocaleString('en-ZA'),
      note: `${plan.contacts.filter((c) => c.kind === 'mobile').length} mobile · ${plan.contacts.filter((c) => c.kind === 'email').length} email`,
    },
    { label: 'Promises to pay', value: plan.promises.length.toLocaleString('en-ZA'), note: 'open or broken in Swordfish' },
    { label: 'Comments', value: plan.accountNotes.length.toLocaleString('en-ZA'), note: 'last and sub-status comments' },
  ]), [plan, stats])

  return (
    <>
      <Card>
        <CardHeader title="What would be written" subtitle="Read from the exports. Nothing has been written." />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {counts.map((c) => (
            <div key={c.label} className="rounded-lg bg-slate-50 px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">{c.label}</p>
              <p className="text-lg font-semibold text-slate-800 tabular-nums">{c.value}</p>
              {c.note && <p className="text-[11px] text-slate-500 mt-0.5">{c.note}</p>}
            </div>
          ))}
        </div>
      </Card>

      {(stats.commissionDrift > 0 || stats.freeBillableActions > 0 || plan.notes.length > 0) && (
        <Card>
          <CardHeader title="Worth knowing" />
          <ul className="space-y-2.5 text-sm text-slate-600">
            {stats.commissionDrift > 0 && (
              <li className="flex gap-2.5">
                <Info size={15} className="text-amber-500 shrink-0 mt-0.5" />
                <span>
                  <strong className="text-slate-800">{stats.commissionDrift} accounts</strong> are billed at a rate their
                  client's signed mandate does not allow. They import at the rate they were actually billed, with the
                  mandate's rate recorded beside it — correcting accounts that have already been invoiced is a business
                  decision, not an import step.
                </span>
              </li>
            )}
            {stats.freeBillableActions > 0 && (
              <li className="flex gap-2.5">
                <Info size={15} className="text-slate-400 shrink-0 mt-0.5" />
                <span>
                  <strong className="text-slate-800">{stats.freeBillableActions.toLocaleString('en-ZA')} billable actions</strong> carry
                  no charge because the account had reached its Annexure B ceiling — items 1 to 7 may not exceed the
                  capital or R1,225, whichever is less. That is the cap working, not revenue that went missing.
                </span>
              </li>
            )}
            {plan.notes.map((n, i) => (
              <li key={i} className="flex gap-2.5">
                <Info size={15} className="text-slate-400 shrink-0 mt-0.5" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {plan.problems.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader
            title={`${plan.problems.length} ${plan.problems.length === 1 ? 'problem' : 'problems'}`}
            subtitle="The import will still run. Each of these needs somebody to look at it afterwards."
          />
          <ul className="space-y-1.5 text-sm text-slate-600 max-h-64 overflow-y-auto">
            {plan.problems.slice(0, 100).map((p, i) => (
              <li key={i} className="flex gap-2.5">
                <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-1" />
                <span>{p}</span>
              </li>
            ))}
            {plan.problems.length > 100 && (
              <li className="text-xs text-slate-400 pl-6">…and {plan.problems.length - 100} more.</li>
            )}
          </ul>
        </Card>
      )}
    </>
  )
}
