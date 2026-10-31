import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, Wand2 } from 'lucide-react'
import { useAuth } from '../store/AuthContext'
import { supabase } from '../lib/supabase'
import { clockNow } from '../lib/clock'
import {
  PORTAL_PHOTOS, bandBackground, draftRowFor, johannesburgToday, lookFromRow, signinBackground, type DayLookRow,
} from '../lib/portalPhotos'

/**
 * /portal-looks -- THE CLIENT PORTAL'S PHOTOGRAPH OF THE DAY, APPROVED A MONTH AT A TIME (S16, 31 Oct).
 *
 * Stephan, at the elephant under the band's words: "as the picture changes, we're going to have to move the script ...
 * pre-choose everything and approve it. For example, exactly how it's going to look ... for the month"; and "any
 * administrator can approve it". So each day of the month is a card drawn EXACTLY as clients will see it -- the
 * dashboard band with its words and the tall sign-in panel -- with the controls beside it: which photograph, where it
 * is framed in each, which side the words sit, how dark the shade under them is, and the line. Approve, and that is
 * the day. Change an approved day and it needs approving again, because what was approved is no longer what shows.
 *
 * A DAY NOBODY APPROVED SHOWS LLANDUDNO (lookFromRow), the app's own photograph, whose framing is known -- the safe
 * default, never a guess. "Fill the month" drafts every empty day from the rotation, to start from rather than a blank.
 * Everyone may look; only an Administrator may change or approve (the table's own policy says so too).
 */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAY = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

