import crypto from 'node:crypto'

/**
 * AES-256-GCM at-rest encryption for mailbox passwords. Defense in depth on
 * top of RLS (email_connections already has zero policies for authenticated/
 * anon) -- a raw DB dump or a misconfigured policy still wouldn't expose a
 * usable password. EMAIL_CREDENTIALS_KEY must be a 32-byte key, base64-encoded.
 */
/**
 * Why the key cannot be used, or null when it can.
 *
 * getKey throws, which is right at the point of use and wrong at the edge of a request: an
 * uncaught throw inside a handler returns a 500 with no body, and a client that reads
 * `body.error` off an empty body falls back to whatever generic sentence it holds. Connecting
 * Felicia's mailbox on production did exactly that — both the IMAP and the SMTP checks passed,
 * the key was missing, and the screen said only "Could not connect that mailbox."
 *
 * So routes ask this first and answer plainly. Configuration missing on the server is not the
 * operator's mistake and should never be reported as if it were their password.
 */
export function credentialsKeyProblem(): string | null {
  try {
    getKey()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'EMAIL_CREDENTIALS_KEY is not usable.'
  }
}

function getKey(): Buffer {
  const key = process.env.EMAIL_CREDENTIALS_KEY
  if (!key) throw new Error('Server is missing EMAIL_CREDENTIALS_KEY configuration.')
  const buf = Buffer.from(key, 'base64')
  if (buf.length !== 32) {
    // The length is worth naming. Buffer.from(..., 'base64') ignores anything that is not a
    // base64 character rather than refusing, so a key generated the wrong way decodes to
    // something plausible-looking and fails here with no hint as to which mistake was made.
    // 48 bytes almost always means `openssl rand -hex 32` — 64 hex characters read as base64.
    // A short count means a passphrase was pasted in instead of a generated key. Reporting the
    // count gives that away; it gives nothing else away, being a length and not the key.
    throw new Error(
      `EMAIL_CREDENTIALS_KEY decodes to ${buf.length} bytes, not 32. `
      + 'Generate one with: openssl rand -base64 32',
    )
  }
  return buf
}

/** Returns "iv.authTag.ciphertext", each base64url, joined with '.'. */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('base64url'), authTag.toString('base64url'), ciphertext.toString('base64url')].join('.')
}

export function decrypt(encoded: string): string {
  const [ivPart, tagPart, dataPart] = encoded.split('.')
  if (!ivPart || !tagPart || !dataPart) throw new Error('Malformed encrypted value.')
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivPart, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8')
}
