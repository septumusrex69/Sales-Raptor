/**
 * NEWS & CAMPAIGNS: WHO A NEWSLETTER GOES TO, WHAT IT SAYS, AND THAT "STOP" MEANS STOP (S10, 21 Oct).
 *
 * The firm: "bulk communication to our clients ... It should be able to unsubscribe or subscribe ...
 * only for specific news ... not for reports. Then as well for leads ... to try to reactivate them,
 * leads that are dormant."
 *
 * POPIA s69 is the rule held here. A client (an existing customer) is in by default and opts out; a
 * lead needs a recorded yes, or gets ONE first approach ever; every message carries a way out; and
 * an address that has said stop is never sent news again -- read when the list is drawn AND again
 * at the moment each chunk goes. Resend is never reached: every call here is a stub.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-marketing.mjs
 */
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'

process.env.EMAIL_CREDENTIALS_KEY = crypto.randomBytes(32).toString('base64')
process.env.RESEND_API_KEY = 're_test_not_a_real_key'
process.env.MARKETING_FROM = 'Bredell Ferreira <news@example.test>'
process.env.MARKETING_REPLY_TO = 'info@example.test'
delete process.env.VERCEL_ENV; delete process.env.VERCEL_URL; delete process.env.VERCEL_BRANCH_URL

