import { useState } from 'react'
import { Loader2, PauseCircle, PlayCircle } from 'lucide-react'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { DictateButton } from '../../components/ui/Dictate'
import { freezeAccount, unfreezeAccount } from '../../lib/accountFreeze.ts'
import { frozenByLabel, type FrozenBy } from '../../lib/clientPosition.ts'

/**
 * Stopping and restarting work on an account.
 *
 * WHO ASKED IS THE WHOLE QUESTION. 150 of the 736 accounts on the book say "Frozen" and nothing
 * else, and a client asking why theirs has not moved in four months cannot be answered from
 * that. Worse, the firm cannot tell whether it was the client who asked for the stop — which is
 * the difference between an apology and an explanation.
 *
 * So the reason is required and the asker is a choice, not a default. There is no button here
 * that works without both, because the state that produces is exactly the one this exists to end.
 */
export function FreezeModal({ accountId, accountLabel, frozen, actor, onClose, onDone }: {
  accountId: string
  /** "Malcom Mhlongo · ACF10022", for the line under the title. */
  accountLabel: string
  /** The current freeze, or null when the account is working. */
  frozen: { by: FrozenBy | null; reason: string | null } | null
  actor: { id: string | null; name: string | null }
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const [by, setBy] = useState<FrozenBy>('client')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const restarting = frozen !== null

  async function save() {
    setBusy(true); setError(null)
    try {
      if (restarting) await unfreezeAccount({ accountId, reason, actor })
      else await freezeAccount({ accountId, by, reason, actor })
      await onDone()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={restarting ? 'Restart work on this account' : 'Stop work on this account'} onClose={onClose} width={480}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">{accountLabel}</p>

        {restarting ? (
          /*
            What is being undone, in the words it was stopped with. Somebody restarting an
            account four months later did not necessarily stop it, and "Frozen" on its own has
            already proved it tells them nothing.
          */
          <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2.5">
            <span className="font-medium">{frozenByLabel(frozen.by)}</span>
            {frozen.reason ? <> — {frozen.reason}</> : null}
          </p>
        ) : (
          <div>
            <span className="block text-xs font-medium text-slate-500 mb-1.5">Who asked for this</span>
            {/*
              Two buttons, not a dropdown: there are exactly two, and which one it is changes
              what the client is told. It is the fact most worth getting right on this screen.
            */}
            <div className="flex gap-1 p-0.5 rounded-lg bg-slate-100">
              {([
                ['client', 'The client'],
                ['firm', 'We did'],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setBy(value)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    by === value ? 'bg-white shadow-sm font-medium text-navy-950' : 'text-slate-500 hover:text-slate-700'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <FormField label={restarting ? 'Why is it starting again' : 'Why'}>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder={restarting
              ? 'Debt review terminated — client has confirmed we may proceed.'
              : 'Debtor is under debt review. Client asked us to hold until it is resolved.'}
            className={`${inputClass} resize-none`}
          />
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <DictateButton size="small" value={reason} onChange={setReason} />
            <span className="text-[11px] text-slate-400">
              Goes on the account&rsquo;s timeline, and into the client&rsquo;s monthly report.
            </span>
          </div>
        </FormField>

        {error && <p className="text-sm text-negative-700">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-400">
            {restarting
              ? 'It goes back into circulation and starts being worked again.'
              : 'Nothing is charged and no balance changes. Work simply stops.'}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-2">
              Cancel
            </button>
            {/* Disabled without a reason: it is the one field the whole feature exists for. */}
            <button type="button" onClick={() => void save()} disabled={busy || !reason.trim()}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900 disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" />
                : restarting ? <PlayCircle size={14} /> : <PauseCircle size={14} />}
              {restarting ? 'Restart work' : 'Stop work'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
