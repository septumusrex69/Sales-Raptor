import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { inputClass } from '../../components/ui/Modal'
import { useAppStore } from '../../store/AppStore'
import { FULL_CLERK_RATE, FULL_RATE_FROM, shortDay } from '../../lib/clerkCommission.ts'
import { addOverride, fetchOverrides, findAccountByCase, type CommissionOverride } from '../../lib/peopleApi'
import { clockToday } from '../../lib/clock.ts'

const pct = (r: number | null) => (r === null ? 'Back to the rule' : `${Math.round(r * 1e6) / 1e4}%`)

/**
 * THE CLERKS' RATE, AND THE EXCEPTIONS TO IT.
 *
 * THE FIRM: "if a client is on 30 or 25%, they get 3%. If anything less than that, it is
 * proportionately lowered ... there might be an exception ... we should be able to lower or higher the
 * specific commission percentage on a specific client that we pay to the clerks or on a specific
 * account."
 *
 * A DECISION IS NEVER EDITED, ONLY FOLLOWED BY ANOTHER. Each has a day it takes effect from and a
 * reason, and the database writes who and when; the table has no update policy. A payment uses the
 * decision in force on the day it was received, so changing a rate today does not rewrite a month
 * somebody has already been paid for.
 */
export function CommissionRules() {
  const { companies, userById } = useAppStore()
  const [rows, setRows] = useState<CommissionOverride[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setRows(await fetchOverrides()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not read the exceptions.') }
  }, [])
  useEffect(() => { void load() }, [load])

  /* The decision in force today for each client or account: the latest that has taken effect. */
  const current = useMemo(() => {
    const today = clockToday()
    const seen = new Set<string>()
    const out: CommissionOverride[] = []
    for (const r of rows ?? []) {
      if (r.effectiveFrom > today) continue
      const k = r.accountId ? `a:${r.accountId}` : `c:${r.companyId}`
      if (seen.has(k)) continue
      seen.add(k)
      if (r.rate !== null) out.push(r)
    }
    return out
  }, [rows])

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">Commission rules</h1>
        <span className="text-xs text-slate-400">What a clerk earns on what they collect</span>
      </div>

      <Card className="text-sm text-slate-700 space-y-1.5">
        <p>
          A clerk earns a share of every payment collected on an account they held on the day it came in. On a client charged{' '}
          {FULL_RATE_FROM * 100}% or more the share is {FULL_CLERK_RATE * 100}%; below that it is a tenth of the client’s rate —
          20% gives 2%, 15% gives 1.5%.
        </p>
        <p>An exception on an account comes first, then one on the client, then the rule.</p>
        <p>
          A payment made straight to the client (a PTC) earns the same, but it is paid only once that client owes the firm nothing,
          in full, in the month that happens.
        </p>
      </Card>

      <OverrideForm companies={companies.map((c) => ({ id: c.id, name: c.name }))} onSaved={load} />

      {error && <Card className="p-4 text-sm text-negative-700 bg-negative-50 border-negative-100">{error}</Card>}
      {rows === null && !error ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-6"><Loader2 size={16} className="animate-spin" /> Reading the exceptions…</div>
      ) : rows && (
        <>
          <h2 className="text-lg font-semibold tracking-tight text-slate-800 pt-2">In force today</h2>
          {current.length === 0
            ? <Card className="p-4 text-sm text-slate-500">No exceptions. Every payment is on the rule.</Card>
            : <OverrideTable rows={current} nameOf={(id) => userById(id ?? undefined)?.name ?? ''} testid="overrides-current" />}
          {rows.length > 0 && (
            <>
              <h2 className="text-lg font-semibold tracking-tight text-slate-800 pt-2">Every decision</h2>
              <OverrideTable rows={rows} nameOf={(id) => userById(id ?? undefined)?.name ?? ''} testid="overrides-all" />
            </>
          )}
        </>
      )}
    </div>
  )
}

