import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { inputClass } from '../../components/ui/Modal'
import { PeriodStepper } from '../../components/people/PeriodStepper'
import { PayStatementView } from '../../components/people/PayStatementView'
import { useAppStore } from '../../store/AppStore'
import { departmentOf } from '../../lib/departments.ts'
import {
  buildStatement, clientsWithPtc, defaultPayBasis, hasCommissionScheme, PAY_BASIS_LABEL, periodForKey,
  periodKeyOf, periodLabel, shortDay, type PayBasis, type PayStatement,
} from '../../lib/clerkCommission.ts'
import {
  fetchCarried, fetchCommissionPayments, fetchCommissionStart, fetchEmployeeProfiles, fetchPayoverRuns, fetchProfileHistory,
  saveEmployeeProfile, type EmployeeProfile, type ProfileChange,
} from '../../lib/peopleApi'
import { fetchCollectorPerformance } from '../../lib/collectorStats.ts'
import type { CollectorStats } from '../../lib/collectorScore.ts'
import { clockToday } from '../../lib/clock.ts'
import { rand } from '../../lib/money'

const FIELD_LABEL: Record<string, string> = {
  job_title: 'Job title', start_date: 'Start date', started_on: 'Start date', ended_on: 'End date', pay_basis: 'Pay basis', basic_salary: 'Basic salary', notes: 'Notes',
}

/** "From midnight on the 11th to the end of the 10th", as the floor asks collector_performance. */
function floorBounds(key: string): { from: Date; to: Date } {
  const p = periodForKey(key)
  const [y, m, d] = p.end.split('-').map(Number)
  return { from: new Date(`${p.start}T00:00:00`), to: new Date(y, m - 1, d + 1) }
}

/**
 * ONE PERSON: THEIR PROFILE, HOW THEIR WORK IS GOING, AND WHAT THEY ARE PAID FOR A PERIOD.
 *
 * PERFORMANCE IS THE FLOOR'S OWN FIGURES, NOT NEW ONES. The firm will give the KPIs later; until
 * then this shows what /performance already measures, and "Collected" here is the very number the
 * floor shows -- which is also the base the commission is worked on, so a clerk can hold the two up
 * against each other. Where they differ it is a reversal: the floor drops a reversed payment from
 * every month, pay takes it back in the month it happened.
 */
