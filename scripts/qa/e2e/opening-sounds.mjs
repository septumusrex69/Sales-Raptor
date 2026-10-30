/**
 * THE OPENINGS' SOUNDS, RENDERED AND MEASURED (S16, 30 Oct).
 *
 * Stephan, of the first versions: "It sounds like a video game. Just epic, deeper, softer, soothing sounds ... the high
 * pitched things is too high pitched." A source check can say no square wave is named; only the rendered sound can say
 * how high it actually sits. So each sound Raptor and the portal play is rendered silently (an OfflineAudioContext in
 * the real browser, the real module) and measured:
 *
 *   - its average pitch (the spectral centroid, from the signal's first difference) stays LOW -- the chimed versions
 *     measured 535-1 559 Hz; the soft ones about 150-300 --
 *   - but not so low an iPad cannot play it: its speakers give almost nothing under ~150 Hz, and a version measured at
 *     115-185 Hz would have been near silence on the device the firm uses;
 *   - it does not clip, and it is not silent.
 *
 * Run: node scripts/qa/e2e/opening-sounds.mjs
 */
import { PORT, chromium, makeRunner, startServer, stopServer, stubSupabase } from './harness.mjs'

const t = makeRunner('opening-sounds')
const CASES = [
  ['Raptor flight', '/src/components/opening/raptorSound.ts', 'playRaptorSound', 'flight'],
  ['Raptor ascent', '/src/components/opening/raptorSound.ts', 'playRaptorSound', 'ascent'],
  ['Raptor lock-on', '/src/components/opening/raptorSound.ts', 'playRaptorSound', 'lock'],
  ['portal towers', '/src/pages/portal/portalSound.ts', 'playSplashSound', 'towers'],
]
const server = await startServer()
const browser = await chromium.launch()
try {
  for (const [name, mod, fn, v] of CASES) {
    const page = await browser.newPage()
    await stubSupabase(page, [])
    await page.goto(`http://localhost:${PORT}/opening`)
    const r = await page.evaluate(async ([mod, fn, v]) => {
      /* The module asks for an AudioContext; it is handed one that renders to a buffer, "running" as a pressed one is. */
      window.AudioContext = function () {
        const o = new OfflineAudioContext(1, 48000 * 6, 48000)
        Object.defineProperty(o, 'state', { get: () => 'running' })
        window.__off = o
        return o
      }
      const m = await import(mod)
      const played = m[fn](v)
      const x = (await window.__off.startRendering()).getChannelData(0)
      let peak = 0, e = 0, ed = 0
      for (let i = 1; i < x.length; i++) { peak = Math.max(peak, Math.abs(x[i])); e += x[i] * x[i]; const d = x[i] - x[i - 1]; ed += d * d }
      const centroid = 48000 / Math.PI * Math.asin(Math.min(1, Math.sqrt(ed / e) / 2))
      return { played, peak, rms: Math.sqrt(e / x.length), centroid: Math.round(centroid) }
    }, [mod, fn, v])
    t.ok(`${name}: it plays`, r.played === true && r.rms > 0.015)
    t.ok(`${name}: deep and soft -- its average pitch under 400 Hz (was ${r.centroid} Hz)`, r.centroid < 400)
    t.ok(`${name}: ...but above 140 Hz, or an iPad's speakers barely play it (was ${r.centroid} Hz)`, r.centroid > 140)
    t.ok(`${name}: it never clips (peak ${r.peak.toFixed(2)})`, r.peak < 0.95)
    await page.close()
  }
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).slice(0, 200)})`, false)
} finally {
  await browser.close()
  stopServer(server)
}
t.finish()
