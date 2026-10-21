import { useState } from 'react'
import { AlertTriangle, CalendarClock, Check, HeartHandshake } from 'lucide-react'
import { Card, CardHeader } from '../../components/ui/Card'
import { FormField } from '../../components/ui/Modal'
import { saveEstate } from '../../lib/accountStandingData.ts'
import { diarise } from '../../lib/diary.ts'
import { ESTATE_PROMPTS, NOTICE_TO_CREDITORS_DAYS, estateClaimDeadline } from '../../lib/callScripts.ts'
import { shortDate } from '../../lib/dateLabels.ts'
import { todayIso } from '../../lib/reminderTime.ts'
import type { DebtorAccount } from '../../lib/accountBook.ts'

const inputClass = 'w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] '
  + 'text-slate-800 focus:border-[#c9a052] focus:outline-none'

/**
 * THE ESTATE ROUTE: WHAT AN ACCOUNT BECOMES WHEN THE DEBTOR DIES.
 *
 * THE FIRM: "when a debtor dies the account does not end, it changes form. It becomes a claim
 * against the deceased estate, and the family is not liable for it."
 *
 * TWO THINGS ON THIS PANEL ARE THE WHOLE REASON IT EXISTS, and both are things the brief says are
 * routinely missed:
 *
 *   THE CLAIM LODGEMENT DEADLINE. "The executor advertises a notice to creditors, and a claim
 *   lodged after the period in that notice is lost. This is the one date on an estate file that
 *   actually costs the client money if it is missed, so it needs a hard task, not a note." So the
 *   deadline is BOOKED IN THE DIARY, which is the collections side's dated work list and the thing
 *   somebody's day is built from -- not written into a note that is read only if the account is
 *   opened.
 *
 *   THE CREDIT LIFE QUESTION. "Where it exists, the balance may be met by the insurer and the
 *   estate pays nothing. It is the single fastest resolution available on a deceased account and it
 *   is routinely missed." It is a prompt rather than a field, because the answer comes from the
 *   client's own agreement and the firm does not hold it.
 *
 * WHY THE DIARY AND NOT `tasks`. `tasks` is the SALES side's table -- it links to a lead, a deal, a
 * contact or a company and has no account at all. The diary is the collections side's, it is
 * already what a collector's day is read from, and on a deceased account nothing else is scheduled
 * anyway: everything automated has stopped. One open entry per account is the firm's rule, so this
 * deliberately takes the account's one date, which on an estate file is the only date that matters.
 *
 * NOTHING IS PRESSED AUTOMATICALLY. The deadline is booked when somebody books it, because the
 * date it is counted from is a fact only the executor can give -- see estateClaimDeadline, which
 * answers null without it.
 */
