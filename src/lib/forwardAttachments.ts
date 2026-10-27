/**
 * THE FILES ON A MESSAGE BEING FORWARDED GO WITH IT.
 *
 * THE FIRM, R-8: "When you forward an email it removes the attachment can we please keep the
 * attachment and remove it manually if we have to." The forward quoted the words and nothing
 * else, so a debtor's proof of payment passed to the client arrived as a sentence about a file.
 *
 * KEPT BY DEFAULT AND REMOVABLE IN THE BOX, which is what the firm asked for -- the files are
 * seeded into the composer's ordinary list, so the x beside each one still works.
 *
 * A MESSAGE EITHER GOES WITH ITS ATTACHMENTS OR IT DOES NOT GO (see ComposeEmailModal), so what
 * does not fit under the ceiling is LEFT OFF AND NAMED, never half-sent and never silent. The
 * person sees the names and can send those separately.
 */
export interface ForwardedFile { filename: string; contentType: string; size: number; content: string }

/** Which files fit, in the order the message carried them; the rest are named, not dropped quietly. */
export function planForwardAttachments<T extends { size: number }>(
  files: { name: string; file: T | null }[],
  maxBytes: number,
): { kept: T[]; left: string[] } {
  const kept: T[] = []
  const left: string[] = []
  let total = 0
  for (const { name, file } of files) {
    if (!file || total + file.size > maxBytes) { left.push(name); continue }
    total += file.size
    kept.push(file)
  }
  return { kept, left }
}

/** The sentence under the files when some were not brought along; empty when all were. */
export function leftOffNote(left: string[]): string {
  if (left.length === 0) return ''
  return `Not attached (too big for one message, or could not be fetched): ${left.join(', ')}. `
    + 'Send them in a second email.'
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('A file could not be read.'))
    /* A data: URL, so everything up to and including the comma is not the file. */
    reader.onload = () => resolve(String(reader.result ?? '').split(',')[1] ?? '')
    reader.readAsDataURL(blob)
  })
}

export async function fetchForwardAttachments(input: {
  mailId?: string
  accountEmailId?: string
  names: string[]
  accessToken: string
  maxBytes: number
  /** userMail's fetchAttachment, handed in so this file stays free of the Supabase client and a check can import it. */
  fetchOne: (a: { mailId?: string; accountEmailId?: string; filename: string; accessToken: string }) => Promise<Blob>
}): Promise<{ files: ForwardedFile[]; left: string[] }> {
  const got: { name: string; file: ForwardedFile | null }[] = []
  for (const name of input.names) {
    try {
      const blob = await input.fetchOne({
        mailId: input.mailId, accountEmailId: input.accountEmailId, filename: name,
        accessToken: input.accessToken,
      })
      got.push({
        name,
        file: {
          filename: name, contentType: blob.type || 'application/octet-stream',
          size: blob.size, content: await toBase64(blob),
        },
      })
    } catch {
      got.push({ name, file: null })
    }
  }
  const { kept, left } = planForwardAttachments(got, input.maxBytes)
  return { files: kept, left }
}
