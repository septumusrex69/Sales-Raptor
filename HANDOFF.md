# Handoff — where Raptor stands

**Read this instead of the previous session's transcript.** CLAUDE.md is the law and does not
change often; this file is the moving part. It says what shipped, what the firm has not yet
decided, what is still open, and which tools lie to you in this repo.

Last updated: **6 October 2026**, end of the session on `claude/sales-raptor-review-p1pzx2`.

**Keep it current.** A session that changes something here and does not update this file has moved
the problem to the next session rather than solved it.

---

## 1. The state of play

| | |
|---|---|
| Branch | `claude/sales-raptor-review-p1pzx2` (one branch per session — two sessions on one branch means one force-pushes the other) |
| Staging | `kvkajxpremantdkhmjvb` — work here, data is disposable and the firm has said so |
| Production | `qcvesjzoiznrvunjrqpv` — **do not write to it casually**, it is behind staging and holds real client money |
| Repo | **PUBLIC.** No real client data in any commit: no exports, no screenshots of the book, no dumps |
| Verify | `npm run qa` (≈12 min, real browser), `npm run qa -- --fast` (≈3 min), `npm run build`, `npm run lint` |

At the last full run: **all green, 17 652 checks across 271 files.**

---

## 2. What shipped this session

Newest first. Each commit message carries the full reasoning; this is the index.

| Commit | What it is |
|---|---|
| `be1e03b` | **A payment has two dates.** `received_at` is what the debtor did; `allocated_on` is what we did, and it decides which payover run the money goes out on. Set once, at approval. `paid_over_in_swordfish` marks money the old system already remitted: out of the queue, never split, never claimed, and `approve_payment` refuses it. |
| `5156deb` | **Trust overview answers "does it balance?"** with a panel that can say no. See §4 for why the sketch's own reconciliation was not built. |
| `24debef` | **An imported account is not a new handover.** No handover email or SMS on an imported file, and none on an account outside the Active book. |
| `f8d9084` | Revokes from `public, anon` on four functions; the status-event trail has no write policy. |
| `8e853d0` | Moving an account between books (hold / release / withdraw / settle), and the Swordfish balance-gap panel. |
| `71e6aa2` | A company debtor keeps its registration number; the wipe says what it would delete. |
| `d2b2d56` | The clients list counts the actual book; Annexure B item 9 cap is dated as charged. |
| `9d4c520` | **Three books: Active, On hold, Closed** — a stored generated column, so it cannot drift. |
| `f3a6405` | **The PostgREST 1 000-row cap.** The most serious bug found. See §5. |
| `d0ba7a9`, `7447ae2` | The trust, bucketed by the payover cycle each part is waiting for. |

### Uncommitted at handoff

The **Client column** on the Accounts list and on Payments in (Awaiting approval), at the firm's
request: *"Please add the client names to these places."* Code is written and green; two break
tests were interrupted mid-run and one of them left a sabotage in the tree, which
`check-row-mappers` then caught — the mapper was reading `r.company_name` instead of the embed
`r.companies?.name`. Restored and re-verified. **If the tree is dirty when you pick this up, read
§6 first.**

---

## 3. Open requests the firm has made and nobody has started

Both arrived at the very end of the session. Quoted so the next session does not re-interpret them.

1. **A calendar invitation should open the email, not the mailbox.**
   *"If I open an invitation from the calendar, it just takes me \[to the mailbox]. It should just
   take me to the other place. Actual email."*
   The screenshot shows Raptor Mail with nothing selected — "Pick a message on the left to read
   it." So the link lands on the list without resolving to the message. Note the precedent already
   in CLAUDE.md: *"A meeting opens the meeting, not the mailbox."* This is the same fault one step
   further along.

2. **Client correspondence is being filed onto the debtor's account.**
   *"This email came from the client and then it came to the debtor account. Should go to the
   ticket if there was one and or go to the client profile."*
   An email from a client contact appeared in the Emails tab of a debtor's account (the row already
   showed "Already on a ticket"). The account's Emails tab is evidence of what passed between the
   firm and the DEBTOR — it is what a Section 129 proof-of-communication rests on — so client
   correspondence in it is not merely untidy. Where mail lands should follow who the correspondent
   is. Watch `protect_filed_mail_target`, which reverts link changes on `user_emails` for
   non-Administrators.

---

## 4. Decisions waiting on the firm

Do not guess these. Each one changes money.

1. **R502 or R509?** On 10 September the business confirmed R502 was captured wrongly on their side
   and the gazette says **R509**. Prompt 7 says make the app match the database, which is **R502**.
   The database and the app now both say R502, and the conflict is written into `check-fees.mjs`.
   **Ask before changing either.**

2. **When did Swordfish last pay its clients over?** The import now asks for this date and defaults
   to the firm's own worked example (import 6 Oct → settled through 10 Sep). But their example
   implies the cycle boundary, while Raptor's own lag setting says that cycle pays on 11 October,
   still in the future. Too early and clients are paid twice; too late and a month is never
   remitted. **This is the most consequential number in the migration.**

3. **`payover_lag_months` and `parked_credit_months`** are both placeholders (1 and 6). Same
   question as 2, from the other side.

