import { useCallback, useEffect, useState } from 'react'
import { ChevronsLeft, ChevronsRight, FileText, FolderUp, LayoutDashboard, List, LogOut, Phone, Ticket } from 'lucide-react'
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
import { PortalHandovers } from './PortalHandovers'
import { PortalLabel } from './portalStyle'

/**
 * THE CLIENT PORTAL (S14, Raptor H13) -- outside the firm, like /sign/:token: no staff login, no staff
 * navigation. A client types their email, is emailed a code, and sees their book. See clientPortal.ts.
 *
 * S15 gave it the shape of the firm's own work. Stephan: "use the remittance advice as inspiration for what
 * this whole dashboard should look like", "the sidebar should be able to minimize ... like what you've done
 * in Raptor itself". So: the advice's navy and gold and its coastline photograph, a navy sidebar with the
 * firm's wordmark and gold for where you are -- Dashboard, Reports, Tickets, Accounts, in Stephan's order --
 * that folds to a rail of icons, and on a phone becomes a row across the top.
 */
const NAVY = '#111E2D'

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

  if (!token) return <SignIn onSignedIn={(t) => { savePortalToken(t); setToken(t) }} />
  if (!me) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: NAVY }} data-testid="portal-page">
        <img src="/brand/wordmark-light.svg" alt="Bredell Ferreira" className="h-5 opacity-80 animate-pulse" />
      </div>
    )
  }
  return <Signed token={token} me={me} onSignedOut={() => { portalSignOut(token).catch(() => {}); signedOut() }} onExpired={signedOut} />
}

/* ------------------------------------------------------------------ signing in */

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

  const input = 'w-full rounded-lg border border-[#D5DBE3] px-3.5 py-2.5 text-[#111E2D] focus:outline-none focus:ring-2 focus:ring-[#C69F54]/50'
  const button = 'w-full rounded-lg py-2.5 font-semibold text-white disabled:opacity-50'
  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr] bg-white" data-testid="portal-page">
      {/* THE ADVICE'S COVER, as the door: the same coastline a client sees on every remittance advice. */}
      <div className="hidden lg:flex relative flex-col justify-between p-10 text-white"
        style={{ background: `linear-gradient(180deg, rgba(17,30,45,0.35) 0%, rgba(17,30,45,0.85) 100%), url('/brand/remittance-cover.jpg') center / cover` }}>
        <img src="/brand/wordmark-light.svg" alt="Bredell Ferreira" className="h-5 w-auto self-start" />
        <div>
          <PortalLabel invert>Client portal</PortalLabel>
          <p className="text-3xl font-bold mt-2 max-w-md leading-tight">Your book, where it stands, whenever you want to look.</p>
          <p className="text-[#AEBBCB] mt-3 max-w-md">Every account you have handed over, what has been collected, your reports and your tickets.</p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm" data-testid="portal-sign-in">
          <div className="lg:hidden rounded-xl p-4 mb-8" style={{ background: NAVY }}>
            <img src="/brand/wordmark-light.svg" alt="Bredell Ferreira" className="h-4 w-auto" />
          </div>
          <PortalLabel>Client portal</PortalLabel>
          <h1 className="text-2xl font-bold text-[#111E2D] mt-1">Sign in</h1>
          <p className="text-sm text-[#5A6B80] mt-1 mb-6">Type the email address we invited. We email you a code — there is no password.</p>
          {!sent ? (
            <form onSubmit={send} className="space-y-3">
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.co.za" className={input} data-testid="portal-email" />
              <button type="submit" disabled={busy || !email} className={button} style={{ background: NAVY }}>Email me a code</button>
            </form>
          ) : (
            <form onSubmit={check} className="space-y-3">
              <p className="text-sm text-[#5A6B80]" data-testid="portal-code-sent">{sent}</p>
              <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)}
                placeholder="123 456" className={`${input} tracking-[0.3em] text-lg`} data-testid="portal-code" />
              <button type="submit" disabled={busy || !code} className={button} style={{ background: NAVY }}>Sign in</button>
              <div className="flex justify-between text-xs text-[#5A6B80]">
                <button type="button" className="underline" onClick={() => { setSent(null); setCode('') }}>Use another address</button>
                <button type="button" className="underline" disabled={busy} onClick={() => send()}>Send a new code</button>
              </div>
            </form>
          )}
          {error && <p className="text-sm text-red-700 mt-3" data-testid="portal-error">{error}</p>}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ signed in */

