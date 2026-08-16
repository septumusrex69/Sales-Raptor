import { GlobalSearch } from './GlobalSearch'
import { NotificationsMenu } from './NotificationsMenu'
import { QuickAdd } from './QuickAdd'

export function Topbar({ title }: { title: string }) {
  return (
    <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between gap-4 px-6 shrink-0">
      <h1 className="text-lg font-semibold text-slate-800 shrink-0">{title}</h1>
      <div className="flex-1 flex justify-center">
        <GlobalSearch />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <NotificationsMenu />
        <QuickAdd />
      </div>
    </header>
  )
}
