import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * `subtitle`, `headerRight`, `footer` and `padded` are all optional and all default to what this
 * did before them, so every existing call site renders byte-identically. They exist for the trace
 * workspace, which needs a header that says which trace and whose, an action beside the close
 * button, and a footer that stays put while a long table scrolls under it.
 */
export function Modal({ title, subtitle, onClose, children, width = 480, headerRight, footer, padded = true }: {
  title: string
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  width?: number
  /** Sits left of the close button. An action about the whole modal, not about the form in it. */
  headerRight?: ReactNode
  /** Pinned to the bottom of the card, below the scrolling body. */
  footer?: ReactNode
  /** False where the body lays itself out to the card's edges. */
  padded?: boolean
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    // data-modal-open marks that someone is mid-task in a form: the new-version check
    // refuses to auto-reload while this is in the DOM, so an update can't wipe a
    // half-written email out from under them.
    <div data-modal-open className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center bg-slate-900/40 p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full mt-10 sm:mt-0 max-h-[90vh] overflow-y-auto"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 sticky top-0 z-10 bg-white rounded-t-2xl">
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-800">{title}</h2>
            {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {headerRight}
            {/* NAMED, because an icon on its own has no name at all: a screen reader announced
                this as "button", and nothing could find it by what it does. */}
            <button onClick={onClose} aria-label="Close" title="Close"
              className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className={padded ? 'p-5' : ''}>{children}</div>
        {footer && (
          // Sticky rather than fixed: it sits at the bottom of the card, and the card is what
          // scrolls. Fixed would put it against the viewport and walk off a short modal.
          <div className="sticky bottom-0 z-10 bg-white border-t border-slate-100 rounded-b-2xl px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

export function FormField({ label, children, required }: { label: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block mb-3.5">
      <span className="block text-xs font-medium text-slate-500 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 bg-white'
