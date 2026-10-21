import { useState } from 'react'
import { CheckCircle2, Loader2, UserRoundCheck } from 'lucide-react'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { DictateButton } from '../../components/ui/Dictate'
import { askClient, clientAnswered } from '../../lib/accountFreeze.ts'

/**
 * What the firm needs from the client before this account can move.
 *
 * THE WORDS ARE THE FEATURE. "Client action required" tells a client nothing; "Please provide the
 * signed agreement and the invoice by 18 September" is something they can do this afternoon. So
 * the ask is required, the flag is raised by its presence, and there is no way to set the flag
 * without saying what for.
 *
 * Written to be read by somebody outside the firm, which the placeholder tries to teach: this
 * text goes into the client's monthly report verbatim, not into an internal note.
 */
export function ClientActionModal({ accountId, accountLabel, outstanding, actor, onClose, onDone }: {
  accountId: string
  accountLabel: string
  /** The ask already outstanding, or null when nothing is owed. */
  outstanding: { ask: string; dueOn: string | null } | null
  actor: { id: string | null; name: string | null }
  onClose: () => void
  onDone: () => void | Promise<void>
}) {
  const answering = outstanding !== null
  const [ask, setAsk] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [outcome, setOutcome] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true); setError(null)
    try {
      if (answering) await clientAnswered({ accountId, outcome, actor })
      else await askClient({ accountId, ask, dueOn: dueOn || null, actor })
      await onDone()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={answering ? 'The client came back' : 'Ask the client for something'}
      onClose={onClose}
      width={480}
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-400">{accountLabel}</p>

        {answering ? (
          <>
            <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2.5">
              <span className="font-medium">We asked for:</span> {outstanding.ask}
              {outstanding.dueOn ? <span className="text-slate-400"> · by {outstanding.dueOn}</span> : null}
            </p>
            <FormField label="What did they come back with">
              <textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={2}
                placeholder="Signed agreement and invoice received — passed to the collector."
                className={`${inputClass} resize-none`} />
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <DictateButton size="small" value={outcome} onChange={setOutcome} />
                <span className="text-[11px] text-slate-400">
                  Goes on the timeline. The red flag comes off this account.
                </span>
              </div>
            </FormField>
          </>
        ) : (
          <>
            <FormField label="What do you need from them">
              <textarea value={ask} onChange={(e) => setAsk(e.target.value)} rows={2}
                /*
                  A worked example rather than a hint, because the failure mode here is somebody
                  typing "documents" and a client three provinces away being unable to act on it.
                */
                placeholder="Please provide the signed agreement and the invoice the debtor is disputing."
                className={`${inputClass} resize-none`} />
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <DictateButton size="small" value={ask} onChange={setAsk} />
                <span className="text-[11px] text-slate-400">
                  This goes to the client word for word. Write it for them, not for us.
                </span>
              </div>
            </FormField>
            <FormField label="Needed by">
              <span className="block w-[11rem]">
                <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)}
                  className={`${inputClass} py-1.5`} />
              </span>
              <span className="block text-[11px] text-slate-400 mt-1.5">
                Optional. A date is what makes it chaseable.
              </span>
            </FormField>
          </>
        )}

        {error && <p className="text-sm text-negative-700">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-400">
            {answering
              ? 'The account stops waiting on the client.'
              : 'The account shows red on the client’s report until they come back.'}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-2">
              Cancel
            </button>
            <button type="button" onClick={() => void save()}
              disabled={busy || !(answering ? outcome.trim() : ask.trim())}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900 disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" />
                : answering ? <CheckCircle2 size={14} /> : <UserRoundCheck size={14} />}
              {answering ? 'Done' : 'Ask the client'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
