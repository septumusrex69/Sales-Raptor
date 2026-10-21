/**
 * The paper the firm's letters are printed on.
 *
 * WHY IT IS A ROW AND NOT A FILE. BF_Letterhead_Aug_2026 is a full-page A4 image with no text of
 * its own — the logo, the rule down the side and the footer block with the phone number and the
 * VAT number are all drawn. Nothing in the picture keeps body text off them. The only thing that
 * does is the MARGINS, so the margins travel with the picture or somebody re-measures them every
 * time a letter is written, and gets them slightly wrong.
 *
 * ONE DEFAULT, enforced by a partial unique index rather than by this file: two rows both
 * claiming to be the default is a letter printed on whichever one the query happened to return
 * first, which is correct in testing and wrong in production because the ordering changes.
 */
import { supabase } from './supabase'
import type { PageSetup } from './letterDocument.ts'

const BUCKET = 'letterheads'
const COLUMNS = 'id, name, storage_path, width_mm, height_mm, margin_top_mm, margin_right_mm, '
  + 'margin_bottom_mm, margin_left_mm, is_default, active, updated_at'

interface Row {
  id: string
  name: string
  storage_path: string
  width_mm: number
  height_mm: number
  margin_top_mm: number
  margin_right_mm: number
  margin_bottom_mm: number
  margin_left_mm: number
  is_default: boolean
  active: boolean
  updated_at: string
}

export interface Letterhead {
  id: string
  name: string
  storagePath: string
  /** The public URL of the image, ready to put behind the page. */
  url: string
  page: PageSetup
  isDefault: boolean
  active: boolean
  updatedAt: string
}

/**
 * Named by hand, like every mapper here.
 *
 * NUMBER() ON EVERY MEASUREMENT, because numeric(6,2) comes back from PostgREST as a STRING. A
 * margin of "37.5" concatenated into a CSS padding reads correctly and then silently does nothing
 * the first time somebody does arithmetic on it. See the warning about silent drops in CLAUDE.md.
 */
function toLetterhead(r: Row): Letterhead {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(r.storage_path)
  return {
    id: r.id,
    name: r.name,
    storagePath: r.storage_path,
    url: data.publicUrl,
    page: {
      widthMm: Number(r.width_mm),
      heightMm: Number(r.height_mm),
      marginTopMm: Number(r.margin_top_mm),
      marginRightMm: Number(r.margin_right_mm),
      marginBottomMm: Number(r.margin_bottom_mm),
      marginLeftMm: Number(r.margin_left_mm),
      backgroundUrl: data.publicUrl,
    },
    isDefault: r.is_default,
    active: r.active,
    updatedAt: r.updated_at,
  }
}

export async function fetchLetterheads(): Promise<Letterhead[]> {
  const { data, error } = await supabase
    .from('letterheads')
    .select(COLUMNS)
    .order('is_default', { ascending: false })
    .order('name')
  if (error) throw new Error(friendly(error.message))
  return ((data ?? []) as unknown as Row[]).map(toLetterhead)
}

/** What a letter opens on. Null where the firm has not uploaded one, which prints on plain paper. */
export const defaultOf = (rows: Letterhead[]): Letterhead | null =>
  rows.find((r) => r.isDefault && r.active) ?? rows.find((r) => r.active) ?? null

export interface LetterheadDraft {
  name: string
  page: Omit<PageSetup, 'backgroundUrl'>
  isDefault: boolean
  active: boolean
}

/**
 * Upload a letterhead and record it.
 *
 * THE FILE IS WRITTEN FIRST AND THE ROW SECOND, on purpose. A row pointing at an object that does
 * not exist is a letterhead that renders as a blank page with no error; an object with no row is
 * an orphan nobody sees and storage costs a fraction of a cent. Of the two failures, only one is
 * visible to whoever is writing the letter.
 */
export async function uploadLetterhead(file: File, draft: LetterheadDraft): Promise<string> {
  const ext = (file.name.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
  /* Named by time rather than by the uploaded filename: two people uploading "letterhead.png"
     must not overwrite each other, and a filename is the one part of an upload a person controls
     entirely. */
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const up = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600', upsert: false,
  })
  if (up.error) throw new Error(friendly(up.error.message))

  const { data, error } = await supabase
    .from('letterheads')
    .insert({
      name: draft.name.trim(),
      storage_path: path,
      width_mm: draft.page.widthMm,
      height_mm: draft.page.heightMm,
      margin_top_mm: draft.page.marginTopMm,
      margin_right_mm: draft.page.marginRightMm,
      margin_bottom_mm: draft.page.marginBottomMm,
      margin_left_mm: draft.page.marginLeftMm,
      is_default: draft.isDefault,
      active: draft.active,
    })
    .select('id')
    .single()
  if (error) {
    /* The row is what makes the object reachable, so an object with no row is rubbish. Removed
       rather than left, and the original error is what the caller hears about. */
    await supabase.storage.from(BUCKET).remove([path]).catch(() => { /* already the lesser fault */ })
    throw new Error(friendly(error.message))
  }
  return data.id as string
}

export async function saveLetterhead(id: string, draft: LetterheadDraft): Promise<void> {
  const { error } = await supabase
    .from('letterheads')
    .update({
      name: draft.name.trim(),
      width_mm: draft.page.widthMm,
      height_mm: draft.page.heightMm,
      margin_top_mm: draft.page.marginTopMm,
      margin_right_mm: draft.page.marginRightMm,
      margin_bottom_mm: draft.page.marginBottomMm,
      margin_left_mm: draft.page.marginLeftMm,
      is_default: draft.isDefault,
      active: draft.active,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw new Error(friendly(error.message))
}

/**
 * Make this the one a letter opens on.
 *
 * THE OTHERS ARE CLEARED FIRST. The unique index refuses a second default, so setting this one
 * without clearing the old one fails — and the failure would read as "could not save" rather than
 * as the rule it is.
 */
export async function makeDefault(id: string): Promise<void> {
  const clear = await supabase.from('letterheads').update({ is_default: false })
    .eq('is_default', true).neq('id', id)
  if (clear.error) throw new Error(friendly(clear.error.message))
  const { error } = await supabase.from('letterheads').update({ is_default: true }).eq('id', id)
  if (error) throw new Error(friendly(error.message))
}

/** Throw one away, object and row together. The row goes first: an orphan object is harmless. */
export async function deleteLetterhead(row: Letterhead): Promise<void> {
  const { error } = await supabase.from('letterheads').delete().eq('id', row.id)
  if (error) throw new Error(friendly(error.message))
  await supabase.storage.from(BUCKET).remove([row.storagePath])
    .catch(() => { /* the row is gone, which is what made it reachable */ })
}

/** The database's own words, turned into the firm's. */
function friendly(message: string): string {
  if (message.includes('letterheads_one_default')) {
    return 'Another letterhead is already the default. Make this one the default instead of adding a second.'
  }
  if (message.includes('row-level security') || message.includes('Unauthorized')) {
    return 'Only an administrator may change the letterhead.'
  }
  if (message.includes('Payload too large') || message.includes('exceeded')) {
    return 'That file is too big. A letterhead is a page of artwork, not a photograph.'
  }
  return message
}
