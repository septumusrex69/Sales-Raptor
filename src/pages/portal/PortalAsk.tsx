import { useState } from 'react'
import { PORTAL_MESSAGE_MAX } from '../../lib/clientPortal'
import { PortalSignedOut, askPortalQuestion, requestPortalCallback } from '../../lib/portalApi'

/**
 * ASK ABOUT A DEBTOR, OR ASK TO BE CALLED (S15, Raptor · Handover 14). Stephan's order for the portal:
 * "questions about a debtor, callbacks". One window, two choices, because the client's question is the
 * same either way -- "what is happening with this one?" -- and only they know whether they want the
 * answer written or spoken.
 *
 * A QUESTION becomes a ticket on the liaison's desk and comes back here under Tickets, answered in
 * writing. A CALLBACK becomes a call on the liaison's task list, due today. Either rings their bell.
 * Opened from an account it names that account; opened from the header it is about the client's book.
 */
export interface AskAbout { caseNumber: string; debtor: string }

export function PortalAsk({ token, about, onClose, onSignedOut, onAsked }: {
  token: string
  about: AskAbout | null
  onClose: () => void
  onSignedOut: () => void
  onAsked: (what: 'question' | 'callback', ticketNo?: number) => void
}) {
  /* No account means no question: a question is a ticket, and a ticket is about an account. A call can be
     about anything. */
  const [mode, setMode] = useState<'question' | 'callback'>(about ? 'question' : 'callback')
  const [text, setText] = useState('')
  const [phone, setPhone] = useState('')
  const [when, setWhen] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      if (mode === 'question' && about) {
        const r = await askPortalQuestion(token, about.caseNumber, text)
        onAsked('question', r.ticketNo)
      } else {
        await requestPortalCallback(token, { caseNumber: about?.caseNumber, phone, when, about: text })
        onAsked('callback')
      }
    } catch (x) {
      if (x instanceof PortalSignedOut) onSignedOut(); else setError(x instanceof Error ? x.message : String(x))
    } finally { setBusy(false) }
  }

  const ready = mode === 'question' ? !!text.trim() : phone.replace(/\D/g, '').length >= 9
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true"
      onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} data-testid="portal-ask"
        className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-6 space-y-4">
        <div>
          <h2 className="text-lg text-slate-900">{about ? `About ${about.debtor}` : 'Ask us to call you'}</h2>
          {about && <p className="text-sm text-slate-500">Our reference {about.caseNumber}</p>}
        </div>

        {about && (
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {(['question', 'callback'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                data-testid={`portal-ask-${m}`}
                className={`rounded-xl border px-3 py-2 text-sm text-left ${mode === m
                  ? 'border-navy-900 bg-navy-900/5 text-slate-900' : 'border-slate-200 text-slate-600'}`}>
                <span className="block font-semibold">{m === 'question' ? 'Ask a question' : 'Call me'}</span>
                <span className="block text-xs text-slate-500">
                  {m === 'question' ? 'Answered in writing, under Tickets' : 'Your liaison phones you'}
                </span>
              </button>
            ))}
          </div>
        )}

        {mode === 'callback' && (
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-sm text-slate-700">Number to call
              <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel"
                placeholder="082 123 4567" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" data-testid="portal-ask-phone" />
            </label>
            <label className="text-sm text-slate-700">When suits you
              <input value={when} onChange={(e) => setWhen(e.target.value)} maxLength={120}
                placeholder="After 2pm today" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" data-testid="portal-ask-when" />
            </label>
          </div>
        )}

        <label className="block text-sm text-slate-700">
          {mode === 'question' ? 'Your question' : 'What it is about (optional)'}
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={PORTAL_MESSAGE_MAX}
            required={mode === 'question'} data-testid="portal-ask-text"
            placeholder={mode === 'question' ? 'Has the debtor made an arrangement yet?' : 'The new address we have for the debtor.'}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>

        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancel</button>
          <button type="submit" disabled={busy || !ready} data-testid="portal-ask-send"
            className="rounded-lg bg-navy-900 text-white px-4 py-2 text-sm disabled:opacity-50">
            {mode === 'question' ? 'Send question' : 'Ask for a call'}
          </button>
        </div>
      </form>
    </div>
  )
}
