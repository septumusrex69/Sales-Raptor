import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Store an error and, the first time we see it, email someone about it.
 *
 * Used by /api/report-error for browser crashes, and callable from any other API route's catch
 * block for server-side ones:
 *
 *   } catch (e) { await recordError(admin, { message: String(e), source: 'server', url: req.url }); throw e }
 *
 * Configuration (Vercel -> Project -> Settings -> Environment Variables):
 *   ERROR_ALERT_EMAIL   who gets told, comma-separated for several people
 *   RESEND_API_KEY      a Resend key (resend.com). Absent: errors are still stored, just not emailed.
 *   ERROR_ALERT_FROM    optional sender, default "Raptor Alerts <onboarding@resend.dev>"
 *
 * One email per distinct error per QUIET_HOURS. Twenty collectors hitting the same bug is one
 * bug, and the table's `occurrences` count says how many times it happened.
 */
const QUIET_HOURS = 6

export interface ErrorReport {
  message: string
  stack?: string
  componentStack?: string
  source: string
  url?: string
  userAgent?: string
  build?: string
  userId?: string | null
  userEmail?: string | null
}

/*
 * Same bug, same fingerprint -- even when the message carries an id or an amount. Numbers and
 * uuids are stripped from the message, and only the top frame of the stack (minus the build
 * hash and line:col, which move on every deploy) is kept.
 */
export function fingerprint(r: Pick<ErrorReport, 'message' | 'stack' | 'source'>): string {
  const msg = r.message.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>').replace(/\d+/g, '<n>')
  const frame = (r.stack ?? '').split('\n').find((l) => /^\s+at\s/.test(l) || l.includes('@')) ?? ''
  const where = frame.replace(/-[A-Za-z0-9_]{8}\.js/g, '.js').replace(/:\d+:\d+/g, '').trim()
  return createHash('sha256').update(`${r.source}|${msg}|${where}`).digest('hex').slice(0, 16)
}

export async function recordError(admin: SupabaseClient | null, r: ErrorReport): Promise<{ emailed: boolean }> {
  const fp = fingerprint(r)
  let isNew = true

  if (admin) {
    const since = new Date(Date.now() - QUIET_HOURS * 3_600_000).toISOString()
    const { data: recent } = await admin
      .from('error_reports')
      .select('id, occurrences')
      .eq('fingerprint', fp)
      .gte('last_seen_at', since)
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recent) {
      isNew = false
      await admin.from('error_reports')
        .update({ occurrences: (recent.occurrences ?? 1) + 1, last_seen_at: new Date().toISOString(), last_url: r.url ?? null })
        .eq('id', recent.id)
    } else {
      const { error } = await admin.from('error_reports').insert({
        fingerprint: fp,
        message: r.message,
        stack: r.stack ?? null,
        component_stack: r.componentStack ?? null,
        source: r.source,
        first_url: r.url ?? null,
        last_url: r.url ?? null,
        user_agent: r.userAgent ?? null,
        build: r.build ?? null,
        user_id: r.userId ?? null,
        user_email: r.userEmail ?? null,
      })
      // Table not created yet: still email, so the alert works before the migration does.
      if (error) console.error('error_reports insert failed:', error.message)
    }
  }

  // Always in the Vercel function log too, which is where a missing table or key gets noticed.
  console.error(`[raptor-error ${fp}] ${r.source}: ${r.message}${r.url ? ` @ ${r.url}` : ''}`)

  if (!isNew) return { emailed: false }
  return { emailed: await sendAlert(r, fp) }
}

async function sendAlert(r: ErrorReport, fp: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  const to = process.env.ERROR_ALERT_EMAIL?.split(',').map((s) => s.trim()).filter(Boolean)
  if (!key || !to?.length) return false

  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  const who = r.userEmail ?? 'not signed in'
  const html = `
    <h2 style="margin:0 0 8px">Raptor hit an error</h2>
    <p style="margin:0 0 12px;font-size:15px"><b>${esc(r.message)}</b></p>
    <table style="font-size:13px;border-collapse:collapse">
      <tr><td style="padding:2px 12px 2px 0;color:#666">Where</td><td>${esc(r.url ?? '-')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Who</td><td>${esc(who)}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Kind</td><td>${esc(r.source)}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Browser</td><td>${esc(r.userAgent ?? '-')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Build</td><td>${esc(r.build ?? '-')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Fingerprint</td><td>${fp}</td></tr>
    </table>
    ${r.stack ? `<pre style="font-size:11px;background:#f5f5f5;padding:8px;white-space:pre-wrap">${esc(r.stack.slice(0, 3000))}</pre>` : ''}
    <p style="font-size:12px;color:#666">You will not be emailed about this same error again for ${QUIET_HOURS} hours.
    Every occurrence is counted in the <code>error_reports</code> table.</p>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.ERROR_ALERT_FROM ?? 'Raptor Alerts <onboarding@resend.dev>',
        to,
        subject: `[Raptor bug] ${r.message.slice(0, 90)}`,
        html,
      }),
    })
    if (!res.ok) console.error('error alert email failed:', res.status, await res.text())
    return res.ok
  } catch (e) {
    console.error('error alert email failed:', e)
    return false
  }
}