const M = await import('../../src/lib/marketing.ts')
const { CHARTER_EMAIL_STACK } = await import('../../src/lib/charter.ts')
const { isMeaningfulActivity, isContactActivity } = await import('../../src/lib/meaningfulActivity.ts')
const S = await import('../../api/_lib/marketing.ts')
const W = await import('../../api/_lib/email/resendWebhook.ts')

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, v) => check(name, v, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

/* ------------------------------------------------------------------------------------------------
 * 1. The list
 * ---------------------------------------------------------------------------------------------- */

const NOW = '2026-10-21T08:00:00Z'
const daysAgo = (n) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString()
const base = {
  firstApproach: false,
  companies: [
    { id: 'c1', name: 'Smit & Seun', email: 'Accounts@Smit.co.za ', contactPerson: 'Piet Smit', services: ['Debt Collection'] },
    { id: 'c1b', name: 'Smit Branch', email: 'branch@smit.co.za', parentCompanyId: 'c1', services: ['Tracing'] },
    { id: 'c2', name: 'Karoo Ltd', email: 'gone@karoo.co.za', services: ['Litigation'] },
    { id: 'c3', name: 'No Mail (Pty) Ltd', email: undefined, services: [] },
  ],
  contacts: [
    { id: 'p1', firstName: 'Anna', email: 'anna@smit.co.za', companyId: 'c1' },
    { id: 'p2', firstName: 'Ben', email: 'ben@smit.co.za', companyId: 'c1b' },
    { id: 'p3', firstName: 'Dup', email: 'ACCOUNTS@smit.co.za', companyId: 'c1' },
    { id: 'p4', firstName: 'Lena', email: 'lena@prospect.co.za', leadId: 'l1' },
    { id: 'p5', firstName: 'Typo', email: 'typo@', companyId: 'c2' },
  ],
  leads: [
    { id: 'l1', firstName: 'Lena', companyName: 'Prospect', email: 'lena@prospect.co.za', status: 'Interested', source: 'Website', createdAt: daysAgo(400), marketingConsentAt: daysAgo(10), statusChangedAt: daysAgo(400) },
    { id: 'l2', firstName: 'Quiet', companyName: 'Quiet Co', email: 'quiet@q.co.za', status: 'Interested', source: 'Referral', createdAt: daysAgo(200), statusChangedAt: daysAgo(200) },
    { id: 'l3', firstName: 'Busy', companyName: 'Busy Co', email: 'busy@b.co.za', status: 'Hot Lead', source: 'Website', createdAt: daysAgo(200), statusChangedAt: daysAgo(200) },
    { id: 'l4', firstName: 'Won', companyName: 'Won Co', email: 'won@w.co.za', status: 'Converted', source: 'Website', createdAt: daysAgo(300), marketingConsentAt: daysAgo(300) },
    { id: 'l5', firstName: 'Declined', companyName: 'Nope', email: 'no@n.co.za', status: 'Rejected', rejectionReason: 'We declined them', source: 'Website', createdAt: daysAgo(300), marketingConsentAt: daysAgo(300) },
    { id: 'l6', firstName: 'Lost', companyName: 'Lost Co', email: 'lost@l.co.za', status: 'Rejected', rejectionReason: 'No response', source: 'Email', createdAt: daysAgo(300), marketingConsentAt: daysAgo(300), statusChangedAt: daysAgo(250) },
    { id: 'l7', firstName: 'Moved', companyName: 'Moved Co', email: 'moved@m.co.za', status: 'Interested', source: 'Website', createdAt: daysAgo(300), marketingConsentAt: daysAgo(300), statusChangedAt: daysAgo(5) },
    { id: 'l8', firstName: 'Client', companyName: 'Smit', email: 'anna@smit.co.za', status: 'Interested', source: 'Website', createdAt: daysAgo(300), marketingConsentAt: daysAgo(300) },
  ],
  activities: [
    { leadId: 'l3', activityDate: daysAgo(3), type: 'Call', subject: 'Called' },
    /* A newsletter we sent is not the lead doing anything. */
    { leadId: 'l2', activityDate: daysAgo(1), type: 'Email', subject: 'Newsletter: October news' },
  ],
  preferences: new Map([['gone@karoo.co.za', 'unsubscribed']]),
  approachedLeads: new Set(),
  now: NOW,
}
const run = (over) => M.resolveAudience({ ...base, ...over })
const emails = (r) => r.recipients.map((x) => x.email)

{
  const r = run({ audience: { kind: 'all_clients' } })
  check('all clients: each client\'s own address and every contact in the family, normalised, once',
    emails(r), ['accounts@smit.co.za', 'anna@smit.co.za', 'ben@smit.co.za'])
  check('...a sub-account\'s own address is not a top-level client\'s', emails(r).includes('branch@smit.co.za'), false)
  check('...the unsubscribed address is left out and counted', r.excluded.unsubscribed, 1)
  check('...the same address on two records goes once', r.excluded['on the list twice'], 1)
  check('...a typo is kept off rather than failing a batch', r.excluded['address does not look right'], 1)
  check('...a client with no address is counted', r.excluded['no address'], 1)
  check('...a client is in by default: no consent asked of a customer (s69(3))', r.recipients.every((x) => !x.firstApproach), true)
  check('...the first name comes from the client\'s contact person', r.recipients[0].firstName, 'Piet')
  check('...and the contact\'s company is the client, for {{company}}', r.recipients.find((x) => x.email === 'ben@smit.co.za')?.companyName, 'Smit & Seun')
}
{
  const r = run({ audience: { kind: 'clients_by_service', services: ['Tracing'] } })
  check('clients by service: a service signed by a sub-account brings in the family', emails(r), ['accounts@smit.co.za', 'anna@smit.co.za', 'ben@smit.co.za'])
  check('...and nobody else', run({ audience: { kind: 'clients_by_service', services: ['NovaCall'] } }).recipients.length, 0)
}
{
  const r = run({ audience: { kind: 'active_leads' } })
  check('active leads: only the consented go without a first approach (s69(1))', emails(r), ['lena@prospect.co.za', 'moved@m.co.za', 'anna@smit.co.za'])
  check('...the rest are counted as no consent', r.excluded['no consent recorded'], 2)
  const fa = run({ audience: { kind: 'active_leads' }, firstApproach: true })
  check('with a first approach, the unconsented go, marked so', fa.recipients.filter((x) => x.firstApproach).map((x) => x.email), ['quiet@q.co.za', 'busy@b.co.za'])
  const again = run({ audience: { kind: 'active_leads' }, firstApproach: true, approachedLeads: new Set(['l2']) })
  check('...but once ever: a lead already approached is left out', emails(again).includes('quiet@q.co.za'), false)
  check('...and counted as such', again.excluded['already approached once'], 1)
  check('a converted lead is a client now and is not on a lead list', emails(fa).includes('won@w.co.za'), false)
}
{
  const r = run({ audience: { kind: 'dormant_leads', days: 90, includeLost: true }, firstApproach: true })
  check('dormant: untouched for 90 days, lost ones included, never the ones we declined',
    emails(r), ['lena@prospect.co.za', 'quiet@q.co.za', 'lost@l.co.za', 'anna@smit.co.za'])
  check('...a call three days ago keeps a lead off it', emails(r).includes('busy@b.co.za'), false)
  check('...a status changed five days ago keeps a lead off it', emails(r).includes('moved@m.co.za'), false)
  check('...our own newsletter yesterday does NOT', emails(r).includes('quiet@q.co.za'), true)
  check('...lost ones can be left out', emails(run({ audience: { kind: 'dormant_leads', days: 90, includeLost: false }, firstApproach: true })).includes('lost@l.co.za'), false)
  check('...the day count is the screen\'s', emails(run({ audience: { kind: 'dormant_leads', days: 500, includeLost: true }, firstApproach: true })), [])
}
check('a lead\'s last touch ignores updated_at and newsletters',
  M.leadLastTouch({ createdAt: daysAgo(100), lastContactAt: daysAgo(50), statusChangedAt: daysAgo(60), updatedAt: daysAgo(1) },
    [{ activityDate: daysAgo(2), type: 'Email', subject: 'Newsletter: hi' }, { activityDate: daysAgo(40), type: 'Note', subject: 'x' }]),
  daysAgo(40))
check('leads by status and source', emails(run({ audience: { kind: 'leads_by', statuses: ['Rejected'], sources: ['Email'] } })), ['lost@l.co.za'])
{
  const r = run({ audience: { kind: 'manual', picks: [{ type: 'contact', id: 'p4' }, { type: 'company', id: 'c2' }, { type: 'lead', id: 'l2' }] } })
  check('a manual pick still obeys consent and unsubscribes', emails(r), ['lena@prospect.co.za'])
  check('...a lead\'s own contact person is a lead for consent', r.recipients[0].via, 'lead')
}
check('a client and a lead on one address: the client basis wins',
  run({ audience: { kind: 'all_clients' } }).recipients.find((x) => x.email === 'anna@smit.co.za')?.via, 'contact')
check('an undeliverable address is left out', run({ audience: { kind: 'all_clients' }, preferences: new Map([['anna@smit.co.za', 'undeliverable']]) }).excluded.undeliverable, 1)
check('a stored audience that is not one is refused, not read as everybody', M.parseAudience({ kind: 'everyone' }), null)
check('...a dormant period that is nonsense falls back to 90', M.parseAudience({ kind: 'dormant_leads', days: 'x' }).days, 90)

/* ------------------------------------------------------------------------------------------------
 * 2. The message
 * ---------------------------------------------------------------------------------------------- */

const face = { emailFont: CHARTER_EMAIL_STACK, emailSizePt: 11 }
const opts = { unsubscribeUrl: 'https://raptor.test/unsubscribe/TOKEN', firmName: 'Bredell Ferreira', face, firmAddress: 'PO Box 1\nPretoria', basis: 'client' }
const content = {
  subject: 'News for {{company}}', preheader: 'Hello {{first_name}}',
  body: 'Dear {{first_name}},\n\nNews for {{company}}. Read **this** at https://bf.co.za/blog. Or [our site](https://bf.co.za/a?x=1&y=2).\nNot [this](javascript:alert(1)) <script>x</script>\n\nKind regards',
  imageUrl: 'https://bf.co.za/a.png',
}
const e = M.renderCampaignEmail(content, { firstName: null, companyName: 'Smit & Seun' }, opts)
check('the subject is merged, as text', e.subject, 'News for Smit & Seun')
ok('a missing first name is Sir/Madam, not a blank', e.html.includes('Dear Sir/Madam,'))
ok('the company is escaped in the markup', e.html.includes('News for Smit &amp; Seun.') && !e.html.includes('Smit & Seun'))
ok('nothing typed becomes markup', !e.html.includes('<script>') && e.html.includes('&lt;script&gt;'))
ok('a blank line is a paragraph (the house rule, emailBodyHtml)', e.html.includes('<br><br>'))
ok('**bold** is bold', e.html.includes('<b>this</b>'))
ok('a bare https address is a link, its full stop left outside', e.html.includes('<a href="https://bf.co.za/blog" style="color:#1d4ed8">https://bf.co.za/blog</a>.'))
ok('[words](url) is a link', /<a href="https:\/\/bf\.co\.za\/a\?x=1&amp;y=2"[^>]*>our site<\/a>/.test(e.html))
ok('a javascript: link stays words', !/href="javascript/i.test(e.html))
ok('set in the firm\'s face: Charter asked for, Georgia drawn', e.html.includes(`font-family:${CHARTER_EMAIL_STACK}`) && /Charter[^;]*Georgia/.test(e.html))
ok('the preheader is in it, hidden', /display:none[^>]*>Hello Sir\/Madam</.test(e.html))
ok('an https picture is drawn', e.html.includes('<img src="https://bf.co.za/a.png"'))
ok('an http one is not', !M.renderCampaignEmail({ ...content, imageUrl: 'http://x.test/a.png' }, {}, opts).html.includes('<img'))
ok('EVERY message carries the unsubscribe link (s69(4)(b))', e.html.includes('href="https://raptor.test/unsubscribe/TOKEN"') && e.text.includes('https://raptor.test/unsubscribe/TOKEN'))
ok('...says who sent it', e.html.includes('Bredell Ferreira') && e.html.includes('PO Box 1<br>Pretoria'))
ok('...and that reports are not affected', /statements and reports about your matters are not affected/.test(e.html))
ok('a lead is told why differently from a client', M.renderCampaignEmail(content, {}, { ...opts, basis: 'lead' }).html.includes('you have been in touch with'))
ok('the text twin writes links out', e.text.includes('our site (https://bf.co.za/a?x=1&y=2)') && !e.text.includes('**'))
check('merge fields the editor does not know are reported', M.unknownMergeFields('{{first_name}} {{balance}} {{ company }}'), ['balance'])
check('the timeline line', M.newsletterActivitySubject('October'), 'Newsletter: October')

/* A newsletter on a timeline is nobody's work. */
const nl = { type: 'Email', subject: M.newsletterActivitySubject('October') }
check('a newsletter line is not a meaningful activity', isMeaningfulActivity(nl), false)
check('...nor an attempt to reach somebody', isContactActivity(nl), false)
check('...while an ordinary email still is', isMeaningfulActivity({ type: 'Email', subject: 'Sent: hello' }), true)

/* ------------------------------------------------------------------------------------------------
 * 3. The unsubscribe token, the webhook signature, the bounce rule
 * ---------------------------------------------------------------------------------------------- */

const t = S.unsubscribeToken(' Anna@Smit.co.za ')
check('the token names the normalised address', S.readUnsubscribeToken(t), 'anna@smit.co.za')
check('a tampered signature is refused', S.readUnsubscribeToken(t.slice(0, -1) + (t.endsWith('0') ? '1' : '0')), null)
check('another address with this signature is refused',
  S.readUnsubscribeToken(`${Buffer.from('ben@smit.co.za').toString('base64url')}.${t.split('.')[1]}`), null)
check('nonsense is refused', S.readUnsubscribeToken('x.y'), null)

const secretBytes = crypto.randomBytes(24)
const secret = `whsec_${secretBytes.toString('base64')}`
const body = JSON.stringify({ type: 'email.bounced', data: { email_id: 're_1' } })
const ts = String(Math.floor(Date.parse(NOW) / 1000))
const sig = crypto.createHmac('sha256', secretBytes).update(`msg_1.${ts}.${body}`).digest('base64')
ok('a webhook signed by Resend is accepted', W.verifySvix(secret, 'msg_1', ts, `v1,${sig}`, body, Date.parse(NOW)))
ok('...among several signatures', W.verifySvix(secret, 'msg_1', ts, `v1,AAAA v1,${sig}`, body, Date.parse(NOW)))
check('...a changed body is refused', W.verifySvix(secret, 'msg_1', ts, `v1,${sig}`, body.replace('re_1', 're_2'), Date.parse(NOW)), false)
check('...a replay ten minutes late is refused', W.verifySvix(secret, 'msg_1', ts, `v1,${sig}`, body, Date.parse(NOW) + 600_000), false)
check('...no signature, no entry', W.verifySvix(secret, 'msg_1', ts, '', body, Date.parse(NOW)), false)
check('a hard bounce makes the address undeliverable', W.bounceOutcome({ type: 'email.bounced', data: { bounce: { type: 'Permanent' } } }).preference, 'undeliverable')
check('a soft bounce leaves it alone', W.bounceOutcome({ type: 'email.bounced', data: { bounce: { type: 'Transient' } } }).preference, null)
check('a spam complaint is an unsubscribe (s69)', W.bounceOutcome({ type: 'email.complained', data: {} }).preference, 'unsubscribed')
check('anything else is ignored', W.bounceOutcome({ type: 'email.delivered' }), null)

/* ------------------------------------------------------------------------------------------------
 * 4. Resend, stubbed: the call, and the drain around it
 * ---------------------------------------------------------------------------------------------- */

const mail = (to) => ({ from: 'a', to: [to], subject: 's', html: 'h', text: 't', headers: {} })
{
  const calls = []
  const f = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ data: [{ id: 'r1' }, { id: 'r2' }] }) } }
  const out = await S.resendSend('k', [mail('a@x.co'), mail('b@x.co')], 'key-1', f)
  check('two go to the batch endpoint', calls[0].url, 'https://api.resend.com/emails/batch')
  check('...with an idempotency key', calls[0].init.headers['Idempotency-Key'], 'key-1')
  check('...and the ids come back in order', out, { ok: true, ids: ['r1', 'r2'] })
  const one = []
  await S.resendSend('k', [mail('a@x.co')], 'k2', async (url) => { one.push(url); return { ok: true, status: 200, json: async () => ({ id: 'r9' }) } })
  check('one goes to the single endpoint', one[0], 'https://api.resend.com/emails')
  const short = await S.resendSend('k', [mail('a@x.co'), mail('b@x.co')], 'k3', async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'r1' }] }) }))
  check('an answer that does not line up is a failure, not a guess', short.ok, false)
  check('the same rows give the same key, whatever the order', S.idempotencyKey(['b', 'a']), S.idempotencyKey(['a', 'b']))
}

