import { useCallback, useEffect, useState } from 'react'
import {
  PORTAL_MESSAGE_MAX, PORTAL_TICKET_LABEL, portalTicketTurn, type PortalMessage, type PortalTicket,
} from '../../lib/clientPortal'
import { PortalSignedOut, fetchPortalTicket, fetchPortalTickets, replyPortalTicket } from '../../lib/portalApi'

/**
 * THE CLIENT'S TICKETS (S15, Raptor · Handover 14). Stephan's order for the portal: "tickets -- view and
 * reply". Every ticket the firm put in front of this client (a debtor's dispute, a handover to correct, a
 * recommendation to sue) and every question they asked themselves, newest first with the open ones on top.
 *
 * OF A TICKET THEY SEE ONLY WHAT WAS WRITTEN BETWEEN THEM AND THE FIRM -- never the internal notes, never
 * the debtor's mail. portal_ticket_thread decides that in the database; this screen draws what it is given.
 */
/* A date as the client reads it. Local rather than mockData's formatter: the portal's chunk carries nothing
   of the staff app it does not need. */
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })

/* In the firm's palette (the portal brief: no green, red or orange): gold is the client's move, pale blue the firm's. */
const TURN: Record<'yours' | 'ours' | 'closed', { label: string; tint: string }> = {
  yours: { label: 'Waiting on you', tint: 'bg-[#C69F54] text-white font-semibold' },
  ours: { label: 'With the firm', tint: 'bg-[#D5E1EB] text-[#203B60]' },
  closed: { label: 'Closed', tint: 'bg-slate-100 text-slate-600' },
}

/*
 * VIEWS, LIKE THE FIRM'S OWN DISPUTE BOARD (Stephan, 30 Oct, of the portal's one long list: "we want the different
 * views ... with the firm, with you, or closed ... Closed, it's not really necessary to see them. You can just have a
 * button ... that goes to the closed ones ... waiting on you ... make it more prominent ... at the top ... highlight
 * it"). So the portal opens on OPEN tickets only, the ones waiting on the client first and drawn in gold; the two
 * turns can be looked at alone; and closed tickets are behind a button of their own, out of the way.
 */
type View = 'open' | 'yours' | 'ours' | 'closed'
const VIEWS: { id: Exclude<View, 'closed'>; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'yours', label: 'Waiting on you' },
  { id: 'ours', label: 'With the firm' },
]
const EMPTY: Record<View, string> = {
  open: 'Nothing open. Every question has been answered.',
  yours: 'Nothing is waiting on you.',
  ours: 'Nothing is with the firm right now.',
  closed: 'No closed tickets yet.',
}

