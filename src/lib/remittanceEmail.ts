/**
 * THE REMITTANCE ADVICE, ON ITS WAY TO THE CLIENT.
 *
 * ONLY THE SENDING LIVES HERE. The subject, the covering message and the spreadsheet are in
 * remittanceAdvice.ts, which touches no network and no Supabase client -- the same split
 * emailStyle.ts was carved out of firmSettings.ts for, and for the same reason: a check script
 * cannot import a module that pulls in the Supabase client, so a pure function stranded in one
 * can only ever be read back as text.
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
import {
  adviceBody, adviceSchedule, adviceSubject, type RemittanceAdvice,
} from './remittanceAdvice'
import { remittancePdf } from './remittancePdf'
import { markRunSent } from './payover'
import { XLSX_MIME, toBase64 } from './xlsxWrite'

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
      attachments: [
        {
          filename: `${adv.run.invoiceNumber}.pdf`,
          contentType: 'application/pdf',
          content: base64(bytes),
        },
        {
          filename: `${adv.run.invoiceNumber} schedule.xlsx`,
          contentType: XLSX_MIME,
          content: toBase64(adviceSchedule(adv)),
        },
      ],
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
