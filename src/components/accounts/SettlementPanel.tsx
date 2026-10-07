import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card } from '../ui/Card'
import { Modal, FormField, inputClass } from '../ui/Modal'
import { rand } from '../../lib/money'
import { formatDate } from '../../data/mockData'
import { firmToday } from '../../lib/dateLabels'
import {
  SETTLEMENT_STATE_LABEL, isPaidInFull, type Settlement,
} from '../../lib/settlement'
import {
  approveSettlement, closeAsSettled, closeSettlementOffer, proposeSettlement,
} from '../../lib/settlementApi'

/**
 * THE SETTLEMENT ON AN ACCOUNT: the debtor's offer, the client's answer, and whether it was paid.
 *
 * THE FIRM'S CALL SCRIPT IS THE SHAPE OF THIS PANEL. A collector may put an offer UP -- "either put
 * a debtor's offer up for approval, or get an approved offer paid before it expires" -- and may
 * quote only an approved one. The client's yes is recorded by a liaison, in writing ("it goes in
 * writing or it did not happen"), with an expiry. Paid in full by then, a PERSON closes the account
 * as settled; the firm ruled that nothing closes an account by itself.
 *
 * EVERY RULE IS ALSO THE DATABASE'S. The buttons are drawn off the same ticks the functions ask
 * (settlement.approve, payment.record), so a button shown here is not refused there -- but the
 * refusal is the database's, and this panel only spares somebody the trip.
 */
