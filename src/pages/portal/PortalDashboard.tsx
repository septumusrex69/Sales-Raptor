import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowRight, BarChart3, CalendarDays, ChevronRight, CircleSlash, Clock3, FileText, UserPen, FolderUp, Landmark, List, Mail, MessageCircle, Phone, ReceiptText, Ticket } from 'lucide-react'
import { rand } from '../../lib/money'
import { clockNow } from '../../lib/clock.ts'
import { getCurrentSalesMonth } from '../../lib/salesMonth.ts'
import { monthTrack } from '../../lib/clientBook.ts'
import { MonthTrackCard } from '../../components/dashboard/MonthTrackCard'
import { CLIENT_POSITIONS, type ClientPosition } from '../../lib/clientPosition'
import { PORTAL_ENDING_COLOUR, type PortalOutcome, type PortalOutcomeLine } from '../../lib/clientPortal'
import { BF, portalOutcomeColour } from './portalColours'
import { GapRing } from '../../components/ui/GapRing'
import { DashboardPanes } from '../../components/dashboard/DashboardPanes'
import { PortalSignedOut, fetchPortalDashboard, type PortalDashboard as Dash } from '../../lib/portalApi'
import { PortalLabel } from './portalStyle'
import type { Section } from './PortalPage'
import type { AskMode } from './PortalAsk'
import type { PortalTopic } from '../../lib/clientPortal'

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
 *
 * AND THEN TO HIS BRIEF (S16, 29 Oct: "Looks weird. Here some guidance."): the firm's palette and nothing else --
 * the rings by status in navy, gold, light blue, slate (portalColours.ts), no green, no red; Raleway for headings
 * and figures, Open Sans for the rest (portal.css); white cards on off-white, 16 px corners, quiet shadows; the
 * figures four across only where a seven-figure rand fits, two across on an iPad; the two rings in matching
 * cards with the largest status leading the legend; the actions a compact list.
 */
const colour = (o: PortalOutcome) => portalOutcomeColour(o)
const meaning = (o: PortalOutcome) =>
  o in PORTAL_ENDING_COLOUR ? null : CLIENT_POSITIONS[o as ClientPosition].meaning
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '—')

