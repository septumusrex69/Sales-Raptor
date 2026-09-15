import { useId, useRef, useState, type FormEvent } from 'react'
import { Paperclip, X } from 'lucide-react'
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
  /**
   * Pre-filled body, for a template or a standard wording. No caller passes one today.
   *
   * Deliberately NOT used to quote the message being replied to, which is what it was for and
   * which was removed: a debtor's reply already carries their client's own quoted chain, so
   * quoting it again opened the box with two layers of "> " before the agent typed anything.
   */
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
  onSent: (
    subject: string,
    bodyText: string,
    emailMessageId?: string,
    from?: string,
    /** What actually went with it, named by the server. Recorded on the account's copy. */
    attachmentNames?: string[],
  ) => void
}) {
  const { session } = useAuth()
  const listId = useId()
  const [address, setAddress] = useState(to ?? recipients?.[0]?.email ?? '')
  const [subject, setSubject] = useState(initialSubject ?? '')
  const [body, setBody] = useState(initialBody ?? '')
  /*
   * Cc and Bcc stay folded away until asked for.
   *
   * Most messages here go to one debtor and two more address fields on every compose is two more
   * things to read past. The link is one click and the fields stay open once opened, which is the
   * shape every mail client has settled on.
   */
  const [showCopies, setShowCopies] = useState(false)
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * What the server will accept, checked here as well so the answer is immediate.
   *
   * The real limit is the platform's: Vercel caps the request body and base64 inflates a file by
   * about a third, so roughly 3 MB of actual file fits. Past that the request never reaches our
   * code and the agent gets a generic failure — so the size is shown as files are added, and the
   * Send button says why it is disabled rather than simply being grey.
   */
  const MAX_TOTAL_BYTES = 3 * 1024 * 1024
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
  const tooBig = totalBytes > MAX_TOTAL_BYTES
  const readableSize = (bytes: number) =>
    bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

  /** A File as the send endpoint wants it: base64, with its name and type. */
  async function encode(file: File): Promise<{ filename: string; contentType: string; dataBase64: string }> {
    const buffer = await file.arrayBuffer()
    /*
     * Chunked rather than String.fromCharCode(...bytes) in one go. Spreading a three-megabyte
     * array into a call site is hundreds of thousands of arguments and throws a range error on
     * exactly the large attachment this feature exists to carry.
     */
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    }
    return {
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      dataBase64: btoa(binary),
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!address.trim() || !subject.trim() || !body.trim()) return
    if (tooBig) return
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
          ...(cc.trim() ? { cc: cc.trim() } : {}),
          ...(bcc.trim() ? { bcc: bcc.trim() } : {}),
          subject: subject.trim(),
          bodyHtml: body.trim().replace(/\n/g, '<br>'),
          ...(inReplyTo ? { inReplyTo } : {}),
          ...(files.length > 0 ? { attachments: await Promise.all(files.map(encode)) } : {}),
        }),
      })
      const responseBody = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(responseBody.error ?? 'Could not send that email. Connect your mailbox in Settings → Integrations.')
        setSubmitting(false)
        return
      }
      onSent(`Email sent: ${subject.trim()}`, body.trim(), responseBody.messageId ?? undefined, responseBody.from ?? undefined, responseBody.attachmentNames ?? [])
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
          {/*
            Cc and Bcc, one click away. Kept off the default view because nearly every message
            here goes to one debtor, and shown from then on because somebody who wanted them once
            in a conversation usually wants them again.
          */}
          {!showCopies && (
            <button type="button" onClick={() => setShowCopies(true)}
              className="mt-1 text-[11.5px] font-medium text-slate-400 hover:text-brand-600">
              Add Cc or Bcc
            </button>
          )}
        </FormField>
        {showCopies && (
          <>
            <FormField label="Cc">
              <input className={inputClass} value={cc} onChange={(e) => setCc(e.target.value)}
                placeholder="Separate addresses with commas" />
            </FormField>
            <FormField label="Bcc">
              <input className={inputClass} value={bcc} onChange={(e) => setBcc(e.target.value)}
                placeholder="Nobody else on the message sees these" />
            </FormField>
          </>
        )}
        <FormField label="Subject" required>
          <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} required autoFocus={!initialSubject} />
        </FormField>
        <FormField label="Message" required>
          <textarea className={inputClass} rows={7} value={body} onChange={(e) => setBody(e.target.value)} required autoFocus={!!initialSubject} />
        </FormField>
        {/*
          Attachments.

          The reason this exists at all: a collections firm sends statements, acknowledgements of
          debt and section 129 letters, and without a way to attach one the agent had to go back
          to Outlook — which is the whole thing Raptor's mailbox is meant to replace.
        */}
        <div className="mb-3">
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              // Appended, not replaced: picking a second file should not discard the first.
              setFiles((have) => [...have, ...Array.from(e.target.files ?? [])])
              // Cleared so choosing the same file again still fires a change event.
              e.target.value = ''
            }}
          />
          <button type="button" onClick={() => fileInput.current?.click()}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-[#c9a052] hover:bg-gold-50">
            <Paperclip size={13} /> Attach a file
          </button>

          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs text-slate-600">
                  <Paperclip size={11} className="shrink-0 text-slate-400" />
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 text-slate-400">{readableSize(f.size)}</span>
                  <button type="button" aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles((have) => have.filter((_, at) => at !== i))}
                    className="ml-auto shrink-0 text-slate-400 hover:text-negative-700">
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/*
            Said as soon as it is true, not when Send is pressed. Past this the request never
            reaches the server, so waiting would mean a generic failure after the agent had
            finished writing.
          */}
          {tooBig && (
            <p className="text-xs text-negative-700 mt-2">
              Those files come to {readableSize(totalBytes)}, and a message can carry about{' '}
              {readableSize(MAX_TOTAL_BYTES)}. Remove the largest and send it on its own, or put it
              on the account as a document.
            </p>
          )}
        </div>
        {contextNote && <p className="text-[11.5px] text-slate-400 mb-3 -mt-1">{contextNote}</p>}
        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm font-medium px-4 py-2 rounded-lg text-slate-500 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" disabled={submitting || tooBig}
            title={tooBig ? 'The attachments are too large to send in one message.' : undefined}
            className="text-sm font-medium px-4 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
            {submitting ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
