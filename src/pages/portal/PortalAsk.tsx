import { useState } from 'react'
import { clockToday } from '../../lib/clock'
import { PORTAL_MESSAGE_MAX, PORTAL_TOPICS, type PortalTopic } from '../../lib/clientPortal'
import { PortalSignedOut, askPortalQuestion, recordPortalPayment, requestPortalCallback } from '../../lib/portalApi'

/**
 * ONE WINDOW FOR EVERYTHING A CLIENT WANTS FROM US ABOUT A DEBTOR (S15, Raptor · Handover 14). Stephan's
 * order for the portal: "questions about a debtor, callbacks", then "record a payment ... a payment made to
 * you, on a specific account".
 *
 * A QUESTION becomes a ticket on the liaison's desk, with what it is about picked from a short list, and
 * comes back under Tickets answered in writing. A PAYMENT is recorded on the account, paid to the client,
 * and waits in Trust for the firm's approval. A CALLBACK becomes a call on the liaison's task list, due
 * today. Every one rings the liaison's bell. Opened from an account it names that account; opened from the
 * sidebar it can only be a call, because the other two are about one account.
 */
export interface AskAbout { caseNumber: string; debtor: string }
export type AskMode = 'question' | 'payment' | 'callback'

const MODES: { mode: AskMode; label: string; hint: string }[] = [
  { mode: 'question', label: 'Ask a question', hint: 'Answered in writing, under Tickets' },
  { mode: 'payment', label: 'Paid to you', hint: 'The debtor paid you directly' },
  { mode: 'callback', label: 'Call me', hint: 'Your liaison phones you' },
]

/* Today in South Africa, from the firm's one clock (lib/clock): the machine's own on the portal, where no
   staging clock is loaded, and never a second idea of "today" written here. */
const today = () => clockToday()

export function PortalAsk({ token, about, initialMode, onClose, onSignedOut, onAsked }: {
  token: string
  about: AskAbout | null
  initialMode?: AskMode
  onClose: () => void
  onSignedOut: () => void
  onAsked: (what: AskMode, ticketNo?: number | null) => void
}) {
  const [mode, setMode] = useState<AskMode>(about ? (initialMode ?? 'question') : 'callback')
  const [topic, setTopic] = useState<PortalTopic | null>(null)
  const [text, setText] = useState('')
  const [phone, setPhone] = useState('')
  const [when, setWhen] = useState('')
  const [amount, setAmount] = useState('')
  const [paidOn, setPaidOn] = useState(today())
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      if (mode === 'question' && about) {
        const r = await askPortalQuestion(token, about.caseNumber, topic ?? 'Something else', text)
        onAsked('question', r.ticketNo)
      } else if (mode === 'payment' && about) {
        const r = await recordPortalPayment(token, { caseNumber: about.caseNumber, amount, paidOn, reference, note: text })
        onAsked('payment', r.ticketNo)
      } else {
        await requestPortalCallback(token, { caseNumber: about?.caseNumber, phone, when, about: text })
        onAsked('callback')
      }
    } catch (x) {
      if (x instanceof PortalSignedOut) onSignedOut(); else setError(x instanceof Error ? x.message : String(x))
    } finally { setBusy(false) }
  }

  const ready = mode === 'question' ? !!topic && !!text.trim()
    : mode === 'payment' ? Number(amount.replace(/[\sR,]/g, '')) > 0 && !!paidOn && !!reference.trim()
      : phone.replace(/\D/g, '').length >= 9
  const input = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2'
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true"
      onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} data-testid="portal-ask"
        className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-6 space-y-4 max-h-[92vh] overflow-y-auto">
        <div>
          <h2 className="text-lg text-slate-900">{about ? `About ${about.debtor}` : 'Ask us to call you'}</h2>
          {about && <p className="text-sm text-slate-500">Our reference {about.caseNumber}</p>}
        </div>

        {about && (
          <div className="grid grid-cols-3 gap-2" role="radiogroup">
            {MODES.map((m) => (
              <button key={m.mode} type="button" role="radio" aria-checked={mode === m.mode} onClick={() => setMode(m.mode)}
                data-testid={`portal-ask-${m.mode}`}
                className={`rounded-xl border px-3 py-2 text-sm text-left ${mode === m.mode
                  ? 'border-navy-900 bg-navy-900/5 text-slate-900' : 'border-slate-200 text-slate-600'}`}>
                <span className="block font-semibold">{m.label}</span>
                <span className="block text-xs text-slate-500">{m.hint}</span>
              </button>
            ))}
          </div>
        )}

        {mode === 'callback' && (
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-sm text-slate-700">Number to call
              <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel"
                placeholder="082 123 4567" className={input} data-testid="portal-ask-phone" />
            </label>
            <label className="text-sm text-slate-700">When suits you
              <input value={when} onChange={(e) => setWhen(e.target.value)} maxLength={120}
                placeholder="After 2pm today" className={input} data-testid="portal-ask-when" />
            </label>
          </div>
        )}

        {mode === 'payment' && (
          <>
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="text-sm text-slate-700">Amount
                <input inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)}
                  placeholder="R 1 500.00" className={input} data-testid="portal-pay-amount" />
              </label>
              <label className="text-sm text-slate-700">Paid on
                <input type="date" required value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)}
                  className={input} data-testid="portal-pay-date" />
              </label>
              <label className="text-sm text-slate-700">Your reference
                <input required value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120}
                  placeholder="Receipt or bank ref" className={input} data-testid="portal-pay-reference" />
              </label>
            </div>
            {/* SAID BEFORE IT IS SENT: the client should not think the debt dropped the moment they pressed it. */}
            <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2.5">
              It is recorded on the account straight away and counts once Bredell Ferreira has approved it.
              Your liaison is told.
            </p>
          </>
        )}

        {mode === 'question' && (
          <fieldset>
            <legend className="text-sm text-slate-700 mb-1.5">What is it about?</legend>
            <div className="flex flex-wrap gap-1.5" data-testid="portal-ask-topics">
              {PORTAL_TOPICS.map((t) => (
                <button key={t} type="button" onClick={() => setTopic(t)} aria-pressed={topic === t}
                  className={`rounded-full border px-3 py-1 text-xs ${topic === t
                    ? 'border-navy-900 bg-navy-900 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                  {t}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <label className="block text-sm text-slate-700">
          {mode === 'question' ? 'Your question' : mode === 'payment' ? 'Anything we should know (optional)' : 'What it is about (optional)'}
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={mode === 'question' ? 4 : 2} maxLength={PORTAL_MESSAGE_MAX}
            required={mode === 'question'} data-testid="portal-ask-text"
            placeholder={mode === 'question' ? 'Has the debtor made an arrangement yet?'
              : mode === 'payment' ? 'Paid in cash at our Pretoria branch.' : 'The new address we have for the debtor.'}
            className={input} />
        </label>

        {error && <p className="text-sm text-red-700" data-testid="portal-ask-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancel</button>
          <button type="submit" disabled={busy || !ready} data-testid="portal-ask-send"
            className="rounded-lg bg-navy-900 text-white px-4 py-2 text-sm disabled:opacity-50">
            {mode === 'question' ? 'Send question' : mode === 'payment' ? 'Record the payment' : 'Ask for a call'}
          </button>
        </div>
      </form>
    </div>
  )
}