export function PortalDashboard({ token, onSignedOut, onOpen, onAsk }: {
  token: string
  onSignedOut: () => void
  onOpen: (section: Section) => void
  /** Opens the ask window; without an account it asks which one first (PortalAsk). */
  onAsk: (mode: AskMode, topic?: PortalTopic) => void
}) {
  const [d, setD] = useState<Dash | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [months, setMonths] = useState<6 | 12>(12)
  /* The same arithmetic as the communications dashboard's card, over this client's handovers only: every
     account the portal shows is the client's own, so it is all "existing client" work. */
  /*
   * THE TILES' TRENDS (S16, Stephan's mock-up puts a small chart under each figure). Real, not decoration: the
   * capital handed over and the money collected, month by month over the last year, read from the same two
   * series the server already sends (handovers per day, collected per month). Outstanding has no honest monthly
   * series -- it moves with closures and write-offs too -- so its tile shows its share of the capital instead.
   */
  const trends = useMemo(() => {
    const months: string[] = []
    const now = clockNow()
    for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); months.push(d.toISOString().slice(0, 7)) }
    const handed = new Map<string, number>()
    for (const r of d?.handoverDays ?? []) handed.set(r.day.slice(0, 7), (handed.get(r.day.slice(0, 7)) ?? 0) + r.capital)
    const paid = new Map((d?.collectedMonths ?? []).map((r) => [r.month, r.collected]))
    let h = 0, c = 0
    return {
      handedCumulative: months.map((m) => (h += handed.get(m) ?? 0)),
      collectedCumulative: months.map((m) => (c += paid.get(m) ?? 0)),
      collectedMonthly: months.map((m) => paid.get(m) ?? 0),
    }
  }, [d])
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
          className="w-full text-left rounded-[14px] border border-[#C69F54]/45 bg-white px-5 py-3.5 text-sm text-[#101F2C] flex items-center justify-between gap-3 shadow-[0_1px_2px_rgba(16,31,44,0.04)] border-l-[3px] border-l-[#C69F54]">
          <span><b>{d.tickets.waitingOnYou} ticket{d.tickets.waitingOnYou === 1 ? ' is' : 's are'} waiting on you.</b> We need your answer to carry on.</span>
          <span className="shrink-0 font-semibold text-[#46607B]">Open tickets →</span>
        </button>
      )}

      {/*
        IN RAPTOR'S THREE ARRANGEMENTS (S16; Stephan: "the views, the three panes, everything underneath each
        other, the two panes, the split pane"): DashboardPanes, the same switcher and memory as every Raptor
        dashboard. The figures stay across the page in all three; the chart and the open accounts need the
        width; the liaison, what to do and the finished accounts read fine in a third. Opens on the split
        pane, the mock-ups' own drawing.
      */}
      {/*
        IN RAPTOR'S THREE ARRANGEMENTS (S16; Stephan: "the views, the three panes, everything underneath each
        other, the two panes, the split pane"), laid out as his mock-up: the four figures across; the handovers
        chart with the two rings side by side under it on the left; what to do, then the liaison, on the right.
      */}
      <DashboardPanes layoutKey="raptor.portal.dashboard.layout" initial="wide" panes={[
        { id: 'figures', kind: 'full', node: (
          <section className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-4" data-testid="portal-figures">
            <Tile icon={<Landmark size={19} />} label="Capital handed over" value={rand(f.capitalHandedOver)} note={`${d.accounts} accounts`}
              trend={trends.handedCumulative} onOpen={() => onOpen('accounts')} />
            <Tile icon={<BarChart3 size={19} />} label="Collected to date" value={rand(f.collectedToDate)} note={`${pct(f.collectedToDate, f.capitalHandedOver)} of capital`}
              trend={trends.collectedCumulative} invert onOpen={() => onOpen('reports')} />
            <Tile icon={<CalendarDays size={19} />} label="Collected this month" value={rand(f.collectedThisMonth)} note={`${pct(f.collectedThisMonth, f.capitalHandedOver)} of capital`}
              trend={trends.collectedMonthly} onOpen={() => onOpen('reports')} />
            <Tile icon={<Clock3 size={19} />} label="Capital outstanding" value={rand(f.capitalOutstanding)} note={`On ${d.open} open accounts`}
              share={f.capitalHandedOver > 0 ? f.capitalOutstanding / f.capitalHandedOver : null} onOpen={() => onOpen('accounts')} />
          </section>
        ) },
        { id: 'handovers', kind: 'wide', node: (
          <MonthTrackCard kind="existing" rows={track} months={months} onMonths={setMonths} testId="portal-handovers"
            colours={{ bar: BF.gold, line: BF.navyChart }}
            title="Your handovers, month by month"
            subtitle="The accounts you handed us each month. Switch to Rand for the capital, or to a line for the trend." />
        ) },
        { id: 'open', kind: 'wide', node: (
          <div className="grid gap-4 2xl:grid-cols-2 items-stretch">
            <RingCard testId="portal-open" ringTestId="portal-open-ring" tableTestId="portal-positions"
              title="Where your open accounts stand" subtitle="Every account we are still collecting, by where it is."
              lines={open} total={d.open} centre="Open accounts" empty="No open accounts." onSeeAll={() => onOpen('accounts')} />
            <RingCard testId="portal-finished-card" ringTestId="portal-finished-ring" tableTestId="portal-finished"
              title="Finished accounts" subtitle="How the accounts we are no longer collecting ended."
              lines={finished} total={d.accounts - d.open} centre="Finished accounts" empty="None finished yet." onSeeAll={() => onOpen('accounts')}
              extra={<p className="sr-only" data-testid="portal-paid-up">{paidUp}</p>} />
          </div>
        ) },
        { id: 'actions', node: (
          <div className="card p-6" data-testid="portal-actions">
            <h2 className="text-[20px] text-[#101F2C]">What would you like to do?</h2>
            <div className="mt-4 space-y-2">
              <Action icon={<FolderUp size={18} />} label="Hand over accounts" hint="Send us new accounts" onClick={() => onOpen('handover')} testId="handover" />
              <Action icon={<Ticket size={18} />} label="Raise a ticket" hint="A question about one of your accounts" onClick={() => onAsk('question')} testId="ticket" />
              <Action icon={<ReceiptText size={18} />} label="Tell us about a payment" hint="The debtor paid you directly" onClick={() => onAsk('payment')} testId="payment" />
              <Action icon={<UserPen size={18} />} label="Update a debtor's details" hint="A new number, address or employer" onClick={() => onAsk('question', 'New details for the debtor')} testId="details" />
              <Action icon={<CircleSlash size={18} />} label="Request a withdrawal" hint="Stop collecting on an account" onClick={() => onAsk('question', 'Stop or withdraw this account')} testId="withdraw" />
              <Action icon={<FileText size={18} />} label="Your reports" hint="Progress reports and remittance advices" onClick={() => onOpen('reports')} testId="reports" />
              <Action icon={<List size={18} />} label="Every account" hint="All open and finished accounts" onClick={() => onOpen('accounts')} testId="accounts" />
              <Action icon={<MessageCircle size={18} />} label="Your tickets" hint={d.tickets.open ? `${d.tickets.open} open ticket${d.tickets.open === 1 ? '' : 's'}` : 'Questions between you and us'} onClick={() => onOpen('tickets')} testId="tickets" />
            </div>
          </div>
        ) },
        { id: 'liaison', node: <Liaison liaison={d.liaison} onCall={() => onAsk('callback')} /> },
      ]} />
    </div>
  )
}

