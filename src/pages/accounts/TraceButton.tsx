import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Search } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { RecordActionNote } from '../../components/record/RecordShell'
import { recordTrace } from '../../lib/accountTrace'
import {
  bureauSearchCounts, TRACE_SOURCES, traceSourceById, traceSourceUrl, tracingThisMonth,
  type TraceSource, type TracingMonth,
} from '../../lib/traceSources.ts'
import { MONTHLY_LIMIT, TRACING_ACTION_CODE } from '../../lib/actionTariff.ts'
import { fetchLedgers } from '../../lib/accountBook'
import { searchKeyProblem, traceSearchKey } from '../../lib/traceStore.ts'
import { isValidSaId } from '../../lib/newDebtor'
import { scheduleFor } from '../../lib/annexureB'
import type { ChargeResult } from '../../lib/accountCharges'

/**
 * WHAT IT COST, SAID ONCE.
 *
 * The same sentence is on the modal's confirmation and on the line under the button, and the firm
 * reads both -- written out twice they drift, and two different accounts of one fee is how somebody
 * comes to believe a charge was raised that was not. CLAUDE.md's rule about the same figures on
 * two screens, applied to a sentence.
 *
 * A NULL CHARGE IS NOT A REFUSAL. It is one necessary expense already raised for this person,
 * which is a different thing from the ceiling and must not borrow its words.
 */
function chargeWords(
  result: { charge: ChargeResult | null; count: number },
  source: TraceSource,
): string {
  if (result.charge === null) return 'Recorded · no charge (already charged for this person)'
  if (result.charge.reason === 'written-off') return 'Recorded · no charge (account written off)'
  if (result.charge.reason !== 'charged') return 'Recorded · no charge (fee ceiling)'
  const many = result.count > 1 && source.kind === 'credit_bureau'
    ? `${result.count} searches · ` : ''
  return `${source.name} · ${many}charged R${result.charge.exclVat.toFixed(2)} + VAT`
}

/**
 * Trace a debtor: XDS opens on the click, and Raptor asks afterwards how many searches were run.
 *
 * Afterwards is the only moment the answer exists. An account can carry a company and three
 * sureties, and nobody knows before opening the portal how many of them they will end up looking
 * for — asking first would be asking someone to predict their own next ten minutes.
 *
 * So the click does the fast thing (open XDS) and nothing else; the charge waits for the count.
 * Closing without answering charges nothing, which is the right outcome for a portal opened by
 * mistake and for a search that turned out not to be needed.
 */