4. **Commission / fees / VAT split of the firm's trust balance.** The firm's sketch asks for it. It
   is **not stored** — `trust_creditors_on_allocation` writes interest, costs, commission and VAT as
   one entry with one reason. Rebuilding it reaches allocation-backed rows only and silently misses
   charge recoveries and drawings, so the parts would not sum to the whole. The alternative is
   changing a financial ledger. **Ask.**

5. **The trust overview's "unexplained difference" was deliberately not built as drawn.** The
   firm's sketch reconciles the ledger balance against the four owners — but `trust_position`
   derives the balance BY ADDING THEM UP, so that difference is 0.00 on every row of data that can
   exist (verified on staging: 7 873,60 / 7 873,60 / 0,00). It was replaced with four checks that
   can actually fail. If the firm asks again, this is the explanation.

---

## 5. Known gaps and things still outstanding

- **Item 8 of prompt 7 could not be investigated.** APM20070, APM20097 and GPS4/10080 fail a
  payments reconciliation; the files are not in this repo. A reconciliation was built into the
  import instead, so the real migration cannot pass it silently.
- **Item 6 remainder:** "allow the wipe on production only before the first migration" is not done —
  it needs a fact about production that nothing in Raptor records.
- **Settlement store** (approved amount, expiry, saving) — task #69, not started.
- **The R22,77 settlement shortfall on RRC00002** is unexplained.
- **Business workspace** still has no Income and no Drawings-from-trust screens.
- **Imported accounts were given handover runs before the guard landed** — 20 on staging, 8 closed
  and 3 on hold. Not swept: a correction is the firm's decision, case by case.

---

## 6. Traps in this repo that cost real time

These are not in CLAUDE.md because they are about the tools, not the firm.

**PostgREST silently truncates at 1 000 rows.** A request over the cap SUCCEEDS — no error, no
flag, no count — and `.limit(2000)` does not raise it. This had ten of 28 test accounts showing the
wrong fees and four showing none. Always page through `fetchAllRows`; `check-row-cap.mjs` holds
every large-table read to it.

**`schema.sql` is append-only, so read the LAST definition.** `indexOf('create or replace function
public.<name>(')` lands on a superseded copy and asserts against code that is not live.
`check-allocation-start` was doing exactly this and had been for some time. Anchor on the full
phrase — a bare `lastIndexOf(name)` hits the function's own comment or grant and returns nothing,
which fails OPEN because every regex then tests an empty string.

**The MCP SQL tools have limits that fail in misleading ways.**
- `execute_sql` times out above roughly 4 kB, and on any query containing the literal words
  `drop` / `delete` / `truncate`. Workaround: `execute 'dr' || 'op ...'`.
- `apply_migration` **timed out on an 8 kB function and did not apply it** while appearing to fail
  ambiguously. Always verify against `pg_proc` afterwards.
- For a large function, rebuild it from its own live `prosrc` with `replace()` inside a `do` block:
  the payload stays small and the file and the database match by construction.
- Verify every mirror by md5: strip `/*…*/` and `--`, collapse whitespace, hash both sides.

**`create or replace` is not always a replace.** A new defaulted parameter creates an OVERLOAD; a
widened `returns table` is refused outright. Both need a DROP — and **a dropped function comes back
with the default PUBLIC grant**, however carefully the old one was revoked. This is how three of
four book readers ended up reachable by `anon` while their sibling was locked.

**`revoke ... from anon` is not enough.** Postgres grants EXECUTE to PUBLIC on every new function
and anon inherits it. The house pattern is `from public, anon`; the evidence is a leading
`=X/postgres` in `pg_proc.proacl`.

**`innerText` is the RENDERED text.** A heading with `uppercase` comes back as `CLIENT`. Three
assertions in one session failed on perfectly correct screens because of this.

**Playwright's locators race React.** The URL changes before the row it decides is drawn, so
reading a locator on the next line can return an empty list and then count correctly a millisecond
later — a check that reports the wrong number and passes. Wait for the element.

**`en-ZA` groups thousands with U+00A0** and renders September as "Sept". Build the separator as
`String.fromCharCode(0xa0)`; never type it. In an SMS it costs real money — see CLAUDE.md.

**`new Date('2026-10-11')` is UTC midnight**, which is the wrong day in Johannesburg for two hours.
`new Date(Date.UTC(...))` is safe and `check-trust-cycles` now exempts that shape by name.

**Two QA harnesses compare with `Object.is`**, which is false for any two objects — so object
assertions fail on correct code. Compare as JSON strings. The e2e responder signature is
`(url, request)`, not `(request)`.

**A comment can break a check.** A note in `schema.sql` saying what must never be added contained
the words it was warning about, and the check counted the warning as the thing. Strip comments
first — the house already does this in `check-company-dashboard`.

**Break-test convention, and it is not optional.** After writing a check, break the thing it guards
and confirm it fails. Twice this session a "break test" was equivalent code and proved nothing;
once a sed silently failed to apply and the green result was meaningless. Verify the sabotage
actually landed before trusting the red.

---

## 7. How to pick up

1. Read CLAUDE.md, then this file.
2. `git log --oneline -12` — the commit messages carry the reasoning, not just the change.
3. `npm run qa -- --fast` before touching anything, so you know what was already red.
4. Work on staging; mirror every migration into `supabase/schema.sql`; verify by md5.
5. Update §2, §3 and §5 of this file before you finish.
