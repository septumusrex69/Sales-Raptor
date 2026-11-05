import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowRight, ChevronsLeft, ChevronsRight, Copy, Eye, EyeOff, FileDown, FileText, Handshake, Hash, KeyRound, LifeBuoy, Loader2,
  Lock, LogOut, Mail, MessageCircle, Phone, Upload, Wallet,
} from 'lucide-react'
import { DEBTOR_DISPUTE_REASONS, DEBTOR_POP_MAX_BYTES, debtorDispute, debtorPopFile, debtorQuestion, debtorLogin, debtorStanding, DEBTOR_LOGIN_HINT } from '../../lib/debtorPortal'
import { saveFile } from '../../lib/fileSave'
import { PROPOSAL_RULES, applicationNote, needsApplication, onceOffNote, proposalProblem, proposalSummary, settlementHolds, settlementHoldsUntil } from '../../lib/debtorArrangement'
import type { Arrangement } from '../../lib/arrangements'
import { bandBackground } from '../../lib/portalPhotos'
import {
  DebtorSignedOut, debtorToken, fetchDebtorAccount, fetchDebtorStatement, requestDebtorCode, saveDebtorToken, setDebtorPassword, signInDebtor,
  askDebtorQuestion, proposeDebtorArrangement, raiseDebtorDispute, sendDebtorProofOfPayment, signOutDebtor, verifyDebtorCode,
  type DebtorAccount,
} from '../../lib/debtorPortalApi'
import { C, DayLine, Field, PhotoCredit, loadPortalLook, usePortalLook } from '../portal/portalLook'
import { DOOR, PortalSignInFrame } from '../portal/PortalSignInFrame'
import { PortalSplash } from '../portal/PortalSplash'
import { primeSplashAudio } from '../portal/portalSound'
import '../portal/portal.css'
import '@fontsource-variable/raleway'
import '@fontsource-variable/open-sans'

/**
 * /my-account -- THE DEBTOR PORTAL (Raptor H16). A debtor signs in with their case number (a code the first time, a
 * password after) and sees what they owe and how to pay, downloads their statement, sends a proof of payment, offers an
 * arrangement, and asks a question or disputes the account.
 *
 * IT IS THE CLIENT PORTAL, FOR A DEBTOR (Stephan, 3 Nov: "Make the debtors login portal look like the client portal. Use
 * the same skins, the same stuff, the Bredell Ferreira, the everything ... speak to your agent. This is the person
 * assigned to you. It's exactly the same, except when it's a client, it's a debtor."). So: the same door
 * (PortalSignInFrame), the same day's photograph and line (portalLook), the same opening on sign-in (PortalSplash), the
 * same navy sidebar with the wordmark that folds to icons, the same band, cards, type and colours (portal.css's
 * .portal-brand) -- and where the client portal names their liaison, this names the debtor's AGENT, the collector on
 * the account. What is not the same is only what a debtor does: their own account, not a book.
 */

const NAVY = C.navy
const GOLD = C.gold

const money = (n: number) => `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split('\u00a0').join(' ')}`
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const longDay = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}` }
const SUPPORT = 'mailto:info@bredellferreira.co.za?subject=Account%20sign-in'

export default function DebtorPortalPage() {
  const [token, setToken] = useState<string | null>(() => debtorToken())
  const [account, setAccount] = useState<DebtorAccount | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opened, setOpened] = useState(false)
  /* Set by a sign-in, so the full opening plays then (PortalSplash), as the client portal's does. */
  const [fresh, setFresh] = useState(false)
  const [round, setRound] = useState(0)

  /* Today's approved look -- the same photograph and line the client portal shows today. */
  useEffect(() => { loadPortalLook() }, [])

  const signedOut = useCallback(() => { saveDebtorToken(null); setToken(null); setAccount(null) }, [])
  useEffect(() => {
    if (!token) return
    let live = true
    setError(null)
    fetchDebtorAccount(token)
      .then((r) => { if (live) setAccount(r) })
      .catch((x) => { if (!live) return; if (x instanceof DebtorSignedOut) signedOut(); else setError(x instanceof Error ? x.message : String(x)) })
    return () => { live = false }
  }, [token, signedOut, round])

  if (!token) return <SignIn onSignedIn={(t, remember) => { saveDebtorToken(t, remember); setToken(t); setOpened(false); setFresh(true) }} />
  return <>
    {!opened && <PortalSplash variant="arcs" ready={!!account || !!error} fresh={fresh} onDone={() => { setOpened(true); setFresh(false) }} />}
    {error && !account && (
      <div className="portal-brand min-h-screen flex items-center justify-center p-6 bg-[#F4F4F4]">
        <Card><p className="text-sm text-red-700">{error}</p></Card>
      </div>
    )}
    {account && <Signed token={token} a={account} onRefresh={() => setRound((n) => n + 1)}
      onSignedOut={() => { signOutDebtor(token).catch(() => {}); signedOut() }} />}
  </>
}

/* THE CLIENT PORTAL'S CARD, LABEL, FIELD AND BUTTON -- white, rounded, the brief's border and navy. */
function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-[#D5DBE3] bg-white p-5 sm:p-6 ${className}`}>{children}</section>
}
function Label({ children }: { children: ReactNode }) {
  return <p className="bf-label text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#3F5F86]">{children}</p>
}
const field = 'w-full rounded-[13px] border border-[#DCE3EA] bg-white px-3.5 py-3 text-[15px] text-[#101F2C] placeholder:text-[#97B4CC] outline-none focus:border-[#C69F54]/70 focus:ring-2 focus:ring-[#C69F54]/40'
const button = 'w-full rounded-[13px] px-4 py-3.5 text-[15px] font-semibold text-white shadow-sm hover:brightness-125 disabled:opacity-60 disabled:cursor-not-allowed transition'

/* ------------------------------------------------------------------ signing in */

/**
 * SIGNING IN: A CODE ONCE, A PASSWORD AFTER (Stephan, 3 Nov: "do one ... confirm your email address ... But not every
 * single time"), behind the client portal's own door. The page opens on the case number and the password; the code is
 * one press away for the first visit and a forgotten password. Arriving from an invitation (?case=...), it opens on
 * the code. "Keep me signed in on this device" is offered, off by default -- a borrowed phone is the common case.
 */
