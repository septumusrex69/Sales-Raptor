/**
 * OPENING A FILE AND SAVING ONE ARE TWO DIFFERENT PRESSES, and every file Raptor offers gets both.
 *
 * THE FIRM, 19 Oct, on an attachment in the mail: "When I want to download an attachment, it opens
 * it in Raptor ... I should see an option to open it or download it. And then it directly downloads
 * to the device. It asks you where to save it. The same should work for every single document and
 * PDF, whatever is generated throughout Raptor."
 *
 * WHY IT OPENED IN RAPTOR. Every download built a blob URL, clicked an `<a download>` that was never
 * put in the page, and revoked the URL on the next line. On a computer that downloads. Safari on an
 * iPad -- which is what the firm works on -- shows a PDF handed over that way in the tab itself:
 * Raptor is replaced by the document, with no filename and no way back but the browser's arrow.
 *
 * SO, TWO THINGS:
 *
 *   - OPEN is a NEW TAB. Raptor stays where it was; the document is read in Safari's own viewer,
 *     which has its own share button. The tab is opened ON THE PRESS, before the file is fetched,
 *     because a tab opened after an `await` is a pop-up and Safari blocks it.
 *
 *   - DOWNLOAD on an iPad or iPhone is the SHARE SHEET with the file in it, whose "Save to Files"
 *     asks where -- which is exactly the sentence the firm used. Everywhere else it is an ordinary
 *     download, which a desktop browser files or asks about as its owner has set it to.
 *
 * THE ONE CATCH, and it is handled rather than hoped about: Safari only opens the share sheet
 * straight out of a tap, and fetching a mail attachment can outlast that. When it refuses
 * (`NotAllowedError`), `saveFile` says so and the caller offers a second tap -- "Save <name>" --
 * with the file already in hand, which is a tap and so always allowed. Falling back to the old
 * `<a download>` there would be the bug this file exists to fix.
 */

/** An Apple phone or tablet, where Safari's own download is the thing that misbehaves. */
export function isAppleTouch(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  /* iPadOS asks for the desktop site and calls itself a Mac; the touch points give it away. */
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1)
}

/** What happened when somebody asked to save a file. */
export type SaveOutcome =
  /** Handed to the share sheet, or to the browser's download. */
  | 'saved'
  /** They closed the share sheet without choosing. Not an error. */
  | 'cancelled'
  /** Safari would not open the share sheet this late after the tap: ask for one more tap. */
  | 'needs-tap'

const asFile = (blob: Blob, filename: string): File =>
  blob instanceof File && blob.name === filename
    ? blob
    : new File([blob], filename, { type: blob.type || mimeFor(filename) })

/**
 * SAVE A FILE TO THE DEVICE. See the head of this file for why an iPad is different.
 *
 * `fromTap` is true when this is the second, dedicated tap ("Save <name>") -- then a refusal is a
 * real failure rather than a request for the tap, and the ordinary download is the last resort.
 */
export async function saveFile(blob: Blob, filename: string, opts: { fromTap?: boolean } = {}): Promise<SaveOutcome> {
  if (isAppleTouch()) {
    const file = asFile(blob, filename)
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
    if (typeof nav.share === 'function' && (!nav.canShare || nav.canShare({ files: [file] }))) {
      try {
        await nav.share({ files: [file] })
        return 'saved'
      } catch (e) {
        const name = (e as { name?: string })?.name
        if (name === 'AbortError') return 'cancelled'
        if (name === 'NotAllowedError' && !opts.fromTap) return 'needs-tap'
        /* Anything else: fall through to the browser's own download rather than do nothing. */
      }
    }
  }
  downloadBlob(blob, filename)
  return 'saved'
}

/**
 * THE BROWSER'S OWN DOWNLOAD, done the way every browser honours.
 *
 * IN THE PAGE, NOT DETACHED: Firefox ignores a click on a link that is not in the document.
 * A NEW TAB AS ITS TARGET: a browser that ignores `download` (old Safari) opens the file beside
 * Raptor instead of over it. REVOKED A MINUTE LATER, not on the next line: Safari reads the blob
 * after the click returns, and a URL already revoked is a download of nothing.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.target = '_blank'
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * A TAB FOR A FILE THAT IS STILL BEING FETCHED, opened on the press itself (see the head of this
 * file). `show` puts the file in it; `fail` closes it again so nobody is left with a blank tab.
 * Where the browser refused even that, `show` falls back to an ordinary new-tab link.
 */
export function openPending(): { show: (blob: Blob, filename: string) => void; showUrl: (url: string) => void; fail: () => void } {
  const win = typeof window !== 'undefined' ? window.open('', '_blank') : null
  return {
    show(blob, filename) {
      /* A PDF the tab can draw is shown as one; the type matters, or Safari offers to download a
         blob with no type instead of showing it. */
      const typed = blob.type ? blob : new Blob([blob], { type: mimeFor(filename) })
      const url = URL.createObjectURL(typed)
      if (win) win.location.href = url
      else openUrlInNewTab(url)
      /* Long enough for the tab to read it; a tab still open after that already has it. */
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000)
    },
    showUrl(url) {
      if (win) win.location.href = url
      else openUrlInNewTab(url)
    },
    fail() { win?.close() },
  }
}

function openUrlInNewTab(url: string): void {
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** A type for a file that arrived without one, from its name. Only the kinds the firm handles. */
export function mimeFor(filename: string): string {
  const ext = (filename.split('.').pop() ?? '').toLowerCase()
  return ({
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', heic: 'image/heic', txt: 'text/plain', csv: 'text/csv', html: 'text/html',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword', eml: 'message/rfc822', zip: 'application/zip',
  } as Record<string, string>)[ext] ?? 'application/octet-stream'
}

/** A signed storage address, fetched into a file so it can be saved like any other. */
export async function blobFromUrl(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Could not fetch that file.')
  return res.blob()
}
