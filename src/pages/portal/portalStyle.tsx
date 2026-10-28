import type { ReactNode } from 'react'

/**
 * THE PORTAL'S TWO TYPE STYLES, TAKEN OFF THE REMITTANCE ADVICE (S15). Stephan: "use the remittance advice as
 * inspiration". The advice heads a section with a bold navy title over a slate line, and labels a figure with
 * small tracked capitals in its status blue -- gold where the tile is inverted. The colours are the advice's
 * own (remittancePdf.ts: NAVY #111E2D, STATUS #3F5F86, SLATE #5A6B80, GOLD #C69F54), written as they are
 * there so the two read as one hand.
 */
export function PortalLabel({ children, invert = false }: { children: ReactNode; invert?: boolean }) {
  return (
    <p className={`text-[10.5px] font-bold uppercase tracking-[0.12em] ${invert ? 'text-[#C69F54]' : 'text-[#3F5F86]'}`}>{children}</p>
  )
}

export function PortalHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-xl font-bold text-[#111E2D]">{title}</h2>
        {subtitle && <p className="text-sm text-[#5A6B80] mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
