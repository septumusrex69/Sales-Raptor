import { useCallback, useEffect, useState } from 'react'
import { rand } from '../../lib/money'
import { CLIENT_POSITIONS, clientFlag, CLIENT_FLAGS } from '../../lib/clientPosition'
import {
  PortalSignedOut, fetchPortalBook, fetchPortalMe, portalSignOut, portalToken, requestPortalCode, savePortalToken,
  verifyPortalCode, type PortalBook, type PortalMe,
} from '../../lib/portalApi'
import { PortalTickets } from './PortalTickets'
import { PortalAsk, type AskAbout, type AskMode } from './PortalAsk'
import { PortalDashboard } from './PortalDashboard'
import { PortalReports } from './PortalReports'

/**
 * THE CLIENT PORTAL (S14, Raptor H13) -- outside the firm, like /sign/:token: no staff login, no staff
 * navigation. A client types their email, is emailed a code, and sees their book. See clientPortal.ts.
 *
 * Phase 1 is the book. Phase 2a (S15) gave it a sidebar -- Dashboard, Reports, Tickets, Accounts, in the
 * order Stephan gave -- and an Ask on every account: a written question, a payment made to the client, or
 * a call back. Handing accounts over (with the firm's approval) is phase 2b.
 */
const FONT = { fontFamily: 'Charter, "Bitstream Charter", Georgia, "Times New Roman", serif' }

export default function PortalPage() {
  const [token, setToken] = useState<string | null>(() => portalToken())
  const [me, setMe] = useState<PortalMe | null>(null)

  const signedOut = useCallback(() => { savePortalToken(null); setToken(null); setMe(null) }, [])

  useEffect(() => {
    if (!token) return
    let live = true
    fetchPortalMe(token).then((m) => { if (live) setMe(m) }).catch(() => { if (live) signedOut() })
    return () => { live = false }
  }, [token, signedOut])

  return (
    <div className="min-h-screen bg-slate-50" style={FONT} data-testid="portal-page">
      <header className="bg-navy-900 text-white">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="" className="w-8 h-8" />
            <div>
              <p className="text-xs uppercase tracking-wider text-white/60">Bredell Ferreira</p>
              <p className="text-lg leading-tight">{me ? me.client : 'Client portal'}</p>
            </div>
          </div>
          {me && token && (
            <div className="text-right text-sm">
              <p className="text-white/80">{me.name || me.email}</p>
              <button type="button" className="text-white/60 underline text-xs"
                onClick={() => { portalSignOut(token).catch(() => {}); signedOut() }}>Sign out</button>
            </div>
          )}
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">
        {!token ? <SignIn onSignedIn={(t) => { savePortalToken(t); setToken(t) }} />
          : !me ? <p className="text-slate-400 text-sm">Opening your accounts…</p>
            : <Signed token={token} onSignedOut={signedOut} />}
      </main>
    </div>
  )
}

function SignIn({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function send(e?: React.FormEvent) {
    e?.preventDefault()
    setBusy(true); setError(null)
    try { setSent((await requestPortalCode(email)).message) } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }
  async function check(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try { onSignedIn((await verifyPortalCode(email, code)).token) } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }

  return (
    <div className="max-w-md mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-8 mt-8" data-testid="portal-sign-in">
      <h1 className="text-xl text-slate-900 mb-1">Sign in</h1>
      <p className="text-sm text-slate-600 mb-5">Type the email address the firm invited. We email you a code — there is no password.</p>
      {!sent ? (
        <form onSubmit={send} className="space-y-3">
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.co.za" className="w-full rounded-lg border border-slate-300 px-3 py-2" data-testid="portal-email" />
          <button type="submit" disabled={busy || !email} className="w-full rounded-lg bg-navy-900 text-white py-2 disabled:opacity-50">Email me a code</button>
        </form>
      ) : (
        <form onSubmit={check} className="space-y-3">
          <p className="text-sm text-slate-600" data-testid="portal-code-sent">{sent}</p>
          <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)}
            placeholder="123 456" className="w-full rounded-lg border border-slate-300 px-3 py-2 tracking-widest text-lg" data-testid="portal-code" />
          <button type="submit" disabled={busy || !code} className="w-full rounded-lg bg-navy-900 text-white py-2 disabled:opacity-50">Sign in</button>
          <div className="flex justify-between text-xs text-slate-500">
            <button type="button" className="underline" onClick={() => { setSent(null); setCode('') }}>Use another address</button>
            <button type="button" className="underline" disabled={busy} onClick={() => send()}>Send a new code</button>
          </div>
        </form>
      )}
      {error && <p className="text-sm text-red-700 mt-3" data-testid="portal-error">{error}</p>}
    </div>
  )
}

