import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Lightbulb, MessageSquare, Phone, Search } from 'lucide-react'
import { rand } from '../../lib/money'
import { PortalHeading, PortalLabel } from './portalStyle'
import { HELP_GUIDES, HELP_TOPICS, matchesGuide, type HelpBlock, type HelpGuide, type HelpLink, type HelpTopic } from './help/helpGuides'
import { SplitBar, SplitExplainer } from './help/SplitExplainer'
import { SPLIT_EXAMPLES, splitPayment, type SplitInput } from './help/splitExample'

/**
 * HELP (Ryno, 11 Nov · Raptor · Handover 19). "A section where there is like help / advisory option. In these help
 * sections there needs to be some guides explaining some core functions that the clients could be wondering about.
 * Like with the reporting, then we will have a fun and professional video explaining the 50/50 allocation split."
 *
 * So, top to bottom: the 50/50 film (the one thing clients ask about most and understand least), then every guide,
 * searchable and grouped by topic, then the two ways to reach a person. A guide opens in place -- the portal has no
 * router of its own, and a client reading about tickets should be one press from Tickets, not from a new tab.
 *
 * HELP_VIDEO_SRC: the produced film, once there is one. Put the file in public/help/ and its path here; it then plays
 * above the drawn explainer, which stays, because its figures are the arithmetic and the film's are pixels.
 */
const HELP_VIDEO_SRC: string | null = null

