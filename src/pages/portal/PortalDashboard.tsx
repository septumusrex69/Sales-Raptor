import { useEffect, useState } from 'react'
import { rand } from '../../lib/money'
import { CLIENT_POSITIONS, CLIENT_POSITION_COLOUR, type ClientPosition } from '../../lib/clientPosition'
import { PORTAL_ENDING_COLOUR, type PortalOutcome, type PortalOutcomeLine } from '../../lib/clientPortal'
import { RingDonut } from '../../components/ui/RingDonut'
import { PortalSignedOut, fetchPortalDashboard, type PortalDashboard as Dash } from '../../lib/portalApi'
import { PortalHeading, PortalLabel } from './portalStyle'

/**
 * THE CLIENT'S DASHBOARD (S15, Raptor · Handover 14), drawn the way the firm's remittance advice is drawn --
 * Stephan: "use the remittance advice as inspiration for what this whole dashboard should look like." Small
 * tracked labels in the advice's blue, figures large in its navy, the one figure that matters most on an
 * inverted navy tile with a gold label, hairlines and quiet fills.
 *
 * AND BY OUTCOME, NOT OPEN-OR-CLOSED: "how many accounts have been paid up? How many ... in progress, how many
 * ... in dispute, how many ... in negotiation." Finished accounts by how they finished; open ones by where
 * they stand (portalOutcomes, clientPosition's rules). One read, so it opens quickly (portal_summary).
 */
const colour = (o: PortalOutcome) =>
  o in PORTAL_ENDING_COLOUR ? PORTAL_ENDING_COLOUR[o as keyof typeof PORTAL_ENDING_COLOUR] : CLIENT_POSITION_COLOUR[o as ClientPosition]
const meaning = (o: PortalOutcome) =>
  o in PORTAL_ENDING_COLOUR ? null : CLIENT_POSITIONS[o as ClientPosition].meaning
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '—')

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
  if (!d) return <Skeleton />

  const f = d.figures
  const open = d.outcomes.filter((o) => !o.finished)
  const finished = d.outcomes.filter((o) => o.finished)
  const paidUp = finished.find((o) => o.outcome === 'paid_up')?.accounts ?? 0
  return (
    <div className="space-y-6" data-testid="portal-dashboard">
      {d.tickets.waitingOnYou > 0 && (
        <button type="button" onClick={() => onOpen('tickets')} data-testid="portal-waiting"
          className="w-full text-left rounded-xl border border-[#C69F54]/40 bg-[#C69F54]/10 px-5 py-3.5 text-sm text-[#111E2D] flex items-center justify-between gap-3">
          <span><b>{d.tickets.waitingOnYou} ticket{d.tickets.waitingOnYou === 1 ? ' is' : 's are'} waiting on you.</b> We need your answer to carry on.</span>
          <span className="shrink-0 font-semibold text-[#3F5F86]">Open tickets →</span>
        </button>
      )}

      <section>
        <PortalHeading title="Your collection summary" subtitle={`${d.accounts} accounts handed over · ${d.open} still being collected`} />
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mt-4" data-testid="portal-figures">
          <Tile label="Capital handed over" value={rand(f.capitalHandedOver)} note={`${d.accounts} accounts`} />
          <Tile label="Collected to date" value={rand(f.collectedToDate)} note={`${pct(f.collectedToDate, f.capitalHandedOver)} of capital`} invert />
          <Tile label="Collected this month" value={rand(f.collectedThisMonth)} />
          <Tile label="Capital outstanding" value={rand(f.capitalOutstanding)} note={`On ${d.open} open accounts`} />
        </div>
      </section>

      <section className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
        <div className="rounded-2xl bg-white border border-[#D5DBE3] p-5">
          <PortalHeading title="Where your open accounts stand" subtitle="Every account we are still collecting, by where it is."
            action={<button type="button" onClick={() => onOpen('accounts')} className="text-sm font-semibold text-[#3F5F86] hover:underline">See every account</button>} />
          {open.length === 0 ? <p className="text-sm text-[#5A6B80] mt-4">No open accounts.</p> : (
            <div className="mt-4 grid sm:grid-cols-[auto_1fr] gap-6 items-center">
              <RingDonut legend={false} centerValue={String(d.open)} centerLabel="open"
                data={open.map((o) => ({ name: o.label, value: o.accounts, color: colour(o.outcome) }))} />
              <OutcomeTable lines={open} total={d.open} testId="portal-positions" />
            </div>
          )}
        </div>
        <div className="rounded-2xl bg-white border border-[#D5DBE3] p-5">
          <PortalHeading title="Finished accounts" subtitle="How the accounts we are no longer collecting ended." />
          {finished.length === 0 ? <p className="text-sm text-[#5A6B80] mt-4">None finished yet.</p> : (
            <>
              <div className="mt-4 rounded-xl bg-[#111E2D] text-white p-4">
                <PortalLabel invert>Paid up in full</PortalLabel>
                <p className="text-3xl font-bold mt-1 tabular-nums" data-testid="portal-paid-up">{paidUp}</p>
                <p className="text-xs text-[#AEBBCB] mt-0.5">{pct(paidUp, d.accounts)} of every account handed over</p>
              </div>
              <OutcomeTable lines={finished} total={d.accounts - d.open} testId="portal-finished" />
            </>
          )}
        </div>
      </section>
    </div>
  )
}

