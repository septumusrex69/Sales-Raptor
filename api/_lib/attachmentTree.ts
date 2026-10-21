import { simpleParser } from 'mailparser'
import { NESTED_SEPARATOR, attachmentNamesOf, isAttachedEmail, listedAttachments } from './mime.js'

/*
 * ITS OWN MODULE so a check can run it against a real nested message (check-mime-parts): it needs
 * mailparser and nothing else, where emailSync pulls in IMAP and the database.
 */
export type ParsedAttachment = { filename?: string; related?: boolean; contentDisposition?: string; contentType?: string; content?: unknown }

/**
 * EVERY FILE ON A MESSAGE, INCLUDING THOSE INSIDE ITS ATTACHED EMAILS, each with the name it is
 * listed and asked for under (see NESTED_SEPARATOR). Two levels in, which is a forward of a
 * forward; past that a reader opens the email. One walk for the sync and the download, so a name
 * the sync recorded is a name the download can find.
 */
export async function attachmentTree(
  attachments: ParsedAttachment[] | undefined, depth = 0,
): Promise<{ name: string; att: ParsedAttachment }[]> {
  const listed = listedAttachments(attachments)
  const names = attachmentNamesOf(listed)
  const out: { name: string; att: ParsedAttachment }[] = []
  for (let i = 0; i < listed.length; i += 1) {
    out.push({ name: names[i], att: listed[i] })
    const content = listed[i].content
    if (depth >= 2 || !isAttachedEmail(listed[i]) || !Buffer.isBuffer(content)) continue
    try {
      const inner = await simpleParser(content)
      for (const child of await attachmentTree(inner.attachments as ParsedAttachment[], depth + 1)) {
        out.push({ name: `${names[i]}${NESTED_SEPARATOR}${child.name}`, att: child.att })
      }
    } catch {
      /* An attached email that will not parse is still listed itself; only its insides are not. */
    }
  }
  return out
}
