/**
 * THE SALES LISTS AND THE NOTIFICATION SWITCHES, AS RULES (Raptor H19).
 *
 * S19 marked five Settings tabs "not saved": they held what was typed in React state and the app read lists fixed in
 * code. H19 connected four and took Custom Fields out (Stephan, 9 Nov). This holds:
 *   - the lists in order, Won and Rejected last, and the shipped lists whenever nothing is saved;
 *   - a value the firm removed never comes back through an import (it becomes 'Other');
 *   - a stage the firm added is never mistaken for a retired one on the way in;
 *   - no screen reads the old constants any more (they are the fallback, in salesListValues.ts only);
 *   - the Settings page carries no "not saved" mark, no banner, no Custom Fields;
 *   - schema.sql: the table is read-only to the browser, the editors are the Administrators and the Sales Manager
 *     (and the screen agrees), the built-in values match, the mute trigger is there;
 *   - every kind of notification Raptor writes has a switch on the tab (a new kind fails here until it is named).
 * The database's half is proved live: scripts/qa/live/h19-settings-lists.sql.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-sales-lists.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  BUILT_IN, listValues, onListOr, openStages, setSalesListsCache, stageProbability,
} from '../../src/lib/salesListValues.ts'
import { rejectionFor, sourceFor } from '../../src/lib/leadsImport.ts'
import { normalizeDeal } from '../../src/lib/legacyValues.ts'
import { NOTIFICATION_KINDS, notificationKind } from '../../src/lib/notificationKinds.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`)
}
const root = new URL('../../', import.meta.url).pathname
const read = (f) => readFileSync(path.join(root, f), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const item = (list, value, position, builtIn = false, probability = null) => ({ list, value, position, builtIn, probability })

/* ---- the lists ---- */
check('nothing saved: the shipped stages', listValues(null, 'deal_stage'), ['New Deal', 'Quotation Sent', 'Mandate Sent', 'Won', 'Rejected'])
check('...the shipped reasons', listValues([], 'rejection_reason'),
  ['Not interested anymore', 'Too expensive', 'Went with another provider', 'No response', 'We declined them', 'Other'])
check('...and the shipped sources, Imported list and Other included', listValues(null, 'lead_source').slice(-2), ['Imported list', 'Other'])
const saved = [
  item('deal_stage', 'Rejected', 1001, true), item('deal_stage', 'Won', 1000, true), item('deal_stage', 'Site visit', 1, false, 35),
  item('deal_stage', 'New Deal', 0, true), item('deal_stage', 'Mandate Sent', 3, true), item('deal_stage', 'Quotation Sent', 2, true),
  item('lead_source', 'Website', 0, true), item('lead_source', 'Trade fair', 1),
]
check('saved stages in their order, Won and Rejected last', listValues(saved, 'deal_stage'),
  ['New Deal', 'Site visit', 'Quotation Sent', 'Mandate Sent', 'Won', 'Rejected'])
check('...Won and Rejected even if the saved list lacks them', listValues([item('deal_stage', 'New Deal', 0)], 'deal_stage'), ['New Deal', 'Won', 'Rejected'])
check('...one list never borrows another\'s values', listValues(saved, 'lead_source'), ['Website', 'Trade fair'])
check('open stages leave out the two a deal ends in', openStages(listValues(saved, 'deal_stage')), ['New Deal', 'Site visit', 'Quotation Sent', 'Mandate Sent'])
check('a built-in stage keeps its chance of closing', stageProbability('Quotation Sent', saved), 60)
check('...an added stage has its own', stageProbability('Site visit', saved), 35)
check('...and one nobody knows gets 40, never undefined', stageProbability('Mystery', saved), 40)
check('a value on the list stays', onListOr('Trade fair', ['Trade fair', 'Other']), 'Trade fair')
check('...a removed one becomes Other', onListOr('LinkedIn', ['Trade fair', 'Other']), 'Other')

/* ---- the import never brings a removed value back ---- */
setSalesListsCache(null)
check('import, nothing loaded: LinkedIn is LinkedIn (as before H19)', sourceFor('LinkedIn post'), 'LinkedIn')
setSalesListsCache([item('lead_source', 'Website', 0, true), item('lead_source', 'Other', 1, true), item('rejection_reason', 'Other', 0, true)])
check('import, LinkedIn removed by the firm: Other', sourceFor('LinkedIn post'), 'Other')
check('...a source still on the list is kept', sourceFor('our website'), 'Website')
check('...a removed reason becomes Other', rejectionFor('too expensive for them'), 'Other')
check('...and no reason is still no reason', rejectionFor(''), null)
setSalesListsCache(null)