function OverrideTable({ rows, nameOf, testid }: { rows: CommissionOverride[]; nameOf: (id: string | null) => string; testid: string }) {
  return (
    <Card className="overflow-hidden" padded={false}>
      <div className="overflow-x-auto">
        <table className="w-full list-table" data-testid={testid}>
          <thead>
            <tr className="bg-slate-50 text-slate-400">
              <th className="text-left font-medium px-4 py-2">On</th>
              <th className="text-right font-medium px-4 py-2">Clerk’s rate</th>
              <th className="text-left font-medium px-4 py-2">From</th>
              <th className="text-left font-medium px-4 py-2">Why</th>
              <th className="text-left font-medium px-4 py-2">Decided by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 text-sm align-top">
                <td className="px-4 py-1.5 whitespace-nowrap">{r.accountId ? `Account ${r.caseNumber ?? ''}` : (r.client ?? 'Client')}</td>
                <td className="px-4 py-1.5 text-right tabular-nums whitespace-nowrap">{pct(r.rate)}</td>
                <td className="px-4 py-1.5 whitespace-nowrap">{shortDay(r.effectiveFrom)}</td>
                <td className="px-4 py-1.5 text-slate-600">{r.reason}</td>
                <td className="px-4 py-1.5 text-slate-500 whitespace-nowrap">{nameOf(r.setBy)} · {shortDay(r.setAt.slice(0, 10))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function OverrideForm({ companies, onSaved }: { companies: { id: string; name: string }[]; onSaved: () => Promise<void> }) {
  const [on, setOn] = useState<'client' | 'account'>('client')
  const [companyId, setCompanyId] = useState('')
  const [caseNumber, setCaseNumber] = useState('')
  const [rate, setRate] = useState('')
  const [toRule, setToRule] = useState(false)
  const [from, setFrom] = useState(clockToday())
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const rateValue = toRule ? null : Number(rate.replace(',', '.'))
  const rateBad = !toRule && (rate.trim() === '' || !Number.isFinite(rateValue) || (rateValue as number) < 0 || (rateValue as number) > 10)
  const ready = !rateBad && reason.trim().length >= 3 && !!from && (on === 'client' ? !!companyId : caseNumber.trim() !== '')

  async function save() {
    setBusy(true); setMsg(null)
    try {
      let accountId: string | null = null
      if (on === 'account') {
        const a = await findAccountByCase(caseNumber)
        if (!a) { setMsg(`No account with case number ${caseNumber.trim()}.`); return }
        accountId = a.id
      }
      await addOverride({
        companyId: on === 'client' ? companyId : null,
        accountId,
        rate: rateValue === null ? null : Math.round(rateValue * 1e4) / 1e6,
        effectiveFrom: from,
        reason: reason.trim(),
      })
      setReason(''); setRate(''); setCaseNumber(''); setToRule(false)
      setMsg('Saved.')
      await onSaved()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save.')
    } finally { setBusy(false) }
  }

  return (
    <Card>
      <h2 className="text-[15px] font-semibold text-slate-800 mb-3">Set an exception</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
        <label className="space-y-1"><span className="text-slate-500 text-[12px]">On</span>
          <select className={inputClass} value={on} onChange={(e) => setOn(e.target.value as 'client' | 'account')} data-testid="override-on">
            <option value="client">A client</option>
            <option value="account">One account</option>
          </select></label>
        {on === 'client' ? (
          <label className="space-y-1"><span className="text-slate-500 text-[12px]">Client</span>
            <select className={inputClass} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Choose a client…</option>
              {[...companies].sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
        ) : (
          <label className="space-y-1"><span className="text-slate-500 text-[12px]">Case number</span>
            <input className={inputClass} value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} /></label>
        )}
        <label className="space-y-1"><span className="text-slate-500 text-[12px]">Clerk’s rate (%)</span>
          <input className={inputClass} inputMode="decimal" value={toRule ? '' : rate} disabled={toRule}
            onChange={(e) => setRate(e.target.value)} placeholder="e.g. 2.5" data-testid="override-rate" />
          <span className="flex items-center gap-1.5 text-[12px] text-slate-500">
            <input type="checkbox" checked={toRule} onChange={(e) => setToRule(e.target.checked)} /> Back to the rule
          </span></label>
        <label className="space-y-1"><span className="text-slate-500 text-[12px]">From (payments received on or after)</span>
          <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="space-y-1 sm:col-span-2"><span className="text-slate-500 text-[12px]">Why (required)</span>
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="override-reason" /></label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" onClick={() => void save()} disabled={busy || !ready}>Save exception</Button>
        {!toRule && rate.trim() !== '' && rateBad && <span className="text-[12px] text-negative-700">A rate from 0% to 10%.</span>}
        {msg && <span className="text-[12px] text-slate-500">{msg}</span>}
      </div>
    </Card>
  )
}