function daysOf(year: number, month: number): string[] {
  const n = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => `${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)
}

export default function PortalLooksPage() {
  const { currentUser } = useAuth()
  const canEdit = currentUser?.role === 'Administrator'
  const today = johannesburgToday(clockNow())
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }))
  const days = useMemo(() => daysOf(ym.y, ym.m), [ym])
  const [rows, setRows] = useState<Record<string, DayLookRow>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    supabase.from('portal_day_looks').select('*').gte('day', days[0]).lte('day', days[days.length - 1])
      .then(({ data, error: e }) => {
        if (!live) return
        if (e) setError(e.message)
        setRows(Object.fromEntries(((data ?? []) as DayLookRow[]).map((r) => [r.day, r])))
        setLoading(false)
      })
    return () => { live = false }
  }, [days])

  async function save(row: DayLookRow, approve: boolean | null) {
    setError(null)
    const next: DayLookRow & { updated_at: string; updated_by: string | null } = {
      ...row,
      approved_at: approve === null ? null : approve ? clockNow().toISOString() : null,
      approved_by: approve ? currentUser?.id ?? null : null,
      updated_at: clockNow().toISOString(),
      updated_by: currentUser?.id ?? null,
    }
    const { error: e } = await supabase.from('portal_day_looks').upsert(next, { onConflict: 'day' })
    if (e) { setError(e.message); return }
    setRows((r) => ({ ...r, [row.day]: next }))
  }

  async function fillMonth() {
    const empty = days.filter((d) => !rows[d]).map((d) => ({ ...draftRowFor(d), updated_by: currentUser?.id ?? null }))
    if (empty.length === 0) return
    const { error: e } = await supabase.from('portal_day_looks').upsert(empty, { onConflict: 'day' })
    if (e) { setError(e.message); return }
    setRows((r) => ({ ...r, ...Object.fromEntries(empty.map((x) => [x.day, x])) }))
  }

  const approved = days.filter((d) => rows[d]?.approved_at).length
  const shift = (n: number) => setYm(({ y, m }) => { const t = m + n; return { y: y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 } })

  return (
    <div className="space-y-4" data-testid="portal-looks">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Client portal: photograph of the day</h1>
          <p className="text-sm text-slate-500 max-w-[70ch]">
            Each day as clients will see it. Frame the photograph, put the words on its quiet side, then approve. A day nobody
            approved shows Llandudno.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => shift(-1)} className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50" aria-label="Previous month"><ChevronLeft size={16} /></button>
          <span className="min-w-[9rem] text-center font-medium text-slate-800" data-testid="portal-looks-month">{MONTHS[ym.m]} {ym.y}</span>
          <button type="button" onClick={() => shift(1)} className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50" aria-label="Next month"><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <p className="text-sm text-slate-600" data-testid="portal-looks-count"><b>{approved} of {days.length}</b> days approved for {MONTHS[ym.m]}.</p>
        {canEdit && (
          <button type="button" onClick={() => void fillMonth()} data-testid="portal-looks-fill"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <Wand2 size={15} /> Fill the empty days from the rotation
          </button>
        )}
      </div>
      {error && <p className="text-sm text-negative-700">{error}</p>}
      {loading ? <p className="text-sm text-slate-400">Reading the month…</p> : (
        <div className="grid gap-4">
          {days.map((d) => (
            <DayCard key={d} day={d} row={rows[d] ?? null} isToday={d === today} canEdit={canEdit} onSave={save} />
          ))}
        </div>
      )}
    </div>
  )
}

function DayCard({ day, row, isToday, canEdit, onSave }: {
  day: string
  row: DayLookRow | null
  isToday: boolean
  canEdit: boolean
  onSave: (row: DayLookRow, approve: boolean | null) => Promise<void>
}) {
  const [draft, setDraft] = useState<DayLookRow>(row ?? draftRowFor(day))
  useEffect(() => { setDraft(row ?? draftRowFor(day)) }, [row, day])
  const changed = JSON.stringify(stripMeta(draft)) !== JSON.stringify(stripMeta(row ?? null))
  /* The preview draws the draft AS IF approved: this card is the approval, so it shows what approving will put up. */
  const look = lookFromRow({ ...draft, approved_at: 'preview' })
  const set = (patch: Partial<DayLookRow>) => setDraft((r) => ({ ...r, ...patch }))
  const isApproved = Boolean(row?.approved_at) && !changed

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-3 space-y-3" data-testid="portal-look-day" data-day={day} data-approved={isApproved ? 'yes' : 'no'}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-slate-800">{WEEKDAY(day)}{isToday && <span className="ml-2 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] text-white">Today</span>}</p>
        {isApproved
          ? <span className="inline-flex items-center gap-1 text-xs font-medium text-positive-700"><CheckCircle2 size={14} /> Approved</span>
          : <span className="text-xs text-slate-500">{row ? (changed ? 'Changed, not approved' : 'Not approved: clients see Llandudno') : 'Not chosen: clients see Llandudno'}</span>}
      </div>

      {/*
        THE SIGN-IN PANEL FIRST, AND AT A SIZE THAT CAN BE JUDGED (Stephan, 31 Oct: "the problem is not ... the hero banner
        ... The problem is the login page ... that part on the left"). It is the panel with the most on it -- the mark,
        the heading, the paragraph and the line, all over the photograph -- and it is taller than it is wide, so it is
        where a photograph's framing matters most. Drawn as the real panel is, in proportion; the banner beside it.
      */}
      <div className="flex flex-col md:flex-row gap-3">
        <SigninPreview look={look} />
        <div className="flex-1 min-w-0 space-y-3">
          {/* As the dashboard band. */}
          <div className="relative overflow-hidden rounded-xl text-white h-[120px] flex items-center" style={{ background: bandBackground(look, 1200) }}
            data-testid="portal-look-band">
            <div className={`w-full px-4 ${look.side === 'right' ? 'text-right' : ''}`}>
              <p className="text-[18px] font-bold leading-tight">Dashboard</p>
              <p className="text-[11px] text-white/90">Your book, where it stands.</p>
              <p className={`mt-1.5 text-[10.5px] italic text-white/90 max-w-[60%] ${look.side === 'right' ? 'ml-auto' : ''}`}>“{look.line}”{look.who && <span className="not-italic text-[#C69F54]"> {look.who}</span>}</p>
            </div>
          </div>
      {canEdit && (
        <div className="grid gap-2 text-xs text-slate-600">
          <label className="flex items-center gap-2">
            <span className="w-20 shrink-0">Photograph</span>
            <select value={draft.photo_id} onChange={(e) => set({ photo_id: e.target.value, line: null, who: null })} data-testid="portal-look-photo"
              className="flex-1 min-w-0 rounded-md border border-slate-200 px-2 py-1">
              {PORTAL_PHOTOS.map((p) => <option key={p.id} value={p.id}>{p.kind} · {p.title}</option>)}
            </select>
          </label>
          <Slider label="Sign-in ↔" value={draft.signin_x} onChange={(v) => set({ signin_x: v })} testId="portal-look-signin-x" />
          <Slider label="Sign-in ↕" value={draft.signin_y} onChange={(v) => set({ signin_y: v })} testId="portal-look-signin-y" />
          <Slider label="Banner ↔" value={draft.band_x} onChange={(v) => set({ band_x: v })} testId="portal-look-band-x" />
          <Slider label="Banner ↕" value={draft.band_y} onChange={(v) => set({ band_y: v })} testId="portal-look-band-y" />
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0">Banner words</span>
            {(['left', 'right'] as const).map((side) => (
              <button key={side} type="button" onClick={() => set({ text_side: side })} aria-pressed={draft.text_side === side} data-testid={`portal-look-side-${side}`}
                className={`rounded-md px-2.5 py-1 border ${draft.text_side === side ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200'}`}>
                {side === 'left' ? 'On the left' : 'On the right'}
              </button>
            ))}
          </div>
          <Slider label="Shade" value={Math.round(draft.shade * 100)} onChange={(v) => set({ shade: v / 100 })} />
          <label className="flex items-center gap-2">
            <span className="w-20 shrink-0">Line</span>
            <input value={draft.line ?? ''} placeholder={look.photo.line} onChange={(e) => set({ line: e.target.value || null })}
              className="flex-1 min-w-0 rounded-md border border-slate-200 px-2 py-1" />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-20 shrink-0">Said by</span>
            <input value={draft.who ?? ''} placeholder={draft.line ? 'Leave empty for the firm\'s own line' : (look.photo.who ?? 'The firm\'s own line')} onChange={(e) => set({ who: e.target.value || null })}
              className="flex-1 min-w-0 rounded-md border border-slate-200 px-2 py-1" />
          </label>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {row?.approved_at && !changed && (
              <button type="button" onClick={() => void onSave(draft, false)} className="rounded-md px-3 py-1.5 border border-slate-200 hover:bg-slate-50">Withdraw approval</button>
            )}
            {changed && (
              <button type="button" onClick={() => void onSave(draft, null)} className="rounded-md px-3 py-1.5 border border-slate-200 hover:bg-slate-50">Save without approving</button>
            )}
            {!isApproved && (
              <button type="button" onClick={() => void onSave(draft, true)} data-testid="portal-look-approve"
                className="rounded-md px-3 py-1.5 bg-brand-600 text-white font-medium hover:bg-brand-700">Approve this day</button>
            )}
          </div>
        </div>
      )}
        </div>
      </div>
    </article>
  )
}

