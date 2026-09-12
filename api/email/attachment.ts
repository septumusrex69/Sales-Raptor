import type { VercelRequest, VercelResponse } from '@vercel/node'
import { credentialsKeyProblem } from '../_lib/crypto.js'
import { adminClient, requireCaller } from '../_lib/auth.js'
import { fetchAttachment, fetchMessageBody } from '../_lib/emailSync.js'

/**
 * Reaches into a connected mailbox for something that was never stored.
 *
 * Two jobs, one route, and that is deliberate: Vercel's Hobby plan caps a project at twelve
 * serverless functions and this project is at twelve. Both jobs are the same act — open an IMAP
 * connection, find one message, take one thing out of it — so they share a handler rather than
 * the feature waiting on a billing change.
 *
 *   { activityId, filename }  one attachment off a CRM email, streamed as a download.
 *   { mailId }                the full text of one message in the caller's own mailbox.
 *
 * Nothing is stored either way. The mailbox stays the archive and Raptor reaches into it when
 * somebody actually wants something — see fetchAttachment for why, given this mailbox's volume.
 *
 * Every successful attachment download is logged as an Activity against the same client/lead,
 * stamped with the person who downloaded it — these are debt-collection documents, so who pulled
 * a client's file and when is exactly the sort of thing that needs to be on the record. Reading
 * the text of your own mail is not logged: it is your mail, and you could read it in Outlook.
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
  // Same guard as connect: a missing key is a server problem and has to say so, not surface as
  // an empty 500 the client renders as a generic failure.
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

  const { activityId, filename, mailId } = (req.body ?? {}) as {
    activityId?: string; filename?: string; mailId?: string
  }

  /*
   * Reading one of your own mailbox messages.
   *
   * Scoped to the caller by user_id on the row itself, not merely by RLS — this runs with the
   * service key, so the check has to be here. That is the whole privacy rule of the mailbox: an
   * agent reads their own mail and nobody else's, including an administrator.
   */
  if (mailId) {
    const { data: mail } = await admin
      .from('user_emails')
      .select('id, user_id, folder, uid, message_id')
      .eq('id', mailId)
      .eq('user_id', caller.id)
      .maybeSingle()
    if (!mail) {
      res.status(404).json({ error: 'That email is not in your mailbox.' })
      return
    }

    const { data: own } = await admin.from('email_connections').select('*').eq('user_id', caller.id).maybeSingle()
    if (!own) {
      res.status(400).json({ error: 'Your mailbox is no longer connected. Reconnect it under Settings → Integrations.' })
      return
    }

    try {
      const body = await fetchMessageBody(
        own as { email: string; imap_host: string; imap_port: number; encrypted_password: string },
        {
          folder: mail.folder as string | null,
          uid: mail.uid as number | null,
          messageId: mail.message_id as string | null,
        },
      )
      if (!body) {
        // The snippet Raptor holds is still shown, so the page says this rather than going blank.
        res.status(404).json({ error: 'Could not find that message in your mailbox — it may have been moved or deleted.' })
        return
      }
      res.status(200).json({ ok: true, text: body.text })
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Could not reach your mailbox.' })
    }
    return
  }

  if (!activityId || !filename) {
    res.status(400).json({ error: 'activityId and filename are required.' })
    return
  }

  const { data: activity } = await admin
    .from('activities')
    .select('id, user_id, company_id, lead_id, contact_id, subject, email_message_id, email_folder, email_uid, attachment_names')
    .eq('id', activityId)
    .maybeSingle()
  if (!activity) {
    res.status(404).json({ error: 'That email is no longer in the CRM.' })
    return
  }
  // Only serve names the sync actually recorded on this email, so this can't be used to
  // pull arbitrary files out of the mailbox by guessing names.
  if (!((activity.attachment_names as string[] | null) ?? []).includes(filename)) {
    res.status(404).json({ error: 'That file is not attached to this email.' })
    return
  }

  // The mailbox belongs to whoever received the mail, not to the caller — a colleague
  // opening a client's file is expected and is what the download log is for.
  const { data: conn } = await admin.from('email_connections').select('*').eq('user_id', activity.user_id).maybeSingle()
  if (!conn) {
    res.status(400).json({ error: 'The mailbox this email came from is no longer connected.' })
    return
  }

  try {
    const file = await fetchAttachment(
      conn as { email: string; imap_host: string; imap_port: number; encrypted_password: string },
      { folder: activity.email_folder as string | null, uid: activity.email_uid as number | null, messageId: activity.email_message_id as string | null },
      filename,
    )
    if (!file) {
      res.status(404).json({ error: 'Could not find that attachment — the original email may have been moved or deleted from the mailbox.' })
      return
    }

    const { data: profile } = await admin.from('profiles').select('name').eq('id', caller.id).maybeSingle()
    await admin.from('activities').insert({
      type: 'Note',
      user_id: caller.id,
      company_id: activity.company_id,
      lead_id: activity.lead_id,
      contact_id: activity.contact_id,
      subject: `Attachment downloaded: ${filename}`,
      notes: `${profile?.name ?? 'A user'} downloaded "${filename}" from the email "${activity.subject}".`,
    })

    res.setHeader('Content-Type', file.contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`)
    res.status(200).send(file.content)
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Could not reach the mailbox.' })
  }
}
