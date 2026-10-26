/**
 * "REQUEST A CHANGE" FROM INSIDE RAPTOR, AND THE NIGHT'S GROUPED REVIEW (S12).
 *
 * THE FIRM: "You take a screenshot of what you need and then you put it in Raptor ... and a
 * description of what changes you want. And then it would flag on my side." "Anyone can see
 * requests." "Every session can check for new requests every night and then show them to me in
 * the group list."
 *
 * Held here: the rules (src/lib/changeRequests.ts), the tables and their policies -- anybody sends
 * and sees, only an Administrator decides, a decline says why, files are capped and purged -- the
 * notifications, and that the button is on every page and the screen is reachable.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-change-requests.mjs
 */
import { readFileSync } from 'node:fs'
import {
  MAX_FILE_BYTES, PICTURE_MAX_SIDE, REQUEST_DEPARTMENTS, base64Bytes, paneOf, fileProblem, fitWithin, isOpen, mayDecide, mayWithdraw,
  parseReviewGroups, requestLabel, sortRequests,
} from '../../src/lib/changeRequests.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*(\/\/|--).*$/gm, '')

/* ---------- the rules ---------- */
ok('only an Administrator decides', mayDecide({ role: 'Administrator' }) && !mayDecide({ role: 'Liaison Manager' }) && !mayDecide(null))
ok('the sender may withdraw while it is New, and only then', mayWithdraw({ id: 'u' }, { created_by: 'u', status: 'new' })
  && !mayWithdraw({ id: 'u' }, { created_by: 'u', status: 'accepted' }) && !mayWithdraw({ id: 'x' }, { created_by: 'u', status: 'new' }))
check('open is New, Accepted and Being built', ['new', 'accepted', 'building', 'done', 'declined'].map(isOpen), [true, true, true, false, false])
check('a request is called R-<number>', requestLabel({ number: 12 }), 'R-12')
check('a big screenshot is drawn at 1 600 on its long side', fitWithin(3200, 2400), { width: PICTURE_MAX_SIDE, height: 1200 })
check('...a small one is never enlarged', fitWithin(800, 600), { width: 800, height: 600 })
check('...nonsense is nothing, not a division by zero', fitWithin(0, 100), { width: 0, height: 0 })
check('a picture is never refused for size: it is shrunk first', fileProblem({ name: 'a.png', type: 'image/png', size: 40_000_000 }), null)
ok('a PDF over 5 MB is refused, and says its size', /6\.0 MB; a PDF may be 5 MB at most\.$/.test(fileProblem({ name: 'b.pdf', type: 'application/pdf', size: 6 * 1048576 }) ?? ''))
ok('...anything else is refused by name', /^c\.docx is not a picture or a PDF\.$/.test(fileProblem({ name: 'c.docx', type: 'application/msword', size: 10 }) ?? ''))
check('base64 is measured as the bytes it carries', [base64Bytes('AAAA'), base64Bytes('AAA='), base64Bytes('AA==')], [3, 2, 1])
const groups = parseReviewGroups([
  { title: ' Diary colours ', request_numbers: [3, '4', 3, -1, 'x'], what: 'Two people want...', questions: ['Which red?', 5, ' '], size: 'small' },
  { request_numbers: [9] }, 'junk', null, { title: 'Big one', size: 'huge' },
])
check('the night\'s groups are read defensively: no title, no group', groups.map((g) => g.title), ['Diary colours', 'Big one'])
check('...numbers de-duplicated and cleaned', groups[0].request_numbers, [3, 4])
check('...only real questions kept', groups[0].questions, ['Which red?'])
check('...an unknown size is no size', groups[1].size, null)
check('...and anything that is not a list is no groups', parseReviewGroups({ title: 'x' }), [])
check('the list reads high first, then newest', sortRequests([
  { number: 1, priority: 'normal', created_at: '2026-10-26T08:00:00Z' },
  { number: 2, priority: 'high', created_at: '2026-10-20T08:00:00Z' },
  { number: 3, priority: 'normal', created_at: '2026-10-26T09:00:00Z' },
  { number: 4, priority: 'low', created_at: '2026-10-27T09:00:00Z' },
]).map((r) => r.number), [2, 3, 1, 4])
check('the browser\'s cap matches the database\'s', MAX_FILE_BYTES, 5242880)

/* ---------- which pane, which department (the firm, 26 Oct) ---------- */
check('the pane and the department it suggests, read off the address', [
  '/accounts/abc?x=1', '/diary', '/dashboard/collections', '/leads/1', '/companies/9', '/news', '/trust/payover', '/people', '/mail', '/', '/somewhere-new',
].map((p) => { const r = paneOf(p); return `${r.pane}|${r.department}` }), [
  'Accounts|Call centre', 'Diary|Call centre', 'Collections dashboard|Call centre', 'Leads|Sales', 'Clients|Communications',
  'News & campaigns|Communications', 'Trust|Finance', 'People|Administration', 'Mail|Whole system', 'Dashboard|Whole system', 'Other|Whole system',
])
ok('...the most specific pane wins: the collections dashboard is not the Dashboard', paneOf('/dashboard/collections').pane !== 'Dashboard')

/* ---------- the database ---------- */
const schema = read('supabase/schema.sql')
const block = schema.slice(schema.lastIndexOf('-- S12 (26 Oct): CHANGE REQUESTS'))
ok('the three tables exist', ['change_requests', 'change_request_files', 'change_request_reviews']
  .every((t) => new RegExp(`create table if not exists public\\.${t} \\(`).test(block)))
