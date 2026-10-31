import { useEffect, useRef, useState } from 'react'
import { playRaptorSound } from './raptorSound'
import './raptorOpening.css'

/**
 * RAPTOR'S OWN OPENING, AFTER A SIGN-IN (S16, Raptor · Handover 15). Stephan, having picked the portal's opening:
 * "Now for the Raptor login, let's also try and make three type of ones when it's loading and opening ... with the
 * Raptor theme and everything." Until then Raptor opened on a grey "Loading…".
 *
 * NOT BREDELL FERREIRA'S COLOURS (30 Oct). The first three were the portal's navy and gold, and Stephan: "remember the
 * Raptors colors are different ... it's not like blue ... it looks too much like Bredell Ferreira's ... For the client
 * portal, it's fine ... for this one, not." Raptor's own palette is its photograph -- the mountain at dawn: graphite
 * rock, storm cloud, snow white and an ember-copper sunburst -- and its subject is the bird: "something like a bird".
 * The gold wing is the one thing they share. Each has its own sound (raptorSound.ts): wind, wingbeats, deep drums
 * and a low horn -- nothing of the portal's.
 *
 *   lock    -- a hawk's-eye reticle in ember on graphite: ticks and rings turning, brackets closing, the lock, a
 *              white-hot flash, the wing in the sights, the name typed out, "Raptor online". Stephan liked it.
 *   dive    -- the stoop: falling through cloud, the wing diving in from high right on an ember trail, a burst of
 *              feathers drifting down as it lands, the name sliding out from behind it.
 *   summit  -- Raptor's own photograph: out of the dark the sun flares over the peak, the wing glides across it, the
 *              name settles beneath.
 *
 * /opening plays any of them on demand; the sign-in plays LOCK-ON (RAPTOR_OPENING_DEFAULT). It covers the app as it
 * loads underneath and dissolves into it; a tap skips it; Reduced motion gets the still mark (unless `force`, the
 * replay page). It never waits on anything: the app is already drawing under it.
 */
export type RaptorVariant = 'lock' | 'dive' | 'summit'
export const RAPTOR_OPENING_DEFAULT: RaptorVariant = 'lock'

const FULL_MS = 3500

const seed = (i: number, n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1
const CLOUDS = Array.from({ length: 9 }, (_, i) => ({ x: seed(i, 1) * 100, w: 26 + seed(i, 2) * 30, delay: seed(i, 3) * 0.9, dur: 0.9 + seed(i, 4) * 0.8 }))
/* Where each feather goes from the point of landing, and how it turns as it falls. */
const FEATHERS = Array.from({ length: 11 }, (_, i) => ({
  dx: (seed(i, 5) - 0.5) * 420, dy: 60 + seed(i, 6) * 260, rot: (seed(i, 7) - 0.5) * 540, delay: 1.2 + seed(i, 8) * 0.25, s: 0.6 + seed(i, 9) * 0.7,
}))
const TICKS = Array.from({ length: 72 }, (_, i) => i * 5)

function Feather() {
  return (
    <svg viewBox="-2 -8 44 16" width="44" height="16" aria-hidden>
      <path d="M0 0 C 10 -7, 28 -7, 42 0 C 28 6, 10 6, 0 0 Z" fill="#efe6d8" fillOpacity="0.9" />
      <path d="M0 0 L 42 0" stroke="#b07a48" strokeWidth="0.9" />
    </svg>
  )
}

export function RaptorOpening({ variant = RAPTOR_OPENING_DEFAULT, onDone, force = false }: {
  variant?: RaptorVariant
  onDone: () => void
  force?: boolean
}) {
  const reduced = !force && typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [leaving, setLeaving] = useState(false)
  const done = useRef(false)
  const finish = () => {
    if (done.current) return
    done.current = true
    setLeaving(true)
    setTimeout(onDone, 550)
  }

  useEffect(() => {
    if (!reduced) playRaptorSound(variant)
    const t = setTimeout(finish, reduced ? 600 : FULL_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one play per mount; the replay page remounts by key
  }, [])

  const look = reduced ? 'still' : variant
  return (
    <div className={`raptor-opening is-${look} ${leaving ? 'is-leaving' : ''}`} data-testid="raptor-opening" data-variant={look}
      onClick={finish} role="presentation">
      {look === 'lock' && (
        <div aria-hidden className="ro-layer">
          <span className="ro-contours" />
          <span className="ro-scan" />
          <svg className="ro-reticle" viewBox="-300 -300 600 600" fill="none">
            <g className="ro-ticks">
              {TICKS.map((a) => <line key={a} x1="0" y1={a % 30 === 0 ? -286 : -292} x2="0" y2="-298" transform={`rotate(${a})`} />)}
            </g>
            <circle r="240" className="ro-ret-ring" />
            <circle r="170" className="ro-ret-ring is-2" />
            <path d="M -300 0 H -190 M 190 0 H 300 M 0 -300 V -190 M 0 190 V 300" className="ro-crosshair" />
          </svg>
          <span className="ro-bracket is-tl" /><span className="ro-bracket is-tr" /><span className="ro-bracket is-bl" /><span className="ro-bracket is-br" />
          <span className="ro-flash" />
        </div>
      )}
      {look === 'dive' && (
        <div aria-hidden className="ro-layer">
          <span className="ro-ember-sky" />
          {CLOUDS.map((c, i) => <span key={i} className="ro-cloud-up" style={{ left: `${c.x}%`, width: `${c.w}vw`, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s` }} />)}
        </div>
      )}
      {look === 'summit' && (
        <div aria-hidden className="ro-layer">
          <span className="ro-photo" />
          <span className="ro-sunflare" />
          <span className="ro-summit-shade" />
        </div>
      )}

      <div className="ro-lockup" data-testid="raptor-opening-lockup">
        <div className="ro-wing-box">
          {look === 'dive' && <span aria-hidden className="ro-trail" />}
          <img src="/brand/raptor-mark.png" alt="" className="ro-wing" />
          {look === 'dive' && (
            <div aria-hidden className="ro-feathers">
              {FEATHERS.map((f, i) => (
                <span key={i} className="ro-feather" style={{ ['--dx' as string]: `${f.dx}px`, ['--dy' as string]: `${f.dy}px`, ['--rot' as string]: `${f.rot}deg`, ['--s' as string]: f.s, animationDelay: `${f.delay}s` }}>
                  <Feather />
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="ro-words">
          <img src="/brand/raptor-words-light.png" alt="Raptor by Bredell Ferreira" className="ro-words-img" />
        </div>
      </div>
      {look === 'lock' && <p aria-hidden className="ro-readout">Raptor online</p>}
    </div>
  )
}
