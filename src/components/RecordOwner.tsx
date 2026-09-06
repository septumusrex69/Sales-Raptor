import { UserAvatar } from './ui/Avatar'
import { useAppStore } from '../store/AppStore'
import type { ID } from '../types'

/**
 * Who owns this record, sitting in the stat row on a Client or Lead alongside the other
 * facts about it.
 *
 * Whose desk a record sits on decides who to ask about it, so it belongs near the top — but
 * as one of the figures, not floating in the hero band where it read as a stray badge. The
 * label differs by record because the job does: a lead is worked by whoever is selling to
 * them, a client is serviced by their liaison.
 */
export function RecordOwner({ ownerId, label }: { ownerId?: ID; label: string }) {
  const { userById } = useAppStore()
  const owner = ownerId ? userById(ownerId) : undefined

  return (
    <div>
      <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1.5">{label}</p>
      <div className="flex items-center gap-2">
        {owner ? <UserAvatar userId={owner.id} size={28} /> : <span className="w-7 h-7 rounded-full bg-slate-100" />}
        <div className="leading-tight">
          <p className="text-sm font-semibold text-slate-800">{owner?.name ?? 'Unassigned'}</p>
          {owner?.role && <p className="text-[11px] text-slate-400">{owner.role}</p>}
        </div>
      </div>
    </div>
  )
}
