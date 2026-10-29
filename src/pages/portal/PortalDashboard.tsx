import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BarChart3, CalendarDays, FileText, FolderUp, Landmark, List, Mail, MessageCircle, Phone, ReceiptText, Ticket } from 'lucide-react'
import { rand } from '../../lib/money'
import { clockNow } from '../../lib/clock.ts'
import { getCurrentSalesMonth } from '../../lib/salesMonth.ts'
import { monthTrack } from '../../lib/clientBook.ts'
import { MonthTrackCard } from '../../components/dashboard/MonthTrackCard'
import { CLIENT_POSITIONS, CLIENT_POSITION_COLOUR, type ClientPosition } from '../../lib/clientPosition'
import { PORTAL_ENDING_COLOUR, type PortalOutcome, type PortalOutcomeLine } from '../../lib/clientPortal'
import { GapRing } from '../../components/ui/GapRing'
import { DashboardPanes } from '../../components/dashboard/DashboardPanes'
import { PortalSignedOut, fetchPortalDashboard, type PortalDashboard as Dash } from '../../lib/portalApi'
import { PortalHeading, PortalLabel } from './portalStyle'
import type { Section } from './PortalPage'

/**
 * THE CLIENT'S DASHBOARD (S15, Raptor · Handover 14), drawn the way the firm's remittance advice is drawn --
 * Stephan: "use the remittance advice as inspiration for what this whole dashboard should look like." Small
 * tracked labels in the advice's blue, figures large in its navy, the one figure that matters most on an
 * inverted navy tile with a gold label, hairlines and quiet fills.
 *
 * AND BY OUTCOME, NOT OPEN-OR-CLOSED: "how many accounts have been paid up? How many ... in progress, how many
 * ... in dispute, how many ... in negotiation." Finished accounts by how they finished; open ones by where
 * they stand (portalOutcomes, clientPosition's rules). One read, so it opens quickly (portal_summary).
 *
 * S16 (Raptor · Handover 15) GAVE IT RAPTOR'S SHAPE IN THE FIRM'S COLOURS. Stephan, with three mock-ups:
 * "make it look and feel like Raptor, except maybe the colour schemes ... more like Bredell" -- and of the
 * chart, "the handover thing that we have on the communications dashboard is better ... over the past months,
 * how did the handover, when did the handover". So the four figures are Raptor's tiles (an icon in a box),
 * the handovers are the communications dashboard's own MonthTrackCard over this client's book, and the
 * dashboard is where the client ACTS (his list, 29 Oct): who their liaison is and how to reach them, and a
 * button for each thing they come here to do.
 */
const colour = (o: PortalOutcome) =>
  o in PORTAL_ENDING_COLOUR ? PORTAL_ENDING_COLOUR[o as keyof typeof PORTAL_ENDING_COLOUR] : CLIENT_POSITION_COLOUR[o as ClientPosition]
const meaning = (o: PortalOutcome) =>
  o in PORTAL_ENDING_COLOUR ? null : CLIENT_POSITIONS[o as ClientPosition].meaning
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '—')

