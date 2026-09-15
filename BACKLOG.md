# Backlog

Agreed but not built, and the things that will bite if nobody remembers them. Sessions start
cold, so anything living only in a conversation is lost — if it is decided, it belongs here.

`CLAUDE.md` is how the system works. This is what is left.

---

## Next up

### 1. An overdue promise sorts as a Broken PTP — DERIVED, no nightly job

**Decided.** A promise due on the 31st with no money in by the 1st is a broken promise the next
morning, at the top of that day's list. One day, not two: speed is what recovers a defaulted
payment.

**No job, and that is the point.** Position is derived, never stored, and the diary already
derives "missed" as an open entry whose date has passed. An overdue promise with no payment *is*
a broken promise — nothing needs to write it down. Deriving it means:

- true at midnight with no cron to fail or forget
- money landing on day 2 corrects itself; no second job to undo the first
- **costs no Vercel function**, and `api/` is at 12 of 12

What it touches: the ordering in `diaryPriority.ts` so a `promise_due` entry past its date sorts
at `promise_broken`'s rung, and `clientPosition.ts` so the account reports as
`broken_arrangement`. Neither writes anything.

**Open question, not yet answered by the firm:** debit orders. A cash deposit reflects the same
day, but an unpaid debit order can take two days to report back. If the firm runs debit-order
arrangements, a +1 rule flags brokens that are not broken — the grace would then have to follow
the payment method rather than the calendar. Ask before building.

### 2. The collector's own dashboard — BUILT

At `/performance`. The firm's month (11th to the 10th) with a period picker, the money tiles, the
book-independent measures kept visibly apart from them, and the over-ceiling notice where a
collector will actually see it.

Left to do on it: a per-collector drill-down (clicking a row on Everyone), and thresholds for the
traffic lights that are the firm's rather than my guesses — they live in one constant,
`THRESHOLDS` in `collectorScore.ts`, for exactly that reason. Ask after a season of real figures.

### 3. A sales diary, on the main `diary_entries`

**Decided:** the sales side gets a diary running on the existing table, not a second one. Two
diaries means neither is trusted.

`tasks` already has the polymorphic shape (`lead_id`, `deal_id`, `contact_id`, `company_id`).
`diary_entries` has the better model — a ladder ordered by what the work *is*, and a move that
cannot erase the miss. What Tasks has and the diary lacks is a time of day.

Shape: `account_id` becomes nullable, the four sales FKs are added with a CHECK that exactly one
is set, `due_at time` joins `due_on`, the one-open index becomes per-subject, and
`diary_priority()` learns a sales ladder.

**Blocked on three answers from the firm:**

1. What is the sales ladder? The collections one is theirs and works because it is ordered by
   what recovers money. What does a rep look at first?
2. One open date per lead, like an account — or may a deal hold "call Tuesday" and "proposal due
   Friday" at once?
3. Does the Tasks screen survive for things that are not a next touch, or does it become the
   diary? If both exist the line between them has to be obvious or people file in the wrong one.

**This is mine, not the sales session's.** It touches `diary.ts`, `diaryPriority.ts` and `tasks`.

### 4. Client reporting, then the portal

Monthly frozen snapshots on the firm's own period — the 11th to the 10th; `salesMonth.ts`
already has the engine. Remittance Advice and State of Accounts generated on the 11th, released
on the 15th. Then a client login reading those snapshots rather than live data, so a report
cannot change under a client after they have read it.

### 5. Campaigns

Email campaigns for team leaders; SMS Administrator-only, because SMS costs real money per
segment and the Annexure B cap is 10 a month per account. The firm's view: "SMSs don't really
work that well" — email is the priority.

---

## Loose ends that will bite

- **`Main` is 103 commits behind** and has no supersede in `diary.ts`. Anything deployed from it
  runs pre-index code against a database that has the index — which is exactly the constraint
  violation the firm hit. Merge before relying on any deployed build.
- **Production has no `diary_entries` table at all.** The whole collections diary is staging-only.
- **`EMAIL_CREDENTIALS_KEY` must be rotated** — a production key was generated in chat in an
  earlier session. Three production mailboxes need reconnecting afterwards.
- **The Connect Mobile API token and the BuzzBox provisioning URL appeared in a screenshot** and
  should be reissued.
- **Allocation is gated in the UI only.** `debtor_accounts` RLS lets any signed-in user write any
  column, so the grade rules are advisory. A column-guard trigger like the one on `profiles`
  would fix it — worth doing before the production import, and worth tracing every write path
  first so the import does not break.
- **13 accounts claim a live "Promise To Pay" that Swordfish had already filed under Failed
  PTPs.** Only 3 accounts carry sub-status 'Payment Default' against 40 in the bucket. Decide
  whether those are corrected on the way in.
- **`api/` is at 12 of 12 serverless functions.** The 13th fails to deploy. The firm is staying
  on Hobby while building, so anything needing an endpoint has to be designed around it — see
  the e-signature work, which uses an anon RLS path instead.

---

## Not this session's

The sales pipeline, mandates, online signature, layouts and mail belong to the sales session on
`claude/raptor-mail`. Do not edit `src/pages/leads|deals|contacts|companies`, `src/lib/userMail.ts`,
`src/lib/email*.ts`, `src/pages/mail/` or `api/email/` from the collections side.