function SignIn({ onSignedIn }: { onSignedIn: (token: string, remember: boolean) => void }) {
  const [step, setStep] = useState<'password' | 'ask' | 'verify' | 'choose'>('password')
  const [caseNumber, setCaseNumber] = useState(() => new URLSearchParams(window.location.search).get('case') ?? '')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [code, setCode] = useState('')
  const [remember, setRemember] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (new URLSearchParams(window.location.search).get('case')) setStep('ask') }, [])

  const go = async (fn: () => Promise<void>) => { setError(null); setBusy(true); try { await fn() } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) } }
  /* Case number, ID number or email (Stephan, 4 Nov): the page used to refuse anything but a case number before it
     asked the server, which is why his own sign-in "didn't work" with nothing in the logs. */
  const caseOk = () => { if (debtorLogin(caseNumber)) return true; setError(DEBTOR_LOGIN_HINT); return false }
  const { field: door, fieldStyle, primary, link } = DOOR

  const caseField = (
    <Field icon={<Hash size={18} />}>
      <input value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} placeholder="Case number, ID number or email" autoComplete="username"
        autoCapitalize="none" aria-label="Case number, ID number or email" className={door} style={fieldStyle} />
    </Field>
  )
  const secret = (value: string, set: (v: string) => void, label: string, auto: string) => (
    <Field icon={<Lock size={18} />}>
      <input type={show ? 'text' : 'password'} value={value} onChange={(e) => set(e.target.value)} autoComplete={auto}
        placeholder={label} aria-label={label} className={`${door} pr-12`} style={fieldStyle} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide the password' : 'Show the password'}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 hover:bg-[#F4F4F4]" style={{ color: C.slate }}>
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </Field>
  )
  const keep = (
    <label className="flex items-center gap-2.5 cursor-pointer text-sm" style={{ color: C.navy }}>
      <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} aria-label="Keep me signed in on this device"
        className="h-[18px] w-[18px] rounded border-[#B9C6D3] accent-[#101F2C]" />
      Keep me signed in on this device
    </label>
  )
  const spin = <Loader2 className="h-5 w-5 animate-spin" />

  return (
    <PortalSignInFrame
      kicker="Your account"
      promise="What you owe, what you have paid, and how to settle it — whenever suits you."
      blurb="Your balance and your statement, how to pay, an arrangement you can offer us, and the person who looks after your account — all in one place."
      secure="Secure account portal"
      title={step === 'choose' ? 'Choose a password' : 'Sign in'}
      intro={step === 'password' ? 'Sign in with your case number and your password.'
        : step === 'ask' ? 'First time here, or forgot your password? Type the case number from our letter, email or SMS and we will send a code to the email address (or cellphone) we have for you.'
          : step === 'verify' ? <span data-testid="debtor-code-sent">{sent}</span>
            : 'Thank you, that is confirmed. Choose a password: next time you sign in with your case number and this password, and no code.'}
      support={{ href: SUPPORT, title: 'Need help signing in?', sub: 'Contact us' }}>
      {step === 'password' && (
        <form onSubmit={(e) => { e.preventDefault(); primeSplashAudio(); if (caseOk()) void go(async () => { onSignedIn((await signInDebtor(caseNumber, password, remember)).token, remember) }) }}
          className="space-y-4" data-testid="debtor-password">
          {caseField}
          {secret(password, setPassword, 'Password', 'current-password')}
          <div className="pt-1">{keep}</div>
          <button type="submit" disabled={busy || !password} className={`${primary} mt-3`} style={{ background: C.navy }}>
            {busy ? spin : <>Sign in <ArrowRight size={18} /></>}
          </button>
          <p className="text-center text-sm pt-2" style={{ color: C.slate }}>
            <button type="button" onClick={() => { setStep('ask'); setError(null) }} className={link} style={{ color: C.navy }} data-testid="debtor-first-time">
              First time here, or forgot your password? Send me a code
            </button>
          </p>
        </form>
      )}
      {step === 'ask' && (
        <form onSubmit={(e) => { e.preventDefault(); if (caseOk()) void go(async () => { setSent((await requestDebtorCode(caseNumber)).message); setStep('verify') }) }}
          className="space-y-4" data-testid="debtor-ask">
          {caseField}
          <button type="submit" disabled={busy} className={primary} style={{ background: C.navy }}>{busy ? spin : 'Send me a code'}</button>
          <button type="button" onClick={() => { setStep('password'); setError(null) }} className={`w-full text-sm ${link}`} style={{ color: C.slate }}>I have a password</button>
        </form>
      )}
      {step === 'verify' && (
        <form onSubmit={(e) => { e.preventDefault(); primeSplashAudio(); void go(async () => {
          const r = await verifyDebtorCode(caseNumber, code, remember)
          if (r.needsPassword) { setFresh(r.token); setPassword(''); setStep('choose') } else onSignedIn(r.token, remember)
        }) }} className="space-y-4" data-testid="debtor-verify">
          <Field icon={<KeyRound size={18} />}>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8}
              placeholder="123 456" aria-label="Code" className={`${door} tracking-[0.3em] text-lg`} style={fieldStyle} />
          </Field>
          {keep}
          <button type="submit" disabled={busy || code.replace(/\D/g, '').length < 6} className={primary} style={{ background: C.navy }}>{busy ? spin : 'Continue'}</button>
          <div className="flex justify-between text-sm" style={{ color: C.slate }}>
            <button type="button" className={link} onClick={() => { setStep('ask'); setCode(''); setError(null) }}>Use a different case number</button>
            <button type="button" className={link} disabled={busy} onClick={() => void go(async () => { setSent((await requestDebtorCode(caseNumber)).message) })}>Send a new code</button>
          </div>
        </form>
      )}
      {step === 'choose' && fresh && (
        <form onSubmit={(e) => { e.preventDefault(); primeSplashAudio(); void go(async () => { await setDebtorPassword(fresh, password); onSignedIn(fresh, remember) }) }}
          className="space-y-4" data-testid="debtor-choose-password">
          {secret(password, setPassword, 'New password', 'new-password')}
          <p className="text-xs" style={{ color: C.slate }}>At least 8 characters; a short phrase is easiest to remember.</p>
          <button type="submit" disabled={busy || password.length < 8} className={primary} style={{ background: C.navy }}>
            {busy ? spin : <>Save my password and open my account <ArrowRight size={18} /></>}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-700 mt-4 rounded-lg bg-red-50 border border-red-100 px-3 py-2" data-testid="debtor-error">{error}</p>}
    </PortalSignInFrame>
  )
}

/* ------------------------------------------------------------------ signed in */

