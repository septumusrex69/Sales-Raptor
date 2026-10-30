import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Bell, ChevronDown, ChevronsLeft, ChevronsRight, Eye, EyeOff, FileText, FolderUp, Headphones, KeyRound, LayoutDashboard, List, Lock, LogOut, Mail, Phone, Search, Ticket } from 'lucide-react'
import { rand } from '../../lib/money'
import { CLIENT_POSITIONS, clientFlag, CLIENT_FLAGS } from '../../lib/clientPosition'
import { PORTAL_PASSWORD_MIN, portalPasswordProblem, type PortalTopic } from '../../lib/clientPortal'
import {
  PortalSignedOut, fetchPortalBook, fetchPortalMe, fetchPortalTickets, portalSignInWithPassword, portalSignOut, portalToken, requestPortalCode,
  savePortalToken, setPortalPassword, verifyPortalCode, type PortalBook, type PortalMe,
} from '../../lib/portalApi'
import { PortalTickets } from './PortalTickets'
import { PortalAsk, type AskAbout, type AskMode } from './PortalAsk'
import { PortalDashboard } from './PortalDashboard'
import { PortalReports } from './PortalReports'
import { PortalHandovers } from './PortalHandovers'
import { PortalLabel } from './portalStyle'
import './portal.css'
import { PortalSplash } from './PortalSplash'
import { primeSplashAudio } from './portalSound'
import '@fontsource-variable/raleway'
import '@fontsource-variable/open-sans'

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
const NAVY = '#101F2C'

export default function PortalPage() {
  const [token, setToken] = useState<string | null>(() => portalToken())
  const [me, setMe] = useState<PortalMe | null>(null)
  const [opened, setOpened] = useState(false)
  /* Set by a sign-in, so the full opening plays then -- not only the first time in this tab (PortalSplash). */
  const [fresh, setFresh] = useState(false)

  const signedOut = useCallback(() => { savePortalToken(null); setToken(null); setMe(null) }, [])

  useEffect(() => {
    if (!token) return
    let live = true
    fetchPortalMe(token).then((m) => { if (live) setMe(m) }).catch(() => { if (live) signedOut() })
    return () => { live = false }
  }, [token, signedOut])

  if (!token) return <SignIn onSignedIn={(t, remember) => { savePortalToken(t, remember); setToken(t); setOpened(false); setFresh(true) }} />
  /* THE OPENING plays while the portal reads who this is, and a little longer (PortalSplash) -- ON TOP of the
     portal once it is there, so its fade dissolves into the dashboard rather than into an empty page. */
  /* One element in one place, so the opening is never remounted (and restarted) when the portal arrives. */
  return <>
    {!opened && <PortalSplash ready={!!me} fresh={fresh} onDone={() => { setOpened(true); setFresh(false) }} />}
    {me && <Signed token={token} me={me} onSignedOut={() => { portalSignOut(token).catch(() => {}); signedOut() }} onExpired={signedOut} />}
  </>
}

/* ------------------------------------------------------------------ signing in */

/*
 * SIGNING IN (S16): THE ADDRESS AND A PASSWORD. Stephan: "I want ... a password. So I'm still receiving emails.
 * With codes. Shouldn't be like that." The emailed code is now the way in only the first time and when the
 * password is forgotten -- and either way it ends by choosing a password, so the next visit needs no email.
 *
 * DRAWN TO STEPHAN'S BRIEF (29 Oct, with a mock-up): a split screen in a rounded frame -- the remittance
 * advice's coastline on the left with the BF ring and wordmark, the promise at its foot over a gold rule; a
 * warm white panel on the right with fine gold curves, "Secure client portal", the fields with their icons, a
 * way to see the password, Keep me signed in, Forgot your password, and a way to reach the firm. Raleway for
 * headings and the tracked labels, Open Sans for the rest; the brief's navy, slate, light blue and gold.
 * Visual only: the steps, the rules and every message are the ones above. The mock-up's "Continue with
 * Microsoft" is left out on purpose -- the brief: not unless Microsoft sign-in is already set up, and it is not.
 */
type Step = 'password' | 'email' | 'code' | 'set'

