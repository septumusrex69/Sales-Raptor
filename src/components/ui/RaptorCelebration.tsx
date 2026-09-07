import { useEffect, useMemo } from 'react'
import type { Celebration } from '../../lib/celebration'
import { playCelebrationChime } from '../../lib/chime'

/**
 * Two tiers, deliberately far apart.
 *
 * An ordinary win is short, silent and gold — a good moment, over before it interrupts anything.
 * A milestone is longer, louder, throws four times as many stars and is the only thing in the app
 * that makes a noise. Keeping the everyday one quiet is what leaves the milestone somewhere to go;
 * if every closed deal chimed across a floor of fifty people, the sound would be switched off by
 * Wednesday and the milestone would have no way left to announce itself.
 */
const TIER = {
  win: { duration: 2400, stars: 18, burstAt: 1500, minSpread: 130, spread: 170 },
  milestone: { duration: 3400, stars: 52, burstAt: 2350, minSpread: 170, spread: 380 },
} as const

export function RaptorCelebration({ celebration, onDone }: { celebration: Celebration; onDone: () => void }) {
  const { message, intensity } = celebration
  const tier = TIER[intensity]

  useEffect(() => {
    if (intensity === 'milestone') playCelebrationChime()
    const timer = window.setTimeout(onDone, tier.duration)
    return () => window.clearTimeout(timer)
  }, [onDone, intensity, tier.duration])

  // Fixed per mount so the stars don't reshuffle on every render mid-burst.
  const sparks = useMemo(
    () =>
      Array.from({ length: tier.stars }, (_, i) => {
        const angle = (i / tier.stars) * Math.PI * 2 + Math.random() * 0.3
        const distance = tier.minSpread + Math.random() * tier.spread
        return {
          dx: `${Math.cos(angle) * distance}px`,
          dy: `${Math.sin(angle) * distance}px`,
          delay: `${tier.burstAt + Math.random() * 140}ms`,
          size: 9 + Math.random() * (intensity === 'milestone' ? 13 : 9),
        }
      }),
    [tier, intensity],
  )

  return (
    <div
      className={`raptor-celebration${intensity === 'milestone' ? ' raptor-celebration--milestone' : ''}`}
      aria-live="polite"
      role="status"
    >
      <div className="raptor-celebration__stage">
        {/* A shockwave the everyday win doesn't get, so the two tiers read apart at a glance. */}
        {intensity === 'milestone' && <span className="raptor-celebration__ring" />}

        {sparks.map((s, i) => (
          <span
            key={i}
            className="raptor-celebration__spark"
            style={
              {
                '--dx': s.dx,
                '--dy': s.dy,
                width: `${s.size}px`,
                height: `${s.size}px`,
                animationDelay: s.delay,
              } as React.CSSProperties
            }
          />
        ))}

        <span className="raptor-celebration__flight">
          <img src="/brand/raptor-mark.png" alt="" className="raptor-celebration__bird" />
        </span>
      </div>

      <div className="raptor-celebration__caption">
        {intensity === 'milestone' && <span className="raptor-celebration__eyebrow">Milestone</span>}
        <p className="raptor-celebration__message">{message}</p>
      </div>
    </div>
  )
}
