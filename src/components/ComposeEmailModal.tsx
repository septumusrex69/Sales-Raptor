import { useState, type FormEvent } from 'react'
import { Modal, FormField, inputClass } from './ui/Modal'
import { useAuth } from '../store/AuthContext'

/**
 * Sends via the current user's connected mailbox (Settings → Integrations) and, on success,
 * hands the sent subject/body back to the caller to log as an Activity.
 */
export function ComposeEmailModal({
  to,
  onClose,
  onSent,
}: {
  to: string
  onClose: () => void
  onSent: (subject: string, bodyText: string) => void
}) {
  const { session } = useAuth()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!subject.trim() || !body.trim()) return
    const accessToken = session?.access_token
    if (!accessToken) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ to, subject: subject.trim(), bodyHtml: body.trim().replace(/\n/g, '<br>') }),
      })
      const responseBody = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(responseBody.error ?? 'Could not send that email. Connect your mailbox in Settings → Integrations.')
        setSubmitting(false)
        return
      }
      onSent(subject.trim(), body.trim())
      onClose()
    } catch {
      setError('Could not reach the server. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Modal title={`Email ${to}`} onClose={onClose} width={480}>
      <form onSubmit={handleSubmit}>
        <FormField label="To">
          <input className={inputClass} value={to} disabled />
        </FormField>
        <FormField label="Subject" required>
          <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} required autoFocus />
        </FormField>
        <FormField label="Message" required>
          <textarea className={inputClass} rows={7} value={body} onChange={(e) => setBody(e.target.value)} required />
        </FormField>
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