/*
 * A RING AND ITS LEGEND, ONE CARD SHAPE FOR BOTH BOOKS (the brief, section 7: "These two cards need to feel like
 * part of the same component family ... equal card heights"). The legend leads with the largest status -- for the
 * finished book that is "Paid up in full", which is what the oversized navy panel used to say on its own.
 */
function RingCard({ title, subtitle, lines, total, centre, empty, onSeeAll, testId, ringTestId, tableTestId, extra }: {
  title: string; subtitle: string; lines: PortalOutcomeLine[]; total: number; centre: string; empty: string
  onSeeAll: () => void; testId: string; ringTestId: string; tableTestId: string; extra?: ReactNode
}) {
  const sorted = [...lines].sort((a, b) => b.accounts - a.accounts)
  return (
    <div className="card p-6 h-full flex flex-col" data-testid={testId}>
      <h2 className="text-[20px] leading-tight text-[#101F2C]">{title}</h2>
      <p className="text-[13px] text-[#525D66] mt-1">{subtitle}</p>
      <button type="button" onClick={onSeeAll} className="mt-2 self-start text-[13px] font-semibold text-[#46607B] hover:text-[#101F2C] inline-flex items-center gap-1">
        See every account <ArrowRight size={13} />
      </button>
      {extra}
      {sorted.length === 0 ? <p className="text-sm text-[#525D66] mt-5">{empty}</p> : (
        <div className="mt-5 flex flex-1 flex-wrap items-center justify-center gap-x-6 gap-y-4">
          <GapRing testId={ringTestId} size={156} stroke={20} total={String(total)} label={centre}
            slices={sorted.map((o) => ({ key: o.outcome, value: o.accounts, color: colour(o.outcome) }))} />
          <div className="flex-1 min-w-[200px] w-full"><OutcomeTable lines={sorted} total={total} testId={tableTestId} /></div>
        </div>
      )}
    </div>
  )
}

