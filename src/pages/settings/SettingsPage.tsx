import { useState } from 'react'
import { Plus, Trash2, Check, X } from 'lucide-react'
import { Card, CardHeader } from '../../components/ui/Card'
import { UserAvatar, Avatar } from '../../components/ui/Avatar'
import { Modal, FormField, inputClass } from '../../components/ui/Modal'
import {
  currentUser,
  customFields as initialCustomFields,
  industries,
  leadSources as initialLeadSources,
  lossReasons as initialLossReasons,
  teams as initialTeams,
  users as initialUsers,
} from '../../data/mockData'
import type { CustomField, CustomFieldType, Team, User, UserRole } from '../../types'
import { DEAL_STAGES } from '../../types'

const TABS = ['Profile', 'Users', 'Teams', 'Pipelines', 'Custom Fields', 'Lead Sources', 'Lost Reasons', 'Notifications', 'Integrations'] as const
type Tab = (typeof TABS)[number]

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('Profile')

  return (
    <div className="flex gap-6">
      <nav className="w-52 shrink-0 space-y-0.5">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium ${tab === t ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100'}`}
          >
            {t}
          </button>
        ))}
      </nav>
      <div className="flex-1 min-w-0">
        {tab === 'Profile' && <ProfileTab />}
        {tab === 'Users' && <UsersTab />}
        {tab === 'Teams' && <TeamsTab />}
        {tab === 'Pipelines' && <PipelinesTab />}
        {tab === 'Custom Fields' && <CustomFieldsTab />}
        {tab === 'Lead Sources' && <StringListTab title="Lead Sources" initial={initialLeadSources} />}
        {tab === 'Lost Reasons' && <StringListTab title="Lost Reasons" initial={initialLossReasons} />}
        {tab === 'Notifications' && <NotificationsTab />}
        {tab === 'Integrations' && <IntegrationsTab />}
      </div>
    </div>
  )
}

function ProfileTab() {
  const [form, setForm] = useState({
    fullName: currentUser.name,
    email: currentUser.email,
    phone: currentUser.phone ?? '',
    language: 'English',
    timezone: '(GMT+02:00) Johannesburg',
    dateFormat: 'DD MMM YYYY',
    currency: 'ZAR - Rand',
  })
  const [saved, setSaved] = useState(false)

  return (
    <Card>
      <CardHeader title="Profile" subtitle="Your personal account settings" />
      <div className="flex items-center gap-4 mb-6">
        <Avatar name={form.fullName} color={currentUser.avatarColor} size={64} />
        <div>
          <p className="font-semibold text-slate-800">{form.fullName}</p>
          <p className="text-sm text-slate-400">{currentUser.role}</p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setSaved(true)
          setTimeout(() => setSaved(false), 2000)
        }}
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Personal Information</h4>
            <FormField label="Full Name">
              <input className={inputClass} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </FormField>
            <FormField label="Email">
              <input type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </FormField>
            <FormField label="Phone">
              <input className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </FormField>
            <FormField label="Role">
              <input className={inputClass} value={currentUser.role} disabled />
            </FormField>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Preferences</h4>
            <FormField label="Language">
              <select className={inputClass} value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                <option>English</option>
                <option>Afrikaans</option>
                <option>Zulu</option>
              </select>
            </FormField>
            <FormField label="Timezone">
              <input className={inputClass} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
            </FormField>
            <FormField label="Date Format">
              <select className={inputClass} value={form.dateFormat} onChange={(e) => setForm({ ...form, dateFormat: e.target.value })}>
                <option>DD MMM YYYY</option>
                <option>MM/DD/YYYY</option>
                <option>YYYY-MM-DD</option>
              </select>
            </FormField>
            <FormField label="Currency">
              <select className={inputClass} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option>ZAR - Rand</option>
                <option>USD - Dollar</option>
                <option>EUR - Euro</option>
              </select>
            </FormField>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-slate-100">
          <button type="submit" className="text-sm font-medium px-4 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Save Changes
          </button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[#406d58]">
              <Check size={13} /> Saved
            </span>
          )}
        </div>
      </form>
    </Card>
  )
}

function UsersTab() {
  const [list, setList] = useState<User[]>(initialUsers)
  const [addOpen, setAddOpen] = useState(false)

  return (
    <Card padded={false}>
      <div className="p-5 flex items-center justify-between">
        <CardHeader title="Users" subtitle={`${list.length} team members`} />
        <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 h-fit">
          <Plus size={15} /> Add User
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-t border-slate-100">
              <th className="font-medium px-5 py-2.5">User</th>
              <th className="font-medium px-3 py-2.5">Role</th>
              <th className="font-medium px-3 py-2.5">Email</th>
              <th className="font-medium px-3 py-2.5">Status</th>
              <th className="font-medium px-3 py-2.5 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id} className="border-t border-slate-50">
                <td className="px-5 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <UserAvatar userId={u.id} size={26} />
                    <span className="font-medium text-slate-700">{u.name}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-slate-500">{u.role}</td>
                <td className="px-3 py-2.5 text-slate-500">{u.email}</td>
                <td className="px-3 py-2.5">
                  <button
                    onClick={() => setList((prev) => prev.map((x) => (x.id === u.id ? { ...x, status: x.status === 'Active' ? 'Inactive' : 'Active' } : x)))}
                    className={`badge ${u.status === 'Active' ? 'bg-[#eef4f1] text-[#406d58]' : 'bg-slate-100 text-slate-500'}`}
                  >
                    {u.status}
                  </button>
                </td>
                <td className="px-3 py-2.5">
                  <button onClick={() => setList((prev) => prev.filter((x) => x.id !== u.id))} className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {addOpen && (
        <AddUserModal
          onClose={() => setAddOpen(false)}
          onSave={(u) => setList((prev) => [...prev, { ...u, id: `u${prev.length + 1 + Date.now()}`, status: 'Active', avatarColor: '#6086a9' }])}
        />
      )}
    </Card>
  )
}