/* ---- a stage the firm added is not a retired one ---- */
const deal = (stage) => ({ id: 'd1', stage })
check('a firm stage spelled like a retired one is kept', normalizeDeal(deal('Negotiation'), ['New Deal', 'Negotiation', 'Won', 'Rejected']).stage, 'Negotiation')
check('...a retired one the firm does not use is still mapped', normalizeDeal(deal('Negotiation'), ['New Deal', 'Won', 'Rejected']).stage, 'Quotation Sent')
check('...and an unknown stage is kept, never quietly made New Deal', normalizeDeal(deal('Site visit')).stage, 'Site visit')

/* ---- no screen reads the old constants ---- */
const files = []
const walk = (d) => { for (const f of readdirSync(path.join(root, d))) { const p = path.join(d, f); if (statSync(path.join(root, p)).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p) } }
walk('src')
const FALLBACK_HOMES = ['src/lib/salesListValues.ts', 'src/data/mockData.ts', 'src/types.ts', 'src/lib/rejection.ts', 'src/lib/legacyValues.ts']
const readers = files.filter((f) => !FALLBACK_HOMES.includes(f)).filter((f) => {
  const s = strip(read(f))
  return /\bREJECTION_REASONS\b|\bOPEN_DEAL_STAGES\b|\bDEAL_STAGES\b|import\s*\{[^}]*\bleadSources\b[^}]*\}\s*from\s*'[^']*mockData'/.test(s)
})
check('no screen reads REJECTION_REASONS, DEAL_STAGES or mockData\'s leadSources (they are the fallback only)', readers, [])
const SCREENS = ['src/components/layout/QuickAdd.tsx', 'src/components/leads/RejectLeadModal.tsx', 'src/components/leads/ConvertLeadModal.tsx',
  'src/components/dashboard/LossReasonsCard.tsx', 'src/pages/deals/DealStageModals.tsx', 'src/pages/deals/DealsBoard.tsx',
  'src/pages/leads/LeadDetail.tsx', 'src/pages/leads/LeadsList.tsx', 'src/pages/news/NewsPage.tsx', 'src/pages/reports/ReportsPage.tsx']
check('...every screen that offers one reads the saved lists', SCREENS.filter((f) => !/useSalesLists\(\)/.test(read(f))), [])
const store = strip(read('src/store/AppStore.tsx'))
check('the store loads the lists before it sorts out stages, and moves deals with the firm\'s chances',
  [/loadSalesLists\(\)/.test(store), /normalizeDeal\(x, firmStages\)/.test(store), !/DEAL_STAGE_PROBABILITY\[(stage|next)\]/.test(store)], [true, true, true])

/* ---- the Settings page ---- */
const settings = strip(read('src/pages/settings/SettingsPage.tsx'))
check('Settings: no "not saved" mark, no banner, no Custom Fields, no demo lists',
  [/unsaved/.test(settings), /settings-not-saved/.test(settings), /Custom Fields|CustomFieldsTab/.test(settings), /NOTIFICATION_TYPES|StringListTab|PipelinesTab/.test(settings)],
  [false, false, false, false])
check('...the three lists and the switches are the saved ones', ['list="deal_stage"', 'list="lead_source"', 'list="rejection_reason"', '<NotificationSwitches />'].filter((x) => !settings.includes(x)), [])

/* ---- schema.sql ---- */
const schema = read('supabase/schema.sql')
const h19 = schema.slice(schema.indexOf('-- Raptor H19 (migrations h19_settings_lists_and_notification_switches'))
check('schema.sql carries the H19 block', h19.length > 1000, true)
check('the browser may only READ sales_list_items (the functions write it)',
  [/revoke all on public\.sales_list_items from anon, authenticated;/.test(h19), /grant select on public\.sales_list_items to authenticated;/.test(h19),
    /grant (insert|update)[^;]*sales_list_items/.test(h19)], [true, true, false])
