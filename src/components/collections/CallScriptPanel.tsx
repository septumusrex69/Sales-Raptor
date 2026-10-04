import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, Loader2, Lock, MessageSquare, Phone, ShieldCheck } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { fetchLibrary, type LibraryTemplate } from '../../lib/templateLibrary'
import {
  ALWAYS_AT_HAND, BRANCHES_AT_HAND, CLOSING_SCRIPTS, DISPOSITIONS, OBJECTIONS, RECORDS_NOTHING,
  callHoursProblem, doNotDial, openingScript, outcomeFor, scriptFor, stopsEverything,
  type CallState,
} from '../../lib/callScripts.ts'
import {
  isAllDirection, mergeSegments, parseCallScript, unanswered,
  type Branch, type CallScript, type ScriptLine,
} from '../../lib/callScriptParts.ts'
import { MERGE_FIELDS } from '../../lib/messageTemplates'
import { firmClock } from '../../lib/dateLabels.ts'
import { todayIso } from '../../lib/reminderTime.ts'
import {
  capacityLabel, isLive, type AuthorisedContact,
} from '../../lib/authorisedContacts.ts'

/**
 * THE SCRIPT IN FRONT OF THE COLLECTOR WHILE THE DEBTOR IS ON THE LINE.
 *
 * THE FIRM'S BRIEF, and the whole of this panel is in its second paragraph: "the opening script
 * pops first, always... the workflow script underneath it is locked until the collector ticks
 * verified. This is the single most important behaviour in this prompt: it is what stops a
 * collector disclosing an account to the wrong person."
 *
 * FIVE THINGS IT HAS TO DO, each of which was a line in the brief:
 *
 *   1. THE OPENING SCRIPT FIRST, by debtor type, every time.
 *   2. NOTHING IDENTIFYING ON THE SCREEN UNTIL THE TICK. "The panel must not display the debtor's
 *      name, the creditor or the balance until the verification tick is set, because a collector
 *      reads what is on the screen." So the header is the reference and nothing else, and the
 *      workflow script -- which quotes the creditor and the balance in its first line -- is behind
 *      a lock rather than merely further down.
 *   3. EVERY BRANCH ONE TAP AWAY, without losing the panel: what the debtor just said (dispute,
 *      debt review, deceased, insolvency, not-my-account, arrangement, settlement) and who turned
 *      out to be on the line (the seven section E scripts).
 *   4. MERGE-FILLED BEFORE IT OPENS, with an unanswerable field drawn as a red gap naming itself
 *      rather than as empty space. See mergeSegments.
 *   5. NO CLOSING WITHOUT A DISPOSITION, on a live call. "The call cannot be closed without a
 *      disposition code."
 *
 * AND IT READS THE ACCOUNT'S AUTHORISED CONTACTS, which is the part the firm said "cannot live in
 * a collector's head": the tick is not a free tick. It is either the debtor, verified on the
 * opening script, or a row on the list whose proof is actually on file.
 *
 * NOTHING IS CHARGED BY OPENING THIS. Annexure B prices actions -- an email, an SMS, a
 * consultation -- and reading is not one of them. The fee for the call is raised by the call.
 */
