import { useCallback, useState, type ReactNode } from 'react'
import { SpellCheck } from 'lucide-react'
import { addMyWord, loadSpeller, myWords, replaceWord, spellCheckEnabled, unknownWords, type Unknown } from '../lib/spellCheck'

/**
 * THE CHECK BEFORE A MESSAGE LEAVES (S18; spellCheck.ts has the why). Used by every box that sends to a debtor
 * or a client: the email composer and both SMS boxes.
 *
 *   const spell = useSpellGate()
 *   async function send() { if (!(await spell.clear([text]))) return; ...send... }
 *   {spell.panel([{ value: text, set: setText }])}
 *
 * clear() is true when there is nothing to say: the switch is off, every word is known, the dictionary could not be
 * loaded (a spell check never stops a notice going out), or the person already saw this exact text's list and
 * pressed Send again -- which is how "send it as it is" works, with no second button to find.
 */
export function useSpellGate() {
  const [found, setFound] = useState<Unknown[] | null>(null)
  const [shownFor, setShownFor] = useState<string | null>(null)

  const clear = useCallback(async (texts: string[]): Promise<boolean> => {
    if (!spellCheckEnabled()) return true
    const key = texts.join('\n\u0000\n')
    if (shownFor === key) return true
    let words: Unknown[]
    try {
      const speller = await loadSpeller()
      words = unknownWords(texts.join('\n'), speller, myWords())
    } catch {
      return true
    }
    if (words.length === 0) { setFound(null); return true }
    setFound(words)
    setShownFor(key)
    return false
  }, [shownFor])

  function panel(fields: { value: string; set: (next: string) => void }[]): ReactNode {
    if (!found || found.length === 0) return null
    const drop = (w: string) => setFound((f) => (f ?? []).filter((x) => x.word !== w))
    const fix = (w: string, by: string) => { for (const f of fields) f.set(replaceWord(f.value, w, by)); drop(w) }
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm" data-testid="spell-gate">
        <p className="flex items-center gap-1.5 font-medium text-amber-900">
          <SpellCheck size={15} />
          {found.length === 1 ? '1 word may be misspelled.' : `${found.length} words may be misspelled.`}
        </p>
        <ul className="mt-2 space-y-1.5">
          {found.map((u) => (
            <li key={u.word} className="flex flex-wrap items-center gap-1.5" data-testid="spell-word">
              <span className="font-semibold text-red-700 underline decoration-wavy decoration-red-400">{u.word}</span>
              {u.suggestions.length > 0 && <span className="text-slate-500">→</span>}
              {u.suggestions.map((s) => (
                <button key={s} type="button" onClick={() => fix(u.word, s)} data-testid="spell-suggestion"
                  className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-slate-800 hover:border-brand-400">{s}</button>
              ))}
              <button type="button" onClick={() => { addMyWord(u.word); drop(u.word) }}
                className="text-xs text-slate-500 underline hover:text-slate-700">Add to my words</button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-amber-900">Press a suggestion to fix it, or press Send again to send it as it is.</p>
      </div>
    )
  }

  return { clear, panel }
}