type Section = 'account' | 'payments' | 'arrangement' | 'help'
const SECTIONS: { id: Section; label: string; icon: typeof Wallet; title: string; blurb: string }[] = [
  { id: 'account', label: 'Your account', icon: Wallet, title: 'Your account', blurb: 'What you owe today, and how to pay it.' },
  { id: 'payments', label: 'Payments & statement', icon: FileText, title: 'Payments & statement', blurb: 'What we have received, your statement, and your proof of payment.' },
  { id: 'arrangement', label: 'Arrangement', icon: Handshake, title: 'Arrangement', blurb: 'Pay over time: offer us an arrangement, or see the one you have.' },
  { id: 'help', label: 'Questions & disputes', icon: LifeBuoy, title: 'Questions & disputes', blurb: 'Ask us anything about your account, or tell us something is wrong.' },
]

/* THE FOLD IS REMEMBERED in this browser, as the client portal's is -- a convenience only. */
const FOLD_KEY = 'raptor.debtor.sidebar'
function useFold(): [boolean, () => void] {
  const [folded, setFolded] = useState(() => { try { return localStorage.getItem(FOLD_KEY) === 'narrow' } catch { return false } })
  const toggle = () => setFolded((f) => { try { localStorage.setItem(FOLD_KEY, f ? 'wide' : 'narrow') } catch { /* this tab only */ } return !f })
  return [folded, toggle]
}

