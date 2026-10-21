import { useEffect, useRef, useState } from 'react'

/**
 * A BOX YOU SIGN IN, WITH A FINGER OR A MOUSE.
 *
 * THE FIRM ASKED FOR THE PLATFORM RATHER THAN A SERVICE: "you can basically build in an online
 * signature platform." This is the whole of the capture half of it.
 *
 * POINTER EVENTS, NOT MOUSE AND TOUCH. One set of handlers covers a mouse, a finger and a stylus,
 * and -- the half that actually matters -- `setPointerCapture` keeps the stroke attached to this
 * canvas when the signer's finger leaves it mid-letter, which on a phone is most signatures. With
 * touch events the stroke simply stops at the edge and the signature comes out clipped.
 *
 * `touch-action: none` IS LOAD-BEARING. Without it the browser treats the first drag as a scroll,
 * the page moves under the finger, and nothing is drawn at all. It is the single commonest reason
 * a signature pad appears broken on a tablet, which is what the firm works on.
 *
 * DRAWN AT THE DEVICE'S OWN RESOLUTION. The canvas is sized by devicePixelRatio and scaled back
 * down in CSS, because a signature captured at CSS pixels on a retina screen is visibly furry when
 * it is printed onto an acknowledgement of debt the firm may put in front of a court.
 */
export function SignaturePad({ onChange, height = 160, label }: {
  /** The data URL, or null once it is cleared. */
  onChange: (png: string | null) => void
  height?: number
  label: string
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const [marked, setMarked] = useState(false)

  /* Sized once the element exists, and again when the box changes width -- a tablet turned on its
     side mid-signature would otherwise stretch what has already been drawn. */
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const fit = () => {
      const ratio = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      /* Resizing a canvas CLEARS it, so this only runs when the size actually changed. Re-fitting
         on every render would wipe a signature as it was being drawn. */
      if (canvas.width === Math.round(width * ratio) && canvas.height === Math.round(height * ratio)) return
      /* KEEP WHAT IS DRAWN ACROSS A RESIZE. On an iPad the keyboard coming up for the name box can
         change the box's width by a scrollbar; resizing wipes the canvas, and the next stroke then
         drew into a context that had lost its scale and pen. Copied out, resized, painted back. */
      const before = canvas.width > 0 && canvas.height > 0 ? (() => {
        const copy = document.createElement('canvas')
        copy.width = canvas.width; copy.height = canvas.height
        copy.getContext('2d')?.drawImage(canvas, 0, 0)
        return copy
      })() : null
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      if (before) ctx.drawImage(before, 0, 0, before.width, before.height, 0, 0, canvas.width, canvas.height)
      ctx.scale(ratio, ratio)
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#0f172a'
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [height])

  function at(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    /* THE PAD TAKES EVERY STROKE, NOT ONLY THE FIRST (the firm, 18 Oct: "if I stop in the middle of
       the signature, it doesn't allow me to sign there again"). Safari reads a finger held still as
       a long-press and starts a text selection or the copy callout, which cancels the stroke and
       keeps the touches; the default is refused here and the CSS below turns both off. A name box
       left focused is let go too, so the keyboard is not what the next stroke lands on. */
    e.preventDefault()
    const focused = document.activeElement
    if (focused instanceof HTMLElement && focused !== e.currentTarget) focused.blur()
    /* THE STROKE FOLLOWS THE FINGER OFF THE EDGE. Without capture a signature that overshoots the
       box stops dead at the boundary, which is how a signature comes out missing its last letter. */
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    const { x, y } = at(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    /* A DOT IS A MARK. A signer who taps once has signed something, and a path with one point
       strokes nothing at all -- so the first point is drawn as a line to itself. */
    ctx.lineTo(x, y)
    ctx.stroke()
    if (!marked) setMarked(true)
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = at(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  function up() {
    if (!drawing.current) return
    drawing.current = false
    const canvas = ref.current
    if (canvas) onChange(canvas.toDataURL('image/png'))
  }

  function clear() {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setMarked(false)
    onChange(null)
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <button type="button" onClick={clear}
          className="text-[11px] text-slate-500 hover:text-slate-800 hover:underline">
          Clear
        </button>
      </div>
      <div className="relative rounded-lg border-2 border-dashed border-slate-300 bg-white select-none [-webkit-touch-callout:none]">
        <canvas
          ref={ref}
          style={{ height, touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
          className="block w-full rounded-lg cursor-crosshair"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onLostPointerCapture={up}
          onContextMenu={(e) => e.preventDefault()}
        />
        {/* The prompt sits UNDER the canvas and is pointer-transparent, so it never swallows the
            first stroke -- which is the one a signer makes before reading anything. */}
        {!marked && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center
            text-sm text-slate-400">
            Sign here
          </span>
        )}
      </div>
    </div>
  )
}
