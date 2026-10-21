import crypto from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient, requireCaller } from '../auth.js'
import { credentialsKeyProblem, keyedHash, sameHex } from '../crypto.js'
import { sendAsUser } from './sendAsUser.js'
import {
  CODE_CHECK_MESSAGE, CODE_TTL_MINUTES, MAX_ATTEMPTS, codeCheck, codeSenderOrder, deviceLabel,
  isDeviceId, loginCodeEmail, maskEmail, needsDeviceCode, normaliseCode, resendDecision,
} from '../../../src/lib/loginCode.js'

/**
 * /api/email/login-code -- THE CODE AN ADMINISTRATOR TYPES ON A NEW DEVICE (S10, 21 Oct).
 *
 * Two steps on one route, because api/ is at its function limit and the two share every lookup:
 *   { step: 'send',  deviceId }        make a code, keep its HMAC, email it.
 *   { step: 'check', deviceId, code }  compare, and on a match remember this device.
 *
 * THE CODE NEVER LEAVES THIS FILE except inside the email. It is not returned, not logged, and
 * not stored -- only keyedHash(code) is. The device id arrives raw and is stored only as sha256,
 * the same digest trusted_device_seen() takes in the database, so the two agree byte for byte.
 *
 * Everything is done with the service key, AFTER requireCaller has verified the session: the
 * browser has no write path to trusted_devices or login_codes at all.
 *
 * See src/lib/loginCode.ts for what this gate does and does not stop.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const admin = adminClient()
  if (!admin) { res.status(500).json({ error: 'Server is missing Supabase configuration.' }); return }
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) { res.status(500).json({ error: keyProblem }); return }
  const caller = await requireCaller(req, admin)
  if (!caller) { res.status(401).json({ error: 'Invalid or expired session.' }); return }

  const body = (req.body ?? {}) as { step?: string; deviceId?: unknown; code?: unknown }
  if (!isDeviceId(body.deviceId)) { res.status(400).json({ error: 'This browser did not say which device it is. Reload the page.' }); return }
  const deviceHash = crypto.createHash('sha256').update(body.deviceId, 'utf8').digest('hex')

  const { data: me } = await admin.from('profiles').select('id, name, role, email, status').eq('id', caller.id).maybeSingle()
  if (!me) { res.status(403).json({ error: 'No profile for this sign-in.' }); return }
  if (!needsDeviceCode(me.role as string)) { res.status(200).json({ required: false }); return }
  if (me.status !== 'Active') { res.status(403).json({ error: 'Your account has been deactivated.' }); return }

  const label = deviceLabel(typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '')
  const trust = () => admin.from('trusted_devices').upsert(
    { user_id: caller.id, device_hash: deviceHash, label, last_seen_at: new Date().toISOString() },
    { onConflict: 'user_id,device_hash' },
  )

  /* Already one of theirs: nothing to send. The app asks the database first, so this is the
     second line, for a browser that skipped it. */
  const { data: known } = await admin.from('trusted_devices').select('id')
    .eq('user_id', caller.id).eq('device_hash', deviceHash).maybeSingle()
  if (known) { res.status(200).json({ trusted: true }); return }

  if (body.step === 'send') { await send(admin, res, me as Profile, caller.email ?? null, deviceHash, label, trust); return }
  if (body.step === 'check') { await check(admin, res, caller.id, deviceHash, body.code, trust); return }
  res.status(400).json({ error: 'Unknown step.' })
}

interface Profile { id: string; name: string; role: string; email: string | null; status: string }
type Trust = () => PromiseLike<{ error: { message: string } | null }>