export function PortalHelp({ onOpen, onAsk, onCall }: {
  onOpen: (section: HelpLink) => void
  onAsk: () => void
  onCall: () => void
}) {
  const [query, setQuery] = useState('')
  const [topic, setTopic] = useState<HelpTopic | 'All'>('All')
  const [open, setOpen] = useState<HelpGuide | null>(null)

  const shown = useMemo(
    () => HELP_GUIDES.filter((g) => (topic === 'All' || g.topic === topic) && matchesGuide(g, query)),
    [query, topic],
  )
  const read = (g: HelpGuide) => { setOpen(g); window.scrollTo?.({ top: 0 }); document.querySelector('main')?.scrollTo?.({ top: 0 }) }

  if (open) return <Guide g={open} onBack={() => setOpen(null)} onOpen={onOpen} onAsk={onAsk} />

  return (
    <div className="space-y-5" data-testid="portal-help">
      {/* THE FILM */}
      <section className="bg-white rounded-2xl border border-[#D5DBE3] p-4 sm:p-5 space-y-4">
        <PortalHeading title="How a payment is split" subtitle="The 50/50 rule in under a minute: where every rand of a debtor’s payment goes."
          action={<button type="button" onClick={() => read(HELP_GUIDES.find((g) => g.id === 'split')!)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#46607B] hover:text-[#101F2C]" data-testid="help-split-guide">
            Try your own numbers <ArrowRight size={15} />
          </button>} />
        {HELP_VIDEO_SRC && (
          <video src={HELP_VIDEO_SRC} controls playsInline preload="metadata" className="w-full rounded-2xl bg-[#101F2C]" data-testid="help-video" />
        )}
        <SplitExplainer />
      </section>

      {/* THE GUIDES */}
      <section className="bg-white rounded-2xl border border-[#D5DBE3] p-4 sm:p-5 space-y-4">
        <PortalHeading title="Guides" subtitle="Short answers to the questions clients ask us most." />
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative flex-1 min-w-[220px] max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5A6B80]" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the guides, e.g. commission"
              className="w-full rounded-xl border border-[#D5DBE3] bg-[#F7F9FB] pl-9 pr-3 py-2 text-sm text-[#111E2D] focus:outline-none focus:ring-2 focus:ring-[#C69F54]/40"
              data-testid="help-search" />
          </label>
          <div role="tablist" aria-label="Topic" className="flex flex-wrap gap-1.5">
            {(['All', ...HELP_TOPICS] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={topic === t} onClick={() => setTopic(t)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors ${topic === t
                  ? 'bg-[#101F2C] text-white border-[#101F2C]' : 'border-[#D5DBE3] text-[#46607B] hover:border-[#C69F54]'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="text-sm text-[#5A6B80] py-6 text-center" data-testid="help-none">
            No guide matches that. Try another word, or ask us below.
          </p>
        ) : (
          HELP_TOPICS.filter((t) => shown.some((g) => g.topic === t)).map((t) => (
            <div key={t}>
              <PortalLabel>{t}</PortalLabel>
              <div className="mt-2 grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {shown.filter((g) => g.topic === t).map((g) => (
                  <button key={g.id} type="button" onClick={() => read(g)} data-testid="help-guide-card" data-guide={g.id}
                    className="group text-left rounded-xl border border-[#E3E8EE] bg-[#F7F9FB] hover:bg-white hover:border-[#C69F54] p-4 transition-colors">
                    <span className="flex items-start gap-3">
                      <span className="mt-0.5 h-8 w-8 shrink-0 rounded-full border border-[#C69F54]/60 text-[#C69F54] flex items-center justify-center">
                        <BookOpen size={15} />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-semibold text-[#111E2D]">{g.title}</span>
                        <span className="block text-sm text-[#5A6B80] mt-0.5">{g.summary}</span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      <StillStuck onAsk={onAsk} onCall={onCall} />
    </div>
  )
}

function StillStuck({ onAsk, onCall }: { onAsk: () => void; onCall?: () => void }) {
  return (
    <section className="rounded-2xl p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4 text-white" style={{ background: '#101F2C' }}
      data-testid="help-still-stuck">
      <div>
        <p className="text-[#C69F54] text-[10.5px] font-bold uppercase tracking-[0.12em]">Still have a question?</p>
        <p className="text-lg font-semibold mt-1">Your liaison is a message away.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onAsk} data-testid="help-ask"
          className="inline-flex items-center gap-2 rounded-[10px] bg-[#C69F54] text-[#101F2C] px-4 py-2.5 text-sm font-semibold hover:brightness-110">
          <MessageSquare size={15} /> Raise a ticket
        </button>
        {onCall && (
          <button type="button" onClick={onCall} data-testid="help-call"
            className="inline-flex items-center gap-2 rounded-[10px] border border-white/25 px-4 py-2.5 text-sm font-semibold hover:bg-white/10">
            <Phone size={15} /> Ask us to call you
          </button>
        )}
      </div>
    </section>
  )
}

function Guide({ g, onBack, onOpen, onAsk }: { g: HelpGuide; onBack: () => void; onOpen: (s: HelpLink) => void; onAsk: () => void }) {
  return (
    <div className="space-y-5" data-testid="help-guide" data-guide={g.id}>
      <article className="bg-white rounded-2xl border border-[#D5DBE3] p-5 sm:p-7 space-y-5">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#46607B] hover:text-[#101F2C]"
          data-testid="help-back">
          <ArrowLeft size={15} /> All guides
        </button>
        <div>
          <PortalLabel>{g.topic}</PortalLabel>
          <h2 className="text-2xl font-bold text-[#111E2D] mt-1">{g.title}</h2>
          <p className="text-[#5A6B80] mt-1">{g.summary}</p>
        </div>
        <div className="space-y-5 max-w-3xl">
          {g.blocks.map((b, i) => <Block key={i} b={b} />)}
        </div>
        {g.open && (
          <button type="button" onClick={() => onOpen(g.open!.section)} data-testid="help-open-section"
            className="inline-flex items-center gap-2 rounded-[10px] bg-[#101F2C] text-white px-4 py-2.5 text-sm font-semibold hover:brightness-125">
            {g.open.label} <ArrowRight size={15} />
          </button>
        )}
      </article>
      <StillStuck onAsk={onAsk} />
    </div>
  )
}

function Block({ b }: { b: HelpBlock }) {
  if (b.kind === 'p') return <p className="text-[15px] leading-relaxed text-[#32404D]">{b.text}</p>
  if (b.kind === 'tip') return (
    <p className="flex gap-3 rounded-xl border border-[#C69F54]/40 bg-[#C69F54]/[0.07] px-4 py-3 text-sm text-[#32404D]">
      <Lightbulb size={17} className="shrink-0 text-[#C69F54] mt-0.5" /> <span>{b.text}</span>
    </p>
  )
  if (b.kind === 'steps') return (
    <ol className="space-y-3">
      {b.items.map((s, i) => (
        <li key={i} className="flex gap-3 text-[15px] text-[#32404D]">
          <span className="h-7 w-7 shrink-0 rounded-full bg-[#101F2C] text-[#C69F54] text-sm font-bold flex items-center justify-center">{i + 1}</span>
          <span className="pt-0.5 leading-relaxed">{s}</span>
        </li>
      ))}
    </ol>
  )
  if (b.kind === 'terms') return (
    <dl className="divide-y divide-[#ECECEC] rounded-xl border border-[#ECECEC]">
      {b.items.map((t) => (
        <div key={t.term} className="grid sm:grid-cols-[13rem_1fr] gap-1 sm:gap-4 px-4 py-3">
          <dt className="font-semibold text-[#111E2D] text-sm">{t.term}</dt>
          <dd className="text-sm text-[#32404D] leading-relaxed">{t.meaning}</dd>
        </div>
      ))}
    </dl>
  )
  return <>
    <SplitExplainer />
    <TryIt />
  </>
}

/*
 * TRY YOUR OWN NUMBERS. The same splitPayment the film tells, with the client's figures in it. It opens on the film's
 * own example so the two agree on arrival, and the three presets are the three cases worth seeing.
 */
function TryIt() {
  const [v, setV] = useState<SplitInput>(SPLIT_EXAMPLES[0].input)
  const [preset, setPreset] = useState(SPLIT_EXAMPLES[0].id)
  /* Bumped by a preset press, so pressing the same preset twice still puts its figures back. */
  const [round, setRound] = useState(0)
  const r = useMemo(() => splitPayment(v), [v])
  const num = (k: keyof SplitInput, value: string, scale = 1) => {
    const n = Number(value.replace(/[^\d.]/g, ''))
    setV((x) => ({ ...x, [k]: Number.isFinite(n) ? n / scale : 0 }))
  }
  const input = 'w-full rounded-lg border border-[#D5DBE3] bg-white px-3 py-2 text-sm text-[#111E2D] tabular-nums focus:outline-none focus:ring-2 focus:ring-[#C69F54]/40'
  const field = (label: string, k: keyof SplitInput, scale = 1, suffix = '') => (
    <label className="text-sm">
      <PortalLabel>{label}</PortalLabel>
      <span className="relative block mt-1">
        {/* UNCONTROLLED, so "12." can be typed on the way to 12.5; a preset remounts the boxes with its own figures. */}
        <input inputMode="decimal" className={`${input} ${suffix === 'R' ? 'pl-7' : ''}`} data-testid={`help-try-${k}`}
          defaultValue={String(Math.round((v[k] as number) * scale * 100) / 100)} onChange={(e) => num(k, e.target.value, scale)} />
        {suffix && <span className={`absolute top-1/2 -translate-y-1/2 text-xs text-[#5A6B80] ${suffix === 'R' ? 'left-3' : 'right-3'}`}>{suffix}</span>}
      </span>
    </label>
  )
  const row = (label: string, value: number, strong = false, indent = false) => (
    <tr className={strong ? 'font-semibold text-[#111E2D]' : 'text-[#32404D]'}>
      <td className={`py-1.5 ${indent ? 'pl-4' : ''}`}>{label}</td>
      <td className="py-1.5 text-right tabular-nums">{rand(value)}</td>
    </tr>
  )
  return (
    <section className="rounded-2xl border border-[#D5DBE3] p-4 sm:p-5 space-y-4" data-testid="help-try">
      <PortalHeading title="Try your own numbers" subtitle="Change any figure and watch the split move." />
      <div className="flex flex-wrap gap-1.5">
        {SPLIT_EXAMPLES.map((e) => (
          <button key={e.id} type="button" onClick={() => { setV(e.input); setPreset(e.id); setRound((n) => n + 1) }} data-testid="help-try-preset"
            className={`rounded-full px-3 py-1.5 text-xs font-semibold border ${preset === e.id ? 'bg-[#101F2C] text-white border-[#101F2C]' : 'border-[#D5DBE3] text-[#46607B] hover:border-[#C69F54]'}`}>
            {e.title}
          </button>
        ))}
      </div>
      <div key={`${preset}-${round}`} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {field('Debtor pays', 'payment', 1, 'R')}
        {field('Interest owing', 'interestOwing', 1, 'R')}
        {field('Annexure B fees owing', 'feesOwing', 1, 'R')}
        {field('Your commission', 'commissionRate', 100, '%')}
      </div>
      <div className="rounded-xl p-4" style={{ background: '#101F2C' }}>
        <SplitBar r={r} stage={5} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <table className="w-full text-sm" data-testid="help-try-fees">
          <tbody className="divide-y divide-[#ECECEC]">
            {row(`Fees side (half is ${rand(r.half)})`, r.feesSide, true)}
            {row('Interest', r.toInterest, false, true)}
            {row('Receipt fee (10% + VAT)', r.toReceiptFee, false, true)}
            {row('Annexure B fees', r.toFees, false, true)}
            {row('Rolled over to capital', r.rolled, false, true)}
          </tbody>
        </table>
        <table className="w-full text-sm" data-testid="help-try-capital">
          <tbody className="divide-y divide-[#ECECEC]">
            {row('Capital side', r.toCapital, true)}
            {row('Our commission', r.commission, false, true)}
            {row('VAT on commission', r.commissionVat, false, true)}
            <tr className="font-bold text-[#101F2C]" data-testid="help-try-to-you">
              <td className="py-2">Paid over to you</td>
              <td className="py-2 text-right tabular-nums">{rand(r.toClient)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[#5A6B80]">
        An illustration, rounded to the cent the way the payment run does it. It leaves out the receipt fee’s monthly cap and the
        legal limit on interest and fees, which only matter on some accounts. What you were actually paid is on your remittance advice.
      </p>
    </section>
  )
}
