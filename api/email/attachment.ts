import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../_lib/auth.js'
import { fetchAttachment } from '../_lib/emailSync.js'

/**
 * Streams one attachment out of the connected mailbox on demand. Nothing is stored:
 * the mailbox stays the archive, and the CRM just reaches into it when someone actually
 * wants a file (see fetchAttachment for why, given this mailbox's volume).
 *
 * Every successful download is logged as an Activity against the same client/lead, stamped
 * with the person who downloaded it — these are debt-collection documents, so who pulled a
 * client's file and when is exactly the sort of thing that needs to be on the record.
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
  const caller = await requireCaller(req, admin)
  if (!caller) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return
  }

  const { activityId, filename } = (req.body ?? {}) as { activityId?: string; filename?: string }
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