/** One rung a row, the advice's zebra table: a colour, the words, the count, the share, the capital. */
function OutcomeTable({ lines, total, testId }: { lines: PortalOutcomeLine[]; total: number; testId: string }) {
  return (
    <ul className="mt-2 text-sm min-w-0" data-testid={testId}>
      {lines.map((o, i) => (
        <li key={o.outcome} title={meaning(o.outcome) ?? undefined}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg ${i % 2 ? '' : 'bg-[#F2F5F8]'}`}>
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: colour(o.outcome) }} />
          <span className="flex-1 min-w-0 truncate whitespace-nowrap text-[#1B2B3E]">{o.label}</span>
          <span className="tabular-nums font-semibold text-[#111E2D] w-10 text-right shrink-0">{o.accounts}</span>
          <span className="tabular-nums text-[#5A6B80] w-12 text-right shrink-0">{pct(o.accounts, total)}</span>
          <span className="tabular-nums text-[#5A6B80] w-24 text-right shrink-0 hidden 2xl:block">{rand(o.finished ? o.paidToDate : o.outstanding)}</span>
        </li>
      ))}
    </ul>
  )
}

function Tile({ label, value, note, invert = false }: { label: string; value: string; note?: string; invert?: boolean }) {
  return (
    <div className={`rounded-2xl p-5 ${invert ? 'bg-[#111E2D] text-white' : 'bg-white border border-[#D5DBE3]'}`}>
      <PortalLabel invert={invert}>{label}</PortalLabel>
      <p className={`text-2xl sm:text-[1.7rem] font-bold tabular-nums mt-2 ${invert ? 'text-white' : 'text-[#111E2D]'}`}>{value}</p>
      {note && <p className={`text-xs mt-1 ${invert ? 'text-[#AEBBCB]' : 'text-[#5A6B80]'}`}>{note}</p>}
    </div>
  )
}

/* WHILE IT READS: the shapes of what is coming, not a sentence -- the page does not jump when it lands. */
function Skeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-label="Reading your book">
      <div className="h-6 w-64 rounded bg-[#EEF2F6]" />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 rounded-2xl bg-[#EEF2F6]" />)}
      </div>
      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
        <div className="h-72 rounded-2xl bg-[#EEF2F6]" />
        <div className="h-72 rounded-2xl bg-[#EEF2F6]" />
      </div>
    </div>
  )
}
