import { useEffect, useMemo, useState } from 'react'
import { Card, CardHeader } from '../ui/Card'
import { UserAvatar } from '../ui/Avatar'
import { useAppStore } from '../../store/AppStore'
import { clockNow } from '../../lib/clock'
import { fetchTicketClocks } from '../../lib/accountQueries'
import { formatWorkingTime, statsByOwner, type PersonTicketStats } from '../../lib/ticketClock'

/**
 * TICKETS: HOW FAST EACH PERSON ANSWERS AND RESOLVES THEM (S14, Raptor H13).
 *
 * THE FIRM, 27 Oct: "on the communications dashboard, see how long does it take a specific clerk or a
 * communications agent to resolve a specific query ... average response or average resolution time" -- and
 * BOTH figures: the time a ticket sat with us (the clock stopped while the client had it) and the whole
 * time it was open. Office hours, read off each ticket's own history (ticketClock.ts). Averages are over
 * RESOLVED tickets; what is still open is counted beside them, not averaged into finished work.
 */
const PERIODS = [30, 90, 365] as const

export function TicketSpeedCard() {
  const { users } = useAppStore()
  const [days, setDays] = useState<(typeof PERIODS)[number]>(90)
  const [rows, setRows] = useState<PersonTicketStats[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setRows(null); setError(null)
    /* The firm's clock: every stamp on a ticket is (raptor_now -- the staging clock on staging). */
    const now = clockNow()
    const since = new Date(now.getTime() - days * 86_400_000).toISOString()
    fetchTicketClocks(since, now.toISOString())
      .then((ts) => { if (live) setRows(statsByOwner(ts)) })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [days])

  const name = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])

  return (
    <Card padded={false}>
      <div className="p-5 pb-3 flex flex-wrap items-start justify-between gap-3">
        <CardHeader title="Tickets: how fast" subtitle="Disputes, queries and requests, by whose ticket it is. Office hours, averages over the resolved ones." />
        <div className="flex gap-1" role="radiogroup" aria-label="Period">
          {PERIODS.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)}
              className={`rounded-lg border px-2.5 py-1 text-xs ${days === d ? 'border-navy-900 bg-navy-900 text-white' : 'border-slate-200 text-slate-600'}`}>
              {d === 365 ? 'Year' : `${d} days`}
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="px-5 pb-5 text-sm text-slate-500">Could not be read just now.</p>
        : rows === null ? <p className="px-5 pb-5 text-sm text-slate-400">Reading…</p>
          : rows.length === 0 ? <p className="px-5 pb-5 text-sm text-slate-400">No tickets in this period.</p>
            : (
              <div className="overflow-x-auto">
                <table className="w-full list-table whitespace-nowrap" data-testid="ticket-speed">
                  <thead>
                    <tr className="text-left border-y border-slate-100 text-slate-400">
                      <th className="font-medium px-3 py-2">Person</th>
                      <th className="font-medium px-2 py-2 text-right">Resolved</th>
                      <th className="font-medium px-2 py-2 text-right">Still open</th>
                      <th className="font-medium px-2 py-2 text-right" title="Raised to the first email or move">First response</th>
                      <th className="font-medium px-2 py-2 text-right" title="The clock stopped while the client had it">Time with us</th>
                      <th className="font-medium px-3 py-2 text-right" title="Raised to resolved">Whole time open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const u = name.get(r.ownerId)
                      return (
                        <tr key={r.ownerId} className="border-b border-slate-50" data-testid="ticket-speed-row">
                          <td className="px-3 py-1.5">
                            <span className="inline-flex items-center gap-2">
                              <UserAvatar userId={r.ownerId} size={18} />
                              <span className="text-slate-700">{u?.name ?? 'Someone who has left'}</span>
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.resolved}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{r.open}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{formatWorkingTime(r.avgFirstResponse)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{formatWorkingTime(r.avgWithUs)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{formatWorkingTime(r.avgOpen)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
    </Card>
  )
}
