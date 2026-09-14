/**
 * Renders the new diary components against the real compiled stylesheet, with stubbed data, so
 * their layout can be measured at phone and desktop widths without a database.
 *
 * This exists because two layout bugs this session — a menu 67px off the left of a phone screen,
 * a details grid running off its card — were found by measuring and would not have been found by
 * looking. The date picker is a 7-column grid and the diary row wraps: both are exactly the
 * shape that breaks narrow.
 */
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { DiaryDatePicker } from '../src/components/diary/DiaryDatePicker'
import { DiaryList } from '../src/pages/diary/DiaryPage'
import { DiaryWorkBar } from '../src/components/diary/DiaryWorkBar'

const workAccount = {
  id: 'a1', mainComment: null, mainCommentAt: null, prescriptionDate: '2027-01-01',
  debtorFirstName: 'Nomvula', debtorSurname: 'van der Westhuizen-Bekker', accountNumber: 'BF-10023',
}

// A row of each shape that could wrap badly: the longest label, a prescribing account, a very
// late one, and one with no note at all.
const rows = [
  { kind: 'promise_broken', dueOn: '2026-09-14', reason: 'Agreed R2 500 on the 10th of the month and nothing came off the account at all.', prescribing: '2026-10-01', out: 184320.55, name: 'Nomvula' },
  { kind: 'payment_default', dueOn: '2023-12-10', reason: 'Debit order returned unpaid.', prescribing: null, out: 9400, name: 'Christoffel' },
  { kind: 'dispute_chase', dueOn: '2026-08-14', reason: '', prescribing: null, out: 1250.5, name: 'Sipho' },
].map((r, i) => ({
  id: String(i), accountId: 'a' + i, ownerId: 'x', dueOn: r.dueOn, kind: r.kind as never, priority: 10,
  reason: r.reason || null, state: 'open' as const, source: 'manual' as const,
  promiseId: null, queryId: null, doneAt: null, doneBy: null, outcome: null,
  movedTo: null, movedAt: null, movedBy: null, movedReason: null,
  createdAt: '', createdByName: null,
  account: {
    id: 'a' + i, companyId: i === 2 ? null : 'c' + (i % 2 + 1), accountNumber: 'BF-1002' + i, debtorFirstName: r.name,
    debtorSurname: 'van der Westhuizen-Bekker', capitalOutstanding: r.out,
    status: 'Active', prescriptionDate: r.prescribing, mainComment: null, mainCommentAt: null,
  },
}))

// The picker asks the database how full each day is; diary-stub.ts stands in for that module
// (see the esbuild alias). The layout question is about the grid, not where the numbers came from.

function Row({ label, children, width }: { label: string; children: React.ReactNode; width: number }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ font: '11px system-ui', color: '#64748b', marginBottom: 6 }}>{label} — {width}px</p>
      <div data-probe={label} style={{ width, border: '1px dashed #cbd5e1' }}>
        <div className="bg-white rounded-2xl p-5">{children}</div>
      </div>
    </div>
  )
}

function App() {
  return (
    <MemoryRouter initialEntries={['/accounts/a1?diary=e2']}>
      <div style={{ padding: 16, background: '#f8fafc' }}>
        {[390, 768, 1280].map((w) => (
          <Row key={w} label="picker" width={w}>
            <DiaryDatePicker ownerId="x" capacity={30} value="2026-09-18" onChange={() => {}} today="2026-09-14" />
          </Row>
        ))}
        {[390, 640, 1024, 1400].map((w) => (
          <Row key={'b' + w} label="workbar" width={w}>
            <DiaryWorkBar account={workAccount} />
          </Row>
        ))}
        {[390, 640, 1024, 1400].map((w) => (
          <Row key={'r' + w} label="rows" width={w}>
            <DiaryList rows={rows} today="2026-09-14" empty="" onComplete={() => {}} onMove={() => {}} />
          </Row>
        ))}
      </div>
    </MemoryRouter>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
