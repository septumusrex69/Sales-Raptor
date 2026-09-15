/**
 * A book, invented but shaped like the real one.
 *
 * NO DATABASE AND NO CREDENTIALS. The tests that use these drive the real app in a real browser
 * and answer every request it makes from here, which buys three things: they run on any machine
 * and in any session without a network policy that reaches Supabase; they cannot be broken by
 * somebody editing staging; and the numbers are known, so a check can assert "Broken promises 40"
 * rather than "some number appeared".
 *
 * The shapes must match PostgREST exactly — including the content-range header the account list
 * reads its total from — because a fixture that is subtly the wrong shape tests the fixture.
 */

export const USER_ID = '11111111-1111-4111-8111-111111111111'
export const COMPANY_ID = '22222222-2222-4222-8222-222222222222'
export const TEAM_ID = '33333333-3333-4333-8333-333333333333'

export const PROFILE = {
  id: USER_ID,
  name: 'Test Leader',
  email: 'leader@raptor.test',
  role: 'Pre-legal Team Leader',
  team_id: TEAM_ID,
  status: 'Active',
  phone: null,
  avatar_color: '#355069',
  created_at: '2026-01-01T00:00:00Z',
  email_signature: null,
  email_signature_image_url: null,
  email_signature_image_width: null,
  email_signature_image_align: 'left',
  buzzbox_extension: null,
  diary_capacity: 40,
  diary_order: null,
  collector_grade: 'Senior',
  book_ceiling: 500,
  diary_reserve: 10,
}

/** A real pre-legal clerk with no grade — the case that used to vanish from the hand-out list. */
export const UNGRADED = {
  ...PROFILE,
  id: '55555555-5555-4555-8555-555555555555',
  name: 'Itumeleng Agent',
  email: 'itumeleng@raptor.test',
  role: 'Pre-legal Agent',
  collector_grade: null,
  book_ceiling: null,
  diary_capacity: null,
  diary_reserve: null,
}

export const COLLEAGUE = {
  ...PROFILE,
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Thandi Junior',
  email: 'thandi@raptor.test',
  role: 'Pre-legal Agent',
  collector_grade: 'Junior',
  book_ceiling: 150,
}

/**
 * A full collections floor. Eight people fitted in cards; thirty-five is the case the search box
 * and the scroll cap exist for, so the fixture carries thirty-five.
 */
const BENCH_NAMES = [
  'Annelize Venter', 'Thabo Mokoena', 'Rehana Patel', 'Gerhard Kruger', 'Nomsa Dube',
  'Sipho Khumalo', 'Marlize du Toit', 'Kagiso Molefe', 'Priya Naidoo', 'Johan Steyn',
  'Lerato Mahlangu', 'Bongani Zulu', 'Chantelle Botha', 'Tshepo Radebe', 'Aisha Cassim',
  'Riaan Pretorius', 'Zanele Ngcobo', 'Werner Nel', 'Palesa Sithole', 'Devan Pillay',
  'Elmarie Swanepoel', 'Musa Ndlovu', 'Carla Meyer', 'Katlego Maseko', 'Shireen Abrahams',
  'Pieter Coetzee', 'Nandi Mthembu', 'Ryno Fourie', 'Ayanda Buthelezi', 'Michelle Jacobs',
  'Sabelo Mahlaba', 'Yusuf Ismail', 'Hanlie Grobler', 'Refilwe Tau', 'Dylan Adams',
]
const GRADES = ['Junior', 'Skilled', 'Senior', 'Elite']

export const BENCH = BENCH_NAMES.map((name, i) => ({
  ...PROFILE,
  id: `bench-${String(i).padStart(4, '0')}-4000-8000-000000000000`,
  name,
  email: `${name.toLowerCase().replace(/[^a-z]/g, '.')}@raptor.test`,
  role: i < 5 ? 'Pre-legal Team Leader' : 'Pre-legal Agent',
  // The last six ungraded, mirroring the real floor and the case that once vanished.
  collector_grade: i >= BENCH_NAMES.length - 6 ? null : GRADES[i % 4],
  book_ceiling: i === 5 ? 700 : null,
  diary_capacity: i === 11 ? 35 : null,
  team_id: TEAM_ID,
}))

