import type { CommissionBand } from './commission.ts'

/**
 * How Swordfish's client names become clients in Raptor.
 *
 * Held as data, not logic, because these are business judgements made in conversation that will
 * be revisited — a reviewer should be able to check them without reading an importer.
 *
 * Swordfish conflates three different things in one "Client" field: the client, the sub-entity,
 * and the handover batch. Growthpoint appears four times and is one client with four handovers;
 * Adowa appears twice and is one parent with two properties that each keep their own book.
 * Importing the field as-is would produce eleven unrelated clients and no parent-level view of
 * anything.
 *
 * The January 2026 client list is authoritative for the BF reference, owner, banking and contact
 * details, joined on Prefix. What stays here is the grouping judgement that list cannot express,
 * and the commission rules.
 *
 * TWO COMMISSION FIELDS, AND THEY DISAGREE ON PURPOSE.
 *
 *   commissionBands     what the SIGNED MANDATE says. The rule. Where present it is
 *                       authoritative, and the importer computes each account's expected rate
 *                       from the capital handed over.
 *   commissionByPrefix  what Swordfish ACTUALLY BILLED, read off the client list. Kept so the
 *                       importer can flag every account where the two differ instead of
 *                       silently overwriting history.
 *
 * Where they differ the account is imported at the as-billed rate with the mandate rate beside
 * it, never restated — see docs/debt-collection-model.md sections 3a and 3b. 60 of 285
 * Growthpoint accounts differ; ABSTO and Agri Saad agree on every account.
 *
 * BAND SEMANTICS. Bands are half-open on the capital handed over, in rands, and the boundary
 * rand belongs to the LOWER band: the mandate wording "R0 < R25,000" then "R25,001 +" means an
 * account at exactly R25,000.00 is 25%. Each band is { upTo: <inclusive maximum>, rate }, ordered
 * ascending, with the final band's upTo null for "and above". The band is decided once, at
 * handover, from the capital handed over — never recomputed as the balance falls.
 */
export interface SwordfishClientSpec {
  name: string
  /** The exact strings Swordfish uses in its Client column for this entity. */
  swordfish?: string[]
  industry?: string
  /** Present only where we hold the signed mandate. */
  commissionBands?: { source: string; bands: CommissionBand[] }
  /** Keyed by Swordfish's Client Prefix, which is how it fakes a sliding scale. */
  commissionByPrefix?: Record<string, number>
  children?: SwordfishClientSpec[]
  /** Why this entity is shaped the way it is, where that is not obvious. */
  note?: string
  /** What checking it against the mandate found. */
  verified?: string
}

export const SWORDFISH_CLIENTS: SwordfishClientSpec[] = [
  {
    name: "ABSTO Industrial Supplies (Pty) Ltd",
    swordfish: [
      "ABSTO Industrial Supplies (Pty)Ltd -1",
      "ABSTO Industrial Supplies (Pty)Ltd -2",
    ],
    industry: "Service Providers",
    commissionBands: {
      source: "Signed mandate, 12 September 2025",
      bands: [
        { upTo: 250000, rate: 0.21 },
        { upTo: 500000, rate: 0.15 },
        { upTo: 1000000, rate: 0.12 },
        { upTo: null, rate: 0.1 },
      ],
    },
    commissionByPrefix: {
      "AIS": 0.21,
      "AIS2": 0.15,
    },
    verified:
      "19 accounts checked against the mandate, 0 on the wrong rate.",
  },
  {
    name: "Accelerate Fitness",
    note:
      "No mandate on file yet. Flat 30% from the Jan 2026 client list; single prefix, no evidence of a scale.",
    swordfish: [
      "Accelerate Fitness - 1",
    ],
    industry: "Health",
    commissionByPrefix: {
      "ACF1": 0.3,
    },
  },
  {
    name: "Adowa Property Managers (Pty) Ltd",
    note:
      "Parent only. Two properties, each with its own account book, so they are children rather than sequential handovers of one relationship. No mandate on file yet; both flat 30%.",
    industry: "Rentals",
    children: [
      {
        name: "Adowa Property Managers \u2014 Ellis Park",
        swordfish: [
          "Adowa Property Managers (Pty) Ltd - Ellis Park",
        ],
        commissionByPrefix: {
          "APM": 0.3,
        },
      },
      {
        name: "Adowa Property Managers \u2014 Frederick Street",
        swordfish: [
          "Adowa Property Managers (Pty) Ltd -Frederick Street",
        ],
        commissionByPrefix: {
          "APM2": 0.3,
        },
      },
    ],
  },
  {
    name: "Agri Saad",
    swordfish: [
      "Agri Saad -1",
      "Agri Saad -2",
    ],
    industry: "Products",
    commissionBands: {
      source: "Signed mandate, 2 September 2024 (client Etienne Olivier)",
      bands: [
        { upTo: 100000, rate: 0.25 },
        { upTo: 500000, rate: 0.2 },
        { upTo: null, rate: 0.15 },
      ],
    },
    commissionByPrefix: {
      "AID1": 0.25,
      "AID2": 0.2,
    },
    verified:
      "4 accounts checked against the mandate, 0 on the wrong rate.",
  },
  {
    name: "Growthpoint Student Accommodation Holdings (RF) Ltd",
    note:
      "One client, four handovers. Swordfish splits it across two client codes (GPS3/GPS4) and files them under different groups (Rentals/Schools), but it is one relationship \u2014 and one sliding-scale commission agreement, which only works if the client is one record.",
    swordfish: [
      "Growthpoint Student Accommodation Holdings (RF) Ltd 2024 - 1",
      "Growthpoint Student Accommodation Holdings (RF) Ltd 2024 - 2",
      "Growthpoint Student Accommodation Holdings (RF) Ltd 2025 - 1",
      "Growthpoint Student Accommodation Holdings (RF) Ltd 2025 - 2",
    ],
    industry: "Rentals",
    commissionBands: {
      source: "Signed mandate, 30 April 2024",
      bands: [
        { upTo: 25000, rate: 0.25 },
        { upTo: null, rate: 0.225 },
      ],
    },
    commissionByPrefix: {
      "GPS3/1": 0.25,
      "GPS3/2": 0.225,
      "GPS4/1": 0.25,
      "GPS4/2": 0.225,
    },
    verified:
      "285 accounts checked against the mandate, 60 (21%) on the wrong rate \u2014 50 under-charged, 10 over-charged. Imported as-billed and flagged, not restated.",
  },
]