export function TraceButton({ accountId, actor, debtorKind, idNumber, debtorName, label, className, onDone, onUpload }: {
  accountId: string
  actor: { id: string | null; name: string | null }
  /** Which number is expected: an ID for a person, a registration number for a company. */
  debtorKind: 'individual' | 'company'
  /**
   * What XDS is searched ON: a person's ID number, or a company's registration number.
   *
   * Copied to the clipboard on the click, at the firm's instruction -- "it would automatically
   * copy the ID number to paste into the tracing system". It is thirteen digits that have to
   * arrive somewhere else exactly right, and retyping them is how a search comes back about
   * somebody else entirely.
   */
  idNumber: string | null
  /**
   * WHAT THEY ARE CALLED, for the sources searched on a NAME rather than on a number.
   *
   * THE FIRM: "if you go to Google AI, you want to copy anything about the data that you could
   * find -- name, surname, or company." Every source used to get the ID number, because the button
   * was written when XDS was the only one; SARS's VAT vendor search says on its own page that it
   * needs "a valid VAT Number or an Exact VAT Trading Name", and an ID number is the one thing it
   * cannot use. See TraceSource.searchOn.
   */
  debtorName: string | null
  /** What to call the button. The panel's empty box wants a fuller phrase than the action row. */
  label?: string
  /** The action row's styling, so this matches the buttons beside it. */
  className: string
  onDone: () => Promise<void>
  /**
   * Reading the PDFs the search just produced.
   *
   * Offered HERE rather than as a tenth button in the action row, and the reason is timing: the
   * only moment a collector certainly has the files on their machine is the minute after they ran
   * the search. Asked an hour later, on a panel, it is a task to come back to — which is how the
   * firm ended up paying for traces whose answers were never typed in.
   */
  onUpload: () => void
}) {
  /*
   * WHICH SOURCE, ASKED FIRST.
   *
   * THE FIRM: "where do I do the other traces, like for example CSA and stuff." The button went
   * straight to XDS, so the only search Raptor could record was the one it had a portal for --
   * every other one the firm runs was done, and charged to nobody, and written down nowhere.
   *
   * ONE MORE PRESS ON THE COMMON PATH, which is the honest trade: a bureau search is still two
   * clicks and every other source becomes reachable at all. Hiding the rest behind a menu on a
   * screen a collector uses fifty times a day is how a feature ships and is never found.
   */
  const [choosing, setChoosing] = useState(false)
  const [source, setSource] = useState<TraceSource>(() => traceSourceById('xds'))
  /* Where they looked, when it is somewhere this list does not name. */
  const [named, setNamed] = useState('')
  /* What came back. See traceSourceNote.found for why this is typed rather than screenshotted. */
  const [found, setFound] = useState('')
  const [asking, setAsking] = useState(false)
  /*
   * WHAT THIS MONTH'S TRACING HAS ALREADY COST, read when the picker opens rather than on every
   * render of the account. The ledger is a request, and the number only matters once somebody is
   * about to spend one of the four.
   */
  const [tracing, setTracing] = useState<TracingMonth | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ charge: ChargeResult | null; count: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  /* 'asking' until the clipboard answers, because a write can be refused after it is accepted. */
  const [copied, setCopied] = useState<'asking' | 'yes' | 'no' | 'nothing'>('nothing')
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
  }, [])

  /*
   * THE DAY'S SCHEDULE, READ ONCE AND USED FOR BOTH THE PRICE AND THE COUNT.
   *
   * `scheduleFor(new Date())` because a trace recorded now is priced on the gazette in force
   * today -- CLAUDE.md's rule, and the reason this takes a date at all. The same schedule decides
   * how many buttons there are, so the row and the price can never describe different tariffs.
   */
  const schedule = scheduleFor(new Date())
  const rate = schedule.items.find((i) => i.id === '4c')?.amount ?? 0
  const counts = bureauSearchCounts(schedule)
  /*
   * ONLY A BUREAU SEARCH IS COUNTED, and this is the half of the firm's "only up to four" that
   * they did not have to say. Item 4(c) is priced PER SEARCH; every other source is item 3, once
   * per person, and `recordTrace` already forces its quantity to one. So the row of numbers was a
   * question with no true answer on SASSA, CSA and "somewhere else" -- press seven and one fee is
   * raised. The same rule the trace outcomes follow: a question nobody can answer honestly is
   * worse than no question.
   */
  const counted = source.kind === 'credit_bureau'
  /*
   * CHECKED BEFORE IT IS COPIED. It used to copy whatever was in the ID field, and on one account
   * that was a telephone number -- Swordfish's export carried one in the ID column and the ID was
   * never captured. Pasting it into XDS is a search the firm pays for, run against something that
   * is not a person. So an unusable number is not copied at all, and is named so it gets fixed.
   */
  const identity = traceSearchKey(debtorKind, idNumber, isValidSaId)
  /*
   * WHICH KEY THIS SOURCE WANTS.
   *
   * A NAME IS NEVER REFUSED THE WAY A NUMBER IS. `traceSearchKey` Luhn-checks an ID because a
   * transposed pair traces somebody else and is thirteen digits either way -- there is no such
   * check to make on "Promise Sikelele", and a name that turns out to be spelt wrong costs a
   * search that finds nothing rather than a search about a different person. So the only failure a
   * name has is being absent.
   */
  const nameKey = (debtorName ?? '').trim()
  const key = source.searchOn === 'name'
    ? (nameKey
      ? { ok: true as const, value: nameKey, what: 'name' as const }
      : { ok: false as const, found: null, why: 'missing' as const })
    : identity
  /* The sentence for a bad ID is written for an ID; a missing name needs its own. */
  const problem = source.searchOn === 'name'
    ? (key.ok ? null : `This source is searched on a name and the account has none recorded.`)
    : searchKeyProblem(identity, debtorKind)

  /*
   * THE PICKER OPENS ON THE TAP AND NOTHING ELSE HAPPENS YET.
   *
   * The clipboard write and the new tab both have to start inside the tap that asked for them --
   * see pick() -- so this does not try to do either. Choosing the source IS the tap that opens
   * the portal.
   */
  function open() {
    setResult(null)
    setError(null)
    setChoosing(true)
    /* Fire and forget: a ledger that will not load costs the detail line, never the trace. */
    void fetchLedgers(accountId)
      .then((l) => setTracing(tracingThisMonth(
        l.fees, new Date().toISOString(), MONTHLY_LIMIT[TRACING_ACTION_CODE] ?? 4)))
      .catch(() => setTracing(null))
  }

  function pick(s: TraceSource) {
    /*
     * BOTH OF THESE HAVE TO START INSIDE THE TAP.
     *
     * Safari allows a new tab, and a clipboard write, only while it can still see the tap that
     * asked for one. Either one moved after an await is silently refused, which looks exactly
     * like a broken button. The clipboard call is started here and answered later -- writeText
     * resolves asynchronously, so what is shown in the modal waits for the real answer rather
     * than claiming success the moment it was asked for.
     */
    /* THE KEY FOR THE SOURCE BEING PICKED, for the same reason the address is -- `key` above is
       derived from `source`, which is still the previous one until setSource runs. */
    const copying = s.searchOn === 'name' ? nameKey : (identity.ok ? identity.value : '')
    setCopied(copying ? 'asking' : 'nothing')
    if (copying) {
      try {
        const write = navigator.clipboard?.writeText(copying)
        if (write) write.then(() => setCopied('yes')).catch(() => setCopied('no'))
        else setCopied('no')
      } catch {
        /* A browser with no clipboard permission at all. The number is shown instead. */
        setCopied('no')
      }
    }
    /*
     * A source with no portal is searched some other way: there is nothing to open, and opening
     * a blank tab would be the app pretending to do something.
     *
     * THE KEY GOES INTO THE ADDRESS WHERE THE SITE TAKES ONE. A web search carries its query in
     * the URL, so the press lands on the results instead of an empty box -- which is the firm's
     * "it would open the link so the data would be traced appropriately", done as far as each site
     * allows. Everything else here posts a form and still has to be pasted into, which is what the
     * clipboard write above is for.
     *
     * BUILT FROM `s` AND NOT FROM `source`, because setSource below has not run yet: reading the
     * state here would open the PREVIOUS source's address, which is the kind of bug that sends a
     * collector to the right site for the wrong debtor.
     */
    const wanted = s.searchOn === 'name' ? nameKey : (identity.ok ? identity.value : '')
    const href = traceSourceUrl(s, wanted)
    if (href) window.open(href, '_blank', 'noopener,noreferrer')
    setSource(s)
    setChoosing(false)
    setResult(null)
    setError(null)
    /* Cleared with the source, or a finding typed against SASSA follows the collector on to the
       voters' roll and lands on the wrong note. */
    setFound('')
    setAsking(true)
  }

  async function charge(count: number) {
    setBusy(true)
    setError(null)
    try {
      const c = await recordTrace({
        accountId, actor, count, sourceId: source.id, named, found,
        /*
         * ONCE PER SUBJECT, and the account answers it. Passed as false here: the panel knows
         * which subjects have been traced, this button does not, and a guess either way is a fee
         * raised twice or a fee never raised. Wired through when the panel's own trace button
         * lands -- see traceSources.chargesForThisSearch.
         */
        alreadyChargedForSubject: false,
      })
      setResult({ charge: c, count })
      /*
       * THE MODAL STAYS OPEN, because the offer to upload is the next thing said and it is said
       * HERE. It used to close and leave a link under the button for ten seconds -- see onUpload
       * for why that moment matters, and see below for why ten seconds was the wrong way to use
       * it. The line under the button is still written, for anyone who says Not now.
       */
      await onDone()
      if (resetTimer.current) clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => setResult(null), 10000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    /*
      THE TWO LINES BELOW THIS BUTTON ARE WHAT MADE THE ACTION ROW RAGGED.
      
      They sat in the flow, so recording a trace made this column two lines taller than every
      button beside it -- which stretched the whole line and pushed the wrap. RecordActionNote
      hangs them under the button instead: same words, same place on the screen, and the row does
      not move. See RecordActions for what the firm was looking at when they said so.
    */
    <RecordActionNote note={result && (
      <>
        {/*
          Straight after the charge, while the downloads are still in the corner of the screen. The
          line stays for ten seconds and then clears itself, same as the charge it sits beside.
        */}
        <button type="button" onClick={onUpload}
          className="text-[11px] font-medium text-[var(--c-steel)] hover:underline text-left">
          Upload what it found
        </button>
        {/*
          WHAT IT COST, AND WHY WHERE IT COST NOTHING. A null charge is not a refusal: it is one
          necessary expense already raised for this person, which is a different sentence from the
          ceiling and must not borrow its words.
        */}
        <span className={`text-[11px] ${result.charge?.reason === 'charged' ? 'text-[var(--c-green)]' : 'text-slate-500'}`}>
          {chargeWords(result, source)}
        </span>
      </>
    )}>
      <button type="button" onClick={open} title="Record a trace — a credit bureau search is Annexure B item 4(c), anything else is item 3" className={className}>
        <Search size={14} /> {label ?? 'Trace'}
      </button>

      {/*
        WHERE ARE YOU LOOKING?

        THE FIRM: "where do I do the other traces, like for example CSA and stuff." Every source
        the firm uses, in one list, with what each one answers under it -- because the choice is
        not the vendor, it is the question. SASSA tells you whether somebody draws a grant, which
        is the difference between "refusing to pay" and "cannot pay", and those two must never be
        on one list.

        AND WHAT IT COSTS THE DEBTOR IS ON THE ROW. A collector pressing one of these raises a fee
        against a person; the gazette's item is the one fact that decides whether that is lawful,
        and it is not something to find out afterwards on a statement.
      */}
      {choosing && (
        <Modal title="Where are you looking?" onClose={() => setChoosing(false)} width={520}>
          <div className="space-y-2">
            {TRACE_SOURCES.map((s) => (
              <button key={s.id} type="button" onClick={() => pick(s)}
                className="w-full text-left px-3.5 py-3 rounded-lg border border-slate-200
                  hover:border-[#c9a052] hover:bg-gold-50">
                <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-sm font-semibold text-slate-800">{s.name}</span>
                  <span className="text-[11px] text-slate-400">
                    {s.kind === 'credit_bureau'
                      ? `Credit bureau · item 4(c) · R${rate.toFixed(2)}`
                      : 'Item 3 · R25.00 · once per person'}
                  </span>
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">{s.what}</span>
              </button>
            ))}
          </div>
          {/*
            THE LIST IS NOT FINISHED AND SAYS SO. XDS is the one this app was built around; the
            others are the firm's own words and want confirming. Said here rather than left for
            somebody to discover, because a name on this screen decides which line of the gazette
            a debtor is charged under.
          */}
          <p className="text-[11px] text-slate-400 mt-3">
            Is one missing, or named wrong? Say so and it is one line to add.
          </p>
        </Modal>
      )}

      {asking && (
        <Modal
          /* THE TITLE FOLLOWS THE QUESTION. Only a bureau search is counted, so only a bureau
             search is asked how many -- see `counted`. */
          title={result ? 'Trace recorded' : counted ? 'How many searches did you run?' : 'Record this trace'}
          onClose={() => { setAsking(false); setResult(null) }}
          width={460}
        >
          {!result && (
            <p className="text-sm text-slate-500">
              {source.url
                ? `${source.name} is open in a new tab. `
                : `${source.name} is not a portal Raptor can open, so search it the way you normally do. `}
              {counted
                ? 'One account can carry a company and its sureties, so tell us how many searches '
                  + 'you ran and they go on the statement as a single line.'
                : 'Record it when you are done, and upload whatever it found.'}
            </p>
          )}

          {/*
            WHERE, IN THEIR OWN WORDS, for a source this list does not name. It goes on the
            TIMELINE and nowhere else -- the debtor's statement says "ONE" whatever was searched,
            which is the firm's own rule about not naming a supplier on a document that leaves the
            building.
          */}
          {!result && source.id === 'other' && (
            <label className="block mt-3">
              <span className="text-xs font-medium text-slate-600">Where did you look?</span>
              <input value={named} onChange={(e) => setNamed(e.target.value)}
                placeholder="Deeds office"
                className="mt-1 w-full text-sm rounded-lg border border-slate-200 px-3 py-2" />
              <span className="block text-[11px] text-slate-400 mt-1">
                Goes on the account&rsquo;s own timeline, so the next collector knows where has
                already been tried. It is not on the debtor&rsquo;s statement.
              </span>
            </label>
          )}

          {/*
            THE NUMBER, EITHER WAY. On the clipboard where the browser allowed it, and on the
            screen where it did not -- a collector told nothing would retype thirteen digits from
            the account behind this modal, and a digit wrong there is a search about somebody
            else that the firm still pays for.
          */}
          {!result && key.ok && copied === 'yes' && (
            <p className="text-xs text-[var(--c-green)] mt-3 inline-flex items-center gap-1.5">
              <Check size={13} /> The {key.what} {key.value} is on your clipboard — paste it into the search.
            </p>
          )}
          {!result && key.ok && (copied === 'no' || copied === 'asking') && (
            <p className="text-xs text-slate-500 mt-3">
              Search on <span className="font-medium text-slate-700 select-all">{key.value}</span>
              {copied === 'no' && ' — this browser would not let us copy it for you.'}
            </p>
          )}
          {/*
            A MISSING NUMBER AND A WRONG ONE ARE DIFFERENT PROBLEMS. One needs capturing and the
            other needs correcting, and a collector told only "no ID" would go and type the
            telephone number sitting in that field straight into the portal.
          */}
          {/*
            WHAT THIS MONTH'S FOUR HAVE GONE ON.

            THE FIRM: "cap all the tracing activities at four a month... just detail them." The
            detail is the half that makes the cap workable: a collector told "no charge, four
            already" has no way to know whether that was four real searches or one counted four
            times, and no way to put the case to a team leader. Shown BEFORE they press, so the
            decision to spend the last one is made knowingly.
          */}
          {!result && tracing !== null && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs font-medium text-slate-600">
                {tracing.left > 0
                  ? `${tracing.used} of ${tracing.limit} tracing charges used on this account this month`
                  : `All ${tracing.limit} tracing charges are used on this account this month`}
              </p>
              {tracing.charges.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {tracing.charges.map((c, i) => (
                    <li key={i} className="text-[11px] text-slate-500 flex justify-between gap-2">
                      <span>{c.on} · {c.description}</span>
                      <span className="tabular-nums">R{c.exclVat.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {tracing.left === 0 && (
                <p className="text-[11px] text-slate-500 mt-1.5">
                  The search is still recorded &mdash; it just earns nothing until next month.
                </p>
              )}
            </div>
          )}

          {/*
            WHAT THE SITE WILL ALSO ASK FOR AND RAPTOR CANNOT GIVE IT.

            SASSA's status page wants the phone number the grant was applied on, and the firm does
            not hold it -- a mobile on our contact list is not necessarily the one they applied
            with. Said here rather than discovered on the site, because a collector who opens a
            form they cannot complete has spent the trip for nothing.
          */}
          {!result && source.alsoNeeds && (
            <p className="text-xs text-slate-500 mt-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
              {source.name} also asks for {source.alsoNeeds}.
            </p>
          )}

          {!result && problem !== null && (
            <p className="text-xs text-negative-700 mt-3 rounded-lg bg-negative-50 border border-negative-100 px-3 py-2">
              {problem}
            </p>
          )}
          {/*
            FOUR, AND THE FOUR IS THE GAZETTE'S. The firm: "make it only go up to four, not more
            than that." Item 4(c) carries maxPerMonth 4 on every schedule, so five through ten
            offered a number the tariff does not have. Taken off the schedule rather than typed --
            see bureauSearchCounts.
          */}
          {!result && counted && (
            <div className="flex flex-wrap gap-2 mt-4">
              {counts.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => void charge(n)}
                  disabled={busy}
                  className="w-11 h-11 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 bg-white hover:border-[#c9a052] hover:bg-gold-50 disabled:opacity-50"
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          {/*
            WHAT CAME BACK, TYPED.

            THE FIRM, having worked four of these sites by hand: "how do we capture the data? They
            should either capture it or the screenshots should be uploaded. I believe maybe things
            should just be typed in. That might be better." They are right, and traceSourceNote
            says why at length: a bureau hands back a PDF Raptor can parse, these hand back a web
            PAGE, and a screenshot of one cannot be asked "which debtors draw a grant".

            ONLY ON THE SOURCES THAT NEED IT. A bureau search has a whole workspace behind it --
            every number, address and linked person as its own row -- so a free-text box there
            would be a second, worse place to put the same findings.

            OPTIONAL, because a search that found nothing is still worth recording: the next
            collector needs to know where has already been tried.
          */}
          {!result && !counted && (
            <label className="block mt-3">
              <span className="text-xs font-medium text-slate-600">What did you find?</span>
              <textarea value={found} onChange={(e) => setFound(e.target.value)} rows={2}
                placeholder={source.id === 'sassa'
                  ? 'Drawing an SRD grant since March 2026.'
                  : source.id === 'iec'
                    ? 'Registered in ward 79900090, Soshanguve — voting station Thorntree View Primary.'
                    : source.id === 'sars_vat'
                      ? 'Not a registered VAT vendor under that trading name.'
                      : 'Nothing came back.'}
                className="mt-1 w-full text-sm rounded-lg border border-slate-200 px-3 py-2 resize-none" />
              <span className="block text-[11px] text-slate-400 mt-1">
                Goes on the account&rsquo;s timeline. Leave it empty if nothing came back &mdash;
                that is worth recording too.
              </span>
            </label>
          )}

          {/* AND WHERE THERE IS NOTHING TO COUNT, ONE BUTTON. Item 3 is once per person whatever
              was searched, so a row of numbers here would be asking a question whose answer the
              charge ignores. */}
          {!result && !counted && (
            <button type="button" onClick={() => void charge(1)} disabled={busy}
              className="mt-4 text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-900 text-white disabled:opacity-50">
              Record the trace
            </button>
          )}

          {/* WHAT IT COSTS, IN THE WORDS OF THE ITEM IT IS ACTUALLY CHARGED UNDER. This said
              "item 4(c)" whatever the source was, so a SASSA search quoted the bureau's line of
              the gazette and the bureau's price for a fee raised under item 3. */}
          {!result && (
            <p className="text-xs text-slate-400 mt-3">
              {counted
                ? <>{rate > 0 && <>R{rate.toFixed(2)} plus VAT each, under Annexure B item 4(c). </>}
                  Nothing is charged until you choose.</>
                : <>R25.00 plus VAT, under Annexure B item 3, and only once for this person however
                  many places you looked. Nothing is charged until you record it.</>}
            </p>
          )}

          {/*
            AND THE OFFER TO UPLOAD, THE MOMENT THEY COME BACK FROM THE PORTAL.

            THE FIRM: "after you've reached this tab, I think I can automatically already ask you to
            upload if you want to upload the trace." It was a link under the button that cleared
            itself after ten seconds -- so the one minute a collector certainly has the PDFs on
            their machine was spent on a link that had already gone. Asked here, it waits.

            ASKED, NOT DONE. "If you want to" is the firm's own qualifier, and a file picker that
            opens itself on somebody who ran the search to read it on screen is a dialog to dismiss.
          */}
          {result && (
            <>
              <p className={`text-sm ${result.charge?.reason === 'charged' ? 'text-[var(--c-green)]' : 'text-slate-500'}`}>
                {chargeWords(result, source)}
              </p>
              <p className="text-sm text-slate-500 mt-3">
                Upload what {source.name} found and Raptor reads the numbers, addresses, employment
                and linked people off it.
              </p>
              <div className="flex items-center justify-end gap-2 mt-5">
                <button type="button" onClick={() => { setAsking(false); setResult(null); onUpload() }}
                  className="text-sm font-medium px-3.5 py-2 rounded-lg bg-navy-900 text-white">
                  Upload what it found
                </button>
                {/* NOT NOW, NOT CANCEL. Nothing is undone by declining -- the trace is already
                    recorded and charged -- and "Cancel" beside a fee that has been raised reads
                    as though it takes it off. */}
                <button type="button" onClick={() => { setAsking(false); setResult(null) }}
                  className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-500 hover:bg-slate-100">
                  Not now
                </button>
              </div>
            </>
          )}

          {error && <p className="text-sm text-negative-700 mt-3">{error}</p>}
          {!result && (
            <div className="flex items-center justify-end gap-2 mt-5">
              {busy && <Loader2 size={15} className="animate-spin text-slate-400" />}
              <button onClick={() => setAsking(false)} disabled={busy} className="text-sm font-medium px-3.5 py-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50">
                Didn&apos;t trace
              </button>
            </div>
          )}
        </Modal>
      )}
    </RecordActionNote>
  )
}
