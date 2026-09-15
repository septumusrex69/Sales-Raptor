import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { UserAvatar } from '../ui/Avatar'
import { useAppStore } from '../../store/AppStore'
import { supabase } from '../../lib/supabase'
import {
  COLLECTOR_GRADES, DEFAULT_BOOK_CEILING, DEFAULT_DIARY_RESERVE, MAX_BOOK_CEILING,
  MIN_BOOK_CEILING, bookCeilingOf, diaryReserveOf, selfBookingLimit,
  type CollectorGrade,
} from '../../lib/collectorGrade.ts'
import {
  DEFAULT_DIARY_CAPACITY, MAX_DIARY_CAPACITY, MIN_DIARY_CAPACITY,
} from '../../lib/diaryPriority.ts'
import type { User } from '../../types'

/** Roles that work a collections book. Anyone already graded is included whatever their role. */
const COLLECTING_ROLES = ['Pre-legal Agent', 'Pre-legal Team Leader', 'Liaison', 'Liaison Manager']

/**
 * What each collector is trusted with, and how much of it.
 *
 * THIS SCREEN IS WHAT MAKES HANDING WORK OUT POSSIBLE AT ALL. A grade is what marks somebody as
 * a collector: without one they are offered nothing, and the hand-out planner cannot give them
 * an account. Until this existed the three numbers could only be set in SQL, and the hand-out
 * modal told people to come to a screen that could not do it.
 *
 * Its own table rather than four more columns on the Users list, which is already seven wide and
 * would need a horizontal scroll on an iPad to reach the thing being changed.
 *
 * GRADE IS SET BY A PERSON, NEVER COMPUTED. The collector's own numbers — payments per hundred
 * accounts, recovery rate, promises kept — can say somebody looks like a Skilled collector; a
 * team leader decides. One large settlement is not a promotion, and it is an employment matter.
 */
