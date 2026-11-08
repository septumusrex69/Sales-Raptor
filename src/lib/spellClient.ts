/**
 * ASKING THE BACKGROUND SPELL CHECK (S19 · Raptor H18). See spellWorker.ts for why it is in the background at all.
 *
 *   checkSpelling(text) -> the unknown words, in the languages this person ticked (spellCheck.ts).
 *   warmSpelling()      -> build their dictionaries now, quietly, so the first Send does not wait for them.
 *
 * Where a browser has no workers it is done on the page as before. A check that cannot answer rejects, and SpellGate
 * then lets the message go -- a spell check never stops a notice.
 */
import { loadSpeller, myWords, spellCheckEnabled, spellLanguages, unknownWords, type Unknown } from './spellCheck'

let worker: Worker | null = null
let next = 0
const waiting = new Map<number, { resolve: (u: Unknown[]) => void; reject: (e: Error) => void }>()

function theWorker(): Worker | null {
  if (worker) return worker
  if (typeof Worker === 'undefined') return null
  try {
    worker = new Worker(new URL('./spellWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; unknown?: Unknown[] }>) => {
      const w = waiting.get(e.data.id)
      if (!w) return
      waiting.delete(e.data.id)
      if (e.data.ok) w.resolve(e.data.unknown ?? []); else w.reject(new Error('dictionary'))
    }
    worker.onerror = () => { for (const w of waiting.values()) w.reject(new Error('dictionary')); waiting.clear(); worker = null }
    return worker
  } catch { return null }
}

/** Build the ticked dictionaries in the background. Called once the app is up, and when the languages change. */
export function warmSpelling() {
  if (!spellCheckEnabled()) return
  theWorker()?.postMessage({ type: 'warm', langs: spellLanguages() })
}

/**
 * The words of `text` no ticked language knows. Waits up to `ms` (isiZulu's first build is ten seconds); longer than
 * that rejects, and the message goes unchecked rather than held.
 */
export function checkSpelling(text: string, ms = 20_000): Promise<Unknown[]> {
  const w = theWorker()
  if (!w) return loadSpeller().then((sp) => unknownWords(text, sp, myWords()))
  const id = (next += 1)
  return new Promise<Unknown[]>((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('slow')) }, ms)
    waiting.set(id, {
      resolve: (u) => { clearTimeout(timer); resolve(u) },
      reject: (e) => { clearTimeout(timer); reject(e) },
    })
    w.postMessage({ type: 'check', id, langs: spellLanguages(), text, extra: myWords() })
  })
}
