import { useEffect, useState } from 'react'
import { Card, CardHeader } from '../../components/ui/Card'
import { isFirmMainDomain, OPENS_ARE_APPROXIMATE, resultRates, type CampaignKind, type CampaignResults } from '../../lib/marketing.ts'
import {
  RECIPIENT_PAGE, campaignRecipients, campaignResults, campaignResultsBySender, type RecipientRow, type SenderResults,
} from '../../lib/marketingApi'
import { Choices, Figure, errorText } from './shared'

/**
 * RESULTS -- "the success of what's been delivered, what was undelivered, what was opened" (S10), and
 * per sender when it went from more than one (S13). While it is sending it refreshes on its own, so
 * the firm can watch it go out.
 *
 * WHAT IS NOT HERE, ON PURPOSE: "deleted before it was read". No mail system tells the sender that,
 * so a figure for it would be invented. And clicks are not counted on mail from bredellferreira.co.za
 * -- the administrator turned click tracking off there (28 Oct) -- which the panel says rather than
 * showing a zero that reads as "nobody clicked".
 */

const STATE_WORDS: Record<RecipientRow['state'], string> = {
  queued: 'Waiting', sending: 'Sending', sent: 'Sent', failed: 'Failed', skipped: 'Not sent', bounced: 'Didn’t arrive', complained: 'Marked as spam',
}

type RecipientFilter = 'all' | 'undelivered' | 'opened' | 'unopened' | 'clicked'

