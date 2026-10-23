import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Building2, Check, ChevronDown, ChevronRight, Network, Pencil, Plus, Trash2, Users, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { UserAvatar } from '../ui/Avatar'
import { Modal, FormField, inputClass, controlClass } from '../ui/Modal'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { teamsForRole } from '../../lib/departments'
import { DUTIES, type Duty } from '../../lib/duties'
import {
  countOf, dutyTicks, membersOfDepartment, membersOfTeam, placeInDepartment, placeInTeam,
  sortDepartments, suggestedKind, teamsIn, whyNotRemoveDepartment, whyNotRemoveTeam,
  withoutDepartment, withoutTeam,
} from '../../lib/orgStructure'
import type { DepartmentRow, Team, TeamKind, User } from '../../types'

/**
 * DEPARTMENTS & TEAMS -- the second tab inside Settings -> Users.
 *
 * THE FIRM (Stephan, 23 Oct): "There's two different tabs for users and designing teams ... this
 * should live in the same environment." And: "There should be an option to create a department. To
 * create a team and to set the team lead."
 *
 * A TREE ON THE LEFT, A PANE ON THE RIGHT, stacked on a narrow screen -- the firm works on an iPad,
 * and a two-column layout squeezed into portrait is two unreadable columns. The tree answers "what is
 * there"; the pane is where it is changed. Nothing about who may DO what lives here: that is the role
 * and the capability screen on All users. A department's duties are the one exception, and they are
 * a closed list (duties.ts).
 *
 * EVERY RULE IS ALSO THE DATABASE'S. A lead who is not a member, a head outside the department, a
 * team removed with people in it -- each is refused by Postgres and the sentence it refuses with is
 * what the toast shows. The screen only avoids offering what will be refused.
 */

type Selection = { kind: 'department' | 'team'; id: string } | { kind: 'unplaced' } | null

const KIND_LABEL: Record<TeamKind, string> = {
  Sales: 'Sales roles',
  Communications: 'Communications roles',
  'Call centre': 'Call centre roles',
}
const KINDS: TeamKind[] = ['Sales', 'Communications', 'Call centre']

const smallSelect = 'text-[12px] text-slate-600 border border-slate-200 rounded-md px-1.5 py-1 bg-white outline-none max-w-full'
const nameOf = (users: User[], id: string | undefined) => (id ? users.find((u) => u.id === id)?.name : undefined)

