import { useState } from 'react'
import { Loader2, MessageSquare } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { smsCost } from '../../lib/smsSegments'
import { sendCrmSms, crmSmsActivity, type CrmSmsTarget } from '../../lib/crmSms'

/**
 * Text a lead, a client, or the person on a deal.
 *
 * The debtor's version of this box shows what the message will COST, because Annexure B item 1(c)
 * recovers R3.50 a segment from a debtor and a collector should see the charge before they press
 * send. This one says the opposite, out loud: nobody is charged. A lead owes the firm nothing and
 * a client is the person paying the firm.
 *
 * Saying it on the screen rather than only in the code is deliberate. Somebody who has used the
 * debtor's box will expect a fee, and an unexplained absence is how a habit turns into a doubt —
 * "did that charge them?" is not a question anybody should have to ask twice.
 *
 * The segment count stays, because it is not about money here: it is about whether the message
 * arrives as one text or three, which changes how it reads at the other end.
 */
export function CrmSmsModal({ numbers, target, who, onClose, onSent }: {
  /** Every number that could reach them, primary first. */
  numbers: { label: string; value: string }[]
  /** Which record this belongs to. Exactly one — the database enforces it too. */
  target: CrmSmsTarget
  /** How the message should read on the timeline: "SMS to Piet Pompies". */
  who: string
  onClose: () => void
  /** Write it onto the record. Handed back rather than written here — see crmSmsActivity. */
  onSent: (activity: { subject: string; notes: string }) => void
}) {
  const { session } = useAuth()
  const [to, setTo] = useState(numbers[0]?.value ?? '')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ segments: number } | null>(null)

  const cost = smsCost(text)

  async function send() {
    if (!session?.access_token || !text.trim() || !to) return
    setBusy(true)
    setError(null)
    try {
      const result = await sendCrmSms({ accessToken: session.access_token, to, text, target })
      onSent(crmSmsActivity({ to, text, sent: result, who }))
      setSent({ segments: result.segments })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`SMS ${who}`} onClose={onClose} width={520}>
      {sent ? (
        <div>
          <p className="text-sm text-slate-700">
            Sent to {to}{sent.segments > 1 && <> as {sent.segments} messages</>}. Nothing was charged.
          </p>
          <p className="text-xs text-slate-400 mt-2">
            It is on this record&rsquo;s timeline. Delivery is confirmed separately by the network,
            so the status can still change.
          </p>
          <div className="flex justify-end mt-5">
            <button type="button" onClick={onClose}
              className="text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900">
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/*
            One number is a sentence; several is a choice. A one-option dropdown makes the common
            case look like a decision somebody has to make.
          */}
          {numbers.length <= 1 ? (
            <p className="text-sm text-slate-500">
              To <span className="font-medium text-slate-700">{to || 'no number on file'}</span>
            </p>
          ) : (
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Send to</span>
              <select value={to} onChange={(e) => setTo(e.target.value)}
                className="w-full mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white">
                {numbers.map((n) => (
                  <option key={`${n.label}-${n.value}`} value={n.value}>{n.value} — {n.label}</option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Message</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} autoFocus
              placeholder="Morning Piet — the mandate is ready whenever you are."
              className="w-full mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-100" />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            {/* Length, not price. A long message arrives as several texts, which changes how it
                reads at the other end even though it costs the firm nothing to recover. */}
            <span className="text-slate-400">
              {text.trim()
                ? <>{cost.units} characters · {cost.segments === 1 ? 'one message' : `${cost.segments} messages`} · {cost.encoding}</>
                : 'Nothing typed yet'}
            </span>
            <span className="text-slate-500 font-medium">No charge</span>
          </div>

          {/*
            Said plainly, because somebody who has used the debtor's box will be looking for a
            fee here and not finding one.
          */}
          <p className="text-xs text-slate-400">
            Nothing is charged for this. The R3,50 a message under Annexure B item 1(c) is
            recovered from a DEBTOR, for the work of collecting from them &mdash; it has nothing
            to do with a lead or a client.
          </p>

          {error && <p className="text-sm text-negative-700">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-2">
              Cancel
            </button>
            <button type="button" onClick={() => void send()} disabled={busy || !text.trim() || !to}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg border border-gold-500 bg-gold-400 text-navy-950 hover:bg-gold-500 disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
              Send
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
