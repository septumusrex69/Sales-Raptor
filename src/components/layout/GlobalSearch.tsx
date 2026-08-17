import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import { formatLeadNumber } from '../../data/mockData'
import { useAppStore } from '../../store/AppStore'

interface Result {
  id: string
  label: string
  sub: string
  path: string
  kind: string
}

export function GlobalSearch() {
  const { leads, contacts, companies, deals } = useAppStore()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const out: Result[] = []
    for (const l of leads) {
      const label = `${l.firstName} ${l.lastName}`
      const leadNumber = formatLeadNumber(l.leadNumber)
      if (label.toLowerCase().includes(q) || l.companyName.toLowerCase().includes(q) || leadNumber.toLowerCase().includes(q)) {
        out.push({ id: l.id, label, sub: `Lead ${leadNumber} · ${l.companyName}`, path: `/leads/${l.id}`, kind: 'Lead' })
      }
    }
    for (const c of contacts) {
      const label = `${c.firstName} ${c.lastName}`
      if (label.toLowerCase().includes(q)) {
        out.push({ id: c.id, label, sub: `Contact · ${c.jobTitle ?? ''}`, path: `/contacts/${c.id}`, kind: 'Contact' })
      }
    }
    for (const co of companies) {
      if (co.name.toLowerCase().includes(q)) {
        out.push({ id: co.id, label: co.name, sub: `Company · ${co.industry ?? ''}`, path: `/companies/${co.id}`, kind: 'Company' })
      }
    }
    for (const d of deals) {
      if (d.name.toLowerCase().includes(q)) {
        out.push({ id: d.id, label: d.name, sub: `Deal · ${d.stage}`, path: `/deals/${d.id}`, kind: 'Deal' })
      }
    }
    return out.slice(0, 8)
  }, [query, leads, contacts, companies, deals])

  return (
    <div ref={ref} className="relative w-full max-w-sm">
      <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-brand-500/40">
        <Search size={16} className="text-slate-400 shrink-0" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search leads, contacts, companies, deals..."
          className="bg-transparent text-sm outline-none flex-1 min-w-0 placeholder:text-slate-400"
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        )}
      </div>
      {open && query && (
        <div className="absolute top-full mt-2 left-0 right-0 bg-white rounded-xl shadow-lg border border-slate-100 py-2 z-50 max-h-96 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-400">No results for "{query}"</p>
          ) : (
            results.map((r) => (
              <button
                key={`${r.kind}-${r.id}`}
                onClick={() => {
                  navigate(r.path)
                  setOpen(false)
                  setQuery('')
                }}
                className="w-full text-left px-4 py-2 hover:bg-slate-50 flex items-center justify-between gap-2"
              >
                <span className="text-sm font-medium text-slate-700">{r.label}</span>
                <span className="text-xs text-slate-400">{r.sub}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
