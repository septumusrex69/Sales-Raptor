/**
 * S13 · CAMPAIGNS, 29 OCT: THE OUTLOOK-STYLE EMAIL, ITS SIGNATURE, THE SHEET AND THE BATCHES.
 *
 * Ryno asked for an editor "exactly like Outlook", signatures imported from Outlook, any sending address,
 * "how many emails at a time, the frequency", and a sheet with "Sent 1 ... Sent 4". Held here:
 *
 *   - whatever the editor or a paste from Word makes, what is SENT is the closed set (campaignHtml.ts): no script,
 *     no event handler, no javascript: link, no picture from somebody's own computer, no style that loads a file
 *     -- and every word of the text survives;
 *   - an emptied editor is an empty body, so the queue still refuses it;
 *   - a client's name merged into HTML is escaped ("Smit & Seun" is not markup); {{signature}} is the sending
 *     address's own, through the same closed set; the plain-text twin carries the words and the links;
 *   - the sheet is read off the sends, one row per address, a column per email, the strongest thing that happened;
 *   - a batched campaign sends no more than its batch, writes when the next goes, and sends nothing before then.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-campaign-compose.mjs
 */
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'

process.env.EMAIL_CREDENTIALS_KEY = crypto.randomBytes(32).toString('base64')
process.env.RESEND_API_KEY = 're_news_key'
process.env.MARKETING_FROM = 'Bredell Ferreira News <news@bfnews.co.za>'
delete process.env.VERCEL_ENV; delete process.env.VERCEL_URL; delete process.env.VERCEL_BRANCH_URL

const H = await import('../../src/lib/campaignHtml.ts')
const M = await import('../../src/lib/marketing.ts')
const S = await import('../../api/_lib/marketing.ts')

let pass = 0
const failures = []
const check = (name, got, want) => {
  const g = JSON.stringify(got); const w = JSON.stringify(want)
  if (g === w) pass += 1
  else failures.push(`${name}\n      expected ${w}\n      got      ${g}`)
}
const ok = (name, v) => check(name, !!v, true)

/* ------------------------------------- the closed set ------------------------------------- */
{
  const clean = H.sanitiseCampaignHtml
  ok('a script goes, words and all', !/script|alert/.test(clean('<p>Hello<script>alert(1)</script> there</p>')) && /Hello there/.test(clean('<p>Hello<script>alert(1)</script> there</p>')))
  ok('an event handler goes', !/onclick|onerror/i.test(clean('<p onclick="x()">Hi</p><img src="https://a.test/x.png" onerror="y()">')))
  check('a javascript: link loses its href and keeps its words', clean('<a href="javascript:alert(1)">Click</a>'), '<a>Click</a>')
  check('...a web link is kept', clean('<a href="https://bf.example/blog">Our blog</a>'), '<a href="https://bf.example/blog">Our blog</a>')
  check('a picture from somebody\'s own computer cannot be emailed: it goes', clean('<img src="file:///C:/Users/x/sig.png"><img src="data:image/png;base64,AAA">'), '')
  check('...a picture on the web stays', clean('<img src="https://cdn.test/logo.png" width="120" alt="Logo">'), '<img src="https://cdn.test/logo.png" width="120" alt="Logo">')
  ok('a style that loads a file goes; colour and size stay',
    clean('<span style="color:#b91c1c;background:url(https://evil.test/t.gif);font-size:14pt">x</span>') === '<span style="color:#b91c1c;font-size:14pt">x</span>')
  /* The url() guard alone, on a property no other rule narrows. */
  check('...on any property', clean('<span style="font-family:url(https://evil.test/f.woff);color:red">x</span>'), '<span style="color:red">x</span>')
  check('Word\'s markup goes and its words stay', clean('<p class=MsoNormal><o:p></o:p><span style="mso-bidi-font-weight:bold">Dear client</span></p>'), '<p><span>Dear client</span></p>')
  check('a <style> block is not words', clean('<style>p{color:red}</style><p>Text</p>'), '<p>Text</p>')
  check('an Outlook signature\'s table is kept', clean('<table cellpadding="0" onmouseover="x"><tr><td valign="top" style="padding:4px">Nicole</td></tr></table>'),
    '<table cellpadding="0"><tr><td valign="top" style="padding:4px">Nicole</td></tr></table>')
  check('what is left open is closed, so the output always nests', clean('<p><b>bold<i>both'), '<p><b>bold<i>both</i></b></p>')
  check('a stray closing tag is dropped', clean('text</div></p>more'), 'textmore')
  check('a raw ampersand is escaped, an entity left alone', clean('Smit & Seun &amp; Co'), 'Smit &amp; Seun &amp; Co')
  ok('an attribute cannot break out of its quotes', !/"[^"]*"[^ >]/.test(clean('<a href="https://x.test/?a=&quot;onmouseover=&quot;">x</a>')))

  ok('an emptied editor is an empty body', H.campaignBodyEmpty(`${H.EMAIL_HTML_MARKER}<p><br></p>`) && H.campaignBodyEmpty(`${H.EMAIL_HTML_MARKER}`))
  ok('...a picture alone is not', !H.campaignBodyEmpty(`${H.EMAIL_HTML_MARKER}<p><img src="https://x.test/a.png"></p>`))
  ok('...and an old plain body is judged by its words', H.campaignBodyEmpty('   ') && !H.campaignBodyEmpty('Hi'))
  check('an old text body becomes paragraphs once, bold kept', H.textToEmailHtml('Dear **you**,\n\nLine one\nline two'), '<p>Dear <b>you</b>,</p><p>Line one<br>line two</p>')
}

