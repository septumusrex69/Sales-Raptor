import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, Loader2, Mail } from 'lucide-react'
import { Card } from '../ui/Card'
import { FormField, inputClass } from '../ui/Modal'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { supabase } from '../../lib/supabase'
import { clockNow } from '../../lib/clock'
import { UNASSIGNED_MAILBOX } from '../../lib/unassignedMailbox'

/**
 * THE FIRM'S CENTRAL MAILBOX -- legal@ -- SET UP WHERE IT IS CHOSEN (Raptor H12; S18).
 *
 * WHAT IT IS FOR: a debtor campaign or a letter of demand may go out from it instead of a person, and a
 * workflow email or a portal code on an account NOBODY holds goes out from it (unassignedMailbox.ts).
 *
 * WHY IT IS A LOGIN. Raptor sends email only as a login whose mailbox it holds (sendAsUser), so the central
 * mailbox is a login too. That used to be three screens: invite legal@ as a user, connect its mailbox under
 * Users, then pick it here from a list of every colleague's address in a box too narrow to read. Stephan, 6 Nov:
 * "It gives me an option to choose everybody else's email addresses ... Doesn't give me an option to choose
 * legal. I think you should be able to connect it from there, because it won't be anybody else's email address."
 *
 * SO IT IS ONE FORM. The address and the password; the login is made for it if there is none -- the same locked,
 * inactive record invite-user makes for somebody who may never sign in (banned at the auth layer, so no reset
 * link or code opens it) -- its mailbox is connected with the same /api/email/connect an Administrator uses for a
 * colleague, and it is chosen as the central mailbox. Nobody signs in as legal@; Raptor only sends from it.
 * The password is typed here and goes straight to the server, which stores it encrypted.
 *
 * Choosing an existing login stays possible, underneath, full width. Administrators only, as the table's policy.
 */
