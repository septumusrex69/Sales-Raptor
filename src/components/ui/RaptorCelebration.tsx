import { useEffect, useMemo } from 'react'

/** Long enough to land, short enough that nobody waits for it. */
const DURATION_MS = 2400
const SPARK_COUNT = 14

/**
 * The bird takes off when something is actually won.
 *
 * Deliberately the Raptor mark rather than generic confetti: this is the one moment the app has
 * to feel like it belongs to this business, and a floor of fifty people signing mandates should
 * get something better than a toast in the corner.
 *
 * It stays out of the way of the work — no pointer events, nothing to dismiss, no layout shift,
 * and it never blocks navigation. Anyone who has asked their system not to animate gets a quiet
 * fade instead, because a flying bird is delightful once and unbearable when it makes you ill.
 */
export function RaptorCelebration({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [onDone])

  // Fixed per mount so the sparks don't reshuffle on every render mid-flight.
  const sparks = useMemo(
    () =>
      Array.from({ length: SPARK_COUNT }, (_, i) => {
        const angle = (i / SPARK_COUNT) * Math.PI * 2 + Math.random() * 0.4
        const distance = 90 + Math.random() * 120
        return {
          dx: `${Math.cos(angle) * distance}px`,
          dy: `${Math.sin(angle) * distance - 40}px`,
          delay: `${Math.random() * 220}ms`,
          size: 4 + Math.random() * 4,
        }
      }),
    [],
  )

  return (
    <div className="raptor-celebration" aria-live="polite" role="status">
      <div className="raptor-celebration__stage">
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

      <p className="raptor-celebration__caption">{message}</p>
    </div>
  )
}
