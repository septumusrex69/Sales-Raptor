/**
 * The SMSs on an account, as the SMS tab draws them -- no database in here, so a check can import it.
 *
 * A change request (R-10, Call centre) asked for it: the Activity timeline says "Handover SMS sent
 * to 0645498432" and the Emails tab shows every email in full, but the words of the SMS and the
 * time it went were nowhere on the account. They have always been in `sms_messages` -- the workflow
 * writes the row beside the timeline note -- and nothing in the browser read them back.
 *
 * READ-ONLY, AND ON PURPOSE. An SMS is sent by the workflow or from the SMS box, both of which
 * charge Annexure B item 1(c); a list that could also send would be a second way to raise that fee.
 */
import { firmDay, shortDate } from './dateLabels.ts'

export interface AccountSms {
  id: string
  direction: 'outbound' | 'inbound'
  msisdn: string
  body: string
  segments: number
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'received'
  statusDetail: string | null
  /** When it went (or arrived): the network's moment, falling back to the row's own. */
  at: string
  deliveredAt: string | null
}

export interface SmsRow {
  id: string
  direction: 'outbound' | 'inbound'
  msisdn: string
  body: string
  segments: number
  status: AccountSms['status']
  status_detail: string | null
  sent_at: string | null
  delivered_at: string | null
  created_at: string
}

export function toSms(r: SmsRow): AccountSms {
  return {
    id: r.id,
    direction: r.direction,
    msisdn: r.msisdn,
    body: r.body,
    segments: r.segments,
    status: r.status,
    statusDetail: r.status_detail,
    /* A queued row has no sent_at yet; created_at is when the firm pressed send. */
    at: r.sent_at ?? r.created_at,
    deliveredAt: r.delivered_at,
  }
}

/**
 * "27 Oct 2026 · 14:32", in Johannesburg wherever the person is sitting (the firm's books are kept
 * on that clock -- see firmDay). 24-hour, because "14:32" cannot be misread the way a stray am/pm
 * can. The hour is the point: three reminders in a day read as one without it.
 */
export function smsWhen(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const time = at.toLocaleTimeString('en-ZA', {
    timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  return `${shortDate(firmDay(iso))} · ${time}`
}

/** The firm's words for where a message got to, not the column's. */
export const SMS_STATUS_WORDS: Record<AccountSms['status'], string> = {
  queued: 'Queued',
  sent: 'Sent',
  delivered: 'Delivered',
  failed: 'Failed',
  received: 'Received',
}