export function CallScriptPanel({
  values, debtorKind, state, authorised, live, reference, onDisposition, onClose,
}: {
  /** Resolved by the account page, like every other merge in the app. */
  values: Record<string, string>
  debtorKind: 'individual' | 'company'
  /** What Raptor knows about the account, which decides which script follows the opening one. */
  state: CallState
  /** Who may be told anything. The tick reads this; it is not a free tick. */
  authorised: AuthorisedContact[]
  /**
   * IS THERE A CALL HAPPENING? It decides one thing: whether this can be closed without a
   * disposition.
   *
   * A COLLECTOR ALSO READS A SCRIPT WITH NO DEBTOR ON THE LINE -- before dialling, or to see what
   * the firm says at a stage. Demanding a disposition there would be demanding a record of a call
   * that never happened, which is the shape of the imported book's 58 promises-to-pay with 43
   * promises behind them.
   */
  live: boolean
  /** Shown before verification, because it identifies nobody. See rule 2. */
  reference: string | null
  /** Handed up so the account page writes the record -- see outcomeFor. */
  onDisposition: (code: string) => void
  onClose: () => void
}) {
  const [library, setLibrary] = useState<LibraryTemplate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /* WHO WAS VERIFIED, not merely THAT somebody was. Null until the collector says. */
  const [verified, setVerified] = useState<{ who: string; capacity: string } | null>(null)
  /* The script being read, where the collector has jumped off the one the account chose. */
  const [picked, setPicked] = useState<string | null>(null)
  const [disposition, setDisposition] = useState<string | null>(null)
  const [objectionsOpen, setObjectionsOpen] = useState(false)
  const [openBranch, setOpenBranch] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchLibrary('collections')
      .then((all) => {
        if (cancelled) return
        setLibrary(all.filter((t) => t.kind === 'call_script'))
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setLibrary([])
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => { cancelled = true }
  }, [])

  const bySeed = useMemo(
    () => new Map((library ?? []).filter((t) => t.seedKey).map((t) => [t.seedKey as string, t])),
    [library],
  )

  const stop = doNotDial(state)
  const opening = openingScript(debtorKind)
  /* THE ACCOUNT'S OWN SCRIPT, or null where the account must not be rung at all. */
  const forState = scriptFor(state)
  const showing = picked ?? (verified ? forState : opening)
  const template = showing ? bySeed.get(showing) ?? null : null
  const script = useMemo(() => (template ? parseCallScript(template.body) : null), [template])
  const gaps = useMemo(() => (script ? unanswered(script, values) : []), [script, values])

  /* THE FIRM'S OWN HOURS, said rather than enforced here -- the dialler enforces them. A collector
     looking at a script at half past six in the evening should know the firm does not ring then. */
  const hours = useMemo(() => {
    /* firmClock gives "17:40" in Johannesburg -- the firm's own clock, not the browser's, which is
       the one that matters for a rule about when the firm may ring. */
    const [h, m] = firmClock(new Date()).split(':').map(Number)
    return callHoursProblem(todayIso(), h * 60 + m)
  }, [])

  const canClose = !live || disposition !== null
  const close = useCallback(() => {
    if (!canClose) return
    if (disposition) onDisposition(disposition)
    onClose()
  }, [canClose, disposition, onDisposition, onClose])

  const today = todayIso()
  const liveContacts = authorised.filter((c) => isLive(c, today))

  return (
    <Modal title="Call script" width={760}
      /* NO WAY OUT BUT THE DISPOSITION, on a live call. The brief: "the call cannot be closed
         without a disposition code." Modal takes onClose for its backdrop and its X, so the guard
         has to be in the function rather than beside the button. */
      onClose={close}>
      <div className="space-y-3">
        {/*
          WHAT THE SCREEN MAY SAY BEFORE THE TICK, which is the reference and nothing else.

          THE FIRM: "confirming the account exists is itself a disclosure. The panel must not
          display the debtor's name, the creditor or the balance until the verification tick is
          set, because a collector reads what is on the screen."
        */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border
          border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-[12px] text-slate-600">
            {verified
              ? <>Verified: <strong className="font-semibold text-slate-800">{verified.who}</strong>
                {' '}&middot; {capacityLabel(verified.capacity)}</>
              : <>Reference {reference ?? '—'} &middot; nothing else until the person is verified</>}
          </span>
          <span className="text-[11px] text-slate-400">Reading this charges nothing.</span>
        </div>

        {/* THE TWO HARD STOPS, over everything. The account must not be rung at all. */}
        {stop && (
          <p className="flex items-start gap-2 rounded-lg border border-negative-200
            bg-negative-50 px-3 py-2 text-[12px] text-negative-700">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span><strong className="font-semibold">Do not dial.</strong> {stop} Route it to the
            manager rather than ringing.</span>
          </p>
        )}

        {hours && (
          <p className="text-[11px] text-[var(--c-gold-deep)]">{hours}</p>
        )}

        {error && <p className="text-xs text-negative-700">{error}</p>}
        {library === null && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={14} className="animate-spin" /> Loading the firm&rsquo;s scripts…
          </p>
        )}

        {/*
          THE VERIFICATION TICK, which is the control this whole panel exists for.

          IT NAMES WHO WAS VERIFIED rather than being a bare checkbox, and the list it offers is
          the account's own: the debtor, or an authorised contact whose proof is on file. A row
          with nothing behind it is not offered at all -- see isLive -- because the firm's rule is
          that it "is not an authorised contact, however long it has been there".
        */}
        {library !== null && !verified && (
          <section className="rounded-lg border border-gold-200 bg-gold-50/50 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-800">
              <Lock size={13} /> The rest of the call is locked until you have verified who you are
              speaking to
            </p>
            <p className="mt-1 text-[11px] text-slate-600">
              Read the opening script below first. Nothing about the account may be said &mdash;
              not the creditor, not the balance, not that there is an account &mdash; until one of
              these is true.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button"
                onClick={() => setVerified({ who: values.debtor_name ?? 'The debtor', capacity: 'debtor' })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#c9a052]
                  bg-white px-2.5 py-1 text-[11px] font-medium text-navy-950 hover:bg-gold-100">
                <ShieldCheck size={12} /> It is the debtor, and they verified
              </button>
              {liveContacts.map((c) => (
                <button key={c.id} type="button"
                  onClick={() => setVerified({ who: c.name, capacity: c.capacity })}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200
                    bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50">
                  <ShieldCheck size={12} /> {c.name} &middot; {capacityLabel(c.capacity)}
                </button>
              ))}
            </div>
            {/*
              SAID WHERE THERE IS NOBODY ELSE ON THE LIST. Not a dash and not an empty row: a
              collector talking to somebody who is not the debtor needs to know that the way to
              deal with them is to put their authority on file, not to decide on the call.
            */}
            {liveContacts.length === 0 && (
              <p className="mt-2 text-[11px] text-slate-500">
                Nobody else is authorised on this account. If the person on the line claims
                authority, use <em>Somebody claims authority</em> below and put the proof on file
                &mdash; nothing is said about the account until it is.
              </p>
            )}
          </section>
        )}

        {/* WHAT THIS ACCOUNT'S STATE CHOSE, said so a collector knows why this script and not
            another -- and so that jumping off it is a deliberate act. */}
        {library !== null && verified && forState && showing !== forState && (
          <button type="button" onClick={() => { setPicked(null); setOpenBranch(null) }}
            className="text-[11px] font-medium text-[var(--c-steel)] hover:underline">
            &larr; Back to the script for where this account is
          </button>
        )}

        {library !== null && template === null && showing !== null && (
          <p className="text-sm text-slate-500">
            <strong className="font-semibold">{showing}</strong> is not in the library. The firm&rsquo;s
            31 scripts are seeded by scripts/call-scripts/seed.sql.
          </p>
        )}

        {script && template && (
          <ScriptView script={script} name={template.name} values={values} gaps={gaps}
            openBranch={openBranch} onBranch={setOpenBranch} />
        )}

        {/*
          EVERY BRANCH ONE TAP AWAY. Two groups because they answer two different questions: what
          the debtor just said, and who turned out to be on the line. A collector hunting for "he
          passed away" should not be reading past "settlement" to find it.
        */}
        {library !== null && (
          <section className="rounded-lg border border-slate-200 px-3 py-2.5">
            <Jump title="What they just said" keys={BRANCHES_AT_HAND} bySeed={bySeed}
              onPick={(k) => { setPicked(k); setOpenBranch(null) }} showing={showing} />
            <Jump title="Who is on the line" keys={ALWAYS_AT_HAND} bySeed={bySeed}
              onPick={(k) => { setPicked(k); setOpenBranch(null) }} showing={showing} />
            <Jump title="Ending the call" keys={CLOSING_SCRIPTS} bySeed={bySeed}
              onPick={(k) => { setPicked(k); setOpenBranch(null) }} showing={showing} />
          </section>
        )}

        {/*
          THE SIXTEEN ANSWERS, BESIDE WHATEVER IS OPEN -- the firm asked for exactly this: "Raptor
          should show this panel alongside whichever script is open." Shut by default because the
          script is the thing being read; one tap, because the objection is already being said.
        */}
        <section className="rounded-lg border border-slate-200">
          <button type="button" onClick={() => setObjectionsOpen(!objectionsOpen)}
            aria-expanded={objectionsOpen}
            className="flex w-full items-center gap-2 px-3 py-2 text-left">
            <MessageSquare size={14} className="shrink-0 text-slate-400" />
            <span className="flex-1 text-[12px] font-semibold text-slate-700">
              Answers to what they actually say
            </span>
            <ChevronDown size={14}
              className={`shrink-0 text-slate-400 transition-transform ${objectionsOpen ? 'rotate-180' : ''}`} />
          </button>
          {objectionsOpen && (
            <dl className="border-t border-slate-100 px-3 py-2 space-y-2 max-h-[40vh] overflow-auto">
              {OBJECTIONS.map((o) => (
                <div key={o.said}>
                  <dt className="text-[12px] font-semibold text-slate-700">&ldquo;{o.said}&rdquo;</dt>
                  <dd className="text-[12.5px] leading-6 text-slate-800">
                    <Merged text={o.answer} values={values} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        {/*
          HOW THE CALL ENDS, AND IT CANNOT END WITHOUT THIS.

          THE SIXTEEN CODES ARE THE FIRM'S, and the sentence under the chosen one is what Raptor
          does with it -- so the collector is choosing a consequence rather than a label.
        */}
        <section className="rounded-lg border border-slate-200 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            How did the call end?
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DISPOSITIONS.map((d) => (
              <button key={d.code} type="button" onClick={() => setDisposition(d.code)}
                title={d.meaning}
                className={`rounded-lg border px-2 py-1 text-[11px] font-medium ${
                  disposition === d.code
                    ? 'border-[#c9a052] bg-gold-100 text-navy-950'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                {d.code}
              </button>
            ))}
          </div>
          {disposition && <Consequence code={disposition} />}
          {!disposition && live && (
            <p className="mt-2 text-[11px] text-slate-500">
              Pick one before you close this. A call nobody recorded did not happen.
            </p>
          )}
        </section>

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={close} disabled={!canClose}
            className="inline-flex items-center gap-1.5 rounded-lg bg-navy-950 px-3 py-1.5
              text-xs font-medium text-white disabled:opacity-40">
            <Phone size={12} /> {live ? 'Record it and close' : 'Close'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * WHAT RAPTOR DOES WITH THE CODE, said under it.
 *
 * TWO DIFFERENT SENTENCES FOR TWO DIFFERENT KINDS OF CODE. Most codes move the account, and the
 * firm's own words for what happens are on the disposition. Four of them move nothing -- PIF,
 * SETL, MAND, DNC -- and those have to SAY so, or somebody picks PIF and walks away believing the
 * file is closed. See RECORDS_NOTHING and OUTCOME_FOR_DISPOSITION.
 */
function Consequence({ code }: { code: string }) {
  const d = DISPOSITIONS.find((x) => x.code === code)
  const nothing = RECORDS_NOTHING[code]
  const outcome = outcomeFor(code)
  return (
    <div className={`mt-2 rounded-lg px-2.5 py-2 text-[11px] leading-snug ${
      stopsEverything(code) ? 'bg-negative-50 text-negative-700' : 'bg-slate-50 text-slate-600'}`}>
      <p><strong className="font-semibold">{code}</strong> &mdash; {d?.meaning}. {d?.then}.</p>
      {nothing && <p className="mt-1">{nothing}</p>}
      {outcome === null && !nothing && (
        <p className="mt-1">This records the call and does not move the account on its own.</p>
      )}
    </div>
  )
}

/** One row of jump buttons, under its own heading. Absent where the library has none of them. */
function Jump({ title, keys, bySeed, onPick, showing }: {
  title: string
  keys: string[]
  bySeed: Map<string, LibraryTemplate>
  onPick: (key: string) => void
  showing: string | null
}) {
  const there = keys.filter((k) => bySeed.has(k))
  if (there.length === 0) return null
  return (
    <div className="mb-2 last:mb-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {there.map((k) => (
          <button key={k} type="button" onClick={() => onPick(k)}
            className={`rounded-lg border px-2 py-1 text-[11px] font-medium ${
              showing === k
                ? 'border-[#c9a052] bg-gold-100 text-navy-950'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            {bySeed.get(k)?.name ?? k}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * THE SCRIPT ITSELF, with each of the five parts drawn the way the firm asked for.
 *
 *   spoken      large and high contrast. This is what the eye goes to.
 *   directions  smaller, italic, visually distinct -- and never read aloud, which is why they are
 *               a different colour and not merely a different size.
 *   branches    collapsed, one tap to open.
 *   capture     under its own heading, because it is what the disposition below has to match.
 *   never       always visible, red, and not collapsible. The firm: "those nine lines are the ones
 *               that found a complaint to the Council for Debt Collectors."
 */
function ScriptView({ script, name, values, gaps, openBranch, onBranch }: {
  script: CallScript
  name: string
  values: Record<string, string>
  gaps: string[]
  openBranch: number | null
  onBranch: (i: number | null) => void
}) {
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-navy-950">{name}</h4>
        {script.goal && <p className="text-[11px] text-slate-500">{script.goal}</p>}
      </div>

      {/*
        WHAT THIS ACCOUNT COULD NOT ANSWER, NAMED ONCE AT THE TOP as well as marked in the words.
        The firm wants the gap visible where it falls; a collector about to speak also wants to
        know there IS one before they start reading.
      */}
      {gaps.length > 0 && (
        <p className="mt-1.5 text-[11px] text-[var(--c-rust-deep)]">
          This account cannot answer {gaps.map(fieldLabel).join(', ')}. Each one is marked in the
          script &mdash; do not improvise a figure on a recorded call.
        </p>
      )}

      <div className="mt-2 rounded-lg border border-slate-200 bg-white p-4 max-h-[42vh] overflow-auto">
        {script.spoken.map((line, i) => (
          <Line key={i} line={line} values={values} />
        ))}
      </div>

      {script.branches.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            If they say
          </p>
          <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {script.branches.map((b, i) => (
              <BranchRow key={i} branch={b} values={values} open={openBranch === i}
                onToggle={() => onBranch(openBranch === i ? null : i)} />
            ))}
          </ul>
        </div>
      )}

      {script.capture.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Capture on the account
          </p>
          <ul className="mt-1 space-y-0.5">
            {script.capture.map((c, i) => (
              <li key={i} className="text-[12px] text-slate-600">&middot; <Merged text={c} values={values} /></li>
            ))}
          </ul>
        </div>
      )}

      {/* ALWAYS VISIBLE, RED, NOT COLLAPSIBLE. The firm's own instruction, and the reason for it
          is that these are the lines a complaint is founded on. */}
      {script.never.length > 0 && (
        <div className="mt-2 rounded-lg border border-negative-200 bg-negative-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-negative-700">
            Do not
          </p>
          <ul className="mt-1 space-y-0.5">
            {script.never.map((n, i) => (
              <li key={i} className="text-[12px] leading-snug text-negative-700">
                &middot; <Merged text={n} values={values} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        AND ANYTHING THE PARSE COULD NOT PLACE, shown rather than dropped.

        Empty on all 31 of the firm's scripts -- check-call-script-parts holds that -- so this is
        for the script somebody writes next. A line of the firm's own words that this app does not
        understand is still a line the collector may need, and showing it is how somebody notices
        the parser needs teaching. See CallScript.unplaced.
      */}
      {script.unplaced.length > 0 && (
        <div className="mt-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Also on this script
          </p>
          <ul className="mt-1 space-y-0.5">
            {script.unplaced.map((u, i) => (
              <li key={i} className="text-[12px] text-slate-600"><Merged text={u} values={values} /></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/** One line of what is said — or, where every run of it is bracketed, one instruction. */
function Line({ line, values }: { line: ScriptLine; values: Record<string, string> }) {
  if (isAllDirection(line)) {
    return (
      <p className="mb-2 text-[12px] italic leading-snug text-[var(--c-steel)]">
        {line.runs.map((r, i) => <Merged key={i} text={r.text} values={values} />)}
      </p>
    )
  }
  return (
    <p className="mb-2.5 text-[15px] leading-7 text-slate-900">
      {line.runs.map((r, i) => (r.kind === 'direction'
        ? <em key={i} className="text-[12px] not-italic text-[var(--c-steel)]"> [<Merged text={r.text} values={values} />] </em>
        : <span key={i}><Merged text={r.text} values={values} /></span>))}
    </p>
  )
}

/** "If they say X" — the debtor's words, with the answer one tap under them. */
function BranchRow({ branch, values, open, onToggle }: {
  branch: Branch
  values: Record<string, string>
  open: boolean
  onToggle: () => void
}) {
  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50">
        <ChevronDown size={12}
          className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        <span className="flex-1 text-[12px] font-medium text-slate-700">{branch.heard}</span>
      </button>
      {open && (
        <p className="px-3 pb-2 pl-8 text-[14px] leading-6 text-slate-900">
          {branch.reply.runs.map((r, i) => (r.kind === 'direction'
            ? <em key={i} className="text-[12px] not-italic text-[var(--c-steel)]"> [<Merged text={r.text} values={values} />] </em>
            : <span key={i}><Merged text={r.text} values={values} /></span>))}
        </p>
      )}
    </li>
  )
}

/**
 * TEXT WITH THIS DEBTOR'S FIGURES IN IT, and a RED NAMED GAP where there is no figure.
 *
 * THE FIRM: "if a field is empty, show the field name in red rather than an empty space." Both of
 * the alternatives get read out loud on a recorded call -- the braces, or a sentence that stops
 * mid-air -- and this is the version a collector stops at.
 */
function Merged({ text, values }: { text: string; values: Record<string, string> }) {
  return (
    <>
      {mergeSegments(text, values).map((s, i) => (s.kind === 'text'
        ? <span key={i}>{s.text}</span>
        : (
          <span key={i}
            className="rounded bg-negative-50 px-1 font-semibold text-negative-700"
            title={`${fieldLabel(s.field)} — this account cannot answer it. Do not improvise it.`}>
            no {gapName(s.field)}
          </span>
        )))}
    </>
  )
}

/**
 * THE FIELD IN THE FIRM'S WORDS, not its key. For the line ABOVE the script.
 *
 * Off MERGE_FIELDS, which is the same list the composer's own missing-field warning reads, so a
 * gap is named the same way wherever somebody meets it. The key is the fallback rather than
 * nothing: a field nobody has catalogued still has to be nameable on the screen.
 */
function fieldLabel(key: string): string {
  const f = MERGE_FIELDS.collections.find((x) => x.key === key)
  return f ? f.label : key
}

/**
 * AND THE GAP ITSELF IS NAMED SHORT, which is a different job from the line above the script.
 *
 * THE CATALOGUE'S LABELS ARE WRITTEN FOR SOMEBODY CHOOSING A FIELD, and they are long because
 * that is what helps there: {{debtor_address}} reads "Where the notice is posted, on its own
 * lines". Dropped into the middle of a sentence a collector is reading aloud, that is a clause
 * they would read out -- "I have you at Where the notice is posted, on its own lines" -- which is
 * the exact failure the gap exists to prevent.
 *
 * SO THE GAP CARRIES THE FIELD'S NAME, which is what the firm asked for in as many words: "show
 * the field name in red rather than an empty space." Underscores out, because it is being read by
 * a person and not by a parser, and the catalogue's own label is on the title so the long version
 * is a hover away.
 *
 * A SECOND SHORT LABEL IN THE CATALOGUE WOULD HAVE BEEN THE OTHER WAY, and CLAUDE.md is clear
 * about what two names for one thing costs: the day they disagree, two screens describe one field
 * differently.
 */
function gapName(key: string): string {
  return key.replace(/_/g, ' ')
}
