export type CompareMode = 'previous' | 'none'

export function CompareSelector({ value, onChange }: { value: CompareMode; onChange: (mode: CompareMode) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CompareMode)}
      className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 outline-none"
    >
      <option value="previous">Compare: Previous Period</option>
      <option value="none">Compare: None</option>
    </select>
  )
}