export function ResultsPanel({ campaignId, kind, live }: { campaignId: string; kind: CampaignKind; live: boolean }) {
  const [results, setResults] = useState<CampaignResults | null>(null)
  const [bySender, setBySender] = useState<SenderResults[]>([])
  const [rows, setRows] = useState<RecipientRow[] | null>(null)
  const [filter, setFilter] = useState<RecipientFilter>('all')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => Promise.all([campaignResults(campaignId), campaignRecipients(campaignId), campaignResultsBySender(campaignId).catch(() => [])])
      .then(([r, list, split]) => { if (alive) { setResults(r); setRows(list); setBySender(split) } })
      .catch((e: unknown) => { if (alive) setError(errorText(e)) })
    void load()
    /* While it is sending, and for a while after, the webhook keeps filling these in. */
    const t = live ? window.setInterval(() => void load(), 15_000) : undefined
    return () => { alive = false; if (t) window.clearInterval(t) }
  }, [campaignId, live])
  if (error) return <Card><p className="text-sm text-red-600">{error}</p></Card>
  if (!results || !rows) return <Card><p className="text-sm text-slate-400">Loading results…</p></Card>
  const rates = resultRates(results)
  const notOpened = Math.max(0, results.delivered - results.opened)
  const pct = (r: number | null, of: string) => (r === null ? '—' : `${r}% ${of}`)
  const firmDomain = bySender.some((s) => isFirmMainDomain(s.sender))
  const shown = rows.filter((r) => filter === 'all'
    || (filter === 'undelivered' && ['bounced', 'failed', 'skipped'].includes(r.state))
    || (filter === 'opened' && !!r.first_opened_at)
    || (filter === 'unopened' && !r.first_opened_at && r.state === 'sent')
    || (filter === 'clicked' && !!r.first_clicked_at))
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
  const sentShare = results.total ? Math.round((results.accepted / results.total) * 100) : 0
  return (
    <Card>
      <div data-testid="news-results">
        <CardHeader title="What happened to it"
          subtitle={`Of ${results.total} on the list${results.queued ? `, ${results.queued} not sent yet` : ''}${results.skipped ? `, ${results.skipped} not sent (unsubscribed or no longer allowed)` : ''}${results.failed ? `, ${results.failed} failed` : ''}.`}
          action={live ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-gold-800 bg-gold-100 rounded-full px-2 py-0.5" data-testid="news-results-live">
              <span className="h-1.5 w-1.5 rounded-full bg-gold-500 animate-pulse" /> Live, every 15 seconds
            </span>
          ) : undefined} />
        {live && results.total > 0 && (
          <div className="mb-3" data-testid="news-progress">
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-brand-500 transition-all" style={{ width: `${sentShare}%` }} /></div>
            <p className="text-xs text-slate-500 mt-1">{results.accepted} of {results.total} sent</p>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Figure label="Sent" value={results.accepted} testid="news-result-sent" />
          <Figure label="Delivered" value={results.delivered} sub={pct(rates.delivered, 'of sent')} testid="news-result-delivered" tone="good" />
          <Figure label="Didn’t arrive" value={results.bounced} sub={pct(rates.bounced, 'of sent')} testid="news-result-bounced" tone={results.bounced ? 'bad' : 'default'} />
          <Figure label="Opened" value={results.opened} sub={pct(rates.opened, 'of delivered')} testid="news-result-opened" />
          <Figure label="Not opened" value={notOpened} sub={results.delivered ? `${Math.round((notOpened / results.delivered) * 1000) / 10}% of delivered` : '—'} testid="news-result-unopened" />
          <Figure label="Clicked" value={results.clicked} sub={pct(rates.clicked, 'of delivered')} testid="news-result-clicked" />
          <Figure label="Unsubscribed" value={results.unsubscribed} sub={pct(rates.unsubscribed, 'of delivered')} testid="news-result-unsubscribed" />
          <Figure label="Marked as spam" value={results.complained} sub={pct(rates.complained, 'of delivered')} testid="news-result-complained" tone={results.complained ? 'bad' : 'default'} />
          {kind === 'introduction' && <Figure label="Opted in" value={results.opted_in} sub={pct(rates.optedIn, 'of delivered')} testid="news-result-opted-in" tone="good" />}
        </div>
        <p className="mt-3 text-xs text-slate-500" data-testid="news-opens-note">{OPENS_ARE_APPROXIMATE}{firmDomain && ' Clicks are not counted on mail sent from bredellferreira.co.za: click tracking is off on that domain.'}
        </p>
        {results.delayed > 0 && <p className="mt-1 text-xs text-slate-500">{results.delayed} delayed: the receiving server has not taken them yet, and Resend is still trying.</p>}

        {bySender.length > 1 && (
          <div className="mt-4" data-testid="news-results-by-sender">
            <h4 className="text-xs font-medium text-slate-500 mb-1">By sender</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                    <th className="px-2 py-1.5 font-medium">From</th>
                    <th className="px-2 py-1.5 font-medium text-right">Sent</th>
                    <th className="px-2 py-1.5 font-medium text-right">Delivered</th>
                    <th className="px-2 py-1.5 font-medium text-right">Opened</th>
                    <th className="px-2 py-1.5 font-medium text-right">Clicked</th>
                    <th className="px-2 py-1.5 font-medium text-right">Unsubscribed</th>
                  </tr>
                </thead>
                <tbody>
                  {bySender.map((s) => {
                    const r = resultRates(s)
                    return (
                      <tr key={s.sender} className="border-b border-slate-50">
                        <td className="px-2 py-1.5 text-slate-800">{s.sender || 'news@'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{s.accepted}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{s.delivered}{r.delivered !== null && <span className="text-xs text-slate-400"> {r.delivered}%</span>}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{s.opened}{r.opened !== null && <span className="text-xs text-slate-400"> {r.opened}%</span>}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{isFirmMainDomain(s.sender) ? <span className="text-xs text-slate-400">not counted</span> : s.clicked}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{s.unsubscribed}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mt-5">
          <Choices<RecipientFilter> label="Show" value={filter} onChange={setFilter} testid="news-recipients"
            options={[{ value: 'all', label: 'Everybody' }, { value: 'undelivered', label: 'Not delivered' }, { value: 'opened', label: 'Opened' },
              { value: 'unopened', label: 'Not opened' }, { value: 'clicked', label: 'Clicked' }]} />
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm" data-testid="news-recipients">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="px-2 py-1.5 font-medium">Who</th>
                <th className="px-2 py-1.5 font-medium">Where it stands</th>
                <th className="px-2 py-1.5 font-medium">Delivered</th>
                <th className="px-2 py-1.5 font-medium">Opened</th>
                <th className="px-2 py-1.5 font-medium">Clicked</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="px-2 py-1.5"><div className="text-slate-800">{r.email}</div><div className="text-xs text-slate-400">{[r.first_name, r.company_name].filter(Boolean).join(' · ')}</div></td>
                  <td className="px-2 py-1.5 text-slate-600">
                    {STATE_WORDS[r.state]}
                    {r.opted_in_at && <span className="ml-1 text-xs text-emerald-700">· said yes</span>}
                    {r.unsubscribed_at && <span className="ml-1 text-xs text-slate-500">· unsubscribed</span>}
                    {r.error && r.state !== 'sent' && <div className="text-xs text-slate-400">{r.error}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-slate-500">{day(r.delivered_at)}</td>
                  <td className="px-2 py-1.5 text-xs text-slate-500">{r.first_opened_at ? `${day(r.first_opened_at)}${r.open_count > 1 ? ` · ${r.open_count}×` : ''}` : ''}</td>
                  <td className="px-2 py-1.5 text-xs text-slate-500">{r.first_clicked_at ? `${day(r.first_clicked_at)}${r.click_count > 1 ? ` · ${r.click_count}×` : ''}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length >= RECIPIENT_PAGE && <p className="text-xs text-slate-400 mt-1">The first {RECIPIENT_PAGE} by address. The counts above are the whole campaign.</p>}
        </div>
      </div>
    </Card>
  )
}