function Signed({ token, a, onRefresh, onSignedOut }: { token: string; a: DebtorAccount; onRefresh: () => void; onSignedOut: () => void }) {
  const look = usePortalLook()
  const [section, setSection] = useState<Section>('account')
  const [folded, toggleFold] = useFold()
  const here = SECTIONS.find((x) => x.id === section)!
  const open = a.tickets.filter((t) => t.open).length
  const reach = a.agent?.phone ?? a.contact?.phone ?? null

  return (
    <div className="portal-brand min-h-screen lg:h-screen lg:flex lg:overflow-hidden bg-[#F2F5F8]" data-testid="debtor-account">
      {/* THE SIDEBAR, the client portal's shape: navy, the wordmark, gold for where you are; folds to icons. */}
      <aside className={`hidden lg:flex flex-col shrink-0 h-full overflow-hidden text-[#B4BFCC] border-r border-[#C69F54]/30 transition-[width] duration-200 ${folded ? 'w-[4.5rem]' : 'w-64'}`}
        style={{ background: NAVY }} data-testid="debtor-sidebar">
        <div className={`h-20 flex items-center gap-3 border-b border-white/10 ${folded ? 'justify-center' : 'px-4'}`}>
          <img src="/brand/icon-light.svg" alt={folded ? 'Bredell Ferreira' : ''} className={folded ? 'w-9 h-9' : 'w-11 h-11 shrink-0'} />
          {!folded && <img src="/brand/wordmark-light.svg" alt="Bredell Ferreira" className="h-[13px] w-auto min-w-0" />}
        </div>
        {!folded && (
          <div className="px-5 pt-5 pb-2">
            <p className="bf-label text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#C69F54]">Your account</p>
            <p className="text-white font-semibold mt-1 leading-tight">{a.caseNumber}</p>
          </div>
        )}
        <nav aria-label="Your account" className="flex-1 px-3 py-3 space-y-1">
          {SECTIONS.map((x) => (
            <button key={x.id} type="button" onClick={() => setSection(x.id)} aria-current={section === x.id ? 'page' : undefined}
              title={folded ? x.label : undefined} data-testid={`debtor-nav-${x.id}`}
              className={`w-full flex items-center gap-3 rounded-[10px] py-2.5 text-sm font-semibold transition-colors ${folded ? 'justify-center' : 'px-3'} ${section === x.id
                ? 'bg-[#C69F54] text-[#101F2C]' : 'hover:bg-white/[0.06] hover:text-white'}`}>
              <x.icon size={17} className="shrink-0" />
              {!folded && <span className="flex-1 text-left">{x.label}</span>}
              {!folded && x.id === 'help' && open > 0 && (
                <span className={`rounded-md px-1.5 text-[11px] font-semibold tabular-nums ${section === x.id ? 'bg-[#111E2D]/15' : 'bg-white/10 text-white'}`}>{open}</span>
              )}
            </button>
          ))}
          {reach && (
            <a href={`tel:${reach.replace(/\s/g, '')}`} title={folded ? 'Call us' : undefined}
              className={`w-full mt-4 flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium border border-white/15 hover:bg-white/5 hover:text-white ${folded ? 'justify-center' : 'px-3'}`}>
              <Phone size={16} className="shrink-0" />
              {!folded && (a.agent ? `Call ${a.agent.name.split(' ')[0]}` : 'Call us')}
            </a>
          )}
        </nav>
        {/* THE FOOT: the gold sweep and the open rings, the client portal's lines. */}
        {!folded && (
          <div aria-hidden className="relative mt-auto h-60 -mb-2 pointer-events-none overflow-hidden">
            <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${NAVY} 0%, #15283A 70%, ${NAVY} 100%)` }} />
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
          <button type="button" onClick={toggleFold} aria-expanded={!folded} title={folded ? 'Widen the menu' : 'Narrow the menu'}
            className={`w-full flex items-center gap-2.5 rounded-lg py-2 text-xs hover:bg-white/5 hover:text-white ${folded ? 'justify-center' : 'px-3'}`}>
            {folded ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            {!folded && 'Narrow the menu'}
          </button>
        </div>
        <div className={`border-t border-white/10 p-3 flex items-center gap-3 ${folded ? 'justify-center' : ''}`}>
          {!folded && (
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white truncate">{a.name || 'Your account'}</p>
              <p className="text-[11px] truncate">{a.caseNumber}</p>
            </div>
          )}
          <button type="button" onClick={onSignedOut} title="Sign out" aria-label="Sign out" className="p-2 rounded-lg hover:bg-white/5 hover:text-white">
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* ON A PHONE: the same sections across the top, and the way out. */}
      <div className="lg:hidden sticky top-0 z-30" style={{ background: NAVY }}>
        <div className="flex items-center justify-between px-4 h-14">
          <span className="flex items-center gap-2.5">
            <img src="/brand/icon-light.svg" alt="" className="h-8 w-8" />
            <img src="/brand/wordmark-light.svg" alt="Bredell Ferreira" className="h-3 w-auto" />
          </span>
          <button type="button" onClick={onSignedOut} className="text-xs text-[#AEBBCB] underline" aria-label="Sign out">Sign out</button>
        </div>
        <nav aria-label="Your account" className="flex gap-1 overflow-x-auto px-3 pb-3">
          {SECTIONS.map((x) => (
            <button key={x.id} type="button" onClick={() => setSection(x.id)} aria-current={section === x.id ? 'page' : undefined}
              data-testid={`debtor-tab-${x.id}`}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${section === x.id ? 'bg-[#C69F54] text-[#111E2D] font-semibold' : 'text-[#AEBBCB]'}`}>
              {x.label}
            </button>
          ))}
        </nav>
      </div>

      <main className="flex-1 min-w-0 lg:overflow-y-auto bg-[#F4F4F4]">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-5 sm:py-6 space-y-5">
          {/* THE BAND: the day's photograph, the debtor's name in gold, where they are, and the day's line. */}
          <header className="relative overflow-hidden rounded-[18px] text-white min-h-[188px] flex" data-side={look.side} style={{ background: bandBackground(look) }}>
            <div className={`w-full px-6 sm:px-10 py-7 flex flex-wrap items-center justify-between gap-4 ${look.side === 'right' ? 'flex-row-reverse text-right' : ''}`}>
              <div className="min-w-0">
                <p className="bf-label text-[11.5px] text-[#C69F54]">{a.name || 'Your account'}</p>
                <h1 className="text-[30px] sm:text-[36px] leading-tight mt-1.5 [text-shadow:0_1px_12px_rgba(16,31,44,0.45)]">{here.title}</h1>
                <p className="text-[15px] text-white/90 mt-1 [text-shadow:0_1px_8px_rgba(16,31,44,0.5)]">
                  Case {a.caseNumber}{a.client ? ` · on behalf of ${a.client}` : ''}{a.clientReference ? ` (their reference ${a.clientReference})` : ''}
                </p>
                {section === 'account' && <DayLine className="mt-3 max-w-xl" compact />}
              </div>
              {reach && (
                <a href={`tel:${reach.replace(/\s/g, '')}`}
                  className="inline-flex items-center gap-2 rounded-[10px] bg-[#101F2C]/45 hover:bg-[#101F2C]/65 border border-white/25 px-4 py-2.5 text-sm font-semibold backdrop-blur-md">
                  <Phone size={15} /> {a.agent ? `Call ${a.agent.name.split(' ')[0]}` : 'Call us'}
                </a>
              )}
            </div>
            <PhotoCredit className="absolute right-4 bottom-1.5" />
          </header>

          {section === 'account' && <AccountSection a={a} token={token} onSent={onRefresh} go={setSection} />}
          {section === 'payments' && (
            <div className="grid gap-5 lg:grid-cols-2">
              <PaymentsList a={a} />
              <div className="space-y-5">
                <Statement token={token} />
                {!a.closed && a.summary.balance > 0 && <ProofOfPayment token={token} />}
              </div>
            </div>
          )}
          {section === 'arrangement' && (a.closed || a.summary.balance <= 0
            ? <Card><p className="text-[15px]" style={{ color: NAVY }}>There is nothing to arrange on this account.</p></Card>
            : <ArrangementSection token={token} account={a} onSent={onRefresh} />)}
          {section === 'help' && (a.closed ? <Card><p className="text-[15px]" style={{ color: NAVY }}>This account is closed. To ask about it, please call us.</p></Card>
            : <Tickets token={token} account={a} onSent={onRefresh} />)}
          {section !== 'account' && <AgentCard a={a} token={token} onSent={onRefresh} />}
        </div>
      </main>
    </div>
  )
}

/** THE ACCOUNT AT A GLANCE: what is owed, how to pay it, and who looks after it. */
function AccountSection({ a, token, onSent, go }: { a: DebtorAccount; token: string; onSent: () => void; go: (s: Section) => void }) {
  const [copied, setCopied] = useState(false)
  const s = a.summary
  const closedLine = a.closed === 'paid_up' ? 'This account is paid in full and closed. Thank you.'
    : a.closed === 'settled' ? 'This account was settled and is closed. Thank you.'
      : a.closed === 'withdrawn' ? `${a.client || 'Our client'} has taken this account back. Please contact them about it.`
        : null
  const st = debtorStanding(a, money, longDay)
  const pct = Math.round(st.paidShare * 100)
  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
      {/* WHERE IT STANDS, FIRST (Stephan, 4 Nov: "when they log in ... they can see that. But progress bar"). */}
      <div className="lg:col-span-2">
        <Card>
          <div data-testid="debtor-standing">
            <div className="flex items-baseline justify-between gap-3">
              <Label>Where your account stands</Label>
              <span className="text-sm font-semibold tabular-nums" style={{ color: NAVY }} data-testid="debtor-progress-pct">{pct}% paid</span>
            </div>
            <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-[#EEF2F6]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="How much of the account is paid">
              <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%`, background: `linear-gradient(90deg, ${GOLD}, #D9BC7E)` }} />
            </div>
            <div className="mt-2 flex justify-between text-[13px] text-[#5A6B80] tabular-nums">
              <span>Paid {money(Math.max(0, s.paid))}</span>
              <span>Still to pay {money(Math.max(0, s.balance))}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className={`text-[15px] font-semibold ${st.stage === 'missed' ? 'text-red-700' : ''}`} style={st.stage === 'missed' ? undefined : { color: NAVY }} data-testid="debtor-stage">{st.headline}</p>
              {st.action === 'arrangement' && (
                <button type="button" onClick={() => go('arrangement')} className="rounded-[10px] px-4 py-2 text-sm font-semibold text-white" style={{ background: NAVY }} data-testid="debtor-stage-action">Settle or make an arrangement</button>
              )}
            </div>
          </div>
        </Card>
      </div>
      <div className="space-y-5">
        {closedLine && <Card><p className="text-[15px] font-semibold" style={{ color: NAVY }} data-testid="debtor-closed">{closedLine}</p></Card>}
        {a.closed !== 'withdrawn' && (
          <Card>
            <Label>What you owe today · {longDay(a.asAt)}</Label>
            <p className="mt-1 text-[38px] font-bold tabular-nums leading-tight" style={{ color: NAVY, fontFamily: "'Raleway Variable', 'Raleway', sans-serif" }} data-testid="debtor-balance">{money(Math.max(0, s.balance))}</p>
            {s.balance < 0 && <p className="mt-1 text-sm text-[#5A6B80]">You have paid {money(-s.balance)} more than you owed. Please call us so we can return it.</p>}
            {/* HOW THE FIGURE IS MADE, AS A SUM (Stephan, 4 Nov: "the text is a little bit all over the place"): the four
                parts, then the total under a rule where a sum's answer goes -- and the settlement figure OUT of the sum,
                in its own box, because it is a different number with a date on it, not a fifth line of the same one. */}
            <dl className="mt-4 text-[15px]" data-testid="debtor-breakdown">
              <Row label="Original amount owed" value={s.capital} />
              <Row label="Interest" value={s.interest} />
              <Row label="Fees and costs (VAT included)" value={s.fees} />
              <Row label="You have paid" value={-s.paid} />
              <div className="mt-1 flex justify-between border-t-2 pt-3" style={{ borderColor: NAVY }}>
                <dt className="font-semibold" style={{ color: NAVY }}>What you owe</dt>
                <dd className="tabular-nums font-bold" style={{ color: NAVY }}>{money(Math.max(0, s.balance))}</dd>
              </div>
            </dl>
            {s.balance > 0 && (
              <div className="mt-4 rounded-xl p-4" style={{ background: '#FBF6EC', border: `1px solid ${GOLD}` }} data-testid="debtor-settle-box">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: '#8A6A2E' }}>To settle in full</p>
                <p className="mt-1 text-[22px] font-bold tabular-nums" style={{ color: NAVY }} data-testid="debtor-settle">{money(s.settleToday)}</p>
                <p className="mt-1 text-sm text-[#5A6B80]">
                  If paid by {longDay(settlementHoldsUntil(a.asAt))}.{s.settleToday !== s.balance ? ' It includes the fee on the final payment.' : ''} After that date interest and fees may add to it.
                </p>
              </div>
            )}
            {s.note && <p className="mt-3 rounded-xl bg-[#F2F5F8] p-3 text-sm text-[#3F5F86]" data-testid="debtor-note">{s.note}</p>}
          </Card>
        )}
      </div>
      <div className="space-y-5">
        {a.pay && !a.closed && s.balance > 0 && (
          <Card>
            <Label>How to pay</Label>
            <p className="mt-1 text-[15px] text-[#5A6B80]">Pay into our trust account. <strong className="text-[#101F2C]">Always use your case number as the reference</strong> — that is how your payment reaches your account.</p>
            {/* Label over value, two to a row: a long account name beside its label wrapped into a ragged column. */}
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]" data-testid="debtor-pay">
              <div className="col-span-2"><Pair label="Account name" value={a.pay.accountName} /></div>
              {a.pay.bank && <Pair label="Bank" value={a.pay.bank} />}
              {a.pay.branchCode && <Pair label="Branch code" value={a.pay.branchCode} />}
              {a.pay.accountNumber && <Pair label="Account number" value={a.pay.accountNumber} />}
              {a.pay.accountType && <Pair label="Account type" value={a.pay.accountType} />}
              <div className="col-span-2 flex items-center justify-between gap-3 rounded-xl p-3" style={{ background: '#FBF6EC', border: `1px solid ${GOLD}` }}>
                <div><dt className="text-sm text-[#5A6B80]">Reference</dt><dd className="text-lg font-bold tracking-wide" style={{ color: NAVY }}>{a.pay.reference}</dd></div>
                <button type="button" className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: NAVY }}
                  onClick={() => { void navigator.clipboard?.writeText(a.pay!.reference).then(() => setCopied(true)).catch(() => {}) }}>
                  <Copy size={15} /> {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </dl>
          </Card>
        )}
        <AgentCard a={a} token={token} onSent={onSent} />
      </div>
    </div>
  )
}