/** One status a row: its colour (the ring's own), the words, the count, the share. */
function OutcomeTable({ lines, total, testId }: { lines: PortalOutcomeLine[]; total: number; testId: string }) {
  return (
    <ul className="text-[14px] min-w-0 space-y-1" data-testid={testId}>
      {lines.map((o, i) => (
        <li key={o.outcome} title={meaning(o.outcome) ?? undefined}
          className={`flex items-center gap-3 px-3 py-2 rounded-[10px] ${i % 2 ? '' : 'bg-[#F4F4F4]'}`}>
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: colour(o.outcome) }} data-legend={o.outcome} />
          <span className="flex-1 min-w-0 leading-snug text-[#32404D]">{o.outcome === 'paid_up' ? 'Paid up in full' : o.label}</span>
          <span className="bf-figure tabular-nums text-[#101F2C] w-10 text-right shrink-0">{o.accounts}</span>
          <span className="tabular-nums text-[#525D66] w-14 text-right shrink-0">{pct(o.accounts, total)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * THE FIGURE TILE (the brief, section 5): the icon in its box and the arrow on one line, the tracked Raleway label,
 * the figure in Raleway on a line of its own -- so a seven-figure rand never runs out of its card -- the line
 * under it, and a quiet trend from real months along the foot (outstanding: its share of the capital). Three
 * white, one navy with a gold edge: collected to date, the figure that matters most.
 */
function Tile({ icon, label, value, note, invert = false, trend, share, onOpen }: {
  icon: ReactNode; label: string; value: string; note?: string; invert?: boolean
  trend?: number[]; share?: number | null; onOpen: () => void
}) {
  return (
    <button type="button" onClick={onOpen}
      className={`group relative overflow-hidden text-left rounded-2xl px-6 pt-5 pb-14 transition-shadow hover:shadow-lg min-w-0 ${invert
        ? 'bg-[#101F2C] text-white border-t-[3px] border-t-[#C69F54] shadow-[0_8px_24px_-12px_rgba(16,31,44,0.5)]' : 'card'}`}>
      <div className="flex items-center justify-between">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${invert ? 'bg-white/10 text-[#C69F54]' : 'bg-[#D5E1EB]/60 text-[#46607B]'}`}>{icon}</span>
        <ArrowRight size={17} className="text-[#C69F54] transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className={`bf-label text-[11px] mt-4 ${invert ? 'text-[#C69F54]' : 'text-[#46607B]'}`}>{label}</p>
      <p className={`bf-figure text-[clamp(1.5rem,2.1vw,1.85rem)] leading-tight tabular-nums mt-1 whitespace-nowrap ${invert ? 'text-white' : 'text-[#101F2C]'}`}>{value}</p>
      {note && <p className={`text-[12.5px] mt-1 ${invert ? 'text-[#B4BFCC]' : 'text-[#525D66]'}`}>{note}</p>}
      {trend && <Spark values={trend} invert={invert} />}
      {share !== undefined && share !== null && (
        <div className="absolute left-6 right-6 bottom-6" title={`${Math.round(share * 1000) / 10}% of the capital handed over is still out`} data-testid="portal-outstanding-share">
          <div className="h-1.5 rounded-full bg-[#ECECEC] overflow-hidden"><div className="h-full rounded-full bg-[#97B4CC]" style={{ width: `${Math.min(100, Math.round(share * 100))}%` }} /></div>
        </div>
      )}
    </button>
  )
}

/** A filled line along the tile's foot: twelve real months, no axes, no figures -- the tile already says the figure. */
function Spark({ values, invert }: { values: number[]; invert: boolean }) {
  const max = Math.max(...values, 0)
  if (!(max > 0)) return null
  const w = 300, h = 40
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - (v / max) * (h - 8)] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const tone = invert ? BF.gold : BF.blue
  return (
    <svg aria-hidden className="absolute left-0 right-0 bottom-0 h-10 w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={tone} fillOpacity={invert ? 0.18 : 0.22} />
      <path d={line} stroke={tone} strokeOpacity="0.85" strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
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
    <div className="rounded-2xl bg-[#101F2C] text-white p-6" data-testid="portal-liaison">
      <PortalLabel invert>Your liaison</PortalLabel>
      <p className="text-[19px] mt-1.5" style={{ fontFamily: "'Raleway Variable', 'Raleway', sans-serif", fontWeight: 700 }}>{liaison?.name || 'Our client team'}</p>
      <div className="mt-3 space-y-2 text-[14px]">
        {liaison?.phone && <a href={`tel:${liaison.phone.replace(/\s/g, '')}`} className="flex items-center gap-2.5 text-white/90 hover:text-white"><Phone size={15} className="text-[#C69F54]" />{liaison.phone}</a>}
        {liaison?.whatsapp && <a href={`https://wa.me/${digits(liaison.whatsapp)}`} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 text-white/90 hover:text-white"><MessageCircle size={15} className="text-[#C69F54]" />WhatsApp {liaison.whatsapp}</a>}
        {liaison?.email && <a href={`mailto:${liaison.email}`} className="flex items-center gap-2.5 text-white/90 hover:text-white truncate"><Mail size={15} className="text-[#C69F54] shrink-0" /><span className="truncate">{liaison.email}</span></a>}
      </div>
      <button type="button" onClick={onCall} data-testid="portal-liaison-call"
        className="mt-5 w-full rounded-[10px] bg-[#C69F54] text-[#101F2C] font-semibold text-sm py-2.5 hover:brightness-105">Ask us to call you</button>
    </div>
  )
}

/** One thing to do, a compact row (the brief, section 8): a pale icon square, the words, a small arrow. */
function Action({ icon, label, hint, onClick, testId }: { icon: ReactNode; label: string; hint?: string; onClick: () => void; testId: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={`portal-action-${testId}`}
      className="group w-full flex items-center gap-3 text-left rounded-xl border border-[#ECECEC] px-3 py-2.5 hover:border-[#B4BFCC] hover:bg-[#D5E1EB]/30 transition-colors">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#D5E1EB]/55 text-[#46607B]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-[#101F2C] leading-tight">{label}</span>
        {hint && <span className="block text-[12px] text-[#525D66] mt-0.5">{hint}</span>}
      </span>
      <ChevronRight size={16} className="shrink-0 text-[#B4BFCC] group-hover:text-[#C69F54] transition-colors" />
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
