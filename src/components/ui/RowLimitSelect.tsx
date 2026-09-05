export const ROW_LIMIT_OPTIONS = [10, 20, 30, 50, 'All'] as const
export type RowLimit = (typeof ROW_LIMIT_OPTIONS)[number]

export function RowLimitSelect({ value, onChange }: { value: RowLimit; onChange: (v: RowLimit) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange((e.target.value === 'All' ? 'All' : Number(e.target.value)) as RowLimit)}
      className="text-xs text-slate-500 border border-slate-200 rounded-lg px-2 py-1 bg-white outline-none"
    >
      {ROW_LIMIT_OPTIONS.map((n) => (
        <option key={n} value={n}>
          Show {n}
        </option>
      ))}
    </select>
  )
}

export function applyRowLimit<T>(rows: T[], limit: RowLimit): T[] {
  return limit === 'All' ? rows : rows.slice(0, limit)
}
