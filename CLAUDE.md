# Raptor

A CRM and collections system for **Bredell Ferreira**, a South African debt-collection firm.
Sales side (leads, deals, clients) and collections side (the book, the diary, mail, disputes) in
one app.

Read this before changing anything. Most of it is here because getting it wrong once cost real
time, and a few items are here because getting them wrong would cost the firm money or a client.

---

## The vocabulary is the firm's, not the database's

The single most common mistake is showing a person a column instead of an answer.
`status = 'Active: Unfrozen'` describes how a row got into the table. It says nothing about the
debtor. Four vocabularies exist and they are not interchangeable:

| Layer | Where | What it is |
|---|---|---|
| **Client position** | `src/lib/clientPosition.ts` | The 13 rungs a client is reported on: Paying, Arranged, Broken arrangement, Refusing to pay, Cannot pay, Negotiating, In progress, Tracing, Disputed, Legal, Under administration, Frozen, Closed. **Derived**, never stored. |
| **Account band** | `src/lib/collectorGrade.ts` | Generic / High value (R25 000) / Major (R50 000). Decides who may be given the account. Derived from balance, lifted by a hard position. |
| **Collector grade** | `src/lib/collectorGrade.ts` | Junior → Skilled → Senior → Elite. Set by a team leader, **never computed**. |
| **Diary kind** | `src/lib/diaryPriority.ts` | The work ladder: Broken PTP → New account → PTP due → Callback → Dispute chase → No contact → Trace → Review. Mirrored in SQL by `diary_priority()`. |

**Grade decides WHICH accounts, never HOW MANY.** Company standard is 500 on the book and 50 a
day for everybody; a junior and an elite carry the same volume. Per-person overrides live on
`profiles.book_ceiling` / `diary_capacity` / `diary_reserve`; null means the standard.

**A routine review is the LAST rung, below even a trace.** It is the only kind with no event
behind it.

---

## Rules that are law, not preference

- **In duplum** (NCA s103(5)) — once in default, interest + fees + costs may not exceed the
  capital outstanding. `in_duplum` and `in_duplum_ceiling` enforce the ceiling; nothing may grow
  non-capital past it.
- **Section 129 is NOT legal action.** It is the statutory demand *before* court. An account on
  Section 129 is `in_progress`, not `legal`. 279 accounts carry it.
- **Annexure B tariff** (`src/lib/annexureB.ts`) prices every chargeable action: email R25, SMS
  R3.50/segment capped at 10 a month, consultation R60, disputes R25, receiving email R13.
  Fees are raised on the action and only become billable once money is recovered.
- **Fees are charged on ACCOUNTS ONLY** — never on leads or deals. The sales side raises nothing.
- **Financial records are immutable** once remittance has run or a payment is processed.
- **Refusing to pay ≠ cannot pay.** One is a legal decision, the other is a pensioner. Never put
  them on one list.

---

## Architecture, and where it bites

**Two data paths, on purpose.** `AppStore` holds the sales side (a few hundred rows a person
edits). The collections book is hundreds of thousands of rows and is queried directly, paged,
with every filter applied in the database. A list that loads the book to count it stops working
the month it matters.

**Hand-written row mappers drop columns silently.** `AuthContext.mapProfileRow` and
`accountBook.toAccount` list every field by hand. A column present in the database, in the type
and in the `select('*')` but missing from the mapper reads as `undefined` for ever and nothing
fails. `diary_capacity` sat in that state for months.

**One clause builder.** `applyAccountFilters()` turns an `AccountQuery` into clauses and both the
list and every bulk action go through it. Written twice they drift, and the failure is not a
wrong list — it is changing accounts nobody saw.

**Things that bite:**
- `protect_closed_diary_entries` **silently reverts** edits to `done`/`moved` entries. It does
  not raise.
- `protect_filed_mail_target` reverts link changes on `user_emails` for non-Administrators.
- **One open diary entry per account** — a partial unique index. PostgREST cannot infer a partial
  index for upserts, so a second open entry is refused loudly. That is deliberate.
- **Stored generated columns** (`is_settled`, `diary_entries.priority`, `commission_drift`) are
  computed on write. Changing the function does not recompute existing rows; an UPDATE does.
- `en-ZA` groups thousands with a **non-breaking space** and renders September as **"Sept"**.

---

## Environments

| | Project | Rule |
|---|---|---|
| Staging | `kvkajxpremantdkhmjvb` | Work here. Data is disposable and the firm has said so. |
| Production | `qcvesjzoiznrvunjrqpv` | **Do not write to it casually.** It is behind staging and carries real client money. |

**This GitHub repo is public.** Real client data must never be committed — no CSV exports, no
screenshots of the book, no database dumps.

**API keys never go in a `VITE_*` variable** — Vite bundles those into client code. Never ask the
user to paste a secret into chat.

**Vercel Hobby caps serverless functions at 12 and `api/` is at exactly 12.** A new endpoint
needs an existing one removed, or a Pro plan. `api/` is also **not typechecked** by
`npm run build` — use a temporary `tsconfig` to check it.

---

## Verifying work

```
npm run qa            # everything: rule checks + a real browser
npm run qa -- --fast  # skip the browser
npm run build         # tsc -b && vite build
npm run lint
```

**Two kinds of check, answering different questions:**

- `scripts/qa/check-*.mjs` — pure functions and source read back. Fast, no browser, no network.
  Lib imports need explicit `.ts` extensions. `src/data/mockData` is NOT resolvable from here.
- `scripts/qa/e2e/*.mjs` — the real app in a real Chromium, every request answered from fixtures.
  No database, no credentials, no network; writes a placeholder `.env.local` if none exists.
  This layer exists because a panel once shipped, was provably in the deployed bundle, and was
  invisible — a placement bug no unit check could see.

**The convention that matters: after writing a check, break the thing it guards and confirm it
fails.** A check that passes on broken code is worse than none. Two traps seen here:

- `indexOf` returns `-1`, so an order-only assertion passes vacuously once the guard it orders is
  deleted. Assert presence *before* order.
- Indexing `unplaced[0]` when nothing is unplaced throws a `TypeError` two lines below the check
  that should have reported it. Read defensively.

---

## Working in parallel

Sessions cannot see each other and each starts cold. **One branch per session** — two sessions on
one branch means one force-pushes over the other.

`supabase/schema.sql` is append-only, so two sessions will conflict there on nearly every merge.
Both hunks land at the end; keep both. There is **one shared staging database** (Supabase
branching is a Pro feature), so a migration from one session is live for the other while its
local `schema.sql` does not have the column — and `check-select-columns.mjs` validates against
that file. Pull from the other branch when it complains.

Shared files to touch lightly: `schema.sql`, `types.ts`, `App.tsx`, `AppStore.tsx`, `Sidebar.tsx`,
`package.json`.

---

## Migrations

Apply to staging with the Supabase MCP tool, then **mirror the same SQL into
`supabase/schema.sql`** — it is the checked-in record and the QA scripts read it. Functions are
`security invoker` with `set search_path to 'public'` unless there is a stated reason otherwise.

Probe destructive SQL inside a transaction that rolls back (`raise exception` at the end) before
running it for real.

---

## Writing for this codebase

Comments explain **why**, especially where a reasonable person would do it differently — and
where a rule came from the firm, say so. The house style is dense explanatory comments on
non-obvious decisions, not narration of what the next line does. Match it.

User-facing words are the firm's: "Broken promises", not "Failed PTPs"; "No diary date", not
"adrift". A warning that fires when nothing is wrong is worse than no warning, because people
stop reading it.
