import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { inputClass } from './Modal'
import { clientLabel, matchClients, type Searchable } from '../../lib/clientSearch'

/**
 * Choosing a client by typing at it, in place of a native dropdown.
 *
 * THE FIRM: "I don't like the drop down ... I should be able to search the client as well."
 *
 * A <select> is a wheel on an iPad, which is the device the firm works on, and the book will hold
 * hundreds of clients. This is the same shape as the To box next door — a combobox over a
 * listbox, arrow keys, Escape — so there is one way of picking a thing out of a long list in this
 * app rather than two.
 *
 * IT IS A LOCKED PICKER, AND THAT IS THE DIFFERENCE FROM THE To BOX. A recipient may be somebody
 * not yet in the CRM, so that field stays free text. A client is not: a handover belongs to a
 * client that exists, and letting somebody type "Bredell" and press on would put a batch against
 * nothing. So what is typed is only ever a search, and the value changes when a row is taken.
 */
export function ClientPicker<T extends Searchable>({
  clients, value, onChange, placeholder, clearLabel, disabled, id, autoFocus,
}: {
  clients: T[]
  /** The chosen client's id, or '' for none. */
  value: string
  onChange: (id: string) => void
  placeholder?: string
  /** Offered as the first row where choosing nothing is allowed — "All clients". */
  clearLabel?: string
  disabled?: boolean
  id?: string
  autoFocus?: boolean
}) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  const chosen = clients.find((c) => c.id === value) ?? null
  const shown = useMemo(() => matchClients(clients, query), [clients, query])
  /* The clear row sits at index 0 when it is offered, so the keyboard walks over it too. */
  const rows: { id: string; label: string; hint?: string }[] = [
    ...(clearLabel ? [{ id: '', label: clearLabel }] : []),
    ...shown.map((c) => ({ id: c.id, label: c.name, hint: c.code ?? undefined })),
  ]

  /* Closing on a click elsewhere: without it the panel hangs over whatever is underneath and the
     next thing somebody presses is eaten by it. */
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setQuery('') }
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  /**
   * Taking a row, and CANCELLING THE CLICK'S DEFAULT ACTION on the way out.
   *
   * THE FIRM: "the moment that I click on a client, it just selects it, it has like this little
   * tick, and then you have to close it manually."
   *
   * The picker always closed itself -- setOpen(false) is right there. What reopened it is the
   * <label> most of these sit inside: activating anything within a label forwards the activation
   * to the label's own control, so the row's click selected the client and then focused the input
   * underneath it, and this input opens on focus. FormField is a <label> too, which made it three
   * of the five places the picker is used -- and it looked like a picker ignoring you rather than
   * a bug, because the client WAS chosen every time. The value was never the broken part.
   *
   * Cancelled here rather than fixed at the call sites, because the next person to wrap a picker
   * in a FormField would bring it straight back. A label forwarding to a composite widget is not
   * behaviour this control ever wants.
   */
  function take(rowId: string, e?: { preventDefault: () => void }) {
    e?.preventDefault()
    onChange(rowId)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={box} className="relative">
      <input
        id={id}
        ref={input}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        autoFocus={autoFocus}
        className={inputClass}
        /*
          WHAT IS TYPED WHILE SEARCHING, AND THE CHOSEN CLIENT OTHERWISE. Showing the query even
          when it is empty would blank the box the moment somebody focused it, which reads as
          having lost the client they already picked.
        */
        value={open ? query : clientLabel(chosen)}
        placeholder={placeholder ?? (clearLabel ?? 'Search for a client…')}
        onFocus={() => { setOpen(true); setActive(0) }}
        /*
          ON CLICK AS WELL AS FOCUS. Escape closes the list and leaves the box focused, so the
          next tap on it was a click on an already-focused input -- no focus event fires, nothing
          opens, and the control reads as having stopped responding.
        */
        onClick={() => { setOpen(true); setActive(0) }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (!open) { setOpen(true); return }
            if (rows.length === 0) return
            setActive((i) => (e.key === 'ArrowDown'
              ? (i + 1) % rows.length
              : (i - 1 + rows.length) % rows.length))
          } else if (e.key === 'Enter') {
            /* Takes the highlighted row rather than submitting the form under it — this picker
               sits inside forms whose submit would otherwise fire on the first Enter. */
            if (open && rows[active]) { e.preventDefault(); take(rows[active].id) }
          } else if (e.key === 'Escape') {
            setOpen(false)
            setQuery('')
          }
        }}
      />

      {/* The chevron, so it still reads as something to open. A cleared value gets an X instead,
          which is the faster gesture on the filters this sits in. */}
      <span className="absolute inset-y-0 right-2 flex items-center text-slate-400">
        {clearLabel && value && !open ? (
          <button type="button" aria-label="Clear the client" disabled={disabled}
            onClick={(e) => { take('', e); input.current?.focus() }}
            className="rounded p-0.5 hover:bg-slate-100 hover:text-slate-600">
            <X size={14} />
          </button>
        ) : <ChevronDown size={15} />}
      </span>

      {open && (
        <ul id={listId} role="listbox"
          className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-lg border
            border-slate-200 bg-white shadow-lg">
          {rows.length === 0 && (
            /* NAMED, NOT EMPTY. A panel that opens on nothing reads as a picker that is broken
               rather than a search that found nobody. */
            <li className="px-3 py-2 text-sm text-slate-400">No client matches “{query}”.</li>
          )}
          {rows.map((r, i) => (
            <li key={r.id || '(none)'} role="option" aria-selected={i === active}
              onMouseEnter={() => setActive(i)}>
              <button type="button" onClick={(e) => take(r.id, e)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left
                  ${i === active ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{r.label}</span>
                {/* The code beside the name, because it is what the firm says out loud and what
                    somebody who typed it wants to see confirmed. */}
                {r.hint && <span className="shrink-0 text-[11px] text-slate-400">{r.hint}</span>}
                {r.id === value && <Check size={13} className="shrink-0 text-brand-600" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
