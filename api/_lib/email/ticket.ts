import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomUUID } from 'node:crypto'
import { credentialsKeyProblem } from '../crypto.js'
import { adminClient, requireCaller } from '../auth.js'
import { fetchAttachment } from '../emailSync.js'
import { chargeItemWith } from '../../../src/lib/chargeEngine.js'
import { escalationNote, escalationChargeable } from '../../../src/lib/disputeCategories.js'

const BUCKET = 'account-documents'

/**
 * The email row, named rather than inferred.
 *
 * THE SELECT IS BUILT FROM TWO STRING PIECES and PostgREST's types can only infer a row from a
 * literal one -- the same reason plan.ts casts its promises. Every field is read through a
 * coercion below anyway, so the cast buys nothing it does not also check.
 */
interface MailRow {
  id: string
  account_id: string | null
  direction: string | null
  subject: string | null
  body: string | null
  debtor_address: string | null
  attachment_names: string[] | null
  email_folder: string | null
  email_uid: number | null
  message_id: string | null
  received_by: string | null
  query_id: string | null
  occurred_at: string | null
}

/**
 * A TICKET, RAISED OFF THE EMAIL THAT CAUSED IT.
 *
 * THE FIRM: "if we've received a dispute, for example, possibly it would be an email. I think
 * maybe there what we could do is we could create the ticket like it already exists for the
 * dispute and like somehow attach the email and the attachments from there to that ticket and
 * then have a note there."
 *
 * WHAT IT REPLACES IS SIX STEPS AND A RETYPE: read the email, raise a dispute, type out what the
 * debtor said, mark it received in writing, download the attachments, upload them again. THE
 * RETYPING IS WHERE DISPUTES GET MIS-RECORDED -- it is the step most likely to be shortened at half
 * past four, and what the debtor actually wrote is the thing a finding has to answer.
 *
 * THE BODY IS NOT FETCHED, BECAUSE IT IS ALREADY HERE. `account_emails.body` is the account's own
 * record of what arrived. Only the ATTACHMENTS live in the mailbox -- deliberately, see
 * attachment.ts -- so those are the only thing reached for.
 *
 * A DISPUTE RAISED THIS WAY IS RECEIVED IN WRITING BY DEFINITION, which is the whole point of
 * pressing it on an email: `received_on` and `in_writing` go on in the same insert as `alleged_on`,
 * which is what workflow_start_on_dispute reads to end the invitation and start the real sequence,
 * and what workflow_hold_account reads to stop the collection ones. One write, because the trigger
 * reads NEW and a second update fires it against a row that still says the dispute has not arrived.
 *
 * IT IS ON THE EMAIL ROUTER RATHER THAN THE WORKFLOW ONE because the mailbox plumbing is here, and
 * because Vercel's Hobby plan counts FILES: a fifth action beside attachment and send costs
 * nothing, where its own file would cost a twelfth of the deployment.
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
  /* A missing key is a server problem and has to say so, not surface as an empty 500 the client
     renders as a generic failure. Same guard as attachment and connect. */
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

  const body = (req.body ?? {}) as {
    accountEmailId?: string
    kind?: 'dispute' | 'request'
    requestFor?: string
    category?: string | null
    ownerId?: string | null
    chaseOn?: string | null
    queryId?: string | null
  }
  const accountEmailId = typeof body.accountEmailId === 'string' ? body.accountEmailId : ''
  /*
   * LINK IT TO THE TICKET THAT IS ALREADY OPEN, rather than raising a second one.
   *
   * THE FIRM'S OWN SEQUENCE: "if the debtor disputes something and says he's going to email it,
   * then the moment that the email comes, you can say, link it to a current dispute and then you
   * can choose the dispute that is there available. Then it's that email and they need to
   * automatically know that we've received the dispute."
   *
   * That is exactly what `alleged_on`, `received_on` and `in_writing` are three columns for, and
   * until now nothing reached them from an email. A verbal dispute is raised on the telephone,
   * the invitation goes out asking for it in writing, the writing arrives -- and somebody had to
   * open the dispute and retype the date. Worse, the only button on the email raised a SECOND
   * ticket, which `one_open_dispute_per_account` then refused after item 3 had been charged.
   *
   * NOTHING IS CHARGED ON THIS PATH. Item 3 was raised when the dispute was; the debtor does not
   * pay twice because their objection arrived in two parts.
   */
  const queryId = typeof body.queryId === 'string' && body.queryId ? body.queryId : null
  /* TWO KINDS ONLY. A decision and a litigation recommendation are things somebody DECIDES, not
     things that arrive in the post; offering them here would be a door onto the wrong ladder. */
  const kind = body.kind === 'request' ? 'request' : 'dispute'
  if (!accountEmailId) {
    res.status(400).json({ error: 'Say which email.' })
    return
  }
  /*
   * WHAT IS BEING ASKED FOR, and the email's own default is Other -- honestly. A message a debtor
   * sent is not a form with a box ticked on it: whoever presses this has read what it says, and
   * the description below IS that message, which explains the request better than a guess from a
   * subject line would. It is re-picked on the ticket in one press if it turns out to be one of
   * the named kinds.
   */
  const requestFor = kind === 'request'
    ? ((typeof body.requestFor === 'string' && body.requestFor.trim()) || 'Other')
    : null

  const { data: mailRow, error: mailError } = await admin
    .from('account_emails')
    .select('id, account_id, direction, subject, body, debtor_address, attachment_names, '
      + 'email_folder, email_uid, message_id, received_by, query_id, occurred_at')
    .eq('id', accountEmailId)
    .maybeSingle()
  const mail = mailRow as unknown as MailRow | null
  if (mailError) {
    res.status(500).json({ error: mailError.message })
    return
  }
  if (!mail) {
    res.status(404).json({ error: 'That email is no longer on the account.' })
    return
  }
  if (!mail.account_id) {
    res.status(400).json({ error: 'That email is not filed against an account.' })
    return
  }
  /* ONCE PER EMAIL. Pressed twice -- two people reading the same inbox, or a double click -- it
     would raise two tickets for one objection, and on a dispute the second would be refused by
     one_open_dispute_per_account anyway, after the first had already charged item 3. */
  if (mail.query_id) {
    res.status(409).json({ error: 'A ticket has already been raised from this email.' })
    return
  }

  const accountId = mail.account_id
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' })

  /*
   * WHAT THE DEBTOR WROTE, AS THEY WROTE IT.
   *
   * CAPPED, because a description is drawn on a card in a 19rem column and some mail carries a
   * whole thread quoted underneath it. The cap is generous enough for any objection anybody
   * actually writes, and the full text is one press away on the email itself -- which is now
   * linked to this ticket, so nothing is lost by shortening what is shown.
   */
  const written = (mail.body ?? '').replace(/\r\n/g, '\n').trim()
  const subject = (mail.subject ?? '').trim()
  const description = (written.length > 4000 ? `${written.slice(0, 4000)}…` : written)
    || subject
    || 'An email with no text in it.'

  /*
   * THE TICKET: either the one already open on this account, or a new one.
   *
   * On the insert, `alleged_on` AND `received_on` go on together on a dispute: it arrived in
   * writing, which is what this button means. The column's own comment says why alleged is always
   * set -- the deemed-undisputed notice quotes the date, so a null there is a {{brace}} on a
   * notice.
   */
  let ticket: { id: string; kind: string | null } | null = null
  /* What the answer to the caller says happened, and what the timeline records. Only ever true on
     the link path, where a verbal dispute has just become a written one. */
  let nowInWriting = false
  let ticketKind: 'dispute' | 'request' = kind

  if (queryId) {
    const { data: openRow, error: openError } = await admin
      .from('account_queries')
      .select('id, account_id, kind, status, in_writing, received_on')
      .eq('id', queryId)
      .maybeSingle()
    const open = openRow as unknown as {
      id: string; account_id: string | null; kind: string | null
      status: string | null; in_writing: boolean | null; received_on: string | null
    } | null
    if (openError) { res.status(500).json({ error: openError.message }); return }
    /* THE THREE REFUSALS ARE THE THREE WAYS THIS COULD FILE A DEBTOR'S LETTER SOMEWHERE IT DOES
       NOT BELONG: onto another debtor's ticket, onto one that has already been answered, or onto
       nothing at all. Each says which, because the caller picked from a list and a bare "no" here
       reads as the screen being broken. */
    if (!open) { res.status(404).json({ error: 'That ticket no longer exists.' }); return }
    if (open.account_id !== accountId) {
      res.status(400).json({ error: 'That ticket is on a different account.' })
      return
    }
    if (open.status === 'closed') {
      res.status(409).json({ error: 'That ticket has been closed. Raise a new one from this email.' })
      return
    }
    /*
     * A DISPUTE, AND ONLY A DISPUTE.
     *
     * THE FIRM: "it should not be able to link to an open query, like an open information request,
     * because an information request is an internal thing... it just creates the complexity of the
     * dispute handling procedure much worse."
     *
     * AND THE OLD BEHAVIOUR WAS WORSE THAN CONFUSING. This accepted a request as the target and
     * quietly became one: `ticketKind` followed the ticket, so a debtor's WRITTEN DISPUTE was
     * filed as "an email was filed against this request" -- no dispute recorded, `in_writing`
     * never set, `workflow_start_on_dispute` never fired, item 3 never raised, and the collection
     * sequences still running against a debt the debtor had disputed in writing.
     *
     * REFUSED HERE AND NOT ONLY ON THE SCREEN. The box no longer offers a request, but a filter in
     * a browser is a convenience; this is the rule.
     */
    if (open.kind !== 'dispute') {
      res.status(400).json({
        error: 'An email cannot be added to an information request — those are ours to answer. '
          + 'Raise a dispute from it instead.',
      })
      return
    }
    ticket = { id: open.id, kind: open.kind }
    /* The guard above already refused anything else, so a linked ticket is a dispute by
       construction -- the branch that used to follow the ticket's own kind is what let a written
       dispute be filed as a request. */
    ticketKind = 'dispute'
    /*
     * AND THE DISPUTE IS NOW IN WRITING. Only where it was not already -- `workflow_start_on_dispute`
     * fires on this very update, ends the invitation sequence and starts the real one, and it
     * guards on the OLD row for exactly this reason. Writing the same values again on a dispute
     * that already carried them changes nothing, but it would put a second "received in writing"
     * line on the timeline for an email that only confirmed what we had.
     */
    nowInWriting = !open.in_writing && !open.received_on
    if (nowInWriting) {
      const { error: markError } = await admin
        .from('account_queries')
        .update({ received_on: today, in_writing: true })
        .eq('id', open.id)
      if (markError) { res.status(500).json({ error: markError.message }); return }
    }
  } else {
    const { data: created, error: ticketError } = await admin
      .from('account_queries')
      .insert({
        account_id: accountId,
        kind,
        description,
        category: kind === 'dispute' ? (body.category?.trim() || null) : null,
        request_for: requestFor,
        owner_id: body.ownerId || null,
        /* Where it lands follows who it was given to; unassigned, it sits with the desk it came to. */
        stage: body.ownerId ? 'liaison' : 'agent',
        chase_on: body.chaseOn || null,
        raised_by: caller.id,
        alleged_on: kind === 'dispute' ? today : null,
        received_on: kind === 'dispute' ? today : null,
        in_writing: kind === 'dispute',
        status: 'open',
      })
      .select('id, kind')
      .single()
    if (ticketError) {
      /* The refusals here are good ones and their sentences are written to be read -- a second open
         dispute says what to do instead. Passed through rather than replaced. */
      res.status(409).json({ error: ticketError.message })
      return
    }
    ticket = created as unknown as { id: string; kind: string | null }
  }

  /*
   * THE ATTACHMENTS, ONTO THE ACCOUNT AND AGAINST THE TICKET.
   *
   * ONE AT A TIME so a failure can name the file: in parallel the first failure leaves the rest
   * mid-flight and the report below would be a guess. The same reasoning as the case files on Add
   * a debtor, and the same promise to the person pressing it -- the ticket IS raised, so a file
   * that could not be fetched is named rather than pretended away.
   */
  const names = (mail.attachment_names ?? []).filter(Boolean)
  const attached: string[] = []
  const failed: string[] = []
  if (names.length > 0) {
    const { data: conn } = mail.received_by
      ? await admin.from('email_connections').select('*').eq('user_id', mail.received_by).maybeSingle()
      : { data: null }
    if (!conn) {
      failed.push(...names.map((n) => `${n} (the mailbox it arrived in is no longer connected)`))
    } else {
      for (const name of names) {
        try {
          const file = await fetchAttachment(
            conn as { email: string; imap_host: string; imap_port: number; encrypted_password: string },
            {
              folder: mail.email_folder,
              uid: mail.email_uid,
              messageId: mail.message_id,
            },
            name,
          )
          if (!file) { failed.push(`${name} (not found in the mailbox any more)`); continue }
          const safe = name.replace(/[^\w.\-() ]+/g, '_').slice(0, 120)
          const path = `${accountId}/${randomUUID()}-${safe}`
          const up = await admin.storage.from(BUCKET)
            .upload(path, file.content, { contentType: file.contentType, upsert: false })
          if (up.error) { failed.push(`${name} (${up.error.message})`); continue }
          const { error: docError } = await admin.from('account_documents').insert({
            account_id: accountId,
            query_id: ticket.id,
            name,
            storage_path: path,
            mime_type: file.contentType,
            size_bytes: file.content.length,
            /* "Correspondence" rather than a guess: what arrived attached to a debtor's email is
               of a dozen kinds and nothing here can tell them apart. It is re-filed on the
               account page, which is where the list of kinds is. */
            kind: 'Correspondence',
            uploaded_by: caller.id,
            source: 'email',
          })
          if (docError) {
            /* The row failed, so the file is an orphan. Remove it rather than leave a private
               bucket quietly filling with files nothing points at -- uploadDocument's own rule. */
            await admin.storage.from(BUCKET).remove([path])
            failed.push(`${name} (${docError.message})`)
            continue
          }
          attached.push(name)
        } catch (e) {
          failed.push(`${name} (${e instanceof Error ? e.message : String(e)})`)
        }
      }
    }
  }

  /* THE THREAD, ONTO THE TICKET. Last of the links, because it is the one that says "a ticket was
     raised from this" and it must not say so until one was. */
  await admin.from('account_emails').update({ query_id: ticket.id }).eq('id', accountEmailId)

  /*
   * AND THE DEBTOR PAYS FOR A DISPUTE AND FOR NOTHING ELSE, decided by the same function the
   * browser's path uses rather than by an `if` written here. A request raises nothing: a clerk
   * chasing a client for a statement is the client's failing.
   */
  let charged: number | null = null
  /* NOT ON THE LINK PATH. Item 3 was raised when the dispute was raised; a debtor does not pay
     twice because their objection arrived on the telephone first and in the post afterwards. */
  if (!queryId && escalationChargeable(kind)) {
    try {
      const result = await chargeItemWith(admin, {
        accountId,
        itemId: '3',
        actionCode: 'perusal',
        /* "ONE" is what the firm calls item 3 on their own statements. */
        description: 'ONE',
        createdBy: caller.id,
      })
      charged = result.reason === 'charged' ? result.exclVat : 0
    } catch {
      /* A fee that would not write is something to report afterwards, not a reason to undo a
         dispute that has been recorded and has already stopped the collection sequences. */
      charged = null
    }
  }

  /* ON THE ACCOUNT'S OWN TIMELINE, where somebody reading the history tomorrow sees why the
     sequences stopped -- and in the same words the browser's path writes. */
  const filedNote = attached.length > 0
    ? ` (${attached.length} attachment${attached.length === 1 ? '' : 's'} filed)`
    : ''
  await admin.from('account_notes').insert({
    account_id: accountId,
    /* ON THE LINK PATH THE NOTE IS THE EVENT, not the escalation: nothing was raised, an email
       was filed against something that already existed. And where that email is what made a
       verbal dispute a written one, the timeline has to say so -- it is the moment the collection
       sequences stopped, and somebody reading the history tomorrow needs to see why. */
    body: queryId
      ? (nowInWriting
        ? `The dispute was received in writing by email${filedNote}`
        : `An email was filed against this dispute${filedNote}`)
      : `${escalationNote(kind, description.slice(0, 200))}${filedNote}`,
    created_by: caller.id,
    query_id: ticket.id,
    kind: 'query',
  })

  res.status(200).json({
    ok: true,
    ticketId: ticket.id,
    kind: ticketKind,
    /* Whether this email is what turned a verbal dispute into a written one, so the screen can
       say the thing that actually matters: the collection sequences have stopped. */
    linked: !!queryId,
    nowInWriting,
    attached,
    failed,
    charged,
  })
}