/* ------------------------------------- the rendered email ------------------------------------- */
{
  const body = `${H.EMAIL_HTML_MARKER}<p>Dear {{first_name}} at {{company}},</p><p>See <a href="https://bf.example/blog">the blog</a>.</p><script>x()</script>{{signature}}`
  const opts = { unsubscribeUrl: 'https://raptor.test/unsubscribe/t', firmName: 'Bredell Ferreira', face: { emailFont: 'Georgia, serif', emailSizePt: 11 }, basis: 'client',
    signatureHtml: '<p><b>Nicole Loder</b><br>Liaison</p><img src="file:///C:/sig.png">' }
  const r = M.renderCampaignEmail({ subject: 'Hi {{first_name}}', preheader: '', body, imageUrl: null }, { firstName: 'Piet', companyName: 'Smit & Seun' }, opts)
  ok('the HTML body is the email, merged', /Dear Piet at Smit &amp; Seun,/.test(r.html))
  ok('...a name is escaped, never markup', !/Smit & Seun/.test(r.html))
  /* A name with angle brackets: escaped it reads as typed; unescaped the closed set would take it for a tag and drop it. */
  const odd = M.renderCampaignEmail({ subject: 's', preheader: '', body: `${H.EMAIL_HTML_MARKER}<p>Dear {{first_name}}</p>`, imageUrl: null }, { firstName: 'Piet <Jnr>', companyName: null }, opts)
  ok('...even one with angle brackets, which reads as typed', /Dear Piet &lt;Jnr&gt;/.test(odd.html))
  ok('...nothing outside the closed set reaches the inbox', !/<script|x\(\)/.test(r.html))
  ok('...{{signature}} is the sending address\'s signature', /<b>Nicole Loder<\/b><br>Liaison/.test(r.html))
  ok('...its picture from somebody\'s own computer is gone', !/file:/.test(r.html))
  ok('...paragraphs carry their own spacing, which Outlook would not give them', /<p style="margin:0 0 12pt">Dear Piet/.test(r.html))
  ok('...and the unsubscribe link is still in it', /Unsubscribe from our news/.test(r.html))
  ok('the plain-text twin has the words, the link written out and the signature', /Dear Piet at Smit & Seun,/.test(r.text) && /the blog \(https:\/\/bf\.example\/blog\)/.test(r.text) && /Nicole Loder/.test(r.text))
  const t = M.renderCampaignEmail({ subject: 's', preheader: '', body: 'Hi {{first_name}}\n\n{{signature}}', imageUrl: null }, { firstName: 'Anna', companyName: null }, opts)
  ok('an old text body still renders as text, with the signature\'s words', /Hi Anna/.test(t.html) && /Nicole Loder/.test(t.text))
  check('{{signature}} is a known field now', M.unknownMergeFields('{{first_name}} {{signature}} {{balance}}'), ['balance'])
}

/* ------------------------------------- the sheet ------------------------------------- */
{
  const s = (campaign_id, email, o = {}) => ({ campaign_id, email, first_name: 'A', company_name: 'Co', state: 'sent', sent_at: '2026-10-01T08:00:00Z',
    delivered_at: '2026-10-01T08:01:00Z', first_opened_at: null, first_clicked_at: null, unsubscribed_at: null, ...o })
  const rows = M.workflowSheet(['c1', 'c2'], [
    s('c1', 'a@x.co', { first_opened_at: '2026-10-02T08:00:00Z' }), s('c1', 'B@x.co'), s('c1', 'c@x.co', { state: 'bounced' }),
    s('c2', 'b@x.co', { first_clicked_at: '2026-10-22T09:00:00Z', first_opened_at: '2026-10-22T08:59:00Z' }),
  ])
  check('one row per address the first email went to, in its order', rows.map((r) => r.email), ['a@x.co', 'b@x.co', 'c@x.co'])
  check('a column per email, the strongest thing that happened',
    rows.map((r) => r.cells.map((c) => c.mark)), [['Opened', ''], ['Delivered', 'Clicked'], ['Didn’t arrive', '']])
  check('an unsubscribe outranks an open', M.sheetMark(s('c1', 'x', { first_opened_at: 't', unsubscribed_at: 'u' })).mark, 'Unsubscribed')
  check('still in the queue reads Waiting', M.sheetMark(s('c1', 'x', { state: 'queued' })).mark, 'Waiting')
}

