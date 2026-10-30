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
 * well"). `circle` is the one above, `coast` and `towers` the two made after it, on the
 * same three-and-a-half-second clock with their own sound, and /portal/opening plays any of them on demand. The portal
 * plays `towers` (Stephan, 30 Oct: "Do number three").
 *
 * ON EVERY SIGN-IN, AND NEVER IN THE WAY. The full opening plays whenever somebody signs in (`fresh`), and the first
 * time a tab opens the portal; a reload of a portal already signed in is a short fade and no sound, because a ritual
 * on every refresh is a wait. It was once per TAB until 30 Oct, and Stephan, testing all day in one Safari tab, only
 * ever saw the fade: "The loading does no animation." Signing in is the moment it is for. A tap skips it once
 * the portal has what it needs. Reduced motion (the system setting) gets the logo, still, and no sound. It never
 * holds the portal past its own length: it waits for `ready` only because there is nothing to show before then.
 * `force` (the replay page only) plays the full opening regardless of all three.
 */
export type SplashVariant = 'circle' | 'coast' | 'towers' | 'arcs'

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
/*
 * THE ARCS (variant 4, 30 Oct). Stephan, of the sidebar foot's gold sweep and open rings: "this theme that you did,
 * this looks fucking cool. Maybe it can draw like the circles and like stuff like that." So the sweeps draw themselves
 * across the screen, open rings in the shape of the BF circle draw out around the mark and turn slowly against each
 * other, and the monogram settles inside them.
 */
const SWEEPS = [
  { d: 'M -100 230 C 420 300, 980 560, 1700 1040', o: 0.85, w: 1.6, delay: 0.1 },
  { d: 'M -100 290 C 420 360, 980 620, 1700 1100', o: 0.3, w: 1.1, delay: 0.25 },
  { d: 'M 1700 120 C 1180 210, 640 470, -100 900', o: 0.55, w: 1.3, delay: 0.4 },
  { d: 'M 1700 60 C 1180 150, 640 410, -100 840', o: 0.22, w: 1, delay: 0.55 },
]
const RINGS = [
  { r: 96, o: 0.9, w: 1.6, arc: 0.86, turn: -100, gold: true, delay: 0.35 },
  { r: 140, o: 0.45, w: 1.1, arc: 0.7, turn: 40, gold: false, delay: 0.5 },
  { r: 196, o: 0.55, w: 1.2, arc: 0.78, turn: 160, gold: true, delay: 0.65 },
  { r: 270, o: 0.25, w: 1, arc: 0.62, turn: -30, gold: false, delay: 0.8 },
  { r: 370, o: 0.3, w: 1, arc: 0.7, turn: 95, gold: true, delay: 0.95 },
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
  if (variant === 'arcs') return (
    <div className="arcs-mark">
      <svg aria-hidden className="arcs-rings" viewBox="-450 -450 900 900" fill="none">
        {RINGS.map((g, i) => (
          <g key={i} className={`arcs-ring-turn ${i % 2 ? 'is-back' : ''}`}>
            <circle r={g.r} pathLength={1} transform={`rotate(${g.turn})`} stroke={g.gold ? '#C69F54' : '#97B4CC'} strokeOpacity={g.o} strokeWidth={g.w}
              strokeLinecap="round" className="arcs-ring" style={{ strokeDasharray: `${g.arc} 1`, ['--arc' as string]: g.arc, animationDelay: `${g.delay}s` }} />
          </g>
        ))}
      </svg>
      {monogram}
    </div>
  )
  return (
    <div className="portal-splash-mark">
      <svg aria-hidden className="portal-splash-ring" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="54" fill="none" stroke="#C69F54" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {monogram}
    </div>
  )
}

export function PortalSplash({ ready, onDone, variant = 'circle', force = false, fresh = false }: {
  ready: boolean
  onDone: () => void
  variant?: SplashVariant
  force?: boolean
  /** Straight after a sign-in: the full opening whatever this tab has seen. Reduced motion still wins. */
  fresh?: boolean
}) {
  const [full] = useState(() => {
    if (force || fresh) return true
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
      {epic && look === 'arcs' && (
        <svg aria-hidden className="arcs-sweeps" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" fill="none">
          {SWEEPS.map((w, i) => (
            <path key={i} d={w.d} pathLength={1} stroke="#C69F54" strokeOpacity={w.o} strokeWidth={w.w} className="arcs-sweep" style={{ animationDelay: `${w.delay}s` }} />
          ))}
        </svg>
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
