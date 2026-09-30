import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import {
  COLLECTOR_GRADES, DEFAULT_BOOK_CEILING, DEFAULT_DIARY_RESERVE, MAX_BOOK_CEILING,
  MIN_BOOK_CEILING, bookCeilingOf, diaryReserveOf, selfBookingLimit,
  type CollectorGrade,
} from '../../lib/collectorGrade.ts'
import {
  DEFAULT_DIARY_CAPACITY, MAX_DIARY_CAPACITY, MIN_DIARY_CAPACITY,
} from '../../lib/diaryPriority.ts'
import type { User } from '../../types'

/**
 * WHAT ONE COLLECTOR IS TRUSTED WITH, UNDER THEIR OWN ROW.
 *
 * THIS SCREEN IS WHAT MAKES HANDING WORK OUT POSSIBLE AT ALL. A grade is what marks somebody as
 * a collector: without one they are offered nothing, and the hand-out planner cannot give them
 * an account. Until this existed the three numbers could only be set in SQL, and the hand-out
 * modal told people to come to a screen that could not do it.
 *
 * IT USED TO BE A SECOND TABLE ON THE SAME PAGE, AND THE FIRM SENT THAT BACK. "The way the users
 * are set out here is confusing. Itumeleng is here twice. It's only necessary once." They were
 * right, and with two people on the list it is obvious: the same name in a Users table and again
 * in a Collectors table, with their rank drawn in both.
 *
 * SO IT IS NOT FOUR MORE COLUMNS EITHER, which is what the second table was avoiding. The users
 * list is already seven wide and on the firm's iPad the Status column is over the right-hand
 * edge; adding a ceiling, a capacity and a reserve would put the thing being changed somewhere
 * you have to scroll sideways to reach. One row per person, and the row OPENS.
 *
 * GRADE IS SET BY A PERSON, NEVER COMPUTED. The collector's own numbers — payments per hundred
 * accounts, recovery rate, promises kept — can say somebody looks like a Skilled collector; a
 * team leader decides. One large settlement is not a promotion, and it is an employment matter.
 */
export function CollectorsPanel({ user, canEdit, inPlay, onChange }: {
  user: User
  canEdit: boolean
  /** What they are carrying in play, or null while it is still being fetched. */
  inPlay: number | null
  onChange: (patch: Partial<User>) => void
}) {
  const ceiling = bookCeilingOf(user.bookCeiling)
  const capacity = user.diaryCapacity && user.diaryCapacity > 0 ? user.diaryCapacity : DEFAULT_DIARY_CAPACITY
  const reserve = diaryReserveOf(user.diaryReserve)
  const over = inPlay !== null && inPlay > ceiling

  /*
   * HELD TO A READABLE MEASURE, and that is not only typography.
   *
   * This panel lives in a `td` spanning the whole users table, and that table is wider than the
   * card it sits in: seven columns of nowrap content, with a horizontal scroll to reach Email and
   * Status on an iPad. Left to fill its cell, the paragraphs below ran out to the TABLE's width,
   * so half of each sentence was only reachable by scrolling sideways. A screenshot at 1180px
   * caught it and nothing in the suite could have.
   *
   * 40rem is about sixty-five characters, which is the width prose is read at anyway.
   */
  return (
    <div className="px-5 py-4 bg-slate-50/70 border-t border-slate-100 max-w-[40rem]">
      <p className="text-xs text-slate-500 mb-3">
        The company standard is {DEFAULT_BOOK_CEILING} accounts on the book and{' '}
        {DEFAULT_DIARY_CAPACITY} a day, with {DEFAULT_DIARY_RESERVE} held back. Change it for{' '}
        {user.name} only if they really differ.
      </p>

      {/* WRAPS RATHER THAN SCROLLS. Four controls and a figure fit one line on a desktop and fold
          to two on an iPad, which is the whole reason these are not columns on the table. */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <Field label="Rank" hint="which accounts">
          {canEdit ? (
            <select
              aria-label={`Rank for ${user.name}`}
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
        </Field>

        <Field label="Book ceiling" hint="accounts at once">
          <NumberCell value={user.bookCeiling} fallback={DEFAULT_BOOK_CEILING} canEdit={canEdit}
            label={`Book ceiling for ${user.name}`}
            min={MIN_BOOK_CEILING} max={MAX_BOOK_CEILING}
            onChange={(v) => onChange({ bookCeiling: v })} />
        </Field>

        <Field label="A day" hint="diary capacity">
          <NumberCell value={user.diaryCapacity} fallback={DEFAULT_DIARY_CAPACITY} canEdit={canEdit}
            label={`Diary capacity for ${user.name}`}
            min={MIN_DIARY_CAPACITY} max={MAX_DIARY_CAPACITY}
            onChange={(v) => onChange({ diaryCapacity: v })} />
        </Field>

        <Field label="Held back" hint={`books ${selfBookingLimit(capacity, reserve)} of ${capacity}`}>
          {/*
            The consequence, spelled out in the hint, because the number on its own means nothing.
            The reserve constrains what a clerk books for THEMSELVES; the distributor still fills
            the whole day, which is the only reason to hold slots back at all.
          */}
          <NumberCell value={user.diaryReserve} fallback={DEFAULT_DIARY_RESERVE} canEdit={canEdit}
            label={`Held back for ${user.name}`}
            min={0} max={Math.max(0, capacity - 1)}
            onChange={(v) => onChange({ diaryReserve: v })} />
        </Field>

        <Field label="Carrying now" hint={over ? 'over their ceiling' : 'in play'}>
          <span className="inline-flex items-center gap-1.5 text-sm tabular-nums h-[30px]">
            {inPlay === null ? (
              <Loader2 size={13} className="animate-spin text-slate-300" />
            ) : (
              <span className={over ? 'text-amber-700 font-medium' : 'text-slate-600'}>
                {inPlay.toLocaleString('en-ZA')} / {ceiling.toLocaleString('en-ZA')}
                {over && (
                  <span className="inline-flex items-center gap-1 ml-1.5"
                    title="Over their ceiling. They will be given little or nothing until it comes down.">
                    <AlertTriangle size={12} />
                    {(inPlay - ceiling).toLocaleString('en-ZA')} over
                  </span>
                )}
              </span>
            )}
          </span>
        </Field>
      </div>

      <p className="mt-3.5 text-xs text-slate-400">
        Rank decides <span className="font-medium text-slate-500">which</span> accounts somebody
        may be given, never how many — a junior and an elite carry the same book and differ only
        in what is on it. Generic work goes to anyone; high value from R25&nbsp;000 needs Skilled
        or better; major accounts from R50&nbsp;000 need Senior or Elite. Anything disputed, in
        legal or under administration counts as high value whatever it is worth.
      </p>
    </div>
  )
}

/** A labelled control, with the thing the label does not say underneath it. */
function Field({ label, hint, children }: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium text-slate-500 mb-1">{label}</div>
      {children}
      {/* nowrap: at three words the hint wrapped and made one control twice as tall as its
          neighbours, which read as a layout fault rather than as a longer sentence. */}
      <div className="text-[11px] text-slate-400 mt-1 whitespace-nowrap tabular-nums">{hint}</div>
    </div>
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
function NumberCell({ value, fallback, canEdit, label, min, max, onChange }: {
  value: number | undefined
  fallback: number
  canEdit: boolean
  label: string
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
      type="number" min={min} max={max} aria-label={label}
      className="w-24 text-sm text-slate-600 border border-slate-200 rounded-lg px-2 py-1 bg-white outline-none tabular-nums"
      placeholder={String(fallback)}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
    />
  )
}
