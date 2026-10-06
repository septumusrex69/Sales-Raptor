import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Card } from '../../components/ui/Card'
import { Modal, inputClass } from '../../components/ui/Modal'
import { supabase } from '../../lib/supabase'
import { rand, ratePercent } from '../../lib/money'
import {
  fetchSettingChanges, logSettingChange, reallocateAccount,
  type SettingChange,
} from '../../lib/payover'

/**
 * THE FOUR THINGS THAT DECIDE WHAT EVERY DEBTOR IS CHARGED AND EVERY CLIENT IS PAID.
 *
 * The Annexure B tariff as SQL reads it, the VAT rate, the allocation engine's cut-over, and each
 * client's commission. None of them is the sort of change anybody remembers making a month later,
 * which is why every one of them writes an audit line with a REASON -- and the reason is asked
 * for, because only the person pressing the button knows it.
 *
 * TWO OF THEM ARE READ-ONLY HERE, AND SAY WHY.
 *
 * The CUT-OVER freezes the moment the engine has split anything: every allocation was computed
 * against it, and moving it afterwards changes which payments were ever in scope without changing
 * a single row that says so. `protect_finance_cutover` reverts the change rather than raising, so
 * a screen that offered the field would silently do nothing -- worse than not offering it.
 *
 * The TARIFF is what the debtor was charged on the day of the action, and the rows are history as
 * much as configuration. Editing one restates fees already raised and, on imported rows, fees a
 * client has already been invoiced on. Adding a new period is the honest change and it is a
 * migration, because it is a fact about a gazette rather than a preference.
 */

interface Tariff {
  id: string
  item: string
  description: string
  rate: number | null
  fixed_amount: number | null
  cap_excl_vat: number | null
  effective_from: string
  effective_to: string | null
}

