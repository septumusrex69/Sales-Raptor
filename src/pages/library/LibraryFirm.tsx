import { Card } from '../../components/ui/Card'
import { useAuth } from '../../store/AuthContext'
import { canEditLibrary, canViewLibrary } from '../../lib/permissions'
import { LibraryHeader } from './LibraryHeader'
import { FirmSettingsPage } from './FirmSettings'

/** Library &rarr; The firm. Under the library's own rule: everyone reads, an administrator
 *  writes. A collector previewing a notice has to see what the debtor will be told to pay into. */
export function LibraryFirm() {
  const { currentUser } = useAuth()
  if (!canViewLibrary(currentUser?.role)) {
    return <Card><p className="text-sm text-slate-600">The library is not open to you.</p></Card>
  }
  return (
    <div className="space-y-4">
      <LibraryHeader mayEdit={canEditLibrary(currentUser?.role)} />
      <FirmSettingsPage />
    </div>
  )
}
