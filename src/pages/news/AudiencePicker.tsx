import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/AppStore'
import { MultiSelectChips } from '../../components/ui/MultiSelectChips'
import { leadSources, services as SERVICES } from '../../data/mockData'
import { ACTIVE_LEAD_STATUSES, AUDIENCE_LABELS, DEFAULT_DORMANT_DAYS, LEAD_AUDIENCES, type Audience } from '../../lib/marketing.ts'
import { listLists, type MarketingList } from '../../lib/marketingApi'
import type { LeadStatus } from '../../types'
import { INPUT } from './shared'

/**
 * WHO A CAMPAIGN GOES TO: the rule, never a typed list. Moved out of NewsPage unchanged (S13); the
 * rule itself is resolveAudience, run on the server for the count and again for the send.
 */
const STATUSES: LeadStatus[] = ['No Contact Yet', 'Interested', 'Hot Lead', 'Rejected']

export function AudiencePicker({ audience, onChange, leadsOnly = false }: { audience: Audience; onChange: (a: Audience) => void; leadsOnly?: boolean }) {
  const pick = (kind: Audience['kind']) => {
    switch (kind) {
      case 'all_clients': onChange({ kind }); break
      case 'active_leads': onChange({ kind }); break
      case 'clients_by_service': onChange({ kind, services: [] }); break
      case 'dormant_leads': onChange({ kind, days: DEFAULT_DORMANT_DAYS, includeLost: true }); break
      case 'leads_by': onChange({ kind, statuses: [...ACTIVE_LEAD_STATUSES], sources: [] }); break
      case 'manual': onChange({ kind, picks: [] }); break
      case 'imported_list': onChange({ kind, listIds: [] }); break
    }
  }
  const kinds = (Object.keys(AUDIENCE_LABELS) as Audience['kind'][]).filter((k) => !leadsOnly || LEAD_AUDIENCES.includes(k))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="List">
        {kinds.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={audience.kind === k} onClick={() => pick(k)}
            data-testid={`news-audience-${k}`}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg border ${audience.kind === k ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            {AUDIENCE_LABELS[k]}
          </button>
        ))}
      </div>
      {audience.kind === 'all_clients' && <p className="text-xs text-slate-500">Every client’s own address and every contact on it or its sub-accounts. Clients are sent our news unless they have unsubscribed.</p>}
      {audience.kind === 'clients_by_service' && (
        <MultiSelectChips options={SERVICES} value={audience.services} onChange={(services) => onChange({ ...audience, services })} />
      )}
      {audience.kind === 'active_leads' && <p className="text-xs text-slate-500">Leads still open: {ACTIVE_LEAD_STATUSES.join(', ')}.</p>}
      {audience.kind === 'dormant_leads' && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
          <label className="flex items-center gap-2">
            Nothing done and no change of status for
            <input type="number" min={1} max={3650} value={audience.days} data-testid="news-dormant-days"
              onChange={(e) => onChange({ ...audience, days: Math.max(1, Math.round(Number(e.target.value) || DEFAULT_DORMANT_DAYS)) })}
              className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm" />
            days
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={audience.includeLost} onChange={(e) => onChange({ ...audience, includeLost: e.target.checked })} />
            Include lost leads (never the ones we declined)
          </label>
        </div>
      )}
      {audience.kind === 'leads_by' && (
        <div className="space-y-2">
          <div><span className="block text-xs text-slate-500 mb-1">Status</span><MultiSelectChips options={STATUSES} value={audience.statuses} onChange={(statuses) => onChange({ ...audience, statuses })} /></div>
          <div><span className="block text-xs text-slate-500 mb-1">Source (none chosen means any)</span><MultiSelectChips options={leadSources} value={audience.sources} onChange={(sources) => onChange({ ...audience, sources })} /></div>
        </div>
      )}
      {audience.kind === 'manual' && <ManualPicker audience={audience} onChange={onChange} />}
      {audience.kind === 'imported_list' && <ListPicker audience={audience} onChange={onChange} />}
    </div>
  )
}

function ManualPicker({ audience, onChange }: { audience: Extract<Audience, { kind: 'manual' }>; onChange: (a: Audience) => void }) {
  const { companies, contacts, leads } = useAppStore()
  const [q, setQ] = useState('')
  const options = useMemo(() => [
    ...companies.filter((c) => c.email).map((c) => ({ type: 'company' as const, id: c.id, label: c.name, email: c.email ?? '' })),
    ...contacts.filter((c) => c.email).map((c) => ({ type: 'contact' as const, id: c.id, label: `${c.firstName} ${c.lastName}`, email: c.email ?? '' })),
    ...leads.filter((l) => l.email && l.status !== 'Converted').map((l) => ({ type: 'lead' as const, id: l.id, label: `${l.firstName} ${l.lastName} · ${l.companyName}`, email: l.email ?? '' })),
  ], [companies, contacts, leads])
  const picked = new Set(audience.picks.map((p) => `${p.type}:${p.id}`))
  const needle = q.trim().toLowerCase()
  const found = needle ? options.filter((o) => `${o.label} ${o.email}`.toLowerCase().includes(needle) && !picked.has(`${o.type}:${o.id}`)).slice(0, 8) : []
  const labelOf = (p: { type: string; id: string }) => options.find((o) => o.type === p.type && o.id === p.id)
  return (
    <div className="space-y-2">
      <input className={INPUT} placeholder="Find a client, contact or lead…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="news-manual-search" />
      {found.length > 0 && (
        <ul className="border border-slate-100 rounded-lg divide-y divide-slate-100 text-sm">
          {found.map((o) => (
            <li key={`${o.type}:${o.id}`}>
              <button type="button" className="w-full text-left px-3 py-1.5 hover:bg-slate-50"
                onClick={() => { onChange({ ...audience, picks: [...audience.picks, { type: o.type, id: o.id }] }); setQ('') }}>
                {o.label} <span className="text-slate-400">{o.email} · {o.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5">
        {audience.picks.map((p) => (
          <span key={`${p.type}:${p.id}`} className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-700 rounded-md px-2 py-1">
            {labelOf(p)?.label ?? 'Removed record'}
            <button type="button" aria-label="Remove" className="text-slate-400 hover:text-slate-700"
              onClick={() => onChange({ ...audience, picks: audience.picks.filter((x) => !(x.type === p.type && x.id === p.id)) })}>×</button>
          </span>
        ))}
      </div>
      <p className="text-xs text-slate-500">A lead picked by hand still needs consent, or the first-approach box below.</p>
    </div>
  )
}

function ListPicker({ audience, onChange }: { audience: Extract<Audience, { kind: 'imported_list' }>; onChange: (a: Audience) => void }) {
  const [lists, setLists] = useState<MarketingList[] | null>(null)
  useEffect(() => { listLists().then(setLists).catch(() => setLists([])) }, [])
  if (lists === null) return <p className="text-xs text-slate-400">Loading lists…</p>
  if (!lists.length) return <p className="text-xs text-slate-500">No list has been imported yet. Import one on the campaigns page.</p>
  const picked = new Set(audience.listIds)
  return (
    <div className="space-y-1" data-testid="news-list-picker">
      {lists.map((l) => (
        <label key={l.id} className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={picked.has(l.id)}
            onChange={(e) => onChange({ ...audience, listIds: e.target.checked ? [...audience.listIds, l.id] : audience.listIds.filter((x) => x !== l.id) })} />
          {l.name} <span className="text-xs text-slate-400">{l.lead_count} leads · {new Date(l.uploaded_at).toLocaleDateString('en-ZA')}</span>
        </label>
      ))}
    </div>
  )
}
