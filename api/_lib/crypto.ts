import crypto from 'node:crypto'

/**
 * AES-256-GCM at-rest encryption for mailbox passwords. Defense in depth on
 * top of RLS (email_connections already has zero policies for authenticated/
 * anon) -- a raw DB dump or a misconfigured policy still wouldn't expose a
 * usable password. EMAIL_CREDENTIALS_KEY must be a 32-byte key, base64-encoded.
 */
function getKey(): Buffer {
  const key = process.env.EMAIL_CREDENTIALS_KEY
  if (!key) throw new Error('Server is missing EMAIL_CREDENTIALS_KEY configuration.')
  const buf = Buffer.from(key, 'base64')
  if (buf.length !== 32) throw new Error('EMAIL_CREDENTIALS_KEY must decode to exactly 32 bytes.')
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
