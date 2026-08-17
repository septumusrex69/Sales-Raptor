export function MultiSelectChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[]
  value: T[]
  onChange: (next: T[]) => void
}) {
  function toggle(option: T) {
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option])
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = value.includes(option)
        return (
          <button
            key={option}
            type="button"
            onClick={() => toggle(option)}
            aria-pressed={active}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
              active ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}