export const COMPANY = {
  id: COMPANY_ID,
  name: 'Northbank Properties',
  status: 'Won',
  owner_id: USER_ID,
  created_at: '2026-01-01T00:00:00Z',
}

export const TEAM = { id: TEAM_ID, name: 'Pre-legal', kind: 'Sales' }

/** The counts the views row must show. Chosen to be unmistakable in an assertion. */
export const VIEW_COUNTS = {
  whole_book: 736,
  my_desk: 12,
  unallocated: 730,
  adrift: 2,
  broken_promises: 40,
  promises_due: 58,
  gone_quiet: 557,
}

export const BOOK_SUMMARY = {
  accounts: 736,
  capital: 14490249.16,
  clients: 7,
  commission_drift: 60,
}

export const FACETS = [
  { kind: 'sub_status', value: 'Delinquent Payer', accounts: 90 },
  { kind: 'sub_status', value: 'Promise To Pay', accounts: 58 },
  { kind: 'bucket', value: 'Diary', accounts: 649 },
  { kind: 'bucket', value: 'Failed PTPs', accounts: 40 },
]

const SURNAMES = ['Mhlongo', 'Nkosi', 'Van Wyk', 'Botha', 'Dlamini', 'Pretorius', 'Khumalo', 'Naidoo']

/** One page of accounts. `n` rows, deterministic, spread across the three bands. */
export function accountsPage(n, offset = 0) {
  return Array.from({ length: n }, (_, i) => {
    const k = offset + i
    // Every eighth is major, every fourth high value, the rest generic — so a single page shows
    // all three bands and the Position column has something to say.
    const outstanding = k % 8 === 0 ? 180000 : k % 4 === 0 ? 31000 : 4200 + (k % 50) * 90
    return {
      id: `acc-${String(k).padStart(4, '0')}`,
      company_id: COMPANY_ID,
      handover_id: null,
      account_number: `NB${String(10000 + k)}`,
      swordfish_reference: null,
      client_reference: `REF/${k}`,
      debtor_first_name: 'A',
      debtor_surname: SURNAMES[k % SURNAMES.length],
      debtor_id_number: null,
      capital_handed_over: outstanding,
      capital_outstanding: outstanding,
      in_duplum: k % 25 === 0,
      in_duplum_ceiling: outstanding,
      commission_rate: 0.25,
      commission_rate_expected: k % 12 === 0 ? 0.3 : 0.25,
      commission_rate_source: 'mandate',
      commission_drift: k % 12 === 0,
      interest_rate_annual: 0.115,
      prescribed: false,
      prescription_date: null,
      status: k % 9 === 0 ? 'Written-off' : 'Active: Activated',
      sub_status: k % 5 === 0 ? 'Promise To Pay' : k % 7 === 0 ? 'Delinquent Payer' : null,
      frozen_by: null,
      frozen_reason: null,
      frozen_at: null,
      client_action_ask: k % 15 === 0 ? 'Please send the signed agreement.' : null,
      client_action_due: null,
      bucket: k % 11 === 0 ? 'Failed PTPs' : 'Diary',
      write_off_reason: null,
      handover_date: '2026-03-01',
      payments_to_date: k % 3 === 0 ? 1500 : null,
      swordfish_balance_at_import: null,
      swordfish_fees_at_import: null,
      swordfish_assigned_to: null,
      assigned_to: k % 6 === 0 ? USER_ID : null,
      diary_date: null,
      last_action_at: k % 4 === 0 ? '2026-08-01T09:00:00Z' : null,
      last_payment_at: null,
      main_comment: null,
      main_comment_at: null,
      preferred_language: null,
      contact_preference: null,
      consent_status: null,
      debtor_title: null,
      debtor_initials: null,
      debtor_second_name: null,
      account_flags: null,
      account_rating: null,
      last_contact_method: null,
      ptp_success_ratio: null,
    }
  })
}
