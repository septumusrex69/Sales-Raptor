import { CheckCircle2, FileUp } from 'lucide-react'

/** One file to choose, showing what was chosen. Shared by every card on the Data Import tab. */
export function FilePicker({ label, hint, badge, file, onPick }: {
  label: string; hint: string; badge?: string; file?: File; onPick: (f: File) => void
}) {
  return (
    <label className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-brand-300 cursor-pointer">
      <input
        type="file"
        accept=".csv,.zip,.xlsx,.xlsm,text/csv,application/zip"
        className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f) }}
      />
      <span className={`shrink-0 w-8 h-8 rounded-lg grid place-items-center ${file ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
        {file ? <CheckCircle2 size={16} /> : <FileUp size={16} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-700">
          {label}
          {badge && (
            <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-brand-600 bg-brand-50 rounded-full px-1.5 py-0.5">
              {badge}
            </span>
          )}
        </span>
        <span className="block text-xs text-slate-400 truncate">
          {file ? `${file.name} · ${(file.size / 1e6).toFixed(1)} MB` : hint}
        </span>
      </span>
      <span className="text-xs font-medium text-brand-600 shrink-0">{file ? 'Change' : 'Choose'}</span>
    </label>
  )
}
