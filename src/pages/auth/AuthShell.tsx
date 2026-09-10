import type { ReactNode } from 'react'

/**
 * The frame every signed-out page sits in.
 *
 * It exists because the sign-in page and the set-a-password page were built separately, and the
 * second one kept the skin the app had before Raptor had a brand — right down to telling people
 * they were finishing setting up their "Romulus" login. Somebody invited to Raptor met that page
 * before they ever saw the real one.
 *
 * Two pages that are meant to look identical will not stay identical while they are two pages. So
 * the photograph, the lockup, the card and the footer live here once, and a page supplies only
 * what is actually its own: a heading, a line under it, and its fields.
 */

// Kept out of the component so the long gradient strings don't drown the markup.
const EDGE_FADE =
  'linear-gradient(to right, #000 0%, #000 48%, rgba(0,0,0,0.97) 58%, rgba(0,0,0,0.88) 66%, rgba(0,0,0,0.71) 74%, rgba(0,0,0,0.48) 81%, rgba(0,0,0,0.27) 87%, rgba(0,0,0,0.12) 92%, rgba(0,0,0,0.04) 96%, rgba(0,0,0,0) 100%)'
const CORNER_SHADE =
  'linear-gradient(to bottom right, rgba(4,12,20,0.78) 0%, rgba(4,12,20,0.56) 24%, rgba(4,12,20,0.28) 44%, rgba(4,12,20,0.08) 64%, rgba(4,12,20,0) 80%)'

/** The input styling both pages use. Exported so a field cannot be styled differently by accident. */
export const authFieldClass =
  'w-full text-sm rounded-lg border border-slate-200 bg-white pl-10 pr-3 py-2.5 text-slate-700 placeholder:text-slate-400 outline-none focus:border-[#c9a052] focus:ring-2 focus:ring-[#c9a052]/25'

export function AuthShell({ title, subtitle, children, footer }: {
  title: string
  subtitle: string
  children: ReactNode
  /** Anything below the card. Sign-in uses it for the invite note; set-a-password has none. */
  footer?: ReactNode
}) {
  return (
    <div className="h-dvh w-full flex bg-[#f7f8fa]">
      {/*
        The photograph is decorative and heavy, so it's hidden below large screens rather than
        stacked above the form — a login is one thing, and on a phone that thing is the fields.
      */}
      <div className="relative hidden lg:block lg:w-[42%] shrink-0" aria-hidden="true">
        {/*
          The photograph dissolves rather than stopping. Painting a light gradient on top of a
          full-width image only ever produces a washed band with the image's own edge still
          visible behind it — the edge has to actually stop existing, so the alpha mask fades
          the photo itself out and the page's own background is what's left.
        */}
        <div
          className="absolute inset-y-0 left-0 w-[128%]"
          style={{ WebkitMaskImage: EDGE_FADE, maskImage: EDGE_FADE }}
        >
          <div className="login-photo absolute inset-0 bg-[#0b1620]" />
          {/* Weighted to the top-left corner, where the words sit. */}
          <div className="absolute inset-0" style={{ background: CORNER_SHADE }} />
          <div className="absolute inset-0 bg-[#040c14]/18" />
        </div>

        <p className="relative z-[1] pt-24 pl-14 text-[13px] font-semibold uppercase leading-[2.2] tracking-[0.32em] text-[#d8b56f]">
          Discipline
          <br />
          Creates
          <br />
          Freedom
        </p>
        <span className="relative z-[1] block ml-14 mt-4 h-px w-14 bg-[#d8b56f]/70" />
      </div>

      {/* Sits above the photo's tail, which runs on past the column edge behind it. */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-6 py-10 overflow-y-auto">
        <div className="w-full max-w-[420px]">
          <div className="flex flex-col items-center text-center">
            {/* The real lockup, not the mark with the wordmark re-set beside it — the spacing
                between the wing and the letterforms is part of the mark. Nudged left of true
                centre on purpose: the wing is light gold and the wordmark is dark and heavy, so
                measured centring reads as sitting right of centre. The eye balances mass. */}
            <img
              src="/brand/raptor-lockup-navy.png"
              alt="Raptor by Bredell Ferreira"
              className="w-[290px] max-w-full h-auto mt-1 -translate-x-[8px]"
            />

            <h1 className="mt-9 text-[13px] font-semibold uppercase tracking-[0.22em] text-[#12233a] pl-[0.22em]">{title}</h1>
            <p className="mt-2 text-sm text-slate-400">{subtitle}</p>
          </div>

          <div className="mt-7 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_12px_30px_rgba(15,23,42,0.06)]">
            {children}
          </div>

          {footer}

          <div className="mt-12 flex flex-col items-center">
            <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-slate-400 pl-[0.28em]">Bredell Ferreira</p>
            <span className="mt-2.5 h-px w-10 bg-[#d8b56f]" />
            <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.22em] text-slate-400 pl-[0.22em]">People &nbsp;|&nbsp; Process &nbsp;|&nbsp; Performance</p>
          </div>
        </div>
      </div>
    </div>
  )
}
