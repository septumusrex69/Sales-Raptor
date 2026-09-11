import { useState } from 'react'
import { Loader2, MessageSquare } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { recordSentSms, sendAccountSms } from '../../lib/accountSms'
import { smsCost } from '../../lib/smsSegments'
import { scheduleFor } from '../../lib/annexureB'

/**
 * Write a debtor an SMS.
 *
 * The cost is shown while you type, not after you send, because it is the only decision the writer
 * actually has: 161 characters costs twice what 160 does, and one curly apostrophe pasted out of
 * Word costs more than that again. A collector who can see "2 messages, R6.90" before they press
 * send will shorten it; one who finds out on the statement will not.
 */
export function SmsModal({ accountId, to, onClose, onDone }: {
  accountId: string
  to: string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { session, currentUser } = useAuth()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ segments: number; charged: string } | null>(null)

  const cost = smsCost(text)
  const rate = scheduleFor(new Date()).items.find((i) => i.id === '1c')?.amount ?? 0
  const price = rate * Math.max(1, cost.segments)

  async function send() {
    if (!session?.access_token || !text.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await sendAccountSms({ accessToken: session.access_token, accountId, to, text })
      // The message is gone; the fee and the note are bookkeeping after the fact.
      const charge = await recordSentSms({
        accountId,
        sent: result,
        text,
        actor: { id: currentUser?.id ?? null, name: currentUser?.name ?? null },
      })
      setSent({
        segments: result.segments,
        charged: charge.reason === 'charged' ? `R${charge.exclVat.toFixed(2)} plus VAT` : 'nothing',
      })
      await onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Send an SMS" onClose={onClose} width={520}>
      {sent ? (
        <div>
          <p className="text-sm text-slate-700">
            Sent to {to}{sent.segments > 1 && <> as {sent.segments} messages</>}, and charged {sent.charged}.
          </p>
          <p className="text-xs text-slate-400 mt-2">
            It is on the account&apos;s timeline. Delivery is confirmed separately by the network, so the
            status can still change.
          </p>
          <div className="flex justify-end mt-5">
            <button onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900">
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">To <span className="font-medium text-slate-700">{to}</span></p>
          <textarea
            rows={5}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Keep it short — every 160 characters is another R3.50 on the account."
            className="w-full text-sm rounded-lg border border-slate-200 px-2.5 py-2 resize-none"
          />

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <span className="text-slate-500">
              {cost.units} characters &middot; {cost.segments || 0} message{cost.segments === 1 ? '' : 's'}
            </span>
            {cost.segments > 0 && (
              <span className="font-medium text-slate-700">R{price.toFixed(2)} plus VAT</span>
            )}
            {/* The expensive surprise: one character outside the GSM alphabet more than halves
                what fits, and it is almost always a quote mark pasted out of a document. */}
            {cost.encoding === 'UCS-2' && (
              <span className="text-[var(--c-rust-deep)]">
                {cost.offending.slice(0, 3).join(' ')} {cost.offending.length > 3 ? '…' : ''} cuts each message to 70 characters
              </span>
            )}
          </div>

          {error && <p className="text-sm text-negative-700">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => void send()}
              disabled={busy || !text.trim()}
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900 disabled:opacity-40"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
              {busy ? 'Sending…' : 'Send SMS'}
            </button>
            <button onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-500 hover:bg-slate-100">
              Cancel
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
