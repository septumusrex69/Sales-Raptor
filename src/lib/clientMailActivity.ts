/**
 * A CLIENT'S EMAIL ABOUT AN ACCOUNT, PUT ON THE CLIENT'S OWN RECORD.
 *
 * THE FIRM: "This email came from the client and then it came to the debtor account. Should go to
 * the ticket if there was one and or go to the client profile." account_emails.correspondent keeps
 * a client's mail out of the debtor's Emails tab -- the record a section 129 proof of
 * communication rests on -- so where there is no ticket, this activity is the only place it shows.
 *
 * TWO WRITERS, ONE ROW. The sync wrote it for mail it matched by itself; mail a PERSON filed by
 * hand from the mailbox got nothing and was on nobody's screen (HANDOFF section 5). Both now build
 * the row here, so the client page cannot show the two arrivals differently.
 *
 * IDEMPOTENT ON (user_id, email_message_id) where there is a Message-ID -- the callers upsert with
 * ignoreDuplicates on that index, so a resync or a second filing cannot put it there twice.
 *
 * FEES ARE NOT HERE. The item 6 charge on a client's email about an account stays on the debtor
 * (the firm: "you can just keep it there"), and is raised by the filing itself.
 */
export interface ClientMailInput {
  /** Whose mailbox it arrived in; the activity is theirs, as every email activity is. */
  userId: string
  companyId: string
  subject: string | null
  body: string | null
  at: string
  messageId: string | null
  attachmentNames: string[]
  toRecipients: { name: string | null; address: string }[]
  ccRecipients: { name: string | null; address: string }[]
  folder: string | null
  uid: number | null
}

export function clientMailActivity(m: ClientMailInput) {
  return {
    type: 'Email',
    user_id: m.userId,
    company_id: m.companyId,
    subject: `Email received: ${m.subject ?? ''}`,
    notes: m.body,
    activity_date: m.at,
    email_message_id: m.messageId,
    /* UNREAD, even when a person filed it: the person filing has read it, but the client's record
       belongs to the liaison, who has not. */
    is_read: false,
    attachment_names: m.attachmentNames,
    email_to_recipients: m.toRecipients,
    email_cc_recipients: m.ccRecipients,
    email_folder: m.folder,
    email_uid: m.uid,
  }
}
