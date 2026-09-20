import { Card } from '../../components/ui/Card'
import { useAuth } from '../../store/AuthContext'
import { canEditLibrary, canViewLibrary } from '../../lib/permissions'
import { LibraryHeader } from './LibraryHeader'
import { LetterheadSettings } from './LetterheadSettings'

/** Library &rarr; Letterhead. The page, under the library's own rule: everyone reads, an
 *  administrator writes. A collector previewing a notice has to see the paper it prints on. */
export function LibraryLetterhead() {
  const { currentUser } = useAuth()
  const mayView = canViewLibrary(currentUser?.role)
  if (!mayView) {
    return <Card><p className="text-sm text-slate-600">The library is not open to you.</p></Card>
  }
  return (
    <div className="space-y-4">
      <LibraryHeader mayEdit={canEditLibrary(currentUser?.role)} />
      <LetterheadSettings />
    </div>
  )
}
