import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Modal, FormField, inputClass, controlClass } from '../ui/Modal'
import { rand } from '../../lib/money'
import {
  ENDING_LABEL, SMALL_RESIDUE, WITHDRAWAL_PRESETS, WRITE_OFF_REASONS,
  endingAdvice, withdrawalTotal,
  type AccountEnding, type WithdrawalBasis, type WithdrawalCharge,
} from '../../lib/accountEnding'
import { fetchWithdrawalBasis, settleAccount, withdrawAccount } from '../../lib/accountEndingApi'

/**
 * ENDING AN ACCOUNT, THREE WAYS.
 *
 * The firm, asked what was missing: *"Do we have an option to make accounts paid up? Write accounts
 * off? Freeze accounts? Or withdraw accounts?"*
 *
 * THE THREE ARE ON ONE BOX BECAUSE THE CHOICE BETWEEN THEM IS THE DECISION. Somebody opening this
 * knows the account is finished; what they are deciding is which ending it is, and that is a
 * comparison. Three separate buttons on the account would ask them to have already decided.
 *
 * WITHDRAWN IS THE CLIENT'S DOING AND COSTS THEM MONEY; the other two are the firm's. The box
 * changes shape completely between them, which is the honest reflection of that.
 */
export function EndAccountModal({ accountId, caseNumber, balance, canWriteOff, onClose, onDone }: {
  accountId: string
  caseNumber: string | null
  /** What is still outstanding, which decides whether paid up is even truthful. */
  balance: number
  /** finance.view. Writing off and withdrawing are the Administrator's; paid up is not. */
  canWriteOff: boolean
  onClose: () => void
  onDone: (ending: AccountEnding) => void
}) {
  const [ending, setEnding] = useState<AccountEnding>(() => (balance <= 0 ? 'paid_up' : 'written_off'))
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* ---- the withdrawal half ---- */
  const [basis, setBasis] = useState<WithdrawalBasis | null>(null)
  const [preset, setPreset] = useState<string>('arrangement')
  const [charge, setCharge] = useState<WithdrawalCharge>({ fees: true, interest: true, commission: true })
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (ending !== 'withdrawn' || basis || !canWriteOff) return
    let live = true
    fetchWithdrawalBasis(accountId)
      .then((b) => { if (live) setBasis(b) })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [ending, basis, accountId, canWriteOff])

  /* A TYPED FIGURE REPLACES THE BOXES ENTIRELY, which is what the database does too -- the two
     cannot be mixed without the number meaning something different depending on what is ticked. */
  const typedAmount = typed.trim() === '' ? null : Number(typed)
  const effective: WithdrawalCharge = useMemo(
    () => ({ ...charge, amount: typedAmount !== null && Number.isFinite(typedAmount) ? typedAmount : null }),
    [charge, typedAmount],
  )
  const total = basis ? withdrawalTotal(basis, effective) : null

  const advice = endingAdvice(balance)

  async function submit() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      if (ending === 'withdrawn') await withdrawAccount(accountId, reason, effective, note || undefined)
      else await settleAccount(accountId, ending, reason, note || undefined)
      onDone(ending)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const choices: AccountEnding[] = canWriteOff
    ? ['paid_up', 'written_off', 'withdrawn']
    /* Marking one paid up is the collections floor's work; the other two are not theirs. */
    : ['paid_up']

  return (
    <Modal
      title={`Close ${caseNumber ?? 'this account'}`}
      subtitle="An account ends once. Say which ending this is and why."
      width={620}
      onClose={onClose}
      footer={(
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12.5px] text-negative-700">{error}</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={controlClass}>Cancel</button>
            <button
              type="button" onClick={submit}
              disabled={busy || reason.trim() === ''}
              className="rounded-lg bg-navy-950 px-4 py-2 text-sm font-semibold text-white
                disabled:opacity-40"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : `Close as ${ENDING_LABEL[ending].toLowerCase()}`}
            </button>
          </div>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {choices.map((e) => (
            <button
              key={e} type="button" onClick={() => setEnding(e)}
              className={clsx('rounded-lg border px-3 py-2 text-sm font-medium',
                ending === e
                  ? 'border-navy-950 bg-navy-950 text-white'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
            >
              {ENDING_LABEL[e]}
            </button>
          ))}
        </div>

        {/*
          WHAT IS ACTUALLY OUTSTANDING, AND WHICH ENDING IS TRUTHFUL. The firm's rule is that money
          comes first -- "any payment has gone through the division before it is decided to write
          off" -- so a balance still standing is not paid up however small it is. R50 is where the
          firm stops chasing, and it changes the WORDING rather than what the box allows.

          NOT SHOWN FOR A WITHDRAWAL, because none of it is true of one. The client is taking the
          file back; the firm is not cancelling anything, and the balance stops being its business.
          What matters there is what the client is charged, which is the panel below.
        */}
        {ending !== 'withdrawn' && (
          <div className={clsx('rounded-lg px-4 py-3 text-[13px] leading-relaxed',
            ending === advice.ending ? 'bg-slate-50 text-slate-600' : 'bg-gold-50 text-gold-800')}>
            <strong className="font-semibold">
              {balance <= 0 ? 'Nothing is outstanding.' : `${rand(balance)} is still outstanding.`}
            </strong>{' '}
            {ending === 'paid_up' && balance > 0
              ? `Paid up says the debt was settled, and it was not. ${balance < SMALL_RESIDUE
                ? `Under R${SMALL_RESIDUE} is not worth chasing, but letting it go is still a write-off.`
                : 'Closing it anyway cancels that balance, which is a write-off.'}`
              : advice.because}
          </div>
        )}

        {ending === 'withdrawn' && (
          <WithdrawalCharges
            basis={basis} preset={preset} charge={charge} typed={typed} total={total}
            onPreset={(id) => {
              setPreset(id)
              const p = WITHDRAWAL_PRESETS.find((x) => x.id === id)
              if (p) { setCharge(p.charge); setTyped('') }
            }}
            onCharge={(c) => { setCharge(c); setPreset('') }}
            onTyped={setTyped}
          />
        )}

        <FormField label={ending === 'written_off' ? 'Why it is being written off' : 'Why'} required>
          {ending === 'written_off' ? (
            <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Pick a reason…</option>
              {WRITE_OFF_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          ) : (
            <input
              className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={ending === 'withdrawn'
                ? 'They made an arrangement with the debtor'
                : 'Paid in full on 4 October'}
            />
          )}
        </FormField>

        <FormField label="Anything else worth recording">
          <textarea className={inputClass} rows={2} value={note}
            onChange={(e) => setNote(e.target.value)} />
        </FormField>

        {/*
          THE FIRM HOLDS THE MANDATE, and the box says so rather than leaving somebody to wonder
          whether they should be asking the client first. What follows a write-off is the liaison
          being told, which is work rather than permission.
        */}
        {ending === 'written_off' && (
          <p className="text-[12.5px] text-slate-500 leading-relaxed">
            The firm holds the mandate, so this does not wait on the client. The client liaison gets
            a task to tell them and to ask whether they want an executive listing.
          </p>
        )}
      </div>
    </Modal>
  )
}

function WithdrawalCharges({ basis, preset, charge, typed, total, onPreset, onCharge, onTyped }: {
  basis: WithdrawalBasis | null
  preset: string
  charge: WithdrawalCharge
  typed: string
  total: { excl: number; vat: number; incl: number } | null
  onPreset: (id: string) => void
  onCharge: (c: WithdrawalCharge) => void
  onTyped: (v: string) => void
}) {
  if (!basis) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
        <Loader2 size={15} className="animate-spin" /> Working out what we have invested…
      </div>
    )
  }
  const typing = typed.trim() !== ''
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
        What the client is charged
      </div>

      <div className="space-y-1.5">
        {WITHDRAWAL_PRESETS.map((p) => (
          <button
            key={p.id} type="button" onClick={() => onPreset(p.id)}
            className={clsx('w-full text-left rounded-lg border px-3 py-2',
              preset === p.id ? 'border-gold-500 bg-gold-50' : 'border-slate-200 hover:bg-slate-50')}
          >
            <div className="text-[13.5px] font-medium text-slate-800">{p.label}</div>
            <div className="text-[12px] text-slate-500 mt-0.5">{p.why}</div>
          </button>
        ))}
      </div>

      {/* The boxes stay tickable after a preset: the firm asked for both, not one or the other. */}
      <div className="flex flex-wrap gap-4 pt-1">
        {([
          ['fees', 'Fees', basis.fees],
          ['interest', 'Interest', basis.interest],
          ['commission', 'Commission', basis.commission],
        ] as const).map(([key, label, amount]) => (
          <label key={key} className={clsx('flex items-center gap-2 text-[13px]',
            typing ? 'text-slate-300' : 'text-slate-700')}>
            <input
              type="checkbox" disabled={typing} checked={charge[key]}
              onChange={(e) => onCharge({ ...charge, [key]: e.target.checked })}
            />
            {label} <span className="tabular-nums text-slate-500">{rand(amount)}</span>
          </label>
        ))}
      </div>

      <FormField label="Or charge an amount you type in">
        <input
          className={inputClass} inputMode="decimal" value={typed}
          onChange={(e) => onTyped(e.target.value)}
          placeholder="Leave empty to use the boxes above"
        />
      </FormField>

      {total && (
        <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-[13px] space-y-1">
          <Row label="Charge" value={rand(total.excl)} />
          {/* INTEREST CARRIES NO VAT -- it is the cost of money, not a service the firm rendered. */}
          <Row label={`VAT at ${(basis.vatRate * 100).toFixed(0)}%`} value={rand(total.vat)} />
          <div className="flex justify-between pt-1 border-t border-slate-200 font-semibold">
            <span>Invoiced to the client</span>
            <span className="tabular-nums">{rand(total.incl)}</span>
          </div>
          <p className="text-[12px] text-slate-500 pt-1">
            {total.excl === 0
              ? 'Nothing is charged, so no invoice is raised at all.'
              : 'It comes off their next payover, and never lands on the debtor’s own balance.'}
          </p>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-slate-600">
      <span>{label}</span><span className="tabular-nums">{value}</span>
    </div>
  )
}