type Section = 'dashboard' | 'reports' | 'tickets' | 'accounts' | 'handover'
const SECTIONS: { id: Section; label: string; icon: typeof LayoutDashboard; title: string; blurb: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, title: 'Dashboard', blurb: 'How your book is doing.' },
  { id: 'reports', label: 'Reports', icon: FileText, title: 'Reports', blurb: 'Every remittance advice we have sent you.' },
  { id: 'tickets', label: 'Tickets', icon: Ticket, title: 'Tickets', blurb: 'Questions between you and us, and where each one is.' },
  { id: 'accounts', label: 'Accounts', icon: List, title: 'Accounts', blurb: 'One line for every debtor you have handed over.' },
  /* S15, phase 2b: "go ahead with handover accounts". After Accounts, because it adds to them. */
  { id: 'handover', label: 'Hand over', icon: FolderUp, title: 'Hand over accounts', blurb: 'Send us a sheet, or one account. We check it and load it.' },
]

/* THE FOLD IS REMEMBERED in this browser, the way Raptor's own is -- and only as a convenience: a private
   window that will not store it simply opens wide. */
const FOLD_KEY = 'raptor.portal.sidebar'
function useFold(): [boolean, () => void] {
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem(FOLD_KEY) === 'narrow' } catch { return false } })
  const toggle = () => setFolded((f) => {
    try { localStorage.setItem(FOLD_KEY, f ? 'wide' : 'narrow') } catch { /* this tab only */ }
    return !f
  })
  return [folded, toggle]
}

