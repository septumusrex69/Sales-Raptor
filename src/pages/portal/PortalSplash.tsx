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
 * THREE TO CHOOSE FROM (30 Oct: "give me a link where I can replay it ... and just make two different ones as
 * well"). `circle` is the one above and the one the portal plays; `coast` and `towers` are the alternatives, on the
 * same three-and-a-half-second clock with their own sound, and /portal/opening plays any of them on demand. Until
 * Stephan picks, the portal keeps `circle`.
 *
 * ONCE PER VISIT, AND NEVER IN THE WAY. The full opening plays the first time in a tab; after that (a reload, a
 * second look) it is a short fade and no sound, because a ritual on every refresh is a wait. A tap skips it once
 * the portal has what it needs. Reduced motion (the system setting) gets the logo, still, and no sound. It never
 * holds the portal past its own length: it waits for `ready` only because there is nothing to show before then.
 * `force` (the replay page only) plays the full opening regardless of all three.
 */
export type SplashVariant = 'circle' | 'coast' | 'towers'

const SEEN = 'raptor.portal.opened'
const FULL_MS = 3400
const SHORT_MS = 700

/* Fixed, so the stars do not jump between renders: x%, y%, size px, delay s, duration s. */
const LIGHTS = Array.from({ length: 34 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1
  return { x: r(1) * 100, y: r(2) * 100, size: 1 + r(3) * 2.6, delay: r(4) * 3, dur: 5 + r(5) * 6 }
})
const PILLARS = [8, 19, 31, 44, 57, 69, 81, 92].map((x, i) => ({ x, h: 26 + ((i * 37) % 40), delay: 0.15 * i }))
/* The towers: a far row (small, high on the floor) and a near row (large, low), staggered as they rise. */
const TOWERS = [
  ...[6, 15, 24, 33, 64, 73, 82, 91].map((x, i) => ({ x, bottom: 34, w: 2.2, h: 10 + ((i * 29) % 16), delay: 0.25 + i * 0.07, far: true })),
  ...[2, 13, 26, 70, 84, 95].map((x, i) => ({ x, bottom: 8, w: 4.2, h: 22 + ((i * 41) % 26), delay: 0.1 + i * 0.09, far: false })),
]
const WAVES = [8, 18, 30, 44, 60].map((y, i) => ({ y, w: 30 + ((i * 23) % 40), delay: 1.0 + i * 0.12 }))

function Mark({ variant }: { variant: SplashVariant }) {
  const monogram = <img src="/brand/icon-light.svg" alt="" className="portal-splash-monogram" />
  if (variant === 'coast') return (
    <div className="tide-mark">
      <span aria-hidden className="tide-sun" />
      <div className="tide-rise">{monogram}</div>
      <span aria-hidden className="tide-horizon" />
      <div aria-hidden className="tide-sea">
        <img src="/brand/icon-light.svg" alt="" className="tide-reflection" />
        {WAVES.map((w, i) => <span key={i} className="tide-wave" style={{ top: `${w.y}%`, width: `${w.w}vw`, animationDelay: `${w.delay}s` }} />)}
      </div>
    </div>
  )
  if (variant === 'towers') return <div className="ps2-mark">{monogram}</div>
  return (
    <div className="portal-splash-mark">
      <svg aria-hidden className="portal-splash-ring" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="54" fill="none" stroke="#C69F54" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {monogram}
    </div>
  )
}

export function PortalSplash({ ready, onDone, variant = 'circle', force = false }: {
  ready: boolean
  onDone: () => void
  variant?: SplashVariant
  force?: boolean
}) {
  const [full] = useState(() => {
    if (force) return true
    try { return sessionStorage.getItem(SEEN) !== '1' } catch { return true }
  })
  const reduced = !force && typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const epic = full && !reduced
  const [minDone, setMinDone] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const done = useRef(false)

  useEffect(() => {
    if (!force) try { sessionStorage.setItem(SEEN, '1') } catch { /* this tab only */ }
    if (epic) playSplashSound(variant)
    const t = setTimeout(() => setMinDone(true), epic ? FULL_MS : reduced ? 300 : SHORT_MS)
    return () => clearTimeout(t)
  }, [epic, reduced, force, variant])

  useEffect(() => {
    if (!(minDone && ready) || done.current) return
    setLeaving(true)
    const t = setTimeout(() => { done.current = true; onDone() }, 550)
    return () => clearTimeout(t)
  }, [minDone, ready, onDone])

  const look = epic ? variant : 'circle'
  return (
    <div className={`portal-splash ${epic ? 'is-epic' : 'is-short'} is-${look} ${leaving ? 'is-leaving' : ''}`}
      data-splash={epic ? 'full' : 'short'} data-variant={look} onClick={() => { if (ready) setMinDone(true) }} role="presentation">
      <div className="portal-splash-glow" />
      {epic && look === 'circle' && (
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
      {epic && look === 'coast' && (
        <div aria-hidden className="absolute inset-0 overflow-hidden">
          {LIGHTS.slice(0, 18).map((l, i) => (
            <span key={i} className="portal-splash-light" style={{ left: `${l.x}%`, top: `${l.y * 0.45}%`, width: l.size, height: l.size, animationDelay: `${l.delay}s`, animationDuration: `${l.dur}s` }} />
          ))}
        </div>
      )}
      {epic && look === 'towers' && (
        <div aria-hidden className="ps2-stage">
          <div className="ps2-floor" />
          {TOWERS.map((t, i) => (
            <span key={i} className={`ps2-tower ${t.far ? 'is-far' : ''}`}
              style={{ left: `${t.x}%`, bottom: `${t.bottom}%`, width: `${t.w}vw`, height: `${t.h}vh`, animationDelay: `${t.delay}s` }} />
          ))}
          <span className="ps2-burst" />
          <span className="ps2-burst is-second" />
        </div>
      )}
      <div className="relative flex flex-col items-center" data-testid="portal-splash">
        {epic ? <Mark variant={look} /> : (
          <div className="portal-splash-mark"><img src="/brand/icon-light.svg" alt="" className="portal-splash-monogram" /></div>
        )}
        <div className="portal-splash-word">
          <img src="/brand/wordmark-light.svg" alt="Bredell Ferreira" className="h-[18px] sm:h-[22px] w-auto" />
          {epic && look !== 'coast' && <span aria-hidden className="portal-splash-sweep" />}
        </div>
        <p className="portal-splash-label">Client portal</p>
      </div>
    </div>
  )
}
