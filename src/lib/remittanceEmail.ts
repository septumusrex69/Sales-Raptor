/**
 * THE REMITTANCE ADVICE, ON ITS WAY TO THE CLIENT.
 *
 * NO NEW ENDPOINT. `api/email/send` already takes base64 attachments in the same JSON body --
 * built for exactly this, and for the reason letterPdf gives: Vercel's Hobby plan caps a project
 * at twelve serverless functions and api/ is at twelve. The PDF is made in the browser, handed
 * over in the request, and never stored. What IS kept is the run, which is frozen the moment it is
 * approved, so a statement regenerated in a year is the same statement.
 *
 * THE RUN IS MARKED SENT ONLY AFTER THE MESSAGE HAS GONE. The other order is the one that hurts:
 * a run marked sent on a message that bounced is a client who is never chased for a statement they
 * never got, and the queue would show the job as done.
 *
 * AND A RUN THAT CANNOT BE PRINTED IS NOT SENT AT ALL. `remittancePdf` reports any character the
 * fourteen standard PDF faces cannot draw -- a debtor's name, usually -- and this refuses rather
 * than substituting, because a name is a word and the firm's rule for a section 129 applies to an
 * invoice too.
 */
import { supabase } from './supabase'
import { emailBodyHtml } from './emailStyle'
import { rand } from './money'
import { advDate, type RemittanceAdvice } from './remittanceAdvice'
import { remittancePdf } from './remittancePdf'
import { markRunSent } from './payover'

export function adviceSubject(adv: RemittanceAdvice): string {
  return `Remittance advice ${adv.run.invoiceNumber} - ${advDate(adv.run.periodStart)} to ${advDate(adv.run.periodEnd)}`
}

/**
 * The covering message. SHORT, because the document is the thing: the net amount, when it is
 * being paid, and where the detail is. The blank lines are content rather than a guess in a
 * renderer -- emailBodyHtml turns each one into a paragraph, which is the firm's own rule after a
 * final notice went out as a single block.
 */
export function adviceBody(adv: RemittanceAdvice): string {
  const when = adv.run.paidAt
    ? `on ${advDate(adv.run.paidAt)}`
    : 'within our normal payment run'
  return [
    'Good day',
    `Please find attached our remittance advice and tax invoice ${adv.run.invoiceNumber} for `
      + `collections from ${advDate(adv.run.periodStart)} to ${advDate(adv.run.periodEnd)}.`,
    `Net amount payable to you: ${rand(adv.run.netPayover)}`
      + `\nPayment: by EFT to your nominated account, ${when}`
      + (adv.run.eftReference ? `\nReference: ${adv.run.eftReference}` : ''),
    'The attached statement lists every payment behind that figure, account by account.',
    'Kind regards\nBredell Ferreira',
  ].join('\n\n')
}

export async function sendRemittanceAdvice(
  adv: RemittanceAdvice,
  to: string,
  runId: string,
): Promise<void> {
  const { bytes, problem } = await remittancePdf(adv)
  if (problem) throw new Error(problem)

  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new Error('Your session has expired. Sign in again.')

  const res = await fetch('/api/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      to,
      subject: adviceSubject(adv),
      bodyHtml: emailBodyHtml(adviceBody(adv)),
      attachments: [{
        filename: `${adv.run.invoiceNumber}.pdf`,
        contentType: 'application/pdf',
        content: base64(bytes),
      }],
    }),
  })
  const body = await res.json().catch(() => ({})) as { error?: string }
  if (!res.ok) throw new Error(body.error ?? 'The statement could not be emailed.')

  await markRunSent(runId)
}

/** Bytes to base64 without blowing the stack on a long statement. */
function base64(bytes: Uint8Array): string {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(s)
}
