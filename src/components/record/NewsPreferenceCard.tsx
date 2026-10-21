import { useCallback, useEffect, useState } from 'react'
import { Card, CardHeader } from '../ui/Card'
import { Button } from '../ui/Button'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { formatDate } from '../../data/mockData'
import { normaliseEmail } from '../../lib/marketing.ts'
import { preferencesFor, recordPreference, type PreferenceRow } from '../../lib/marketingApi'
import type { Lead } from '../../types'
import { clockNow } from '../../lib/clock'

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
 */
export function NewsPreferenceCard({ emails, lead }: { emails: (string | undefined)[]; lead?: Lead }) {
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

  if (!list.length && !lead) return null
  return (
    <Card>
      <div data-testid="news-preference">
        <CardHeader title="News" subtitle="Our newsletter and campaigns only — never statements or reports." />
        {lead && <LeadConsent lead={lead} />}
        {list.length === 0 && <p className="text-sm text-slate-400">No email address on file.</p>}
        <ul className="space-y-2.5">
          {list.map((email) => {
            const p = prefs?.get(email)
            const stopped = p && p.status !== 'subscribed'
            return (
              <li key={email} className="text-sm">
                <p className="text-slate-700 break-all">{email}</p>
                {prefs === null ? <p className="text-xs text-slate-400">…</p> : stopped ? (
                  <p className="text-xs text-red-700" data-testid="news-unsubscribed">
                    {p.status === 'undeliverable' ? 'Undeliverable — bounced' : 'Unsubscribed from news'} on {formatDate(p.changed_at)}
                    {p.how === 'complaint' ? ' (reported our email as spam)' : p.how === 'recorded by staff' ? ` (recorded by staff${p.reason ? `: ${p.reason}` : ''})` : ''}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">
                    Receives our news{p?.how === 'recorded by staff' && p.reason ? ` — re-subscribed on ${formatDate(p.changed_at)}: ${p.reason}` : ''}
                  </p>
                )}
                {prefs !== null && (
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
      <p className="text-slate-500">No consent to news recorded. Campaigns reach this lead only as a once-only first approach.</p>
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
