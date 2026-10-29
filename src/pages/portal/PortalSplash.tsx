import { useEffect, useRef, useState } from 'react'
import { playSplashSound } from './portalSound'

/**
 * THE PORTAL'S OPENING (S16, Raptor · Handover 15). Stephan, of the plain navy screen with the wordmark that a
 * client saw while the portal opened: "make it linger a little bit longer and then use our logo and have some sort
 * of epic cool animation ... Like PlayStation 2 vibes login."
 *
 * Deep navy space with drifting lights and soft pillars of light rising out of the floor; the gold BF circle draws
 * itself, the monogram flares in on the chord, the wordmark opens out from the middle with a light passing over it,
 * then "Client portal" in gold -- and the page fades in. About three and a half seconds, and the sound
 * (portalSound.ts) is timed to it.
 *
 * ONCE PER VISIT, AND NEVER IN THE WAY. The full opening plays the first time in a tab; after that (a reload, a
 * second look) it is a short fade and no sound, because a ritual on every refresh is a wait. A tap skips it once
 * the portal has what it needs. Reduced motion (the system setting) gets the logo, still, and no sound. It never
 * holds the portal past its own length: it waits for `ready` only because there is nothing to show before then.
 */
const SEEN = 'raptor.portal.opened'
const FULL_MS = 3400
const SHORT_MS = 700

/* Fixed, so the stars do not jump between renders: x%, y%, size px, delay s, duration s. */
const LIGHTS = Array.from({ length: 34 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1
  return { x: r(1) * 100, y: r(2) * 100, size: 1 + r(3) * 2.6, delay: r(4) * 3, dur: 5 + r(5) * 6 }
})
const PILLARS = [8, 19, 31, 44, 57, 69, 81, 92].map((x, i) => ({ x, h: 26 + ((i * 37) % 40), delay: 0.15 * i }))

export function PortalSplash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const [full] = useState(() => {
    try { return sessionStorage.getItem(SEEN) !== '1' } catch { return true }
  })
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const epic = full && !reduced
  const [minDone, setMinDone] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const done = useRef(false)

  useEffect(() => {
    try { sessionStorage.setItem(SEEN, '1') } catch { /* this tab only */ }
    if (epic) playSplashSound()
    const t = setTimeout(() => setMinDone(true), epic ? FULL_MS : reduced ? 300 : SHORT_MS)
    return () => clearTimeout(t)
  }, [epic, reduced])

  useEffect(() => {
    if (!(minDone && ready) || done.current) return
    setLeaving(true)
    const t = setTimeout(() => { done.current = true; onDone() }, 550)
    return () => clearTimeout(t)
  }, [minDone, ready, onDone])

  return (
    <div className={`portal-splash ${epic ? 'is-epic' : 'is-short'} ${leaving ? 'is-leaving' : ''}`} data-splash={epic ? 'full' : 'short'} onClick={() => { if (ready) setMinDone(true) }} role="presentation">
      <div className="portal-splash-glow" />
      {epic && (
        <div aria-hidden className="absolute inset-0 overflow-hidden">
          {LIGHTS.map((l, i) => (
            <span key={i} className="portal-splash-light"
              style={{ left: `${l.x}%`, top: `${l.y}%`, width: l.size, height: l.size, animationDelay: `${l.delay}s`, animationDuration: `${l.dur}s` }} />
          ))}
          {PILLARS.map((p, i) => (
            <span key={i} className="portal-splash-pillar" style={{ left: `${p.x}%`, height: `${p.h}%`, animationDelay: `${p.delay}s` }} />
          ))}
          <span className="portal-splash-flare" />
        </div>
      )}
      <div className="relative flex flex-col items-center" data-testid="portal-splash">
        <div className="portal-splash-mark">
          {epic && (
            <svg aria-hidden className="portal-splash-ring" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="54" fill="none" stroke="#C69F54" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          )}
          <img src="/brand/icon-light.svg" alt="" className="portal-splash-monogram" />
        </div>
        <div className="portal-splash-word">
          <img src="/brand/wordmark-light.svg" alt="Bredell Ferreira" className="h-[18px] sm:h-[22px] w-auto" />
          {epic && <span aria-hidden className="portal-splash-sweep" />}
        </div>
        <p className="portal-splash-label">Client portal</p>
      </div>
    </div>
  )
}
