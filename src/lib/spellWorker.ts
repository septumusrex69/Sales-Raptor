/**
 * THE SPELL CHECK, OFF THE PAGE (S19 · Raptor H18). Building a dictionary is work the browser does in one go -- a
 * quarter of a second for English, ten seconds for isiZulu's rules -- and on the page's own thread that is a frozen
 * screen. Here it happens in the background: the page asks "which words in this text are unknown, in these
 * languages?" and carries on until the answer comes (spellClient.ts). The rules themselves are spellCheck.ts's, the
 * same functions the checks hold; this file only carries messages.
 */
import { loadSpellerFor, unknownWords, type SpellLanguage, type Speller, type Unknown } from './spellCheck'

type Ask =
  | { type: 'warm'; langs: SpellLanguage[] }
  | { type: 'check'; id: number; langs: SpellLanguage[]; text: string; extra: string[] }

const ctx = self as unknown as { onmessage: ((e: MessageEvent<Ask>) => void) | null; postMessage: (m: unknown) => void }
const spellers = new Map<string, Promise<Speller>>()
const spellerFor = (langs: SpellLanguage[]) => {
  const key = [...langs].sort().join(',')
  let p = spellers.get(key)
  if (!p) {
    p = loadSpellerFor(langs)
    p.catch(() => spellers.delete(key))
    spellers.set(key, p)
  }
  return p
}

ctx.onmessage = (e) => {
  const ask = e.data
  if (ask.type === 'warm') { void spellerFor(ask.langs).catch(() => {}); return }
  void spellerFor(ask.langs)
    .then((sp) => ctx.postMessage({ id: ask.id, ok: true, unknown: unknownWords(ask.text, sp, ask.extra) as Unknown[] }))
    .catch(() => ctx.postMessage({ id: ask.id, ok: false }))
}
