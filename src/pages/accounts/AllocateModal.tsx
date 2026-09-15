import { useEffect, useState } from 'react'
import { Loader2, UserCheck } from 'lucide-react'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import { DictateButton } from '../../components/ui/Dictate'
import {
  BULK_CEILING, BulkTooLarge, allocate, selectionCount, type Selection,
} from '../../lib/accountAllocation.ts'
import type { User } from '../../types'

/**
 * Putting a stack of accounts on somebody's desk.
 *
 * THE COUNT IS RE-TAKEN HERE, not carried in from the list. A selection of "all 214 matching" is
 * a filter, and a filter matches what it matches at the moment it runs — an account paid, frozen
 * or reassigned in the meantime changes the answer. Showing the number the list happened to
 * display a minute ago would be confirming against a figure nobody is going to honour.
 *
 * There is no "are you sure". The number is the confirmation: a person who reads "214 accounts"
 * and clicks has confirmed, and a person who reads "2 140 accounts" has just been saved.
 */
export function AllocateModal({ selection, users, actor, onClose, onDone }: {
  selection: Selection
  users: User[]
  actor: { id: string | null; name: string | null }
  onClose: () => void
  onDone: (message: string) => void | Promise<void>
}) {
  const [toUserId, setToUserId] = useState<string>('')
  const [reason, setReason] = useState('')
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void selectionCount(selection)
      .then((n) => { if (!cancelled) setCount(n) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [selection])

  const tooMany = count !== null && count > BULK_CEILING
  const target = users.find((u) => u.id === toUserId)

  async function save() {
    setBusy(true); setError(null)
    try {
      const res = await allocate({
        selection,
        // '' is "anyone"; 'nobody' is a decision. The two must not collapse into one another.
        toUserId: toUserId === 'nobody' ? null : toUserId,
        toUserName: toUserId === 'nobody' ? null : (target?.name ?? null),
        reason,
        actor,
      })
      const where = toUserId === 'nobody' ? 'the unallocated pile' : `${target?.name}’s desk`
      await onDone(
        `${res.changed.toLocaleString('en-ZA')} ${res.changed === 1 ? 'account' : 'accounts'} moved to ${where}.`
        + (res.notesFailed > 0 ? ` ${res.notesFailed} could not be noted on the timeline.` : ''),
      )
      onClose()
    } catch (e) {
      setError(e instanceof BulkTooLarge ? e.message : e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Allocate accounts" onClose={onClose} width={480}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2.5">
          {count === null ? (
            <span className="inline-flex items-center gap-1.5 text-slate-400">
              <Loader2 size={13} className="animate-spin" /> Counting…
            </span>
          ) : (
            <>
              <span className="font-medium tabular-nums">{count.toLocaleString('en-ZA')}</span>
              {' '}{count === 1 ? 'account' : 'accounts'}
              {selection.kind === 'matching' ? ' match these filters.' : ' selected.'}
            </>
          )}
        </p>

        <FormField label="Whose desk">
          <select className={inputClass} value={toUserId} onChange={(e) => setToUserId(e.target.value)}>
            <option value="">Choose a person…</option>
            {users.filter((u) => u.status === 'Active').map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
            {/*
              A real destination, not an absence. An agent leaves and their book has to go
              somewhere before it is shared out, and "unallocated" is where.
            */}
            <option value="nobody">— Take off every desk (unallocated)</option>
          </select>
        </FormField>

        <FormField label="Why (optional)">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Sharing out the September handover."
            className={`${inputClass} resize-none`}
          />
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <DictateButton size="small" value={reason} onChange={setReason} />
            <span className="text-[11px] text-slate-400">
              Goes on every account&rsquo;s timeline, so &ldquo;who was working this in March&rdquo; has an answer.
            </span>
          </div>
        </FormField>

        {tooMany && (
          /*
            Not a technical limit. It is the point past which nobody is really checking, and the
            undo is another bulk action in the other direction plus a timeline full of noise.
          */
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            That is more than {BULK_CEILING} accounts. Narrow the filters, or work through it a client at a time.
          </p>
        )}
        {error && <p className="text-sm text-negative-700">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-2">
            Cancel
          </button>
          <button type="button" onClick={() => void save()}
            disabled={busy || !toUserId || count === null || count === 0 || tooMany}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-950 text-white hover:bg-navy-900 disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
            Allocate
          </button>
        </div>
      </div>
    </Modal>
  )
}
