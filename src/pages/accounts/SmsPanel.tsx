import { MessageSquare } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { SMS_STATUS_WORDS, smsWhen, type AccountSms } from '../../lib/smsView'

/**
 * Every SMS either way on this account, in full, with the time it went.
 *
 * Newest first, like the Emails tab and the Activity timeline beside it. The text is shown whole
 * rather than behind a click: an SMS is at most a few lines, and the words of a Section 129 reminder
 * are exactly what somebody opens the account to read.
 */
export function SmsPanel({ messages }: { messages: AccountSms[] }) {
  const sent = messages.filter((m) => m.direction === 'outbound').length
  const received = messages.length - sent
  return (
    <Card>
      <h3 className="text-[11px] uppercase tracking-wide text-slate-400">SMS</h3>
      <p className="text-lg text-slate-700 mb-3">{sent} sent · {received} received</p>
      {messages.length === 0 && (
        <p className="text-sm text-slate-400 py-6 text-center">No SMS has been sent to this debtor yet.</p>
      )}
      <ul className="divide-y divide-slate-100">
        {messages.map((m) => (
          <li key={m.id} className="py-3 flex gap-3" data-testid="sms-row">
            <div className="w-6 h-6 rounded-full bg-slate-100 grid place-items-center shrink-0">
              <MessageSquare size={12} className="text-slate-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-500">
                <span className="font-medium text-slate-700">{m.direction === 'outbound' ? 'To' : 'From'} {m.msisdn}</span>
                {' · '}<span className="tabular-nums">{smsWhen(m.at)}</span>
                {' · '}{SMS_STATUS_WORDS[m.status] ?? m.status}
                {m.statusDetail && m.status === 'failed' ? ` (${m.statusDetail})` : ''}
              </p>
              <p className="text-sm text-slate-800 whitespace-pre-wrap wrap-anywhere mt-0.5">{m.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
