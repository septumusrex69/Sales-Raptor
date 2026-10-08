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
 * at twelve serverless functions and api/ is at twelve. The PDF is made in the browser and handed
 * over in the request.
 *
 * WHAT WAS SENT IS KEPT, EXACTLY AS IT WAS SENT. The firm, 8 Oct: "whatever is paid and what has
 * been sent to a client should always stick there ... It couldn't change ... you can revise one and
 * then send it again, but if something was sent, there should be ... a record of ... the data that
 * was sent." The run is frozen on approval, but a statement REBUILT from it is not the one sent once
 * the firm's address, the client's VAT number or the layout moves. So every send stores the very
 * PDF and spreadsheet that were attached (bucket `payover-advice`, add-and-read only) and the whole
 * advice as data (`payover_run_sends`, which a trigger refuses to edit). Sending again is a new
 * version beside the old one, never a replacement.
 *
 * THE ORDER IS FILES, THEN EMAIL, THEN RECORD. Files first, so a record can never point at a copy
 * that is not there; the record last, so an email that failed leaves no record saying it went. A
 * failed email leaves two orphan files nobody links to, which is the cheap failure.
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
  adviceBody, adviceCopyPaths, adviceSchedule, adviceSubject, type RemittanceAdvice,
} from './remittanceAdvice'
import { remittancePdf } from './remittancePdf'
import { markRunSent } from './payover'
import { XLSX_MIME, toBase64 } from './xlsxWrite'

export async function sendRemittanceAdvice(
  adv: RemittanceAdvice,
  to: string,
  run: { id: string; companyId: string; status: string },
): Promise<void> {
  const { bytes, problem } = await remittancePdf(adv)
  if (problem) throw new Error(problem)
  const sheet = adviceSchedule(adv)
  const subject = adviceSubject(adv)

  /* A stamp nobody else can have, and upsert off: a copy is written once, never over. */
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`
  const paths = adviceCopyPaths(run.companyId, adv.run.invoiceNumber, stamp)
  const store = supabase.storage.from('payover-advice')
  const up1 = await store.upload(paths.pdf, new Blob([bytes as BlobPart], { type: 'application/pdf' }), { upsert: false })
  if (up1.error) throw new Error(`The copy of the statement could not be kept, so it was not sent: ${up1.error.message}`)
  const up2 = await store.upload(paths.xlsx, new Blob([sheet as BlobPart], { type: XLSX_MIME }), { upsert: false })
  if (up2.error) throw new Error(`The copy of the schedule could not be kept, so it was not sent: ${up2.error.message}`)

  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new Error('Your session has expired. Sign in again.')

  const res = await fetch('/api/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      to,
      subject,
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
          content: toBase64(sheet),
        },
      ],
    }),
  })
  const body = await res.json().catch(() => ({})) as { error?: string }
  if (!res.ok) throw new Error(body.error ?? 'The statement could not be emailed.')

  /* It has gone. From here a failure must SAY it went, or somebody sends it twice. */
  const { error: recErr } = await supabase.rpc('record_payover_send', {
    p_run: run.id, p_sent_to: to, p_subject: subject,
    p_snapshot: adv as unknown as Record<string, unknown>,
    p_pdf_path: paths.pdf, p_xlsx_path: paths.xlsx,
  })
  if (recErr) throw new Error(`The statement was emailed, but the record of it could not be written: ${recErr.message}`)

  /* A second send of a sent or paid run is a revision, not a step: its status stays. */
  if (run.status === 'approved') await markRunSent(run.id)
}

export interface AdviceSend {
  id: string
  runId: string
  version: number
  sentAt: string
  sentTo: string
  subject: string
  netPayover: number
  pdfPath: string
  xlsxPath: string
}

/** Every copy sent, newest first: one run's, or a client's across all its runs. */
export async function fetchAdviceSends(by: { runId?: string; companyId?: string }): Promise<AdviceSend[]> {
  let q = supabase.from('payover_run_sends')
    .select('id, run_id, version, sent_at, sent_to, subject, net_payover, pdf_path, xlsx_path')
    .order('sent_at', { ascending: false })
  if (by.runId) q = q.eq('run_id', by.runId)
  if (by.companyId) q = q.eq('company_id', by.companyId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), runId: String(r.run_id), version: Number(r.version),
    sentAt: String(r.sent_at), sentTo: String(r.sent_to), subject: String(r.subject),
    netPayover: Number(r.net_payover), pdfPath: String(r.pdf_path), xlsxPath: String(r.xlsx_path),
  }))
}

/** Opens a kept copy. A short-lived link: the bucket is private, and stays so. */
export async function openAdviceCopy(path: string): Promise<void> {
  const win = window.open('', '_blank')
  const { data, error } = await supabase.storage.from('payover-advice').createSignedUrl(path, 120)
  if (error || !data) { win?.close(); throw new Error(error?.message ?? 'That copy could not be opened.') }
  if (win) win.location.href = data.signedUrl
  else window.location.href = data.signedUrl
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