/**
 * YOUR AGENT, AND THE FIRM BEHIND THEM (Stephan, 3 Nov: "speak to your agent. This is the person assigned to you";
 * 4 Nov: "the person handling your matter is Itumeleng ... their direct line, but also ... speak to Bredell Ferreira").
 * Two halves, always both where there is an agent: the person, with their own line, email and WhatsApp and a button
 * that asks them to call back; then the office, because an agent is on leave some days and a debtor with money in
 * hand should never find the only number on the page unanswered. Where nobody holds the account, the office alone.
 */
function AgentCard({ a, token, onSent }: { a: DebtorAccount; token: string; onSent: () => void }) {
  const ag = a.agent
  const office = { phone: a.contact?.phone ?? null, email: a.contact?.email ?? null }
  const [asking, setAsking] = useState(false)
  const [number, setNumber] = useState('')
  const [when, setWhen] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!ag && !office.phone && !office.email) return null
  const pill = 'inline-flex items-center gap-2 rounded-[10px] border border-[#D5DBE3] px-3 py-2 text-sm font-semibold hover:bg-[#F2F5F8] max-w-full'
  const first = ag?.name.trim().split(/\s+/)[0] ?? ''
  const ways = (p: { phone: string | null; email: string | null; whatsapp?: string | null }, testid: string) => (
    <div className="mt-3 flex flex-wrap gap-2" data-testid={testid}>
      {p.phone && <a href={`tel:${p.phone.replace(/\s/g, '')}`} className={pill} style={{ color: NAVY }}><Phone size={15} /> {p.phone}</a>}
      {p.whatsapp && <a href={`https://wa.me/${p.whatsapp.replace(/\D/g, '').replace(/^0/, '27')}`} target="_blank" rel="noreferrer" className={pill} style={{ color: NAVY }}><MessageCircle size={15} /> WhatsApp</a>}
      {p.email && <a href={`mailto:${p.email}?subject=${encodeURIComponent(a.caseNumber)}`} className={pill} style={{ color: NAVY }}><Mail size={15} /> <span className="truncate">{p.email}</span></a>}
    </div>
  )
  async function askCallback(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (number.replace(/\D/g, '').length < 9) { setError('Type the number we should call you on.'); return }
    setBusy(true)
    try {
      await askDebtorQuestion(token, `Please call me back on ${number.trim()}${when.trim() ? ` (${when.trim()})` : ''}.`)
      setDone(true); setAsking(false); onSent()
    } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }
  return (
    <Card>
      <div data-testid="debtor-agent">
        {ag && (
          <>
            <Label>The person handling your account</Label>
            <div className="mt-3 flex items-center gap-3">
              <span className="h-12 w-12 shrink-0 rounded-full flex items-center justify-center text-lg font-semibold text-white" style={{ background: C.slate }}>
                {ag.name.trim().charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-[17px] font-semibold" style={{ color: NAVY }}>{ag.name}</p>
                <p className="text-sm text-[#5A6B80]">Your agent at Bredell Ferreira. Quote {a.caseNumber}.</p>
              </div>
            </div>
            {ways({ phone: ag.phone, email: ag.email, whatsapp: ag.whatsapp }, 'debtor-agent-ways')}
            {done
              ? <p className="mt-3 rounded-lg bg-[#F2F5F8] p-3 text-sm" style={{ color: NAVY }} data-testid="debtor-callback-sent">Thank you. {first} will call you back, usually within one working day.</p>
              : !asking
                ? <button type="button" onClick={() => setAsking(true)} className="mt-3 text-sm font-semibold underline underline-offset-2" style={{ color: NAVY }} data-testid="debtor-callback">Ask {first} to call me back</button>
                : (
                  <form onSubmit={askCallback} className="mt-3 space-y-2" data-testid="debtor-callback-form">
                    <input value={number} onChange={(e) => setNumber(e.target.value)} inputMode="tel" placeholder="Your number" aria-label="Number to call back" className={field} />
                    <input value={when} onChange={(e) => setWhen(e.target.value)} placeholder="Best time (optional), e.g. after 2pm" aria-label="Best time to call" maxLength={80} className={field} />
                    <button type="submit" disabled={busy} className={button} style={{ background: NAVY }}>{busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : `Ask ${first} to call me`}</button>
                    {error && <p className="text-sm text-red-700">{error}</p>}
                  </form>
                )}
          </>
        )}
        {(office.phone || office.email) && (
          <div className={ag ? 'mt-5 border-t border-[#EEF2F6] pt-4' : ''} data-testid="debtor-office">
            <Label>{ag ? 'Or speak to the office' : 'Speak to us'}</Label>
            <p className="mt-1 text-[15px] font-semibold" style={{ color: NAVY }}>Bredell Ferreira</p>
            <p className="text-sm text-[#5A6B80]">{ag ? `Anyone at the office can help when ${first} is not available.` : `Quote ${a.caseNumber} when you call or write.`}</p>
            {ways(office, 'debtor-office-ways')}
          </div>
        )}
      </div>
    </Card>
  )
}