function Signed({ token, me, onSignedOut, onExpired }: { token: string; me: PortalMe; onSignedOut: () => void; onExpired: () => void }) {
  const [section, setSection] = useState<Section>('dashboard')
  const [asking, setAsking] = useState<{ about: AskAbout | null; mode?: AskMode } | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [folded, toggleFold] = useFold()
  const go = (s: Section) => { setSection(s); setDone(null) }
  const here = SECTIONS.find((s) => s.id === section)!

  return (
    <div className="min-h-screen lg:h-screen lg:flex lg:overflow-hidden bg-[#F2F5F8]" data-testid="portal-page">
      {/* THE SIDEBAR, Raptor's own shape: navy, the wordmark, gold for where you are; folds to icons. */}
      <aside className={`hidden lg:flex flex-col shrink-0 h-full overflow-hidden text-[#AEBBCB] transition-[width] duration-200 ${folded ? 'w-[4.5rem]' : 'w-64'}`}
        style={{ background: NAVY }} data-testid="portal-sidebar">
        <div className={`h-16 flex items-center border-b border-white/10 ${folded ? 'justify-center' : 'px-5'}`}>
          {folded ? <img src="/favicon.svg" alt="Bredell Ferreira" className="w-7 h-7" />
            : <img src="/brand/wordmark-light.svg" alt="Bredell Ferreira" className="h-4 w-auto" />}
        </div>
        {!folded && (
          <div className="px-5 pt-5 pb-2">
            <PortalLabel invert>Client portal</PortalLabel>
            <p className="text-white font-semibold mt-1 leading-tight">{me.client}</p>
          </div>
        )}
        <nav aria-label="Portal" className="flex-1 px-3 py-3 space-y-1">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" onClick={() => go(s.id)} aria-current={section === s.id ? 'page' : undefined}
              title={folded ? s.label : undefined} data-testid={`portal-nav-${s.id}`}
              className={`w-full flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-colors ${folded ? 'justify-center' : 'px-3'} ${section === s.id
                ? 'bg-[#C69F54] text-[#111E2D]' : 'hover:bg-white/5 hover:text-white'}`}>
              <s.icon size={17} className="shrink-0" />
              {!folded && s.label}
            </button>
          ))}
          <button type="button" onClick={() => { setDone(null); setAsking({ about: null }) }} data-testid="portal-call-me"
            title={folded ? 'Ask us to call you' : undefined}
            className={`w-full mt-4 flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium border border-white/15 hover:bg-white/5 hover:text-white ${folded ? 'justify-center' : 'px-3'}`}>
            <Phone size={16} className="shrink-0" />
            {!folded && 'Ask us to call you'}
          </button>
        </nav>
        <div className="px-3 pb-2">
          <button type="button" onClick={toggleFold} aria-expanded={!folded} data-testid="portal-fold"
            title={folded ? 'Widen the menu' : 'Narrow the menu'}
            className={`w-full flex items-center gap-2.5 rounded-lg py-2 text-xs hover:bg-white/5 hover:text-white ${folded ? 'justify-center' : 'px-3'}`}>
            {folded ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            {!folded && 'Narrow the menu'}
          </button>
        </div>
        <div className={`border-t border-white/10 p-3 flex items-center gap-3 ${folded ? 'justify-center' : ''}`}>
          {!folded && (
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white truncate">{me.name || me.email}</p>
              <p className="text-[11px] truncate">{me.email}</p>
            </div>
          )}
          <button type="button" onClick={onSignedOut} title="Sign out" aria-label="Sign out" className="p-2 rounded-lg hover:bg-white/5 hover:text-white">
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* ON A PHONE: the same four across the top, and the way out. */}
      <div className="lg:hidden sticky top-0 z-30" style={{ background: NAVY }}>
        <div className="flex items-center justify-between px-4 h-14">
          <img src="/brand/wordmark-light.svg" alt="Bredell Ferreira" className="h-3.5 w-auto" />
          <button type="button" onClick={onSignedOut} className="text-xs text-[#AEBBCB] underline">Sign out</button>
        </div>
        <nav aria-label="Portal" className="flex gap-1 overflow-x-auto px-3 pb-3">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" onClick={() => go(s.id)} aria-current={section === s.id ? 'page' : undefined}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${section === s.id ? 'bg-[#C69F54] text-[#111E2D] font-semibold' : 'text-[#AEBBCB]'}`}>
              {s.label}
            </button>
          ))}
          <button type="button" onClick={() => { setDone(null); setAsking({ about: null }) }}
            className="shrink-0 rounded-lg px-3 py-1.5 text-sm text-[#AEBBCB] border border-white/15">Call me</button>
        </nav>
      </div>

      {/* ONLY THE PAGE SCROLLS, on a wide screen: the sidebar stays where it is, as Raptor's does. */}
      <main className="flex-1 min-w-0 lg:overflow-y-auto">
        {/* THE BAND: the advice's coastline under a navy wash, the client's name on it. */}
        <header className="relative text-white"
          style={{ background: `linear-gradient(100deg, rgba(17,30,45,0.96) 0%, rgba(17,30,45,0.82) 45%, rgba(17,30,45,0.35) 100%), url('/brand/remittance-cover.jpg') center 60% / cover` }}>
          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8 sm:py-10">
            <PortalLabel invert>{me.client}</PortalLabel>
            <h1 className="text-3xl sm:text-4xl font-bold mt-1.5">{here.title}</h1>
            <p className="text-[#AEBBCB] mt-1.5">{here.blurb}</p>
          </div>
        </header>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6 sm:py-8 space-y-5">
          {done && <p className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-2.5 text-sm text-emerald-800" data-testid="portal-asked">{done}</p>}
          {section === 'dashboard' && <PortalDashboard key={refresh} token={token} onSignedOut={onExpired} onOpen={go} />}
          {section === 'reports' && <PortalReports token={token} onSignedOut={onExpired} />}
          {section === 'tickets' && <PortalTickets token={token} onSignedOut={onExpired} refreshKey={refresh} />}
          {section === 'handover' && <PortalHandovers token={token} onSignedOut={onExpired} />}
          {section === 'accounts' && (
            <Book token={token} onSignedOut={onExpired}
              onAsk={(about, mode) => { setDone(null); setAsking({ about, mode }) }} />
          )}
        </div>
      </main>

      {asking && (
        <PortalAsk token={token} about={asking.about} initialMode={asking.mode} onClose={() => setAsking(null)} onSignedOut={onExpired}
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

      <section className="bg-white rounded-2xl border border-[#D5DBE3] overflow-hidden">
        <div className="p-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-[#111E2D]">Your accounts</h2>
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
                /* RELATIVE, so the screen-reader-only "Ask" heading -- absolutely positioned -- is clipped by this
                   scroller like the rest of the table instead of pushing the whole page 100px sideways. */
                <div className="relative overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap" data-testid="portal-book">
                    <thead>
                      <tr className="text-left text-[10.5px] uppercase tracking-[0.1em] text-white" style={{ background: '#111E2D' }}>
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
                        <tr key={`${l.ourReference}-${i}`} className={i % 2 ? 'bg-white' : 'bg-[#F2F5F8]'} data-testid="portal-line">
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
    <div className="bg-white rounded-2xl border border-[#D5DBE3] p-4">
      <PortalLabel>{label}</PortalLabel>
      <p className="text-xl font-bold text-[#111E2D] tabular-nums mt-1.5">{value}</p>
    </div>
  )
}
