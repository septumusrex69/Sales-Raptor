import { useSyncExternalStore } from 'react'
import { fetchPortalDayLook, reportPortalPhotoFailure } from '../../lib/portalApi'
import { LLANDUDNO_LOOK, lookFromRow, photoCredit, portalPhotoProbe, type DayLook } from '../../lib/portalPhotos'

/**
 * WHAT THE CLIENT PORTAL AND THE DEBTOR PORTAL SHARE (Raptor H16, 3 Nov). Stephan, of the debtor portal: "Make the
 * debtors login portal look like the client portal. Use the same skins, the same stuff ... It's exactly the same,
 * except when it's a client, it's a debtor." So the day's look, its line, the photographer's credit, the colours, the
 * faces and the field live here ONCE, moved out of PortalPage unchanged, and both portals import them -- two copies of
 * "the same" drift the first time one of them is touched.
 */

export const C = { navy: '#101F2C', slate: '#46607B', light: '#97B4CC', gold: '#C69F54', off: '#F4F4F4' }
export const HEAD = "'Raleway Variable', 'Raleway', 'Poppins', sans-serif"
export const BODY = "'Open Sans Variable', 'Open Sans', sans-serif"
/** Where "Need help signing in?" writes to: the firm's own address, as on every remittance advice. */
export const SUPPORT = 'mailto:info@bredellferreira.co.za?subject=Client%20portal%20sign-in'

/* An input with its icon. Out here, not inside SignIn: a component defined in a render is a new component every
   render, and React would rebuild the input under the client's fingers on every keystroke. */
export function Field({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" style={{ color: C.slate }}>{icon}</span>
      {children}
    </div>
  )
}

/*
 * TODAY'S LOOK: the photograph, its framing, the side the words sit and the line -- as an Administrator approved it for
 * today at /portal-looks (Stephan, 31 Oct: "pre-choose everything and approve it ... for the month"), or Llandudno
 * where nobody did. Held here and shared by every part of the page that draws it.
 */
let currentLook: DayLook = LLANDUDNO_LOOK
const lookListeners = new Set<() => void>()
let lookAsked = false
export function loadPortalLook() {
  if (lookAsked) return
  lookAsked = true
  fetchPortalDayLook()
    .then(({ row }) => { currentLook = lookFromRow(row); lookListeners.forEach((f) => f()); probeTodaysPhoto() })
    .catch(() => { /* Llandudno stays */ })
}
export function usePortalLook(): DayLook {
  return useSyncExternalStore((f) => { lookListeners.add(f); return () => lookListeners.delete(f) }, () => currentLook, () => currentLook)
}

/*
 * IF UNSPLASH CANNOT SERVE IT, SAY SO (Stephan, 31 Oct: "ping me and tell me when Unsplash is off ... a notification
 * ... any administrator's dashboard"). The portal already falls back to Llandudno by itself; this is so somebody KNOWS.
 * Once per tab, a tiny copy of the day's photograph is asked for; if it does not come, the server is told, checks for
 * itself and rings every Administrator -- once a day, however many clients notice.
 */
let photoProbed = false
function probeTodaysPhoto() {
  if (photoProbed || typeof Image === 'undefined') return
  photoProbed = true
  const p = currentLook.photo
  /* The app's own copy needs nobody's server. */
  if (p.local) return
  const img = new Image()
  const timer = setTimeout(() => { img.src = ''; report() }, 10_000)
  function report() { void reportPortalPhotoFailure(p.id).catch(() => {}) }
  img.onload = () => clearTimeout(timer)
  img.onerror = () => { clearTimeout(timer); report() }
  img.src = portalPhotoProbe(p)
}

/* THE DAY'S LINE, with the day's photograph (portalPhotos.ts): a quote from somebody worth quoting, or a line of the
   firm's own about the place in the picture. Quiet: a thin gold rule, italic, smaller than the words around it. */
export function DayLine({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  const p = usePortalLook()
  return (
    <figure className={`${className} border-l-2 border-[#C69F54] pl-3`} data-testid="portal-day-line">
      <blockquote className={`italic text-white/90 [text-shadow:0_1px_8px_rgba(16,31,44,0.55)] ${compact ? 'text-[13px]' : 'text-[15px]'}`}>“{p.line}”</blockquote>
      {p.who && <figcaption className={`mt-1 text-[#C69F54] ${compact ? 'text-[11px]' : 'text-xs'}`}>{p.who}</figcaption>}
    </figure>
  )
}

/* The photographer's credit (Unsplash asks for it): small, in a corner of the photograph, never in the way. */
export function PhotoCredit({ className = 'absolute right-3 bottom-2' }: { className?: string }) {
  const credit = photoCredit(usePortalLook().photo)
  return (
    <p className={`${className} text-[10px] text-white/55`} data-testid="portal-photo-credit">
      Photo: <a href={credit.profile} target="_blank" rel="noreferrer" className="hover:text-white underline-offset-2 hover:underline">{credit.name}</a>
      {' '}on <a href={credit.unsplash} target="_blank" rel="noreferrer" className="hover:text-white underline-offset-2 hover:underline">Unsplash</a>
    </p>
  )
}

