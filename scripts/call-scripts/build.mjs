/**
 * THE FIRM'S 31 CALL SCRIPTS, OUT OF THEIR OWN DOCUMENT AND INTO message_templates.
 *
 * `source.txt` IS THE RECORD. It is the text of BF-Collector-CALL-SCRIPTS.docx, kept beside this
 * so that what was imported can be read back without a database -- the same reason
 * scripts/letters keeps letters.json. The firm edits the words in the Library from here on; this
 * file is how they got there and how a second environment gets them.
 *
 * WHAT IT DOES NOT DO IS INTERPRET THEM. Each script is stored as the firm wrote it, headings and
 * all, and src/lib/callScriptParts.ts reads the five parts back out at render time. Splitting them
 * into five columns here would mean the Library edited one copy and the panel drew another.
 *
 * Run: node scripts/call-scripts/build.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
const SRC = new URL('./source.txt', import.meta.url)
const text = readFileSync(SRC, 'utf8')
const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''))

// Every line that is exactly a script key starts a block; the block runs to the next one.
const starts = []
lines.forEach((l, i) => { if (/^script-[a-z0-9-]+$/.test(l.trim())) starts.push(i) })
const blocks = starts.map((start, n) => {
  const end = n + 1 < starts.length ? starts[n + 1] : lines.length
  let body = lines.slice(start + 1, end)
  /*
   * A GROUP HEADING ENDS THE BLOCK ABOVE IT -- "B. The collection workflow", and section G, which
   * is not a script at all.
   *
   * CUT AT THE HEADING RATHER THAN TRIMMED FROM THE END, and that is the bug this fixes: the last
   * script in the document is followed by "G. Answers to what they actually say" and then sixteen
   * objections, so trimming only a TRAILING heading line left the whole of section G inside
   * script-close-no-agreement. The objections are not templates -- they are OBJECTIONS in
   * callScripts.ts, shown beside whichever script is open -- and a closing script that carried
   * them would have put sixteen answers under one DO NOT list on a collector's screen.
   */
  const heading = body.findIndex((l) => /^[A-G]\.\s/.test(l.trim()))
  if (heading !== -1) body = body.slice(0, heading)
  while (body.length && body[body.length - 1].trim() === '') body.pop()
  return { key: lines[start].trim(), body: body.join('\n') }
})
const names = {
  'script-open-individual': 'Opening a call — an individual',
  'script-open-company': 'Opening a call — a company',
  'script-verify-failed': 'Verification failed',
  'script-third-party': 'Somebody else answered',
  'script-voicemail': 'Voicemail',
  'script-handover-call': 'Handover call',
  'script-s129-call': 'Section 129 call',
  'script-demand-call-company': 'Letter of demand call — a company',
  'script-reminder-call': 'Reminder call',
  'script-final-notice-call': 'Final notice call',
  'script-listing-prep-call': 'Before we list the default',
  'script-listed-call': 'The default has been listed',
  'script-intended-summons-call': 'Intended summons call',
  'script-ptp-setup': 'Setting up an arrangement',
  'script-settlement-call': 'A settlement offer',
  'script-ptp-due-call': 'An instalment is due today',
  'script-ptp-default-call': 'A broken arrangement',
  'script-dispute-raised': 'A dispute on the call',
  'script-debt-review': 'Under debt review',
  'script-deceased': 'The debtor has died',
  'script-insolvency': 'Insolvent, sequestrated or in business rescue',
  'script-not-my-account': '“This is not my account”',
  'script-next-of-kin-living': 'A relative of a living debtor',
  'script-third-party-paying': 'Somebody else wants to pay',
  'script-mandate-check': 'Somebody claims authority',
  'script-estate-next-of-kin': 'The family of a deceased debtor',
  'script-estate-executor': 'A confirmed executor',
  'script-surety': 'A surety',
  'script-spouse': 'A spouse',
  'script-close-agreed': 'Closing a call where something was agreed',
  'script-close-no-agreement': 'Closing a call where nothing was agreed',
}
const audience = {
  'script-open-individual': 'individual',
  'script-open-company': 'company',
  'script-s129-call': 'individual',
  'script-demand-call-company': 'company',
}
const q = (s) => `'${s.replace(/'/g, "''")}'`
const out = []
out.push(`insert into public.message_templates
  (seed_key, scope, kind, name, subject, body, position, language, active, audience, format)
values`)
const rows = blocks.map((b) => {
  const name = names[b.key]
  if (!name) throw new Error(`no name for ${b.key}`)
  const aud = audience[b.key] ?? null
  return `  (${q(b.key)}, 'collections', 'call_script', ${q(name)}, null,\n   ${q(b.body)},\n   null, 'en', true, ${aud ? q(aud) : 'null'}, 'text')`
})
out.push(rows.join(',\n'))
out.push(`on conflict (seed_key) do nothing;`)
writeFileSync(new URL('./seed.sql', import.meta.url), out.join('\n') + '\n')
console.log(blocks.length, 'scripts', out.join('\n').length, 'bytes')
for (const b of blocks) if (!b.body.includes('WHAT THE COLLECTOR SAYS')) console.log('NO SPOKEN:', b.key)
