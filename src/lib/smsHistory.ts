/**
 * Reads the SMSs on one account back out of sms_messages (R-10). Kept apart from smsView.ts because
 * this pulls in the Supabase client and a check cannot import it.
 */
import { toSms, type AccountSms, type SmsRow } from './smsView.ts'
import { supabase } from './supabase'

export async function fetchAccountSms(accountId: string): Promise<AccountSms[]> {
  const { data, error } = await supabase
    .from('sms_messages')
    .select('id, direction, msisdn, body, segments, status, status_detail, sent_at, delivered_at, created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as SmsRow[]).map(toSms)
}
