import clsx from 'clsx'

export type CompareMode = 'previous' | 'none'

export function CompareSelector({
  value,
  onChange,
  variant = 'light',
}: {
  value: CompareMode
  onChange: (mode: CompareMode) => void
  /** 'dark' = translucent "glass" styling for use on a dark/gradient background (e.g. the Dashboard hero). */
  variant?: 'light' | 'dark'
}) {
  const dark = variant === 'dark'
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CompareMode)}
      className={clsx('text-sm rounded-lg px-3 py-2 outline-none border', dark ? 'bg-white/10 border-white/20 text-white' : 'bg-white border-slate-200 text-slate-700')}
    >
      <option value="previous" className="text-slate-700">
        Compare: Previous Period
      </option>
      <option value="none" className="text-slate-700">
        Compare: None
      </option>
    </select>
  )
}