const editors = /function public\.sales_list_editor\(\)[\s\S]*?current_user_role\(\) in \(([^)]*)\)/.exec(h19)?.[1]
check('the editors are the Administrators and the Sales Manager (Stephan, 9 Nov)', editors, "'Administrator', 'Sales Manager'")
const mayEdit = /export function mayEditSalesLists\(role: string \| undefined\): boolean \{\s*return ([^\n]*)\n/.exec(strip(read('src/lib/salesLists.ts')))?.[1]
check('...and the screen asks the same', mayEdit, "role === 'Administrator' || role === 'Sales Manager'")
const seed = /insert into public\.sales_list_items \(list, value, position, built_in\) values([\s\S]*?)on conflict/.exec(h19)?.[1] ?? ''
const seededBuiltIn = (list) => [...seed.matchAll(/\('(\w+)', '([^']+)', \d+, (true|false)\)/g)].filter((m) => m[1] === list && m[3] === 'true').map((m) => m[2]).sort()
check('built-in stages: the screen and the database agree', [...BUILT_IN.deal_stage].sort(), seededBuiltIn('deal_stage'))
check('built-in sources: the screen and the database agree', [...BUILT_IN.lead_source].sort(), seededBuiltIn('lead_source'))
check('built-in reasons: the screen and the database agree', [...BUILT_IN.rejection_reason].sort(), seededBuiltIn('rejection_reason'))
check('moving rows is not callable from the browser', /revoke execute on function public\.sales_list_move_rows\(text, text, text\) from public, anon, authenticated;/.test(h19), true)
check('a removal refuses to move deals into Won or Rejected', /p_move_to in \('Won', 'Rejected'\)/.test(h19), true)
check('the functions stamp on the staging clock', /= now\(\)/.test(h19.slice(h19.indexOf('create or replace function public.sales_list_editor'), h19.indexOf('create table if not exists public.notification_preferences'))), false)
check('notifications: the mute trigger is there, before insert', /create trigger notifications_respect_mute before insert on public\.notifications/.test(h19), true)
check('...and a person writes only their own switches', [...h19.matchAll(/notification_preferences for (select|insert|update) to authenticated\s+(using|with check) \(user_id = \(select auth\.uid\(\)\)\)/g)].length, 3)
check('notification_kind is the part before the dot, in both places',
  [/split_part\(coalesce\(p_type, ''\), '\.', 1\)/.test(h19), notificationKind('change_request.reply'), notificationKind('mandate_signed'), notificationKind(null)],
  [true, 'change_request', 'mandate_signed', ''])

/* ---- every kind Raptor writes has a switch ---- */
const written = new Set()
for (const m of schema.matchAll(/insert into public\.notifications \(user_id, type, message, link\)\s*(?:values|select)\s*\(?\s*[\w.]+,\s*'([a-z_.]+)'/g)) written.add(m[1])
const code = files.map(read).join('\n') + readdirSync(path.join(root, 'api/_lib')).filter((f) => f.endsWith('.ts')).map((f) => read(`api/_lib/${f}`)).join('\n')
for (const m of code.matchAll(/p_type: '([a-z_]+\.[a-z_]+)'/g)) written.add(m[1])
for (const m of code.matchAll(/from\('notifications'\)\.insert\([^)]*?type: '([a-z_.]+)'/g)) written.add(m[1])
for (const m of code.matchAll(/ring(?:About)?\(admin, [^\n]*?, '([a-z_]+\.[a-z_]+)'/g)) written.add(m[1])
for (const m of code.matchAll(/const PHOTO_ALARM = '([a-z_]+)'/g)) written.add(m[1])
for (const m of code.matchAll(/type: '(handover\.[a-z_]+|client\.[a-z_]+|workflow\.[a-z_]+)'/g)) written.add(m[1])
const kinds = new Set(NOTIFICATION_KINDS.map((k) => k.kind))
check('found the kinds Raptor writes (at least the dozen-odd known on 9 Nov)', written.size >= 15, true)
check('every kind Raptor writes has a switch on the Notifications tab', [...written].filter((t) => !kinds.has(notificationKind(t))).sort(), [])
check('...and every switch is a kind the database can store', NOTIFICATION_KINDS.filter((k) => !/^[a-z_]{1,40}$/.test(k.kind)).map((k) => k.kind), [])

if (failures.length) {
  console.log(`\ncheck-sales-lists: ${pass} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-sales-lists: ${pass} passed, 0 failed`)
