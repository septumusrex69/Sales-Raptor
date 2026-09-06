import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { useDefaultOwnerFilter, isAssignableOwner} from '../../lib/permissions'
import { Card } from '../../components/ui/Card'
import { UserAvatar } from '../../components/ui/Avatar'
import { ContactForm } from '../../components/layout/QuickAdd'
import { companyById, formatDate, userById } from '../../data/mockData'

export function ContactsList() {
  const store = useAppStore()
  const { contacts, deals, users } = store
  const { currentUser } = useAuth()
  const reps = useMemo(() => users.filter((u) => isAssignableOwner(u.role)), [users])
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [owner, setOwner] = useDefaultOwnerFilter(undefined, currentUser)
  const [addOpen, setAddOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return contacts
      .filter((c) => owner === 'All' || c.ownerId === owner)
      .filter((c) => !q || `${c.firstName} ${c.lastName} ${companyById(c.companyId)?.name ?? ''}`.toLowerCase().includes(q))
  }, [contacts, search, owner])

  const activeDealsFor = (contactId: string) => deals.filter((d) => d.contactId === contactId && d.stage !== 'Won' && d.stage !== 'Rejected').length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 w-64">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search contacts..." className="text-sm outline-none flex-1 min-w-0" />
        </div>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-600 outline-none">
          <option value="All">All Owners</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-400">{filtered.length} contacts</span>
        <button
          onClick={() => setAddOpen(true)}
          className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700"
        >
          <Plus size={15} /> Add Contact
        </button>
      </div>

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="font-medium px-5 py-3">Name</th>
                <th className="font-medium px-3 py-3">Company</th>
                <th className="font-medium px-3 py-3">Job Title</th>
                <th className="font-medium px-3 py-3">Email</th>
                <th className="font-medium px-3 py-3">Phone</th>
                <th className="font-medium px-3 py-3">Owner</th>
                <th className="font-medium px-3 py-3 text-center">Active Deals</th>
                <th className="font-medium px-3 py-3">Last Contact</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} onClick={() => navigate(`/contacts/${c.id}`)} className="border-t border-slate-50 hover:bg-slate-50/60 cursor-pointer">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <UserAvatar userId={c.ownerId} size={26} />
                      <Link to={`/contacts/${c.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-700 hover:text-brand-600">
                        {c.firstName} {c.lastName}
                      </Link>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-500">{companyById(c.companyId)?.name ?? '—'}</td>
                  <td className="px-3 py-3 text-slate-500">{c.jobTitle ?? '—'}</td>
                  <td className="px-3 py-3 text-slate-500">{c.email ?? '—'}</td>
                  <td className="px-3 py-3 text-slate-500">{c.phone ?? c.mobile ?? '—'}</td>
                  <td className="px-3 py-3 text-slate-500">{userById(c.ownerId)?.name}</td>
                  <td className="px-3 py-3 text-center text-slate-600 font-medium">{activeDealsFor(c.id)}</td>
                  <td className="px-3 py-3 text-slate-500">{formatDate(c.lastContactAt)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-slate-400 text-sm py-10">
                    No contacts found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {addOpen && <ContactForm onClose={() => setAddOpen(false)} store={store} />}
    </div>
  )
}