export function PortalTickets({ token, onSignedOut, refreshKey, onRaise }: { token: string; onSignedOut: () => void; refreshKey: number; onRaise: () => void }) {
  const [tickets, setTickets] = useState<PortalTicket[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [reload, setReload] = useState(0)
  const [view, setView] = useState<View>('open')

  useEffect(() => {
    let live = true
    fetchPortalTickets(token)
      .then((r) => { if (live) setTickets(r.tickets) })
      .catch((e) => { if (!live) return; if (e instanceof PortalSignedOut) onSignedOut(); else setError(e.message) })
    return () => { live = false }
  }, [token, onSignedOut, refreshKey, reload])

  /* S16, Stephan's list: "raise a ticket from the Tickets section too, not only from an account." */
  const raise = (
    <div className="flex justify-end">
      <button type="button" onClick={onRaise} data-testid="portal-raise-ticket"
        className="inline-flex items-center gap-2 rounded-xl bg-[#111E2D] text-white px-4 py-2.5 text-sm font-semibold hover:brightness-125">+ Raise a ticket</button>
    </div>
  )
  if (error) return <p className="text-sm text-red-700">{error}</p>
  if (!tickets) return <p className="text-sm text-slate-400">Reading your tickets…</p>
  if (tickets.length === 0) {
    return (
      <div className="space-y-3">{raise}
      <div className="bg-white rounded-2xl border border-[#D5DBE3] p-8 text-center" data-testid="portal-no-tickets">
        <p className="text-slate-700">No tickets yet.</p>
        <p className="text-sm text-slate-500 mt-1">Press <b>Raise a ticket</b>, or <b>Ask</b> beside the account under Accounts.</p>
      </div></div>
    )
  }

  const count = { yours: 0, ours: 0, closed: 0 }
  for (const t of tickets) count[portalTicketTurn(t)]++
  /* The server's order (newest first) kept within each turn; in the Open view the client's own move comes first. */
  const shown = tickets
    .filter((t) => {
      const turn = portalTicketTurn(t)
      return view === 'open' ? turn !== 'closed' : turn === view
    })
    .sort((a, b) => view === 'open' ? Number(portalTicketTurn(b) === 'yours') - Number(portalTicketTurn(a) === 'yours') : 0)
  const number = (v: View) => v === 'open' ? count.yours + count.ours : count[v]

  return (
    <div className="space-y-3" data-testid="portal-tickets" data-view={view}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Which tickets" className="inline-flex rounded-xl border border-[#D5DBE3] bg-white p-1">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)} data-testid={`portal-ticket-view-${v.id}`}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${view === v.id ? 'bg-[#101F2C] text-white' : 'text-[#525D66] hover:text-[#101F2C]'}`}>
                {v.label}
                <span className={`min-w-5 rounded-full px-1.5 text-[11px] font-semibold ${v.id === 'yours' && count.yours > 0
                  ? 'bg-[#C69F54] text-white' : view === v.id ? 'bg-white/20' : 'bg-[#F4F4F4]'}`}>{number(v.id)}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setView(view === 'closed' ? 'open' : 'closed')} aria-pressed={view === 'closed'} data-testid="portal-ticket-view-closed"
            className={`rounded-xl border px-3 py-2 text-sm font-medium ${view === 'closed' ? 'border-[#101F2C] bg-[#101F2C] text-white' : 'border-[#D5DBE3] bg-white text-[#525D66] hover:text-[#101F2C]'}`}>
            {view === 'closed' ? '← Back to open tickets' : `Closed (${count.closed})`}
          </button>
        </div>
        {raise}
      </div>
      {view === 'open' && count.yours > 0 && (
        <p className="text-sm text-[#32404D]" data-testid="portal-tickets-yours-note">
          <b>{count.yours === 1 ? '1 ticket needs' : `${count.yours} tickets need`} your answer</b> before we can carry on. They are at the top, in gold.
        </p>
      )}
      {shown.length === 0 && (
        <div className="bg-white rounded-2xl border border-[#D5DBE3] p-6 text-center text-sm text-slate-500" data-testid="portal-tickets-empty">{EMPTY[view]}</div>
      )}
      {shown.map((t) => {
        const whose = portalTicketTurn(t)
        const turn = TURN[whose]
        const isOpen = open === t.ticketNo
        return (
          <section key={t.ticketNo} data-testid="portal-ticket" data-turn={whose}
            className={whose === 'yours'
              ? 'rounded-2xl border border-[#C69F54]/60 border-l-[6px] border-l-[#C69F54] bg-[#FBF6EC] shadow-[0_6px_18px_-12px_rgba(198,159,84,0.8)]'
              : 'bg-white rounded-2xl border border-[#D5DBE3]'}>
            <button type="button" onClick={() => setOpen(isOpen ? null : t.ticketNo)} aria-expanded={isOpen}
              className="w-full text-left p-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">
                  T-{t.ticketNo} · {PORTAL_TICKET_LABEL[t.kind]} · {formatDate(t.raisedAt)}
                </p>
                <p className="text-slate-900 mt-0.5">
                  {t.debtor ?? (t.sheetReference ? `Handover ${t.sheetReference}` : 'Your book')}
                  {t.caseNumber && <span className="text-slate-500"> · {t.caseNumber}</span>}
                </p>
                <p className="text-sm text-slate-600 mt-1 line-clamp-2 whitespace-pre-line">{t.description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {t.messages > 0 && <span className="text-xs text-slate-500">{t.messages} message{t.messages === 1 ? '' : 's'}</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full ${turn.tint}`}>{turn.label}</span>
              </div>
            </button>
            {isOpen && (
              <Thread token={token} ticket={t} onSignedOut={onSignedOut} onReplied={() => setReload((n) => n + 1)} />
            )}
          </section>
        )
      })}
    </div>
  )
}

function Thread({ token, ticket, onSignedOut, onReplied }: {
  token: string; ticket: PortalTicket; onSignedOut: () => void; onReplied: () => void
}) {
  const [messages, setMessages] = useState<PortalMessage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const load = useCallback(() => {
    let live = true
    fetchPortalTicket(token, ticket.ticketNo)
      .then((r) => { if (live) setMessages(r.messages) })
      .catch((e) => { if (!live) return; if (e instanceof PortalSignedOut) onSignedOut(); else setError(e.message) })
    return () => { live = false }
  }, [token, ticket.ticketNo, onSignedOut])
  useEffect(() => load(), [load])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await replyPortalTicket(token, ticket.ticketNo, draft)
      setDraft(''); setSent(true); load(); onReplied()
    } catch (x) {
      if (x instanceof PortalSignedOut) onSignedOut(); else setError(x instanceof Error ? x.message : String(x))
    } finally { setBusy(false) }
  }

  return (
    <div className="border-t border-slate-100 p-4 space-y-3" data-testid="portal-thread">
      {/* WHAT WAS ASKED, first: the ticket's own words, which no message repeats -- except on the client's own
          question, which is filed as their first message (S15) and would otherwise be shown twice. */}
      {ticket.kind !== 'client' && (
        <div className="text-sm text-slate-700 whitespace-pre-line bg-slate-50 rounded-xl p-3">{ticket.description}</div>
      )}
      {!messages ? <p className="text-sm text-slate-400">Reading…</p>
        : messages.length === 0 ? <p className="text-sm text-slate-500">Nothing has been written on this ticket yet.</p>
          : messages.map((m, i) => (
            <div key={i} className={`rounded-xl p-3 text-sm max-w-[90%] ${m.direction === 'out'
              ? 'bg-navy-900/5 border border-navy-900/10' : 'bg-amber-50 border border-amber-100 ml-auto'}`} data-testid="portal-message">
              <p className="text-xs text-slate-500 mb-1">
                {m.direction === 'out' ? (m.from ?? 'Bredell Ferreira') : 'You'} · {formatDate(m.at)}
              </p>
              <p className="whitespace-pre-line text-slate-800">{m.body}</p>
              {m.attachments.length > 0 && (
                <p className="text-xs text-slate-500 mt-1">Attached: {m.attachments.join(', ')}</p>
              )}
            </div>
          ))}
      {ticket.status === 'open' ? (
        <form onSubmit={send} className="space-y-2">
          <textarea value={draft} onChange={(e) => { setDraft(e.target.value); setSent(false) }} rows={3} maxLength={PORTAL_MESSAGE_MAX}
            placeholder="Write your reply…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" data-testid="portal-reply" />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">{sent ? 'Sent. Your liaison has been told.' : 'Your liaison at the firm is told the moment you send.'}</p>
            <button type="submit" disabled={busy || !draft.trim()} data-testid="portal-reply-send"
              className="rounded-lg bg-navy-900 text-white px-4 py-1.5 text-sm disabled:opacity-50">Send reply</button>
          </div>
        </form>
      ) : (
        <p className="text-xs text-slate-500">This ticket is closed. To ask something new, press Ask beside the account.</p>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  )
}
