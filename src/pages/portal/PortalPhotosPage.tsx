import { useState } from 'react'
import { Phone } from 'lucide-react'
import './portal.css'

/**
 * /portal/photos -- CHOOSING THE PORTAL'S PHOTOGRAPH (S16, 31 Oct). Stephan, of the Llandudno band: "the hero bar ... I
 * don't know if it completely works with this one. Get some other examples ... something that could be South Africa
 * ... more to be home ... nature, people, and like city type of vibes. So like Johannesburg, Sandton ... 60 or 70
 * nature, and then 15 city and 15 people."
 *
 * Each candidate is drawn AS THE PORTAL'S BAND and as the tall sign-in panel, because a photograph that is lovely on its
 * own can be wrong in a 5:1 strip under white words. They are shown straight from Unsplash at preview size -- this page
 * is for choosing, nothing here is kept -- and the one he picks is downloaded into the app, as the Llandudno one was.
 * No sign-in and no data, like /portal/opening.
 */
type Kind = 'Nature' | 'City' | 'People'
interface Candidate { id: string; photo: string; kind: Kind; title: string; place: string; by: string; size: string; band?: string }

const CANDIDATES: Candidate[] = [
  { id: 'eU6Da03AsUQ', photo: 'photo-1583654646893-b89ba9d3849c', kind: 'Nature', title: 'Llandudno at sunset (on the portal now)', place: 'Cape Town', by: 'Byron Breytenbach', size: '5842 × 3895', band: 'center 46%' },
  { id: 'bUOMCTiUymE', photo: 'photo-1507274274451-b203cf128a8f', kind: 'Nature', title: 'The Three Rondavels at dusk', place: 'Blyde River Canyon, Mpumalanga', by: 'Matthias Mullie', size: '6932 × 2772' },
  { id: 'bWE2CLXU0bM', photo: 'photo-1645777762248-cd62e0c9149a', kind: 'Nature', title: 'The canyon and its river', place: 'Blyde River Canyon, Mpumalanga', by: 'Asher Pardey', size: '6401 × 4267' },
  { id: 'JbCdsqF9Di4', photo: 'photo-1567097957353-cad2ca7ae955', kind: 'Nature', title: 'Water and green cliffs', place: 'Blyde River Canyon, Mpumalanga', by: 'Arthur Hickinbotham', size: '3908 × 2605' },
  { id: 'qqIOlje2b9g', photo: 'photo-1566840021279-9713abd97c05', kind: 'Nature', title: 'A tarn below Devil\'s Knuckles', place: 'Southern Drakensberg, KwaZulu-Natal', by: 'Arthur Hickinbotham', size: '5184 × 2912' },
  { id: '9VTU2GoJPcg', photo: 'photo-1566840021286-b26a2e522c7e', kind: 'Nature', title: 'Thaba Ntsu', place: 'Southern Drakensberg, KwaZulu-Natal', by: 'Arthur Hickinbotham', size: '5184 × 2912' },
  { id: 'lFzVv5BFQxk', photo: 'photo-1566840021296-9c0dfd6ab36d', kind: 'Nature', title: 'From the top of Bushman\'s Nek', place: 'Southern Drakensberg, KwaZulu-Natal', by: 'Arthur Hickinbotham', size: '3640 × 2912' },
  { id: '2kWLklg5l7g', photo: 'photo-1712935279736-662f158474ea', kind: 'Nature', title: 'Rhino Peak, 3 056 m', place: 'Southern Drakensberg, KwaZulu-Natal', by: 'Arthur Hickinbotham', size: '4608 × 3456' },
  { id: 'L6EP96_w1Fc', photo: 'photo-1563656157432-67560011e209', kind: 'Nature', title: 'Table Mountain from the beach at sunset', place: 'Cape Town', by: 'Brent Ninaber', size: '4800 × 2700' },
  { id: 'i1el7Rtl-UY', photo: 'photo-1730234350694-1f8716098f8a', kind: 'Nature', title: 'Oudekraal and the Twelve Apostles', place: 'Cape Town', by: 'Martijn Vonk', size: '6000 × 4000' },
  { id: 'JE56S222Rw0', photo: 'photo-1580644906000-6e953181e153', kind: 'Nature', title: 'Fynbos in flower on the mountain', place: 'Table Mountain, Cape Town', by: 'Tobias Reich', size: '6000 × 4000' },
  { id: 'YMJUpl8YWnE', photo: 'photo-1658095513380-258816ec8e85', kind: 'Nature', title: 'A zebra and her foal', place: 'Kruger National Park', by: 'Simona Marinkova', size: '6000 × 4000' },
  { id: 'W0tOuiKeyXU', photo: 'photo-1570003448157-b20009be4ba4', kind: 'Nature', title: 'An old bull elephant', place: 'South Africa', by: 'Ante Hamersmit', size: '4608 × 2592' },
  { id: 'iAsUCcNUpGI', photo: 'photo-1604348489791-f95132c5d8c0', kind: 'City', title: 'Joburg skyline at dawn', place: 'Johannesburg', by: 'Steffen Lemmerzahl', size: '5368 × 3579' },
  { id: '_h-L45TSmGM', photo: 'photo-1636706519609-988babca3dd5', kind: 'City', title: 'Johannesburg at golden hour', place: 'Johannesburg', by: 'Simon Hurry', size: '5186 × 3140' },
  { id: 'F1po0flco3k', photo: 'photo-1626894169601-482d26b23f35', kind: 'City', title: 'The city under Table Mountain, from the sea', place: 'Cape Town', by: 'Peter Burdon', size: '3219 × 2414' },
  { id: 'l_YNobbDYJk', photo: 'photo-1497271679421-ce9c3d6a31da', kind: 'People', title: 'People of Mamelodi', place: 'Pretoria', by: 'Mpumelelo Macu', size: '4175 × 2783' },
  { id: 'axTLYW8opeU', photo: 'photo-1610722838579-e5c518249361', kind: 'People', title: 'A smile', place: 'Gauteng', by: 'Steward Masweneng', size: '4928 × 3264' },
  { id: 'n9UQCavpuE4', photo: 'photo-1595239094961-6920b281336a', kind: 'People', title: 'A happy moment', place: 'Johannesburg', by: 'Nqobile Vundla', size: '5000 × 3334' },
]
const url = (c: Candidate, w: number) => `https://images.unsplash.com/${c.photo}?ixlib=rb-4.1.0&auto=format&fit=max&q=75&w=${w}`

export default function PortalPhotosPage() {
  const [kind, setKind] = useState<Kind | 'All'>('All')
  const shown = CANDIDATES.map((c, i) => ({ ...c, n: i + 1 })).filter((c) => kind === 'All' || c.kind === kind)
  const count = (k: Kind) => CANDIDATES.filter((c) => c.kind === k).length

  return (
    <div className="portal-brand min-h-dvh bg-[#F4F4F4] px-4 sm:px-8 py-8" data-testid="portal-photos">
      <div className="max-w-[1180px] mx-auto">
        <p className="bf-label text-[11px] text-[#C69F54]">Bredell Ferreira · Client portal</p>
        <h1 className="text-[28px] sm:text-[34px] text-[#101F2C] mt-1">The portal's photograph</h1>
        <p className="text-[15px] text-[#525D66] mt-2 max-w-[68ch]">
          South Africa, mostly its nature, with some city and some people. Each one is shown as the dashboard's band and as the
          tall sign-in panel. Tell Claude the number you want; it is then stored in the app at full size.
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
