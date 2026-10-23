import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Building2, ChevronDown, ChevronRight, Network } from 'lucide-react'
import { Card } from '../ui/Card'
import { UserAvatar } from '../ui/Avatar'
import { useAppStore } from '../../store/AppStore'
import { fetchFirmSettings } from '../../lib/firmSettings'
import { countOf } from '../../lib/orgStructure'
import { FOLD_AT, buildOrganogram, foldPeople, type OrgDepartmentNode, type OrgTeamNode } from '../../lib/organogram'
import type { User } from '../../types'

/**
 * THE ORGANOGRAM -- the third tab inside Settings -> Users (?users=organogram).
 *
 * THE FIRM (Stephan, 23 Oct): "like you see all users, departments and team, and then organogram. And
 * then you can go to the specific organograms, or ... if you go to the call center and you say view
 * organogram."
 *
 * READ-ONLY, ON PURPOSE. Departments & teams is where the structure is changed; a second place to
 * change it would be a second set of rules to keep in step with the database. Nothing here writes.
 * A person is not a link either: a row on All users opens nothing, and a node that went somewhere
 * the list does not would be a way in nobody built.
 *
 * TWO SHAPES, ONE DRAWING. The company hangs its departments side by side from the firm, each
 * department's teams hanging DOWN its own spine -- so the width is the number of departments, not
 * the number of teams, and on an iPad in portrait it scrolls sideways INSIDE ITS OWN BOX, never the
 * page. One department (?dept=) is the same subtree at the width of the screen, which is what makes
 * "a single department fits" true rather than hoped for. The connectors are plain spans with a
 * background, so a skin that re-colours slate re-colours the lines with everything else.
 *
 * THE FOCUS IS IN THE URL (?dept=, and ?team= to light one team), like the tab itself, so the
 * button on the department's pane is a link and Back leaves it.
 */

const LINE = 'bg-slate-300'