/**
 * THE SIGNED-IN PORTAL: A SIDEBAR AND ONE SECTION AT A TIME (S15). Stephan: "on the left, like a sidebar
 * where there's a dashboard ... dashboard, reports, tickets, accounts". On a phone the sidebar becomes a
 * row of pills across the top -- the same four, in the same order -- because a column beside a phone's
 * content is a column that leaves no room for the content.
 *
 * The Dashboard opens first: the question a client logs in with is "how is my book doing", and one debtor
 * is a search away from there.
 */
type Section = 'dashboard' | 'reports' | 'tickets' | 'accounts'
const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10' },
  { id: 'reports', label: 'Reports', icon: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6' },
  { id: 'tickets', label: 'Tickets', icon: 'M4 7h16v4a2 2 0 000 4v4H4v-4a2 2 0 000-4z' },
  { id: 'accounts', label: 'Accounts', icon: 'M4 6h16M4 12h16M4 18h16' },
]

function Signed({ token, onSignedOut }: { token: string; onSignedOut: () => void }) {
  const [section, setSection] = useState<Section>('dashboard')
  const [asking, setAsking] = useState<{ about: AskAbout | null; mode?: AskMode } | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const go = (s: Section) => { setSection(s); setDone(null) }

  return (
    <div className="lg:grid lg:grid-cols-[13rem_1fr] lg:gap-6">
      <nav aria-label="Portal" data-testid="portal-sidebar"
        className="mb-4 lg:mb-0 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible lg:sticky lg:top-6 lg:self-start">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" onClick={() => go(s.id)} aria-current={section === s.id ? 'page' : undefined}
            data-testid={`portal-nav-${s.id}`}
            className={`shrink-0 flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-left ${section === s.id
              ? 'bg-navy-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white'}`}>
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={s.icon} /></svg>
            {s.label}
          </button>
        ))}
        <div className="hidden lg:block border-t border-slate-200 my-3" />
        <button type="button" onClick={() => { setDone(null); setAsking({ about: null }) }} data-testid="portal-call-me"
          className="shrink-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 text-left">
          Ask us to call you
        </button>
      </nav>

      <div className="min-w-0 space-y-5">
        {done && <p className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-2 text-sm text-emerald-800" data-testid="portal-asked">{done}</p>}
        {section === 'dashboard' && <PortalDashboard key={refresh} token={token} onSignedOut={onSignedOut} onOpen={go} />}
        {section === 'reports' && <PortalReports token={token} onSignedOut={onSignedOut} />}
        {section === 'tickets' && <PortalTickets token={token} onSignedOut={onSignedOut} refreshKey={refresh} />}
        {section === 'accounts' && (
          <Book token={token} onSignedOut={onSignedOut}
            onAsk={(about, mode) => { setDone(null); setAsking({ about, mode }) }} />
        )}
      </div>

      {asking && (
        <PortalAsk token={token} about={asking.about} initialMode={asking.mode} onClose={() => setAsking(null)} onSignedOut={onSignedOut}
          onAsked={(what, ticketNo) => {
            setAsking(null); setRefresh((n) => n + 1)
            setDone(what === 'question'
              ? `Your question is ticket T-${ticketNo}. Your liaison has it now, and the answer will be under Tickets.`
              : what === 'payment'
                ? `The payment is recorded on the account${ticketNo ? ` (ticket T-${ticketNo})` : ''}. It counts once we have approved it, and your liaison has been told.`
                : 'Your liaison has been asked to call you.')
          }} />
      )}
    </div>
  )
}

const PAGE = 100

