import { useEffect, useState } from 'react'
import { rand } from '../../lib/money'
import { CLIENT_POSITIONS, CLIENT_POSITION_COLOUR } from '../../lib/clientPosition'
import { RingDonut } from '../../components/ui/RingDonut'
import { PortalSignedOut, fetchPortalDashboard, type PortalDashboard as Dash } from '../../lib/portalApi'

/**
 * THE CLIENT'S DASHBOARD (S15, Raptor · Handover 14). Stephan: "something like a dashboard on there, like we
 * have, handed over accounts, collected, then by status, circles". The first thing a client sees, so it
 * answers the question they log in with -- how is my book doing -- before they go looking for one debtor.
 *
 * CAPITAL, NOT BALANCE, as everywhere on the portal: interest and fees are the firm's side of the debt.
 * The ring is the open book by position, in the same colours the firm's own client page uses
 * (CLIENT_POSITION_COLOUR), so a liaison on the phone and the client at their desk see one picture.
 */
export function PortalDashboard({ token, onSignedOut, onOpen }: {
  token: string
  onSignedOut: () => void
  onOpen: (section: 'tickets' | 'accounts') => void
}) {
  const [d, setD] = useState<Dash | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetchPortalDashboard(token)
      .then((x) => { if (live) setD(x) })
      .catch((e) => { if (!live) return; if (e instanceof PortalSignedOut) onSignedOut(); else setError(e.message) })
    return () => { live = false }
  }, [token, onSignedOut])

  if (error) return <p className="text-sm text-red-700">{error}</p>
  if (!d) return <p className="text-sm text-slate-400">Reading your book…</p>

  const f = d.figures
  const rate = f.capitalHandedOver > 0 ? Math.round((f.collectedToDate / f.capitalHandedOver) * 1000) / 10 : 0
  return (
    <div className="space-y-5" data-testid="portal-dashboard">
      {d.tickets.waitingOnYou > 0 && (
        <button type="button" onClick={() => onOpen('tickets')} data-testid="portal-waiting"
          className="w-full text-left rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>{d.tickets.waitingOnYou} ticket{d.tickets.waitingOnYou === 1 ? ' is' : 's are'} waiting on you.</b>{' '}
          Open Tickets to answer.
        </button>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="portal-figures">
        <Figure label="Capital handed over" value={rand(f.capitalHandedOver)} note={`${d.open + d.closed} accounts`} />
        <Figure label="Collected to date" value={rand(f.collectedToDate)} note={`${rate}% of capital`} />
        <Figure label="Collected this month" value={rand(f.collectedThisMonth)} />
        <Figure label="Capital outstanding" value={rand(f.capitalOutstanding)} note={`${d.open} open · ${d.closed} closed`} />
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h2 className="text-lg text-slate-900">Where your open accounts stand</h2>
          <button type="button" onClick={() => onOpen('accounts')} className="text-sm underline text-slate-600">See every account</button>
        </div>
        {d.positions.length === 0 ? <p className="text-sm text-slate-500">No open accounts.</p> : (
          <div className="grid md:grid-cols-[auto_1fr] gap-6 items-center">
            <RingDonut legend={false} centerValue={String(d.open)} centerLabel="open"
              data={d.positions.map((p) => ({ name: p.label, value: p.count, color: CLIENT_POSITION_COLOUR[p.position] }))} />
            <ul className="divide-y divide-slate-100" data-testid="portal-positions">
              {d.positions.map((p) => (
                <li key={p.position} className="py-2 flex items-center gap-3 text-sm" title={CLIENT_POSITIONS[p.position].meaning}>
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: CLIENT_POSITION_COLOUR[p.position] }} />
                  <span className="flex-1 text-slate-800">{p.label}</span>
                  <span className="tabular-nums text-slate-600 w-12 text-right">{p.count}</span>
                  <span className="tabular-nums text-slate-500 w-32 text-right">{rand(p.outstanding)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <p className="text-xs uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-xl text-slate-900 tabular-nums mt-1">{value}</p>
      {note && <p className="text-xs text-slate-500 mt-0.5">{note}</p>}
    </div>
  )
}
