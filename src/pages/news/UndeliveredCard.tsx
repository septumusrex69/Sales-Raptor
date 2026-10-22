import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MailX } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Card, CardHeader } from '../../components/ui/Card'

/**
 * EVERY ADDRESS NEWS COULD NOT REACH, IN ONE PLACE (22 Oct).
 *
 * The firm: bounces "just clog up the inbox ... perhaps we shouldn't get them in the inbox, but
 * Raptor should be flagged ... these ones didn't deliver, because of the following reasons ...
 * contact them to update their email addresses." The inbox half was already true -- a bounce
 * returns to Resend's own address on the send. subdomain, never to info@ or reports@. This is the
 * other half: the resend-webhook marks a hard bounce `undeliverable` (and a spam complaint
 * unsubscribed), so the address is never mailed again; here it is LISTED, with the reason and the
 * record to fix it on. A fixed address on the record is a new address, and is mailed as normal.
 */
interface Row {
  email: string
  status: string
  how: string
  reason: string | null
  changed_at: string
  name: string | null
  company: string | null
  link: string | null
}

export function UndeliveredCard() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      const { data: prefs } = await supabase.from('marketing_preferences')
        .select('email, status, how, reason, changed_at')
        .or('status.eq.undeliverable,how.eq.complaint')
        .order('changed_at', { ascending: false }).limit(500)
      const list = (prefs ?? []) as Omit<Row, 'name' | 'company' | 'link'>[]
      const emails = list.map((p) => p.email)
      const who = new Map<string, { name: string | null; company: string | null; link: string | null; error: string | null }>()
      for (let i = 0; i < emails.length; i += 100) {
        const { data: sends } = await supabase.from('marketing_sends')
          .select('email, first_name, company_name, lead_id, contact_id, company_id, error, sent_at')
          .in('email', emails.slice(i, i + 100)).order('sent_at', { ascending: false })
        for (const s of (sends ?? []) as Record<string, string | null>[]) {
          const email = s.email as string
          if (who.has(email)) continue
          const link = s.lead_id ? `/leads/${s.lead_id}` : s.contact_id ? `/contacts/${s.contact_id}` : s.company_id ? `/companies/${s.company_id}` : null
          who.set(email, { name: s.first_name, company: s.company_name, link, error: s.error })
        }
      }
      if (!live) return
      setRows(list.map((p) => {
        const w = who.get(p.email)
        return { ...p, reason: p.reason ?? w?.error ?? null, name: w?.name ?? null, company: w?.company ?? null, link: w?.link ?? null }
      }))
    })()
    return () => { live = false }
  }, [])

  if (!rows || rows.length === 0) return null
  const bounced = rows.filter((r) => r.status === 'undeliverable')
  const spam = rows.filter((r) => r.how === 'complaint')

  return (
    <Card padded={false}>
      <div className="px-4 pt-3">
        <CardHeader
          title={`Didn't arrive (${bounced.length})${spam.length ? ` · Marked as spam (${spam.length})` : ''}`}
          subtitle="Never mailed again. Fix the address on their record, or leave them off."
        />
      </div>
      <button type="button" onClick={() => setOpen((o) => !o)} data-testid="undelivered-toggle"
        className="mx-4 mb-3 inline-flex items-center gap-1.5 text-[13px] text-[var(--c-steel)] hover:underline">
        <MailX size={14} /> {open ? 'Hide the list' : 'Show who, and why'}
      </button>
      {open && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100 text-[13px]" data-testid="undelivered-list">
          {rows.map((r) => (
            <li key={r.email} className="px-4 py-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-medium text-slate-800">{r.name || r.company || r.email}</span>
              {(r.name || r.company) && <span className="text-slate-500">{r.email}</span>}
              <span className={r.how === 'complaint' ? 'text-amber-700' : 'text-negative-700'}>
                {r.how === 'complaint' ? 'Marked it as spam' : r.reason || 'The address does not exist'}
              </span>
              <span className="text-slate-400">{new Date(r.changed_at).toLocaleDateString('en-ZA')}</span>
              {r.link && r.how !== 'complaint' && (
                <Link to={r.link} className="ml-auto text-[var(--c-steel)] hover:underline">Fix the address</Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
