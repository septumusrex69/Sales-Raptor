import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { controlClass, inputClass } from '../../components/ui/Modal'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { canRecordLeave, leaveVisibleTo } from '../../lib/permissions'
import {
  fmtDays, LEAVE_KINDS, LEAVE_META, leaveBalances, leaveDays, overlapping, type LeaveBalance, type LeaveKind, type LeaveRecord,
} from '../../lib/leave.ts'
import { cancelLeave, fetchLeave, recordLeave } from '../../lib/peopleApi'
import { shortDay } from '../../lib/clerkCommission.ts'
import { clockToday } from '../../lib/clock.ts'

/**
 * LEAVE: WHO IS OFF, AND WHAT EACH PERSON HAS LEFT (23 Oct 2026).
 *
 * THE FIRM (Stephan): "Me and Camille and any administrator can see the leave. Team leaders can also
 * see the leave of their teams. Leaves can be done in half days or full days."
 *
 * WHOSE LEAVE IS ON THIS PAGE IS THE DATABASE'S ANSWER, not this screen's: leave_records answers by
 * leave_visible(), and leaveVisibleTo is only the browser's copy of it, used to decide which names to
 * draw. A team leader who typed somebody else's address would get their name and no leave.
 *
 * RECORDING IS AN ADMINISTRATOR'S (may_record_leave). A team leader sees the form nowhere.
 *
 * NOT PAY. This page is reached without people.pay and shows no salary; the pay screens of the
 * People workspace keep their own guard (RequirePay).
 */

const left = (b: LeaveBalance | undefined) => (b && b.left !== null ? fmtDays(b.left) : '—')