const C = { navy: '#101F2C', slate: '#46607B', light: '#97B4CC', gold: '#C69F54', off: '#F4F4F4' }
const HEAD = "'Raleway Variable', 'Raleway', 'Poppins', sans-serif"
const BODY = "'Open Sans Variable', 'Open Sans', sans-serif"
/** Where "Need help signing in?" writes to: the firm's own address, as on every remittance advice. */
const SUPPORT = 'mailto:info@bredellferreira.co.za?subject=Client%20portal%20sign-in'

/* An input with its icon. Out here, not inside SignIn: a component defined in a render is a new component every
   render, and React would rebuild the input under the client's fingers on every keystroke. */
function Field({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" style={{ color: C.slate }}>{icon}</span>
      {children}
    </div>
  )
}

function SignIn({ onSignedIn }: { onSignedIn: (token: string, remember: boolean) => void }) {
  const [step, setStep] = useState<Step>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [remember, setRemember] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  /* The session the code opened, held until the new password is saved: a client who walks away at that
     step has not been left signed in without one. */
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (f: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await f() } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }
  const signIn = (e: React.FormEvent) => { e.preventDefault(); primeSplashAudio(); run(async () => onSignedIn((await portalSignInWithPassword(email, password, remember)).token, remember)) }
  const send = (e?: React.FormEvent) => { e?.preventDefault(); run(async () => { setSent((await requestPortalCode(email)).message); setStep('code') }) }
  const check = (e: React.FormEvent) => {
    e.preventDefault()
    primeSplashAudio()
    run(async () => {
      /* Always asked for a password after a code: the code is the first visit or the reset. */
      const r = await verifyPortalCode(email, code, true, remember)
      if (r.needsPassword) { setPending(r.token); setStep('set') } else onSignedIn(r.token, remember)
    })
  }
  const save = (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== again) { setError('The two passwords are not the same.'); return }
    const problem = portalPasswordProblem(password, email)
    if (problem) { setError(problem); return }
    primeSplashAudio()
    run(async () => { await setPortalPassword(pending!, password); onSignedIn(pending!, remember) })
  }
  const go = (s: Step) => { setStep(s); setError(null); setCode(''); if (s !== 'set') setAgain('') }

  const field = 'w-full rounded-[13px] border bg-white pl-11 pr-4 py-3 text-[15px] placeholder:text-[#97B4CC] focus:outline-none focus:ring-2 focus:ring-[#C69F54]/40 focus:border-[#C69F54]/70'
  const fieldStyle = { borderColor: '#DCE3EA', color: C.navy }
  const primary = 'w-full rounded-[13px] py-3.5 text-[15px] font-semibold text-white flex items-center justify-center gap-2 shadow-sm hover:brightness-125 disabled:opacity-80 disabled:cursor-not-allowed transition'
  const link = 'font-semibold underline-offset-4 hover:underline'
  const label = 'text-[11px] font-bold uppercase tracking-[0.24em]'
  const secret = (value: string, set: (v: string) => void, placeholder: string, testId: string, auto: string) => (
    <Field icon={<Lock size={18} />}>
      <input type={showPassword ? 'text' : 'password'} required autoComplete={auto} value={value} onChange={(e) => set(e.target.value)}
        placeholder={placeholder} className={`${field} pr-12`} style={fieldStyle} data-testid={testId} />
      <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide the password' : 'Show the password'}
        aria-pressed={showPassword} data-testid={`${testId}-show`}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 hover:bg-[#F4F4F4]" style={{ color: C.slate }}>
        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </Field>
  )

  return (
    <div className="relative min-h-screen overflow-hidden lg:flex lg:items-center lg:justify-center lg:p-8" data-testid="portal-page"
      style={{ fontFamily: BODY, background: C.off }}>
      {/* THE ROOM AROUND THE FRAME: the same coastline, softened -- a background, so a phone never fetches it twice. */}
      <div aria-hidden className="hidden lg:block absolute inset-0 scale-110 blur-2xl opacity-60"
        style={{ background: `url('/brand/remittance-cover.jpg') center / cover` }} />
      <div className="relative w-full min-h-screen lg:max-w-[1360px] lg:min-h-[640px] lg:h-[min(860px,calc(100vh-4rem))] lg:rounded-[24px] lg:overflow-hidden
        lg:shadow-[0_30px_80px_-20px_rgba(16,31,44,0.45)] lg:ring-1 lg:ring-white/40 flex flex-col lg:grid lg:grid-cols-[58fr_42fr] bg-[#FBFAF7]">
        {/* LEFT: THE COASTLINE, THE MARK, THE PROMISE. Its own tall cut, portal-signin.webp (S16, 30 Oct; Stephan on the
            iPad: "the same picture that is on the remittance advices. Why are you using low quality one?"). It IS the same
            photograph, and the same file was the problem: remittance-cover.jpg is a 1672 x 609 strip, right for the
            advice's wide band, and this panel is taller than it is wide -- so the browser cut a 600-pixel-wide piece out of
            it and stretched that about four times over. The cut here is from the 7680-px copy, made for this shape. */}
        <div className="relative text-white flex flex-col justify-between p-6 sm:p-10 lg:p-14 min-h-[300px] sm:min-h-[380px] lg:min-h-0"
          style={{ background: `linear-gradient(180deg, rgba(16,31,44,0.30) 0%, rgba(16,31,44,0.10) 35%, rgba(16,31,44,0.78) 78%, rgba(16,31,44,0.92) 100%), url('/brand/portal-signin.webp') center / cover` }}>
          <div className="flex items-center gap-3.5" data-testid="portal-sign-in-logo">
            <img src="/brand/icon-light.svg" alt="" className="h-14 w-14 sm:h-20 sm:w-20" />
            <img src="/brand/wordmark-light.svg" alt="Bredell Ferreira" className="h-3.5 sm:h-[18px] w-auto" />
          </div>
          <div className="mt-10 max-w-xl">
            <p className={label} style={{ color: C.gold, fontFamily: HEAD }}>Client portal</p>
            <h2 className="mt-3 text-[30px] sm:text-[40px] lg:text-[46px] leading-[1.12] font-bold" style={{ fontFamily: HEAD }}>
              Your book, where it stands, whenever you want to look.
            </h2>
            <div className="mt-6 h-[2px] w-16 rounded" style={{ background: C.gold }} />
            <p className="mt-5 text-[15px] sm:text-base leading-relaxed text-white/85 max-w-lg">
              Every account you have handed over, what has been collected, your reports and your tickets — all in one place.
            </p>
          </div>
        </div>

        {/* RIGHT: THE DOOR. */}
        <div className="relative flex flex-col flex-1 px-6 sm:px-12 lg:px-16 py-10 lg:py-12 overflow-hidden" style={{ background: '#FBFAF7' }}>
          {/* The fine gold curves of the mock-up: decoration, so pointer-events off and hidden from readers. */}
          <svg aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-80 w-80" viewBox="0 0 320 320" fill="none">
            <circle cx="160" cy="160" r="150" stroke={C.gold} strokeOpacity="0.45" strokeWidth="1" />
          </svg>
          <svg aria-hidden className="pointer-events-none absolute -right-28 -bottom-28 h-80 w-80" viewBox="0 0 320 320" fill="none">
            <circle cx="160" cy="160" r="150" stroke={C.gold} strokeOpacity="0.45" strokeWidth="1" />
          </svg>
          <p className={`relative flex items-center justify-end gap-2 ${label} text-[10.5px]`} style={{ color: C.slate, fontFamily: HEAD }}>
            <Lock size={14} /> Secure client portal
          </p>

          <div className="relative flex-1 flex flex-col justify-center w-full max-w-[420px] mx-auto py-10" data-testid="portal-sign-in">
            <h1 className="text-[36px] sm:text-[42px] font-bold leading-tight" style={{ color: C.navy, fontFamily: HEAD }}>
              {step === 'set' ? 'Choose a password' : 'Sign in'}
            </h1>
            <p className="mt-2 mb-8 text-[15px] leading-relaxed" style={{ color: C.slate }}>
              {step === 'password' && 'Access your collection data, reports and support.'}
              {step === 'email' && 'First time here, or forgot your password? We email you a code, then you choose a password.'}
              {step === 'code' && sent}
              {step === 'set' && `From now on you sign in with ${email} and this password. At least ${PORTAL_PASSWORD_MIN} characters; a short phrase is easiest to remember.`}
            </p>

            {step === 'password' && (
              <form onSubmit={signIn} className="space-y-4">
                <Field icon={<Mail size={18} />}>
                  <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.co.za" className={field} style={fieldStyle} data-testid="portal-email" />
                </Field>
                {secret(password, setPassword, 'Password', 'portal-password', 'current-password')}
                <div className="flex items-center justify-between gap-3 text-sm pt-1">
                  <label className="flex items-center gap-2.5 cursor-pointer" style={{ color: C.navy }}>
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-testid="portal-remember"
                      className="h-[18px] w-[18px] rounded border-[#B9C6D3] accent-[#101F2C]" />
                    Keep me signed in
                  </label>
                  <button type="button" onClick={() => go('email')} className={`${link} underline`} style={{ color: C.slate }} data-testid="portal-forgot">
                    Forgot your password?
                  </button>
                </div>
                <button type="submit" disabled={busy || !email || !password} className={`${primary} mt-3`} style={{ background: C.navy }} data-testid="portal-sign-in-button">
                  Sign in <ArrowRight size={18} />
                </button>
                <p className="text-center text-sm pt-2" style={{ color: C.slate }}>
                  First time here?{' '}
                  <button type="button" onClick={() => go('email')} className={link} style={{ color: C.navy }} data-testid="portal-use-code">Email me a sign-in code</button>
                </p>
              </form>
            )}
            {step === 'email' && (
              <form onSubmit={send} className="space-y-4">
                <Field icon={<Mail size={18} />}>
                  <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.co.za" className={field} style={fieldStyle} data-testid="portal-email" />
                </Field>
                <button type="submit" disabled={busy || !email} className={primary} style={{ background: C.navy }}>Email me a code</button>
                <button type="button" onClick={() => go('password')} className={`w-full text-sm ${link}`} style={{ color: C.slate }}>I have a password</button>
              </form>
            )}
            {step === 'code' && (
              <form onSubmit={check} className="space-y-4">
                <p className="sr-only" data-testid="portal-code-sent">{sent}</p>
                <Field icon={<KeyRound size={18} />}>
                  <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)}
                    placeholder="123 456" className={`${field} tracking-[0.3em] text-lg`} style={fieldStyle} data-testid="portal-code" />
                </Field>
                <button type="submit" disabled={busy || !code} className={primary} style={{ background: C.navy }}>Continue</button>
                <div className="flex justify-between text-sm" style={{ color: C.slate }}>
                  <button type="button" className={link} onClick={() => go('email')}>Use another address</button>
                  <button type="button" className={link} disabled={busy} onClick={() => send()}>Send a new code</button>
                </div>
              </form>
            )}
            {step === 'set' && (
              <form onSubmit={save} className="space-y-4">
                {secret(password, setPassword, 'New password', 'portal-new-password', 'new-password')}
                {secret(again, setAgain, 'The same again', 'portal-new-password-again', 'new-password')}
                <button type="submit" disabled={busy || !password || !again} className={primary} style={{ background: C.navy }} data-testid="portal-save-password">
                  Save and sign in <ArrowRight size={18} />
                </button>
              </form>
            )}
            {error && <p className="text-sm text-red-700 mt-4 rounded-lg bg-red-50 border border-red-100 px-3 py-2" data-testid="portal-error">{error}</p>}
          </div>

          <a href={SUPPORT} className="relative mx-auto w-full max-w-[420px] flex items-center gap-4 group" data-testid="portal-support">
            <span className="h-12 w-12 shrink-0 rounded-full flex items-center justify-center" style={{ background: '#F1ECE1', color: C.navy }}><Headphones size={20} /></span>
            <span className="h-10 w-px" style={{ background: '#DCE3EA' }} />
            <span>
              <span className="block text-[15px] font-semibold" style={{ color: C.navy }}>Need help signing in?</span>
              <span className="flex items-center gap-1.5 text-sm group-hover:underline" style={{ color: C.slate }}>Contact our support team <ArrowRight size={14} /></span>
            </span>
          </a>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ signed in */

export type Section = 'dashboard' | 'reports' | 'tickets' | 'accounts' | 'handover'
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
  const [asking, setAsking] = useState<{ about: AskAbout | null; mode?: AskMode; topic?: PortalTopic } | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [folded, toggleFold] = useFold()
  /* THE TOP BAR'S SEARCH (S16, Stephan's mock-up): it searches the book, so it opens Accounts with the words in. */
  const [query, setQuery] = useState('')
  const [lookFor, setLookFor] = useState('')
  const [menu, setMenu] = useState(false)
  /* Open tickets, for the sidebar's count and the bell -- the bell is the ones waiting on the client. */
  const [tickets, setTickets] = useState<{ open: number; waiting: number }>({ open: 0, waiting: 0 })
  useEffect(() => {
    let live = true
    fetchPortalTickets(token).then(({ tickets: t }) => {
      if (live) setTickets({ open: t.filter((x) => x.status === 'open').length, waiting: t.filter((x) => x.status === 'open' && x.stage === 'client').length })
    }).catch(() => {})
    return () => { live = false }
  }, [token, refresh])
  const go = (s: Section) => { setSection(s); setDone(null); if (s !== 'accounts') setLookFor('') }
  const here = SECTIONS.find((s) => s.id === section)!

  return (
    <div className="portal-brand min-h-screen lg:h-screen lg:flex lg:overflow-hidden bg-[#F2F5F8]" data-testid="portal-page">
      {/* THE SIDEBAR, Raptor's own shape: navy, the wordmark, gold for where you are; folds to icons. */}
      <aside className={`hidden lg:flex flex-col shrink-0 h-full overflow-hidden text-[#B4BFCC] border-r border-[#C69F54]/30 transition-[width] duration-200 ${folded ? 'w-[4.5rem]' : 'w-64'}`}
        style={{ background: NAVY }} data-testid="portal-sidebar">
        {/* THE FULL LOGO, THE BF CIRCLE BESIDE THE WORDMARK (Stephan's list, 29 Oct). The ringed lockup on
            file is drawn on white, so the mark and the wordmark are set side by side on the navy instead. */}
        <div className={`h-20 flex items-center gap-3 border-b border-white/10 ${folded ? 'justify-center' : 'px-4'}`} data-testid="portal-logo">
          <img src="/brand/icon-light.svg" alt={folded ? 'Bredell Ferreira' : ''} className={folded ? 'w-9 h-9' : 'w-11 h-11 shrink-0'} />
          {!folded && <img src="/brand/wordmark-light.svg" alt="Bredell Ferreira" className="h-[13px] w-auto min-w-0" />}
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
              className={`w-full flex items-center gap-3 rounded-[10px] py-2.5 text-sm font-semibold transition-colors ${folded ? 'justify-center' : 'px-3'} ${section === s.id
                ? 'bg-[#C69F54] text-[#101F2C]' : 'hover:bg-white/[0.06] hover:text-white'}`}>
              <s.icon size={17} className="shrink-0" />
              {!folded && <span className="flex-1 text-left">{s.label}</span>}
              {!folded && s.id === 'tickets' && tickets.open > 0 && (
                <span className={`rounded-md px-1.5 text-[11px] font-semibold tabular-nums ${section === s.id ? 'bg-[#111E2D]/15' : 'bg-white/10 text-white'}`}
                  data-testid="portal-tickets-count">{tickets.open}</span>
              )}
            </button>
          ))}
          <button type="button" onClick={() => { setDone(null); setAsking({ about: null }) }} data-testid="portal-call-me"
            title={folded ? 'Ask us to call you' : undefined}
            className={`w-full mt-4 flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium border border-white/15 hover:bg-white/5 hover:text-white ${folded ? 'justify-center' : 'px-3'}`}>
            <Phone size={16} className="shrink-0" />
            {!folded && 'Ask us to call you'}
          </button>
        </nav>
        {/*
          THE FOOT OF THE SIDEBAR: LINES, NOT A PHOTOGRAPH (30 Oct). It held a crop of the coastline, and Stephan, on
          the iPad: "the picture ... I think it's a little bit too much ... keep the line or something like a pattern
          ... maybe the line or a circle there ... I like that kind of the line thing." So the photograph is gone (the
          hero still carries it, once) and what stays is drawn: the gold sweep he liked, and two open rings off the
          corner in the shape of the BF circle, faint enough to read as texture. The navy lifts a touch toward the
          foot so the lines have something to sit on. Pure SVG: nothing to fetch, sharp at any size.
        */}
        {!folded && (
          <div aria-hidden className="relative mt-auto h-60 -mb-2 pointer-events-none overflow-hidden" data-testid="portal-sidebar-foot">
            <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${NAVY} 0%, #15283A 70%, ${NAVY} 100%)` }} />
            {/* The rings keep their shape (meet, not stretched); the sweep fills the width (none). */}
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 256 240" fill="none" preserveAspectRatio="xMaxYMax meet">
              <path d="M 300 128 A 112 112 0 1 0 300 352" stroke="#C69F54" strokeOpacity="0.32" strokeWidth="1.2" transform="translate(-60 -20)" />
              <path d="M 300 160 A 80 80 0 1 0 300 320" stroke="#97B4CC" strokeOpacity="0.18" strokeWidth="1" transform="translate(-60 -20)" />
            </svg>
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 256 240" fill="none" preserveAspectRatio="none">
              <path d="M-10 70 C 90 95, 190 150, 270 240" stroke="#C69F54" strokeOpacity="0.8" strokeWidth="1.4" />
              <path d="M-10 92 C 90 117, 190 172, 270 262" stroke="#C69F54" strokeOpacity="0.22" strokeWidth="1" />
            </svg>
          </div>
        )}
        <div className="px-3 pb-2 relative">
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
          <span className="flex items-center gap-2.5">
            <img src="/brand/icon-light.svg" alt="" className="h-8 w-8" />
            <img src="/brand/wordmark-light.svg" alt="Bredell Ferreira" className="h-3 w-auto" />
          </span>
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
      <main className="flex-1 min-w-0 lg:overflow-y-auto bg-[#F4F4F4]">
        {/* THE TOP BAR (S16, Stephan's mock-up): search the book, the bell for what waits on the client, who is in. */}
        <div className="hidden lg:flex sticky top-0 z-20 items-center gap-4 h-16 px-8 bg-white/95 backdrop-blur border-b border-[#E3E8EE]" data-testid="portal-topbar">
          <form className="flex-1 max-w-xl" onSubmit={(e) => { e.preventDefault(); setLookFor(query.trim()); setSection('accounts'); setDone(null) }}>
            <label className="relative block">
              <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#5A6B80]" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search accounts, debtors or reference numbers…"
                className="w-full rounded-xl border border-[#D5DBE3] bg-[#F7F9FB] pl-10 pr-3 py-2 text-sm text-[#111E2D] focus:outline-none focus:ring-2 focus:ring-[#C69F54]/40"
                data-testid="portal-top-search" />
            </label>
          </form>
          <div className="ml-auto flex items-center gap-3">
            <button type="button" onClick={() => go('tickets')} className="relative p-2 rounded-lg text-[#46607B] hover:bg-[#F2F5F8]"
              aria-label={tickets.waiting ? `${tickets.waiting} waiting on you` : 'Tickets'} data-testid="portal-bell">
              <Bell size={19} />
              {tickets.waiting > 0 && <span className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-[#C69F54] ring-2 ring-white" />}
            </button>
            <div className="relative">
              <button type="button" onClick={() => setMenu((m) => !m)} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-[#F2F5F8]" data-testid="portal-me">
                <span className="h-8 w-8 rounded-full bg-[#46607B] text-white text-sm font-semibold flex items-center justify-center">
                  {(me.name || me.email).trim().charAt(0).toUpperCase()}
                </span>
                <span className="text-sm font-semibold text-[#111E2D]">{(me.name || me.email).split(' ')[0]}</span>
                <ChevronDown size={15} className="text-[#5A6B80]" />
              </button>
              {menu && (
                <div className="absolute right-0 mt-2 w-60 rounded-xl border border-[#E3E8EE] bg-white shadow-lg p-2 text-sm" onMouseLeave={() => setMenu(false)}>
                  <p className="px-3 py-2 text-[#5A6B80] truncate">{me.email}</p>
                  <button type="button" onClick={onSignedOut} className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-[#111E2D] hover:bg-[#F2F5F8]">
                    <LogOut size={15} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-5 sm:py-6 space-y-5">
          {/*
            THE BAND (the brief, section 4): the remittance coastline in a rounded panel across the content area,
            18 px corners, a navy wash from the left so the words read and the sea and the light stay; the
            client's name in gold, the title, the line under it, and one glass "Ask us to call you" on the right.
          */}
          {/*
            CLEARER, AND THE WORDS IN THE MIDDLE (S16, 30 Oct; Stephan on the iPad: "the picture ... looks vague. It's like
            dark ... the script is not centered in the middle"). A 3000 px copy of the coastline sharpened for the iPad's
            screen (portal-hero.webp; the advice keeps its own), the navy only as a soft shade behind the words so the cliffs,
            the sea and the light stay bright, and the words and the button centred on the band's height.
          */}
          <header className="relative overflow-hidden rounded-[18px] text-white min-h-[188px] flex" data-testid="portal-hero"
            style={{ background: `linear-gradient(90deg, rgba(16,31,44,0.82) 0%, rgba(16,31,44,0.55) 30%, rgba(16,31,44,0.12) 58%, rgba(16,31,44,0) 80%), url('/brand/portal-hero.webp') center 38% / cover` }}>
            <div className="w-full px-6 sm:px-10 py-7 flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="bf-label text-[11.5px] text-[#C69F54]">{me.client}</p>
                <h1 className="text-[30px] sm:text-[36px] leading-tight mt-1.5 [text-shadow:0_1px_12px_rgba(16,31,44,0.45)]">{here.title}</h1>
                <p className="text-[15px] text-white/90 mt-1 [text-shadow:0_1px_8px_rgba(16,31,44,0.5)]">{section === 'dashboard' ? 'Your book, where it stands, whenever you want to look.' : here.blurb}</p>
              </div>
              <button type="button" onClick={() => { setDone(null); setAsking({ about: null }) }} data-testid="portal-hero-call"
                className="inline-flex items-center gap-2 rounded-[10px] bg-[#101F2C]/45 hover:bg-[#101F2C]/65 border border-white/25 px-4 py-2.5 text-sm font-semibold backdrop-blur-md">
                <Phone size={15} /> Ask us to call you
              </button>
            </div>
          </header>
          {done && <p className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-2.5 text-sm text-emerald-800" data-testid="portal-asked">{done}</p>}
          {section === 'dashboard' && <PortalDashboard key={refresh} token={token} onSignedOut={onExpired} onOpen={go}
            onAsk={(mode, topic) => { setDone(null); setAsking({ about: null, mode, topic }) }} />}
          {section === 'reports' && <PortalReports token={token} onSignedOut={onExpired} clientName={me.client} />}
          {section === 'tickets' && <PortalTickets token={token} onSignedOut={onExpired} refreshKey={refresh}
            onRaise={() => { setDone(null); setAsking({ about: null, mode: 'question' }) }} />}
          {section === 'handover' && <PortalHandovers token={token} onSignedOut={onExpired} />}
          {section === 'accounts' && (
            <Book key={lookFor} token={token} onSignedOut={onExpired} initialSearch={lookFor}
              onAsk={(about, mode) => { setDone(null); setAsking({ about, mode }) }} />
          )}
        </div>
      </main>

      {asking && (
        <PortalAsk token={token} about={asking.about} initialMode={asking.mode} initialTopic={asking.topic} onClose={() => setAsking(null)} onSignedOut={onExpired}
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

function Book({ token, onSignedOut, onAsk, initialSearch = '' }: { token: string; onSignedOut: () => void; onAsk: (about: AskAbout, mode?: AskMode) => void; initialSearch?: string }) {
  const [search, setSearch] = useState(initialSearch)
  const [asked, setAsked] = useState(initialSearch)
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
