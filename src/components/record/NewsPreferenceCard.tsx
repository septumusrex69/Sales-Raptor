import { useCallback, useEffect, useState } from 'react'
import { Card, CardHeader } from '../ui/Card'
import { Button } from '../ui/Button'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { formatDate } from '../../data/mockData'
import { normaliseEmail } from '../../lib/marketing.ts'
import { preferencesFor, recordPreference, type PreferenceRow } from '../../lib/marketingApi'
import type { Company, Lead } from '../../types'
import { clockNow } from '../../lib/clock'
import { supabase } from '../../lib/supabase'
import { mayChangeClientNews, newsResumePatch, newsStopPatch, newsStoppedBy, newsStoppedLine } from '../../lib/clientNews'

/**
 * NEWS, ON THE RECORD (S10): whether this client, contact or lead's address has said stop, and --
 * on a lead -- whether they have said yes.
 *
 * "Unsubscribed from news on <date>" is shown where people look, so nobody rings to ask why the
 * newsletter stopped arriving without the answer in front of them. A re-subscription is something
 * the PERSON asked for, and recording it on their behalf overrides an objection POPIA s69 protects,
 * so it asks for a reason and keeps it (marketing_preferences_resubscribe_says_why refuses one
 * without). An unsubscribe a person phones in is recorded the same way, and needs no reason.
 *
 * Statements, reports and remittance advices are not news and are never stopped by any of this.
 *
 * `client` (S12, clientNews.ts) is the client this record belongs to. On the client's own page the
 * card offers the CLIENT-WIDE unsubscribe -- every address of the client, its people and its
 * sub-accounts; on a contact's page it only says so when the client has recorded it.
 */