export function DepartmentsTeamsTab() {
  const {
    users, teams, departments, addDepartment, updateDepartment, deleteDepartment,
    addTeam, updateTeam, deleteTeam, updateUser,
  } = useAppStore()
  const { currentUser } = useAuth()
  const isAdmin = currentUser?.role === 'Administrator'
  const sorted = useMemo(() => sortDepartments(departments), [departments])
  const unplaced = useMemo(() => withoutDepartment(users), [users])

  const [selected, setSelected] = useState<Selection>(null)
  /* Folded departments, not open ones: a tree that opens closed answers nothing on arrival. */
  const [folded, setFolded] = useState<Set<string>>(() => new Set())
  const [adding, setAdding] = useState<null | 'department' | 'team'>(null)
  /*
   * "IF YOU GO TO THE CALL CENTER AND YOU SAY VIEW ORGANOGRAM" (the firm, 23 Oct). The Organogram tab,
   * focused on this department -- and from a team, on its department with that team lit. A URL, so
   * Back returns here.
   */
  const [params, setParams] = useSearchParams()
  const viewOrganogram = (deptId: string, teamId?: string) => {
    const keep = new URLSearchParams(params)
    keep.set('users', 'organogram')
    keep.set('dept', deptId)
    if (teamId) keep.set('team', teamId); else keep.delete('team')
    setParams(keep)
  }

  /* Nothing chosen yet: the first department, so the pane is never an empty box. */
  const current: Selection = selected ?? (sorted[0] ? { kind: 'department', id: sorted[0].id } : null)
  const currentDept = current?.kind === 'department' ? sorted.find((d) => d.id === current.id) : undefined
  const currentTeam = current?.kind === 'team' ? teams.find((t) => t.id === current.id) : undefined
  const isSel = (kind: 'department' | 'team', id: string) => current?.kind === kind && 'id' in current && current.id === id

  const toggle = (id: string) => setFolded((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)] items-start" data-testid="departments-teams">
      {/* ------------------------------------------------------------------ the tree */}
      <Card padded={false}>
        <div className="p-4 pb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100">
          <div>
            <h3 className="font-semibold text-[15px] text-slate-800">Departments</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {countOf(sorted.length, 'department')} · {countOf(teams.length, 'team')}
            </p>
          </div>
          {isAdmin && (
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setAdding('department')} data-testid="add-department"
                className="inline-flex items-center gap-1 text-[12.5px] font-medium px-2.5 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
                <Plus size={14} /> Department
              </button>
              {/* No department, no team: a team must sit somewhere, so the button waits for one. */}
              <button type="button" onClick={() => setAdding('team')} data-testid="add-team"
                disabled={sorted.length === 0}
                title={sorted.length === 0 ? 'Make a department first -- every team sits in one' : 'Add a team to a department'}
                className="inline-flex items-center gap-1 text-[12.5px] font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed">
                <Plus size={14} /> Team
              </button>
            </div>
          )}
        </div>
        <ul className="py-1 text-[13px]" data-testid="org-tree">
          {sorted.map((d) => {
            const open = !folded.has(d.id)
            const dTeams = teamsIn(d.id, teams)
            const loose = withoutTeam(d.id, users)
            const head = nameOf(users, d.headId)
            return (
              <li key={d.id}>
                <div className={`flex items-center gap-1 px-2 ${isSel('department', d.id) ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                  <button type="button" onClick={() => toggle(d.id)} aria-expanded={open}
                    aria-label={open ? `Fold ${d.name}` : `Unfold ${d.name}`}
                    className="p-1 text-slate-400 hover:text-slate-700">
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <button type="button" onClick={() => setSelected({ kind: 'department', id: d.id })}
                    data-testid={`tree-department-${d.name}`}
                    className="flex-1 min-w-0 text-left py-2">
                    <span className="flex items-center gap-1.5">
                      <Building2 size={14} className="text-slate-400 shrink-0" />
                      <span className="font-semibold text-slate-800 truncate">{d.name}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-slate-400">{membersOfDepartment(d.id, users).length}</span>
                    </span>
                    <span className="block text-[11px] text-slate-400 truncate pl-5">
                      {head ? `Head: ${head}` : 'No head yet'}
                    </span>
                  </button>
                </div>
                {open && (
                  <ul className="pl-7">
                    {dTeams.map((t) => (
                      <li key={t.id}>
                        <button type="button" onClick={() => setSelected({ kind: 'team', id: t.id })}
                          data-testid={`tree-team-${t.name}`}
                          className={`w-full text-left px-2 py-1.5 rounded-md ${isSel('team', t.id) ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                          <span className="flex items-center gap-1.5">
                            <Users size={13} className="text-slate-400 shrink-0" />
                            <span className="text-slate-700 truncate">{t.name}</span>
                            <span className="ml-auto shrink-0 text-[11px] text-slate-400">{t.memberIds.length}</span>
                          </span>
                          <span className="block text-[11px] text-slate-400 truncate pl-5">
                            {nameOf(users, t.leadId) ? `Lead: ${nameOf(users, t.leadId)}` : 'No lead yet'}
                          </span>
                        </button>
                      </li>
                    ))}
                    {/* THE PEOPLE IN NO TEAM, named rather than left out -- reception is one person in a
                        department with no team at all, and that is correct, not unfinished. */}
                    {loose.length > 0 && (
                      <li>
                        <button type="button" onClick={() => setSelected({ kind: 'department', id: d.id })}
                          className="w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-50 flex items-center gap-1.5 text-slate-500">
                          <span className="italic">Without a team</span>
                          <span className="ml-auto text-[11px] text-slate-400">{loose.length}</span>
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </li>
            )
          })}
          {unplaced.length > 0 && (
            <li>
              <button type="button" onClick={() => setSelected({ kind: 'unplaced' })}
                className={`w-full text-left px-3 py-2 flex items-center gap-1.5 text-slate-500 ${current?.kind === 'unplaced' ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                <span className="italic">Not in a department</span>
                <span className="ml-auto text-[11px] text-slate-400">{unplaced.length}</span>
              </button>
            </li>
          )}
          {sorted.length === 0 && (
            <li className="px-4 py-3 text-slate-400 text-[12.5px]">No departments yet.</li>
          )}
        </ul>
      </Card>

      {/* ------------------------------------------------------------------ the pane */}
      <div className="min-w-0">
        {currentDept && (
          <DepartmentPane key={currentDept.id} dept={currentDept} isAdmin={isAdmin}
            onSelectTeam={(id) => setSelected({ kind: 'team', id })}
            onAddTeam={() => setAdding('team')}
            onRemoved={() => setSelected(null)}
            onViewOrganogram={() => viewOrganogram(currentDept.id)}
            {...{ users, teams, updateDepartment, deleteDepartment, updateUser }} />
        )}
        {currentTeam && (
          <TeamPane key={currentTeam.id} team={currentTeam} isAdmin={isAdmin} departments={sorted}
            onSelectDepartment={(id) => setSelected({ kind: 'department', id })}
            onRemoved={() => setSelected({ kind: 'department', id: currentTeam.departmentId ?? '' })}
            onViewOrganogram={currentTeam.departmentId ? () => viewOrganogram(currentTeam.departmentId!, currentTeam.id) : undefined}
            {...{ users, updateTeam, deleteTeam, updateUser }} />
        )}
        {current?.kind === 'unplaced' && (
          <Card>
            <h3 className="font-semibold text-[15px] text-slate-800">Not in a department</h3>
            <p className="text-xs text-slate-400 mt-0.5 mb-3">
              Put each person where they sit. Choosing a team on All users places them in its department too.
            </p>
            <PeopleList people={unplaced} render={(u) => isAdmin ? (
              <select className={smallSelect} value="" aria-label={`Department for ${u.name}`}
                onChange={(e) => e.target.value && updateUser(u.id, placeInDepartment(e.target.value))}>
                <option value="">Put in a department…</option>
                {sorted.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            ) : null} />
          </Card>
        )}
      </div>

      {adding === 'department' && (
        <NewDepartmentModal existing={sorted} onClose={() => setAdding(null)}
          onSave={(name) => { const d = addDepartment({ name }); setSelected({ kind: 'department', id: d.id }); setAdding(null) }} />
      )}
      {adding === 'team' && (
        <NewTeamModal departments={sorted} teams={teams}
          initialDepartment={currentDept?.id ?? currentTeam?.departmentId ?? sorted[0]?.id ?? ''}
          onClose={() => setAdding(null)}
          onSave={(input) => { const t = addTeam(input); setSelected({ kind: 'team', id: t.id }); setAdding(null) }} />
      )}
    </div>
  )
}

/* ====================================================================== the department pane */

function DepartmentPane({ dept, users, teams, isAdmin, updateDepartment, deleteDepartment, updateUser, onSelectTeam, onAddTeam, onRemoved, onViewOrganogram }: {
  dept: DepartmentRow
  users: User[]
  teams: Team[]
  isAdmin: boolean
  updateDepartment: (id: string, patch: Partial<Pick<DepartmentRow, 'name' | 'headId' | 'duties'>>) => void
  deleteDepartment: (id: string) => void
  updateUser: (id: string, patch: Partial<User>) => void
  onSelectTeam: (id: string) => void
  onAddTeam: () => void
  onRemoved: () => void
  onViewOrganogram: () => void
}) {
  const members = membersOfDepartment(dept.id, users)
  const dTeams = teamsIn(dept.id, teams)
  const head = users.find((u) => u.id === dept.headId)
  const whyNot = whyNotRemoveDepartment(dept, teams, users)
  const others = users.filter((u) => u.status !== 'Inactive' && u.departmentId !== dept.id)
    .sort((a, b) => a.name.localeCompare(b.name))
  const [confirming, setConfirming] = useState(false)

  return (
    <Card>
      <PaneTitle name={dept.name} kind="Department" isAdmin={isAdmin}
        onRename={(name) => updateDepartment(dept.id, { name })}
        onRemove={() => setConfirming(true)} whyNotRemove={whyNot} />
      <ViewOrganogram onClick={onViewOrganogram} testid="department-view-organogram" />

      <Section title="Head">
        <PostHolder holder={head} empty="No head yet" isAdmin={isAdmin} label={`Head of ${dept.name}`}
          choices={members} onChange={(id) => updateDepartment(dept.id, { headId: id })}
          hint="Chosen from the people in this department." testid="department-head" />
      </Section>

      <Section title={`Teams · ${dTeams.length}`} action={isAdmin ? (
        <button type="button" onClick={onAddTeam} className="text-[12px] font-medium text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">
          <Plus size={13} /> Team
        </button>
      ) : undefined}>
        {/* The teams themselves are listed under People below, each with its lead and members. */}
        {dTeams.length === 0 && <p className="text-[12.5px] text-slate-400">No teams. People can sit in a department without one.</p>}
      </Section>

      {/*
        READ AS THE FIRM RUNS IT: HEAD, THEN EACH TEAM UNDER ITS LEAD, THEN WHOEVER HAS NO TEAM YET.
        The firm, 23 Oct: "it should be call center head, team leaders, and then the teams and
        everybody ... arranged according to their team." A flat list with the team as a grey word
        on the right made the call centre read as fourteen people rather than three teams, and
        moving somebody meant going to the team they were leaving. Each row moves them from here.
      */}
      <Section title={`People · ${members.length}`}>
        <div className="space-y-3" data-testid="department-people">
          {[...dTeams.map((t) => ({
            key: t.id, title: t.name, team: t as Team | undefined,
            lead: users.find((u) => u.id === t.leadId),
            people: membersOfTeam(t.id, members).filter((u) => u.id !== dept.headId)
              .sort((a, b) => Number(b.id === t.leadId) - Number(a.id === t.leadId) || a.name.localeCompare(b.name)),
          })), {
            key: 'none', title: 'Without a team', team: undefined as Team | undefined, lead: undefined as User | undefined,
            people: withoutTeam(dept.id, members).filter((u) => u.id !== dept.headId),
          }].filter((g) => g.team || g.people.length > 0).map((g) => (
            <div key={g.key} data-testid={`department-group-${g.title}`}>
              <div className="flex items-baseline gap-2 mb-1">
                {g.team ? (
                  <button type="button" onClick={() => onSelectTeam(g.team!.id)}
                    className="text-[12.5px] font-semibold text-slate-700 hover:text-brand-700">{g.title}</button>
                ) : <span className="text-[12.5px] font-semibold italic text-slate-500">{g.title}</span>}
                <span className="text-[11.5px] text-slate-400">
                  {g.team ? (g.lead ? `Lead: ${g.lead.name}` : 'No lead yet') : ''}
                  {` · ${countOf(g.people.length, 'person', 'people')}`}
                </span>
              </div>
              <PeopleList people={g.people} render={(u) => {
                if (!isAdmin) return null
                const isLead = !!g.team && u.id === g.team.leadId
                const choices = teamsForRole(u.role, dTeams)
                return (
                  <>
                    {isLead && <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Lead</span>}
                    {/* A LEAD STAYS PUT UNTIL SOMEBODY ELSE LEADS -- the database refuses it too. */}
                    {!isLead && choices.length > 0 && (
                      <select className={smallSelect} value={u.teamId ?? ''} aria-label={`Team for ${u.name}`}
                        onChange={(e) => updateUser(u.id, e.target.value
                          ? placeInTeam(dTeams.find((t) => t.id === e.target.value), u)
                          : placeInDepartment(dept.id))}>
                        <option value="">No team</option>
                        {choices.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    )}
                    {!isLead && (
                      <button type="button" title={`Take ${u.name} out of ${dept.name}`} aria-label={`Take ${u.name} out of ${dept.name}`}
                        onClick={() => updateUser(u.id, placeInDepartment(undefined))}
                        className="text-slate-400 hover:text-[var(--c-rust-deep)]"><X size={13} /></button>
                    )}
                  </>
                )
              }} />
            </div>
          ))}
        </div>
        {isAdmin && others.length > 0 && (
          <select className={`${smallSelect} mt-2`} value="" aria-label={`Add somebody to ${dept.name}`}
            onChange={(e) => e.target.value && updateUser(e.target.value, placeInDepartment(dept.id))}>
            <option value="">+ Add somebody to {dept.name}…</option>
            {others.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.role}</option>)}
          </select>
        )}
      </Section>

      <Section title="Duties">
        <p className="text-[11.5px] text-slate-400 mb-2">
          What this department’s people do on top of their role. A duty never reaches money, trust, pay or settings —
          those stay with the role and each person’s own permissions.
        </p>
        <div className="space-y-2" data-testid="department-duties">
          {dutyTicks(dept).map(({ duty, on }) => (
            <label key={duty} className={`flex items-start gap-2.5 ${isAdmin ? 'cursor-pointer' : ''}`}>
              <input type="checkbox" className="mt-0.5" checked={on} disabled={!isAdmin}
                onChange={(e) => updateDepartment(dept.id, {
                  duties: e.target.checked ? [...dept.duties, duty] : dept.duties.filter((x) => x !== duty),
                })} />
              <span className="text-[13px] text-slate-700">
                {DUTIES[duty as Duty].label}
                <span className="block text-[11.5px] text-slate-400">{DUTIES[duty as Duty].blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </Section>

      {confirming && (
        <ConfirmRemove what={dept.name} onCancel={() => setConfirming(false)}
          onConfirm={() => { deleteDepartment(dept.id); setConfirming(false); onRemoved() }} />
      )}
    </Card>
  )
}

/* ====================================================================== the team pane */

function TeamPane({ team, users, departments, isAdmin, updateTeam, deleteTeam, updateUser, onSelectDepartment, onRemoved, onViewOrganogram }: {
  team: Team
  users: User[]
  departments: DepartmentRow[]
  isAdmin: boolean
  updateTeam: (id: string, patch: Partial<Pick<Team, 'name' | 'kind' | 'departmentId' | 'leadId'>>) => void
  deleteTeam: (id: string) => void
  updateUser: (id: string, patch: Partial<User>) => void
  onSelectDepartment: (id: string) => void
  onRemoved: () => void
  onViewOrganogram?: () => void
}) {
  const members = membersOfTeam(team.id, users)
  const lead = users.find((u) => u.id === team.leadId)
  const dept = departments.find((d) => d.id === team.departmentId)
  const whyNot = whyNotRemoveTeam(team, users)
  /* Only people whose ROLE may join this kind of team -- the database refuses the rest, and a picker
     that offers and then refuses is the bug the firm hit on 22 Oct. */
  const notHere = users.filter((u) => u.status !== 'Inactive' && u.teamId !== team.id)
  const joinable = notHere
    .filter((u) => teamsForRole(u.role, [team]).length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
  const cannotJoin = notHere.length - joinable.length
  const [confirming, setConfirming] = useState(false)

  return (
    <Card>
      <PaneTitle name={team.name} kind="Team" isAdmin={isAdmin}
        onRename={(name) => updateTeam(team.id, { name })}
        onRemove={() => setConfirming(true)} whyNotRemove={whyNot} />
      {onViewOrganogram && <ViewOrganogram onClick={onViewOrganogram} testid="team-view-organogram" />}

      <Section title="Department">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          {dept ? (
            <button type="button" onClick={() => onSelectDepartment(dept.id)} className="font-medium text-brand-600 hover:underline">{dept.name}</button>
          ) : <span className="text-slate-400">None</span>}
          {isAdmin && departments.length > 1 && (
            <select className={smallSelect} value="" aria-label={`Move ${team.name} to another department`}
              data-testid="team-move"
              onChange={(e) => e.target.value && updateTeam(team.id, { departmentId: e.target.value })}>
              <option value="">Move to…</option>
              {departments.filter((d) => d.id !== team.departmentId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
        </div>
        <p className="text-[11.5px] text-slate-400 mt-1">Its people move with it.</p>
      </Section>

      <Section title="Lead">
        <PostHolder holder={lead} empty="No lead yet" isAdmin={isAdmin} label={`Lead of ${team.name}`}
          choices={members} onChange={(id) => updateTeam(team.id, { leadId: id })}
          hint="Chosen from the team's members." testid="team-lead" />
      </Section>

      <Section title={`Members · ${members.length}`}>
        <PeopleList people={members} render={(u) => {
          if (!isAdmin) return null
          /* THE LEAD STAYS UNTIL SOMEBODY ELSE LEADS. The database refuses it too; the button says so
             before it is pressed rather than after. */
          if (u.id === team.leadId) return <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400" title="Choose another lead before taking them out">Lead</span>
          return (
            <button type="button" title={`Take ${u.name} out of ${team.name}`} aria-label={`Take ${u.name} out of ${team.name}`}
              onClick={() => updateUser(u.id, placeInTeam(undefined, u))}
              className="text-slate-400 hover:text-[var(--c-rust-deep)]"><X size={13} /></button>
          )
        }} />
        {isAdmin && joinable.length > 0 && (
          <select className={`${smallSelect} mt-2`} value="" aria-label={`Add a member to ${team.name}`} data-testid="team-add-member"
            onChange={(e) => e.target.value && updateUser(e.target.value, placeInTeam(team, {}))}>
            <option value="">+ Add member…</option>
            {joinable.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.role}</option>)}
          </select>
        )}
        {/* AND WHY THE REST ARE NOT OFFERED, said rather than left to be wondered about. */}
        {isAdmin && cannotJoin > 0 && (
          <p className="text-[11px] text-slate-400 mt-1" data-testid="team-cannot-join">
            {countOf(cannotJoin, 'person', 'people')} can’t join because of their role: this team takes {KIND_LABEL[team.kind].toLowerCase()}.
          </p>
        )}
      </Section>

      <Section title="Who may join">
        {isAdmin ? (
          <select className={smallSelect} value={team.kind} aria-label="Which roles may join this team"
            onChange={(e) => updateTeam(team.id, { kind: e.target.value as TeamKind })}>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        ) : <span className="text-[13px] text-slate-600">{KIND_LABEL[team.kind]}</span>}
        <p className="text-[11.5px] text-slate-400 mt-1">
          A pre-legal agent works in a call centre team, a liaison in a communications team. Administrators may join any.
        </p>
      </Section>

      {confirming && (
        <ConfirmRemove what={team.name} onCancel={() => setConfirming(false)}
          onConfirm={() => { deleteTeam(team.id); setConfirming(false); onRemoved() }} />
      )}
    </Card>
  )
}

/* ====================================================================== the pieces */

/** Everybody who can see this pane may see the drawing: it is read-only, so it is not an admin's button. */
function ViewOrganogram({ onClick, testid }: { onClick: () => void; testid: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testid}
      className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">
      <Network size={14} className="text-slate-400" /> View organogram
    </button>
  )
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="pt-4 mt-4 border-t border-slate-100 first-of-type:mt-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  )
}

function PaneTitle({ name, kind, isAdmin, onRename, onRemove, whyNotRemove }: {
  name: string
  kind: 'Department' | 'Team'
  isAdmin: boolean
  onRename: (name: string) => void
  onRemove: () => void
  whyNotRemove: string | null
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (value.trim() && value.trim() !== name) onRename(value.trim())
    setEditing(false)
  }
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      {editing ? (
        <form onSubmit={submit} className="flex items-center gap-2 flex-1 min-w-0">
          <input autoFocus className={`${controlClass} flex-1 min-w-0 py-1`} value={value}
            aria-label={`${kind} name`} onChange={(e) => setValue(e.target.value)} />
          <button type="submit" className="text-brand-600" title="Save"><Check size={16} /></button>
          <button type="button" onClick={() => { setValue(name); setEditing(false) }} className="text-slate-400" title="Cancel"><X size={16} /></button>
        </form>
      ) : (
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">{kind}</p>
          <h3 className="font-semibold text-[17px] text-slate-800 truncate" data-testid="pane-title">{name}</h3>
        </div>
      )}
      {isAdmin && !editing && (
        <div className="flex items-center gap-2.5 shrink-0">
          <button type="button" onClick={() => { setValue(name); setEditing(true) }}
            className="text-slate-400 hover:text-brand-600" title={`Rename ${kind.toLowerCase()}`}><Pencil size={14} /></button>
          {/* REMOVED ONLY WHEN EMPTY, and the button says why when it is not. */}
          <button type="button" onClick={onRemove} disabled={!!whyNotRemove}
            title={whyNotRemove ?? `Remove this ${kind.toLowerCase()}`}
            className="text-slate-400 hover:text-[var(--c-rust-deep)] disabled:opacity-40 disabled:hover:text-slate-400 disabled:cursor-not-allowed">
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

function PostHolder({ holder, empty, isAdmin, label, choices, onChange, hint, testid }: {
  holder: User | undefined
  empty: string
  isAdmin: boolean
  label: string
  choices: User[]
  onChange: (id: string | undefined) => void
  hint: string
  testid: string
}) {
  const [changing, setChanging] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]" data-testid={testid}>
      {holder ? (
        <span className="inline-flex items-center gap-1.5"><UserAvatar userId={holder.id} size={20} />
          <span className="font-medium text-slate-700">{holder.name}</span>
          <span className="text-slate-400 text-[12px]">{holder.role}</span></span>
      ) : <span className="text-slate-400">{empty}</span>}
      {isAdmin && !changing && (
        <button type="button" onClick={() => setChanging(true)} className="text-[12px] font-medium text-brand-600 hover:text-brand-700">
          {holder ? 'Change' : 'Choose'}
        </button>
      )}
      {isAdmin && changing && (
        <select autoFocus className={smallSelect} aria-label={label} value={holder?.id ?? ''}
          onChange={(e) => { onChange(e.target.value || undefined); setChanging(false) }}
          onBlur={() => setChanging(false)}>
          <option value="">{choices.length ? 'Nobody' : 'Nobody here yet'}</option>
          {choices.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      )}
      {isAdmin && changing && <span className="w-full text-[11.5px] text-slate-400">{hint}</span>}
    </div>
  )
}

function PeopleList({ people, teamName, render }: {
  people: User[]
  /** Their team's name where the list is a department's; omitted on a team's own list. */
  teamName?: (u: User) => string | null
  render: (u: User) => ReactNode
}) {
  if (people.length === 0) return <p className="text-[12.5px] text-slate-400">Nobody yet.</p>
  return (
    <ul className="divide-y divide-slate-100 border-y border-slate-100">
      {people.map((u) => (
        <li key={u.id} className="flex items-center gap-2 py-1.5 text-[12.5px]">
          <UserAvatar userId={u.id} size={18} />
          <span className="font-medium text-slate-700 truncate">{u.name}</span>
          <span className="text-slate-400 truncate hidden sm:inline">{u.role}</span>
          <span className="ml-auto flex items-center gap-2 shrink-0">
            {teamName && (teamName(u)
              ? <span className="text-[11.5px] text-slate-500">{teamName(u)}</span>
              : <span className="text-[11.5px] italic text-slate-400">Without a team</span>)}
            {render(u)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function ConfirmRemove({ what, onCancel, onConfirm }: { what: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal title={`Remove ${what}`} onClose={onCancel}>
      <p className="text-sm text-slate-600">Remove <span className="font-medium text-slate-800">{what}</span>? It is empty, so nobody is moved.</p>
      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onCancel} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">Cancel</button>
        <button type="button" onClick={onConfirm}
          className="text-sm font-medium px-3.5 py-2 rounded-lg bg-[var(--c-rust-deep)] text-white hover:bg-[var(--c-rust-hover)]">Remove</button>
      </div>
    </Modal>
  )
}

function NewDepartmentModal({ existing, onClose, onSave }: { existing: DepartmentRow[]; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState('')
  const clash = existing.some((d) => d.name.trim().toLowerCase() === name.trim().toLowerCase())
  return (
    <Modal title="New department" onClose={onClose} width={400}>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim() && !clash) onSave(name) }}>
        <FormField label="Name" required>
          <input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Reception" data-testid="new-department-name" />
          {clash && <p className="text-[11px] text-[var(--c-rust-deep)] mt-1">There is already a department called that.</p>}
        </FormField>
        <p className="text-[11.5px] text-slate-400 mb-3">Choose its head and its duties once it is made.</p>
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">Cancel</button>
          <button type="submit" disabled={!name.trim() || clash}
            className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed">
            Add department
          </button>
        </div>
      </form>
    </Modal>
  )
}

function NewTeamModal({ departments, teams, initialDepartment, onClose, onSave }: {
  departments: DepartmentRow[]
  teams: Team[]
  initialDepartment: string
  onClose: () => void
  onSave: (input: { name: string; departmentId: string; kind: TeamKind }) => void
}) {
  const [name, setName] = useState('')
  const [departmentId, setDepartmentId] = useState(initialDepartment)
  const [kind, setKind] = useState<TeamKind | ''>('')
  const [kindTouched, setKindTouched] = useState(false)
  const deptName = departments.find((d) => d.id === departmentId)?.name ?? ''
  /* Offered, not decided: what the department's other teams are, else what the names sound like. */
  const offered = kindTouched ? kind : (suggestedKind(departmentId, deptName, name, teams) ?? '')
  return (
    <Modal title="New team" onClose={onClose} width={420}>
      <form onSubmit={(e) => {
        e.preventDefault()
        if (name.trim() && departmentId && offered) onSave({ name: name.trim(), departmentId, kind: offered })
      }}>
        <FormField label="Name" required>
          <input autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} data-testid="new-team-name" />
        </FormField>
        <FormField label="Department" required>
          <select className={inputClass} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} data-testid="new-team-department">
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </FormField>
        <FormField label="Who may join" required>
          <select className={inputClass} value={offered} data-testid="new-team-kind"
            onChange={(e) => { setKind(e.target.value as TeamKind | ''); setKindTouched(true) }}>
            <option value="">Choose…</option>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </FormField>
        <p className="text-[11.5px] text-slate-400 mb-3">Add its members and choose its lead once it is made.</p>
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">Cancel</button>
          <button type="submit" disabled={!name.trim() || !departmentId || !offered}
            title={!name.trim() ? 'Give the team a name first' : !offered ? 'Choose who may join' : 'Add this team'}
            className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed">
            Add team
          </button>
        </div>
      </form>
    </Modal>
  )
}