function AddUserModal({ onClose, onSave }: { onClose: () => void; onSave: (u: { name: string; email: string; role: UserRole }) => void }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'Sales Representative' as UserRole })
  return (
    <Modal title="Add User" onClose={onClose} width={400}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.name || !form.email) return
          onSave(form)
          onClose()
        }}
      >
        <FormField label="Full Name" required>
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
        </FormField>
        <FormField label="Email" required>
          <input type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </FormField>
        <FormField label="Role">
          <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
            {(['Administrator', 'Sales Manager', 'Sales Representative', 'Read Only'] as UserRole[]).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Add User
          </button>
        </div>
      </form>
    </Modal>
  )
}

function TeamsTab() {
  const [teams, setTeams] = useState<Team[]>(initialTeams)
  const [name, setName] = useState('')

  return (
    <Card>
      <CardHeader title="Teams" subtitle="Group salespeople into teams" />
      <div className="space-y-3">
        {teams.map((t) => (
          <div key={t.id} className="flex items-center justify-between border border-slate-100 rounded-xl p-3.5">
            <div>
              <p className="text-sm font-semibold text-slate-700">{t.name}</p>
              <p className="text-xs text-slate-400">{t.memberIds.length} members</p>
            </div>
            <div className="flex items-center -space-x-2">
              {t.memberIds.map((id) => (
                <div key={id} className="ring-2 ring-white rounded-full">
                  <UserAvatar userId={id} size={26} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          setTeams((prev) => [...prev, { id: `t${prev.length + 1}`, name, memberIds: [] }])
          setName('')
        }}
        className="flex gap-2 mt-4 pt-4 border-t border-slate-100"
      >
        <input className={inputClass} placeholder="New team name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 shrink-0">
          <Plus size={15} /> Add Team
        </button>
      </form>
    </Card>
  )
}

function PipelinesTab() {
  const [stages, setStages] = useState<string[]>([...DEAL_STAGES]);
  const [name, setName] = useState('')
  return (
    <Card>
      <CardHeader title="Pipelines" subtitle="Customise your sales pipeline stages" />
      <div className="space-y-2">
        {stages.map((s, i) => (
          <div key={s} className="flex items-center gap-3 border border-slate-100 rounded-lg px-3.5 py-2.5">
            <span className="text-xs text-slate-400 w-5">{i + 1}</span>
            <span className="text-sm font-medium text-slate-700 flex-1">{s}</span>
            {!(['Won', 'Lost'] as string[]).includes(s) && (
              <button onClick={() => setStages((prev) => prev.filter((x) => x !== s))} className="p-1 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50">
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          setStages((prev) => [...prev.slice(0, -2), name, ...prev.slice(-2)])
          setName('')
        }}
        className="flex gap-2 mt-4 pt-4 border-t border-slate-100"
      >
        <input className={inputClass} placeholder="New stage name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 shrink-0">
          <Plus size={15} /> Add Stage
        </button>
      </form>
    </Card>
  )
}

const FIELD_TYPES: CustomFieldType[] = ['Text', 'Number', 'Currency', 'Date', 'Dropdown', 'Multi-select', 'Checkbox', 'URL', 'Email', 'Phone']

function CustomFieldsTab() {
  const [fields, setFields] = useState<CustomField[]>(initialCustomFields)
  const [addOpen, setAddOpen] = useState(false)

  return (
    <Card padded={false}>
      <div className="p-5 flex items-center justify-between">
        <CardHeader title="Custom Fields" subtitle="Add fields without developer changes" />
        <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 h-fit">
          <Plus size={15} /> Add Custom Field
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-t border-slate-100">
              <th className="font-medium px-5 py-2.5">Field</th>
              <th className="font-medium px-3 py-2.5">Related To</th>
              <th className="font-medium px-3 py-2.5">Type</th>
              <th className="font-medium px-3 py-2.5">Status</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.id} className="border-t border-slate-50">
                <td className="px-5 py-2.5 font-medium text-slate-700">{f.name}</td>
                <td className="px-3 py-2.5 text-slate-500">{f.relatedTo}</td>
                <td className="px-3 py-2.5 text-slate-500">{f.type}</td>
                <td className="px-3 py-2.5">
                  <span className={`badge ${f.status === 'Active' ? 'bg-[#eef4f1] text-[#406d58]' : 'bg-slate-100 text-slate-500'}`}>{f.status}</span>
                </td>
                <td className="px-3 py-2.5">
                  <button onClick={() => setFields((prev) => prev.filter((x) => x.id !== f.id))} className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {addOpen && (
        <AddCustomFieldModal
          onClose={() => setAddOpen(false)}
          onSave={(f) => setFields((prev) => [...prev, { ...f, id: `cf${prev.length + 1}`, status: 'Active' }])}
        />
      )}
    </Card>
  )
}

function AddCustomFieldModal({ onClose, onSave }: { onClose: () => void; onSave: (f: { name: string; relatedTo: CustomField['relatedTo']; type: CustomFieldType }) => void }) {
  const [form, setForm] = useState<{ name: string; relatedTo: CustomField['relatedTo']; type: CustomFieldType }>({ name: '', relatedTo: 'Leads', type: 'Text' })
  return (
    <Modal title="Add Custom Field" onClose={onClose} width={400}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.name) return
          onSave(form)
          onClose()
        }}
      >
        <FormField label="Field Name" required>
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus placeholder="e.g. Contract Length" />
        </FormField>
        <FormField label="Related To">
          <select className={inputClass} value={form.relatedTo} onChange={(e) => setForm({ ...form, relatedTo: e.target.value as CustomField['relatedTo'] })}>
            {(['Leads', 'Deals', 'Contacts', 'Companies'] as CustomField['relatedTo'][]).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Field Type">
          <select className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CustomFieldType })}>
            {FIELD_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </FormField>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button type="submit" className="text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700">
            Add Field
          </button>
        </div>
      </form>
    </Modal>
  )
}

function StringListTab({ title, initial }: { title: string; initial: string[] }) {
  const [items, setItems] = useState<string[]>(initial)
  const [value, setValue] = useState('')
  return (
    <Card>
      <CardHeader title={title} />
      <div className="flex flex-wrap gap-2 mb-4">
        {items.map((item) => (
          <span key={item} className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-600 text-sm font-medium px-3 py-1.5 rounded-full">
            {item}
            <button onClick={() => setItems((prev) => prev.filter((x) => x !== item))} className="text-slate-400 hover:text-red-500">
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!value.trim() || items.includes(value.trim())) return
          setItems((prev) => [...prev, value.trim()])
          setValue('')
        }}
        className="flex gap-2"
      >
        <input className={inputClass} placeholder={`Add ${title.toLowerCase().slice(0, -1)}`} value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="submit" className="inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 shrink-0">
          <Plus size={15} /> Add
        </button>
      </form>
      {title === 'Lead Sources' && (
        <p className="text-xs text-slate-400 mt-3">Also used across Industries such as: {industries.slice(0, 4).join(', ')}…</p>
      )}
    </Card>
  )
}

const NOTIFICATION_TYPES = [
  'New lead assigned',
  'Task due',
  'Task overdue',
  'Meeting starting',
  'Proposal viewed',
  'Proposal accepted',
  'Deal inactive',
  'Deal moved',
  'Deal won',
  'Lead reassigned',
]

function NotificationsTab() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, true])))
  return (
    <Card>
      <CardHeader title="Notifications" subtitle="Choose which events notify you" />
      <div className="divide-y divide-slate-50">
        {NOTIFICATION_TYPES.map((t) => (
          <div key={t} className="flex items-center justify-between py-2.5">
            <span className="text-sm text-slate-700">{t}</span>
            <Toggle checked={enabled[t]} onChange={(v) => setEnabled((prev) => ({ ...prev, [t]: v }))} />
          </div>
        ))}
      </div>
    </Card>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`w-10 h-5.5 rounded-full transition-colors relative shrink-0 ${checked ? 'bg-brand-600' : 'bg-slate-200'}`}
      style={{ height: 22 }}
    >
      <span className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[19px]' : 'translate-x-0.5'}`} style={{ width: 18, height: 18 }} />
    </button>
  )
}

const INTEGRATIONS = [
  { name: 'Google Calendar', desc: 'Sync meetings and tasks to Google Calendar' },
  { name: 'Outlook Calendar', desc: 'Sync meetings and tasks to Outlook' },
  { name: 'Email', desc: 'Send and log emails from the CRM' },
  { name: 'WhatsApp', desc: 'Log WhatsApp conversations with leads' },
  { name: 'Website Forms', desc: 'Auto-capture leads from your website' },
  { name: 'Google Ads', desc: 'Import leads from Google Ads campaigns' },
]

function IntegrationsTab() {
  const [connected, setConnected] = useState<Record<string, boolean>>({ Email: true })
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {INTEGRATIONS.map((i) => (
        <Card key={i.name} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">{i.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">{i.desc}</p>
            </div>
            <button
              onClick={() => setConnected((prev) => ({ ...prev, [i.name]: !prev[i.name] }))}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg shrink-0 ${connected[i.name] ? 'bg-[#eef4f1] text-[#406d58]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
            >
              {connected[i.name] ? 'Connected' : 'Connect'}
            </button>
          </div>
        </Card>
      ))}
    </div>
  )
}
