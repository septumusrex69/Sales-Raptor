import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Megaphone, Plus } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { CAMPAIGN_KIND_LABELS, SEND_FROM_LABELS, describeAudience, resultRates, type CampaignKind, type CampaignResults } from '../../lib/marketing.ts'
import { createCampaign, listCampaigns, listSenders, type CampaignRow, type ExtraSender } from '../../lib/marketingApi'
import { clockNow } from '../../lib/clock'
import { ImportListCard } from './ImportListCard'
import { UndeliveredCard } from './UndeliveredCard'
import { Figure, StatusPill, errorText } from './shared'

/**
 * EVERY CAMPAIGN, AND WHO IT WENT FROM (S13). Ryno: "a drop-down where I can select different email
 * addresses ... to view their previous campaigns and the full history of those campaigns." So the list
 * filters by sender, and each row says at a glance where it stands, when it went, to how many, and how
 * it did -- the open rate drawn as a bar, because a column of percentages is read one at a time.
 *
 * THE FILTER IS THE CAMPAIGN'S CHOICE (BF News, the liaisons, reports@, an extra address). One liaison's
 * own share of a liaison campaign is in that campaign's results, split by sender.
 */
type FromFilter = 'all' | 'news' | 'liaison' | 'reports' | `address:${string}` | 'prospect'

function fromLabel(c: CampaignRow, senders: Map<string, ExtraSender>): string {
  if (c.kind !== 'news') return 'The marketer'
  if (c.send_from === 'address') {
    const s = c.sender_address_id ? senders.get(c.sender_address_id) : null
    return s ? s.address : SEND_FROM_LABELS.address
  }
  return c.send_from === 'news' ? 'BF News' : c.send_from === 'reports' ? 'reports@' : 'Each liaison'
}