export function CentralMailboxCard() {
  const { users } = useAppStore()
  const { currentUser, session } = useAuth()
  const [chosen, setChosen] = useState<string | null>(null)
  /* The chosen login's mailbox, asked of the server: email_connections has no browser policy at all. */
  const [address, setAddress] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [setting, setSetting] = useState(false)
  const domain = UNASSIGNED_MAILBOX.split('@')[1]
  const [form, setForm] = useState({
    email: UNASSIGNED_MAILBOX, name: 'Bredell Ferreira Legal', password: '',
    smtpHost: `mail.${domain}`, smtpPort: '587', imapHost: `mail.${domain}`, imapPort: '993',
  })
  const admin = currentUser?.role === 'Administrator'
  const token = session?.access_token ?? null

  const load = useCallback(async () => {
    const { data: row } = await supabase.from('firm_mailboxes').select('user_id').eq('purpose', 'central').maybeSingle()
    const id = (row?.user_id as string) ?? null
    setChosen(id)
    setAddress(null)
    if (id) {
      const { data } = await supabase.auth.getSession()
      const t = data.session?.access_token
      const res = t ? await fetch(`/api/email/status?targetUserId=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${t}` } }).catch(() => null) : null
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

  /* ONE PRESS: the login (made if missing), its mailbox, and the choice -- each step said if it fails. */
  async function setUp(e: FormEvent) {
    e.preventDefault()
    if (!token) { setError('Your session has expired. Sign in again.'); return }
    setBusy(true); setError(null)
    const post = (path: string, body: unknown) => fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    }).then(async (r) => ({ ok: r.ok, body: (await r.json().catch(() => ({}))) as { error?: string; userId?: string } }))
    try {
      const email = form.email.trim().toLowerCase()
      let userId = users.find((u) => (u.email ?? '').toLowerCase() === email)?.id ?? null
      if (!userId) {
        const made = await post('/api/invite-user', { email, name: form.name.trim() || email, role: 'Read Only', signIn: false })
        if (!made.ok || !made.body.userId) { setError(made.body.error ?? 'The login for this mailbox could not be made.'); return }
        userId = made.body.userId
      }
      const connected = await post('/api/email/connect', {
        targetUserId: userId, email, password: form.password,
        smtpHost: form.smtpHost.trim(), smtpPort: Number(form.smtpPort),
        imapHost: form.imapHost.trim(), imapPort: Number(form.imapPort),
      })
      if (!connected.ok) { setError(connected.body.error ?? 'The mailbox could not be connected.'); return }
      const { error: pick } = await supabase.from('firm_mailboxes').upsert({
        purpose: 'central', user_id: userId, set_by: currentUser?.id ?? null, set_at: clockNow().toISOString(),
      })
      if (pick) { setError(`The mailbox is connected, but it could not be chosen: ${pick.message}`); return }
      setForm((f) => ({ ...f, password: '' }))
      setSetting(false)
      await load()
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!admin) return null
  const who = users.find((u) => u.id === chosen)
  const ready = !!chosen && address !== null
  return (
    <Card className="p-4 md:col-span-2">
      <div data-testid="central-mailbox">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Mail size={15} /> Central mailbox (legal@)</p>
        <p className="mt-0.5 text-xs text-slate-400">
          Campaigns and letters of demand can go out from it instead of a person, and so do notices and portal codes on
          accounts nobody holds. Nobody signs in as it; Raptor only sends from it.
        </p>

        {!loaded ? <p className="mt-2 text-xs text-slate-400"><Loader2 size={12} className="inline animate-spin" /> Reading…</p> : (
          <>
            {ready ? (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-emerald-700" data-testid="central-mailbox-ready">
                <CheckCircle2 size={15} /> Connected: {address} {who?.name ? <span className="text-slate-400">({who.name})</span> : null}
              </p>
            ) : chosen ? (
              <p className="mt-3 text-sm text-negative-700">{who?.name ?? 'The chosen login'} has no mailbox connected, so nothing can go out from it yet.</p>
            ) : (
              <p className="mt-3 text-sm text-amber-700">No central mailbox yet: notices on accounts nobody holds are held until there is one.</p>
            )}

            {!setting ? (
              <button type="button" data-testid="central-mailbox-setup" onClick={() => setSetting(true)}
                className="mt-3 text-sm font-medium px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
                {ready ? 'Reconnect (new password)' : `Connect ${UNASSIGNED_MAILBOX}`}
              </button>
            ) : (
              <form onSubmit={setUp} className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="central-mailbox-form">
                <FormField label="Mailbox address" required>
                  <input className={inputClass} type="email" value={form.email} required
                    onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </FormField>
                <FormField label="Mailbox password" required>
                  <input className={inputClass} type="password" autoComplete="new-password" value={form.password} required
                    onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </FormField>
                <FormField label="Name it sends as">
                  <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </FormField>
                <div />
                <FormField label="SMTP host" required>
                  <input className={inputClass} value={form.smtpHost} required onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} />
                </FormField>
                <FormField label="SMTP port" required>
                  <input className={inputClass} type="number" value={form.smtpPort} required onChange={(e) => setForm({ ...form, smtpPort: e.target.value })} />
                </FormField>
                <FormField label="IMAP host" required>
                  <input className={inputClass} value={form.imapHost} required onChange={(e) => setForm({ ...form, imapHost: e.target.value })} />
                </FormField>
                <FormField label="IMAP port" required>
                  <input className={inputClass} type="number" value={form.imapPort} required onChange={(e) => setForm({ ...form, imapPort: e.target.value })} />
                </FormField>
                <p className="md:col-span-2 text-xs text-slate-400">
                  The hosts are guessed from the address (mail.{domain}); change them if your mail provider gives others. The
                  password is checked against the mailbox, then stored encrypted on the server.
                </p>
                <div className="md:col-span-2 flex items-center gap-2">
                  <button type="submit" disabled={busy}
                    className="text-sm font-medium px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
                    {busy ? 'Connecting…' : 'Connect and use it'}
                  </button>
                  <button type="button" onClick={() => { setSetting(false); setError(null) }}
                    className="text-sm font-medium px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100">Cancel</button>
                </div>
              </form>
            )}

            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-medium text-slate-500">Or use a login that already exists</summary>
              <select value={chosen ?? ''} disabled={busy} onChange={(e) => void choose(e.target.value)} aria-label="Central mailbox"
                className={`${inputClass} mt-2 text-sm`} data-testid="central-mailbox-pick">
                <option value="">None chosen</option>
                {users.slice().sort((a, b) => a.name.localeCompare(b.name)).map((u) => (
                  <option key={u.id} value={u.id}>{u.name} · {u.email}</option>
                ))}
              </select>
            </details>
          </>
        )}
        {error && <p className="mt-2 text-sm text-negative-700">{error}</p>}
      </div>
    </Card>
  )
}
