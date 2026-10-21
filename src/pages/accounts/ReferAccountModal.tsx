import { useMemo, useState } from 'react'
import { AlertTriangle, PhoneForwarded, Send } from 'lucide-react'
import { FormField, Modal } from '../../components/ui/Modal'
import { diarise } from '../../lib/diary.ts'
import {
  REFERRAL_DIARY_KIND, referralDone, referralDueOn, referralReason, type ReferralKind,
} from '../../lib/accountReferral.ts'
import { shortDate } from '../../lib/dateLabels.ts'
import { todayIso } from '../../lib/reminderTime.ts'
import type { DiaryKind } from '../../lib/diaryPriority.ts'
import type { User } from '../../types'

const inputClass = 'w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] '
  + 'text-slate-800 focus:border-[#c9a052] focus:outline-none'

/**
 * HANDING AN ACCOUNT TO SOMEBODY'S DAY -- as a referral, or as a caller being transferred.
 *
 * THE REFERRAL IS THE DIARY ENTRY. That is the firm's own framing and it is the whole design:
 * nothing else is written. A referral that is a note is one somebody has to notice; a referral
 * that is a diary entry is on their day, dated, and counted in their fifty.
 *
 * AND A TRANSFER IS THE SAME ACT WITH THE CLOCK RUNNING. Reception has the debtor on the line and
 * the account on the screen; the collector who picks up should have the file in front of them
 * rather than asking a stranger for a reference number. Dated today, because there is a person on
 * the telephone.
 *
 * IT DOES NOT MOVE THE ACCOUNT, and the box says so. Reassignment is a different act with a
 * different consequence -- it puts the file on somebody's book against their ceiling -- and it has
 * its own box. See accountReferral.ts.
 */
export function ReferAccountModal({
  accountId, accountLabel, kind, users, actor, callerNumber, onClose, onDone,
}: {
  accountId: string
  accountLabel: string
  kind: ReferralKind
  /** Who it can go to. Filtered by the caller -- see the collections roles. */
  users: User[]
  actor: { id: string | null; name: string | null }
  /** The number the caller is on, where reception knows it. Survives a dropped transfer. */
  callerNumber?: string | null
  onClose: () => void
  onDone: (message: string) => void | Promise<void>
}) {
  const today = todayIso()
  const [toUserId, setToUserId] = useState('')
  const [ask, setAsk] = useState('')
  const [when, setWhen] = useState(today)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sorted = useMemo(
    () => [...users].sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  )
  const to = sorted.find((u) => u.id === toUserId) ?? null
  const dueOn = referralDueOn(kind, today, when)

  async function save() {
    if (!to) { setError('Say who it is going to.'); return }
    if (!ask.trim()) { setError('Say what you want done. A referral with no ask is a date.'); return }
    setBusy(true)
    setError(null)
    try {
      await diarise({
        accountId,
        /* WHOSE DAY IT LANDS ON. The whole point: not the sender's, and not the account's owner's
           unless they are the person being asked. */
        ownerId: to.id,
        dueOn,
        kind: REFERRAL_DIARY_KIND as DiaryKind,
        reason: referralReason({
          kind, fromName: actor.name, ask, callerNumber,
        }),
        /*
         * AND ON THE ACCOUNT'S OWN TIMELINE TOO.
         *
         * NOT A SECOND REFERRAL -- the diary entry is still the referral, and this is the account
         * saying what happened to it. Without it, an account that was referred three times in a
         * month has no record of it anywhere except in three superseded diary rows.
         */
        alsoNoteOnAccount: true,
        actor,
      })
      await onDone(referralDone({ kind, toName: to.name, dueOn: shortDate(dueOn) }))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={kind === 'transfer' ? 'Transfer the caller' : 'Refer this account'}
      onClose={onClose} width={480}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">{accountLabel}</p>

        {kind === 'transfer' && (
          /* THE ONE FACT THAT MAKES A TRANSFER DIFFERENT FROM A REFERRAL: somebody is waiting. */
          <p className="rounded-lg bg-gold-50 px-3 py-2 text-[12px] text-slate-700">
            The caller is on the line now. This puts the account on their day before you put the
            call through, so they open the file rather than asking the debtor who they are.
            {callerNumber ? <> The number is recorded in case the transfer drops.</> : null}
          </p>
        )}

        <FormField label={kind === 'transfer' ? 'Transfer to' : 'Refer it to'} required>
          <select className={inputClass} value={toUserId} onChange={(e) => setToUserId(e.target.value)}>
            <option value="">Choose somebody</option>
            {sorted.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </FormField>

        <FormField label={kind === 'transfer' ? 'What the caller wants' : 'What you want done'} required>
          <textarea className={inputClass} rows={4} value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder={kind === 'transfer'
              ? 'He says he has paid and wants the account stopped'
              : 'Ring the employer and confirm he still works there before we list it'} />
        </FormField>

        {/* A REFERRAL TAKES A DATE AND A TRANSFER CANNOT. A team leader reading a file on Friday
            afternoon may well want it worked on Monday; a caller on the line is today. */}
        {kind === 'refer' && (
          <FormField label="On their diary for">
            <input type="date" className={inputClass} value={when} min={today}
              onChange={(e) => setWhen(e.target.value)} />
          </FormField>
        )}

        {/*
          WHAT THIS IS AND IS NOT, said before the press rather than after it.

          ONE DIARY DATE PER ACCOUNT is the firm's rule, so this takes the one it has. Said out
          loud because the person referring may be taking a date off somebody else's day -- the
          superseded entry keeps the day it was due, which is what makes a miss still readable.
        */}
        <p className="text-[11px] leading-snug text-slate-500">
          The diary entry <em>is</em> the referral &mdash; nothing else is sent. It becomes this
          account&rsquo;s diary date, which replaces whatever was there, and the account stays with
          whoever has it now.
        </p>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600">
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-navy-950 px-3 py-1.5
              text-xs font-medium text-white disabled:opacity-40">
            {kind === 'transfer'
              ? <><PhoneForwarded size={12} /> Hand over the account</>
              : <><Send size={12} /> Refer it</>}
          </button>
        </div>

        {error && (
          <p className="flex items-start gap-1.5 text-xs text-negative-700">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
