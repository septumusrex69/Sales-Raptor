import { useState } from 'react'
import { Card, CardHeader } from '../ui/Card'
import { useAuth } from '../../store/AuthContext'
import { debtorPortalLink } from '../../lib/debtorPortal'
import { inviteDebtor } from '../../lib/debtorPortalApi'

/**
 * INVITE THE DEBTOR TO THEIR OWN ACCOUNT (Raptor H16; Stephan, 3 Nov: "I put my email address on [a debtor] and then I
 * wanted to send it and invite her, but I don't know how"). Two ways, because a debtor is reached two ways:
 *   - EMAIL, from the collector's own mailbox, to the email on the account (the server picks it; nobody types one);
 *   - THE LINK, copied, for a WhatsApp or an SMS the collector sends as they always do.
 * The link carries the case number, so the debtor only has to ask for their first code. It is directions, not a key.
 */
export function DebtorPortalCard({ accountId, caseNumber, hasEmail }: { accountId: string; caseNumber: string | null; hasEmail: boolean }) {
  const { session } = useAuth()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!caseNumber) return null
  const link = debtorPortalLink(window.location.origin, caseNumber)

  async function email() {
    setBusy(true); setError(null); setNote(null)
    try {
      if (!session?.access_token) throw new Error('Sign in to Raptor again.')
      const r = await inviteDebtor(session.access_token, accountId)
      setNote(`Invitation emailed to ${r.to}.`)
    } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }
  async function copy() {
    setError(null)
    try { await navigator.clipboard.writeText(link); setNote('Link copied. Paste it into a WhatsApp or an SMS to the debtor.') }
    catch { setNote(link) }
  }

  return (
    <div data-testid="debtor-portal-card"><Card>
      <CardHeader title="Debtor portal" subtitle="The debtor can see their balance and statement, pay, offer an arrangement and ask or dispute online." />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !hasEmail} onClick={email}
          title={hasEmail ? undefined : 'Add an email address for the debtor under Contacts first'}
          className="rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Email the debtor an invitation</button>
        <button type="button" onClick={copy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">Copy link</button>
      </div>
      {!hasEmail && <p className="mt-2 text-xs text-slate-500">No email address on this account yet: add one under Contacts to email it, or copy the link.</p>}
      {note && <p className="mt-2 text-sm text-emerald-700 break-all" data-testid="debtor-portal-note">{note}</p>}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </Card></div>
  )
}
