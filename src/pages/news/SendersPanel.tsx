import { useEffect, useState } from 'react'
import { Card, CardHeader } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { FIRM_REPORTS_ADDRESS, FIRM_SENDER_ENV, SENDER_ADDRESS_DOMAINS, isSendableEmail, normaliseEmail, senderAddressProblem } from '../../lib/marketing.ts'
import {
  addSender, getResultsSettings, listSenders, saveResultsSettings, setSenderActive, type ExtraSender, type ResultsSettings,
} from '../../lib/marketingApi'
import { Field, INPUT, errorText, useSenderConfig } from './shared'

/**
 * WHO CAMPAIGNS MAY COME FROM, AND WHO HEARS HOW THEY WENT (S13).
 *
 * EXTRA ADDRESSES. Ryno: "the ability to add other email addresses ... and the whole sign-in process for
 * those." There is no sign-in: Resend sends from any address on a domain verified with it, without a
 * mailbox or a password. So adding one is only a question of the domain, and only bfnews.co.za and
 * bredellferreira.co.za are verified (marketing_senders holds the same two in its check). An address is
 * switched off rather than deleted, so a campaign that went from it still says who it came from.
 *
 * THE RESULTS EMAIL. "A day after a campaign ends, the results go automatically to the marketing team."
 * One setting for every campaign: who gets it and how long after the last email has gone.
 */
export function SendersPanel() {
  const { config } = useSenderConfig()
  const [senders, setSenders] = useState<ExtraSender[] | null>(null)
  const [address, setAddress] = useState('')
  const [display, setDisplay] = useState('')
  const [settings, setSettings] = useState<ResultsSettings | null>(null)
  const [recipients, setRecipients] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    listSenders().then(setSenders).catch((e: unknown) => setError(errorText(e)))
    getResultsSettings().then((s) => { setSettings(s); setRecipients((s?.recipients ?? []).join(', ')) }).catch((e: unknown) => setError(errorText(e)))
  }, [])

  const typed = normaliseEmail(address)
  const problem = address.trim() ? senderAddressProblem(address) : null
  const taken = !!senders?.some((s) => s.address === typed)
  const firmDomain = typed.endsWith('@bredellferreira.co.za')

  async function add() {
    setError(null); setMessage(null)
    try {
      const s = await addSender(typed, display || typed.split('@')[0])
      setSenders((l) => [...(l ?? []), s].sort((a, b) => a.address.localeCompare(b.address)))
      setAddress(''); setDisplay('')
      setMessage(`${s.address} can now be chosen as a campaign’s sender.`)
    } catch (e) { setError(errorText(e)) }
  }

  const list = recipients.split(/[\s,;]+/).map(normaliseEmail).filter(Boolean)
  const badRecipients = list.filter((e) => !isSendableEmail(e))

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600" data-testid="news-senders-error">{error}</p>}
      {message && <p className="text-sm text-emerald-700" data-testid="news-senders-message">{message}</p>}

      <Card>
        <CardHeader title="Sender addresses" subtitle="Besides BF News, each client’s liaison and reports@, which every News campaign can always choose." />
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg mb-4" data-testid="news-senders">
          <li className="px-3 py-2 text-sm flex flex-wrap gap-x-3"><span className="text-slate-800">news@bfnews.co.za</span><span className="text-slate-400">BF News · always there</span></li>
          <li className="px-3 py-2 text-sm flex flex-wrap gap-x-3"><span className="text-slate-800">{FIRM_REPORTS_ADDRESS}</span><span className="text-slate-400">Reports · always there</span></li>
          {(senders ?? []).map((s) => (
            <li key={s.id} className="px-3 py-2 text-sm flex flex-wrap items-center gap-x-3" data-testid="news-sender-row">
              <span className={s.active ? 'text-slate-800' : 'text-slate-400 line-through'}>{s.address}</span>
              <span className="text-slate-400">{s.display_name}</span>
              <button type="button" className="ml-auto text-xs text-brand-700 hover:underline"
                onClick={() => void setSenderActive(s.id, !s.active).then(() => setSenders((l) => (l ?? []).map((x) => (x.id === s.id ? { ...x, active: !s.active } : x)))).catch((e: unknown) => setError(errorText(e)))}>
                {s.active ? 'Switch off' : 'Switch on'}
              </button>
            </li>
          ))}
        </ul>
        <h4 className="text-sm font-medium text-slate-700 mb-2">Add another address</h4>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start">
          <Field label="Address" hint={`On ${SENDER_ADDRESS_DOMAINS.join(' or ')}. No password or sign-in is needed: those domains are already set up for sending.`}>
            <input className={INPUT} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="marketing@bredellferreira.co.za" data-testid="news-sender-address-input" />
          </Field>
          <Field label="Name it signs with" hint="What the inbox shows as the From name.">
            <input className={INPUT} value={display} onChange={(e) => setDisplay(e.target.value)} placeholder="Bredell Ferreira Marketing" data-testid="news-sender-name-input" />
          </Field>
          <div className="md:pt-5">
            <Button variant="primary" disabled={!address.trim() || !!problem || taken} onClick={() => void add()} data-testid="news-sender-add">Add</Button>
          </div>
        </div>
        {problem && <p className="text-xs text-red-600 mt-2" data-testid="news-sender-problem">{problem}</p>}
        {taken && <p className="text-xs text-red-600 mt-2">That address is already on the list.</p>}
        {!problem && firmDomain && config && !config.firm?.ready && (
          <p className="text-xs text-gold-800 mt-2">It can be added now. Mail from bredellferreira.co.za goes once {FIRM_SENDER_ENV} is set in Vercel.</p>
        )}
      </Card>

      <Card>
        <CardHeader title="The results email" subtitle="After every campaign has gone, its results are emailed to these people: sent, delivered, didn’t arrive, opened, clicked, unsubscribed, and per sender." />
        {settings === null ? <p className="text-sm text-slate-400">Loading…</p> : (
          <div className="space-y-3" data-testid="news-results-settings">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} data-testid="news-results-enabled" />
              Send a results email after each campaign
            </label>
            <Field label="To (separate addresses with commas)">
              <input className={INPUT} value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="ryno@bredellferreira.co.za, stephan@bredellferreira.co.za" data-testid="news-results-to" />
            </Field>
            <Field label="How long after the last email has gone" hint="It goes on the morning run (07:13) once this much time has passed.">
              <select className={INPUT} value={settings.after_hours} onChange={(e) => setSettings({ ...settings, after_hours: Number(e.target.value) })} data-testid="news-results-after">
                {[[24, '1 day'], [48, '2 days'], [72, '3 days'], [168, '1 week']].map(([h, l]) => <option key={h} value={h}>{l}</option>)}
              </select>
            </Field>
            {badRecipients.length > 0 && <p className="text-xs text-red-600">{badRecipients.join(', ')} {badRecipients.length === 1 ? 'is' : 'are'} not an email address.</p>}
            {settings.enabled && list.length === 0 && <p className="text-xs text-slate-500">Nobody is on it yet, so no results email goes.</p>}
            <Button variant="primary" disabled={badRecipients.length > 0} data-testid="news-results-save"
              onClick={() => void saveResultsSettings({ ...settings, recipients: list }).then(() => setMessage('The results email is saved.')).catch((e: unknown) => setError(errorText(e)))}>
              Save
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