export function OrganogramTab() {
  const { users, teams, departments } = useAppStore()
  const [params, setParams] = useSearchParams()
  const focus = params.get('dept') || undefined
  const lit = params.get('team') || undefined
  const [firmName, setFirmName] = useState('Bredell Ferreira')
  /* Folded departments, not open ones, as on the tree: a drawing that opens closed shows nothing. */
  const [folded, setFolded] = useState<Set<string>>(() => new Set())

  /* The firm's own name off its settings; the literal until they load, and if they never do. */
  useEffect(() => {
    let alive = true
    fetchFirmSettings().then((f) => { if (alive && f.firmName?.trim()) setFirmName(f.firmName.trim()) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const known = focus ? departments.some((d) => d.id === focus) : true

  /* Is the company wider than its box? Measured, because it depends on the screen and on how many
     departments there are -- and the chart's width does not depend on the answer, so it settles. */
  const scroller = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setOverflowing(el.scrollWidth > el.clientWidth + 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [focus, known, departments.length])
  const anchored = !focus && overflowing
  const chart = useMemo(() => buildOrganogram(departments, teams, users, focus), [departments, teams, users, focus])

  const choose = (dept: string) => {
    const keep = new URLSearchParams(params)
    if (dept) keep.set('dept', dept); else keep.delete('dept')
    keep.delete('team')
    setParams(keep, { replace: true })
  }
  const toggle = (id: string) => setFolded((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const sortedDepts = useMemo(() => [...departments].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)), [departments])
  const columns = chart.departments.length + (chart.unplaced.length > 0 ? 1 : 0)

  return (
    <Card padded={false}>
      <div className="p-4 pb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100">
        <div className="min-w-0">
          <h3 className="font-semibold text-[15px] text-slate-800 flex items-center gap-1.5">
            <Network size={15} className="text-slate-400" /> Organogram
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {focus ? `${chart.departments[0]?.name ?? 'Department'} · ` : ''}{countOf(chart.headcount, 'person', 'people')}
          </p>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-slate-500">
          Show
          <select data-testid="organogram-focus" value={focus ?? ''} onChange={(e) => choose(e.target.value)}
            className="text-[13px] text-slate-700 border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none">
            <option value="">Whole company</option>
            {sortedDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      </div>

      {!known && (
        <p className="px-4 py-6 text-[13px] text-slate-500">
          That department is not here any more. Choose another above, or the whole company.
        </p>
      )}
      {known && departments.length === 0 && (
        <p className="px-4 py-6 text-[13px] text-slate-500">No departments yet. Make one on Departments &amp; teams.</p>
      )}

      {known && departments.length > 0 && (
        /* THE SCROLL IS HERE, NOT ON THE PAGE. min-w-full + w-max centres a narrow chart and lets a
           wide one run past the edge of this box only. */
        <div ref={scroller} className="overflow-x-auto overscroll-x-contain" data-testid="organogram-scroll">
          <div className={`${focus ? 'w-full' : 'w-max min-w-full'} px-4 py-5 flex flex-col ${anchored ? 'items-start' : 'items-center'}`}
            data-testid="organogram">
            {/* ANCHORED OVER THE FIRST DEPARTMENT when the chart is wider than its box: centred, the
                firm would sit off-screen in the middle of a chart that opens scrolled to its left
                edge. The box is one column wide, so its stub drops onto the first department's. */}
            <div className={`flex flex-col items-center ${anchored ? 'w-[17.75rem]' : ''}`}>
              <div className="rounded-xl bg-brand-600 text-white px-4 py-2.5 shadow-sm flex items-center gap-2" data-testid="organogram-firm">
                <Building2 size={16} className="opacity-80" />
                <span className="font-semibold text-[14px]">{firmName}</span>
              </div>
              <span className={`w-px h-5 ${LINE}`} aria-hidden />
            </div>
            <div className={focus ? 'w-full max-w-[40rem] flex' : 'flex items-start'}>
              {chart.departments.map((d, i) => (
                <Branch key={d.id} first={i === 0} last={i === columns - 1} grow={!!focus}>
                  <DepartmentColumn dept={d} wide={!!focus} lit={lit}
                    open={!folded.has(d.id)} onToggle={() => toggle(d.id)}
                    onFocus={focus ? undefined : () => choose(d.id)} />
                </Branch>
              ))}
              {chart.unplaced.length > 0 && (
                <Branch first={chart.departments.length === 0} last>
                  <div className="w-[16.5rem]">
                    <Group title="Not in a department" people={chart.unplaced} testid="organogram-unplaced"
                      hint="Put them in one on All users." />
                  </div>
                </Branch>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

/**
 * ONE CHILD ON THE BUS: the half-rules either side meet their neighbours' to make the line across,
 * and the stub drops to the node. The first has no left half and the last no right, so the line
 * ends over the outermost departments rather than running off past them.
 */
function Branch({ first, last, grow, children }: { first: boolean; last: boolean; grow?: boolean; children: ReactNode }) {
  return (
    <div className={`relative pt-5 px-2.5 ${grow ? 'flex-1 min-w-0' : ''}`}>
      {!first && <span className={`absolute top-0 left-0 right-1/2 h-px ${LINE}`} aria-hidden />}
      {!last && <span className={`absolute top-0 left-1/2 right-0 h-px ${LINE}`} aria-hidden />}
      <span className={`absolute top-0 left-1/2 w-px h-5 ${LINE}`} aria-hidden />
      {children}
    </div>
  )
}

function DepartmentColumn({ dept, wide, lit, open, onToggle, onFocus }: {
  dept: OrgDepartmentNode<User>
  wide: boolean
  lit?: string
  open: boolean
  onToggle: () => void
  onFocus?: () => void
}) {
  const children = [
    ...dept.teams.map((t) => ({ key: t.id, node: <TeamNode team={t} lit={t.id === lit} /> })),
    ...(dept.withoutTeam.length > 0
      ? [{ key: 'none', node: <Group title="Without a team" people={dept.withoutTeam} testid={`organogram-loose-${dept.name}`} /> }]
      : []),
  ]
  return (
    <div className={wide ? 'w-full' : 'w-[16.5rem]'} data-testid={`organogram-department-${dept.name}`}>
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-1 px-2.5 pt-2">
          <button type="button" onClick={onToggle} aria-expanded={open}
            aria-label={open ? `Fold ${dept.name}` : `Unfold ${dept.name}`}
            className="p-1 -ml-1 text-slate-400 hover:text-slate-700">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <span className="font-semibold text-[13.5px] text-slate-800 min-w-0 break-words">{dept.name}</span>
          <span className="ml-auto shrink-0 text-[11px] text-slate-400">{countOf(dept.headcount, 'person', 'people')}</span>
        </div>
        <div className="px-2.5 pb-2.5 pt-1.5">
          <Post person={dept.head} empty="No head yet" title="Head" testid={`organogram-head-${dept.name}`} />
        </div>
        {(onFocus || !open) && (
          <div className="flex items-center gap-2 px-2.5 pb-2 -mt-1 text-[11.5px]">
            {!open && <span className="text-slate-400">{countOf(dept.teams.length, 'team')}</span>}
            {onFocus && (
              <button type="button" onClick={onFocus} className="ml-auto font-medium text-brand-600 hover:text-brand-700">
                View organogram
              </button>
            )}
          </div>
        )}
      </div>
      {open && children.length > 0 && (
        /* THE SPINE: a rule down the left, an elbow into each node. The last child's rule stops at
           its elbow, so the line ends where the tree does. */
        <ul className="ml-5">
          {children.map((c, i) => (
            <li key={c.key} className="relative pl-5 pt-3">
              <span className={`absolute left-0 top-0 w-px ${LINE} ${i === children.length - 1 ? 'h-8' : 'bottom-0'}`} aria-hidden />
              <span className={`absolute left-0 top-8 w-5 h-px ${LINE}`} aria-hidden />
              {c.node}
            </li>
          ))}
        </ul>
      )}
      {open && children.length === 0 && (
        <p className="mt-2 text-center text-[11.5px] text-slate-400">No teams and nobody else yet.</p>
      )}
    </div>
  )
}

function TeamNode({ team, lit }: { team: OrgTeamNode<User>; lit: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  /* Arriving from a team's pane: that team, on screen and lit -- it may be the fifth of five. */
  useEffect(() => { if (lit) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [lit])
  return (
    <div ref={ref} data-testid={`organogram-team-${team.name}`} data-lit={lit || undefined}
      className={`rounded-xl border bg-white px-2.5 py-2 ${lit ? 'border-brand-400 ring-2 ring-brand-200' : 'border-slate-200'}`}>
      <div className="flex items-baseline gap-2">
        <span className="font-semibold text-[12.5px] text-slate-700 min-w-0 break-words">{team.name}</span>
        <span className="ml-auto shrink-0 text-[11px] text-slate-400">
          {countOf(team.members.length + (team.lead ? 1 : 0), 'person', 'people')}
        </span>
      </div>
      <div className="mt-1.5">
        <Post person={team.lead} empty="No lead yet" title="Lead" testid={`organogram-lead-${team.name}`} />
      </div>
      {team.members.length > 0 && (
        /* UNDER THE LEAD: the rule on the left is the line down from them. */
        <div className="ml-3 mt-1.5 pl-3 border-l border-slate-300">
          <People people={team.members} />
        </div>
      )}
    </div>
  )
}

/** A post and who holds it -- or, dashed, that nobody does. Vacant is drawn, never dropped. */
function Post({ person, empty, title, testid }: { person: User | null; empty: string; title: string; testid: string }) {
  if (!person) {
    return (
      <div data-testid={testid} data-vacant
        className="rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-[12px] italic text-slate-400">
        {empty}
      </div>
    )
  }
  return (
    <div data-testid={testid} className="flex items-center gap-2 min-w-0">
      <UserAvatar userId={person.id} size={28} />
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-slate-800 break-words" title={person.name}>{person.name}</p>
        <p className="text-[11px] text-slate-400 truncate">{title} · {person.role}</p>
      </div>
    </div>
  )
}

/** "Without a team" and "Not in a department": nobody is left off, and the group says what it is. */
function Group({ title, people, testid, hint }: { title: string; people: User[]; testid: string; hint?: string }) {
  return (
    <div data-testid={testid} className="rounded-xl border border-dashed border-slate-300 px-2.5 py-2">
      <div className="flex items-baseline gap-2">
        <span className="italic font-medium text-[12.5px] text-slate-500">{title}</span>
        <span className="ml-auto shrink-0 text-[11px] text-slate-400">{countOf(people.length, 'person', 'people')}</span>
      </div>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
      <div className="mt-1.5"><People people={people} /></div>
    </div>
  )
}

/** The compact list under a lead: avatar and name, folded past eight with "+N more". */
function People({ people }: { people: User[] }) {
  const [open, setOpen] = useState(false)
  const { shown, hidden } = foldPeople(people, open)
  return (
    /* One column in a company column; as many as fit when one department has the screen. */
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(9.5rem,100%),1fr))] gap-x-3 gap-y-1">
      {shown.map((p) => (
        <li key={p.id} className="flex items-center gap-1.5 min-w-0" title={`${p.name} · ${p.role}`}>
          <UserAvatar userId={p.id} size={18} />
          <span className="text-[12px] text-slate-600 truncate">{p.name}</span>
        </li>
      ))}
      {hidden > 0 && (
        <li className="col-span-full">
          <button type="button" onClick={() => setOpen(true)} className="text-[11.5px] font-medium text-brand-600 hover:text-brand-700">
            +{hidden} more
          </button>
        </li>
      )}
      {open && people.length > FOLD_AT && (
        <li className="col-span-full">
          <button type="button" onClick={() => setOpen(false)} className="text-[11.5px] font-medium text-slate-400 hover:text-slate-600">
            Show fewer
          </button>
        </li>
      )}
    </ul>
  )
}
