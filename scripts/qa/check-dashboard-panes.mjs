/**
 * EVERY DASHBOARD IN THE THREE PANE ARRANGEMENTS, EACH WITH A MEMORY OF ITS OWN (S9-S10).
 *
 * The firm asked for the record pages' one column / three columns / wide-and-narrow on the
 * Communications dashboard (19 Oct), then on the others. DashboardPanes draws them and
 * useRecordLayout remembers the choice under a key -- and the key is the part that goes wrong
 * quietly: two dashboards on one key means choosing a layout on one rearranges the other.
 *
 * Administration (AdminOverview) was the last one. It shows the Sales or the Communications
 * dashboard WHOLE, so it borrowed their panes and their keys; it now passes its own key into
 * both, and the departments' own routes keep theirs.
 *
 * Run: node scripts/qa/check-dashboard-panes.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name) }
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const read = (f) => strip(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'))

/* ---------- each dashboard: panes, and the key it remembers them under ---------- */
const sales = read('src/pages/Dashboard.tsx')
const comms = read('src/pages/CommunicationsDashboard.tsx')
const company = read('src/pages/CompanyDashboard.tsx')
const floor = read('src/pages/CollectorDashboard.tsx')
const admin = read('src/pages/AdminOverview.tsx')
const app = read('src/App.tsx')

const keyOf = (src) => {
  const m = src.match(/<DashboardPanes\s+layoutKey=(?:"([^"]+)"|\{(\w+)\})/)
  if (!m) return null
  if (m[1]) return m[1]
  /* A key passed in as a prop: read its default off the component's signature. */
  const d = src.match(new RegExp(`\\{\\s*${m[2]}\\s*=\\s*'([^']+)'`))
  return d ? d[1] : null
}
const keys = {
  sales: keyOf(sales),
  communications: keyOf(comms),
  company: keyOf(company),
  collections: keyOf(floor),
}
ok(`the sales page arranges its panes, remembered as its own (${keys.sales})`, keys.sales === 'raptor.dashboard.sales.layout')
ok(`the Communications page, likewise (${keys.communications})`, keys.communications === 'raptor.dashboard.communications.layout')
ok(`the company dashboard, likewise (${keys.company})`, keys.company === 'raptor.dashboard.company.layout')
ok(`the collections floor, likewise (${keys.collections})`, keys.collections === 'raptor.dashboard.collections.layout')

/* ---------- Administration: its own key, into both views ---------- */
const adminKey = admin.match(/const ADMIN_LAYOUT_KEY = '([^']+)'/)?.[1] ?? null
ok(`Administration has a key of its own (${adminKey})`, adminKey === 'raptor.dashboard.admin.layout')
ok('...passed to the Sales view it shows', /<Dashboard layoutKey=\{ADMIN_LAYOUT_KEY\} \/>/.test(admin))
ok('...and to the Communications view', /<CommunicationsDashboard layoutKey=\{ADMIN_LAYOUT_KEY\} \/>/.test(admin))
ok('...and no bare department dashboard is drawn there, which would share the department\'s memory',
  !/<Dashboard\s*\/>|<CommunicationsDashboard\s*\/>/.test(admin))
ok('the sales page draws its panes on the key it was given', /<DashboardPanes layoutKey=\{layoutKey\}/.test(sales))
ok('...and so does Communications', /<DashboardPanes layoutKey=\{layoutKey\}/.test(comms))
ok('the departments\' own routes pass no key, so they keep their own',
  /path="\/dashboard\/sales" element=\{<Dashboard \/>\}/.test(app) && /path="\/dashboard\/communications" element=\{<CommunicationsDashboard \/>\}/.test(app))
ok('Administration is still the route the office opens', /path="\/dashboard\/admin" element=\{<AdminOverview \/>\}/.test(app))

/* ---------- no two dashboards on one key ---------- */
const all = [...Object.values(keys), adminKey]
ok(`five dashboards, five keys (${all.join(', ')})`, all.every(Boolean) && new Set(all).size === 5)

/* ---------- figure rows stay across the page in every arrangement ---------- */
const panes = read('src/components/dashboard/DashboardPanes.tsx')
ok('a full pane is drawn outside every arrangement, across the page',
  /\(p\.kind \?\? 'narrow'\) === 'full'\) stretches\.push\(p\)/.test(panes) && /: <div key=\{s\.id\} data-pane=\{s\.id\}>\{s\.node\}<\/div>/.test(panes))

/* ---------- the side panel is everybody's default (Stephan, 28 Oct, Raptor · Handover 14) ---------- */
/* "Always keep views in this viewing pane ... They can change it if they want, but this is by
   default." One fallback decides it for every record page and dashboard; a saved choice still wins. */
const shell = read('src/components/record/RecordShell.tsx')
ok('useRecordLayout falls back to the side panel (wide)',
  /export function useRecordLayout\(key: string, fallback: RecordLayoutId = 'wide'\)/.test(shell))
ok('...and a saved choice is still read before the fallback',
  /const saved = localStorage\.getItem\(key\)[\s\S]{0,120}return saved as RecordLayoutId[\s\S]{0,120}return fallback/.test(shell))
const pagesWithLayout = ['src/pages/accounts/AccountDetail.tsx', 'src/pages/companies/CompanyDetail.tsx',
  'src/pages/contacts/ContactDetail.tsx', 'src/pages/leads/LeadDetail.tsx', 'src/pages/deals/DealDetail.tsx']
for (const f of pagesWithLayout) {
  const src = read(f)
  ok(`${f.split('/').pop()} uses the shared layout memory`, /useRecordLayout\(/.test(src))
  ok(`...and does not pass a default of its own other than the side panel`,
    !/useRecordLayout\([^)]*,\s*'(columns|stacked)'\)/.test(src))
}
ok('no dashboard opens in anything but the side panel unless chosen',
  ![sales, comms, company, floor, admin].some((src) => /<DashboardPanes[^>]*initial="(columns|stacked)"/.test(src)))

if (failures.length) { console.error(`check-dashboard-panes: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`); process.exit(1) }
console.log(`check-dashboard-panes: ${pass} passed, 0 failed`)
