import { useMemo, useState } from 'react'
import { Loader2, MessageSquare } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { useAuth } from '../../store/AuthContext'
import { recordSentSms, sendAccountSms } from '../../lib/accountSms'
import { smsCost } from '../../lib/smsSegments'
import { scheduleFor } from '../../lib/annexureB'
import { missingFieldsNote } from '../../lib/messageTemplates'
import { UseTemplate } from '../../components/library/UseTemplate'

/**
 * Write a debtor an SMS.
 *
 * The cost is shown while you type, not after you send, because it is the only decision the writer
 * actually has: 161 characters costs twice what 160 does, and one curly apostrophe pasted out of
 * Word costs more than that again. A collector who can see "2 messages, R6.90" before they press
 * send will shorten it; one who finds out on the statement will not.
 */
export function SmsModal({ accountId, debtorKind, numbers, values, onClose, onDone }: {
  accountId: string
  /** Which half of the library to offer: the firm's wording is written twice, person and company. */
  debtorKind: 'individual' | 'company'
  /** Every number on the account, primary first. The collector picks; the app does not guess. */
  numbers: { label: string; value: string }[]
  /**
   * What the firm's wording is merged against, resolved by the page that opened this.
   *
   * At the firm's instruction: "everything that we have in the library, to be in the account as
   * well as an option." Before this, an SMS template could only be read in the library and typed
   * out again from memory -- which is how a message the firm priced at R3.50 goes out at R7.00
   * because somebody's retyping ran to 161 characters.
   */
  values: Record<string, string>
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { session, currentUser } = useAuth()
  const [to, setTo] = useState(numbers[0]?.value ?? '')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ segments: number; charged: string } | null>(null)
  /* Named once, when the template lands. Not recomputed as the collector edits: they may well be
     typing the missing figure in by hand, and a warning that will not go away is one people learn
     to look past. */
  const [missing, setMissing] = useState<string[]>([])

  /*
   * THE APP'S OWN FORMATTING, MADE SAFE FOR THIS CHANNEL — and this is a money fix, not tidiness.
   *
   * en-ZA groups thousands with a NON-BREAKING SPACE (CLAUDE.md says so, and formatMoney obliges),
   * so a merged {{balance}} arrives carrying U+00A0. That character is not in the GSM alphabet, so
   * ONE of them drops the whole message to UCS-2 and cuts every segment from 160 characters to 70.
   * Measured on the real thing: "Good day Mhlongo. Your account REF/0 is R 180,000.00 in arrears.
   * Please telephone Test Leader." is 94 characters — one segment at R3.50 with an ordinary space,
   * TWO at R7.00 with the non-breaking one. Every templated SMS carrying a balance cost the firm
   * double, and the warning it produced named the offending character as " ", which nobody could
   * act on.
   *
   * ONLY THE VALUES THE APP MERGED IN, never what the collector typed. The warning beside the box
   * deliberately tells a writer about a curly apostrophe rather than silently rewriting their
   * words, and that stays true. But the firm should not be charged twice for a space Raptor chose
   * to put there itself.
   *
   * A non-breaking space means nothing in an SMS that an ordinary one does not: there is no line
   * to break.
   */
  const smsValues = useMemo(
    () => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.replace(/\u00a0/g, ' ')])),
    [values],
  )

  const cost = smsCost(text)
  const rate = scheduleFor(new Date()).items.find((i) => i.id === '1c')?.amount ?? 0
  const price = rate * Math.max(1, cost.segments)

  async function send() {
    if (!session?.access_token || !text.trim() || !to) return
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
          {/*
            One number is a sentence; several is a choice. Rendering a one-option dropdown would
            make the common case look like a decision somebody has to make.
          */}
          {numbers.length <= 1 ? (
            <p className="text-sm text-slate-500">To <span className="font-medium text-slate-700">{to || 'no number on file'}</span></p>
          ) : (
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Send to</span>
              <select
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full mt-1 text-sm rounded-lg border border-slate-200 px-2.5 py-2 bg-white"
              >
                {numbers.map((n) => (
                  <option key={n.value} value={n.value}>{n.value} — {n.label}</option>
                ))}
              </select>
            </label>
          )}
          {/*
            THE FIRM'S OWN WORDING, ABOVE THE BOX. The cost line below updates as soon as it
            lands, so a template that runs to two segments says so before it is sent rather than
            on the statement.
          */}
          <div className="flex items-center justify-between gap-2">
            <UseTemplate scope="collections" kind="sms" audience={debtorKind} values={smsValues}
              onPick={(p) => { setText(p.body); setMissing(p.missing) }} />
            {text && (
              <button type="button" onClick={() => { setText(''); setMissing([]) }}
                className="text-[11px] text-slate-400 hover:text-slate-600">Clear</button>
            )}
          </div>
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

          {/* Only when there IS something this account could not answer. */}
          {missingFieldsNote(missing) && (
            <p className="text-[11px] text-[var(--c-rust-deep)]">{missingFieldsNote(missing)}</p>
          )}

          {error && <p className="text-sm text-negative-700">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => void send()}
              disabled={busy || !text.trim() || !to}
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
