import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { saveDirector, removeDirector } from '../../lib/accountStandingData.ts'
import { cleanDirector, directorProblem } from '../../lib/debtorIdentity.ts'
import { isValidSaId } from '../../lib/newDebtor'
import type { AccountDirector } from '../../lib/accountStanding.ts'

/**
 * A director, typed in.
 *
 * WHY THIS EXISTS. Directors arrived one way until now — parsed off a commercial trace PDF — and
 * that only works once somebody has paid for one. The firm's ask is the case where nobody has:
 * "if there's a company, the ID numbers of the directors should also be stored." A collector
 * reading a letterhead, a CIPC disclosure or a signed suretyship has the names, and usually the
 * numbers, long before a bureau report is bought.
 *
 * THE ID NUMBER IS THE POINT and it is still optional, which looks backwards and is not. The ID
 * is what makes a director traceable in their own right — and on a suretyship it is who actually
 * owes the money — but the names turn up first. Requiring the number until it arrives means the
 * names never get recorded at all, and a company with nobody against it is a company nobody can
 * ring.
 */
export function DirectorModal({ accountId, director, onClose, onSaved }: {
  accountId: string
  /** The one being corrected, or null to add. */
  director: AccountDirector | null
  onClose: () => void
  onSaved: () => void
}) {
  const [fullName, setFullName] = useState(director?.fullName ?? '')
  const [idNumber, setIdNumber] = useState(director?.idNumber ?? '')
  const [status, setStatus] = useState<'Active' | 'Resigned'>(director?.status ?? 'Active')
  const [appointedOn, setAppointedOn] = useState(director?.appointedOn ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const input = cleanDirector({ fullName, idNumber, status, appointedOn })
  const problem = directorProblem(input, isValidSaId)

  async function save() {
    if (problem) { setError(problem); return }
    setBusy(true); setError(null)
    try {
      await saveDirector({ accountId, directorId: director?.id, ...input })
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  async function drop() {
    if (!director) return
    setBusy(true); setError(null)
    try {
      await removeDirector(director.id)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  const field = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700'
  return (
    <Modal onClose={onClose} title={director ? 'Correct a director' : 'Add a director'} width={460}>
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-500">Full name</span>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)}
            className={field} placeholder="As it appears on the register" autoFocus />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-slate-500">
            ID number <span className="text-slate-400">— optional, but it is what makes them traceable</span>
          </span>
          <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)}
            className={`${field} font-mono`} placeholder="13 digits" inputMode="numeric" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as 'Active' | 'Resigned')}
              className={field}>
              <option value="Active">Active</option>
              <option value="Resigned">Resigned</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Appointed</span>
            <input type="date" value={appointedOn} onChange={(e) => setAppointedOn(e.target.value)}
              className={field} />
          </label>
        </div>

        {/*
          THE PROBLEM IS SHOWN BEFORE SAVE IS PRESSED, not after. A transposed digit is the
          commonest way an ID goes wrong and it is thirteen digits either way — telling somebody
          afterwards means they have already moved on.
        */}
        {problem && fullName.trim() !== '' && (
          <p className="text-xs text-gold-700">{problem}</p>
        )}
        {error && <p className="text-xs text-negative-700">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          <button type="button" disabled={busy || !!problem} onClick={() => void save()}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:opacity-50">
            {director ? 'Save' : 'Add director'}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:underline">
            Cancel
          </button>
          {/* Removing is for the row that was WRONG. Somebody who resigned is marked resigned. */}
          {director && (
            <button type="button" disabled={busy} onClick={() => void drop()}
              className="ml-auto text-xs text-negative-700 hover:underline disabled:opacity-50">
              Remove
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
