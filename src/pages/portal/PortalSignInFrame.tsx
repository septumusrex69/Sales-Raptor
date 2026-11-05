import type { ReactNode } from 'react'
import { ArrowRight, Headphones, Lock } from 'lucide-react'
import { portalPhotoLayer, signinBackground } from '../../lib/portalPhotos'
import { BODY, C, DayLine, HEAD, PhotoCredit, usePortalLook } from './portalLook'

/**
 * THE PORTALS' DOOR, DRAWN ONCE (Raptor H16, 3 Nov). Moved out of PortalPage's sign-in unchanged, so the debtor
 * portal's door is the client portal's door -- Stephan: "look at the client login portal versus the debtors login
 * portal. Make the debtors login portal look like the client portal ... It's exactly the same, except when it's a
 * client, it's a debtor." What differs is words, passed in: who it is for, the promise, the door's title and its intro,
 * and where "Need help signing in?" goes. The forms are the caller's.
 *
 * THE DESIGN IS STEPHAN'S BRIEF (29 Oct, with a mock-up): a split screen in a rounded frame -- the day's photograph on
 * the left with the BF ring and wordmark, the promise at its foot over a gold rule and the day's line; a warm white
 * panel on the right with fine gold curves, the secure label, the fields, and a way to reach the firm. Raleway for
 * headings and the tracked labels, Open Sans for the rest; navy, slate, light blue and gold.
 */
export function PortalSignInFrame({ kicker, promise, blurb, secure, title, intro, support, children }: {
  /** "Client portal" / "Your account" -- the gold label above the promise. */
  kicker: string
  promise: string
  blurb: string
  /** "Secure client portal" / "Secure account portal". */
  secure: string
  title: string
  intro: ReactNode
  support: { href: string; title: string; sub: string }
  children: ReactNode
}) {
  const look = usePortalLook()
  const label = 'text-[11px] font-bold uppercase tracking-[0.24em]'
  return (
    <div className="relative min-h-screen overflow-hidden lg:flex lg:items-center lg:justify-center lg:p-8" data-testid="portal-page"
      style={{ fontFamily: BODY, background: C.off }}>
      {/* THE ROOM AROUND THE FRAME: the same photograph, softened -- a background, so a phone never fetches it twice. */}
      <div aria-hidden className="hidden lg:block absolute inset-0 scale-110 blur-2xl opacity-60"
        style={{ background: portalPhotoLayer(look.photo, 1200) }} />
      <div className="relative w-full min-h-screen lg:max-w-[1360px] lg:min-h-[640px] lg:h-[min(860px,calc(100vh-4rem))] lg:rounded-[24px] lg:overflow-hidden
        lg:shadow-[0_30px_80px_-20px_rgba(16,31,44,0.45)] lg:ring-1 lg:ring-white/40 flex flex-col lg:grid lg:grid-cols-[58fr_42fr] bg-[#FBFAF7]">
        {/* LEFT: THE PHOTOGRAPH, THE MARK, THE PROMISE. */}
        <div className="relative text-white flex flex-col justify-between p-6 sm:p-10 lg:p-14 min-h-[300px] sm:min-h-[380px] lg:min-h-0"
          data-testid="portal-sign-in-photo" style={{ background: signinBackground(look) }}>
          <div className="flex items-center gap-3.5" data-testid="portal-sign-in-logo">
            <img src="/brand/icon-light.svg" alt="" className="h-14 w-14 sm:h-20 sm:w-20" />
            <img src="/brand/wordmark-light.svg" alt="Bredell Ferreira" className="h-3.5 sm:h-[18px] w-auto" />
          </div>
          <div className="mt-10 max-w-xl">
            <p className={label} style={{ color: C.gold, fontFamily: HEAD }}>{kicker}</p>
            <h2 className="mt-3 text-[30px] sm:text-[40px] lg:text-[46px] leading-[1.12] font-bold" style={{ fontFamily: HEAD }}>{promise}</h2>
            <div className="mt-6 h-[2px] w-16 rounded" style={{ background: C.gold }} />
            <p className="mt-5 text-[15px] sm:text-base leading-relaxed text-white/85 max-w-lg">{blurb}</p>
            <DayLine className="mt-8 max-w-lg" />
          </div>
          <PhotoCredit />
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
            <Lock size={14} /> {secure}
          </p>

          <div className="relative flex-1 flex flex-col justify-center w-full max-w-[420px] mx-auto py-10" data-testid="portal-sign-in">
            <h1 className="text-[36px] sm:text-[42px] font-bold leading-tight" style={{ color: C.navy, fontFamily: HEAD }}>{title}</h1>
            <p className="mt-2 mb-8 text-[15px] leading-relaxed" style={{ color: C.slate }}>{intro}</p>
            {children}
          </div>

          <a href={support.href} className="relative mx-auto w-full max-w-[420px] flex items-center gap-4 group" data-testid="portal-support">
            <span className="h-12 w-12 shrink-0 rounded-full flex items-center justify-center" style={{ background: '#F1ECE1', color: C.navy }}><Headphones size={20} /></span>
            <span className="h-10 w-px" style={{ background: '#DCE3EA' }} />
            <span>
              <span className="block text-[15px] font-semibold" style={{ color: C.navy }}>{support.title}</span>
              <span className="flex items-center gap-1.5 text-sm group-hover:underline" style={{ color: C.slate }}>{support.sub} <ArrowRight size={14} /></span>
            </span>
          </a>
        </div>
      </div>
    </div>
  )
}

/** The door's field, button and link styles -- the client portal's, shared so a debtor's fields are the same fields. */
export const DOOR = {
  field: 'w-full rounded-[13px] border bg-white pl-11 pr-4 py-3 text-[15px] placeholder:text-[#97B4CC] focus:outline-none focus:ring-2 focus:ring-[#C69F54]/40 focus:border-[#C69F54]/70',
  fieldStyle: { borderColor: '#DCE3EA', color: C.navy },
  primary: 'w-full rounded-[13px] py-3.5 text-[15px] font-semibold text-white flex items-center justify-center gap-2 shadow-sm hover:brightness-125 disabled:opacity-80 disabled:cursor-not-allowed transition',
  link: 'font-semibold underline-offset-4 hover:underline',
} as const
