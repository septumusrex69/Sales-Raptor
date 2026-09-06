import { UserAvatar } from './ui/Avatar'
import { useAppStore } from '../store/AppStore'
import type { ID } from '../types'

/**
 * Who owns this record, shown in the hero band on a Client or Lead.
 *
 * Whose desk a record sits on decides who to ask about it, so it belongs at the top — but
 * beside the name rather than lined up among the figures, where it competed with them for
 * attention and pushed the real numbers along. The label differs by record because the job
 * does: a lead is worked by whoever is selling to them, a client is serviced by their liaison.
 */
export function HeroOwner({ ownerId, label }: { ownerId?: ID; label: string }) {
  const { userById } = useAppStore()
  const owner = ownerId ? userById(ownerId) : undefined

  return (
    <div className="flex items-center gap-2.5 text-right">
      <div className="leading-tight">
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-gold-500">{label}</p>
        <p className="text-sm font-semibold text-white">{owner?.name ?? 'Unassigned'}</p>
        {owner?.role && <p className="text-[11px] text-white/50">{owner.role}</p>}
      </div>
      {owner ? <UserAvatar userId={owner.id} size={34} /> : <span className="w-[34px] h-[34px] rounded-full bg-white/10" />}
    </div>
  )
}
