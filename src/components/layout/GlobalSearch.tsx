import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import { formatLeadNumber } from '../../data/mockData'
import { useAppStore } from '../../store/AppStore'
import { departmentOf, matchesPerson } from '../../lib/departments'
import { asksTheBook, matchesAny, SEARCH_PAUSE_MS } from '../../lib/globalSearch'
import { supabase } from '../../lib/supabase'

/* What the database's global_search returns for the debtor book, tickets and requests. */
const BOOK_KIND: Record<string, string> = { account: 'Account', ticket: 'Ticket', request: 'Request' }

interface Result {
  id: string
  label: string
  sub: string
  path: string
  kind: string
}

export function GlobalSearch() {
  const { leads, contacts, companies, deals, users, teams } = useAppStore()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  /* THE BOOK, asked for in the database after a short pause -- see lib/globalSearch.ts. */
  const [book, setBook] = useState<Result[]>([])
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    const q = query.trim()
    setBook([])
    if (!asksTheBook(q)) { setSearching(false); return }
    setSearching(true)
    let live = true
    const timer = window.setTimeout(() => {
      void (async () => {
        const { data, error } = await supabase.rpc('global_search', { p_q: q, p_limit: 8 })
        /* Only the newest answer is drawn: a slow reply to "smi" must not replace the one for "smith". */
        if (!live) return
        setSearching(false)
        if (error) { console.error('[GlobalSearch]', error.message); return }
        setBook(((data ?? []) as { kind: string; id: string; label: string; sub: string; path: string }[])
          .map((r) => ({ id: r.id, label: r.label, sub: r.sub, path: r.path, kind: BOOK_KIND[r.kind] ?? r.kind })))
      })()
    }, SEARCH_PAUSE_MS)
    return () => { live = false; window.clearTimeout(timer) }
  }, [query])
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
      if (matchesAny([label, l.companyName, leadNumber, l.email, l.phone, l.mobile, l.website], q)) {
        out.push({ id: l.id, label, sub: `Lead ${leadNumber} · ${l.companyName}`, path: `/leads/${l.id}`, kind: 'Lead' })
      }
    }
    for (const c of contacts) {
      const label = `${c.firstName} ${c.lastName}`
      if (matchesAny([label, c.email, c.phone, c.mobile], q)) {
        out.push({ id: c.id, label, sub: `Contact · ${c.jobTitle ?? ''}`, path: `/contacts/${c.id}`, kind: 'Contact' })
      }
    }
    for (const co of companies) {
      if (matchesAny([co.name, co.code, co.email, co.phone, co.website], q)) {
        out.push({ id: co.id, label: co.name, sub: `Client${co.code ? ` ${co.code}` : ''}${co.industry ? ` · ${co.industry}` : ''}`, path: `/companies/${co.id}`, kind: 'Client' })
      }
    }
    for (const d of deals) {
      if (d.name.toLowerCase().includes(q)) {
        out.push({ id: d.id, label: d.name, sub: `Deal · ${d.stage}`, path: `/deals/${d.id}`, kind: 'Deal' })
      }
    }
    /*
     * AND THE PEOPLE WHO WORK HERE. The firm, standing on the Users screen: "we're searching only
     * for other stuff -- it should be for users."
     *
     * MATCHED BY THE SAME RULE the Users screen uses, so a search that finds somebody here finds
     * them there too. Written twice they drift, and the one nobody tests is the one that stops
     * matching on team.
     *
     * IT LANDS ON THE LIST, ALREADY NARROWED. There is no page for one person, and sending
     * somebody to a screen of a hundred rows having just picked one of them would be a worse
     * answer than none -- so the result carries ?q= and the Users screen opens filtered to them.
     *
     * PEOPLE WHO HAVE LEFT ARE NOT OFFERED. Their record is kept so old work still has a name on
     * it; it is not somebody you are trying to reach.
     */
    for (const u of users) {
      if (u.status === 'Inactive') continue
      const team = teams.find((t) => t.id === u.teamId)?.name ?? null
      if (matchesPerson(u, team, q)) {
        out.push({
          id: u.id,
          label: u.name,
          sub: `${u.role}${team ? ` · ${team}` : ''}`,
          path: `/settings?tab=Users&q=${encodeURIComponent(u.name)}`,
          kind: departmentOf(u.role),
        })
      }
    }
    return out.slice(0, 8)
  }, [query, leads, contacts, companies, deals, users, teams])
  /* The book first: a debtor, a ticket or a request is what most searches in this firm are for. */
  const shown = useMemo(() => [...book, ...results], [book, results])

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
          placeholder="Search debtors, clients, people, numbers, references, tickets…"
          data-testid="global-search"
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
          {shown.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-400">{searching ? 'Searching…' : `No results for "${query}"`}</p>
          ) : (
            shown.map((r) => (
              <button
                key={`${r.kind}-${r.id}`}
                onClick={() => {
                  navigate(r.path)
                  setOpen(false)
                  setQuery('')
                }}
                className="w-full text-left px-4 py-2 hover:bg-slate-50 flex items-center justify-between gap-2"
                data-testid="global-search-result" data-kind={r.kind}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-700 truncate">{r.label}</span>
                  <span className="block text-xs text-slate-400 truncate">{r.sub}</span>
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">{r.kind}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
