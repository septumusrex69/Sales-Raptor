export const ROW_LIMIT_OPTIONS = [5, 10, 20, 30, 50, 'All'] as const
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

/**
 * The same page of rows, plus one specific row that has to be on it.
 *
 * Following a link to a particular message and landing on a list that has trimmed it off is
 * indistinguishable from the link being broken. Whatever is being pointed at is kept, in its
 * proper place in the order, however far down it would otherwise fall.
 */
export function applyRowLimitKeeping<T extends { id: string }>(rows: T[], limit: RowLimit, keepId?: string | null): T[] {
  const limited = applyRowLimit(rows, limit)
  if (!keepId || limited.some((r) => r.id === keepId)) return limited
  const kept = rows.find((r) => r.id === keepId)
  if (!kept) return limited
  return [...limited, kept].sort((a, b) => rows.indexOf(a) - rows.indexOf(b))
}
