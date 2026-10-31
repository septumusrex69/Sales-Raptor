import { useState } from 'react'
import { Phone } from 'lucide-react'
import { PORTAL_ROTATION, johannesburgToday, photoOfTheDay, portalPhotoUrl, type PortalPhoto, type PortalPhotoKind } from '../../lib/portalPhotos'
import { clockNow } from '../../lib/clock'
import './portal.css'

/**
 * /portal/photos -- THE PORTAL'S PHOTOGRAPHS, IN THEIR DAILY ORDER (S16, 31 Oct; the list is portalPhotos.ts). Stephan, of the Llandudno band: "the hero bar ... I
 * don't know if it completely works with this one. Get some other examples ... something that could be South Africa
 * ... more to be home ... nature, people, and like city type of vibes. So like Johannesburg, Sandton ... 60 or 70
 * nature, and then 15 city and 15 people."
 *
 * Each candidate is drawn AS THE PORTAL'S BAND and as the tall sign-in panel, because a photograph that is lovely on its
 * own can be wrong in a 5:1 strip under white words. They are shown straight from Unsplash at preview size -- this page
 * is for choosing, nothing here is kept -- and the one he picks is downloaded into the app, as the Llandudno one was.
 * No sign-in and no data, like /portal/opening.
 */
type Kind = PortalPhotoKind
type Candidate = PortalPhoto
const CANDIDATES = PORTAL_ROTATION
const url = (c: Candidate, w: number) => portalPhotoUrl(c, w)

export default function PortalPhotosPage() {
  const [kind, setKind] = useState<Kind | 'All'>('All')
  const shown = CANDIDATES.map((c, i) => ({ ...c, n: i + 1 })).filter((c) => kind === 'All' || c.kind === kind)
  const count = (k: Kind) => CANDIDATES.filter((c) => c.kind === k).length
  const today = photoOfTheDay(johannesburgToday(clockNow()))

  return (
    <div className="portal-brand min-h-dvh bg-[#F4F4F4] px-4 sm:px-8 py-8" data-testid="portal-photos">
      <div className="max-w-[1180px] mx-auto">
        <p className="bf-label text-[11px] text-[#C69F54]">Bredell Ferreira · Client portal</p>
        <h1 className="text-[28px] sm:text-[34px] text-[#101F2C] mt-1">The portal's photograph of the day</h1>
        <p className="text-[15px] text-[#525D66] mt-2 max-w-[68ch]">
          A new photograph of South Africa every day, in this order and then round again: about 40% nature, a third people,
          a quarter city. Each is shown as the dashboard's band and as the tall sign-in panel; today's is marked.
        </p>
        <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Which photographs">
          {(['All', 'Nature', 'City', 'People'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} data-testid={`photos-${k.toLowerCase()}`}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium border ${kind === k ? 'bg-[#101F2C] text-white border-[#101F2C]' : 'bg-white text-[#32404D] border-[#ECECEC]'}`}>
              {k}{k !== 'All' && <span className="ml-1.5 opacity-70">{count(k)}</span>}
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-6">
          {shown.map((c) => (
            <article key={c.id} className="card p-3 sm:p-4" data-testid="photo-candidate">
              <div className="flex flex-col lg:flex-row gap-3">
                {/* As the dashboard's band: the same shade, words and button the portal draws over it. */}
                <div className="relative flex-1 min-w-0 overflow-hidden rounded-[18px] text-white min-h-[170px] flex items-center"
                  style={{ background: `linear-gradient(90deg, rgba(16,31,44,0.82) 0%, rgba(16,31,44,0.55) 30%, rgba(16,31,44,0.12) 58%, rgba(16,31,44,0) 80%), url('${url(c, 1600)}') ${c.band ?? 'center'} / cover no-repeat, #1d2c3a` }}>
                  <div className="w-full px-6 py-6 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="bf-label text-[11px] text-[#C69F54]">Stephan's Test Client</p>
                      <p className="text-[28px] leading-tight mt-1 font-bold" style={{ fontFamily: "'Raleway Variable', 'Raleway', sans-serif" }}>Dashboard</p>
                      <p className="text-[14px] text-white/90 mt-1">Your book, where it stands, whenever you want to look.</p>
                    </div>
                    <span className="inline-flex items-center gap-2 rounded-[10px] bg-[#101F2C]/45 border border-white/25 px-3.5 py-2 text-sm font-semibold backdrop-blur-md"><Phone size={14} /> Ask us to call you</span>
                  </div>
                </div>
                {/* As the sign-in panel: taller than it is wide, the words at its foot. */}
                <div className="relative w-full lg:w-[170px] h-[220px] lg:h-auto shrink-0 overflow-hidden rounded-[14px] text-white flex items-end"
                  style={{ background: `linear-gradient(180deg, rgba(16,31,44,0.30) 0%, rgba(16,31,44,0.10) 35%, rgba(16,31,44,0.78) 78%, rgba(16,31,44,0.92) 100%), url('${url(c, 900)}') center / cover no-repeat, #1d2c3a` }}>
                  <p className="p-3 text-[13px] font-bold leading-snug" style={{ fontFamily: "'Raleway Variable', 'Raleway', sans-serif" }}>Your book, where it stands.</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
                <span className="text-[22px] font-bold text-[#101F2C] tabular-nums" style={{ fontFamily: "'Raleway Variable', 'Raleway', sans-serif" }}>{c.n}</span>
                <span className="text-[15px] font-semibold text-[#101F2C]">{c.title}</span>
                {c.id === today.id && <span className="rounded-full px-2 py-0.5 bg-[#C69F54] text-white text-[11px] font-semibold" data-testid="photo-today">Today</span>}
                <span className="basis-full text-[13.5px] italic text-[#32404D]">“{c.line}”{c.who && <span className="not-italic text-[#46607B]"> — {c.who}</span>}</span>
                <span className="text-[13px] text-[#525D66]">{c.place}</span>
                <span className="ml-auto flex items-center gap-2 text-[12px] text-[#525D66]">
                  <span className="rounded-full px-2 py-0.5 bg-[#D5E1EB] text-[#203B60] font-medium">{c.kind}</span>
                  <span>{c.size}</span>
                  <span>· {c.by}</span>
                </span>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-8 text-xs text-[#525D66]">Photographs from Unsplash, free to use. The photographer of the one chosen is credited on the portal.</p>
      </div>
    </div>
  )
}