export function EstatePanel({ account, actor, onChange }: {
  account: DebtorAccount
  actor: { id: string | null; name: string | null }
  onChange: () => Promise<void> | void
}) {
  const [dateOfDeath, setDateOfDeath] = useState(account.dateOfDeath ?? '')
  const [masterOffice, setMasterOffice] = useState(account.masterOffice ?? '')
  const [advertised, setAdvertised] = useState(account.noticeToCreditorsOn ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [booked, setBooked] = useState<string | null>(null)

  const deadline = estateClaimDeadline(advertised || null)
  const late = deadline !== null && deadline < todayIso()
  const executor = account.practitionerKind === 'executor' ? account.practitionerName : null

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await saveEstate(account.id, {
        dateOfDeath: dateOfDeath || null,
        masterOffice: masterOffice || null,
        noticeToCreditorsOn: advertised || null,
      })
      await onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function book() {
    if (!deadline) return
    setBusy(true)
    setError(null)
    try {
      await diarise({
        accountId: account.id,
        /* THE PERSON WHO HAS THE FILE. A deceased account is routed to the manager, and whoever
           that is on this account is who it is assigned to -- booking it to the person pressing
           the button would hide it from the file's owner the moment they are not the same. */
        ownerId: account.assignedTo ?? actor.id,
        dueOn: deadline,
        /* A CALLBACK AND NOT A REVIEW. A review is the last rung of the diary ladder -- the kind
           with no event behind it -- and this has the most consequential event on the file behind
           it. See diaryPriority. */
        kind: 'callback',
        reason: `Lodge the claim in the estate by ${shortDate(deadline)}. The notice to creditors `
          + `was advertised on ${shortDate(advertised)}; a claim lodged after the period in it is `
          + 'lost.',
        /* ON THE TIMELINE TOO, because this one is a decision somebody made about a deadline and
           not a booking the runner made on its own. */
        alsoNoteOnAccount: true,
        actor,
      })
      setBooked(deadline)
      await onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title="The estate"
        subtitle="The account is a claim against the deceased estate. The family is not liable for it." />

      {/* WHO IT IS DEALT WITH THROUGH. Said first, because until there is an executor nobody may
          be told anything at all -- not even the balance, and not even to the family. */}
      <p className="text-[12px] text-slate-600">
        {executor
          ? <>Dealt with through <strong className="font-semibold text-slate-800">{executor}</strong>
            {account.practitionerReference ? <>, estate {account.practitionerReference}</> : null}.
            Contact with the family stops entirely.</>
          : <>No executor is on file yet, so <strong className="font-semibold">nobody may be told
            anything</strong> — not the balance, not the creditor, not that the account exists.
            Record the appointment under Who to deal with once the Letters of Executorship or the
            section 18(3) appointment arrives.</>}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <FormField label="Date of death">
          <input type="date" className={inputClass} value={dateOfDeath}
            onChange={(e) => setDateOfDeath(e.target.value)} />
        </FormField>
        <FormField label="Master's office">
          <input className={inputClass} value={masterOffice} placeholder="Pretoria"
            onChange={(e) => setMasterOffice(e.target.value)} />
        </FormField>
        <FormField label="Notice to creditors advertised">
          <input type="date" className={inputClass} value={advertised}
            onChange={(e) => setAdvertised(e.target.value)} />
        </FormField>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void save()} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5
            text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
          <Check size={12} /> Save
        </button>
      </div>

      {/*
        THE DEADLINE, AND IT IS THE POINT OF THE PANEL.

        ABSENT UNTIL THERE IS A DATE TO COUNT FROM, and said so: the advertisement date is a fact
        only the executor can give, which is why script-estate-executor asks for it in as many
        words. A deadline computed from the statutory minimum would be a date the firm worked to
        and the Master's notice contradicted.
      */}
      {deadline ? (
        <div className={`mt-3 rounded-lg border px-3 py-2.5 ${
          late ? 'border-negative-200 bg-negative-50' : 'border-[#c9a052] bg-gold-50'}`}>
          <p className={`flex items-start gap-1.5 text-[12px] ${
            late ? 'text-negative-700' : 'text-slate-700'}`}>
            <CalendarClock size={13} className="mt-0.5 shrink-0" />
            <span>
              {late
                ? <><strong className="font-semibold">The period has run.</strong> On the {
                  NOTICE_TO_CREDITORS_DAYS} days in the notice the claim had to be lodged by {
                  shortDate(deadline)}. Tell the manager rather than lodging it quietly late.</>
                : <>The claim has to be lodged by <strong className="font-semibold">{shortDate(deadline)}</strong>
                  {' '}&mdash; {NOTICE_TO_CREDITORS_DAYS} days from the advertisement. A claim lodged
                  after the period in the notice is lost.</>}
            </span>
          </p>
          <button type="button" onClick={() => void book()} disabled={busy}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-navy-950 px-3 py-1.5
              text-xs font-medium text-white disabled:opacity-40">
            <CalendarClock size={12} /> Put it in the diary for {shortDate(deadline)}
          </button>
          {booked && (
            <p className="mt-1.5 text-[11px] text-slate-600">
              Booked for {shortDate(booked)}. It is this account&rsquo;s diary date now, which on an
              estate file is the one date that matters.
            </p>
          )}
          {/* THE SHORTEST PERIOD THE EXECUTOR MAY ADVERTISE, said so nobody reads the date as
              gospel. Section 29 of the Administration of Estates Act sets 30 days as the minimum;
              a notice may give longer, and then the real deadline is later than this one. */}
          <p className="mt-1.5 text-[11px] text-slate-500">
            {NOTICE_TO_CREDITORS_DAYS} days is the shortest period a notice to creditors may give,
            so this is never later than the real date. If the notice gives longer, use the date on
            the notice.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-slate-500">
          No claim deadline yet. It is counted from the day the executor advertised the notice to
          creditors, which is one of the things <em>A confirmed executor</em> asks for on the call.
        </p>
      )}

      {/*
        AND THE FOUR THINGS TO DO, WITH THE INSURANCE QUESTION FIRST.

        THE FIRM: "also prompt the collector to ask about credit life or funeral cover on the
        agreement. Where it exists, the balance may be met by the insurer and the estate pays
        nothing. It is the single fastest resolution available on a deceased account and it is
        routinely missed."

        A PROMPT AND NOT A FIELD, because the answer is in the client's own credit agreement and
        the firm does not hold it. A tick box here would record somebody's guess.
      */}
      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide
          text-slate-500">
          <HeartHandshake size={12} /> On an estate file
        </p>
        <ul className="mt-1 space-y-1">
          {ESTATE_PROMPTS.map((p) => (
            <li key={p} className="text-[12px] leading-snug text-slate-600">&middot; {p}</li>
          ))}
        </ul>
      </div>

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-negative-700">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
    </Card>
  )
}