/** Enough of a Supabase client for the drain: a thenable builder per table, and the two RPCs. */
function fakeAdmin(db) {
  const log = { records: [], activities: [] }
  const builder = (table) => {
    const q = { table, filters: [] }
    const b = {
      select: () => b, eq: (c, v) => { q.filters.push(['eq', c, v]); return b }, neq: () => b, not: () => b, order: () => b,
      in: (c, v) => { q.filters.push(['in', c, v]); return b },
      insert: (rows) => { if (table === 'activities') log.activities.push(...rows); return Promise.resolve({ error: null }) },
      update: () => b, upsert: () => Promise.resolve({ error: null }),
      maybeSingle: () => Promise.resolve({ data: table === 'marketing_campaigns' ? db.campaign : table === 'firm_settings' ? { firm_name: 'Bredell Ferreira' } : null }),
      then: (res) => res(table === 'marketing_preferences'
        ? { data: db.prefs.filter((p) => (q.filters.find((f) => f[0] === 'in')?.[2] ?? []).includes(p.email)) }
        : table === 'marketing_sends' ? { count: db.queue.length } : { data: [] }),
    }
    return b
  }
  return {
    log,
    from: builder,
    rpc: async (name, args) => {
      if (name === 'marketing_claim_sends') { const chunk = db.queue.splice(0, args.p_limit); return { data: chunk, error: null } }
      if (name === 'marketing_record_results') { log.records.push(...args.p_results); return { data: 1, error: null } }
      return { data: null, error: null }
    },
  }
}
const row = (i, email, extra = {}) => ({ id: `s${i}`, campaign_id: 'c', email, first_name: 'Anna', company_name: 'Smit', company_id: 'c1', contact_id: null, lead_id: null, first_approach: false, attempts: 1, ...extra })
const campaign = { id: 'c', name: 'n', subject: 'October', preheader: '', body: 'Hi {{first_name}}', image_url: null, audience: { kind: 'all_clients' }, first_approach: false, status: 'sending', created_by: 'u1', queued_by: 'u2' }
{
  /* Somebody unsubscribed AFTER the list was drawn: their row is skipped, not sent. */
  const db = { campaign, queue: [row(1, 'a@x.co'), row(2, 'stop@x.co'), row(3, 'b@x.co', { attempts: 9 })], prefs: [{ email: 'stop@x.co', status: 'unsubscribed' }] }
  const admin = fakeAdmin(db)
  const sent = []
  const report = await S.drainMarketing(admin, { budgetMs: 5000, host: 'raptor.test', fetchImpl: async (url, init) => {
    const list = JSON.parse(init.body); sent.push(...(Array.isArray(list) ? list : [list]))
    return { ok: true, status: 200, json: async () => (Array.isArray(list) ? { data: list.map((_, i) => ({ id: `re_${i}` })) } : { id: 're_0' }) }
  } })
  check('the drain re-reads the unsubscribes: only the live address is sent', sent.map((m) => m.to[0]), ['a@x.co'])
  check('...the objector is skipped', admin.log.records.find((r) => r.id === 's2')?.state, 'skipped')
  check('...a row tried too often is failed, not tried again', admin.log.records.find((r) => r.id === 's3')?.state, 'failed')
  check('...the sent one is recorded with Resend\'s id', admin.log.records.find((r) => r.id === 's1'), { id: 's1', state: 'sent', resend_id: 're_0', error: null })
  check('...the report adds up', [report.sent, report.skipped, report.failed], [1, 1, 1])
  ok('every email carries the one-click headers (RFC 8058)', /^<https:\/\/raptor\.test\/api\/email\/unsubscribe\?t=[^>]+>$/.test(sent[0].headers['List-Unsubscribe'])
    && sent[0].headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click')
  ok('...and the link in the body opens the page for that address', S.readUnsubscribeToken(/\/unsubscribe\/([^"]+)"/.exec(sent[0].html)?.[1]) === 'a@x.co')
  check('...from the configured sender, replies to the firm', [sent[0].from, sent[0].reply_to], ['Bredell Ferreira <news@example.test>', 'info@example.test'])
  check('one timeline line per email that went, under whoever pressed Send',
    admin.log.activities.map((a) => [a.type, a.subject, a.user_id, a.company_id]), [['Email', 'Newsletter: October', 'u2', 'c1']])
}
{
  /* One bad address fails a batch at Resend: sent again one by one, only the bad one fails. */
  const db = { campaign, queue: [row(1, 'a@x.co'), row(2, 'b@x.co')], prefs: [] }
  const admin = fakeAdmin(db)
  const report = await S.drainMarketing(admin, { budgetMs: 8000, host: 'raptor.test', fetchImpl: async (url, init) => {
    const list = JSON.parse(init.body)
    if (Array.isArray(list)) return { ok: false, status: 422, json: async () => ({ message: 'Invalid `to` field' }) }
    return list.to[0] === 'b@x.co' ? { ok: false, status: 422, json: async () => ({ message: 'bad' }) } : { ok: true, status: 200, json: async () => ({ id: 're_a' }) }
  } })
  check('a refused batch is retried one by one', admin.log.records.map((r) => [r.id, r.state]), [['s1', 'sent'], ['s2', 'failed']])
  check('...and nothing is stopped for it', report.stoppedFor, null)
}
{
  /* Rate-limited: nothing is lost, it goes back in the queue and the drain stops. */
  const db = { campaign, queue: [row(1, 'a@x.co'), row(2, 'b@x.co')], prefs: [] }
  const admin = fakeAdmin(db)
  const report = await S.drainMarketing(admin, { budgetMs: 5000, host: 'raptor.test', fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ message: 'Too many requests' }) }) })
  check('a 429 puts every row back in the queue', admin.log.records.map((r) => r.state), ['queued', 'queued'])
  ok('...and says why it stopped', /slow down/.test(report.stoppedFor ?? ''))
}
{
  /* NOTHING PRETENDS: no key, no send. */
  const key = process.env.RESEND_API_KEY
  delete process.env.RESEND_API_KEY
  let called = false
  const admin = fakeAdmin({ campaign, queue: [row(1, 'a@x.co')], prefs: [] })
  const report = await S.drainMarketing(admin, { budgetMs: 1000, host: 'raptor.test', fetchImpl: async () => { called = true; return { ok: true, status: 200, json: async () => ({}) } } })
  check('without RESEND_API_KEY nothing is claimed or sent', [called, admin.log.records.length], [false, 0])
  ok('...and it says what is missing', /RESEND_API_KEY/.test(report.stoppedFor ?? ''))
  const cfg = await S.senderConfig(admin)
  check('the config names the missing variable', cfg.missing, ['RESEND_API_KEY'])
  process.env.RESEND_API_KEY = key
}