async function send(
  admin: SupabaseClient, res: VercelResponse, me: Profile, authEmail: string | null,
  deviceHash: string, label: string, trust: Trust,
) {
  const now = Date.now()

  /*
   * THE WAY OUT, SPENT FIRST. Another Administrator pressed "Let in without a code" in Settings ->
   * Users because this person's mail is not arriving. Checked before the throttle, so somebody
   * who has already pressed "Send" five times is still let in once a colleague has vouched.
   */
  const { data: waiver } = await admin.from('login_code_waivers').select('expires_at')
    .eq('user_id', me.id).maybeSingle()
  if (waiver) {
    await admin.from('login_code_waivers').delete().eq('user_id', me.id)
    if (Date.parse(waiver.expires_at as string) > now) {
      const { error } = await trust()
      if (error) { res.status(500).json({ error: error.message }); return }
      await admin.from('login_codes').delete().eq('user_id', me.id)
      res.status(200).json({ trusted: true, waived: true }); return
    }
  }

  const to = me.email || authEmail
  if (!to) { res.status(400).json({ error: 'Your profile has no email address to send the code to. Ask another Administrator to let you in.' }); return }

  const { data: last } = await admin.from('login_codes')
    .select('sent_at, window_started_at, sends_in_window').eq('user_id', me.id).maybeSingle()
  const decision = resendDecision(last ? {
    sentAt: last.sent_at as string, windowStartedAt: last.window_started_at as string,
    sendsInWindow: Number(last.sends_in_window ?? 0),
  } : null, now)
  if (!decision.ok) { res.status(429).json({ error: decision.reason, waitSeconds: decision.waitSeconds }); return }

  /* crypto.randomInt is uniform over the range; Math.random is neither secret nor uniform. */
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const nowIso = new Date(now).toISOString()
  /*
   * STORED BEFORE IT IS SENT, so the code works the moment it lands. If no mailbox will carry
   * it, it is expired below rather than removed -- the throttle still counts the attempt.
   */
  const { error: saveErr } = await admin.from('login_codes').upsert({
    user_id: me.id, device_hash: deviceHash, code_hash: keyedHash('login-code', `${me.id}:${code}`),
    expires_at: new Date(now + CODE_TTL_MINUTES * 60_000).toISOString(), attempts: 0,
    sent_at: nowIso, window_started_at: decision.windowStartedAt, sends_in_window: decision.sendsInWindow,
    sent_from: null,
  }, { onConflict: 'user_id' })
  if (saveErr) { res.status(500).json({ error: saveErr.message }); return }

  const [{ data: admins }, { data: boxes }] = await Promise.all([
    admin.from('profiles').select('id, name, status').eq('role', 'Administrator'),
    admin.from('email_connections').select('user_id'),
  ])
  const withMailbox = new Set((boxes ?? []).map((b) => b.user_id as string))
  const order = codeSenderOrder(me.id, (admins ?? []).map((a) => ({
    id: a.id as string, name: String(a.name ?? ''), hasMailbox: withMailbox.has(a.id as string), active: a.status === 'Active',
  })))

  const mail = loginCodeEmail({ name: me.name, code, device: label })
  let from: string | null = null
  let lastError = 'No Administrator has a mailbox connected to send it from.'
  for (const senderId of order) {
    const sent = await sendAsUser(admin, senderId, { to, subject: mail.subject, bodyHtml: mail.html })
    if (sent.ok) { from = sent.from; break }
    lastError = sent.error
  }
  if (!from) {
    await admin.from('login_codes').update({ expires_at: nowIso }).eq('user_id', me.id)
    /* The reason, never the code. */
    console.error(`[login-code] no mailbox would send for ${me.id}: ${lastError}`)
    res.status(502).json({ error: `The code could not be emailed (${lastError}). Ask another Administrator to let you in from Settings → Users.` })
    return
  }
  await admin.from('login_codes').update({ sent_from: from }).eq('user_id', me.id)
  res.status(200).json({ sent: true, to: maskEmail(to) })
}

async function check(
  admin: SupabaseClient, res: VercelResponse, userId: string, deviceHash: string, typed: unknown, trust: Trust,
) {
  const code = normaliseCode(typed)
  if (!code) { res.status(400).json({ error: 'The code is six digits.' }); return }

  const { data: row } = await admin.from('login_codes')
    .select('device_hash, code_hash, expires_at, attempts').eq('user_id', userId).maybeSingle()
  const verdict = codeCheck(row ? {
    deviceHash: row.device_hash as string, expiresAt: row.expires_at as string, attempts: Number(row.attempts ?? 0),
  } : null, deviceHash, Date.now())
  if (verdict !== 'compare' || !row) { res.status(400).json({ error: CODE_CHECK_MESSAGE[verdict === 'compare' ? 'none' : verdict] }); return }

  /*
   * THE TRY IS COUNTED BEFORE THE ANSWER, and only if nobody else counted it first: the update
   * names the number it read. Two guesses sent at once cannot both be the fifth.
   */
  const attempts = Number(row.attempts ?? 0)
  const { data: counted } = await admin.from('login_codes').update({ attempts: attempts + 1 })
    .eq('user_id', userId).eq('attempts', attempts).select('user_id')
  if (!counted || counted.length === 0) { res.status(409).json({ error: 'Try that again.' }); return }

  if (!sameHex(keyedHash('login-code', `${userId}:${code}`), row.code_hash as string)) {
    const left = MAX_ATTEMPTS - (attempts + 1)
    res.status(400).json({
      error: left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : CODE_CHECK_MESSAGE['used-up'],
      attemptsLeft: left,
    })
    return
  }

  /* Single use: the code goes the moment it has worked. */
  await admin.from('login_codes').delete().eq('user_id', userId)
  const { error } = await trust()
  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(200).json({ trusted: true })
}
