import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { inputClass } from './ui/Modal'
import { supabase } from '../lib/supabase'
import {
  looksLikeAddress, suggestRecipients, type Suggestion,
} from '../lib/recipientSuggest.ts'

/**
 * The To box, which now remembers.
 *
 * REPLACES A `<datalist>`, and had to: a datalist's matching belongs to the browser, it cannot
 * show a name beside an address, and there is no way to take an entry out of it. The firm asked
 * for all three — "it picks it up and shows me automatically... you should be able to press a
 * little X button next to it if it's wrong".
 *
 * IT STAYS A TEXT BOX. Not a locked picker: the person who needs a quotation is often somebody
 * whose address is in the salesperson's head and not yet in the CRM, and refusing to send until
 * they stop and create a contact is how a CRM gets worked around instead of used. The suggestions
 * are an offer.
 */
export function RecipientField({ value, onChange, contextual, autoFocus, required, id }: {
  value: string
  onChange: (next: string) => void
  /** Whoever is already known on the client, lead or deal in front of you. Offered first. */
  contextual?: { email: string; label?: string }[]
  autoFocus?: boolean
  required?: boolean
  id?: string
}) {
  const listId = useId()
  const [history, setHistory] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  /*
   * Fetched once when the box appears rather than on every keystroke. The list is a few hundred
   * rows at most and the matching is done here, so a request per letter would be three hundred
   * requests to answer a question already sitting in memory.
   */
  useEffect(() => {
    let cancelled = false
    supabase.rpc('mail_recipient_history', { p_limit: 200 }).then(({ data, error }) => {
      if (cancelled || error || !Array.isArray(data)) return
      setHistory(data.map((r: { address: string; name: string | null; uses: number; last_used: string | null }) => ({
        address: r.address, name: r.name, uses: r.uses, lastUsed: r.last_used,
      })))
    })
    return () => { cancelled = true }
  }, [])

  /*
   * Everyone already on the record comes first, with a use count that puts them above history.
   * Somebody composing from inside a deal almost always means one of that deal's own people, and
   * the address they wrote to last week is the second guess rather than the first.
   */
  const all = useMemo<Suggestion[]>(() => {
    const seen = new Set<string>()
    const out: Suggestion[] = []
    for (const c of contextual ?? []) {
      const address = c.email.trim().toLowerCase()
      if (!address || seen.has(address)) continue
      seen.add(address)
      out.push({ address, name: c.label ?? null, uses: Number.MAX_SAFE_INTEGER, lastUsed: null })
    }
    for (const h of history) {
      if (seen.has(h.address)) continue
      seen.add(h.address)
      out.push(h)
    }
    return out
  }, [contextual, history])

  const shown = useMemo(() => suggestRecipients(all, value, 6), [all, value])

  /* A click anywhere else closes it, which is what everybody expects of a panel like this. */
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  /**
   * The X. Remembered in the database, because the alternative is a joke: the address is derived
   * from sent mail that is still there, so anything less than a stored dismissal brings it back on
   * the next query.
   *
   * Removed from the list on the spot rather than after a refetch — the panel is open under the
   * cursor and a row that lingers for a round trip reads as a button that did not work.
   */
  async function forget(address: string) {
    setHistory((rows) => rows.filter((r) => r.address !== address))
    await supabase.from('mail_recipient_hidden').insert({
      user_id: (await supabase.auth.getUser()).data.user?.id,
      address,
    })
  }

  function take(s: Suggestion) {
    onChange(s.address)
    setOpen(false)
  }

  return (
    <div ref={box} className="relative">
      <input
        id={id}
        type="email"
        className={inputClass}
        value={value}
        onChange={(e) => { onChange(e.target.value); setActive(0); setOpen(true) }}
        onFocus={() => { if (!looksLikeAddress(value)) setOpen(true) }}
        onKeyDown={(e) => {
          if (!open || shown.length === 0) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % shown.length) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + shown.length) % shown.length) }
          /* Enter takes the highlighted one rather than submitting the form under it. */
          else if (e.key === 'Enter' && shown[active]) { e.preventDefault(); take(shown[active]) }
          else if (e.key === 'Escape') { setOpen(false) }
        }}
        placeholder="name@company.co.za"
        autoComplete="off"
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        required={required}
        autoFocus={autoFocus}
      />

      {open && shown.length > 0 && (
        <ul id={listId} role="listbox"
          className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {shown.map((s, i) => (
            <li key={s.address} role="option" aria-selected={i === active}
              className={`flex items-center gap-2 px-3 py-2 ${i === active ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
              onMouseEnter={() => setActive(i)}>
              {/*
                The row is a button and the X is a second one BESIDE it, not inside it. A button
                within a button is invalid markup and, more to the point, the browser gives the
                click to the outer one — so the X would have addressed the message to exactly the
                person somebody was trying to be rid of.
              */}
              <button type="button" onClick={() => take(s)} className="min-w-0 flex-1 text-left">
                {s.name && <span className="block text-sm text-slate-800 truncate">{s.name}</span>}
                <span className={`block truncate ${s.name ? 'text-xs text-slate-500' : 'text-sm text-slate-800'}`}>
                  {s.address}
                </span>
              </button>
              {/* Offered only on what was remembered. Removing somebody who is on the deal in
                  front of you would hide them until the record itself changed. */}
              {s.uses !== Number.MAX_SAFE_INTEGER && (
                <button type="button" aria-label={`Forget ${s.address}`}
                  onClick={() => { void forget(s.address) }}
                  className="shrink-0 rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600">
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
