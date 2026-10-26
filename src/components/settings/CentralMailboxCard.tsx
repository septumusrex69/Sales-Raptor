import { useCallback, useEffect, useState } from 'react'
import { Loader2, Mail } from 'lucide-react'
import { Card } from '../ui/Card'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { supabase } from '../../lib/supabase'
import { clockNow } from '../../lib/clock'

/**
 * THE CENTRAL MAILBOX FOR DEBTOR CAMPAIGNS (Raptor H12).
 *
 * THE FIRM: a campaign may go out "from ... a centralized email ... from Bredell Ferreira" --
 * legal@bredellferreira.co.za. Raptor sends email only as a login whose mailbox it holds
 * (sendAsUser), so the central mailbox is a LOGIN: invite legal@ as a user, connect its mailbox on its
 * behalf under Users, and choose it here. Administrators only, as the table's policy says.
 */
export function CentralMailboxCard() {
  const { users } = useAppStore()
  const { currentUser } = useAuth()
  const [chosen, setChosen] = useState<string | null>(null)
  /* The chosen login's mailbox, asked of the server: email_connections has no browser policy at all. */
  const [address, setAddress] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const admin = currentUser?.role === 'Administrator'

  const load = useCallback(async () => {
    const { data: row } = await supabase.from('firm_mailboxes').select('user_id').eq('purpose', 'central').maybeSingle()
    const id = (row?.user_id as string) ?? null
    setChosen(id)
    setAddress(null)
    if (id) {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const res = token ? await fetch(`/api/email/status?targetUserId=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null) : null
      const status = res && res.ok ? ((await res.json().catch(() => null)) as { connected?: boolean; email?: string } | null) : null
      setAddress(status?.connected ? status.email ?? '' : null)
    }
    setLoaded(true)
  }, [])
  useEffect(() => { void load() }, [load])

  async function choose(id: string) {
    setBusy(true); setError(null)
    const { error: e } = id
      ? await supabase.from('firm_mailboxes').upsert({ purpose: 'central', user_id: id, set_by: currentUser?.id ?? null, set_at: clockNow().toISOString() })
      : await supabase.from('firm_mailboxes').delete().eq('purpose', 'central')
    setBusy(false)
    if (e) { setError(e.message); return }
    await load()
  }

  if (!admin) return null
  const who = users.find((u) => u.id === chosen)
  return (
    <Card className="p-4">
      <div data-testid="central-mailbox">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Mail size={15} /> Central mailbox for debtor campaigns</p>
        <p className="mt-0.5 text-xs text-slate-400">
          A campaign can go out from here instead of a person (e.g. legal@bredellferreira.co.za). Invite it as a user,
          connect its mailbox under Users, then choose it.
        </p>
        {!loaded ? <p className="mt-2 text-xs text-slate-400"><Loader2 size={12} className="inline animate-spin" /> Reading…</p> : (
          <>
            <select value={chosen ?? ''} disabled={busy} onChange={(e) => void choose(e.target.value)} aria-label="Central mailbox"
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm" data-testid="central-mailbox-pick">
              <option value="">None chosen</option>
              {users.filter((u) => u.status !== 'Inactive').sort((a, b) => a.name.localeCompare(b.name)).map((u) => (
                <option key={u.id} value={u.id}>{u.name} — {u.email}</option>
              ))}
            </select>
            {chosen && (address !== null
              ? <p className="mt-1 text-xs text-emerald-700">Campaigns can go out from {who?.name ?? 'this login'} &lt;{address}&gt;.</p>
              : <p className="mt-1 text-xs text-negative-700">{who?.name ?? 'This login'} has no mailbox connected, so nothing can go out from it yet. Connect it under Users.</p>)}
          </>
        )}
        {error && <p className="mt-1 text-xs text-negative-700">{error}</p>}
      </div>
    </Card>
  )
}
