import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { useAppStore } from '../../store/AppStore'
import { Card } from '../../components/ui/Card'
import { UserAvatar } from '../../components/ui/Avatar'
import { CompanyForm } from '../../components/layout/QuickAdd'
import { formatCurrency, userById } from '../../data/mockData'

export function CompaniesList() {
  const store = useAppStore()
  const { companies, deals, contacts } = store
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return companies
    return companies.filter((c) => c.name.toLowerCase().includes(q))
  }, [companies, search])

  const mainContactFor = (companyId: string) => contacts.find((c) => c.companyId === companyId)
  const activeDealsFor = (companyId: string) => deals.filter((d) => d.companyId === companyId && d.stage !== 'Won' && d.stage !== 'Lost')
  const lifetimeValueFor = (companyId: string) => deals.filter((d) => d.companyId === companyId && d.stage === 'Won').reduce((s, d) => s + d.value, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 w-64">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search companies..." className="text-sm outline-none flex-1 min-w-0" />
        </div>
        <span className="text-xs text-slate-400">{filtered.length} companies</span>
        <button
          onClick={() => setAddOpen(true)}
          className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700"
        >
          <Plus size={15} /> Add Company
        </button>
      </div>

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="font-medium px-5 py-3">Company Name</th>
                <th className="font-medium px-3 py-3">Industry</th>
                <th className="font-medium px-3 py-3">Main Contact</th>
                <th className="font-medium px-3 py-3">Phone</th>
                <th className="font-medium px-3 py-3">Email</th>
                <th className="font-medium px-3 py-3">Account Owner</th>
                <th className="font-medium px-3 py-3 text-center">Active Deals</th>
                <th className="font-medium px-3 py-3 text-right">Lifetime Value</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const mainContact = mainContactFor(c.id)
                return (
                  <tr key={c.id} onClick={() => navigate(`/companies/${c.id}`)} className="border-t border-slate-50 hover:bg-slate-50/60 cursor-pointer">
                    <td className="px-5 py-3">
                      <Link to={`/companies/${c.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-700 hover:text-brand-600">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-slate-500">{c.industry ?? '—'}</td>
                    <td className="px-3 py-3 text-slate-500">{mainContact ? `${mainContact.firstName} ${mainContact.lastName}` : '—'}</td>
                    <td className="px-3 py-3 text-slate-500">{c.phone ?? '—'}</td>
                    <td className="px-3 py-3 text-slate-500">{c.email ?? '—'}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <UserAvatar userId={c.accountOwnerId} size={22} />
                        <span className="text-slate-500 text-xs">{userById(c.accountOwnerId)?.name.split(' ')[0]}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center text-slate-600 font-medium">{activeDealsFor(c.id).length}</td>
                    <td className="px-3 py-3 text-right font-medium text-slate-700">{formatCurrency(lifetimeValueFor(c.id))}</td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-slate-400 text-sm py-10">
                    No companies found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {addOpen && <CompanyForm onClose={() => setAddOpen(false)} store={store} />}
    </div>
  )
}