export function CampaignList() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<CampaignRow[] | null>(null)
  const [counts, setCounts] = useState<Map<string, CampaignResults>>(new Map())
  const [senders, setSenders] = useState<ExtraSender[]>([])
  const [from, setFrom] = useState<FromFilter>('all')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listCampaigns().then(({ campaigns, counts: c }) => { setRows(campaigns); setCounts(c) }).catch((e: unknown) => setError(errorText(e)))
    listSenders().then(setSenders).catch(() => setSenders([]))
  }, [])

  async function newCampaign(kind: CampaignKind) {
    setBusy(true)
    try {
      const month = clockNow().toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
      const name = kind === 'news' ? `Newsletter ${month}` : kind === 'introduction' ? `Introduction ${month}` : `Prospects ${month}`
      const c = await createCampaign(name, kind)
      navigate(`/news/${c.id}`)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  const byId = useMemo(() => new Map(senders.map((s) => [s.id, s])), [senders])
  const shown = (rows ?? []).filter((c) => {
    if (from === 'all') return true
    if (from === 'prospect') return c.kind !== 'news'
    if (c.kind !== 'news') return false
    if (from.startsWith('address:')) return c.send_from === 'address' && c.sender_address_id === from.slice(8)
    return c.send_from === from
  })
  /* THE FILTER'S OWN SUMMARY: what went from this sender, over the campaigns shown. */
  const gone = shown.filter((c) => c.status === 'sent' || c.status === 'sending')
  const sum = gone.reduce((a, c) => {
    const n = counts.get(c.id)
    return n ? { accepted: a.accepted + n.accepted, delivered: a.delivered + n.delivered, opened: a.opened + n.opened, unsubscribed: a.unsubscribed + n.unsubscribed } : a
  }, { accepted: 0, delivered: 0, opened: 0, unsubscribed: 0 })
  const openRate = sum.delivered ? Math.round((sum.opened / sum.delivered) * 1000) / 10 : null
  const usedAddresses = senders.filter((s) => (rows ?? []).some((c) => c.sender_address_id === s.id))
  const filters: { value: FromFilter; label: string }[] = [
    { value: 'all', label: 'Everything' }, { value: 'news', label: 'BF News' }, { value: 'liaison', label: 'Each liaison' }, { value: 'reports', label: 'reports@' },
    ...usedAddresses.map((s) => ({ value: `address:${s.id}` as FromFilter, label: s.address })),
    { value: 'prospect', label: 'Introductions & prospects' },
  ]
  const when = (c: CampaignRow) => {
    const iso = c.queued_at ?? (c.status === 'draft' ? c.updated_at : c.finished_at)
    return iso ? new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-500 flex-1 min-w-[16rem]">
          News for clients and leads, sent from the firm’s own records. Statements, reports and remittance advices are never sent from here, and an unsubscribe here does not stop them.
        </p>
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => void newCampaign('news')} disabled={busy} data-testid="news-new">New news campaign</Button>
        <Button icon={<Plus size={15} />} onClick={() => void newCampaign('introduction')} disabled={busy} data-testid="news-new-introduction">New introduction</Button>
        <Button icon={<Plus size={15} />} onClick={() => void newCampaign('prospect')} disabled={busy} data-testid="news-new-prospect">New prospect campaign</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium text-slate-500" htmlFor="news-from-filter">Sent from</label>
        <select id="news-from-filter" value={from} onChange={(e) => setFrom(e.target.value as FromFilter)} data-testid="news-from-filter"
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm">
          {filters.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>

      {gone.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2" data-testid="news-history-summary">
          <Figure label="Campaigns sent" value={gone.length} />
          <Figure label="Emails sent" value={sum.accepted.toLocaleString('en-ZA').replace(/ /g, ' ')} />
          <Figure label="Opened" value={openRate === null ? '—' : `${openRate}%`} sub="of delivered, approximately" />
          <Figure label="Unsubscribed" value={sum.unsubscribed} sub={sum.delivered ? `${Math.round((sum.unsubscribed / sum.delivered) * 1000) / 10}% of delivered` : undefined} />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Card padded={false}>
        {rows === null ? (
          <p className="p-5 text-sm text-slate-400">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500" data-testid="news-empty">
            <Megaphone className="mx-auto mb-2 text-slate-300" size={28} />
            No campaigns yet. Start one, choose who it goes to, and send yourself a test first.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="news-list">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-2.5 font-medium">Campaign</th>
                  <th className="px-4 py-2.5 font-medium">From</th>
                  <th className="px-4 py-2.5 font-medium">Where it stands</th>
                  <th className="px-4 py-2.5 font-medium text-right">Sent to</th>
                  <th className="px-4 py-2.5 font-medium text-right">Delivered</th>
                  <th className="px-4 py-2.5 font-medium min-w-[9rem]">Opened</th>
                  <th className="px-4 py-2.5 font-medium text-right">Unsubscribed</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const n = counts.get(c.id)
                  const r = n ? resultRates(n) : null
                  return (
                    <tr key={c.id} className="border-b border-slate-50 hover:bg-slate-50/60 align-top">
                      <td className="px-4 py-3">
                        <Link to={`/news/${c.id}`} className="font-medium text-slate-800 hover:text-brand-700">{c.name}</Link>
                        <div className="text-xs text-slate-400 truncate max-w-[22rem]">
                          {CAMPAIGN_KIND_LABELS[c.kind ?? 'news']} · {describeAudience(c.audience)}{c.subject ? ` · ${c.subject}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap" data-testid="news-row-from">{fromLabel(c, byId)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusPill status={c.status} />
                        <div className="text-xs text-slate-400 mt-0.5">{c.status === 'draft' ? `edited ${when(c)}` : when(c)}</div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {n ? `${n.accepted} of ${n.total}` : '—'}
                        {n && (n.bounced + n.complained + n.failed) > 0 && (
                          <div className="text-xs text-slate-400">{[n.failed && `${n.failed} failed`, n.bounced && `${n.bounced} didn’t arrive`, n.complained && `${n.complained} spam reports`].filter(Boolean).join(' · ')}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{n && n.accepted ? `${n.delivered}${r?.delivered !== null ? ` (${r?.delivered}%)` : ''}` : '—'}</td>
                      <td className="px-4 py-3">
                        {n && n.delivered && r?.opened !== null ? (
                          <div className="flex items-center gap-2" title={`${n.opened} of ${n.delivered} delivered`}>
                            <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-brand-500" style={{ width: `${Math.min(100, r?.opened ?? 0)}%` }} /></div>
                            <span className="tabular-nums text-slate-700 text-xs w-12 text-right">{r?.opened}%</span>
                          </div>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{n && n.delivered ? n.unsubscribed : '—'}</td>
                    </tr>
                  )
                })}
                {shown.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">Nothing has been sent from this yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ImportListCard />
        <UndeliveredCard />
      </div>
    </div>
  )
}
