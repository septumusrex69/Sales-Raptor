import { useId, useState, type FormEvent } from 'react'
import { Modal, FormField, inputClass } from './ui/Modal'
import { useAuth } from '../store/AuthContext'

/**
 * Sends via the current user's connected mailbox (Settings → Integrations) and, on success,
 * hands the sent subject/body back to the caller to log as an Activity.
 */
export function ComposeEmailModal({
  to,
  recipients,
  initialSubject,
  initialBody,
  contextNote,
  inReplyTo,
  onClose,
  onSent,
}: {
  /** Pre-filled recipient. Optional: a deal often has no contact of its own to default to. */
  to?: string
  /**
   * Addresses to offer as suggestions — everyone already known on the client, lead or deal.
   *
   * The field stays typeable rather than becoming a locked dropdown. A deal frequently has no
   * contact of its own, and the person who needs to receive a quotation is often someone whose
   * address is in the salesperson's head and not yet in the CRM. Refusing to send until they
   * stop and create a contact record is how a CRM gets worked around instead of used.
   */
  recipients?: { email: string; label?: string }[]
  /**
   * Where this message will end up, said before it is sent rather than discovered afterwards.
   *
   * Sending from inside a deal files the message on the deal, the client and the lead at once,
   * which is not obvious from a modal that only shows a To field — and someone who assumes it
   * vanished into the deal alone will go and send it from somewhere else instead.
   */
  contextNote?: string
  /** Pre-filled subject, e.g. "Re: ..." when replying to a received email. */
  initialSubject?: string
  /** Pre-filled body, e.g. a quoted copy of the message being replied to. */
  initialBody?: string
  /**
   * The Message-ID being replied to, where this is a reply.
   *
   * Passed through to the server, which puts it in the In-Reply-To header so the recipient's own
   * mail client shows the answer inside the thread rather than as a fresh message.
   */
  inReplyTo?: string | null
  onClose: () => void
  /**
   * `emailMessageId` is the sent message's own Message-ID, so a reply can be threaded back.
   * `from` is the mailbox it actually left by, which decides where that reply will land.
   */
  onSent: (subject: string, bodyText: string, emailMessageId?: string, from?: string) => void
}) {
  const { session } = useAuth()
  const listId = useId()
  const [address, setAddress] = useState(to ?? recipients?.[0]?.email ?? '')
  const [subject, setSubject] = useState(initialSubject ?? '')
  const [body, setBody] = useState(initialBody ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!address.trim() || !subject.trim() || !body.trim()) return
    const accessToken = session?.access_token
    if (!accessToken) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          to: address.trim(),
          subject: subject.trim(),
          bodyHtml: body.trim().replace(/\n/g, '<br>'),
          ...(inReplyTo ? { inReplyTo } : {}),
        }),
      })
      const responseBody = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(responseBody.error ?? 'Could not send that email. Connect your mailbox in Settings → Integrations.')
        setSubmitting(false)
        return
      }
      onSent(`Email sent: ${subject.trim()}`, body.trim(), responseBody.messageId ?? undefined, responseBody.from ?? undefined)
      onClose()
    } catch {
      setError('Could not reach the server. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Modal title={initialSubject ? `Reply to ${to ?? address}` : 'New Email'} onClose={onClose} width={480}>
      <form onSubmit={handleSubmit}>
        <FormField label="To" required>
          <input
            className={inputClass}
            type="email"
            list={recipients && recipients.length > 0 ? listId : undefined}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="name@company.co.za"
            required
            autoFocus={!address}
          />
          {recipients && recipients.length > 0 && (
            <datalist id={listId}>
              {recipients.map((r) => (
                <option key={r.email} value={r.email}>
                  {r.label ?? r.email}
                </option>
              ))}
            </datalist>
          )}
        </FormField>
        <FormField label="Subject" required>
          <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} required autoFocus={!initialSubject} />
        </FormField>
        <FormField label="Message" required>
          <textarea className={inputClass} rows={7} value={body} onChange={(e) => setBody(e.target.value)} required autoFocus={!!initialSubject} />
        </FormField>
        {contextNote && <p className="text-[11.5px] text-slate-400 mb-3 -mt-1">{contextNote}</p>}
        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm font-medium px-4 py-2 rounded-lg text-slate-500 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="text-sm font-medium px-4 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
            {submitting ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
