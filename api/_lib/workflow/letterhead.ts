import type { SupabaseClient } from '@supabase/supabase-js'
import { A4_LETTERHEAD, type PageSetup } from '../../../src/lib/letterDocument.js'

/**
 * THE PAPER THE FIRM'S NOTICES ARE PRINTED ON, FETCHED WHERE THE RUNNER CAN REACH IT.
 *
 * THE FIRM SENT BACK A SECTION 129 AND SAID "fix it with the letterhead". They were looking at a
 * notice with forty-three millimetres of blank paper at the top of every page: the runner drew it
 * on `A4_LETTERHEAD`, which RESERVES that margin for a letterhead, and then passed no letterhead
 * to put in it. Every notice the morning run has ever sent went out on blank paper with a hole in
 * it where the firm's logo should be.
 *
 * THE BROWSER PATH ALWAYS HAD THIS -- letterPdfBytes reads the letterheads table, fetches the
 * image and hands both to letterToPdf. The runner is the other half of CLAUDE.md's clause-builder
 * rule and it was the half that had never been written: two ways to draw the same letter, and the
 * one nobody was watching was the one that was wrong.
 *
 * THE PAGE COMES WITH THE PICTURE. letterheads.ts says why: the image is a full-page A4 with the
 * logo, the rule down the side and the footer block drawn into it, and nothing in the picture
 * keeps body text off them -- only the MARGINS do. Taking A4_LETTERHEAD's generic ones and the
 * firm's image is how body text lands on top of their own footer.
 *
 * CACHED FOR THE LIFE OF THE FUNCTION INSTANCE, like the fonts beside it. The morning run draws
 * up to two hundred notices off one letterhead; fetched per notice that is two hundred reads of
 * the same image.
 */
export interface RunnerLetterhead {
  page: PageSetup
  image: { bytes: Uint8Array; type: 'png' | 'jpg' } | null
}

const BUCKET = 'letterheads'

let cached: RunnerLetterhead | undefined

export async function letterheadFor(admin: SupabaseClient): Promise<RunnerLetterhead> {
  if (cached !== undefined) return cached
  cached = await load(admin)
  return cached
}

/** Only for a check to call between cases; nothing in the runner resets it. */
export function forgetLetterhead(): void {
  cached = undefined
}

async function load(admin: SupabaseClient): Promise<RunnerLetterhead> {
  /*
   * PLAIN PAPER IS THE FALLBACK AND IT IS THE RIGHT ONE. A notice that cannot find the letterhead
   * still has to go: the ten business days a section 129 gives do not pause because an image was
   * unreachable. What must NOT happen is the old behaviour -- reserving the letterhead's margin
   * and printing nothing in it -- so where there is no picture the generic page is used, which
   * has margins meant for blank paper.
   */
  const plain: RunnerLetterhead = { page: A4_LETTERHEAD, image: null }
  try {
    /* THE SAME CHOICE defaultOf MAKES: the default active one, else any active one. Ordered in
       the query so the answer cannot depend on which row Postgres last rewrote. */
    const { data } = await admin
      .from('letterheads')
      .select('storage_path, width_mm, height_mm, margin_top_mm, margin_right_mm, '
        + 'margin_bottom_mm, margin_left_mm')
      .eq('active', true)
      .order('is_default', { ascending: false })
      .order('name')
      .limit(1)
      .maybeSingle()
    if (!data) return plain
    /* CAST BECAUSE THE SELECT IS BUILT FROM TWO STRING PIECES and PostgREST's types can only infer
       a row from a literal one. Every field is read through Number() or a string cast below. */
    const row = data as unknown as Record<string, unknown>

    const path = row.storage_path as string
    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path)
    const res = await fetch(pub.publicUrl)
    if (!res.ok) return plain

    return {
      /*
       * NUMBER() ON EVERY MEASUREMENT. numeric(6,2) comes back from PostgREST as a STRING, and a
       * margin of "37.5" concatenated into a millimetre calculation reads correctly and then
       * silently does nothing the first time anything does arithmetic on it -- the silent-drop
       * trap CLAUDE.md names, on the numbers that decide where a statutory demand's text lands.
       */
      page: {
        widthMm: Number(row.width_mm),
        heightMm: Number(row.height_mm),
        marginTopMm: Number(row.margin_top_mm),
        marginRightMm: Number(row.margin_right_mm),
        marginBottomMm: Number(row.margin_bottom_mm),
        marginLeftMm: Number(row.margin_left_mm),
        backgroundUrl: pub.publicUrl,
      },
      image: {
        bytes: new Uint8Array(await res.arrayBuffer()),
        /* The stored path, not the signed URL: a query string with ".jpg" in it somewhere would
           otherwise decide the format of an image that is a PNG. */
        type: /\.jpe?g$/i.test(path) ? 'jpg' : 'png',
      },
    }
  } catch {
    return plain
  }
}
