import type { SupabaseClient } from '@supabase/supabase-js'
import type { StoredPicture } from '../../src/lib/mailBodyCache.js'

/**
 * THE PICTURE STORE, the server half (S11 · Lean Mail, 24 Oct 2026).
 *
 * The firm, of how Outlook does it: "save one image somewhere and then always go and check it and
 * take it back, like Microsoft, and then delete it after 30 days." So a picture drawn into a
 * message -- a signature logo, nearly always -- is saved ONCE, under its fingerprint, in the
 * private `mail-pictures` bucket, and the cached markup names it by that fingerprint
 * (mailBodyCache.extractPictures). The BF logo on two thousand messages is one file.
 *
 * Before this the pictures sat inside every cached body, base64: 645 MB of a 710 MB staging
 * database. In the store the same mail is a few megabytes of distinct logos.
 *
 * NEVER FATAL. Both callers -- the sync and the read route's write-back -- came to do something
 * else; a picture that cannot be saved means that message's logo is fetched from the mailbox when
 * it is opened, which is how every message behaved yesterday.
 */

export const PICTURE_BUCKET = 'mail-pictures'

/** Unused this many days and a picture is deleted. The firm's number. */
export const PICTURE_EXPIRY_DAYS = 30

/**
 * A picture bigger than this is not kept. Signature logos are tens of kilobytes; a megabyte picture
 * drawn into a message is a newsletter banner or a pasted screenshot, read once. The bucket's own
 * file_size_limit (2 MB) is the backstop.
 */
const MAX_PICTURE_BYTES = 1_000_000

/** Where a picture lives in the bucket. Two levels of fan-out keep any one folder small. */
export function picturePath(hash: string): string {
  return `${hash.slice(0, 2)}/${hash}`
}

/**
 * Saves whichever of these pictures the store does not already hold, and marks the rest used today.
 * Returns how many were new, for the sync's log.
 */
export async function savePictures(admin: SupabaseClient, pictures: StoredPicture[]): Promise<number> {
  const wanted = pictures.filter((p) => Math.floor(p.base64.length * 3 / 4) <= MAX_PICTURE_BYTES)
  if (wanted.length === 0) return 0
  const hashes = wanted.map((p) => p.hash)
  const { data: have, error } = await admin.from('mail_pictures').select('hash').in('hash', hashes)
  if (error) {
    console.log(`[mailPictures] could not check the store: ${error.message}`)
    return 0
  }
  const held = new Set((have ?? []).map((r) => r.hash as string))
  /* Seen again: it is in use, so the 30 days start over. Once a day per picture (the function says so). */
  if (held.size > 0) void admin.rpc('touch_mail_pictures', { p_hashes: [...held] })

  let saved = 0
  for (const p of wanted) {
    if (held.has(p.hash)) continue
    const bytes = Buffer.from(p.base64, 'base64')
    /*
     * UPSERT, because two mailboxes syncing the same logo at the same moment is ordinary -- the same
     * client writes to three collectors -- and the second upload is the same bytes under the same
     * name. The row is written only after the file is there, so a row never points at nothing.
     */
    const up = await admin.storage.from(PICTURE_BUCKET)
      .upload(picturePath(p.hash), bytes, { contentType: p.contentType, upsert: true })
    if (up.error) {
      console.log(`[mailPictures] ${p.hash.slice(0, 12)} not saved: ${up.error.message}`)
      continue
    }
    const { error: rowError } = await admin.from('mail_pictures').upsert(
      { hash: p.hash, content_type: p.contentType, bytes: bytes.length },
      { onConflict: 'hash', ignoreDuplicates: true },
    )
    if (rowError) console.log(`[mailPictures] ${p.hash.slice(0, 12)} row not written: ${rowError.message}`)
    else saved += 1
  }
  return saved
}

/**
 * Deletes pictures nobody has opened for PICTURE_EXPIRY_DAYS. Run by the sync-all cron.
 *
 * A message that still points at a deleted picture is not broken: the page finds the picture
 * missing from the store, fetches the message from the mailbox, and the write-back saves it again.
 * That is the whole reason expiry is safe -- the mailbox is the archive, the store is a cache.
 *
 * A batch per run, because the cron runs every five minutes and has mail to read; a backlog
 * clears itself over a few runs.
 */
export async function expireMailPictures(admin: SupabaseClient): Promise<{ deleted: number } | { error: string }> {
  const cutoff = new Date(Date.now() - PICTURE_EXPIRY_DAYS * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await admin.from('mail_pictures').select('hash')
    .lt('last_used_on', cutoff).limit(200)
  if (error) return { error: error.message }
  const hashes = (data ?? []).map((r) => r.hash as string)
  if (hashes.length === 0) return { deleted: 0 }
  /* The files first: a row left behind is retried next run, a file left behind is never found again. */
  const gone = await admin.storage.from(PICTURE_BUCKET).remove(hashes.map(picturePath))
  if (gone.error) return { error: gone.error.message }
  const { error: rowError } = await admin.from('mail_pictures').delete().in('hash', hashes)
  if (rowError) return { error: rowError.message }
  return { deleted: hashes.length }
}