function stripMeta(r: DayLookRow | null) {
  if (!r) return null
  const { day, photo_id, band_x, band_y, signin_x, signin_y, text_side, shade, line, who } = r
  return { day, photo_id, band_x: Number(band_x), band_y: Number(band_y), signin_x: Number(signin_x), signin_y: Number(signin_y), text_side, shade: Number(shade), line, who }
}

function Slider({ label, value, onChange, testId }: { label: string; value: number; onChange: (v: number) => void; testId?: string }) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-20 shrink-0">{label}</span>
      <input type="range" min={0} max={100} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} data-testid={testId} className="flex-1" />
      <span className="w-8 text-right tabular-nums">{Math.round(Number(value))}</span>
    </label>
  )
}

/*
 * THE CLIENT PORTAL'S SIGN-IN PANEL, IN MINIATURE AND IN PROPORTION (taller than wide, as on an iPad): the mark at the
 * top, then at the foot the label, the heading, the gold rule, the paragraph and the day's line -- the same words in
 * the same places as PortalPage's SignIn, so what is approved here is what a client sees.
 */
function SigninPreview({ look }: { look: ReturnType<typeof lookFromRow> }) {
  return (
    <div className="relative w-full md:w-[270px] shrink-0 aspect-[0.86] max-w-full overflow-hidden rounded-xl text-white flex flex-col justify-between p-4"
      style={{ background: signinBackground(look, 1200) }} data-testid="portal-look-signin">
      <div className="flex items-center gap-2">
        <img src="/brand/icon-light.svg" alt="" className="h-8 w-8" />
        <img src="/brand/wordmark-light.svg" alt="" className="h-2 w-auto" />
      </div>
      <div>
        <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-[#C69F54]">Client portal</p>
        <p className="mt-1 text-[17px] font-bold leading-[1.12]">Your book, where it stands, whenever you want to look.</p>
        <div className="mt-2 h-[1.5px] w-8 rounded bg-[#C69F54]" />
        <p className="mt-2 text-[9px] leading-snug text-white/85">Every account you have handed over, what has been collected, your reports and your tickets.</p>
        <div className="mt-2.5 border-l border-[#C69F54] pl-2">
          <p className="text-[9px] italic text-white/90">“{look.line}”</p>
          {look.who && <p className="text-[8px] text-[#C69F54]">{look.who}</p>}
        </div>
      </div>
    </div>
  )
}