export function CollectorsPanel({ canEdit }: { canEdit: boolean }) {
  const { users, updateUser } = useAppStore()
  const [load, setLoad] = useState<Map<string, number> | null>(null)

  const collectors = users.filter((u) =>
    u.status === 'Active' && (u.collectorGrade || COLLECTING_ROLES.includes(u.role)))

  /*
   * What each person is actually carrying, IN PLAY. Fetched rather than counted in the browser
   * because the book is six figures — and in play rather than total, because a collector holding
   * 500 accounts of which 372 are written off is holding 128, and a ceiling counting the corpses
   * would refuse them work they have room for.
   */
  useEffect(() => {
    let cancelled = false
    void supabase.rpc('collector_book_load').then(({ data, error }) => {
      if (cancelled || error) return
      const rows = (data ?? []) as { user_id: string; in_play_accounts: number }[]
      setLoad(new Map(rows.map((r) => [r.user_id, Number(r.in_play_accounts ?? 0)])))
    })
    return () => { cancelled = true }
  }, [])

  return (
    <Card padded={false}>
      <div className="p-5">
        <CardHeader
          title="Collectors"
          subtitle={`The company standard is ${DEFAULT_BOOK_CEILING} accounts on the book and ${DEFAULT_DIARY_CAPACITY} a day, with ${DEFAULT_DIARY_RESERVE} held back. Change it per person only where somebody really differs.`}
        />
      </div>

      {collectors.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-slate-500">
          Nobody here works a collections book yet. Give somebody the Pre-legal Agent or
          Pre-legal Team Leader role above, and they will appear here to be graded.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-t border-slate-100">
                <th className="font-medium px-5 py-2.5">Collector</th>
                <th className="font-medium px-3 py-2.5">
                  Grade
                  {/* What the grade is FOR, said where it is set. It is the commonest thing to
                      get wrong about this model. */}
                  <span className="block font-normal text-slate-300">which accounts</span>
                </th>
                <th className="font-medium px-3 py-2.5">
                  Book ceiling
                  <span className="block font-normal text-slate-300">accounts at once</span>
                </th>
                <th className="font-medium px-3 py-2.5">
                  A day
                  <span className="block font-normal text-slate-300">diary capacity</span>
                </th>
                <th className="font-medium px-3 py-2.5">
                  Held back
                  <span className="block font-normal text-slate-300">for work sent to them</span>
                </th>
                <th className="font-medium px-3 py-2.5">Carrying now</th>
              </tr>
            </thead>
            <tbody>
              {collectors.map((u) => (
                <CollectorRow key={u.id} user={u} canEdit={canEdit}
                  inPlay={load?.get(u.id) ?? null}
                  onChange={(patch) => updateUser(u.id, patch)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="px-5 py-3 border-t border-slate-100 text-xs text-slate-400">
        Grade decides <span className="font-medium text-slate-500">which</span> accounts somebody
        may be given, never how many — a junior and an elite carry the same book and differ only
        in what is on it. Generic work goes to anyone; high value from R25&nbsp;000 needs Skilled
        or better; major accounts from R50&nbsp;000 need Senior or Elite. Anything disputed, in
        legal or under administration counts as high value whatever it is worth.
      </p>
    </Card>
  )
}

function CollectorRow({ user, canEdit, inPlay, onChange }: {
  user: User
  canEdit: boolean
  inPlay: number | null
  onChange: (patch: Partial<User>) => void
}) {
  const ceiling = bookCeilingOf(user.bookCeiling)
  const capacity = user.diaryCapacity && user.diaryCapacity > 0 ? user.diaryCapacity : DEFAULT_DIARY_CAPACITY
  const reserve = diaryReserveOf(user.diaryReserve)
  const over = inPlay !== null && inPlay > ceiling

  return (
    <tr className="border-t border-slate-50">
      <td className="px-5 py-2.5">
        <div className="flex items-center gap-2.5">
          <UserAvatar userId={user.id} size={26} />
          <span className="min-w-0">
            <span className="block font-medium text-slate-700 leading-tight">{user.name}</span>
            <span className="block text-[11px] text-slate-400">{user.role}</span>
          </span>
        </div>
      </td>

      <td className="px-3 py-2.5">
        {canEdit ? (
          <select
            className="text-sm text-slate-600 border border-slate-200 rounded-lg px-2 py-1 bg-white outline-none"
            value={user.collectorGrade ?? ''}
            onChange={(e) => onChange({ collectorGrade: (e.target.value || undefined) as CollectorGrade | undefined })}
          >
            {/*
              "Not a collector" is a real choice, not an absence. A liaison who answers client
              queries should be offered no accounts at all, and a blank grade is exactly what
              takes them out of the hand-out list.
            */}
            <option value="">Not a collector</option>
            {COLLECTOR_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        ) : (
          <span className="text-slate-500">{user.collectorGrade ?? '—'}</span>
        )}
      </td>

      <td className="px-3 py-2.5">
        <NumberCell value={user.bookCeiling} fallback={DEFAULT_BOOK_CEILING} canEdit={canEdit}
          min={MIN_BOOK_CEILING} max={MAX_BOOK_CEILING}
          onChange={(v) => onChange({ bookCeiling: v })} />
      </td>

      <td className="px-3 py-2.5">
        <NumberCell value={user.diaryCapacity} fallback={DEFAULT_DIARY_CAPACITY} canEdit={canEdit}
          min={MIN_DIARY_CAPACITY} max={MAX_DIARY_CAPACITY}
          onChange={(v) => onChange({ diaryCapacity: v })} />
      </td>

      <td className="px-3 py-2.5">
        <NumberCell value={user.diaryReserve} fallback={DEFAULT_DIARY_RESERVE} canEdit={canEdit}
          min={0} max={Math.max(0, capacity - 1)}
          onChange={(v) => onChange({ diaryReserve: v })} />
        {/*
          The consequence, spelled out, because the number on its own means nothing. The reserve
          constrains what a clerk books for THEMSELVES; the distributor still fills the whole day,
          which is the only reason to hold slots back at all.
        */}
        {/* nowrap: at three words it wrapped onto three lines and made the row twice as tall as
            its neighbours. The column heading already supplies "for work sent to them". */}
        <span className="block text-[11px] text-slate-400 tabular-nums whitespace-nowrap">
          books {selfBookingLimit(capacity, reserve)} of {capacity}
        </span>
      </td>

      <td className="px-3 py-2.5 tabular-nums">
        {inPlay === null ? (
          <Loader2 size={13} className="animate-spin text-slate-300" />
        ) : (
          <span className={over ? 'text-amber-700 font-medium' : 'text-slate-600'}>
            {inPlay.toLocaleString('en-ZA')} / {ceiling.toLocaleString('en-ZA')}
            {over && (
              <span className="inline-flex items-center gap-1 ml-1.5" title="Over their ceiling. They will be given little or nothing until it comes down.">
                <AlertTriangle size={12} />
                {(inPlay - ceiling).toLocaleString('en-ZA')} over
              </span>
            )}
          </span>
        )}
      </td>
    </tr>
  )
}

/**
 * A number that may be unset, where unset means the company standard rather than nothing.
 *
 * The placeholder shows the standard so an empty box reads as "500, the firm's figure" rather
 * than as a field somebody forgot to fill in. Clearing it writes undefined, which is how a
 * person is put back on the standard after an override — without that there is no way back
 * except typing the standard in by hand, and then it stops following the standard if it changes.
 */
function NumberCell({ value, fallback, canEdit, min, max, onChange }: {
  value: number | undefined
  fallback: number
  canEdit: boolean
  min: number
  max: number
  onChange: (v: number | undefined) => void
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  useEffect(() => { setText(value === undefined ? '' : String(value)) }, [value])

  if (!canEdit) {
    return (
      <span className="text-slate-500 tabular-nums">
        {value ?? fallback}
        {value === undefined && <span className="text-slate-300"> (standard)</span>}
      </span>
    )
  }

  const commit = () => {
    const trimmed = text.trim()
    if (trimmed === '') { onChange(undefined); return }
    const n = Number(trimmed)
    // Out of range is a typo, not an instruction. Snapped rather than rejected silently, and
    // never written as-is: a capacity of 500 is a mistyped 50 with a stuck key, and it would
    // make every day read as empty for ever afterwards.
    if (!Number.isFinite(n)) { setText(value === undefined ? '' : String(value)); return }
    const clamped = Math.min(max, Math.max(min, Math.round(n)))
    setText(String(clamped))
    onChange(clamped)
  }

  return (
    <input
      type="number" min={min} max={max}
      className="w-20 text-sm text-slate-600 border border-slate-200 rounded-lg px-2 py-1 bg-white outline-none tabular-nums"
      placeholder={String(fallback)}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
    />
  )
}
