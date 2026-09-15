import { useEffect, useRef, useState } from 'react'
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { inputClass } from '../../components/ui/Modal'
import {
  PRESCRIBING_CHOICES, QUIET_CHOICES, STATUS_GROUPS, filterChips, type FilterParam,
} from '../../lib/accountFilters'
import type { BookFacets } from '../../lib/accountBook'
import type { Team, User } from '../../types'

/**
 * Narrowing the book.
 *
 * ONE PANEL, NOT A ROW OF DROPDOWNS. Thirteen filters across a toolbar is a toolbar nobody reads
 * and, on the iPads the team actually use, a toolbar three lines deep before a single account is
 * visible. Folded away, the bar stays one line; opened, the filters are grouped by the question
 * they answer rather than by the column they happen to sit in.
 *
 * The grouping is the point. "Delinquent Payer" and "nothing logged in 60 days" are both filters
 * and they are not the same kind of thing at all: the first describes the DEBTOR, the second
 * describes US. A manager hunting neglect wants the second group and nothing else, and putting
 * them in one alphabetical list would bury it.
 *
 * Every filter is applied in the database (see fetchAccounts). None of this is a client-side
 * `.filter()` over a page of fifty, which would produce a list that is correct about the fifty
 * and wrong about the book.
 */
export function AccountFilters({ params, setParam, onClear, facets, users, teams, canSeeOthers }: {
  params: URLSearchParams
  setParam: (key: string, value: string | null) => void
  /** Drops every filter key in one navigation, rather than thirteen re-queries on the way. */
  onClear: () => void
  facets: BookFacets | null
  users: User[]
  teams: Team[]
  /** Team leaders and administrators pick a desk; an agent's book is their own. */
  canSeeOthers: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const chips = filterChips(params, {
    userName: (id) => users.find((u) => u.id === id)?.name,
    teamName: (id) => teams.find((t) => t.id === id)?.name,
  })

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <div ref={ref} className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)}
          className={`inline-flex items-center gap-1.5 text-sm rounded-lg border px-2.5 py-1.5 ${
            chips.length > 0
              ? 'border-brand-200 bg-brand-50 text-brand-700'
              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
          <SlidersHorizontal size={14} className="shrink-0 opacity-70" />
          <span>Filters</span>
          {chips.length > 0 && (
            <span className="tabular-nums text-[11px] font-semibold rounded-full bg-brand-600 text-white px-1.5">
              {chips.length}
            </span>
          )}
          <ChevronDown size={14} className={`shrink-0 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="absolute left-0 top-full mt-1.5 w-[22rem] max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto bg-white rounded-xl shadow-lg border border-slate-100 z-40">
            <div className="p-3.5 space-y-4">
              <Group heading="Where the account stands" note="As it came across from Swordfish.">
                <Row label="Status">
                  <Select value={params.get('status') ?? ''} onChange={(v) => setParam('status', v)}>
                    <option value="">Any status</option>
                    {STATUS_GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                  </Select>
                </Row>
                <Row label="Sub-status">
                  <Select value={params.get('sub') ?? ''} onChange={(v) => setParam('sub', v)}>
                    <option value="">Any sub-status</option>
                    {(facets?.subStatuses ?? []).map((s) => (
                      <option key={s.value} value={s.value}>{s.value} ({s.accounts})</option>
                    ))}
                  </Select>
                </Row>
                {/*
                  NO BUCKET CONTROL. "Bucket" is Swordfish's word for its own work queue — Diary,
                  PTPs, Failed PTPs — and nobody at the firm uses it, so as a filter label it was
                  a question people could not answer. Its one piece of real information survives
                  as the "Broken promises" view, which reads bucket = 'Failed PTPs' because that
                  column is more truthful than the sub-status: 40 accounts against 3.
                */}
              </Group>

              {canSeeOthers && (
                <Group heading="Whose desk">
                  <Row label="Agent">
                    <Select value={params.get('who') ?? ''} onChange={(v) => setParam('who', v)}>
                      <option value="">Anyone</option>
                      {/* The unallocated pile is a filter, not an absence — 355 accounts sat in
                          it at import and nobody could ask for them. */}
                      <option value="nobody">On nobody’s desk</option>
                      {users.filter((u) => u.status === 'Active').map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </Select>
                  </Row>
                  {/*
                    A team is a set of desks, and it is the question a manager actually asks —
                    "how is pre-legal doing" rather than "how is each of these four people doing".
                    Only offered where teams exist; an empty dropdown is a promise the app cannot
                    keep.
                  */}
                  {teams.length > 0 && (
                    <Row label="Team">
                      <Select value={params.get('team') ?? ''} onChange={(v) => setParam('team', v)}>
                        <option value="">Any team</option>
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.memberIds.length})
                          </option>
                        ))}
                      </Select>
                    </Row>
                  )}
                </Group>
              )}

              {/*
                OUR FAULTS, NOT THE DEBTOR'S. Everything above describes the account; everything
                here describes what the firm has failed to do with it. Kept apart because this is
                the group a team leader opens on a Monday, and it is worth finding in one look.
              */}
              <Group heading="Accounts nobody is working">
                <Check param="adrift" params={params} setParam={setParam}
                  label="No diary date" note="Live, and nobody is booked to ring it." />
                <Check param="never" params={params} setParam={setParam}
                  label="Never worked" note="Handed over, and not one action logged since." />
                <Row label="Gone quiet">
                  <Select value={params.get('quiet') ?? ''} onChange={(v) => setParam('quiet', v)}>
                    <option value="">Any</option>
                    {QUIET_CHOICES.map((c) => (
                      <option key={c.days} value={String(c.days)}>{c.label}</option>
                    ))}
                  </Select>
                </Row>
              </Group>

              <Group heading="Money and time">
                <Row label="Prescription">
                  <Select value={params.get('presc') ?? ''} onChange={(v) => setParam('presc', v)}>
                    <option value="">Any</option>
                    {PRESCRIBING_CHOICES.map((c) => (
                      <option key={c.days} value={String(c.days)}>{c.label}</option>
                    ))}
                  </Select>
                </Row>
                <Row label="Outstanding">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 text-sm">R</span>
                    <input type="number" min={0} step={1000} className={inputClass}
                      placeholder="0 or more"
                      value={params.get('min') ?? ''}
                      onChange={(e) => setParam('min', e.target.value)} />
                  </div>
                </Row>
                <Check param="duplum" params={params} setParam={setParam}
                  label="In duplum" note="Interest and fees have reached the capital; they may not grow." />
                <Check param="waiting" params={params} setParam={setParam}
                  label="Waiting on the client" note="We have asked them for something and cannot move until it comes." />
                {/*
                  Mandate drift is not a filter here any more, at the firm's instruction. The
                  summary tile above still counts it and still links through, because 60 accounts
                  billed at a rate that disagrees with a signed mandate is money, and the tile is
                  the one place it is visible at all.
                */}
              </Group>

              <Group heading="Handed over">
                <div className="flex items-center gap-2">
                  <input type="date" className={inputClass} value={params.get('from') ?? ''}
                    onChange={(e) => setParam('from', e.target.value)} aria-label="Handed over from" />
                  <span className="text-slate-400 text-sm shrink-0">to</span>
                  <input type="date" className={inputClass} value={params.get('to') ?? ''}
                    onChange={(e) => setParam('to', e.target.value)} aria-label="Handed over up to" />
                </div>
              </Group>
            </div>

            <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-t border-slate-100 bg-slate-50/60 rounded-b-xl">
              <button type="button" className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-40"
                disabled={chips.length === 0} onClick={onClear}>
                Clear filters
              </button>
              <button type="button" className="btn-secondary text-xs" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        )}
      </div>

      {/*
        The filters, in words, outside the panel. Once the panel is shut the only thing standing
        between a person and a wrong conclusion is knowing what has been hidden — and a short
        list looks like good news whether or not it is.
      */}
      {chips.map((c) => (
        <button key={`${c.param}:${c.label}`} type="button"
          onClick={() => setParam(c.param, null)}
          title="Remove this filter"
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 bg-brand-50 border border-brand-200 rounded-full pl-2.5 pr-1.5 py-1 hover:bg-brand-100">
          {c.label}
          <X size={12} className="opacity-60" />
        </button>
      ))}
    </>
  )
}

function Group({ heading, note, children }: { heading: string; note?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{heading}</p>
      {note && <p className="text-[11px] text-slate-400 mt-0.5">{note}</p>}
      <div className="mt-1.5 space-y-1.5">{children}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[6rem_1fr] items-center gap-2">
      <span className="text-xs text-slate-500">{label}</span>
      {children}
    </label>
  )
}

function Select({ value, onChange, children }: {
  value: string; onChange: (v: string) => void; children: React.ReactNode
}) {
  return (
    <select className={`${inputClass} text-sm`} value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  )
}

function Check({ param, params, setParam, label, note }: {
  param: FilterParam
  params: URLSearchParams
  setParam: (key: string, value: string | null) => void
  label: string
  note: string
}) {
  const on = params.get(param) === '1'
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" className="mt-0.5 shrink-0 accent-brand-600" checked={on}
        onChange={() => setParam(param, on ? null : '1')} />
      <span className="min-w-0">
        <span className="block text-sm text-slate-700 leading-tight">{label}</span>
        <span className="block text-[11px] text-slate-400 leading-snug">{note}</span>
      </span>
    </label>
  )
}