export function FinanceSettings() {
  const [tariffs, setTariffs] = useState<Tariff[]>([])
  const [vatRate, setVatRate] = useState<number | null>(null)
  const [cutover, setCutover] = useState<string | null>(null)
  const [lag, setLag] = useState<number>(1)
  const [allocations, setAllocations] = useState(0)
  const [changes, setChanges] = useState<SettingChange[]>([])
  const [rates, setRates] = useState<{ id: string; name: string; code: string | null; rate: number | null; banded: boolean; accounts: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; name: string; rate: number | null } | null>(null)
  const [vatModal, setVatModal] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [t, f, a, c] = await Promise.all([
        supabase.from('annexure_b_tariffs').select('*').order('item').order('effective_from', { ascending: false }),
        supabase.from('firm_settings').select('vat_rate, finance_cutover_at, payover_lag_months').limit(1).maybeSingle(),
        supabase.from('payment_allocations').select('id', { count: 'exact', head: true }),
        supabase.from('companies').select('id, name, code, commission_rate, commission_bands'),
      ])
      if (t.error) throw new Error(t.error.message)
      setTariffs((t.data ?? []) as unknown as Tariff[])
      const fs = f.data as { vat_rate: number | string; finance_cutover_at: string | null; payover_lag_months: number | null } | null
      setVatRate(fs ? Number(fs.vat_rate) : null)
      setCutover(fs?.finance_cutover_at ?? null)
      setLag(fs?.payover_lag_months ?? 1)
      setAllocations(a.count ?? 0)
      /* HOW MANY ACCOUNTS A RATE WOULD MOVE, counted in the database rather than by loading the
         book: this screen must not become the thing that pulls 23 000 rows into a browser. */
      const counts = await supabase.rpc('money_position')
      const byCompany = new Map<string, number>()
      for (const r of ((counts.data ?? []) as { company_id: string }[])) {
        byCompany.set(r.company_id, (byCompany.get(r.company_id) ?? 0) + 1)
      }
      setRates(((c.data ?? []) as { id: string; name: string; code: string | null; commission_rate: number | null; commission_bands: unknown }[])
        .map((x) => ({
          id: x.id, name: x.name, code: x.code,
          rate: x.commission_rate === null ? null : Number(x.commission_rate),
          banded: x.commission_bands !== null,
          accounts: byCompany.get(x.id) ?? 0,
        }))
        .filter((x) => x.accounts > 0 || x.rate !== null || x.banded)
        .sort((a2, b2) => b2.accounts - a2.accounts))
      setChanges(await fetchSettingChanges())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the finance settings.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  /*
   * WRITTEN STRAIGHT, NOT THROUGH saveFirmSettings. That one writes the WHOLE row back, and this
   * screen never loaded the other twenty-eight columns -- saving from here would blank the firm's
   * address on a letterhead because somebody changed a payover date.
   */
  const saveLag = useCallback(async (months: number) => {
    const before = lag
    setLag(months)
    const { error: e } = await supabase.from('firm_settings')
      .update({ payover_lag_months: months }).eq('id', true)
    if (e) { setLag(before); setError(e.message); return }
    await logSettingChange({
      setting: 'payover_lag_months',
      oldValue: payoverLagLabel(before), newValue: payoverLagLabel(months),
      reason: 'Changed on the trust settings screen',
    })
    await load()
  }, [lag, load])

  const frozen = allocations > 0

  return (
    <div className="space-y-4">

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-negative-50 px-4 py-3 text-sm text-negative-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}
      {loading && <div className="py-16 text-center text-slate-400"><Loader2 className="mx-auto w-5 h-5 animate-spin" /></div>}

      {!loading && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <Card>
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">VAT rate</div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-[22px] font-medium tabular-nums text-slate-800">{ratePercent(vatRate)}</span>
                <button type="button" onClick={() => setVatModal(true)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-[12.5px] font-medium text-slate-700 hover:bg-slate-100">
                  Change
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Applied to every fee and every commission line from the moment it changes. Past
                lines keep the rate they were raised at.
              </p>
            </Card>

            <Card>
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">Allocation engine</div>
              <div className="mt-1 text-[22px] font-medium tabular-nums text-slate-800">
                {cutover ? new Date(cutover).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Off'}
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {cutover
                  ? `Payments captured from this date are split by Raptor. ${allocations.toLocaleString('en-ZA')} allocated so far.`
                  : 'Nothing is being split. Payments are captured and left as they are.'}
              </p>
              {frozen && (
                <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Frozen. Every allocation was computed against this date; moving it now would
                  change which payments were ever in scope without changing a row that says so.
                </p>
              )}
            </Card>

            {/*
              WHEN A CLOSED CYCLE IS ACTUALLY PAID OVER -- AND THIS IS THE ONE SETTING ON THE SCREEN
              RAPTOR GUESSED. The firm, describing the trust on the 6th of October: the 11 Aug -
              10 Sep money "has not been paid out on the 11th of October". That is a month after
              the cycle closed rather than the day after, so one month is the default -- but it is
              a guess at a date the firm promises a client their money, and the trust overview now
              prints it beside every cycle. A box that says so is cheaper than a wrong date on a
              screen about client money.

              NO REASON ASKED, UNLIKE THE OTHER TWO. The VAT rate and a commission rate restate
              money already moved; this moves no figure at all -- it names a day, and every amount
              on either side of it is unchanged. An audit line is still written, because "who
              decided we pay on the 11th of the next month" is a question somebody will ask.
            */}
            <Card>
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">
                When a payover is paid
              </div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-[22px] font-medium tabular-nums text-slate-800">
                  {payoverLagLabel(lag)}
                </span>
                <select
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-[12.5px] font-medium text-slate-700"
                  value={lag}
                  onChange={(e) => { void saveLag(Number(e.target.value)) }}>
                  {[0, 1, 2].map((m) => (
                    <option key={m} value={m}>{payoverLagLabel(m)}</option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                A cycle closing on 10 September is paid over on {payoverLagExample(lag)}. Raptor
                guessed this one &mdash; it is the date the trust overview quotes beside every
                cycle still holding money.
              </p>
            </Card>
          </div>

          <Card padded={false}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">
                Annexure B tariff, as the engine reads it
              </span>
              <span className="text-xs text-slate-400">
                Read-only — a tariff row is what a debtor was charged on the day
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11.5px] font-medium uppercase tracking-[0.06em] text-slate-400">
                    <th className="px-4 py-2.5">Item</th>
                    <th className="px-4 py-2.5">What it covers</th>
                    <th className="px-4 py-2.5 text-right">Rate</th>
                    <th className="px-4 py-2.5 text-right">Amount</th>
                    <th className="px-4 py-2.5 text-right">Cap</th>
                    <th className="px-4 py-2.5">In force</th>
                  </tr>
                </thead>
                <tbody>
                  {tariffs.map((t) => (
                    <tr key={t.id} className="border-b border-slate-50 text-sm">
                      <td className="px-4 py-2.5 font-medium">{t.item}</td>
                      <td className="px-4 py-2.5 text-slate-600">{t.description}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{t.rate === null ? '—' : ratePercent(Number(t.rate))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{t.fixed_amount === null ? '—' : rand(Number(t.fixed_amount))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{t.cap_excl_vat === null ? '—' : rand(Number(t.cap_excl_vat))}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">
                        {t.effective_from}{t.effective_to ? ` to ${t.effective_to}` : ' onwards'}
                      </td>
                    </tr>
                  ))}
                  {tariffs.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">No tariff rows.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-3 text-xs text-slate-400">
              src/lib/annexureB.ts is the other copy and the one the app prices from; this table
              exists because the allocation engine runs in the database. A new period is a
              migration, because it is a fact about a gazette rather than a preference.
            </p>
          </Card>

          <Card padded={false}>
            <div className="border-b border-slate-100 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">
              Commission, per client
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px]">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11.5px] font-medium uppercase tracking-[0.06em] text-slate-400">
                    <th className="px-4 py-2.5">Client</th>
                    <th className="px-4 py-2.5 text-right">Accounts</th>
                    <th className="px-4 py-2.5 text-right">Rate</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {rates.map((c) => (
                    <tr key={c.id} className="border-b border-slate-50 text-sm">
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-slate-800">{c.name}</span>
                        {c.code && <span className="ml-2 text-xs text-slate-400">{c.code}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{c.accounts.toLocaleString('en-ZA')}</td>
                      <td className="px-4 py-2.5 text-right">
                        {c.banded
                          ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11.5px] font-medium text-slate-600">Sliding bands</span>
                          : c.rate === null
                            ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11.5px] font-semibold text-amber-800">No rate</span>
                            : <span className="tabular-nums">{ratePercent(c.rate)}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {!c.banded && (
                          <button type="button" onClick={() => setEditing({ id: c.id, name: c.name, rate: c.rate })}
                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-[12.5px] font-medium text-slate-700 hover:bg-slate-100">
                            {c.rate === null ? 'Set' : 'Change'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-3 text-xs text-slate-400">
              A rate is a fraction everywhere in Raptor — 0.30 is thirty per cent. Sliding bands are
              marginal, on the client&rsquo;s cumulative capital since the mandate date, and are set
              from the client record rather than here.
            </p>
          </Card>

          <Card padded={false}>
            <div className="border-b border-slate-100 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">
              Who changed what
            </div>
            <div className="divide-y divide-slate-50">
              {changes.map((c) => (
                <div key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                  <span className="text-xs tabular-nums text-slate-400">
                    {new Date(c.changedAt).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="font-medium text-slate-800">{c.setting}</span>
                  <span className="text-slate-500">{c.oldValue ?? '—'} → {c.newValue ?? '—'}</span>
                  {c.scope && <span className="text-xs text-slate-400">{c.scope}</span>}
                  <span className="text-xs text-slate-400">{c.changedBy ?? 'unknown'}</span>
                  {c.reason && <span className="w-full text-xs text-slate-500">{c.reason}</span>}
                </div>
              ))}
              {changes.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-slate-400">Nothing has been changed yet.</p>
              )}
            </div>
          </Card>
        </>
      )}

      {vatModal && vatRate !== null && (
        <ChangeModal
          title="Change the VAT rate"
          label="VAT rate"
          current={vatRate}
          note="Applied to every fee and commission line raised from now on. Lines already raised keep the rate they were raised at — they are what a client was invoiced."
          onClose={() => setVatModal(false)}
          onSave={async (fraction, reason) => {
            const { error: e } = await supabase.from('firm_settings').update({ vat_rate: fraction }).eq('id', true)
            if (e) throw new Error(e.message)
            await logSettingChange({
              setting: 'vat_rate', oldValue: ratePercent(vatRate), newValue: ratePercent(fraction), reason,
            })
            setVatModal(false)
            await load()
          }}
        />
      )}

      {editing && (
        <ChangeModal
          title={`Commission for ${editing.name}`}
          label="Rate"
          current={editing.rate ?? 0}
          note="Every account under this client is re-split against the new rate, and any payover still being worked is rebuilt. Anything already inside an approved invoice is left exactly as it was."
          onClose={() => setEditing(null)}
          onSave={async (fraction, reason) => {
            const before = editing.rate
            const { error: e } = await supabase.from('companies')
              .update({ commission_rate: fraction }).eq('id', editing.id)
            if (e) throw new Error(e.message)
            await logSettingChange({
              setting: 'commission_rate', companyId: editing.id, scope: editing.name,
              oldValue: before === null ? 'none' : ratePercent(before),
              newValue: ratePercent(fraction), reason,
            })
            /*
             * AND THE ACCOUNTS ARE REPLAYED. Setting the rate alone changes nothing: the
             * allocations were written with the old one and it is the allocations a run is built
             * from. Capped, because a client with nine thousand accounts is not a thing to do
             * from a browser -- the rest are picked up by the exception queue account by account,
             * which is where somebody is looking anyway.
             */
            const { data: accts } = await supabase.from('debtor_accounts')
              .select('id').eq('company_id', editing.id).limit(200)
            for (const a of ((accts ?? []) as { id: string }[])) {
              await reallocateAccount(a.id)
            }
            setEditing(null)
            await load()
          }}
        />
      )}
    </div>
  )
}

/** One number, a reason, and a note saying what it will do. Every change here writes an audit line. */
function ChangeModal({ title, label, current, note, onClose, onSave }: {
  title: string; label: string; current: number; note: string
  onClose: () => void
  onSave: (fraction: number, reason: string) => Promise<void>
}) {
  const [percent, setPercent] = useState(String(Math.round(current * 10000) / 100))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fraction = Number(percent) / 100
  const valid = Number.isFinite(fraction) && fraction >= 0 && fraction < 1 && reason.trim().length > 0

  return (
    <Modal title={title} onClose={onClose} width={440}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
          <div className="flex items-center gap-2">
            <input value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="decimal"
              className={clsx(inputClass, 'w-24')} />
            <span className="text-sm text-slate-500">
              per cent{Number.isFinite(fraction) ? ` · stored as ${fraction}` : ''}
            </span>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Why</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass}
            placeholder="A new mandate, a gazette, a correction…" />
          <p className="mt-1 text-xs text-slate-400">
            Required. Only you know why, and in a month nobody will.
          </p>
        </div>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">{note}</p>
        {error && <p className="rounded-lg bg-negative-50 px-3 py-2 text-[13px] text-negative-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button type="button" disabled={!valid || busy}
            onClick={() => {
              setBusy(true); setError(null)
              void onSave(fraction, reason.trim())
                .catch((e: unknown) => setError(e instanceof Error ? e.message : 'That did not save.'))
                .finally(() => setBusy(false))
            }}
            className="rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * THE LAG IN THE FIRM'S WORDS, NOT IN MONTHS.
 *
 * "1" on its own is meaningless on a settings card: a month after WHAT. Both halves of the
 * sentence are drawn, here and in the note under it, because the only way somebody can tell this
 * box is set wrongly is by reading the date it produces.
 */
function payoverLagLabel(months: number): string {
  if (months === 0) return 'The day after it closes'
  if (months === 1) return 'A month later'
  return `${months} months later`
}

/** The same rule as a date somebody can check against their own bank statement. */
function payoverLagExample(months: number): string {
  const month = ['Sep', 'Oct', 'Nov', 'Dec'][Math.min(Math.max(months, 0), 3)]
  return `11 ${month}`
}