function Book({ token, onSignedOut, onAsk }: { token: string; onSignedOut: () => void; onAsk: (about: AskAbout, mode?: AskMode) => void }) {
  const [search, setSearch] = useState('')
  const [asked, setAsked] = useState('')
  const [includeClosed, setIncludeClosed] = useState(false)
  const [offset, setOffset] = useState(0)
  const [book, setBook] = useState<PortalBook | null>(null)
  const [error, setError] = useState<string | null>(null)

  /* A pause after typing before the book is asked, so a name typed letter by letter is one request. */
  useEffect(() => { const t = setTimeout(() => { setAsked(search); setOffset(0) }, 300); return () => clearTimeout(t) }, [search])

  useEffect(() => {
    let live = true
    setError(null)
    fetchPortalBook(token, { search: asked, includeClosed, offset })
      .then((b) => { if (live) setBook(b) })
      .catch((e) => { if (!live) return; if (e instanceof PortalSignedOut) onSignedOut(); else setError(e.message) })
    return () => { live = false }
  }, [token, asked, includeClosed, offset, onSignedOut])

  const t = book?.totals
  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="portal-totals">
        <Figure label="Accounts" value={book ? String(book.total) : '…'} />
        <Figure label="Capital handed over" value={t ? rand(t.capitalHandedOver) : '…'} />
        <Figure label="Paid this month" value={t ? rand(t.paidThisMonth) : '…'} />
        <Figure label="Capital outstanding" value={t ? rand(t.capitalOutstanding) : '…'} />
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="p-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg text-slate-900">Your accounts</h2>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-slate-600 inline-flex items-center gap-2">
              <input type="checkbox" checked={includeClosed} onChange={(e) => { setIncludeClosed(e.target.checked); setOffset(0) }} />
              Include closed accounts
            </label>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or reference"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" data-testid="portal-search" />
          </div>
        </div>
        {error ? <p className="px-4 pb-4 text-sm text-red-700">{error}</p>
          : !book ? <p className="px-4 pb-4 text-sm text-slate-400">Reading…</p>
            : book.lines.length === 0 ? <p className="px-4 pb-4 text-sm text-slate-500">No accounts match.</p>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap" data-testid="portal-book">
                    <thead>
                      <tr className="text-left border-y border-slate-100 text-slate-500">
                        <th className="font-medium px-4 py-2">Debtor</th>
                        <th className="font-medium px-2 py-2">Your reference</th>
                        <th className="font-medium px-2 py-2">Our reference</th>
                        <th className="font-medium px-2 py-2 text-right">Capital handed over</th>
                        <th className="font-medium px-2 py-2 text-right">Paid this month</th>
                        <th className="font-medium px-2 py-2 text-right">Paid to date</th>
                        <th className="font-medium px-2 py-2 text-right">Capital outstanding</th>
                        <th className="font-medium px-4 py-2">Where it stands</th>
                        <th className="px-4 py-2"><span className="sr-only">Ask</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {book.lines.map((l, i) => (
                        <tr key={`${l.ourReference}-${i}`} className="border-b border-slate-50" data-testid="portal-line">
                          <td className="px-4 py-2 text-slate-800">{l.debtor}</td>
                          <td className="px-2 py-2 text-slate-600">{l.yourReference || '—'}</td>
                          <td className="px-2 py-2 text-slate-600">{l.ourReference || '—'}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{rand(l.capitalHandedOver)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{rand(l.paidThisMonth)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{rand(l.paidToDate)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{rand(l.capitalOutstanding)}</td>
                          <td className="px-4 py-2" title={CLIENT_POSITIONS[l.position].meaning}>
                            <span className="mr-1.5">{CLIENT_FLAGS[clientFlag(l.position)].dot}</span>{l.positionLabel}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {/* By OUR reference: the client's own is not unique on 21% of the book (CLAUDE.md). */}
                            {l.ourReference && (
                              <span className="inline-flex gap-1.5">
                                <button type="button" onClick={() => onAsk({ caseNumber: l.ourReference, debtor: l.debtor }, 'question')}
                                  data-testid="portal-ask-open"
                                  className="rounded-lg border border-slate-300 px-2.5 py-0.5 text-xs text-slate-700 hover:bg-slate-50">Ask</button>
                                <button type="button" onClick={() => onAsk({ caseNumber: l.ourReference, debtor: l.debtor }, 'payment')}
                                  data-testid="portal-paid-open" title="The debtor paid you directly"
                                  className="rounded-lg border border-slate-300 px-2.5 py-0.5 text-xs text-slate-700 hover:bg-slate-50">Paid to you</button>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        {book && book.total > PAGE && (
          <div className="p-4 flex items-center justify-between text-sm text-slate-600">
            <span>{offset + 1}–{Math.min(offset + PAGE, book.total)} of {book.total}</span>
            <div className="flex gap-2">
              <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}
                className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40">Previous</button>
              <button type="button" disabled={offset + PAGE >= book.total} onClick={() => setOffset(offset + PAGE)}
                className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <p className="text-xs uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-xl text-slate-900 tabular-nums mt-1">{value}</p>
    </div>
  )
}
