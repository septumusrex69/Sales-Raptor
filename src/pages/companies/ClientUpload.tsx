import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Card, CardHeader } from '../../components/ui/Card'
import { HandoverImportCard } from '../../components/settings/HandoverImportCard'
import { useAppStore } from '../../store/AppStore'
import { useAuth } from '../../store/AuthContext'
import { mayLoadAccountsFor } from '../../lib/handoverUpload'

/**
 * UPLOAD A BATCH, FROM THE CLIENT AND NOT FROM SETTINGS (23 Oct).
 *
 * THE FIRM: "any person in the client liaison department can upload a handover sheet." The upload
 * lived in Settings -> Data Import, which is Administrator territory -- the Swordfish book import, the
 * wipe and the leads workbook sit beside it -- so a liaison could not reach it at all. This page is
 * the client's own road to it.
 *
 * ONE COMPONENT, NOT A COPY. HandoverImportCard is exactly what Settings -> Data Import draws as its
 * first card, so the sheet is read, judged, held, corrected and approved by one piece of code whoever
 * presses it: the duplicate checks, the corrections emailed to the client's liaison, the "imported
 * cleanly" note and the note on the client's timeline all happen identically. Settings keeps it for
 * the Administrator, with the Swordfish import, which stays theirs: that is the whole book, not a
 * client's sheet.
 *
 * REFUSED WITH A SENTENCE, not a redirect, when the person may not load for this client: somebody who
 * typed the address deserves to know why, and whose client it would have to be.
 */
export function ClientUpload() {
  const { id = '' } = useParams<{ id: string }>()
  const { companies, users, dataLoading } = useAppStore()
  const { currentUser } = useAuth()
  const client = companies.find((c) => c.id === id)
  const allowed = mayLoadAccountsFor(currentUser, client, users)

  return (
    <div className="space-y-4">
      <Link to={`/companies/${id}`} data-testid="back-to-client"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft size={15} /> Back to {client?.name ?? 'the client'}
      </Link>
      {!client && !dataLoading && (
        <Card><CardHeader title="Upload a batch" />
          <p className="text-sm text-slate-500">There is no client at this address.</p>
        </Card>
      )}
      {client && !allowed && (
        <Card><CardHeader title="Upload a batch" />
          <p className="text-sm text-slate-500" data-testid="upload-refused">
            Loading accounts for {client.name} is for an Administrator, or for somebody in the department of the
            client’s liaison. Ask {users.find((u) => u.id === client.accountOwnerId)?.name ?? 'an Administrator'} to load it.
          </p>
        </Card>
      )}
      {client && allowed && <HandoverImportCard forCompanyId={id} />}
    </div>
  )
}
