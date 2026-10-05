import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient } from '../auth.js'
import { credentialsKeyProblem } from '../crypto.js'
import { sendAsUser } from './sendAsUser.js'
import { blankLetter, A4_LETTERHEAD } from '../../../src/lib/letterDocument.js'
import { letterToPdf, letterFilename } from '../../../src/lib/letterPdf.js'
import { fetchCharter, isCharter } from '../../../src/lib/charter.js'
import { withFilled } from '../../../src/lib/signingBlanks.js'
import { emailBodyHtml } from '../../../src/lib/emailStyle.js'
import type { SignedMark } from '../../../src/lib/signedMark.js'

/**
 * THE SIGNED COPY, BACK TO THE DEBTOR AND TO THE COLLECTOR, THE MOMENT IT IS SIGNED.
 *
 * THE FIRM: "it should go out as an email after it's signed in a PDF format to the debtor and to
 * the debt collector." Before this, a signed agreement sat on the account until somebody noticed
 * it and pressed a button -- which on their first run meant the debtor signed and heard nothing.
 *
 * ------------------------------------------------------------------------------------------------
 * WHY THIS IS A SERVER ROUTE AND NOT THE PAGE THAT SIGNED
 * ------------------------------------------------------------------------------------------------
 *
 * The signer is ANONYMOUS. They have no mailbox, and the anon role has no rights on anything this
 * needs. So the signing page asks for this, and everything that decides what goes out is read here
 * from the frozen request: the blocks, the sheet, the blanks, the mark, the name.
 *
 * NOTHING THE CALLER SENDS IS TRUSTED EXCEPT THE TOKEN. The caller does not supply the PDF, the
 * addresses, or a word of the message -- if they did, anybody holding a link could email the firm's
 * collector a doctored copy of an agreement on the firm's own letterhead, from the firm's own
 * mailbox. The token is the authority and it is the only input.
 *
 * ------------------------------------------------------------------------------------------------
 * AND IT CANNOT SEND TWICE
 * ------------------------------------------------------------------------------------------------
 *
 * A reload, a second tab, a debtor who taps back -- each would be another copy and another item
 * 1(a). `copy_sent_at` is CLAIMED BEFORE the send, conditionally on its still being null, so the
 * second caller's update matches no rows and it stops. Claiming first means a send that fails
 * leaves the row claimed and nothing goes; that is the right way round, because the firm's own
 * "Email the signed copy" button is still there to send it by hand, and an unsent copy somebody
 * notices beats two copies nobody asked for.
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
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) {
    res.status(500).json({ error: keyProblem })
    return
  }

  const token = typeof (req.body as { token?: unknown })?.token === 'string'
    ? (req.body as { token: string }).token
    : ''
  if (!token) {
    res.status(400).json({ error: 'No token.' })
    return
  }

  /*
   * NAMED BY HAND, like every row shape in this codebase. The admin client is untyped, so without
   * this the fields come back as a union with PostgREST's own error shape and every read of one is
   * a type error -- see the warning in CLAUDE.md about hand-written mappers: a column missing from
   * a list like this reads as undefined for ever and nothing fails.
   */
  interface RequestRow {
    id: string
    account_id: string | null
    title: string
    body: unknown
    page_setup: unknown
    blanks: unknown
    filled: unknown
    state: string
    signed_at: string | null
    signature_png: string | null
    initials_png: string | null
    signed_name: string | null
    copy_sent_at: string | null
  }

  const { data: found } = await admin
    .from('signing_requests')
    .select('id, account_id, title, body, page_setup, blanks, filled, state, signed_at, '
      + 'signature_png, initials_png, signed_name, copy_sent_at')
    .eq('token', token)
    .maybeSingle()
  const request = found as RequestRow | null

  /*
   * SILENT ON EVERYTHING THAT IS NOT AN ERROR. A token that opens nothing, a request not yet
   * signed, a copy already sent -- none of them is a fault the signer can do anything about, and
   * this is reachable by anybody, so it must not confirm which tokens exist. The signing page
   * ignores the answer either way.
   */
  if (!request || request.state !== 'signed' || request.copy_sent_at) {
    res.status(200).json({ sent: false })
    return
  }

  /* THE CLAIM. Conditional on copy_sent_at still being null -- see the header. */
  const { data: claimed } = await admin
    .from('signing_requests')
    .update({ copy_sent_at: new Date().toISOString() })
    .eq('id', request.id)
    .is('copy_sent_at', null)
    .select('id')
  if (!claimed || claimed.length === 0) {
    res.status(200).json({ sent: false })
    return
  }

  /*
   * WHO IT GOES TO. The debtor, and the collector whose account it is -- the firm asked for both,
   * and the collector's copy is the half that matters operationally: it is the evidence landing in
   * the inbox of the person who will act on it.
   *
   * AND IT IS SENT FROM THE COLLECTOR'S OWN MAILBOX, so a reply reaches the person working the
   * file rather than a no-reply nobody reads.
   */
  const { data: foundAccount } = await admin
    .from('debtor_accounts')
    .select('id, account_number, case_number, assigned_to, debtor_first_name, debtor_surname')
    .eq('id', request.account_id)
    .maybeSingle()
  const account = foundAccount as {
    id: string
    account_number: string | null
    case_number: string | null
    assigned_to: string | null
    debtor_first_name: string | null
    debtor_surname: string | null
  } | null
  if (!account?.assigned_to) {
    res.status(200).json({ sent: false, reason: 'no collector' })
    return
  }
  const { data: foundCollector } = await admin
    .from('profiles').select('id, name, email').eq('id', account.assigned_to).maybeSingle()
  const collector = foundCollector as { name: string | null; email: string | null } | null

  const { data: foundContacts } = await admin
    .from('account_contacts')
    .select('kind, value, is_primary, retired_at')
    .eq('account_id', account.id)
  const contacts = (foundContacts ?? []) as {
    kind: string; value: string | null; is_primary: boolean | null; retired_at: string | null
  }[]
  /* THE PRIMARY ONE, AND NEVER A RETIRED ONE -- the same rule contactOf applies everywhere else:
     an address somebody established is wrong is worse than none, because it looks delivered. */
  const live = contacts.filter((c) => c.kind === 'email' && !c.retired_at)
  const to = (live.find((c) => c.is_primary) ?? live[0])?.value ?? ''
  if (!to) {
    res.status(200).json({ sent: false, reason: 'no address' })
    return
  }

  /*
   * THE PDF, DRAWN HERE FROM THE SAME PIECES THE FIRM'S OWN COPY IS DRAWN FROM.
   *
   * CHARTER IS FETCHED FROM THIS DEPLOYMENT. The font paths are root-relative, which node cannot
   * resolve -- left alone, the debtor's copy would print in Times while the one the firm files
   * prints in Charter, and two different-looking documents for one agreement is worse than either.
   */
  const page = (request.page_setup ?? A4_LETTERHEAD) as typeof A4_LETTERHEAD
  const doc = { ...blankLetter(), blocks: request.body as ReturnType<typeof blankLetter>['blocks'] }
  const origin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''

  let letterhead: { bytes: Uint8Array; type: 'png' | 'jpg' } | null = null
  if (page.backgroundUrl) {
    try {
      const got = await fetch(page.backgroundUrl)
      if (got.ok) {
        letterhead = {
          bytes: new Uint8Array(await got.arrayBuffer()),
          type: /\.jpe?g($|\?)/i.test(page.backgroundUrl) ? 'jpg' : 'png',
        }
      }
    } catch { /* Plain paper rather than no document. */ }
  }

  const signed: SignedMark | null = request.signature_png && request.signed_name && request.signed_at
    ? {
      signaturePng: request.signature_png,
      name: request.signed_name,
      signedAt: request.signed_at,
      initialsPng: request.initials_png,
    }
    : null

  let bytes: Uint8Array
  try {
    bytes = await letterToPdf({
      doc,
      page,
      filled: true,
      values: withFilled({}, (request.blanks ?? []) as never, (request.filled ?? {}) as never),
      letterhead,
      charter: isCharter(doc.defaults.font) ? await fetchCharter(origin) : null,
      signed,
    })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
    return
  }

  const who = [account.debtor_first_name, account.debtor_surname].filter(Boolean).join(' ').trim()
  const reference = account.case_number ?? account.account_number
  /*
   * SHORT, like the covering email that sent them the link. Everything that matters is in the
   * attachment, which they have just read and signed; a message that explains the agreement is a
   * second version of the agreement, and the two can disagree.
   */
  const words = `${who ? `Dear ${who}` : 'Good day'}\n\n`
    + 'Thank you. Attached is the signed copy of your acknowledgement of debt, for your records.'
    + `${reference ? ` Our reference is ${reference}.` : ''}\n\n`
    + 'Kind regards'

  const sendResult = await sendAsUser(admin, account.assigned_to, {
    to,
    /* THE COLLECTOR GETS IT AS A COPY rather than as a second message: one send, one charge, and
       the thread a reply lands in is the one the debtor can see they are replying to. */
    cc: collector?.email ?? null,
    subject: `Signed acknowledgement of debt${reference ? ` - ${reference}` : ''}`,
    bodyHtml: emailBodyHtml(words),
    attachments: [{
      filename: letterFilename(`${request.title} signed`, request.signed_name),
      content: Buffer.from(bytes),
      contentType: 'application/pdf',
    }],
  })

  if (!sendResult.ok) {
    res.status(200).json({ sent: false, reason: sendResult.error })
    return
  }

  /*
   * AND IT IS RECORDED AGAINST THE ACCOUNT, like every other message that leaves the firm --
   * otherwise the one email the firm did not send by hand is the one email the file has no record
   * of. Charged under item 1(a) by the same rule as any other: the firm sent it.
   */
  await admin.from('account_emails').insert({
    account_id: account.id,
    direction: 'out',
    debtor_address: to,
    our_address: sendResult.from,
    subject: `Signed acknowledgement of debt${reference ? ` - ${reference}` : ''}`,
    body: words,
    message_id: sendResult.messageId,
    sent_by_name: collector?.name ?? null,
    attachment_names: ['Signed acknowledgement of debt'],
    occurred_at: new Date().toISOString(),
  })

  res.status(200).json({ sent: true })
}