/* ------------------------------------- batches ------------------------------------- */
function fakeAdmin(db) {
  const log = { claims: [], updates: [], records: [] }
  const builder = (table) => {
    const b = {
      select: () => b, eq: () => b, neq: () => b, not: () => b, order: () => b, limit: () => b, range: () => b, in: () => b, is: () => b, ilike: () => b, like: () => b,
      insert: () => Promise.resolve({ error: null }),
      update: (patch) => { if (table === 'marketing_campaigns') { log.updates.push(patch); Object.assign(db.campaign, patch) } return b },
      maybeSingle: () => Promise.resolve({ data: table === 'marketing_campaigns' ? db.campaign : table === 'firm_settings' ? { firm_name: 'Bredell Ferreira' } : null }),
      then: (res) => res(table === 'marketing_sends' ? { count: db.queue.length }
        : table === 'marketing_campaigns' ? { data: [db.campaign] }
          : table === 'marketing_templates' ? { data: [], error: null } : { data: [], error: null }),
    }
    return b
  }
  return {
    log, from: builder,
    rpc: async (name, args) => {
      if (name === 'marketing_claim_sends') { log.claims.push(args.p_limit); return { data: db.queue.splice(0, args.p_limit), error: null } }
      if (name === 'marketing_record_results') { log.records.push(...args.p_results); return { data: 1, error: null } }
      return { data: null, error: null }
    },
  }
}
const row = (i) => ({ id: `s${i}`, campaign_id: 'c', email: `p${i}@x.co`, first_name: 'A', company_name: 'Co', company_id: 'c1', contact_id: null, lead_id: null, first_approach: false, attempts: 1, sender: null })
const campaign = (o) => ({ id: 'c', name: 'n', subject: 'S', preheader: '', body: 'Hi', image_url: null, audience: { kind: 'all_clients' }, first_approach: false, kind: 'news', status: 'sending', created_by: 'u', queued_by: 'u', send_from: 'news', ...o })
const resend = async (url, init) => {
  const list = JSON.parse(init.body); const n = Array.isArray(list) ? list.length : 1
  return { ok: true, status: 200, json: async () => (Array.isArray(list) ? { data: list.map((_, i) => ({ id: `r${i}` })) } : { id: 'r0' }) }
}
{
  const db = { campaign: campaign({ batch_size: 30, batch_every_minutes: 60, next_batch_at: null }), queue: Array.from({ length: 80 }, (_, i) => row(i)) }
  const admin = fakeAdmin(db)
  const before = Date.now()
  const report = await S.drainMarketing(admin, { budgetMs: 8000, host: 'raptor.test', fetchImpl: resend })
  check('a batched campaign sends no more than its batch', report.sent, 30)
  check('...claimed no more than its batch', admin.log.claims, [30])
  const next = admin.log.updates.find((u) => u.next_batch_at)?.next_batch_at
  ok('...and writes when the next batch goes, the gap after now', !!next && new Date(next).getTime() >= before + 59 * 60_000 && new Date(next).getTime() <= Date.now() + 61 * 60_000)
  check('...which the report says', report.nextBatchAt, next)
  const again = await S.drainMarketing(admin, { budgetMs: 4000, host: 'raptor.test', fetchImpl: resend })
  check('before then, nothing more goes, and nothing is claimed', [again.sent, admin.log.claims.length], [0, 1])
  db.campaign.next_batch_at = new Date(Date.now() - 1000).toISOString()
  const third = await S.drainMarketing(admin, { budgetMs: 8000, host: 'raptor.test', fetchImpl: resend })
  check('once it is due, the next batch goes', third.sent, 30)
}
{
  const db = { campaign: campaign({ batch_size: null }), queue: Array.from({ length: 120 }, (_, i) => row(i)) }
  const admin = fakeAdmin(db)
  const report = await S.drainMarketing(admin, { budgetMs: 8000, host: 'raptor.test', fetchImpl: resend })
  check('without batches, everything goes at once, as before', [report.sent, report.nextBatchAt ?? null], [120, null])
}

/* ------------------------------------- the source holds ------------------------------------- */
{
  const src = readFileSync(new URL('../../api/_lib/marketing.ts', import.meta.url), 'utf8')
  ok('the queue refuses an emptied editor, not only an empty string', /campaignBodyEmpty\(campaign\.body\)\) return \{ error: 'Give it a subject and a body first\.'/.test(src))
  ok('the drain fills {{signature}} with the sending address\'s signature', /signatures\.set\(from, await signatureFor\(admin, from\)\)/.test(src) && /signatureHtml,/.test(src))
  const editor = readFileSync(new URL('../../src/pages/news/RichEditor.tsx', import.meta.url), 'utf8')
  ok('the editor sends every change and every paste through the closed set', /const html = sanitiseCampaignHtml\(el\.innerHTML\)/.test(editor) && /insertHtml\(html\)/.test(editor)
    && /const insertHtml = \(html: string\) => run\('insertHTML', sanitiseCampaignHtml\(html\)\)/.test(editor))
}

console.log(`\ncheck-campaign-compose: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
