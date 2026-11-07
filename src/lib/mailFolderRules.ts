/**
 * A mail folder, and what its name may be (R-13, S19). Apart from mailFolders.ts, which talks to the database, so a
 * check can import the rule without the Supabase client.
 */
export interface MailFolder {
  id: string
  name: string
  /** The client this folder is for, or null. */
  companyId: string | null
  createdAt: string
}

/** What a folder name may be: something, and not too long for the strip. Null when it is fine. */
export function folderNameProblem(name: string, existing: MailFolder[], exceptId?: string): string | null {
  const n = name.trim()
  if (!n) return 'Give the folder a name.'
  if (n.length > 60) return 'Keep the name under 60 characters.'
  if (existing.some((f) => f.id !== exceptId && f.name.trim().toLowerCase() === n.toLowerCase())) {
    return `You already have a folder called ${n}.`
  }
  return null
}
