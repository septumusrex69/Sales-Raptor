import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../auth.js'
import { credentialsKeyProblem } from '../crypto.js'
import { sendAsUser } from './sendAsUser.js'

/**
 * Sends an email through the caller's own connected mailbox via SMTP, with their saved signature
 * appended.
 *
 * WHAT IS LEFT HERE IS THE SESSION AND THE REQUEST BODY. The sending itself moved into
 * `sendAsUser` when the workflow runner needed it: the runner sends the same templates through
 * the same mailboxes with nobody watching, and two copies of a sender would drift -- with the
 * unattended one being the copy that drifts unnoticed. This route's job is to decide WHO is
 * sending, which is the one thing the runner answers differently.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const admin = adminClient()
  if (!admin) {
    res.status(500).json({ error: 'Server is missing Supabase configuration.' })
    return
  }
  /* Same guard as connect: a missing key is a server problem and has to say so, not surface as
     an empty 500 the client renders as a generic failure. */
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) {
    res.status(500).json({ error: keyProblem })
    return
  }
  const caller = await requireCaller(req, admin)
  if (!caller) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return
  }

  const { to, cc, subject, bodyHtml, inReplyTo, attachments: sent, calendarReply } = (req.body ?? {}) as {
    to?: string; subject?: string; bodyHtml?: string
    /**
     * An iTIP reply to a meeting request, as a whole ICS file.
     *
     * Carried as `icalEvent` rather than as an ordinary attachment, because the two are not the
     * same thing on the wire: nodemailer gives this one `Content-Type: text/calendar; method=REPLY`
     * inside a multipart/alternative, which is what makes Outlook and Google fold the answer into
     * the organiser's own meeting instead of showing them a file to open. Attached the other way
     * it arrives as invite.ics sitting at the bottom of an email, and the organiser's tracking
     * list still says nobody has answered.
     */
    calendarReply?: string
    /**
     * Files travelling with the message, base64 in this same JSON body.
     *
     * Not a separate upload: a file that reaches storage and then fails to send is a file nobody
     * asked for sitting in a bucket. The browser caps the total before it gets here and says the
     * number out loud; this is the second guard, because the platform's own limit arrives as an
     * empty 413 that the client can only report as "could not reach the server".
     */
    attachments?: { filename?: string; contentType?: string; content?: string }[]
    /**
     * Everyone else who was on the message being answered.
     *
     * Reply-all only. The firm: "I also can't respond to all recipients" — a debtor who copies
     * their attorney was answered privately, so the attorney never saw the answer to the question
     * they had been copied on. Who ends up here is decided by replyAllTo, which takes the sender
     * out of the list and the agent's own addresses with them.
     */
    cc?: string
    /**
     * The Message-ID this is a reply to, where it is one.
     *
     * Sets the In-Reply-To and References headers so the debtor's own mail client shows our
     * answer inside the thread they started, rather than as a new message that happens to begin
     * "Re:". Not needed for Raptor's own matching — their reply threads on the Message-ID we
     * recorded, which their client fills in — this is about what the debtor sees.
     */
    inReplyTo?: string
  }
  if (!to || !subject || !bodyHtml) {
    res.status(400).json({ error: 'to, subject, and bodyHtml are required.' })
    return
  }

  const files = (sent ?? [])
    .filter((f) => f?.filename && f?.content)
    .map((f) => ({
      filename: f.filename as string,
      content: Buffer.from(f.content as string, 'base64'),
      contentType: f.contentType || 'application/octet-stream',
    }))

  /* Guarded again server-side: the browser's limit is a courtesy, not a control. */
  const total = files.reduce((n, f) => n + f.content.length, 0)
  if (total > 4 * 1024 * 1024) {
    res.status(400).json({ error: 'Those attachments are too large to send in one message.' })
    return
  }

  const result = await sendAsUser(admin, caller.id, {
    to, subject, bodyHtml, cc, inReplyTo, calendarReply, attachments: files,
  })
  if (!result.ok) {
    res.status(400).json({ error: result.error })
    return
  }
  res.status(200).json({ ok: true, messageId: result.messageId, from: result.from })
}
