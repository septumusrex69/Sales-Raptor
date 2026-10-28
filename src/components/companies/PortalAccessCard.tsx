import { useEffect, useState } from 'react'
import { Card, CardHeader } from '../ui/Card'
import { useAuth } from '../../store/AuthContext'
import { can } from '../../lib/capabilities'
import { fetchPortalContacts, invitePortalContact, setPortalContactActive, type PortalContact } from '../../lib/portalStaffApi'
import type { Company } from '../../types'

/**
 * PORTAL ACCESS (S14, Raptor H13): which of the client's people may sign in to the client portal, and the
 * Invite that lets another one in. The liaison holds the relationship, so the tick is
 * dispute.write_to_client -- the same one the server checks (api/_lib/portal.ts).
 *
 * Main clients only: the portal shows a client and its sub-accounts together, so a sub-account says where
 * to go instead of offering an Invite the server would refuse.
 */
export function PortalAccessCard({ company }: { company: Company }) {
  const { currentUser } = useAuth()
  const allowed = can(currentUser, 'dispute.write_to_client')
  const [contacts, setContacts] = useState<PortalContact[] | null>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () => fetchPortalContacts(company.id).then(setContacts).catch((e: Error) => setError(e.message))
  useEffect(() => {
    if (allowed && !company.parentCompanyId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.id, allowed])

  if (!allowed) return null
  if (company.parentCompanyId) {
    return (
      <Card>
        <CardHeader title="Client portal" subtitle="Invite this client’s people on the main client: the portal shows it and all its sub-accounts together." />
      </Card>
    )
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setNote(null)
    try {
      const r = await invitePortalContact(company.id, email, name)
      setNote(r.emailed
        ? `Invited. ${email} has been emailed the link (${r.url}).`
        : `Access given, but the invitation could not be emailed (${r.emailError}). Send them ${r.url} yourself.`)
      setEmail(''); setName('')
      await load()
    } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }

  async function toggle(c: PortalContact) {
    setError(null)
    try { await setPortalContactActive(c.id, !c.active); await load() } catch (x) { setError(x instanceof Error ? x.message : String(x)) }
  }

  const when = (iso: string | null) => iso
    ? new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' })
    : 'Never'

  return (
    <Card>
      <CardHeader title="Client portal" subtitle="The client’s people who may sign in and see their accounts: one line per debtor, capital and payments, where each stands. Included, no charge." />
      <div data-testid="portal-access">
        {contacts === null ? <p className="text-sm text-slate-400 mt-3">Reading…</p>
          : contacts.length === 0 ? <p className="text-sm text-slate-500 mt-3">Nobody at {company.name} can sign in yet.</p>
            : (
              <ul className="mt-3 divide-y divide-slate-100">
                {contacts.map((c) => (
                  <li key={c.id} className="py-2 flex items-center justify-between gap-3 text-sm" data-testid="portal-contact">
                    <div className={c.active ? '' : 'opacity-50'}>
                      <p className="text-slate-800">{c.name || c.email}</p>
                      <p className="text-xs text-slate-500">{c.name ? `${c.email} · ` : ''}last signed in: {when(c.last_login_at)}{c.active ? '' : ' · switched off'}</p>
                    </div>
                    <button type="button" onClick={() => toggle(c)} className="text-xs underline text-slate-600">
                      {c.active ? 'Switch off' : 'Switch back on'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
        <form onSubmit={invite} className="mt-4 flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
            className="flex-1 min-w-[8rem] rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address"
            className="flex-[2] min-w-[12rem] rounded-lg border border-slate-300 px-3 py-1.5 text-sm" data-testid="portal-invite-email" />
          <button type="submit" disabled={busy || !email} className="rounded-lg bg-navy-900 text-white px-3 py-1.5 text-sm disabled:opacity-50">Invite</button>
        </form>
        {note && <p className="text-sm text-emerald-700 mt-2">{note}</p>}
        {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
      </div>
    </Card>
  )
}