function PaymentsList({ a }: { a: DebtorAccount }) {
  return (
    <Card>
      <Label>Payments we have received</Label>
      {a.payments.length === 0
        ? <p className="mt-2 text-[15px] text-[#5A6B80]">None yet. A payment shows here once we have confirmed it, usually within two working days.</p>
        : (
          <ul className="mt-2 divide-y divide-[#EEF2F6] text-[15px]" data-testid="debtor-payments">
            {a.payments.map((p, i) => (
              <li key={`${p.on}-${i}`} className="flex justify-between py-2.5"><span>{longDay(p.on)}</span><span className="tabular-nums font-semibold" style={{ color: NAVY }}>{money(p.amount)}</span></li>
            ))}
          </ul>
        )}
    </Card>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return <div className="flex justify-between border-b border-[#EEF2F6] py-2.5"><dt className="text-[#5A6B80]">{label}</dt><dd className="tabular-nums" style={{ color: NAVY }}>{value < 0 ? `− ${money(-value)}` : money(value)}</dd></div>
}
function Pair({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-[12px] text-[#5A6B80]">{label}</dt><dd className="font-semibold break-words" style={{ color: NAVY }}>{value}</dd></div>
}

/* ------------------------------------------------------------------ part 2 */

/**
 * THE STATEMENT, AS A PDF THE DEBTOR KEEPS. Drawn on the server (the collector's own statement, on the firm's
 * letterhead) and saved through fileSave.saveFile -- an ordinary download on a computer, the share sheet's "Save to
 * Files" on an iPhone -- because on a phone a PDF opened in the tab replaces the page and the debtor cannot get back.
 */
function Statement({ token }: { token: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* SAFARI'S SECOND TAP (fileSave.ts): drawing the statement can outlast the tap that asked for it, and then an iPhone
     will not open the share sheet. The file is kept and one more tap -- "Save ..." -- hands it over. */
  const [ready, setReady] = useState<{ blob: Blob; name: string } | null>(null)
  async function download() {
    setBusy(true); setError(null); setReady(null)
    try {
      const r = await fetchDebtorStatement(token)
      const blob = new Blob([Uint8Array.from(atob(r.pdf), (ch) => ch.charCodeAt(0))], { type: 'application/pdf' })
      if ((await saveFile(blob, r.fileName)) === 'needs-tap') setReady({ blob, name: r.fileName })
    } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }
  return (
    <Card>
      <Label>Your statement</Label>
      <p className="mt-1 text-[15px] text-[#5A6B80]">Every amount on your account in date order, on our letterhead.</p>
      <button type="button" onClick={download} disabled={busy} data-testid="debtor-statement"
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-3 text-base font-semibold disabled:opacity-50"
        style={{ borderColor: NAVY, color: NAVY }}>
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <><FileDown size={18} /> Download my statement (PDF)</>}
      </button>
      {ready && (
        <button type="button" onClick={() => { void saveFile(ready.blob, ready.name, { fromTap: true }).then(() => setReady(null)) }}
          className="mt-2 w-full rounded-lg px-4 py-3 text-base font-semibold text-white" style={{ background: NAVY }}>
          Save {ready.name}
        </button>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </Card>
  )
}

/**
 * SEND US YOUR PROOF OF PAYMENT. The slip is what matters; the amount and the day only help finance find the line on
 * the bank statement, so both are optional. Said plainly that it is not yet a payment -- a debtor who uploads a slip and
 * sees the balance unchanged must not think it went nowhere.
 */
function ProofOfPayment({ token }: { token: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [amount, setAmount] = useState('')
  const [paidOn, setPaidOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function send(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!file || !debtorPopFile(file.name)) { setError('Choose a PDF or a photo (JPG, PNG or HEIC) of your proof of payment.'); return }
    if (file.size > DEBTOR_POP_MAX_BYTES) { setError('That file is larger than 3 MB. A photo or a smaller PDF will do.'); return }
    setBusy(true)
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
        r.onerror = () => reject(new Error('The file could not be read. Please choose it again.'))
        r.readAsDataURL(file)
      })
      await sendDebtorProofOfPayment(token, { fileName: file.name, data, amount: amount || undefined, paidOn: paidOn || undefined })
      setDone(true)
    } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }

  if (done) {
    return (
      <Card>
        <Label>Proof of payment</Label>
        <p className="mt-1 text-[15px]" style={{ color: NAVY }} data-testid="debtor-pop-done">Thank you, we have it. We will check it against our bank account; the payment shows on this page once it is confirmed, usually within two working days.</p>
        <button type="button" onClick={() => { setDone(false); setFile(null); setAmount(''); setPaidOn('') }} className="mt-2 text-sm text-[#5A6B80] underline">Send another</button>
      </Card>
    )
  }
  return (
    <Card>
      <Label>Paid already? Send us your proof of payment</Label>
      <form onSubmit={send} className="mt-3 space-y-3" data-testid="debtor-pop">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[#AEBBCB] px-4 py-4 text-[15px] text-[#3F5F86]">
          <Upload size={18} /> {file ? file.name : 'Choose the PDF or a photo'}
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,application/pdf,image/*" className="sr-only" aria-label="Proof of payment file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm"><span className="mb-1 block text-[#5A6B80]">Amount (optional)</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="500" aria-label="Amount paid" className={field} />
          </label>
          <label className="block text-sm"><span className="mb-1 block text-[#5A6B80]">Date paid (optional)</span>
            <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} aria-label="Date paid" className={field} />
          </label>
        </div>
        <button type="submit" disabled={busy || !file} className={button} style={{ background: NAVY }}>
          {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : 'Send it'}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-700" data-testid="debtor-pop-error">{error}</p>}
    </Card>
  )
}

/* ------------------------------------------------------------------ part 3 */

const EVERY: Record<string, string> = { once_off: 'once-off', weekly: 'a week', monthly: 'a month' }

/**
 * MAKE AN ARRANGEMENT. Four states, and the page shows exactly one: an arrangement in force (say it, and how to
 * change it -- by calling), an offer waiting (say so), an offer declined (say why, and let them offer again), or
 * nothing yet (the form). The rules are checked as they type, with the same proposalProblem the server applies, so a
 * debtor learns "at least R 410 a month" before pressing Send rather than after.
 */
function ArrangementSection({ token, account, onSent }: { token: string; account: DebtorAccount; onSent: () => void }) {
  const [arrangement, setArrangement] = useState<Arrangement>('monthly')
  const [amount, setAmount] = useState('')
  const [firstDueOn, setFirstDueOn] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const s = account.summary
  const today = account.asAt

  if (account.live) {
    return (
      <Card>
        <Label>Your arrangement</Label>
        <p className="mt-1 text-[15px]" style={{ color: NAVY }} data-testid="debtor-live-arrangement">
          {money(account.live.amount)} {EVERY[account.live.arrangement] ?? ''}, next payment due {longDay(account.live.dueOn)}.
        </p>
        {account.live.missed && <p className="mt-2 text-sm text-red-700">A payment was missed. Please pay it now, or call us.</p>}
        <p className="mt-2 text-sm text-[#5A6B80]">To change your arrangement, please call us.</p>
      </Card>
    )
  }
  if (account.proposal?.status === 'pending') {
    const pr = account.proposal
    /* AN APPLICATION WAITS ON THE FORM FIRST: until the assessment is signed there is nothing for us to decide, and the
       debtor is the only one who can move it -- so the button to it is the first thing they see. */
    const formOpen = pr.needsAssessment && pr.assessment && pr.assessment.state !== 'signed'
    return (
      <Card>
        <Label>{pr.needsAssessment ? 'Your application' : 'Your offer'}</Label>
        <p className="mt-1 text-[15px]" style={{ color: NAVY }} data-testid="debtor-offer-pending">
          We have your {pr.needsAssessment ? 'application' : 'offer'} of {money(pr.amount)} {EVERY[pr.arrangement] ?? ''} from {longDay(pr.firstDueOn)}.
          {formOpen ? ' Please fill in and sign the affordability assessment so we can look at it.' : ' One of our team will look at it and reply, usually within one working day.'}
        </p>
        {formOpen && (
          <a href={pr.assessment!.link} className={`${button} mt-3 block text-center`} style={{ background: NAVY }} data-testid="debtor-assessment-link">
            Fill in my affordability assessment
          </a>
        )}
        {pr.needsAssessment && !pr.assessment && <p className="mt-2 text-sm text-[#5A6B80]">We will email you the affordability assessment to fill in.</p>}
      </Card>
    )
  }

  /* A once-off is the settlement figure, shown rather than typed (Stephan, 4 Nov); the server records its own. */
  const onceOff = arrangement === 'once_off'
  const value = onceOff ? s.settleToday : Number(amount.replace(/[^\d.,]/g, '').replace(',', '.'))
  const offer = { arrangement, amount: value, firstDueOn }
  const typed = (onceOff || amount.trim() !== '') && firstDueOn !== ''
  const problem = typed ? proposalProblem(offer, { balance: s.balance, settlement: s.settleToday }, today) : null
  const application = typed && !problem && needsApplication(offer, s.settleToday)

  async function send(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const p = proposalProblem(offer, { balance: s.balance, settlement: s.settleToday }, today)
    if (p) { setError(p); return }
    setBusy(true)
    try {
      const r = await proposeDebtorArrangement(token, { arrangement, amount: onceOff ? String(s.settleToday) : amount, firstDueOn, note: note.trim() || undefined })
      /* Straight on to the form, in this tab: it is the next thing they have to do, and the portal is a tap back. */
      if (r.assessmentLink) { window.location.assign(r.assessmentLink); return }
      onSent()
    }
    catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }

  return (
    <Card>
      <Label>Make an arrangement</Label>
      {account.proposal?.status === 'declined' && (
        <p className="mt-2 rounded-lg bg-[#FBF6EC] p-3 text-sm" style={{ color: NAVY }} data-testid="debtor-offer-declined">
          We could not accept your last offer: {account.proposal.declineReason}. You can make another below, or call us.
        </p>
      )}
      <p className="mt-1 text-[15px] text-[#5A6B80]">Tell us what you can pay. One of our team will look at it and reply; nothing is agreed until we do.</p>
      <form onSubmit={send} className="mt-3 space-y-3" data-testid="debtor-propose">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#F2F5F8] p-1" role="radiogroup" aria-label="How often">
          {(['once_off', 'weekly', 'monthly'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={arrangement === k} onClick={() => setArrangement(k)}
              className={`rounded-md px-2 py-2 text-sm font-medium ${arrangement === k ? 'bg-white shadow-sm' : 'text-[#5A6B80]'}`}
              style={arrangement === k ? { color: NAVY } : undefined}>
              {k === 'once_off' ? 'Once-off' : k === 'weekly' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {onceOff
            ? (
              <div className="text-sm"><span className="mb-1 block text-[#5A6B80]">To settle in full</span>
                <p className="rounded-[10px] border border-[#D5DBE3] bg-[#F7F9FB] px-3 py-2.5 text-[15px] font-semibold tabular-nums" style={{ color: NAVY }} data-testid="debtor-once-off-amount">{money(s.settleToday)}</p>
              </div>
            )
            : (
              <label className="block text-sm"><span className="mb-1 block text-[#5A6B80]">{arrangement === 'weekly' ? 'Each week' : 'Each month'}</span>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="500" aria-label="Amount you can pay" className={field} />
              </label>
            )}
          <label className="block text-sm"><span className="mb-1 block text-[#5A6B80]">{arrangement === 'once_off' ? 'On' : 'First payment'}</span>
            <input type="date" value={firstDueOn} onChange={(e) => setFirstDueOn(e.target.value)} min={today} aria-label="First payment date" className={field} />
          </label>
        </div>
        <label className="block text-sm"><span className="mb-1 block text-[#5A6B80]">Anything we should know (optional)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} aria-label="Note" className={field} />
        </label>
        {typed && !problem && <p className="text-sm" style={{ color: NAVY }} data-testid="debtor-offer-summary">{proposalSummary(offer, s.settleToday)}.</p>}
        {onceOff && firstDueOn && !problem && (
          <p className={`rounded-lg p-3 text-sm ${settlementHolds(firstDueOn, today) ? 'bg-[#F2F5F8]' : 'bg-[#FBF6EC]'}`} style={{ color: NAVY }} data-testid="debtor-once-off-note">
            {onceOffNote(firstDueOn, today, s.settleToday)}
          </p>
        )}
        {application && <p className="rounded-lg bg-[#FBF6EC] p-3 text-sm" style={{ color: NAVY }} data-testid="debtor-offer-application">{applicationNote(offer, s.settleToday)}</p>}
        {typed && problem && <p className="text-sm text-red-700" data-testid="debtor-offer-problem">{problem}</p>}
        <button type="submit" disabled={busy || !typed || !!problem} className={button} style={{ background: NAVY }}>
          {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : application ? 'Send my application' : 'Send my offer'}
        </button>
        <p className="text-xs text-[#5A6B80]">The first payment must be within {PROPOSAL_RULES.firstPaymentWithinDays} days. Instalments that take longer than {PROPOSAL_RULES.longestMonths} months to settle the account are an application, with a short form about your income and expenses.</p>
      </form>
      {error && <p className="mt-2 text-sm text-red-700" data-testid="debtor-propose-error">{error}</p>}
    </Card>
  )
}

/* ------------------------------------------------------------------ part 4 */

/**
 * SOMETHING WRONG, OR A QUESTION? Two different things, chosen first, because they do different things: a dispute is
 * a formal step -- collection is paused until the firm answers it, and the page says so before they send -- and a
 * question is a conversation. Below both, what they have already raised and whether it is still open.
 */
function Tickets({ token, account, onSent }: { token: string; account: DebtorAccount; onSent: () => void }) {
  const [mode, setMode] = useState<'dispute' | 'question'>('question')
  const [reason, setReason] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const openDispute = account.tickets.some((t) => t.kind === 'dispute' && t.open)

  async function send(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const check = mode === 'dispute' ? debtorDispute({ reason, text }) : debtorQuestion({ text })
    if (!check.ok) { setError(check.error); return }
    setBusy(true)
    try {
      const r = mode === 'dispute' ? await raiseDebtorDispute(token, { reason, text }) : await askDebtorQuestion(token, text)
      setSent(mode === 'dispute'
        ? `We have your dispute${r.ticketNo ? ` (reference ${r.ticketNo})` : ''}. Collection is paused while we look into it, and we will reply in writing.`
        : `We have your question${r.ticketNo ? ` (reference ${r.ticketNo})` : ''} and will reply, usually within one working day.`)
      setReason(''); setText('')
      onSent()
    } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }

  return (
    <Card>
      <Label>Something wrong, or a question?</Label>
      {sent ? (
        <div className="mt-2">
          <p className="text-[15px]" style={{ color: NAVY }} data-testid="debtor-ticket-sent">{sent}</p>
          <button type="button" onClick={() => setSent(null)} className="mt-2 text-sm text-[#5A6B80] underline">Send something else</button>
        </div>
      ) : (
        <form onSubmit={send} className="mt-3 space-y-3" data-testid="debtor-ticket">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#F2F5F8] p-1" role="radiogroup" aria-label="What is it">
            {(['question', 'dispute'] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => { setMode(k); setError(null) }}
                className={`rounded-md px-2 py-2 text-sm font-medium ${mode === k ? 'bg-white shadow-sm' : 'text-[#5A6B80]'}`}
                style={mode === k ? { color: NAVY } : undefined}>
                {k === 'question' ? 'Ask a question' : 'I dispute this account'}
              </button>
            ))}
          </div>
          {mode === 'dispute' && openDispute && (
            <p className="rounded-lg bg-[#FBF6EC] p-3 text-sm" style={{ color: NAVY }}>You already have an open dispute on this account. To add to it, ask a question instead and we will add it to that dispute.</p>
          )}
          {mode === 'dispute' && !openDispute && (
            <>
              <p className="text-sm text-[#5A6B80]">A dispute says the debt, or part of it, is wrong. We pause collecting while we look into it, and reply in writing. If you only want to know something, ask a question instead.</p>
              <label className="block text-sm"><span className="mb-1 block text-[#5A6B80]">Why do you dispute it?</span>
                <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Why do you dispute it" className={field}>
                  <option value="">Choose…</option>
                  {DEBTOR_DISPUTE_REASONS.map((r) => <option key={r.label} value={r.label}>{r.label}</option>)}
                </select>
              </label>
            </>
          )}
          {!(mode === 'dispute' && openDispute) && (
            <>
              <label className="block text-sm"><span className="mb-1 block text-[#5A6B80]">{mode === 'dispute' ? 'What is wrong?' : 'Your question'}</span>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000}
                  aria-label={mode === 'dispute' ? 'What is wrong' : 'Your question'} className={field} />
              </label>
              <button type="submit" disabled={busy} className={button} style={{ background: NAVY }}>
                {busy ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : mode === 'dispute' ? 'Send my dispute' : 'Send my question'}
              </button>
            </>
          )}
        </form>
      )}
      {error && <p className="mt-2 text-sm text-red-700" data-testid="debtor-ticket-error">{error}</p>}
      {account.tickets.length > 0 && (
        <ul className="mt-4 divide-y divide-[#EEF2F6] text-sm" data-testid="debtor-tickets">
          {account.tickets.map((t, i) => (
            <li key={`${t.no ?? i}`} className="flex items-start justify-between gap-3 py-2">
              <span className="text-[#1B2B3E]">{t.kind === 'dispute' ? 'Dispute' : 'Question'}{t.no ? ` ${t.no}` : ''} · {longDay(t.raisedOn)}
                <span className="block text-[#5A6B80]">{t.about}</span></span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${t.open ? 'bg-[#FBF6EC] text-[#8A6A2B]' : 'bg-[#EEF2F6] text-[#5A6B80]'}`}>{t.open ? 'Open' : 'Closed'}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