export function PortalDashboard({ token, onSignedOut, onOpen, onAsk }: {
  token: string
  onSignedOut: () => void
  onOpen: (section: Section) => void
  /** Only a call can be asked for here; a question or a payment is about one account, asked from its line. */
  onAsk: (mode: 'callback') => void
}) {
  const [d, setD] = useState<Dash | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [months, setMonths] = useState<6 | 12>(12)
  /* The same arithmetic as the communications dashboard's card, over this client's handovers only: every
     account the portal shows is the client's own, so it is all "existing client" work. */
  const track = useMemo(() => monthTrack({
    current: getCurrentSalesMonth(clockNow()), months, leads: [], deals: [],
    intake: (d?.handoverDays ?? []).map((r) => ({ day: r.day, accounts: r.accounts, capital: r.capital })),
  }), [d, months])

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

      {/*
        IN RAPTOR'S THREE ARRANGEMENTS (S16; Stephan: "the views, the three panes, everything underneath each
        other, the two panes, the split pane"): DashboardPanes, the same switcher and memory as every Raptor
        dashboard. The figures stay across the page in all three; the chart and the open accounts need the
        width; the liaison, what to do and the finished accounts read fine in a third. Opens on the split
        pane, the mock-ups' own drawing.
      */}
      <DashboardPanes layoutKey="raptor.portal.dashboard.layout" initial="wide" panes={[
        { id: 'figures', kind: 'full', node: (
          <section className="grid grid-cols-2 xl:grid-cols-4 gap-3" data-testid="portal-figures">
            <Tile icon={<Landmark size={19} />} label="Capital handed over" value={rand(f.capitalHandedOver)} note={`${d.accounts} accounts`} />
            <Tile icon={<BarChart3 size={19} />} label="Collected to date" value={rand(f.collectedToDate)} note={`${pct(f.collectedToDate, f.capitalHandedOver)} of capital`} invert />
            <Tile icon={<CalendarDays size={19} />} label="Collected this month" value={rand(f.collectedThisMonth)} />
            <Tile icon={<ReceiptText size={19} />} label="Capital outstanding" value={rand(f.capitalOutstanding)} note={`On ${d.open} open accounts`} />
          </section>
        ) },
        { id: 'handovers', kind: 'wide', node: (
          <MonthTrackCard kind="existing" rows={track} months={months} onMonths={setMonths} testId="portal-handovers"
            title="Your handovers, month by month"
            subtitle="The accounts you handed us each month. Switch to Rand for the capital, or to a line for the trend." />
        ) },
        { id: 'open', kind: 'wide', node: (
          <div className="card p-5">
            <PortalHeading title="Where your open accounts stand" subtitle="Every account we are still collecting, by where it is."
              action={<button type="button" onClick={() => onOpen('accounts')} className="text-sm font-semibold text-[#3F5F86] hover:underline">See every account</button>} />
            {open.length === 0 ? <p className="text-sm text-[#5A6B80] mt-4">No open accounts.</p> : (
              <div className="mt-4 flex flex-wrap items-center gap-6">
                <GapRing testId="portal-open-ring" total={String(d.open)} label="Open"
                  slices={open.map((o) => ({ key: o.outcome, value: o.accounts, color: colour(o.outcome) }))} />
                <div className="flex-1 min-w-[240px]"><OutcomeTable lines={open} total={d.open} testId="portal-positions" /></div>
              </div>
            )}
          </div>
        ) },
        { id: 'liaison', node: <Liaison liaison={d.liaison} onCall={() => onAsk('callback')} /> },
        { id: 'actions', node: (
          <div className="card p-5" data-testid="portal-actions">
            <PortalHeading title="What would you like to do?" />
            <div className="grid grid-cols-2 gap-2 mt-3">
              <Action icon={<FolderUp size={18} />} label="Hand over accounts" onClick={() => onOpen('handover')} testId="handover" />
              <Action icon={<Ticket size={18} />} label="Raise a ticket" hint="From the account's line" onClick={() => onOpen('accounts')} testId="ticket" />
              <Action icon={<ReceiptText size={18} />} label="Tell us about a payment" hint="From the account's line" onClick={() => onOpen('accounts')} testId="payment" />
              <Action icon={<FileText size={18} />} label="Your reports" onClick={() => onOpen('reports')} testId="reports" />
              <Action icon={<List size={18} />} label="Every account" onClick={() => onOpen('accounts')} testId="accounts" />
              <Action icon={<MessageCircle size={18} />} label="Your tickets" hint={d.tickets.open ? `${d.tickets.open} open` : undefined} onClick={() => onOpen('tickets')} testId="tickets" />
            </div>
          </div>
        ) },
        { id: 'finished', node: (
          <div className="card p-5">
            <PortalHeading title="Finished accounts" subtitle="How the accounts we are no longer collecting ended." />
            {finished.length === 0 ? <p className="text-sm text-[#5A6B80] mt-4">None finished yet.</p> : (
              <>
                <div className="mt-4 rounded-xl bg-[#111E2D] text-white p-4">
                  <PortalLabel invert>Paid up in full</PortalLabel>
                  <p className="text-3xl font-bold mt-1 tabular-nums" data-testid="portal-paid-up">{paidUp}</p>
                  <p className="text-xs text-[#AEBBCB] mt-0.5">{pct(paidUp, d.accounts)} of every account handed over</p>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-5">
                  <GapRing testId="portal-finished-ring" size={128} stroke={18} total={String(d.accounts - d.open)} label="Finished"
                    slices={finished.map((o) => ({ key: o.outcome, value: o.accounts, color: colour(o.outcome) }))} />
                  <div className="flex-1 min-w-[200px]"><OutcomeTable lines={finished} total={d.accounts - d.open} testId="portal-finished" /></div>
                </div>
              </>
            )}
          </div>
        ) },
      ]} />
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

/**
 * Raptor's tile: the label with its icon in a box beside it (StatTile's arrangement), the figure under them at
 * the tile's full width -- a seven-figure book does not fit beside an icon at four across. The one that matters
 * most is inverted.
 */
function Tile({ icon, label, value, note, invert = false }: { icon: ReactNode; label: string; value: string; note?: string; invert?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 sm:p-5 ${invert ? 'bg-[#111E2D] text-white border-l-[3px] border-l-[#C69F54]' : 'card'}`}>
      <div className="flex items-start justify-between gap-2">
        <PortalLabel invert={invert}>{label}</PortalLabel>
        <span className={`hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${invert ? 'bg-white/10 text-[#C69F54]' : 'bg-[#F2F5F8] text-[#3F5F86]'}`}>{icon}</span>
      </div>
      <p className={`text-xl sm:text-[1.55rem] font-bold tabular-nums whitespace-nowrap ${invert ? 'text-white' : 'text-[#111E2D]'}`}>{value}</p>
      {note && <p className={`text-xs mt-0.5 ${invert ? 'text-[#AEBBCB]' : 'text-[#5A6B80]'}`}>{note}</p>}
    </div>
  )
}

/*
 * YOUR LIAISON, AND EVERY WAY TO REACH THEM (Stephan's list, 29 Oct: "name, number, WhatsApp, email --
 * clickable"). A number is a tel: link and WhatsApp a wa.me link, so on the iPad or a phone one tap calls.
 * A client with no liaison yet is told who answers instead, never shown an empty card.
 */
function Liaison({ liaison, onCall }: { liaison: Dash['liaison']; onCall: () => void }) {
  const digits = (n: string) => n.replace(/\D/g, '').replace(/^0/, '27')
  return (
    <div className="rounded-2xl bg-[#111E2D] text-white p-5" data-testid="portal-liaison">
      <PortalLabel invert>Your liaison</PortalLabel>
      <p className="text-lg font-semibold mt-1">{liaison?.name || 'Our client team'}</p>
      <div className="mt-3 space-y-1.5 text-sm">
        {liaison?.phone && <a href={`tel:${liaison.phone.replace(/\s/g, '')}`} className="flex items-center gap-2.5 text-white/90 hover:text-white"><Phone size={15} className="text-[#C69F54]" />{liaison.phone}</a>}
        {liaison?.whatsapp && <a href={`https://wa.me/${digits(liaison.whatsapp)}`} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 text-white/90 hover:text-white"><MessageCircle size={15} className="text-[#C69F54]" />WhatsApp {liaison.whatsapp}</a>}
        {liaison?.email && <a href={`mailto:${liaison.email}`} className="flex items-center gap-2.5 text-white/90 hover:text-white truncate"><Mail size={15} className="text-[#C69F54] shrink-0" /><span className="truncate">{liaison.email}</span></a>}
      </div>
      <button type="button" onClick={onCall} data-testid="portal-liaison-call"
        className="mt-4 w-full rounded-lg bg-[#C69F54] text-[#111E2D] font-semibold text-sm py-2 hover:bg-[#d4b16c]">Ask us to call you</button>
    </div>
  )
}

function Action({ icon, label, hint, onClick, testId }: { icon: ReactNode; label: string; hint?: string; onClick: () => void; testId: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={`portal-action-${testId}`}
      className="text-left rounded-xl border border-[#D5DBE3] px-3 py-2.5 hover:border-[#C69F54] hover:bg-[#C69F54]/5 transition-colors">
      <span className="text-[#3F5F86]">{icon}</span>
      <span className="block text-[13px] font-semibold text-[#111E2D] mt-1.5 leading-tight">{label}</span>
      {hint && <span className="block text-[11px] text-[#5A6B80] mt-0.5">{hint}</span>}
    </button>
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
      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-6">
        <div className="h-64 rounded-2xl bg-[#EEF2F6]" />
        <div className="h-64 rounded-2xl bg-[#EEF2F6]" />
      </div>
      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
        <div className="h-72 rounded-2xl bg-[#EEF2F6]" />
        <div className="h-72 rounded-2xl bg-[#EEF2F6]" />
      </div>
    </div>
  )
}