export function SettlementPanel({
  accountId, settlement, balance, open, canApprove, canClose, userId, nameOf, onChange,
}: {
  accountId: string
  settlement: Settlement | null
  /** The balance owed today -- what a new offer's saving is measured from. */
  balance: number | undefined
  /** False on a closed account: nothing new can be put up on it. */
  open: boolean
  /** settlement.approve: record the client's yes, decline, extend. */
  canApprove: boolean
  /** payment.record, which is what settle_account asks. */
  canClose: boolean
  userId: string | null
  nameOf: (id: string | null) => string | null
  onChange: () => void
}) {
  const [dialog, setDialog] = useState<'propose' | 'approve' | 'declined' | 'withdrawn' | 'settle' | null>(null)
  const s = settlement
  const live = !!s && (s.state === 'proposed' || s.state === 'approved' || s.state === 'lapsed')
  if (!s && !open) return null

  const done = () => { setDialog(null); onChange() }
  const paid = isPaidInFull(s)
  const mayWithdraw = !!s && (canApprove || (s.state === 'proposed' && s.proposedBy === userId))

  return (
    <Card>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-[11px] uppercase tracking-wide text-slate-400">Settlement</h3>
        {s && live && (
          <span className={`text-[11px] font-medium ${s.state === 'approved' ? 'text-emerald-700'
            : s.state === 'lapsed' ? 'text-[var(--c-rust-deep)]' : 'text-slate-500'}`}>
            {SETTLEMENT_STATE_LABEL[s.state]}
          </span>
        )}
      </div>

      {!live && (
        <>
          {s && (
            <p className="text-xs text-slate-500 mb-2">
              Last offer: {rand(s.amount)}, {SETTLEMENT_STATE_LABEL[s.state].toLowerCase()}
              {s.closedAt ? ` on ${formatDate(s.closedAt)}` : ''}
              {s.closedReason ? ` — ${s.closedReason}` : ''}
            </p>
          )}
          {open && (
            <>
              <p className="text-xs text-slate-500">
                A settlement is the client’s figure to accept. Put the debtor’s offer up and the
                liaison takes it to the client.
              </p>
              <button type="button" onClick={() => setDialog('propose')}
                className="mt-2 text-xs font-medium text-[var(--c-steel)] hover:underline">
                Put an offer up for approval
              </button>
            </>
          )}
        </>
      )}

      {s && live && (
        <div className="space-y-1.5 text-sm">
          <Row label={s.state === 'proposed' ? 'Offered' : 'Settle for'} value={rand(s.amount)} strong />
          <Row label="Instead of" value={rand(s.balanceAtOffer)} note={`the balance on ${formatDate(s.balanceAsAt)}`} />
          <Row label="Written off" value={rand(s.saving)} />
          {s.expiresOn && (
            <Row label={s.state === 'lapsed' ? 'Lapsed on' : 'Must be paid by'} value={formatDate(s.expiresOn)} />
          )}
          {s.state !== 'proposed' && (
            <Row label="Received towards it" value={`${rand(s.paidToward)} of ${rand(s.amount)}`} />
          )}

          {s.state === 'proposed' && (
            <p className="text-[11px] text-slate-400">
              Put up by {nameOf(s.proposedBy) ?? 'somebody'} on {formatDate(s.proposedAt)}
              {s.proposalNote ? ` — ${s.proposalNote}` : ''}. Not to be quoted until the client approves it.
            </p>
          )}
          {s.state === 'approved' && (
            <p className="text-[11px] text-slate-400">
              Approved {s.approvedAt ? formatDate(s.approvedAt) : ''} — {s.approvalEvidence}.
              One payment, in full, into the trust account. A part payment does not settle it.
            </p>
          )}
          {s.state === 'lapsed' && (
            <p className="text-[11px] text-[var(--c-rust-deep)]">
              The full balance is owing again. Only the client can revive it.
            </p>
          )}

          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
            {paid && canClose && (
              <button type="button" onClick={() => setDialog('settle')}
                className="text-xs font-semibold text-emerald-700 hover:underline">
                Paid — close as settled
              </button>
            )}
            {canApprove && (
              <button type="button" onClick={() => setDialog('approve')}
                className="text-xs font-medium text-[var(--c-steel)] hover:underline">
                {s.state === 'proposed' ? 'The client approved it'
                  : s.state === 'lapsed' ? 'The client approved it again' : 'Change or extend'}
              </button>
            )}
            {canApprove && s.state === 'proposed' && (
              <button type="button" onClick={() => setDialog('declined')}
                className="text-xs font-medium text-[var(--c-steel)] hover:underline">
                The client declined
              </button>
            )}
            {mayWithdraw && (
              <button type="button" onClick={() => setDialog('withdrawn')}
                className="text-xs font-medium text-slate-500 hover:underline">
                Withdraw
              </button>
            )}
          </div>
        </div>
      )}

      {dialog === 'propose' && (
        <ProposeModal accountId={accountId} balance={balance} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog === 'approve' && s && (
        <ApproveModal settlement={s} onClose={() => setDialog(null)} onDone={done} />
      )}
      {(dialog === 'declined' || dialog === 'withdrawn') && s && (
        <CloseOfferModal settlement={s} as={dialog} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog === 'settle' && s && (
        <SettleModal settlement={s} onClose={() => setDialog(null)} onDone={done} />
      )}
    </Card>
  )
}

function Row({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">
        {label}
        {note && <span className="block text-[11px] text-slate-400">{note}</span>}
      </span>
      <span className={`tabular-nums shrink-0 ${strong ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{value}</span>
    </div>
  )
}

/** The shared tail of every dialog here: what went wrong, and the two buttons. */
function Footer({ busy, error, ready, label, onClose, onGo }: {
  busy: boolean; error: string | null; ready: boolean; label: string
  onClose: () => void; onGo: () => void
}) {
  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose}
          className="px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
        <button type="button" disabled={!ready || busy} onClick={onGo}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-navy-950 text-white disabled:opacity-50 inline-flex items-center gap-2">
          {busy && <Loader2 size={14} className="animate-spin" />}
          {label}
        </button>
      </div>
    </div>
  )
}

/** Runs one call, keeping the dialog open with the database's own words if it refuses. */
function useCall(onDone: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    try { await fn(); onDone() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return { busy, error, run }
}

const parseAmount = (text: string) => {
  const n = Number(text.replace(/[\s,R]/g, ''))
  return Number.isFinite(n) ? n : NaN
}

function ProposeModal({ accountId, balance, onClose, onDone }: {
  accountId: string; balance: number | undefined; onClose: () => void; onDone: () => void
}) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const { busy, error, run } = useCall(onDone)
  const n = parseAmount(amount)
  const owed = balance ?? 0
  const valid = n > 0 && n < owed
  return (
    <Modal title="Put an offer up for approval" subtitle="The client decides. Nobody quotes it until they do." onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Balance today: <span className="font-medium tabular-nums">{rand(owed)}</span></p>
        <FormField label="What the debtor offers to pay, once, in full" required>
          <input className={inputClass} inputMode="decimal" value={amount} autoFocus
            onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 18000" />
        </FormField>
        {amount.trim() !== '' && !valid && (
          <p className="text-xs text-[var(--c-rust-deep)]">
            {n >= owed ? 'That is the whole balance or more — a payment in full, not a settlement.' : 'Type an amount.'}
          </p>
        )}
        {valid && <p className="text-xs text-slate-500">Written off if accepted: <span className="tabular-nums">{rand(owed - n)}</span></p>}
        <FormField label="Note for the liaison">
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Offered on the call; can pay from a pension payout" />
        </FormField>
        <Footer busy={busy} error={error} ready={valid} label="Put it up" onClose={onClose}
          onGo={() => run(() => proposeSettlement(accountId, n, owed, note))} />
      </div>
    </Modal>
  )
}

function ApproveModal({ settlement, onClose, onDone }: {
  settlement: Settlement; onClose: () => void; onDone: () => void
}) {
  const [amount, setAmount] = useState(String(settlement.amount))
  const [expires, setExpires] = useState(settlement.state === 'approved' && settlement.expiresOn ? settlement.expiresOn : '')
  const [evidence, setEvidence] = useState('')
  const { busy, error, run } = useCall(onDone)
  const n = parseAmount(amount)
  const today = firmToday()
  const valid = n > 0 && n < settlement.balanceAtOffer && expires >= today && evidence.trim().length > 0
  return (
    <Modal title="Record the client’s approval" subtitle="The figure becomes one collectors may quote, until the expiry." onClose={onClose}>
      <div className="space-y-3">
        <FormField label="The figure the client accepts" required>
          <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </FormField>
        <p className="text-xs text-slate-500">
          Against {rand(settlement.balanceAtOffer)} on {formatDate(settlement.balanceAsAt)}
          {n > 0 && n < settlement.balanceAtOffer ? ` — ${rand(settlement.balanceAtOffer - n)} written off` : ''}.
        </p>
        <FormField label="Must be paid by" required>
          <input type="date" className={inputClass} min={today} value={expires} onChange={(e) => setExpires(e.target.value)} />
        </FormField>
        <FormField label="How the client approved it" required>
          <input className={inputClass} value={evidence} onChange={(e) => setEvidence(e.target.value)}
            placeholder="e.g. Email from the client, 7 Oct" />
        </FormField>
        <p className="text-[11px] text-slate-400">In writing, or it did not happen — the firm’s rule.</p>
        <Footer busy={busy} error={error} ready={valid} label="Record approval" onClose={onClose}
          onGo={() => run(() => approveSettlement(settlement.id, expires, evidence, n))} />
      </div>
    </Modal>
  )
}

function CloseOfferModal({ settlement, as, onClose, onDone }: {
  settlement: Settlement; as: 'declined' | 'withdrawn'; onClose: () => void; onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const { busy, error, run } = useCall(onDone)
  return (
    <Modal title={as === 'declined' ? 'The client declined' : 'Withdraw the offer'} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          The offer of {rand(settlement.amount)} closes. The full balance stays owing.
        </p>
        <FormField label="Why" required>
          <input className={inputClass} value={reason} autoFocus onChange={(e) => setReason(e.target.value)}
            placeholder={as === 'declined' ? 'e.g. Client wants at least 80%' : 'e.g. Debtor withdrew the offer'} />
        </FormField>
        <Footer busy={busy} error={error} ready={reason.trim().length > 0}
          label={as === 'declined' ? 'Record the decline' : 'Withdraw'} onClose={onClose}
          onGo={() => run(() => closeSettlementOffer(settlement.id, as, reason))} />
      </div>
    </Modal>
  )
}

function SettleModal({ settlement, onClose, onDone }: {
  settlement: Settlement; onClose: () => void; onDone: () => void
}) {
  const { busy, error, run } = useCall(onDone)
  return (
    <Modal title="Close the account as settled" onClose={onClose}>
      <div className="space-y-3 text-sm text-slate-700">
        <p>
          {rand(settlement.paidToward)} has reached the trust account against an approved settlement of
          {' '}{rand(settlement.amount)}. Closing ends the account as <span className="font-medium">settled</span>,
          stops every workflow on it, and the rest of the balance is the compromise the client agreed.
        </p>
        <Footer busy={busy} error={error} ready label="Close as settled" onClose={onClose}
          onGo={() => run(() => closeAsSettled(settlement.id))} />
      </div>
    </Modal>
  )
}
