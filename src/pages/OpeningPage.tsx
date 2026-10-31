import { useState } from 'react'
import { Play, RotateCcw } from 'lucide-react'
import { RAPTOR_OPENING_DEFAULT, RaptorOpening, type RaptorVariant } from '../components/opening/RaptorOpening'
import { primeSplashAudio } from './portal/portalSound'

/**
 * /opening -- RAPTOR'S OPENINGS, ON DEMAND (S16, 30 Oct), as /portal/opening is for the portal's. No sign-in and no
 * data. Each play starts from a press, because that is what lets the sound start on an iPad.
 */
const OPENINGS: { id: RaptorVariant; name: string; line: string }[] = [
  { id: 'lock', name: '1 · Lock-on', line: 'A hawk\'s-eye reticle in ember, brackets closing, the lock, the wing in the sights. Drums quickening, a wingbeat, a low horn.' },
  { id: 'dive', name: '2 · Dive', line: 'The stoop: falling through cloud, the wing dives in on an ember trail, feathers scatter. Wingbeats, the rush of the dive, a deep drum.' },
  { id: 'summit', name: '3 · Summit', line: 'Raptor\'s own mountain: the sun flares over the peak, the wing glides across it. Wind on the ridge, a rising horn, far drums.' },
]

export default function OpeningPage() {
  const [playing, setPlaying] = useState<RaptorVariant | null>(null)
  const [run, setRun] = useState(0)
  const [last, setLast] = useState<RaptorVariant | null>(null)
  const play = (v: RaptorVariant) => { primeSplashAudio(); setRun((n) => n + 1); setLast(v); setPlaying(v) }

  return (
    <div className="min-h-dvh flex items-center justify-center p-6" data-testid="raptor-openings"
      style={{ background: 'radial-gradient(ellipse at 50% 40%, #1c1e22 0%, #121316 60%, #060708 100%)' }}>
      {playing && <RaptorOpening key={run} variant={playing} force onDone={() => setPlaying(null)} />}
      <div className="w-full max-w-[560px]">
        <img src="/brand/raptor-lockup-light.png" alt="Raptor by Bredell Ferreira" className="w-[240px] max-w-full mx-auto" />
        <h1 className="mt-6 text-center text-2xl font-semibold text-white">Raptor's opening</h1>
        <p className="mt-2 text-center text-sm text-white/70">What plays after you sign in. Tap one to play it, with sound; tap the screen to skip.</p>
        <ul className="mt-8 space-y-3">
          {OPENINGS.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => play(o.id)} data-testid={`raptor-opening-${o.id}`}
                className="w-full text-left flex items-center gap-4 rounded-2xl border border-white/15 bg-white/[0.06] hover:bg-white/[0.12] px-5 py-4 transition-colors">
                <span className="shrink-0 h-11 w-11 rounded-full grid place-items-center bg-[#e8873a] text-[#0d0e10]">
                  {last === o.id ? <RotateCcw className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
                </span>
                <span>
                  <span className="block text-white font-semibold">{o.name}{o.id === RAPTOR_OPENING_DEFAULT && <span className="ml-2 text-[11px] font-medium text-[#e8873a]">plays now</span>}</span>
                  <span className="block mt-0.5 text-[13px] text-white/65">{o.line}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-center text-xs text-white/45">If there is no sound on the iPad, check that Silent mode is off.</p>
      </div>
    </div>
  )
}