/* ------------------------------------------------------------------------------------------------
 * 5. Read back: the routes, the cron, the database
 * ---------------------------------------------------------------------------------------------- */

const dispatcher = code('api/email/[action].ts')
ok('the sender, the unsubscribe and the webhook are actions on the email dispatcher (no new function)',
  /\bmarketing,/.test(dispatcher) && /\bunsubscribe,/.test(dispatcher) && /'resend-webhook': resendWebhook/.test(dispatcher))
const apiFiles = (await import('node:fs')).readdirSync(new URL('../../api', import.meta.url), { recursive: true })
  .filter((f) => f.endsWith('.ts') && !f.startsWith('_lib'))
check('api/ is still twelve functions or fewer', apiFiles.length <= 12, true)
const mk = code('api/_lib/email/marketing.ts')
ok('the sender asks for marketing.send itself', /can\([\s\S]{0,140}'marketing\.send'\)/.test(mk))
ok('...and refuses to send on a half-set-up sender', mk.indexOf("if (!config.ready)") > 0 && mk.indexOf("if (!config.ready)") < mk.indexOf("body.step === 'queue'"))
const unsub = code('api/_lib/email/unsubscribe.ts')
ok('the public unsubscribe needs no session', !/requireCaller/.test(unsub))
ok('...only the signed token', /readUnsubscribeToken\(token\)/.test(unsub))
ok('...and a GET never acts (link scanners fetch everything)', /req\.method === 'GET'[\s\S]{0,200}status\(303\)/.test(unsub))
ok('...the first objection\'s date is kept', /if \(current === 'unsubscribed'\) return/.test(unsub))
const hook = code('api/_lib/email/resendWebhook.ts')
ok('the webhook refuses everything without its secret', /if \(!secret\)[\s\S]{0,80}503/.test(hook))
const sweep = code('api/_lib/email/sync-all.ts')
ok('the five-minute sweep carries a send on when the screen is closed -- the cron only',
  /const news = fromCron\s*\?\s*drainMarketing\(/.test(sweep))
const server = code('api/_lib/marketing.ts')
ok('the drain reads the unsubscribes again before each chunk', /from\('marketing_preferences'\)[\s\S]{0,120}\.in\('email'/.test(server))
ok('a campaign is claimed from draft, so a double press queues nothing twice', /\.eq\('id', campaignId\)\.eq\('status', 'draft'\)/.test(server))
/* NOTHING HERE IS A DEBTOR. Fees are charged on accounts only, and a newsletter is not about one. */
for (const f of ['src/lib/marketing.ts', 'api/_lib/marketing.ts', 'api/_lib/email/marketing.ts', 'src/pages/news/NewsPage.tsx']) {
  check(`${f} touches no debtor account and raises no fee`, (code(f).match(/debtor_accounts|account_emails|account_fees|chargeItem|annexureB|raise_client_charge/g) ?? []), [])
}

const sql = read('supabase/schema.sql')
const tail = sql.slice(sql.lastIndexOf('-- S10 / NEWS & CAMPAIGNS: A CLIENT NEWSLETTER'))
ok('the migration is in schema.sql', tail.length > 1000)
for (const tbl of ['marketing_campaigns', 'marketing_sends', 'marketing_preferences', 'marketing_preference_history']) {
  ok(`${tbl} has row-level security`, tail.includes(`alter table public.${tbl} enable row level security;`))
}
ok('the campaigns and sends ask for marketing.send', (tail.match(/has_capability\('marketing\.send'\)/g) ?? []).length >= 5)
ok('staff may only write a preference as staff, never forge the link', /marketing_preferences_insert[\s\S]{0,140}with check \(how = 'recorded by staff'\)/.test(tail))
ok('a re-subscription recorded by staff says why', /marketing_preferences_resubscribe_says_why[\s\S]{0,160}length\(btrim\(coalesce\(reason/.test(tail))
ok('the history has no write policy (only the trigger writes it)', !/on public\.marketing_preference_history for (insert|update)/.test(tail))
ok('two drains never claim one row', /for update of x skip locked/.test(tail))
ok('the claim and the record are the server\'s alone',
  tail.includes('revoke all on function public.marketing_claim_sends(integer, uuid) from public, anon, authenticated;')
  && tail.includes('revoke all on function public.marketing_record_results(jsonb) from public, anon, authenticated;'))
ok('one address per campaign', /unique \(campaign_id, email\)/.test(tail))
ok('one first approach per lead, ever, held by the database',
  /create unique index if not exists marketing_sends_one_first_approach on public\.marketing_sends \(lead_id\)\s+where first_approach/.test(sql))
ok('a lead\'s consent defaults to none', /add column if not exists marketing_consent_at timestamptz,/.test(tail))
ok('the status keeps its own date, never the browser\'s', /else\s+new\.status_changed_at := old\.status_changed_at;/.test(sql))
const clear = sql.slice(sql.lastIndexOf('create or replace function public.clear_staging('))
ok('Clear staging empties the campaigns and sends', /public\.marketing_sends, public\.marketing_campaigns/.test(clear.slice(0, 4000)))
ok('...and keeps the unsubscribes', !/marketing_preferences/.test(clear.slice(0, clear.indexOf('end $$;'))))

/* The screen. */
const app = code('src/App.tsx')
ok('the unsubscribe page is outside the sign-in', app.indexOf('path="/unsubscribe/:token"') > 0 && app.indexOf('path="/unsubscribe/:token"') < app.indexOf('<RequireAuth>'))
const side = code('src/components/layout/Sidebar.tsx')
ok('the menu item shows only to those who may send', /n\.to !== '\/news' \|\| canSendMarketing\(currentUser\)/.test(side))
ok('...and sits under Clients', side.indexOf("to: '/news'") > side.indexOf("to: '/companies'") && side.indexOf("to: '/news'") < side.indexOf("to: '/accounts'"))
const page = code('src/pages/news/NewsPage.tsx')
ok('the screen says what the firm must set up when the sender is not', /SENDER_SETUP_STEPS\.map/.test(page))
ok('...the steps name the two variables and the DNS step',
  M.SENDER_SETUP_STEPS.some((s) => s.includes('RESEND_API_KEY') && s.includes('MARKETING_FROM')) && M.SENDER_SETUP_STEPS.some((s) => /DNS/.test(s)))
ok('nothing is sent before the list has been counted', /const canSend = !locked && !!config\?\.ready && !!preview && preview\.count > 0/.test(page))

console.log(`\ncheck-marketing: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
