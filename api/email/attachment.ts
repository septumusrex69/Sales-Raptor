import type { VercelRequest, VercelResponse } from '@vercel/node'
import { credentialsKeyProblem } from '../_lib/crypto.js'
import { adminClient, requireCaller } from '../_lib/auth.js'
import { fetchAttachment, fetchMessageBody } from '../_lib/emailSync.js'
import { findLinkedDetails } from '../../src/lib/signature.js'

/**
 * Reaches into a connected mailbox for something that was never stored.
 *
 * Two jobs, one route, and that is deliberate: Vercel's Hobby plan caps a project at twelve
 * serverless functions and this project is at twelve. Both jobs are the same act — open an IMAP
 * connection, find one message, take one thing out of it — so they share a handler rather than
 * the feature waiting on a billing change.
 *
 *   { activityId, filename }      one attachment off a CRM email, streamed as a download.
 *   { mailId }                    the full text of one message in the caller's own mailbox.
 *   { mailId, filename }          one attachment off a message in the caller's own mailbox.
 *   { accountEmailId, filename }  one attachment off a debtor's correspondence.
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

  const { activityId, filename, mailId, accountEmailId } = (req.body ?? {}) as {
    activityId?: string; filename?: string; mailId?: string; accountEmailId?: string
  }

  /**
   * Serve a file out of a mailbox, once we know the caller is entitled to it.
   *
   * Shared by all three branches so the two guards can never drift: the filename must be one the
   * SYNC recorded on that message — otherwise this route becomes a way to pull arbitrary files
   * out of a mailbox by guessing names — and the connection used is whichever mailbox actually
   * received the mail.
   */
  async function serveAttachment(
    conn: { email: string; imap_host: string; imap_port: number; encrypted_password: string },
    location: { folder?: string | null; uid?: number | null; messageId?: string | null },
    names: string[],
    name: string,
  ): Promise<boolean> {
    if (!names.includes(name)) {
      res.status(404).json({ error: 'That file is not attached to this email.' })
      return true
    }
    const file = await fetchAttachment(conn, location, name)
    if (!file) {
      res.status(404).json({
        error: 'Could not find that attachment — the original email may have been moved or deleted from the mailbox.',
      })
      return true
    }
    res.setHeader('Content-Type', file.contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`)
    res.status(200).send(file.content)
    return true
  }

  /*
   * An attachment on a debtor's correspondence.
   *
   * Readable by any signed-in collector, matching account_emails' own select policy: collectors
   * cover for each other and the account's correspondence is the account's history. The FILE,
   * though, lives in the mailbox of whoever received it, so the connection is looked up by
   * received_by rather than by the caller — the same rule the CRM branch below uses.
   */
  if (accountEmailId && filename) {
    const { data: mail } = await admin
      .from('account_emails')
      .select('id, received_by, email_folder, email_uid, message_id, attachment_names')
      .eq('id', accountEmailId)
      .maybeSingle()
    if (!mail) {
      res.status(404).json({ error: 'That email is no longer on the account.' })
      return
    }
    if (!mail.received_by) {
      res.status(400).json({ error: 'Raptor does not know which mailbox that email arrived in.' })
      return
    }
    const { data: conn } = await admin.from('email_connections').select('*')
      .eq('user_id', mail.received_by).maybeSingle()
    if (!conn) {
      res.status(400).json({ error: 'The mailbox this email came from is no longer connected.' })
      return
    }
    try {
      await serveAttachment(
        conn as { email: string; imap_host: string; imap_port: number; encrypted_password: string },
        {
          folder: mail.email_folder as string | null,
          uid: mail.email_uid as number | null,
          messageId: mail.message_id as string | null,
        },
        ((mail.attachment_names as string[] | null) ?? []),
        filename,
      )
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Could not reach the mailbox.' })
    }
    return
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
      .select('id, user_id, folder, uid, message_id, attachment_names, from_address')
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

    const location = {
      folder: mail.folder as string | null,
      uid: mail.uid as number | null,
      messageId: mail.message_id as string | null,
    }

    // An attachment on your own mail, rather than its text. Not logged, for the same reason
    // reading the text is not: it is your mail, and you could open it in Outlook.
    if (filename) {
      try {
        await serveAttachment(
          own as { email: string; imap_host: string; imap_port: number; encrypted_password: string },
          location,
          ((mail.attachment_names as string[] | null) ?? []),
          filename,
        )
      } catch (err) {
        res.status(502).json({ error: err instanceof Error ? err.message : 'Could not reach your mailbox.' })
      }
      return
    }

    try {
      const body = await fetchMessageBody(
        own as { email: string; imap_host: string; imap_port: number; encrypted_password: string },
        location,
      )
      if (!body) {
        // The snippet Raptor holds is still shown, so the page says this rather than going blank.
        res.status(404).json({ error: 'Could not find that message in your mailbox — it may have been moved or deleted.' })
        return
      }
      /*
       * The contact details are extracted HERE rather than in the browser, because the browser
       * never sees the HTML — and must not: this is markup from outside the building, and
       * rendering it is not worth faithful formatting. The hrefs are read on the server and only
       * the handful of candidates crosses over.
       */
      res.status(200).json({
        ok: true,
        text: body.text,
        details: body.html ? findLinkedDetails(body.html, mail.from_address as string | undefined) : [],
        /*
         * The pictures drawn INTO the message, chiefly signatures — carried as data: URIs so
         * the browser renders them without fetching anything from anybody else's server. That
         * is what keeps a tracking pixel in a debtor's email from reporting when their
         * collector opened it. See fetchMessageBody.
         */
        images: body.images,
        // Pictures that were there and are not shown. Said out loud, because a signature that
        // silently fails to appear looks identical to a message that never had one.
        imagesSkipped: body.imagesSkipped,
        /*
         * The raw ICS of a meeting request, parsed in the BROWSER.
         *
         * Unlike the HTML above, an ICS is not markup and nothing renders it -- it is read into
         * a handful of fields and those are what the page draws. Parsing it here would put the
         * rule on the side of the wall that npm run build does not typecheck and that the check
         * scripts cannot import; in src/lib it is checked without a browser or a mailbox.
         */
        calendar: body.calendar,
      })
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
