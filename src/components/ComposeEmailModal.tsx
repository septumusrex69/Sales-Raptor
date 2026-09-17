import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Paperclip, X } from 'lucide-react'
import { Modal, FormField, inputClass } from './ui/Modal'
import { useAuth } from '../store/AuthContext'

/**
 * How much may travel with one message.
 *
 * Vercel caps a serverless request body at 4.5 MB and base64 adds a third, so the real ceiling is
 * around 3 MB of files. Refused HERE, with the number said out loud, because the alternative is a
 * 413 from the platform that arrives as "Could not reach the server" after the wait -- and a
 * collector who has just attached a debtor's bank statements deserves better than that.
 */
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024

interface Attached { filename: string; contentType: string; size: number; content: string }

/** Bytes as somebody reads them. en-ZA groups with a non-breaking space; sizes do not need it. */
function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

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
  initialCc,
  quoted,
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
  /**
   * Everyone else who was on the message being answered, for a reply-all.
   *
   * Shown and EDITABLE, because the list is the part somebody has to be able to check: a
   * reply-all that quietly copied a debtor's attorney would be the firm's mistake, not the
   * sender's, and the only moment to catch it is before Send.
   */
  initialCc?: string
  /**
   * The message being answered, shown UNDER the box and never inside it.
   *
   * The firm: "make it bigger, like Outlook, and you could see at the bottom the previous email
   * that it is going to reply to." Which is what Outlook does -- the quoted original sits below
   * the cursor, readable, and is not something you have to scroll past to start typing.
   *
   * Still not pasted INTO the box, which was tried and removed: a debtor's reply already carries
   * their own client's quoted chain, so quoting it again opened the composer with two layers of
   * "> " before anybody had typed a word.
   */
  quoted?: string
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
  const [cc, setCc] = useState(initialCc ?? '')
  const [subject, setSubject] = useState(initialSubject ?? '')
  const [body, setBody] = useState(initialBody ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<Attached[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  /*
   * Read in the browser and sent as base64 in the same JSON body as the message.
   *
   * Not a separate upload: a file that reaches storage and then fails to send is a file nobody
   * asked for sitting in a bucket, and the message either goes with its attachments or does not go.
   */
  async function attach(e: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (chosen.length === 0) return
    setError(null)

    const already = files.reduce((n, f) => n + f.size, 0)
    const adding = chosen.reduce((n, f) => n + f.size, 0)
    if (already + adding > MAX_ATTACHMENT_BYTES) {
      setError(`That is more than ${fileSize(MAX_ATTACHMENT_BYTES)} of attachments, which is as `
        + 'much as one message can carry. Send the larger files in a second email, or share a link.')
      return
    }

    try {
      const read = await Promise.all(chosen.map((file) => new Promise<Attached>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error(`${file.name} could not be read.`))
        reader.onload = () => resolve({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          size: file.size,
          /* A data: URL, so everything up to and including the comma is not the file. */
          content: String(reader.result ?? '').split(',')[1] ?? '',
        })
        reader.readAsDataURL(file)
      })))
      setFiles((list) => [...list, ...read])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be read.')
    }
  }

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
          /* Absent rather than empty, so a cleared box sends to the one recipient only. */
          ...(cc.trim() ? { cc: cc.trim() } : {}),
          subject: subject.trim(),
          bodyHtml: body.trim().replace(/\n/g, '<br>'),
          ...(files.length > 0
            ? { attachments: files.map(({ filename, contentType, content }) => ({ filename, contentType, content })) }
            : {}),
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
    /*
      WIDER THAN A DIALOG, because it is a place somebody writes rather than a question they
      answer. The firm: "the one you made is very small -- make it bigger like Outlook." At 480 a
      reply to a debtor's three paragraphs was typed through a letterbox, and the quoted original
      below it would have been unreadable.
    */
    <Modal title={initialSubject ? `Reply to ${to ?? address}` : 'New Email'} onClose={onClose} width={760}>
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
        {/*
          ONLY ON A REPLY-ALL. An empty Cc box on every new message is a field nobody fills in and
          everybody reads past; here it is pre-filled with the people who were on the original, and
          the point of showing it is that somebody can take one of them OUT before sending.
        */}
        {initialCc !== undefined && (
          <FormField label="Cc">
            <input
              className={inputClass}
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="Nobody else"
            />
          </FormField>
        )}
        <FormField label="Subject" required>
          <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} required autoFocus={!initialSubject} />
        </FormField>
        <FormField label="Message" required>
          <textarea className={inputClass} rows={12} value={body}
            onChange={(e) => setBody(e.target.value)} required autoFocus={!!initialSubject} />
        </FormField>

        {/*
          FILES, which the mailbox could not send at all. Forwarding a debtor's proof of payment to
          the client, or a mandate to the attorney, meant opening Outlook -- and mail managed in
          two places is mail managed in neither.
        */}
        <div className="-mt-1 mb-3">
          <input ref={fileInput} type="file" multiple className="hidden"
            onChange={(e) => void attach(e)} />
          <button type="button" onClick={() => fileInput.current?.click()}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-[#c9a052] hover:bg-gold-50">
            <Paperclip size={13} /> Attach a file
          </button>
          {files.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <span key={`${f.filename}-${i}`}
                  className="inline-flex items-center gap-1.5 max-w-full text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-600">
                  <Paperclip size={11} className="shrink-0 text-slate-400" />
                  <span className="truncate">{f.filename}</span>
                  <span className="shrink-0 text-slate-400">{fileSize(f.size)}</span>
                  {/* Removable, because the wrong file attached to a debtor's statement is not
                      something to discover after Send. */}
                  <button type="button" aria-label={`Remove ${f.filename}`}
                    onClick={() => setFiles((list) => list.filter((_, at) => at !== i))}
                    className="shrink-0 text-slate-400 hover:text-negative-700">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/*
          THE MESSAGE BEING ANSWERED, under the box. Readable without leaving the composer, which
          is the thing a reply typed in a modal otherwise loses -- the original is behind it.

          Rendered as TEXT and scrolled in its own box: this is mail from outside the building, and
          a long chain must not push Send off the bottom of the screen.
        */}
        {quoted && quoted.trim() !== '' && (
          <div className="mb-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
              The message you are answering
            </p>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-xs text-slate-500 whitespace-pre-wrap break-words">{quoted.trim()}</p>
            </div>
          </div>
        )}
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
