import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { deviceId } from '../../lib/deviceId'
import { WAIVER_MINUTES } from '../../lib/loginCode'
import { Modal } from '../ui/Modal'
import type { User } from '../../types'

/**
 * THE DEVICES AN ADMINISTRATOR HAS CONFIRMED WITH AN EMAILED CODE (S10, 21 Oct).
 *
 * On their own Profile, and -- for another Administrator -- under Settings -> Users. Removing a
 * device means the next sign-in there asks for a code again; it is what to do when an iPad is lost
 * or left at a client.
 *
 * AND THE WAY OUT when somebody's code is not arriving: "Let in without a code" lets the next
 * sign-in through once, within thirty minutes. Only for SOMEBODY ELSE -- offered to yourself it
 * would be a switch that turns the code off. login_code_waive refuses it in the database too.
 *
 * Reads go straight to trusted_devices (RLS: your own, or everybody's for an Administrator).
 * Nothing here writes the table; the two RPCs do, and each checks who is asking.
 */
interface DeviceRow { id: string; device_hash: string; label: string | null; created_at: string; last_seen_at: string }

async function sha256Hex(value: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

const when = (iso: string) => new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function TrustedDevicesList({ user, isSelf }: { user: Pick<User, 'id' | 'name'>; isSelf: boolean }) {
  const [rows, setRows] = useState<DeviceRow[] | null>(null)
  const [here, setHere] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error: readError } = await supabase.from('trusted_devices')
      .select('id, device_hash, label, created_at, last_seen_at').eq('user_id', user.id).order('last_seen_at', { ascending: false })
    if (readError) { setError(readError.message); setRows([]); return }
    setRows((data ?? []) as DeviceRow[])
  }, [user.id])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (isSelf) void sha256Hex(deviceId()).then(setHere)
  }, [isSelf])

  async function remove(deviceRowId: string | null) {
    setBusy(true); setError(null); setNote(null)
    const { error: rpcError } = await supabase.rpc('trusted_devices_remove', { p_user_id: user.id, p_device_id: deviceRowId })
    setBusy(false)
    if (rpcError) { setError(rpcError.message); return }
    setNote(deviceRowId ? 'Removed. That device will ask for a code next time.' : 'All removed. Every device will ask for a code next time.')
    void load()
  }

  async function waive() {
    setBusy(true); setError(null); setNote(null)
    const { error: rpcError } = await supabase.rpc('login_code_waive', { p_user_id: user.id })
    setBusy(false)
    if (rpcError) { setError(rpcError.message); return }
    setNote(`${user.name.split(' ')[0]} can sign in once without a code in the next ${WAIVER_MINUTES} minutes. Tell them to press “Send a new code”.`)
  }

  return (
    <div data-testid="trusted-devices">
      {rows === null ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No trusted devices. The next sign-in asks for a code by email.</p>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-700 truncate">
                  {r.label ?? 'A device'}
                  {here === r.device_hash && <span className="ml-2 text-[11px] font-semibold text-[var(--c-green)]">This device</span>}
                </p>
                <p className="text-[12px] text-slate-400">Added {when(r.created_at)} · last used {when(r.last_seen_at)}</p>
              </div>
              <button type="button" disabled={busy} onClick={() => void remove(r.id)}
                className="text-xs font-medium text-[var(--c-rust-deep)] hover:underline disabled:opacity-50 shrink-0">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {rows && rows.length > 1 && (
          <button type="button" disabled={busy} onClick={() => void remove(null)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            Remove all
          </button>
        )}
        {!isSelf && (
          <button type="button" disabled={busy} onClick={() => void waive()}
            title="For when their code email is not arriving"
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            Let in without a code ({WAIVER_MINUTES} min)
          </button>
        )}
      </div>
      {note && <p className="mt-2 text-[12px] text-[var(--c-green)]" role="status">{note}</p>}
      {error && <p className="mt-2 text-[12px] text-[var(--c-rust-deep)]" role="alert">{error}</p>}
    </div>
  )
}

export function TrustedDevicesModal({ user, isSelf, onClose }: { user: User; isSelf: boolean; onClose: () => void }) {
  return (
    <Modal title={`${user.name}: trusted devices`} subtitle="An Administrator types an emailed code on any other device." onClose={onClose} width={520}>
      <TrustedDevicesList user={user} isSelf={isSelf} />
    </Modal>
  )
}