ok('anybody signed in sees every request, file and review',
  /create policy change_requests_select on public\.change_requests for select to authenticated using \(true\)/.test(block)
  && /create policy change_request_files_select on public\.change_request_files for select to authenticated using \(true\)/.test(block)
  && /create policy change_request_reviews_select on public\.change_request_reviews for select to authenticated using \(true\)/.test(block))
ok('a request is sent as yourself, New, undecided',
  /with check \(created_by = auth\.uid\(\) and status = 'new' and decided_by is null and done_in is null\)/.test(block))
ok('only an Administrator may change one', /for update to authenticated\s+using \(public\.current_user_role\(\) = 'Administrator'\) with check \(public\.current_user_role\(\) = 'Administrator'\)/.test(block))
ok('...and no app user may write a review (the night\'s session writes as the owner)', !/policy \w+ on public\.change_request_reviews for (insert|update|all)/.test(block))
ok('a decline says why', /constraint change_requests_decline_says_why check \(status <> 'declined' or length\(btrim\(coalesce\(admin_note, ''\)\)\) > 0\)/.test(block))
ok('a file is a picture or a PDF, at most 5 MB', /mime in \('image\/jpeg', 'image\/png', 'image\/webp', 'application\/pdf'\)/.test(block) && /bytes <= 5242880/.test(block))
ok('...added only to your own request while it is New', /r\.created_by = auth\.uid\(\) and r\.status = 'new'/.test(block))
ok('files are emptied 30 days after the request closed', /r\.status in \('done', 'declined'\) and r\.closed_at < now\(\) - interval '30 days'/.test(block)
  && /set data = null, purged_at = now\(\)/.test(block))
ok('a new request tells every active Administrator', /'change_request\.new'[\s\S]*?where p\.role = 'Administrator' and p\.status = 'Active'/.test(block))
ok('a decision tells the person who asked', /'change_request\.status', 'Your request R-'/.test(block))
ok('a night\'s review tells the Administrators', /'change_request\.review'/.test(block))
ok('...through triggers on the tables', /create or replace trigger change_request_notify_insert after insert on public\.change_requests/.test(block)
  && /create or replace trigger change_request_notify_update before update on public\.change_requests/.test(block)
  && /create or replace trigger change_request_review_notify after insert on public\.change_request_reviews/.test(block))

const deptBlock = schema.slice(schema.lastIndexOf('change_requests_department_known'))
check('the database knows the same departments as the screen',
  (/department in \(([^)]*)\)/.exec(deptBlock)?.[1] ?? '').split(',').map((x) => x.trim().replace(/'/g, '')), [...REQUEST_DEPARTMENTS])
const lastNotify = schema.slice(schema.lastIndexOf('create or replace function public.change_request_notify()'))
ok('the new-request notification says the department and the pane', /coalesce\(', ' \|\| new\.department, ''\) \|\| coalesce\(' · ' \|\| new\.pane, ''\)/.test(lastNotify))

/* ---------- the screens ---------- */
ok('the button is in the top bar, so on every page', /<RequestChangeButton title=\{title\} \/>/.test(code('src/components/layout/Topbar.tsx')))
ok('the page somebody was on goes with the request', /pagePath: page, pageTitle/.test(code('src/components/requests/RequestChangeButton.tsx')))
ok('a picture is shrunk before it leaves', /fitWithin\(img\.naturalWidth, img\.naturalHeight\)/.test(code('src/components/requests/RequestChangeButton.tsx'))
  && /toDataURL\('image\/jpeg', 0\.82\)/.test(code('src/components/requests/RequestChangeButton.tsx')))
ok('/requests is routed and in the menu for everybody', /path="\/requests" element=\{<RequestsPage \/>\}/.test(code('src/App.tsx'))
  && /\{ to: '\/requests', label: 'Requests', icon: Lightbulb \}/.test(code('src/components/layout/Sidebar.tsx'))
  && !/n\.to !== '\/requests'/.test(code('src/components/layout/Sidebar.tsx')))
const page = code('src/pages/requests/RequestsPage.tsx')
ok('the screen offers decisions only to an Administrator', /canDecide=\{mayDecide\(currentUser\)\}/.test(page) && /\{canDecide && \(/.test(page))
ok('...and a decline only with a note', /disabled=\{busy \|\| \(s === 'declined' && !note\.trim\(\)\)\}/.test(page))
ok('the list does not pull every picture: files are fetched when a request is opened',
  /select\('id, request_id, name, mime, bytes, purged_at'\)/.test(code('src/lib/changeRequestsApi.ts')) && /fileDataUrl\(f\)/.test(page))

const modal = code('src/components/requests/RequestChangeButton.tsx')
ok('a request can be dictated: the microphone is on the description', /<DictateButton size="small" value=\{description\} onChange=\{setDescription\} \/>/.test(modal))
ok('...it sends the pane and the chosen department, suggested from the pane',
  /const \{ pane, department: suggested \} = paneOf\(location\.pathname\)/.test(modal) && /useState<RequestDepartment>\(suggested\)/.test(modal)
  && /pageTitle, pane, department, files:/.test(modal))
ok('the list shows them and can be filtered by department', /data-testid="request-where"/.test(read('src/pages/requests/RequestsPage.tsx'))
  && /dept === 'all' \|\| r\.department === dept/.test(page))

if (failures.length) {
  console.log(`check-change-requests: ${pass} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`check-change-requests: ${pass} passed, 0 failed`)