export function PersonPay() {
  const { userId = '' } = useParams()
  const { userById } = useAppStore()
  const person = userById(userId)
  const latest = periodKeyOf(clockToday())
  const [periodKey, setPeriodKey] = useState(latest)

  const [profile, setProfile] = useState<EmployeeProfile | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [history, setHistory] = useState<ProfileChange[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadProfile = useCallback(async () => {
    try {
      const all = await fetchEmployeeProfiles()
      setProfile(all.find((p) => p.userId === userId) ?? null)
      setHistory(await fetchProfileHistory(userId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the profile.')
    } finally { setLoaded(true) }
  }, [userId])
  useEffect(() => { void loadProfile() }, [loadProfile])

  const basis: PayBasis = profile?.payBasis ?? defaultPayBasis(person?.role)

  /* ---------------- the statement ---------------- */
  const [statement, setStatement] = useState<PayStatement | null>(null)
  const [stError, setStError] = useState<string | null>(null)
  useEffect(() => {
    if (!loaded) return
    let live = true
    setStatement(null); setStError(null)
    const p = periodForKey(periodKey)
    ;(async () => {
      const scheme = hasCommissionScheme(basis)
      const [payments, carried, commissionStart] = scheme
        ? await Promise.all([fetchCommissionPayments(p.start, p.end, userId), fetchCarried(userId), fetchCommissionStart()])
        : [[], [], null]
      const { runs } = await fetchPayoverRuns(clientsWithPtc(payments, carried))
      return buildStatement({
        periodKey, basis, basic: profile?.basicSalary ?? null,
        startedOn: person?.startDate ?? null, endedOn: profile?.endedOn ?? null,
        payments, runs, carried, commissionStart,
      })
    })()
      .then((s) => { if (live) setStatement(s) })
      .catch((e) => { if (live) setStError(e instanceof Error ? e.message : 'Could not work out the pay.') })
    return () => { live = false }
  }, [loaded, periodKey, basis, profile?.basicSalary, profile?.endedOn, person?.startDate, userId])

  /* ---------------- the floor's figures ---------------- */
  const [perf, setPerf] = useState<CollectorStats | null>(null)
  useEffect(() => {
    let live = true
    const b = floorBounds(periodKey)
    fetchCollectorPerformance(b.from, b.to)
      .then((rows) => { if (live) setPerf(rows.find((r) => r.userId === userId) ?? null) })
      .catch(() => { if (live) setPerf(null) })
    return () => { live = false }
  }, [periodKey, userId])

  if (!person) {
    return <Card className="p-6 text-sm text-slate-500">Nobody with that login. <Link to="/people" className="text-brand-700">Back to People</Link></Card>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight text-slate-800" data-testid="person-name">{person.name}</h1>
        <span className="text-xs text-slate-400">{person.role} · {departmentOf(person.role)}</span>
      </div>
      {error && <Card className="p-4 text-sm text-negative-700 bg-negative-50 border-negative-100">{error}</Card>}

      {loaded && <ProfileForm key={profile?.updatedAt ?? 'new'} userId={userId} profile={profile} startDate={person.startDate ?? null} defaultBasis={defaultPayBasis(person.role)} onSaved={loadProfile} />}

      <div className="flex items-center justify-between flex-wrap gap-3 pt-2">
        <h2 className="text-lg font-semibold tracking-tight text-slate-800">Pay</h2>
        <PeriodStepper value={periodKey} onChange={setPeriodKey} latest={latest} />
      </div>

      <Card>
        <div className="flex flex-wrap gap-6 text-sm">
          <div><div className="text-[11px] uppercase tracking-wide text-slate-400">Collected ({periodLabel(periodKey)})</div>
            <div className="tabular-nums font-medium" data-testid="floor-collected">{rand(perf?.collected ?? 0)}</div></div>
          <div><div className="text-[11px] uppercase tracking-wide text-slate-400">Payments</div>
            <div className="tabular-nums">{perf?.payments ?? 0}</div></div>
          <div><div className="text-[11px] uppercase tracking-wide text-slate-400">Calls</div>
            <div className="tabular-nums">{perf?.calls ?? 0}</div></div>
          <div><div className="text-[11px] uppercase tracking-wide text-slate-400">Promises kept / broken</div>
            <div className="tabular-nums">{perf ? `${perf.promisesKept} / ${perf.promisesBroken}` : '0 / 0'}</div></div>
          <Link to={`/performance/${userId}`} className="self-end text-brand-700 hover:underline text-[13px]">All their figures</Link>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          The floor’s own figures, by who held the account on the payment day. The firm’s KPIs are still to come.
        </p>
      </Card>

      {stError && <Card className="p-4 text-sm text-negative-700 bg-negative-50 border-negative-100">{stError}</Card>}
      {statement === null && !stError ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-6"><Loader2 size={16} className="animate-spin" /> Working out the pay…</div>
      ) : statement && (
        <PayStatementView statement={statement} provisional={periodKey === latest}
          scheme={hasCommissionScheme(basis) ? null : `${PAY_BASIS_LABEL[basis]}: commission scheme not set up yet. Basic salary only.`} />
      )}

      <p className="text-[11px] text-slate-400">
        A payment is credited to whoever held the account on the day it was received. Where the desk history only began after
        the account was handed out, the holder at that point is taken to have held it since handover, and the line says so.
      </p>

      {history.length > 0 && (
        <Card className="overflow-hidden" padded={false}>
          <h3 className="px-4 pt-3 pb-2 text-[15px] font-semibold text-slate-800">Changes to this profile</h3>
          <table className="w-full list-table" data-testid="profile-history">
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-slate-100 text-sm">
                  <td className="px-4 py-1.5 text-slate-500 whitespace-nowrap">{shortDay(h.changedAt.slice(0, 10))}</td>
                  <td className="px-4 py-1.5 text-slate-700">{FIELD_LABEL[h.field] ?? h.field}</td>
                  <td className="px-4 py-1.5 text-slate-500">{h.oldValue ?? '—'} → <span className="text-slate-800">{h.newValue ?? '—'}</span></td>
                  <td className="px-4 py-1.5 text-slate-500">{userById(h.changedBy ?? undefined)?.name ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function ProfileForm({ userId, profile, startDate, defaultBasis, onSaved }: {
  userId: string
  profile: EmployeeProfile | null
  /** profiles.start_date: any Administrator sets it on the user, so it is shown here, not edited. */
  startDate: string | null
  defaultBasis: PayBasis
  onSaved: () => Promise<void>
}) {
  const [jobTitle, setJobTitle] = useState(profile?.jobTitle ?? '')
  const [endedOn, setEndedOn] = useState(profile?.endedOn ?? '')
  const [payBasis, setPayBasis] = useState<string>(profile?.payBasis ?? '')
  const [basic, setBasic] = useState(profile?.basicSalary === null || profile?.basicSalary === undefined ? '' : String(profile.basicSalary))
  const [notes, setNotes] = useState(profile?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const basicValue = basic.trim() === '' ? null : Number(basic.replace(/[\s,]/g, ''))
  const bad = basicValue !== null && (!Number.isFinite(basicValue) || basicValue < 0)
  const dirty = useMemo(() => (
    jobTitle !== (profile?.jobTitle ?? '') || endedOn !== (profile?.endedOn ?? '')
    || payBasis !== (profile?.payBasis ?? '') || basicValue !== (profile?.basicSalary ?? null) || notes !== (profile?.notes ?? '')
  ), [jobTitle, endedOn, payBasis, basicValue, notes, profile])

  async function save() {
    setBusy(true); setMsg(null)
    try {
      await saveEmployeeProfile({
        userId,
        jobTitle: jobTitle.trim() || null,
        endedOn: endedOn || null,
        payBasis: (payBasis || null) as PayBasis | null,
        basicSalary: basicValue,
        notes: notes.trim() || null,
      })
      await onSaved()
      setMsg('Saved.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save.')
    } finally { setBusy(false) }
  }

  return (
    <Card>
      <h2 className="text-[15px] font-semibold text-slate-800 mb-3">Profile</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
        <label className="space-y-1"><span className="text-slate-500 text-[12px]">Job title</span>
          <input className={inputClass} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} /></label>
        {/* THE START DATE IS ON THE USER, where any Administrator sets it (the firm, 23 Oct), and only
            read here -- one start date, not a second copy in the pay record that drifts. */}
        <div className="space-y-1"><span className="text-slate-500 text-[12px]">Start date</span>
          <div className="py-1.5 text-slate-700" data-testid="start-date">
            {startDate ? shortDay(startDate) : <span className="text-slate-400">Not set</span>}
            <span className="block text-[11px] text-slate-400">Set under Settings → Users (Edit user).</span>
          </div></div>
        <label className="space-y-1"><span className="text-slate-500 text-[12px]">End date (a leaver: paid to this day)</span>
          <input type="date" className={inputClass} value={endedOn} onChange={(e) => setEndedOn(e.target.value)} data-testid="ended-on" /></label>
        <label className="space-y-1"><span className="text-slate-500 text-[12px]">Pay basis</span>
          <select className={inputClass} value={payBasis} onChange={(e) => setPayBasis(e.target.value)} data-testid="pay-basis">
            <option value="">From their role: {PAY_BASIS_LABEL[defaultBasis].split(' (')[0]}</option>
            {(Object.keys(PAY_BASIS_LABEL) as PayBasis[]).map((b) => <option key={b} value={b}>{PAY_BASIS_LABEL[b]}</option>)}
          </select></label>
        <label className="space-y-1"><span className="text-slate-500 text-[12px]">Basic salary a month (R)</span>
          <input className={inputClass} inputMode="decimal" value={basic} onChange={(e) => setBasic(e.target.value)} data-testid="basic-salary" /></label>
        <label className="space-y-1 sm:col-span-2"><span className="text-slate-500 text-[12px]">Notes</span>
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" onClick={() => void save()} disabled={busy || !dirty || bad}>Save profile</Button>
        {bad && <span className="text-[12px] text-negative-700">The basic salary must be an amount in rands.</span>}
        {msg && <span className="text-[12px] text-slate-500">{msg}</span>}
        <span className="text-[11px] text-slate-400 ml-auto">Every change is kept, with who made it and when.</span>
      </div>
    </Card>
  )
}
