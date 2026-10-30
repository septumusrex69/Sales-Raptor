import { useState } from 'react'
import { Play, RotateCcw } from 'lucide-react'
import { PortalSplash, type SplashVariant } from './PortalSplash'
import { primeSplashAudio } from './portalSound'
import './portal.css'

/**
 * /portal/opening -- THE OPENINGS, ON DEMAND (S16, 30 Oct). Stephan: "the animation. Can you give me a link where I
 * can replay it? And just make two different ones as well." The portal plays its opening once per tab, so without
 * this page the only way to see it again was a new tab and a sign-in.
 *
 * No sign-in and no data: it plays the same component the portal does, forced to the full version. Each play
 * starts from a PRESS, because a browser (Safari on the iPad above all) only lets sound start inside one -- the
 * press primes the audio, then the opening plays with it. A tap during the opening skips it, as in the portal.
 */
const OPENINGS: { id: SplashVariant; name: string; line: string }[] = [
  { id: 'circle', name: '1 · The circle', line: 'The one the portal plays now. Lights and pillars, the gold ring draws, a flare, a bell chord.' },
  { id: 'coast', name: '2 · The coast', line: 'Dusk over the sea. A gold horizon, the monogram rising out of it, the swell, a soft piano.' },
  { id: 'towers', name: '3 · The towers', line: 'Closest to the PlayStation 2. A gold grid floor, towers of light, a shock-ring, a chrome turn.' },
]

export default function PortalOpeningPage() {
  const [playing, setPlaying] = useState<SplashVariant | null>(null)
  const [run, setRun] = useState(0)
  const [last, setLast] = useState<SplashVariant | null>(null)

  const play = (v: SplashVariant) => {
    primeSplashAudio()
    setRun((n) => n + 1)
    setLast(v)
    setPlaying(v)
  }

  return (
    <div className="portal-brand min-h-dvh flex items-center justify-center p-6"
      style={{ background: 'radial-gradient(ellipse at 50% 40%, #1a2d44 0%, #101F2C 60%, #070d15 100%)' }} data-testid="portal-openings">
      {playing && <PortalSplash key={run} variant={playing} force ready onDone={() => setPlaying(null)} />}
      <div className="w-full max-w-[560px]">
        <img src="/brand/icon-light.svg" alt="" className="h-14 w-14 mx-auto" />
        <h1 className="mt-5 text-center text-2xl text-white">The portal's opening</h1>
        <p className="mt-2 text-center text-sm text-white/70">Tap one to play it, with sound. Tap the screen while it plays to skip.</p>
        <ul className="mt-8 space-y-3">
          {OPENINGS.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => play(o.id)} data-testid={`opening-${o.id}`}
                className="w-full text-left flex items-center gap-4 rounded-2xl border border-white/15 bg-white/[0.06] hover:bg-white/[0.12] px-5 py-4 transition-colors">
                <span className="shrink-0 h-11 w-11 rounded-full grid place-items-center bg-[#C69F54] text-[#101F2C]">
                  {last === o.id ? <RotateCcw className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
                </span>
                <span>
                  <span className="block text-white font-semibold" style={{ fontFamily: "'Raleway Variable', 'Raleway', sans-serif" }}>{o.name}</span>
                  <span className="block mt-0.5 text-[13px] text-white/65">{o.line}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-center text-xs text-white/45">
          If there is no sound on the iPad, check that the switch on the side (or Silent mode) is off.
        </p>
      </div>
    </div>
  )
}