export function LeaveList() {
  const { users } = useAppStore()
  const { currentUser } = useAuth()
  const today = clockToday()
  const [records, setRecords] = useState<LeaveRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchLeave().then(setRecords).catch((e) => setError(e instanceof Error ? e.message : 'Could not read the leave.'))
  }, [])
  useEffect(() => { load() }, [load])

  const people = useMemo(() => leaveVisibleTo(currentUser, users.filter((u) => u.status === 'Active'))
    .sort((a, b) => a.name.localeCompare(b.name)), [currentUser, users])

  const rows = useMemo(() => people.map((u) => {
    const mine = (records ?? []).filter((r) => r.userId === u.id)
    const bal = leaveBalances({ startDate: u.startDate ?? null, records: mine, asAt: today })
    const off = mine.find((r) => r.entry === 'taken' && !r.cancelledAt && r.startsOn <= today && r.endsOn >= today) ?? null
    const next = mine.filter((r) => r.entry === 'taken' && !r.cancelledAt && r.startsOn > today)
      .sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0] ?? null
    return { user: u, bal, off, next }
  }), [people, records, today])

  const mayRecord = canRecordLeave(currentUser)

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight text-slate-800">Leave</h1>
        <span className="text-xs text-slate-400">Who is off, and what each person has left. Working days only.</span>
      </div>
      {error && <Card className="p-4 text-sm text-negative-700 bg-negative-50 border-negative-100">{error}</Card>}
      {mayRecord && records && (
        <RecordLeaveForm people={people.map((u) => ({ id: u.id, name: u.name }))} records={records} onSaved={load} />
      )}
      {records === null && !error ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-8"><Loader2 size={16} className="animate-spin" /> Reading the leave…</div>
      ) : people.length === 0 ? (
        <Card className="p-4 text-sm text-slate-500">Nobody in your team yet.</Card>
      ) : (
        <Card className="overflow-hidden" padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full list-table whitespace-nowrap" data-testid="leave-list">
              <thead>
                <tr className="bg-slate-50 text-slate-400">
                  <th className="text-left font-medium px-4 py-2.5">Name</th>
                  <th className="text-right font-medium px-4 py-2.5">Annual left</th>
                  <th className="text-right font-medium px-4 py-2.5">Sick left</th>
                  <th className="text-right font-medium px-4 py-2.5">Family left</th>
                  <th className="text-left font-medium px-4 py-2.5">Off</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ user, bal, off, next }) => (
                  <tr key={user.id} className="border-t border-slate-100" data-testid="leave-row">
                    <td className="px-4 py-1.5">
                      <Link to={`/people/leave/${user.id}`} className="text-brand-700 hover:underline font-medium">{user.name}</Link>
                      {!user.startDate && <span className="ml-2 text-[11px] text-slate-400">No start date</span>}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums" data-testid="annual-left">{left(bal.find((b) => b.kind === 'annual'))}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{left(bal.find((b) => b.kind === 'sick'))}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{left(bal.find((b) => b.kind === 'family'))}</td>
                    <td className="px-4 py-1.5 text-slate-600 text-[13px]">
                      {off ? <span className="text-amber-700">On {LEAVE_META[off.kind].label.toLowerCase()} until {shortDay(off.endsOn)}</span>
                        : next ? <span className="text-slate-500">From {shortDay(next.startsOn)}</span> : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

export function PersonLeave() {
  const { userId = '' } = useParams()
  const { userById } = useAppStore()
  const { currentUser } = useAuth()
  const person = userById(userId)
  const today = clockToday()
  const [records, setRecords] = useState<LeaveRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    fetchLeave(userId).then(setRecords).catch((e) => setError(e instanceof Error ? e.message : 'Could not read the leave.'))
  }, [userId])
  useEffect(() => { load() }, [load])

  if (!person) {
    return <Card className="p-6 text-sm text-slate-500">Nobody with that login. <Link to="/people/leave" className="text-brand-700">Back to Leave</Link></Card>
  }
  /* THE BROWSER'S COPY OF leave_visible: somebody outside a leader's team gets no page, rather than
     a page of zeroes that reads as "has taken no leave". */
  if (!leaveVisibleTo(currentUser, [person]).length) {
    return <Card className="p-6 text-sm text-slate-500">This person’s leave is not yours to see. <Link to="/people/leave" className="text-brand-700">Back to Leave</Link></Card>
  }
  const mayRecord = canRecordLeave(currentUser)
  const balances = records ? leaveBalances({ startDate: person.startDate ?? null, records, asAt: today }) : []

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight text-slate-800" data-testid="leave-person">{person.name}</h1>
        <span className="text-xs text-slate-400">
          Leave · {person.startDate ? `started ${shortDay(person.startDate)}` : 'start date not set (Settings → Users)'}
        </span>
        <Link to="/people/leave" className="ml-auto text-[13px] text-brand-700 hover:underline">Everybody’s leave</Link>
      </div>
      {error && <Card className="p-4 text-sm text-negative-700 bg-negative-50 border-negative-100">{error}</Card>}
      {records === null && !error ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-8"><Loader2 size={16} className="animate-spin" /> Reading the leave…</div>
      ) : records && (
        <>
          <Card className="overflow-hidden" padded={false}>
            <table className="w-full list-table" data-testid="leave-balances">
              <thead>
                <tr className="bg-slate-50 text-slate-400">
                  <th className="text-left font-medium px-4 py-2.5">Kind</th>
                  <th className="text-right font-medium px-4 py-2.5">Due</th>
                  <th className="text-right font-medium px-4 py-2.5">Taken</th>
                  <th className="text-right font-medium px-4 py-2.5">Booked</th>
                  <th className="text-right font-medium px-4 py-2.5">Left</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={b.kind} className="border-t border-slate-100 align-top" data-testid={`balance-${b.kind}`}>
                    <td className="px-4 py-1.5">
                      <span className="text-slate-800">{LEAVE_META[b.kind].label}</span>
                      <span className="block text-[11px] text-slate-400">
                        {b.cycle && b.rule === 'cycle' ? `Cycle ${shortDay(b.cycle.from)} – ${shortDay(b.cycle.to)}. ` : ''}
                        {b.words ?? LEAVE_META[b.kind].law}
                      </span>
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{b.entitled === null ? '—' : fmtDays(b.entitled)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{fmtDays(b.taken)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-500">{b.booked ? fmtDays(b.booked) : ''}</td>
                    <td className={`px-4 py-1.5 text-right tabular-nums font-medium ${b.left !== null && b.left < 0 ? 'text-negative-700' : ''}`} data-testid={`left-${b.kind}`}>
                      {b.left === null ? '—' : fmtDays(b.left)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 py-2.5 text-[11px] text-slate-400 border-t border-slate-100">
              Working days only: weekends and South African public holidays are not leave. Annual leave accrues 1.25 days for every
              completed month and carries forward; sick and family responsibility leave start again each cycle.
            </p>
          </Card>

          {mayRecord && <RecordLeaveForm people={[{ id: person.id, name: person.name }]} records={records} onSaved={load} />}

          <Card className="overflow-hidden" padded={false}>
            <h3 className="px-4 pt-3 pb-2 text-[15px] font-semibold text-slate-800">Recorded</h3>
            {records.length === 0 ? <p className="px-4 pb-3 text-sm text-slate-400">No leave recorded.</p> : (
              <table className="w-full list-table" data-testid="leave-records">
                <tbody>
                  {records.map((r) => <RecordRow key={r.id} r={r} mayCancel={mayRecord} onDone={load} />)}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function RecordRow({ r, mayCancel, onDone }: { r: LeaveRecord; mayCancel: boolean; onDone: () => void }) {
  const { userById } = useAppStore()
  const [reason, setReason] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const when = r.entry === 'opening'
    ? `Opening balance on ${shortDay(r.startsOn)}`
    : r.startsOn === r.endsOn
      ? `${shortDay(r.startsOn)}${r.startHalf ? ' (half day)' : ''}`
      : `${shortDay(r.startsOn)}${r.startHalf ? ' (from midday)' : ''} – ${shortDay(r.endsOn)}${r.endHalf ? ' (to midday)' : ''}`
  async function cancel() {
    if (!reason || reason.trim().length < 3) { setMsg('Say why.'); return }
    try { await cancelLeave(r.id, reason.trim()); onDone() } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not cancel.') }
  }
  return (
    <tr className={`border-t border-slate-100 text-sm align-top ${r.cancelledAt ? 'text-slate-400 line-through decoration-slate-300' : ''}`}>
      <td className="px-4 py-1.5 whitespace-nowrap">{when}</td>
      <td className="px-4 py-1.5">{LEAVE_META[r.kind].label}</td>
      <td className="px-4 py-1.5 text-right tabular-nums">{fmtDays(r.days)} {r.days === 1 ? 'day' : 'days'}</td>
      <td className="px-4 py-1.5 text-slate-500 no-underline">
        {r.note}
        <span className="block text-[11px] text-slate-400">
          Recorded by {userById(r.createdBy ?? undefined)?.name ?? 'unknown'} on {shortDay(r.createdAt.slice(0, 10))}
          {r.cancelledAt && ` · Cancelled ${shortDay(r.cancelledAt.slice(0, 10))} by ${userById(r.cancelledBy ?? undefined)?.name ?? 'unknown'}: ${r.cancelReason}`}
        </span>
      </td>
      <td className="px-4 py-1.5 text-right whitespace-nowrap">
        {mayCancel && !r.cancelledAt && (reason === null
          ? <button type="button" className="text-[12px] text-brand-700 hover:underline" onClick={() => setReason('')}>Cancel</button>
          : (
            <span className="inline-flex items-center gap-2">
              <input className={`${controlClass} w-48`} placeholder="Why" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button variant="primary" onClick={() => void cancel()}>Cancel leave</Button>
              <button type="button" className="text-[12px] text-slate-500" onClick={() => { setReason(null); setMsg(null) }}>Keep</button>
            </span>
          ))}
        {msg && <span className="block text-[11px] text-negative-700">{msg}</span>}
      </td>
    </tr>
  )
}

/**
 * RECORD LEAVE. The days are worked out here (leaveDays: working days, halves at either end) and
 * shown before saving, so the Administrator sees "4 working days" for a week over a public holiday
 * before it is written. The database refuses an overlap and anything that is not a half-day step.
 */
function RecordLeaveForm({ people, records, onSaved }: {
  people: { id: string; name: string }[]
  records: LeaveRecord[]
  onSaved: () => void
}) {
  const [userId, setUserId] = useState(people.length === 1 ? people[0].id : '')
  const [kind, setKind] = useState<LeaveKind>('annual')
  const [entry, setEntry] = useState<'taken' | 'opening'>('taken')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [startHalf, setStartHalf] = useState(false)
  const [endHalf, setEndHalf] = useState(false)
  const [opening, setOpening] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const end = to || from
  const single = !!from && end === from
  const calc = entry === 'taken' ? leaveDays({ startsOn: from, endsOn: end, startHalf, endHalf: single ? false : endHalf }) : null
  const clash = entry === 'taken' && userId && from && calc?.days ? overlapping(records, { userId, startsOn: from, endsOn: end }) : null
  const openingDays = opening.trim() === '' ? null : Number(opening.replace(',', '.'))
  const openingOk = openingDays !== null && Number.isFinite(openingDays) && Math.round(openingDays * 4) === openingDays * 4
  const problem = !userId ? 'Choose who.'
    : entry === 'opening' ? (!from ? 'Say on which day.' : !openingOk ? 'The balance is a number of days, to the quarter day.' : null)
      : calc?.problem ?? (clash ? `There is already leave recorded from ${shortDay(clash.startsOn)} to ${shortDay(clash.endsOn)}.` : null)

  async function save() {
    if (problem) return
    setBusy(true); setMsg(null)
    try {
      await recordLeave(entry === 'opening'
        ? { userId, kind: 'annual', entry, startsOn: from, endsOn: from, startHalf: false, endHalf: false, days: openingDays as number, note: note.trim() || null }
        : { userId, kind, entry, startsOn: from, endsOn: end, startHalf, endHalf: single ? false : endHalf, days: calc?.days as number, note: note.trim() || null })
      setFrom(''); setTo(''); setStartHalf(false); setEndHalf(false); setOpening(''); setNote('')
      setMsg('Recorded.')
      onSaved()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not record it.')
    } finally { setBusy(false) }
  }

  return (
    <Card>
      <h2 className="text-[15px] font-semibold text-slate-800 mb-3" data-testid="record-leave">Record leave</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        {people.length > 1 && (
          <label className="space-y-1"><span className="text-slate-500 text-[12px]">Who</span>
            <select className={inputClass} value={userId} onChange={(e) => setUserId(e.target.value)} data-testid="leave-who">
              <option value="">Choose…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
        )}
        <label className="space-y-1"><span className="text-slate-500 text-[12px]">What</span>
          <select className={inputClass} value={entry === 'opening' ? 'opening' : kind} data-testid="leave-kind"
            onChange={(e) => {
              if (e.target.value === 'opening') { setEntry('opening'); setKind('annual') } else { setEntry('taken'); setKind(e.target.value as LeaveKind) }
            }}>
            {LEAVE_KINDS.map((k) => <option key={k} value={k}>{LEAVE_META[k].label}</option>)}
            <option value="opening">Opening annual balance (from before Raptor)</option>
          </select></label>
        <label className="space-y-1"><span className="text-slate-500 text-[12px]">{entry === 'opening' ? 'Balance on' : 'First day'}</span>
          <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} data-testid="leave-from" /></label>
        {entry === 'taken' ? (
          <label className="space-y-1"><span className="text-slate-500 text-[12px]">Last day (blank: one day)</span>
            <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} data-testid="leave-to" /></label>
        ) : (
          <label className="space-y-1"><span className="text-slate-500 text-[12px]">Days they had</span>
            <input className={inputClass} inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} data-testid="leave-opening" /></label>
        )}
      </div>
      {entry === 'taken' && (
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-700">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={startHalf} onChange={(e) => setStartHalf(e.target.checked)} data-testid="leave-start-half" />
            {single || !from ? 'Half day' : 'First day: from midday'}
          </label>
          {!single && from && (
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={endHalf} onChange={(e) => setEndHalf(e.target.checked)} data-testid="leave-end-half" />
              Last day: to midday
            </label>
          )}
        </div>
      )}
      <label className="block mt-3 space-y-1 text-sm"><span className="text-slate-500 text-[12px]">Note</span>
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <Button variant="primary" onClick={() => void save()} disabled={busy || !!problem}>Record</Button>
        {entry === 'taken' && calc?.days != null && !problem && (
          <span className="text-[13px] text-slate-700" data-testid="leave-days">{fmtDays(calc.days)} working {calc.days === 1 ? 'day' : 'days'}</span>
        )}
        {problem && (from || userId) && <span className="text-[12px] text-negative-700" data-testid="leave-problem">{problem}</span>}
        {msg && <span className="text-[12px] text-slate-500">{msg}</span>}
      </div>
    </Card>
  )
}