export function NewsPreferenceCard({ emails, lead, client, own = false }: {
  emails: (string | undefined)[]; lead?: Lead; client?: Company; own?: boolean
}) {
  const { companies } = useAppStore()
  const coveredBy = client ? newsStoppedBy(client.id, companies) : null
  const list = [...new Set(emails.map(normaliseEmail).filter(Boolean))]
  const key = list.join(',')
  const [prefs, setPrefs] = useState<Map<string, PreferenceRow> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState<{ email: string; subscribe: boolean } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    preferencesFor(key ? key.split(',') : []).then(setPrefs).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [key])
  useEffect(() => { load() }, [load])

  async function record() {
    if (!asking) return
    setBusy(true); setError(null)
    try {
      await recordPreference(asking.email, asking.subscribe, reason)
      setAsking(null); setReason('')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!list.length && !lead && !(client && (coveredBy || own))) return null
  return (
    <Card>
      <div data-testid="news-preference">
        <CardHeader title="News" subtitle="Our newsletter and campaigns only — never statements or reports." />
        {lead && <LeadConsent lead={lead} />}
        {client && <ClientNews client={client} coveredBy={coveredBy} own={own} />}
        {list.length === 0 && <p className="text-sm text-slate-400">No email address on file.</p>}
        <ul className="space-y-2.5">
          {list.map((email) => {
            const p = prefs?.get(email)
            const stopped = p && p.status !== 'subscribed'
            /* Covered by the client's no-news: the address's own record is still shown and kept. */
            return (
              <li key={email} className="text-sm">
                <p className="text-slate-700 break-all">{email}</p>
                {prefs === null ? <p className="text-xs text-slate-400">…</p> : coveredBy && !stopped ? (
                  <p className="text-xs text-red-700" data-testid="news-covered-by-client">No news: the client unsubscribed</p>
                ) : stopped ? (
                  <p className="text-xs text-red-700" data-testid="news-unsubscribed">
                    {p.status === 'undeliverable' ? 'Undeliverable — bounced' : 'Unsubscribed from news'} on {formatDate(p.changed_at)}
                    {p.how === 'complaint' ? ' (reported our email as spam)' : p.how === 'recorded by staff' ? ` (recorded by staff${p.reason ? `: ${p.reason}` : ''})` : ''}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">
                    Receives our news{p?.how === 'recorded by staff' && p.reason ? ` — re-subscribed on ${formatDate(p.changed_at)}: ${p.reason}` : ''}
                  </p>
                )}
                {prefs !== null && !(coveredBy && !stopped) && (
                  <button type="button" className="text-xs text-brand-700 hover:underline mt-0.5"
                    onClick={() => { setAsking({ email, subscribe: !!stopped }); setReason('') }}
                    data-testid={stopped ? 'news-resubscribe' : 'news-record-unsubscribe'}>
                    {stopped ? 'Record a re-subscription' : 'Record that they asked to stop'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        {asking && (
          <div className="mt-3 rounded-lg border border-slate-200 p-3 space-y-2">
            <p className="text-sm text-slate-700">
              {asking.subscribe
                ? `They asked to receive our news again. Say how and when — this overrides their unsubscribe.`
                : `They asked us to stop sending news to ${asking.email}.`}
            </p>
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={asking.subscribe ? 'e.g. Asked on a call with Nicole, 21 Oct' : 'Optional: how they asked'} data-testid="news-reason" />
            <div className="flex gap-2">
              <Button size="sm" variant="primary" disabled={busy || (asking.subscribe && !reason.trim())} onClick={() => void record()} data-testid="news-record">
                Record it
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>
    </Card>
  )
}

/**
 * THE WHOLE CLIENT, NO NEWS (S12, clientNews.ts). On the client's own page: the line, and recording
 * it or a re-subscription (which asks why -- the database refuses one without). Elsewhere, and for
 * anybody the companies_update policy would refuse, only the line.
 */
function ClientNews({ client, coveredBy, own }: { client: Company; coveredBy: Company | null; own: boolean }) {
  const { users, showCompanyChange } = useAppStore()
  const { currentUser } = useAuth()
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const may = own && mayChangeClientNews(currentUser, client)
  /* A sub-account covered by its parent is changed on the parent's page, where the objection sits. */
  const inherited = coveredBy && coveredBy.id !== client.id
  const stopped = !!coveredBy
  const nameOf = (id?: string | null) => (id ? users.find((u) => u.id === id)?.name ?? null : null)

  async function write() {
    const at = clockNow().toISOString()
    const patch = stopped ? newsResumePatch(reason, currentUser?.id ?? null, at) : newsStopPatch(reason, currentUser?.id ?? null, at)
    setBusy(true); setError(null)
    const { error: e } = await supabase.from('companies').update(patch).eq('id', client.id)
    setBusy(false)
    if (e) { setError(e.message); return }
    showCompanyChange(client.id, stopped
      ? { newsStoppedAt: null, newsStoppedReason: null, newsStoppedBy: null, newsResumedAt: at, newsResumedReason: reason.trim(), newsResumedBy: currentUser?.id ?? null }
      : { newsStoppedAt: at, newsStoppedReason: reason.trim() || null, newsStoppedBy: currentUser?.id ?? null })
    setAsking(false); setReason('')
  }

  if (!stopped && !may) return null
  return (
    <div className="mb-3 text-sm" data-testid="client-news">
      {stopped ? (
        <p className="text-red-700" data-testid="client-news-stopped">
          {newsStoppedLine(coveredBy, nameOf(coveredBy.newsStoppedBy), !inherited && own)}
        </p>
      ) : client.newsResumedAt ? (
        <p className="text-xs text-slate-500">Re-subscribed on {formatDate(client.newsResumedAt)}{client.newsResumedReason ? `: ${client.newsResumedReason}` : ''}</p>
      ) : null}
      {may && !inherited && !asking && (
        <button type="button" className="text-xs text-brand-700 hover:underline mt-0.5" onClick={() => { setAsking(true); setReason('') }}
          data-testid={stopped ? 'client-news-resume' : 'client-news-stop'}>
          {stopped ? 'Record a re-subscription for the whole client' : 'Unsubscribe this client from our news'}
        </button>
      )}
      {asking && (
        <div className="mt-2 rounded-lg border border-slate-200 p-3 space-y-2">
          <p className="text-sm text-slate-700">
            {stopped
              ? 'The client asked to receive our news again. Say how and when — this overrides their unsubscribe.'
              : 'No newsletter or campaign will go to this client, any of its people or its sub-accounts. Statements, reports and notices still go.'}
          </p>
          <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
            placeholder={stopped ? 'e.g. Asked on a call with Nicole, 21 Oct' : 'Optional: how they asked'} data-testid="client-news-reason" />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={busy || (stopped && !reason.trim())} onClick={() => void write()} data-testid="client-news-record">
              Record it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}

/**
 * "MAY WE SEND YOU NEWS?" -- a lead is not a customer, so POPIA s69 needs their yes before news goes
 * to them, beyond the one first approach a campaign may make to ask. Recorded with how they said it.
 */
function LeadConsent({ lead }: { lead: Lead }) {
  const { updateLead } = useAppStore()
  const { currentUser } = useAuth()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  if (lead.marketingConsentAt) {
    return (
      <div className="mb-3 text-sm" data-testid="news-consent">
        <p className="text-emerald-700">Said yes to our news on {formatDate(lead.marketingConsentAt)}{lead.marketingConsentNote ? ` — ${lead.marketingConsentNote}` : ''}</p>
        <button type="button" className="text-xs text-slate-500 hover:underline"
          onClick={() => updateLead(lead.id, { marketingConsentAt: undefined, marketingConsentNote: undefined, marketingConsentBy: undefined })}>
          They withdrew it
        </button>
      </div>
    )
  }
  return (
    <div className="mb-3 text-sm" data-testid="news-consent">
      <p className="text-slate-500">No consent to news recorded. Campaigns reach this lead only through one introduction email, ever, asking whether they would like to hear from us.</p>
      {!open ? (
        <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setOpen(true)} data-testid="news-consent-record">
          Record that they said yes
        </button>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <input className="flex-1 min-w-[12rem] rounded-lg border border-slate-200 px-3 py-1.5 text-sm" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="How they said it, e.g. on a call, 21 Oct" data-testid="news-consent-note" />
          <Button size="sm" variant="primary" disabled={!note.trim()} data-testid="news-consent-save"
            onClick={() => {
              updateLead(lead.id, { marketingConsentAt: clockNow().toISOString(), marketingConsentNote: note.trim(), marketingConsentBy: currentUser?.id })
              setOpen(false)
            }}>
            Save
          </Button>
        </div>
      )}
    </div>
  )
}
