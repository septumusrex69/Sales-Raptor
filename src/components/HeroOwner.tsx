import { UserAvatar } from './ui/Avatar'
import { useAppStore } from '../store/AppStore'
import type { ID } from '../types'

/**
 * Who owns this record, shown inside the dark hero band on a Client or Lead.
 *
 * Whose desk a client or lead sits on is the first thing anyone opening the record needs to
 * know — it decides who to ask about it — so it belongs at the top rather than buried in a
 * details card further down. The label differs by record because the job does: a lead is
 * worked by whoever is selling to them, a client is serviced by their liaison.
 */
export function HeroOwner({ ownerId, label }: { ownerId?: ID; label: string }) {
  const { userById } = useAppStore()
  const owner = ownerId ? userById(ownerId) : undefined

  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-white/10 px-3 py-2">
      {owner ? <UserAvatar userId={owner.id} size={30} /> : <span className="w-[30px] h-[30px] rounded-full bg-white/20" />}
      <div className="leading-tight">
        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-gold-500">{label}</p>
        <p className="text-[13px] font-medium text-white">{owner?.name ?? 'Unassigned'}</p>
        {owner?.role && <p className="text-[11px] text-white/50">{owner.role}</p>}
      </div>
    </div>
  )
}
