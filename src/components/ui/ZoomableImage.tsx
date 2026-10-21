import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, Minus, Plus, X } from 'lucide-react'

/**
 * A picture Raptor has shrunk to fit, and a way to see it properly.
 *
 * WHY THIS EXISTS RATHER THAN A ZOOM ON THE WHOLE APP. The thing people actually need to enlarge
 * is a picture — chiefly an email signature, where a debtor's or a contact's telephone number is
 * rendered as an image at about eight points. Zooming the page to read it would blow the sidebar,
 * the list and the toolbar up with it, and the browser and the iPad already do that better than
 * we could. So this zooms the ONE thing that is too small, leaves everything else where it is,
 * and works the way people already expect a picture to: click it, and it fills the screen.
 *
 * Built as a shared control rather than inside the mailbox, because the mailbox is only the first
 * place Raptor shows a picture too small to read. Correspondence on an account and documents on a
 * file are the same problem, and they now cost one import each.
 *
 * NOTHING IS FETCHED. The src handed in is already in the page — a data: URI, in the mailbox's
 * case — so opening this contacts nobody. That matters for mail: a picture pulled from somebody
 * else's server on open is how a sender learns their message was read, and by whom.
 */
export function ZoomableImage({ src, alt, className }: {
  src: string
  /** Real alt text, used both on the thumbnail and in the viewer. */
  alt: string
  /** How the thumbnail sits in the page. The viewer sizes itself. */
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {/*
        A button, not a bare image with a click handler: it has to be reachable by keyboard and to
        announce itself as something that does something. The title says what will happen, since
        a picture gives no other clue.
      */}
      <button type="button" onClick={() => setOpen(true)} title={`${alt} — click to enlarge`}
        className="group relative max-w-full rounded overflow-hidden border border-slate-100 bg-white
          hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50">
        <img src={src} alt={alt} className={className} />
        {/*
          A hint that appears on hover rather than a permanent badge stamped over every signature.
          Hidden from assistive tech: the button's own title already says it.
        */}
        <span aria-hidden className="absolute bottom-1 right-1 hidden group-hover:flex items-center
          gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-900/70 text-white">
          <Maximize2 size={10} /> Enlarge
        </span>
      </button>
      {open && <Viewer src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  )
}

/** How far in it will go. Beyond about four times, a signature is just pixels. */
const STEPS = [1, 1.5, 2, 3, 4]

function Viewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [step, setStep] = useState(0)
  /** The picture's own width in pixels, learned when it loads — the basis for every zoom step. */
  const [naturalWidth, setNaturalWidth] = useState(0)
  const closeRef = useRef<HTMLButtonElement>(null)
  const zoom = STEPS[step]
  const fitted = step === 0

  const zoomBy = useCallback((by: number) => {
    setStep((s) => Math.min(STEPS.length - 1, Math.max(0, s + by)))
  }, [])

  useEffect(() => {
    // Focus the way out, so Escape is not the only way out for somebody on a keyboard.
    closeRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1) }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(-1) }
    }
    document.addEventListener('keydown', onKey)
    // The page behind must not scroll while this is up, or dismissing it leaves you somewhere else.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose, zoomBy])

  return createPortal(
    <div
      role="dialog"
      aria-modal
      aria-label={alt}
      /* data-modal-open: the same mark the forms use, so a new version cannot reload the page
         out from under somebody in the middle of reading something. */
      data-modal-open
      /* Nearly opaque. At 80% the page behind read straight through, and the controls sat on top
         of whatever happened to be under them — on a bright mailbox row the minus button all but
         vanished. A picture viewer should leave nothing to compete with the picture. */
      className="fixed inset-0 z-[110] bg-slate-950/95 flex flex-col"
      onClick={onClose}
    >
      <div className="flex items-center justify-end p-3 shrink-0">
        {/* The controls carry their own ground, so they stay legible whatever is behind them. */}
        <div className="flex items-center gap-1 rounded-full bg-slate-800/90 border border-white/10 px-1.5 py-1"
          onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => zoomBy(-1)} disabled={step === 0}
            aria-label="Zoom out"
            className="p-1.5 rounded-full text-white/80 hover:bg-white/15 disabled:opacity-25">
            <Minus size={16} />
          </button>
          {/* The number, so the buttons are not the only way to know where you are. */}
          <span className="text-xs font-medium text-white/80 tabular-nums w-10 text-center">
            {fitted ? 'Fit' : `${zoom}×`}
          </span>
          <button type="button" onClick={() => zoomBy(1)} disabled={step === STEPS.length - 1}
            aria-label="Zoom in"
            className="p-1.5 rounded-full text-white/80 hover:bg-white/15 disabled:opacity-25">
            <Plus size={16} />
          </button>
          <span aria-hidden className="w-px h-4 bg-white/15 mx-1" />
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close"
            className="p-1.5 rounded-full text-white/80 hover:bg-white/15">
            <X size={16} />
          </button>
        </div>
      </div>

      {/*
        Two layouts, because one does not do both jobs.

        Fitted, the picture is centred. Zoomed in, it is bigger than the box and has to scroll —
        and a flex- or grid-centred child that overflows gets its top and left edges clipped with
        no way to scroll back to them, which in a picture viewer means the part you zoomed in to
        read. So beyond Fit it becomes ordinary centred block layout, which overflows honestly.
      */}
      <div
        className={`flex-1 min-h-0 overflow-auto p-4 ${fitted ? 'flex items-center justify-center' : 'text-center'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt}
          onLoad={(e) => setNaturalWidth(e.currentTarget.naturalWidth)}
          // Double-tap or double-click to go straight in, the way every picture viewer works.
          onDoubleClick={() => setStep((s) => (s === 0 ? 2 : 0))}
          className={fitted
            ? 'max-h-full max-w-full object-contain'
            : 'inline-block max-w-none'}
          style={fitted || !naturalWidth ? undefined : { width: naturalWidth * zoom }}
        />
      </div>

      <p className="shrink-0 text-center text-[11px] text-white/40 pb-3 px-4">
        Double-click the picture to zoom in. Click outside it to close.
      </p>
    </div>,
    document.body,
  )
}
