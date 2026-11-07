/**
 * A PERSON'S OWN MAIL FOLDERS (R-13, S19 · Raptor H18).
 *
 * Rinda asked to "carry over the subfolders from the outlook email ... so we can file our emails into the relevant
 * subfolder keeping our inbox to a minimum". Stephan, deciding it: "as an option for people to have the folders ...
 * to take and create folders and stuff, just to have that flexibility. And they can, for example, link a folder with
 * a client."
 *
 * WHAT THEY ARE: Raptor's own folders, one person's each, as their mail is (`mail_folders`, RLS: the owner only).
 * WHAT THEY ARE NOT: a mirror of Outlook's. Nothing here moves a message on the mail server, so a folder made in
 * Raptor is not in Outlook and Outlook's are not here. Mirroring would mean the sync writing folders back to the
 * server for fifty mailboxes; nobody asked for that, and a filing that silently moved mail in somebody's Outlook is
 * a surprise of the worst kind.
 *
 * A FOLDER LINKED TO A CLIENT files what goes into it on that client too -- onto the client's timeline through
 * linkMailToRecord, which charges nothing (Annexure B is for collecting a debt; a client's own mail is not one). Only a
 * message not on any record yet: filing never takes a message off the record somebody already put it on.
 */
import { supabase } from './supabase'
import type { MailFolder } from './mailFolderRules.ts'

export type { MailFolder } from './mailFolderRules.ts'
export { folderNameProblem } from './mailFolderRules.ts'

const toFolder = (r: Record<string, unknown>): MailFolder => ({
  id: String(r.id),
  name: String(r.name ?? ''),
  companyId: (r.company_id as string | null) ?? null,
  createdAt: String(r.created_at ?? ''),
})

/** The person's folders, by name. RLS returns only their own whatever is asked. */
export async function fetchMailFolders(userId: string): Promise<MailFolder[]> {
  const { data, error } = await supabase.from('mail_folders')
    .select('id, name, company_id, created_at').eq('user_id', userId).order('name')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map(toFolder)
}


export async function createMailFolder(userId: string, name: string, companyId: string | null): Promise<MailFolder> {
  const { data, error } = await supabase.from('mail_folders')
    .insert({ user_id: userId, name: name.trim(), company_id: companyId })
    .select('id, name, company_id, created_at').single()
  if (error) throw new Error(/mail_folders_user_name_idx/.test(error.message) ? `You already have a folder called ${name.trim()}.` : error.message)
  return toFolder(data as Record<string, unknown>)
}

export async function updateMailFolder(id: string, patch: { name?: string; companyId?: string | null }): Promise<void> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name.trim()
  if (patch.companyId !== undefined) row.company_id = patch.companyId
  const { error } = await supabase.from('mail_folders').update(row).eq('id', id)
  if (error) throw new Error(/mail_folders_user_name_idx/.test(error.message) ? 'You already have a folder with that name.' : error.message)
}

/** Its mail goes back to the Inbox: the column is `on delete set null`. Nothing is deleted but the folder. */
export async function removeMailFolder(id: string): Promise<void> {
  const { error } = await supabase.from('mail_folders').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Into a folder, or out of every folder (null: back to the Inbox). Only the person's own mail -- RLS -- and only their
 * own folder -- the user_emails_folder_is_theirs trigger refuses anybody else's.
 */
export async function moveMailToFolder(ids: string[], folderId: string | null): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase.from('user_emails').update({ folder_id: folderId }).in('id', ids)
  if (error) throw new Error(error.message)
}
