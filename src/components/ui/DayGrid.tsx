/**
 * SEVEN COLUMNS, A NUMBER UNDER EACH DATE.
 *
 * ONE GRID, TWO THINGS COUNTED ON IT. The diary counts accounts against the firm's 50-a-day;
 * a task picker counts the meetings and tasks already on a day and judges nothing. The ARITHMETIC
 * is different and stays apart -- diaryPriority owns one, dayPlan owns the other -- but the grid
 * itself is the same control, and DiaryDatePicker already says why that matters: "same calendar
 * either way, because two calendars drift apart inside a month". Written twice, one of them
 * eventually starts its week on Sunday, or disables a holiday the other allows, and somebody using
 * both in one afternoon has to re-learn where Saturday is.
 *
 * SO THIS DRAWS AND DECIDES NOTHING. Every cell is handed to it: what number to show, how to
 * colour it, whether it can be pressed and what the tooltip says. A grid that knew about capacity
 * would be a grid with the diary's policy inside it, and the task picker would inherit a ceiling
 * the firm has never been asked for.
 */

/** What one square shows. Decided by the caller — see the header. */
export interface DayCell {
  /**
   * The number under the date.
   *
   * ZERO IS SHOWN AS A DASH, NOT HIDDEN -- the count is the point of the control, and a column of
   * numbers that appears and disappears is harder to scan than one with a dash in it. Null is for
   * a picker with no count at all (a reminder books nothing, so a number there would be a lie).
   */
  count: number | null
  /**
   * WHAT GOES UNDER THE DATE INSTEAD, where one number cannot say it.
   *
   * THE FIRM, booking a task: "you can see what other tasks you have left to do, but you can't see
   * meetings. There should be two little numbers at the bottom, possibly with different colours --
   * because if you want to book something: oh, I've got five meetings that day, how many tasks are
   * you going to do?"
   *
   * They are right and one figure cannot carry it: five meetings and one task is a day that is
   * gone, one meeting and five tasks is a day with room in it, and both of them read as "6".
   *
   * A NODE RATHER THAN A SECOND NUMBER FIELD, because this file draws and decides nothing -- see
   * the header. The diary has one count against a capacity; the task picker has two against no
   * capacity at all; a grid that knew the difference would be a grid with both policies in it.
   */
  footer?: React.ReactNode
  /** Classes for a choosable cell: border, background, text, hover. */
  tone: string
  disabled: boolean
  /** The whole sentence, including the date — a tooltip that says only "full" is no help. */
  title: string
}

/* Monday first, like the diary's grid and like the way the firm writes a week. */
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export function DayGrid({ days, value, cellFor, onChange }: {
  /** 'YYYY-MM-DD', week-aligned and a multiple of seven long. */
  days: string[]
  /** The chosen day, or '' where nothing is chosen yet. */
  value: string
  cellFor: (day: string) => DayCell
  onChange: (day: string) => void
}) {
  return (
    <>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 text-center">
            {d}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((date) => {
          const cell = cellFor(date)
          const selected = date === value
          return (
            <button
              key={date}
              type="button"
              disabled={cell.disabled}
              onClick={() => onChange(date)}
              title={cell.title}
              className={[
                'rounded-lg border px-1 py-1.5 text-center transition-colors',
                cell.disabled
                  ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed'
                  : cell.tone,
                selected ? 'ring-2 ring-navy-900 ring-offset-1' : '',
              ].join(' ')}
            >
              <span className="block text-sm font-semibold leading-none">{Number(date.slice(8, 10))}</span>
              {cell.footer !== undefined ? (
                <span className="block text-[10px] leading-none mt-1 tabular-nums">
                  {cell.disabled ? '·' : cell.footer}
                </span>
              ) : cell.count !== null && (
                <span className="block text-[10px] leading-none mt-1 tabular-nums">
                  {cell.disabled ? '·' : cell.count || '–'}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}
